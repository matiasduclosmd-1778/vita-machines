import { audio } from '../audio/index.js';
import { GAME_CONFIG } from '../config.js';
import { PlayerState } from '../Car.js';
import { POWERUP_TYPES, EFFECT_TYPES, ENTITY_VIEWS } from '../powerups/types/index.js';

const NET = GAME_CONFIG.online;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const now = () => performance.now() / 1000;
const TYPES = Object.fromEntries(POWERUP_TYPES.map((t) => [t.id, t]));

// Banderas de cada auto en el estado
const ALIVE = 1;
const FALLING = 2;
const GROUNDED = 4;
const OUT = 8;

/**
 * Carrera online del lado del anfitrión: simula todo (Game corre normal), recibe los controles
 * de los invitados y les manda el estado de la carrera `snapshotRate` veces por segundo.
 * Los eventos sueltos (explosiones, cajas recogidas) viajan dentro del siguiente estado.
 */
export class HostSync {
  constructor(game, session, race) {
    this.isHost = true;
    this.game = game;
    this.session = session;
    this.ids = race.players.map((p) => p.id);
    this.localIndex = this.ids.indexOf(session.me.id);
    this.inputs = this.ids.map(() => ({ throttle: 0, steer: 0 }));
    this.events = [];
    this.sendTimer = 0;
    this.seq = 0;

    session.on('input', (m) => {
      const i = this.ids.indexOf(m.id);
      if (i >= 0) this.inputs[i] = { throttle: clamp1(m.th), steer: clamp1(m.st), fire: !!m.fi };
    });
    session.on('use', (m) => {
      const i = this.ids.indexOf(m.id);
      if (i >= 0 && game.state === 'racing') game.powerups.use(game.cars[i]);
    });
    session.on('jump', (m) => {
      const i = this.ids.indexOf(m.id);
      if (i >= 0 && game.state === 'racing') game.cars[i].jump();
    });
    session.on('left', (p) => {
      // Se desconectó en plena carrera: su auto queda eliminado
      const i = this.ids.indexOf(p.id);
      if (i < 0) return;
      this.inputs[i] = { throttle: 0, steer: 0 };
      if (game.cars[i].alive) game.eliminate([i]);
    });
    game.powerups.onExplosion = (pos, scale) => this.event(['x', r2(pos.x), r2(pos.y ?? 0), r2(pos.z), r2(scale)]);
  }

  inputFor(i) {
    return i === this.localIndex ? this.game.localAxis() : this.inputs[i];
  }

  useItem() {
    this.game.powerups.use(this.game.cars[this.localIndex]);
  }

  jump() {
    this.game.cars[this.localIndex].jump();
  }

  event(e) {
    this.events.push(e);
  }

  afterFrame(dt) {
    this.sendTimer += dt;
    if (this.sendTimer < 1 / NET.snapshotRate) return;
    this.sendTimer = 0;
    this.session.sendSnapshot(this.snapshot());
    this.events = [];
  }

  snapshot() {
    const g = this.game;
    const pu = g.powerups;
    return {
      t: 's',
      n: ++this.seq,
      st: g.state,
      cd: r2(g.countdown ?? 0),
      // Rondas: número, total, ronda extra, marcador y quién festeja (-1 = nadie)
      rd: [g.round, g.rounds, g.tiebreak ? 1 : 0, g.celebrant ?? -1],
      sc: g.scores,
      res: g.result,
      c: g.cars.map((car, i) => [
        r2(car.position.x),
        r2(car.position.y),
        r2(car.position.z),
        r3(car.heading),
        r2(car.forwardSpeed),
        r2(car.yawRate),
        r2(car.steer),
        r2(car.vy),
        r2(car.tumble?.angle ?? 0),
        r2(car.blink),
        (car.alive ? ALIVE : 0) | (car.fall ? FALLING : 0) | (car.grounded ? GROUNDED : 0) | (car.state === PlayerState.OUT_OF_SCREEN ? OUT : 0),
        r2(car.progress),
        Math.round(car.health),
        pu.inventory(car).item?.id ?? '',
        pu.effects.list(car).map((e) => [e.id, r2(e.remaining), e.netExtra?.()]),
        r2(car.twirl?.angle ?? 0), // vuelta del festejo
        pu.inventory(car).ammo, // balas del arma
      ]),
      b: pu.boxes.map((b) => (b.active ? 1 : 0)).join(''),
      e: pu.entities.filter((e) => e.netKind).map((e) => [e.netId, e.netKind, ...e.netState().map(r3)]),
      ev: this.events,
    };
  }

