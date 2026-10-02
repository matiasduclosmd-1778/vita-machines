import { GAME_CONFIG } from '../config.js';

// Ajustes del jugador: se guardan en el navegador y se aplican sobre GAME_CONFIG.
// Los valores por defecto salen de config.js, así que config.js sigue siendo la fuente de verdad.

const KEY = 'vita-machines-settings-v1';

const DEFAULT_CONTROLS = GAME_CONFIG.players.map((p) => ({ ...p.controls }));
const DRIVER_IDS = GAME_CONFIG.drivers.map((d) => d.id);

export const ACTIONS = [
  { id: 'up', label: 'Acelerar' },
  { id: 'down', label: 'Frenar / Marcha atrás' },
  { id: 'left', label: 'Girar a la izquierda' },
  { id: 'right', label: 'Girar a la derecha' },
  { id: 'use', label: 'Usar objeto' },
  { id: 'jump', label: 'Saltar' },
];

export function defaultSettings() {
  return {
    video: {
      quality: GAME_CONFIG.graphics.quality, // 'high' | 'low'
      shadows: 'high', // 'high' | 'low' | 'off'
      renderScale: 1, // 1 | 0.75 | 0.5 (resolución interna)
      miniature: GAME_CONFIG.graphics.tiltShift.enabled,
      brightness: 50,
    },
    audio: { master: 80, music: 70, sfx: 80 }, // volúmenes 0..100 (ver src/audio/)
    game: {
      debug: GAME_CONFIG.debug.enabled,
    },
    controls: DEFAULT_CONTROLS.map((c) => ({ ...c })),
    pads: GAME_CONFIG.players.map((_, i) => i), // joystick de cada jugador (0 = el primero conectado) o null
    names: GAME_CONFIG.players.map(() => ''), // nombre de cada jugador local ('' = el de por defecto)
    drivers: GAME_CONFIG.players.map((p) => p.driver), // último piloto elegido por cada jugador
    profile: { name: '' }, // nombre del piloto (se pide al entrar al juego)
  };
}

export function loadSettings() {
  const base = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved) return base;
    return {
      video: { ...base.video, ...saved.video },
      game: { ...base.game, ...saved.game },
      audio: { ...base.audio, ...saved.audio },
      controls: base.controls.map((c, i) => ({ ...c, ...(saved.controls?.[i] || {}) })),
      pads: base.pads.map((n, i) => (saved.pads && saved.pads[i] !== undefined ? saved.pads[i] : n)),
      names: base.names.map((n, i) => (typeof saved.names?.[i] === 'string' ? saved.names[i] : n)),
      profile: { ...base.profile, ...saved.profile },
      // Un piloto que ya no existe en config.js vuelve al de por defecto
      drivers: base.drivers.map((id, i) => (DRIVER_IDS.includes(saved.drivers?.[i]) ? saved.drivers[i] : id)),
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // almacenamiento no disponible (modo privado, etc.): los ajustes duran esta sesión
  }
}

/**
 * Nombre de un jugador local: el que eligió, o (jugador 1) el de su perfil, o "Jugador N".
 * short: etiqueta corta para las flechas del borde (P1… si no eligió nombre).
 */
export function localPlayerName(settings, i) {
  const own = settings.names?.[i]?.trim() || (i === 0 ? settings.profile?.name?.trim() : '');
  return own ? { name: own, short: own.slice(0, 3).toUpperCase() } : { name: `Jugador ${i + 1}`, short: `P${i + 1}` };
}

/** Nombre legible de una tecla (KeyboardEvent.code). */
export function keyLabel(code) {
  if (!code) return '—';
  const named = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'ESPACIO', Enter: 'ENTER', NumpadEnter: 'NUM ENTER', ShiftLeft: 'SHIFT IZQ', ShiftRight: 'SHIFT DER',
    ControlLeft: 'CTRL IZQ', ControlRight: 'CTRL DER', AltLeft: 'ALT', AltRight: 'ALT GR',
    Tab: 'TAB', Backspace: 'BORRAR', Escape: 'ESC', Slash: '/', Period: '.', Comma: ',',
    Semicolon: 'Ñ', Quote: '´', BracketLeft: '`', BracketRight: '+', Minus: "'", Equal: '¡',
    Backslash: 'Ç', IntlBackslash: '<',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

/** Etiqueta corta del set de dirección de un jugador (para el HUD). pad: su joystick (o null). */
export function controlsSummary(c, pad = null) {
  const arrows = c.up === 'ArrowUp' && c.down === 'ArrowDown' && c.left === 'ArrowLeft' && c.right === 'ArrowRight';
  const keys = arrows ? 'Flechas' : [c.up, c.left, c.down, c.right].map(keyLabel).join('');
  return pad != null ? `${keys} · 🎮${pad + 1}` : keys;
}

/** Teclas reservadas por el juego: no se pueden asignar a un jugador. */
export const RESERVED_KEYS = ['Escape', 'KeyR', 'KeyV', 'KeyG', 'KeyM'];
