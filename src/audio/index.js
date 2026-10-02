import { AudioEngine } from './AudioEngine.js';
import { Music } from './Music.js';
import { SFX, EngineSounds } from './Sfx.js';
import { Voices } from './Voices.js';

// Punto de entrada del audio del juego: música, efectos y motores (todo sintetizado, ver src/audio/).
//  audio.play('crash', { pan, gain, strength }) · audio.music.play('race', intensidad)
//  audio.engines.update(…) cada cuadro de carrera · audio.unlock() con el primer gesto del jugador

const engine = new AudioEngine();
const lastPlayed = new Map();

export const audio = {
  engine,
  music: new Music(engine),
  engines: new EngineSounds(engine),
  voices: new Voices(engine),

  unlock: () => engine.unlock(),

  /** Efecto de sonido. Un mismo efecto no se repite más de una vez cada `minGap` s (evita saturar). */
  play(name, { gain = 1, pan = 0, strength, minGap = 0.04 } = {}) {
    const fn = SFX[name];
    if (!fn || !engine.ctx || engine.ctx.state !== 'running') return;
    const t = engine.ctx.currentTime;
    if (t - (lastPlayed.get(name) ?? -1) < minGap) return;
    lastPlayed.set(name, t);
    const p = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
    fn(engine, engine.sfx, t + 0.005, { gain: Number.isFinite(gain) ? gain : 1, pan: p, strength });
  },

  /** settings.audio: { master, music, sfx } en 0..100 */
  setVolumes({ master, music, sfx }) {
    engine.setVolumes({ master: master / 100, music: music / 100, sfx: sfx / 100 });
  },

  toggleMute() {
    engine.setMuted(!engine.muted);
    return engine.muted;
  },

  setPaused: (p) => engine.setPaused(p),
};