  dispose() {
    for (const ev of ['input', 'use', 'jump', 'left']) this.session.off(ev);
    this.game.powerups.onExplosion = null;
  }
}

/**
 * Carrera online del lado del invitado: no simula. Guarda los estados que llegan y muestra la carrera
 * `interpolationDelay` segundos atrás, interpolando entre los dos estados que rodean ese momento.
 * Manda sus controles al anfitrión cuando cambian.
 */
export class GuestSync {
  constructor(game, session, race) {
    this.isHost = false;
    this.game = game;
    this.session = session;
    this.localIndex = race.players.findIndex((p) => p.id === session.me.id);
    this.buffer = []; // [{ t, s }] por orden de llegada
    this.views = new Map(); // netId → vista de bomba / misil / aceite
    this.lastEvent = 0; // último estado cuyos eventos ya se mostraron
    this.sent = { throttle: 0, steer: 0, at: 0 };
    this.shownResult = false;
    session.on('snap', (s) => {
      this.buffer.push({ t: now(), s });
      if (this.buffer.length > 30) this.buffer.shift();
    });
  }

  useItem() {
    this.session.sendUse();
  }

  jump() {
    this.session.sendJump();
  }

  event() {}

  /** Cada frame: manda los controles y pone la escena como estaba hace `interpolationDelay`. */
  apply(dt) {
    this.sendInput();
    const g = this.game;
    g.powerups.stepLocalVisuals(dt);
    if (!this.buffer.length) return;

    const at = now() - NET.interpolationDelay;
    let i = this.buffer.findIndex((b) => b.t > at);
    if (i === -1) i = this.buffer.length; // todavía no llegó nada más nuevo: se queda en el último
    const a = this.buffer[Math.max(0, i - 1)];
    const b = this.buffer[Math.min(i, this.buffer.length - 1)];
    const k = b === a ? 1 : Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t)));

    this.applyCars(a, b, k);
    this.applyEntities(a.s, b.s, k, dt);

    // Lo discreto (cajas, objetos, efectos, eventos, resultado) se toma del estado más reciente ya mostrado
    const shown = k >= 1 ? b : a;
    this.applyPowerups(shown.s);
    for (const snap of this.buffer) {
      if (snap.t > at || snap.s.n <= this.lastEvent) continue;
      this.lastEvent = snap.s.n;
      for (const ev of snap.s.ev) this.playEvent(ev);
    }
    g.state = shown.s.st;
    g.countdown = shown.s.cd ?? 0;
    if (shown.s.rd) [g.round, g.rounds, g.tiebreak, g.celebrant] = [shown.s.rd[0], shown.s.rd[1], !!shown.s.rd[2], shown.s.rd[3]];
    if (shown.s.sc) g.scores = shown.s.sc;
    if (shown.s.st === 'finished' && shown.s.res && !this.shownResult) {
      this.shownResult = true;
      g.result = shown.s.res;
      g.hud.showResult(shown.s.res);
    }
  }

  applyCars(a, b, k) {
    const g = this.game;
    const dtSnap = Math.max(0.001, b.t - a.t);
    g.cars.forEach((car, i) => {
      const p = a.s.c[i];
      const q = b.s.c[i];
      if (!p || !q) return;
      const lerp = (j) => p[j] + (q[j] - p[j]) * k;
      car.position.set(lerp(0), lerp(1), lerp(2));
      car.heading = lerpAngle(p[3], q[3], k);
      car.velocity.set((q[0] - p[0]) / dtSnap, 0, (q[2] - p[2]) / dtSnap);
      car.forwardSpeed = lerp(4);
      car.yawRate = lerp(5);
      car.steer = lerp(6);
      car.vy = lerp(7);
      const flags = q[10];
      car.grounded = !!(flags & GROUNDED);
      car.tumble = q[8] ? { angle: lerp(8), total: Infinity, rate: 0 } : null;
      car.blink = q[9];
      car.fall = flags & FALLING ? { timer: 1 } : null;
      car.progress = lerp(11);
      if (q[12] < car.health) car.hurt = 1; // destello de daño también en el invitado
      car.health = q[12];
      car.netTwirl = q[15] || 0;
      g.powerups.inventory(car).ammo = q[16] ?? 0;
      if (!(flags & ALIVE)) {
        if (car.alive) car.eliminate();
      } else car.state = flags & OUT ? PlayerState.OUT_OF_SCREEN : PlayerState.NORMAL;
      car.updateCircles();
    });
  }

  applyEntities(a, b, k, dt) {
    const ctx = this.game.powerups;
    const prev = new Map(a.e.map((e) => [e[0], e]));
    const seen = new Set();
    for (const e of b.e) {
      const [id, kind, ...state] = e;
      seen.add(id);
      const before = prev.get(id);
      // Posición (x, y, z) interpolada si ya estaba en el estado anterior
      const s = before ? state.map((v, j) => (j < 3 ? before[j + 2] + (v - before[j + 2]) * k : v)) : state;
      let view = this.views.get(id);
      if (!view) {
        const View = ENTITY_VIEWS[kind];
        if (!View) continue;
        view = new View(ctx, s);
        this.views.set(id, view);
      }
      view.set(s);
      view.update(dt);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.dispose();
      this.views.delete(id);
    }
  }

  applyPowerups(s) {
    const g = this.game;
    const pu = g.powerups;
    pu.boxes.forEach((box, i) => box.setActive(s.b[i] === '1'));
    g.cars.forEach((car, i) => {
      const c = s.c[i];
      if (!c) return;
      // Objeto guardado
      const inv = pu.inventory(car);
      const item = TYPES[c[13]] ?? null;
      if (inv.item !== item) inv.item = item;
      // Efectos activos: se crean (start) y terminan (end) igual que en el anfitrión, solo para verlos
      const list = c[14];
      for (const [id, remaining, extra] of list) {
        let effect = pu.effects.get(car, id);
        if (!effect) {
          const Effect = EFFECT_TYPES[id];
          if (!Effect) continue;
          effect = pu.effects.add(car, Effect, remaining);
        }
        effect.remaining = remaining;
        if (extra) effect.applyNetExtra?.(extra);
      }
      for (const effect of [...pu.effects.list(car)]) {
        if (!list.some(([id]) => id === effect.id)) pu.effects.remove(car, effect.id);
      }
    });
  }

  playEvent(ev) {
    const g = this.game;
    if (ev[0] === 'x') g.powerups.explosion({ x: ev[1], y: ev[2], z: ev[3] }, ev[4]);
    else if (ev[0] === 's') audio.play(ev[1], { pan: ev[2], gain: ev[3], strength: ev[4] });
    else if (ev[0] === 'p') {
      const car = g.cars[ev[1]];
      if (!car) return;
      g.hud.flashItem(ev[1]);
      g.sfx('pickup', { car, local: true });
      const p = car.position;
      g.powerups.particles.burst({ x: p.x, y: p.y + 1.3, z: p.z }, 14, { color: '#ffe14d', speed: 6, up: 4, size: 0.28 });
    }
  }

  /** Controles propios: se mandan al cambiar (y cada tanto aunque no cambien, por si se perdió alguno). */
  sendInput() {
    const axis = this.game.localAxis();
    const t = now();
    const changed = axis.throttle !== this.sent.throttle || axis.steer !== this.sent.steer || axis.fire !== this.sent.fire;
    if ((changed && t - this.sent.at > 1 / NET.inputRate) || t - this.sent.at > 0.5) {
      this.session.sendInput({ th: axis.throttle, st: axis.steer, fi: axis.fire ? 1 : 0 });
      this.sent = { ...axis, at: t };
    }
  }

  dispose() {
    this.session.off('snap');
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
  }
}

function lerpAngle(a, b, k) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, Number(v) || 0));
}
