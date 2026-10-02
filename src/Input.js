const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter']);

// Joysticks (Gamepad API, mapeo "standard": Xbox / PlayStation / genéricos)
//  Stick izquierdo o cruceta: girar · RT o A: acelerar · LT o B: frenar / marcha atrás
//  X, RB o LB: usar objeto · Y: saltar (moto) · Start: pausa
// Cada botón apretado llega a onPress como un código "Pad<n>:<botón>" (n = 1, 2… en orden de conexión).
const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'];
const PAD_USE = ['X', 'RB', 'LB'];
const PAD_JUMP = ['Y'];
const DEADZONE = 0.2;
const STICK_PRESS = 0.6; // cuánto hay que mover el stick para que cuente como apretar una dirección
export const MAX_PADS = 4;

/** Código de un botón del joystick n (0 = primero conectado). */
export const padCode = (n, button) => `Pad${n + 1}:${button}`;

/** { pad: índice, button } de un código de joystick, o null si es una tecla. */
export function parsePad(code) {
  const m = /^Pad(\d+):(\w+)$/.exec(code);
  return m ? { pad: +m[1] - 1, button: m[2] } : null;
}

/** ¿El código es la acción (use / jump) de este jugador (su tecla o un botón de su joystick)? */
function isAction(code, player, action, buttons) {
  if (code === player.controls[action]) return true;
  const p = parsePad(code);
  return !!p && p.pad === player.pad && buttons.includes(p.button);
}
export const isUse = (code, player) => isAction(code, player, 'use', PAD_USE);
export const isJump = (code, player) => isAction(code, player, 'jump', PAD_JUMP);

/** ¿El código es "usar objeto" / "saltar" de cualquier joystick? (online: todos manejan el auto propio) */
export const isAnyPadUse = (code) => PAD_USE.includes(parsePad(code)?.button);
export const isAnyPadJump = (code) => PAD_JUMP.includes(parsePad(code)?.button);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressHandlers = [];
    this.pads = []; // estado de cada joystick conectado: { buttons: Set, values: [], x }

    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.emit(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    // Los joysticks no tienen eventos de botón: se leen en cada cuadro
    if (navigator.getGamepads) {
      const loop = () => {
        this.pollPads();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  /** Avisa a los suscriptores; el primero que devuelve true se queda con el evento. */
  emit(code) {
    for (const fn of this.pressHandlers) if (fn(code) === true) return;
  }

  pollPads() {
    const connected = [...navigator.getGamepads()].filter((g) => g?.connected).slice(0, MAX_PADS);
    this.pads = connected.map((g, n) => {
      const prev = this.pads[n]?.id === g.id ? this.pads[n].buttons : new Set();
      const values = PAD_BUTTONS.map((_, b) => g.buttons[b]?.value ?? 0);
      const x = Math.abs(g.axes[0] ?? 0) > DEADZONE ? g.axes[0] : 0;
      const y = Math.abs(g.axes[1] ?? 0) > DEADZONE ? g.axes[1] : 0;
      const buttons = new Set();
      PAD_BUTTONS.forEach((name, b) => {
        if (g.buttons[b]?.pressed) buttons.add(name);
      });
      // El stick también cuenta como cruceta (para los menús), con un poco de histéresis
      const stick = (name, v) => {
        if (v > (prev.has(name) ? STICK_PRESS - 0.2 : STICK_PRESS)) buttons.add(name);
      };
      stick('Left', -x);
      stick('Right', x);
      stick('Up', -y);
      stick('Down', y);
      for (const name of buttons) if (!prev.has(name)) this.emit(padCode(n, name));
      return { id: g.id, buttons, values, x };
    });
  }

  /** Cantidad de joysticks conectados (leída en el momento, para los avisos de conexión). */
  get padCount() {
    if (!navigator.getGamepads) return 0;
    return Math.min(MAX_PADS, [...navigator.getGamepads()].filter((g) => g?.connected).length);
  }

  /** { throttle, steer } del joystick n (-1..1, steer > 0 = izquierda). */
  padAxis(n) {
    const p = this.pads[n];
    if (!p) return { throttle: 0, steer: 0 };
    const v = (name) => p.values[PAD_BUTTONS.indexOf(name)];
    const btn = (name) => (p.buttons.has(name) ? 1 : 0);
    const stick = Math.sign(p.x) * ((Math.abs(p.x) - DEADZONE) / (1 - DEADZONE));
    const dpad = btn('Left') - btn('Right');
    return {
      throttle: Math.max(v('RT'), v('A')) - Math.max(v('LT'), v('B')),
      steer: Math.abs(stick) > 0 ? -stick : dpad,
    };
  }

  /**
   * Devuelve { throttle, steer } en -1..1 para un set de teclas y (opcional) un joystick.
   * steer > 0 = izquierda.
   */
  axis(controls, pad = null) {
    const k = (code) => (this.down.has(code) ? 1 : 0);
    const a = pad != null ? this.padAxis(pad) : { throttle: 0, steer: 0 };
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    return {
      throttle: clamp1(k(controls.up) - k(controls.down) + a.throttle),
      steer: clamp1(k(controls.left) - k(controls.right) + a.steer),
    };
  }

  /** Suscribe fn(code) a cada tecla o botón apretado. Si fn devuelve true, los siguientes no lo reciben. */
  onPress(fn) {
    this.pressHandlers.push(fn);
  }
}

/** Una sola entrada para todo el juego (la usan la carrera y los menús). */
export const input = new Input();
