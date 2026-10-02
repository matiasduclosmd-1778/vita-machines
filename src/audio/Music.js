import { synth, kick, snare, clap, hat, tom, crash, mtof } from './Synth.js';

// Música synthwave generada en vivo: un secuenciador de semicorcheas (16 pasos por compás) agenda
// las notas un poco antes de que suenen (lookahead), así el tempo no depende de los cuadros del juego.
//
//  menu    118 BPM · La menor · pads, bajo de octavas con "bombeo", arpegio con delay. Con intensidad
//          (elegir piloto) entra la batería completa y la melodía.
//  race    138 BPM · Mi menor · bajo en semicorcheas, arpegio rápido, estribillo con lead. En la
//          última vuelta (intensidad 1) el lead no para, se abren los filtros y suma percusión.
//  victory fanfarria (♭VI – ♭VII – I) que desemboca en `podium`.
//  podium  112 BPM · Do mayor · loop alegre y liviano para el podio.

const LOOKAHEAD = 0.15; // segundos que se agendan por adelantado
// Con la pestaña oculta el navegador frena los temporizadores (hasta 1 por segundo): se agenda más
// adelante para que la música no se corte
const LOOKAHEAD_HIDDEN = 1.6;
const LEVEL = 0.6; // nivel de cada canción: deja lugar para que los efectos se escuchen encima
const TICK_MS = 25;

// Acordes: notas MIDI del pad y raíz del bajo
const CH = {
  Am: { pad: [57, 60, 64, 69], root: 33 },
  F: { pad: [53, 57, 60, 65], root: 29 },
  C: { pad: [55, 60, 64, 67], root: 36 },
  G: { pad: [55, 59, 62, 67], root: 31 },
  E: { pad: [56, 59, 64, 68], root: 28 },
  Em: { pad: [52, 55, 59, 64], root: 28 },
  Cr: { pad: [52, 55, 60, 64], root: 24 },
  D: { pad: [50, 54, 57, 62], root: 26 },
  B: { pad: [51, 54, 59, 63], root: 23 },
  Gr: { pad: [50, 55, 59, 62], root: 31 },
  Cp: { pad: [60, 64, 67, 72], root: 36 },
  Gp: { pad: [59, 62, 67, 71], root: 31 },
  Amp: { pad: [57, 60, 64, 69], root: 33 },
  Fp: { pad: [57, 60, 65, 69], root: 29 },
};

// Melodías: por compás, [paso, duración en pasos, nota MIDI]
const MENU_LEAD = [
  [[0, 6, 76], [6, 2, 74], [8, 4, 72], [12, 4, 69]],
  [[0, 6, 72], [6, 2, 69], [8, 2, 72], [10, 6, 74]],
  [[0, 8, 76], [8, 4, 79], [12, 4, 76]],
  [[0, 12, 74], [12, 4, 71]],
  [[0, 4, 76], [4, 4, 81], [8, 4, 79], [12, 4, 76]],
  [[0, 6, 77], [6, 2, 76], [8, 8, 72]],
  [[0, 4, 79], [4, 4, 76], [8, 4, 72], [12, 4, 76]],
  [[0, 8, 71], [8, 8, 68]],
];
const RACE_LEAD = [
  [[0, 2, 71], [2, 2, 76], [4, 4, 79], [8, 2, 78], [10, 2, 76], [12, 4, 78]],
  [[0, 4, 79], [4, 4, 81], [8, 4, 79], [12, 4, 76]],
  [[0, 4, 74], [4, 4, 79], [8, 8, 83]],
  [[0, 6, 81], [6, 2, 78], [8, 8, 74]],
  [[0, 2, 71], [2, 2, 76], [4, 4, 79], [8, 4, 83], [12, 4, 81]],
  [[0, 4, 79], [4, 4, 76], [8, 4, 79], [12, 4, 81]],
  [[0, 8, 83], [8, 4, 81], [12, 4, 78]],
  [[0, 8, 75], [8, 4, 78], [12, 4, 83]],
];
const PODIUM_BELLS = [
  [[0, 2, 84], [2, 2, 79], [4, 2, 76], [6, 2, 79], [8, 4, 84], [12, 4, 86]],
  [[0, 2, 83], [2, 2, 79], [4, 2, 74], [6, 2, 79], [8, 8, 83]],
  [[0, 2, 84], [2, 2, 81], [4, 2, 76], [6, 2, 81], [8, 4, 84], [12, 4, 88]],
  [[0, 4, 89], [4, 4, 88], [8, 8, 84]],
];

// Arpegio sobre un acorde: índices de sus notas (+12 = octava arriba)
const ARP_UP = [0, 1, 2, 3, 2 + 12, 3, 2, 1, 0, 1, 2, 3, 2 + 12, 3 + 12, 2 + 12, 3];
const ARP_RACE = [0, 2, 1, 3, 0 + 12, 2, 3, 1 + 12, 0, 2, 1, 3, 2 + 12, 3, 1 + 12, 3 + 12];
const arpNote = (pad, i) => pad[i % 12 % pad.length] + (i >= 12 ? 12 : 0);

// ------------------------------------------------------------------ instrumentos de la banda

const pad = (e, chord, bars = 1, o = {}) => {
  for (const n of chord.pad)
    synth(e.A, e.pump, e.t, {
      freq: mtof(n), dur: e.beat * 4 * bars - 0.05, type: 'sawtooth', detune: [-9, 0, 9], gain: o.gain ?? 0.032,
      attack: o.attack ?? 0.35, decay: 0.6, sustain: 0.85, release: 0.7, cutoff: o.cutoff ?? 1500, q: 0.6, sends: { reverb: 0.3 },
    });
};

const bass = (e, midi, len = 1, o = {}) =>
  synth(e.A, e.pump, e.t, {
    freq: mtof(midi), dur: e.stepDur * len * 0.85, type: 'sawtooth', detune: [0, 7], gain: o.gain ?? 0.16,
    attack: 0.003, decay: 0.12, sustain: 0.35, release: 0.05, cutoff: o.cutoff ?? 260, filterEnv: o.env ?? 900, filterDecay: 0.12, q: 4,
  });

const sub = (e, midi, len) =>
  synth(e.A, e.pump, e.t, { freq: mtof(midi - 12), dur: e.stepDur * len, type: 'sine', gain: 0.12, attack: 0.004, sustain: 0.9, release: 0.06 });

const pluck = (e, midi, o = {}) =>
  synth(e.A, e.lead, e.t, {
    freq: mtof(midi), dur: e.stepDur * 0.6, type: o.type ?? 'square', gain: o.gain ?? 0.035, attack: 0.002, decay: 0.09, sustain: 0.2,
    release: 0.08, cutoff: o.cutoff ?? 2600, filterEnv: 2500, filterDecay: 0.08, pan: o.pan ?? 0, sends: { delay: o.delay ?? 0.4, reverb: 0.15 },
  });

const lead = (e, midi, steps, o = {}) =>
  synth(e.A, e.lead, e.t, {
    freq: mtof(midi), dur: e.stepDur * steps - 0.02, type: 'sawtooth', detune: [-7, 7], gain: o.gain ?? 0.055,
    attack: 0.015, decay: 0.2, sustain: 0.75, release: 0.18, cutoff: o.cutoff ?? 2800, filterEnv: 1500, filterDecay: 0.3,
    vibrato: steps >= 4 ? 14 : 0, vibratoRate: 5.8, glide: o.glide, glideTime: 0.05, sends: { reverb: 0.3, delay: 0.3 },
  });

const bell = (e, midi, steps) =>
  synth(e.A, e.lead, e.t, {
    freq: mtof(midi), dur: e.stepDur * steps * 0.5, type: 'triangle', gain: 0.07, attack: 0.002, decay: 0.3, sustain: 0.15, release: 0.4,
    cutoff: 6000, sends: { reverb: 0.35, delay: 0.25 },
  });

/** Bombeo: el pad y el bajo se agachan con cada bombo (sidechain). */
const pump = (e, depth = 0.55) => {
  const g = e.pump.gain;
  g.cancelScheduledValues(e.t);
  g.setValueAtTime(1 - depth, e.t);
  g.linearRampToValueAtTime(1, e.t + e.beat * 0.55);
};

const melody = (e, bars, bar, fn) => {
  for (const [at, len, n] of bars[bar % bars.length]) if (at === e.s) fn(n, len);
};

// ------------------------------------------------------------------ canciones

export const SONGS = {
  menu: {
    bpm: 118,
    bars: 8,
    delayBeats: 0.75,
    step(e) {
      const prog = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E'];
      const chord = CH[prog[e.bar % 8]];
      const full = e.intensity >= 0.5;
      if (e.s === 0) pad(e, chord, 1, { cutoff: full ? 2000 : 1300 });
      // Bajo de octavas en corcheas
      if (e.s % 2 === 0) bass(e, chord.root + 12 + (e.s % 4 === 2 ? 12 : 0), 2, { cutoff: full ? 320 : 240 });
      if (e.s % 8 === 0) sub(e, chord.root + 12, 8);
      // Arpegio: siempre; más presente con intensidad
      pluck(e, arpNote(chord.pad, ARP_UP[e.s]) + 12, { gain: full ? 0.03 : 0.022, pan: e.s % 2 ? 0.25 : -0.25 });
      // Batería: tranquila (medio tiempo) o completa
      if (full ? e.s % 4 === 0 : e.s === 0 || e.s === 10) {
        kick(e.A, e.drums, e.t, full ? 0.9 : 0.7);
        pump(e, full ? 0.55 : 0.4);
      }
      if (e.s === 4 || e.s === 12) {
        if (full || e.s === 12) snare(e.A, e.drums, e.t, full ? 0.8 : 0.6);
        if (full) clap(e.A, e.drums, e.t, 0.4);
      }
      if (e.s % 2 === 0) hat(e.A, e.drums, e.t, full ? (e.s % 4 ? 0.9 : 0.5) : 0.45);
      if (full && e.s % 4 === 2) hat(e.A, e.drums, e.t, 0.5, true);
      if (full && e.bar % 8 === 0 && e.s === 0) crash(e.A, e.drums, e.t, 0.7);
      if (full) melody(e, MENU_LEAD, e.bar, (n, len) => lead(e, n, len, { gain: 0.045 }));
    },
  },

  race: {
    bpm: 138,
    bars: 16,
    delayBeats: 0.75,
    step(e) {
      const prog = ['Em', 'Cr', 'D', 'B', 'Em', 'Cr', 'Gr', 'D', 'Em', 'Cr', 'Gr', 'D', 'Em', 'Cr', 'D', 'B'];
      const bar = e.bar % 16;
      const chorus = bar >= 8 || e.intensity >= 1;
      const hot = e.intensity >= 1;
      const chord = CH[prog[bar]];
      if (e.s === 0) pad(e, chord, 1, { cutoff: hot ? 2600 : chorus ? 2100 : 1500, gain: 0.03 });
      // Bajo galopante en semicorcheas (octava arriba en la última de cada tiempo)
      bass(e, chord.root + 12 + (e.s % 4 === 3 ? 12 : 0), 1, { cutoff: hot ? 420 : 300, env: hot ? 1400 : 1000, gain: 0.14 });
      if (e.s % 8 === 0) sub(e, chord.root + 12, 8);
      pluck(e, arpNote(chord.pad, ARP_RACE[e.s]) + 12, { gain: chorus ? 0.026 : 0.032, type: e.s % 2 ? 'square' : 'sawtooth', cutoff: hot ? 4200 : 3000, pan: e.s % 2 ? 0.3 : -0.3 });
      // Batería
      const fill = bar % 8 === 7 && e.s >= 12;
      if (e.s % 4 === 0) {
        kick(e.A, e.drums, e.t, 1);
        pump(e, 0.6);
      }
      if ((e.s === 4 || e.s === 12) && !fill) {
        snare(e.A, e.drums, e.t, 0.85);
        clap(e.A, e.drums, e.t, chorus ? 0.5 : 0.3);
      }
      if (fill) {
        if (e.s % 2 === 0) tom(e.A, e.drums, e.t, [196, 165, 130, 98][(e.s - 12) / 2 | 0] ?? 98, 0.7);
        snare(e.A, e.drums, e.t, 0.35 + (e.s - 12) * 0.12, { reverb: 0.3 });
      }
      hat(e.A, e.drums, e.t, e.s % 2 ? 0.45 : 0.85);
      if (chorus && e.s % 4 === 2) hat(e.A, e.drums, e.t, 0.55, true);
      if (bar % 8 === 0 && e.s === 0) crash(e.A, e.drums, e.t, 0.8);
      if (chorus) melody(e, RACE_LEAD, bar, (n, len) => lead(e, n, len, { gain: hot ? 0.06 : 0.05, cutoff: hot ? 3600 : 2800 }));
    },
  },

  victory: {
    bpm: 120,
    bars: 3,
    once: true,
    next: 'podium',
    delayBeats: 0.5,
    step(e) {
      const at = e.bar * 16 + e.s;
      const brass = (notes, steps, g = 0.045) =>
        notes.forEach((n) =>
          synth(e.A, e.lead, e.t, {
            freq: mtof(n), dur: e.stepDur * steps, type: 'sawtooth', detune: [-10, 0, 10], gain: g, attack: 0.02, decay: 0.3, sustain: 0.8,
            release: 0.5, cutoff: 3200, filterEnv: 2500, filterDecay: 0.25, sends: { reverb: 0.4 },
          }),
        );
      // Subida rápida
      [[0, 67], [1, 72], [2, 76], [3, 79]].forEach(([s, n]) => at === s && lead(e, n, 1, { gain: 0.06, cutoff: 4000 }));
      if (at === 4) { brass([56, 60, 63, 68], 4); lead(e, 75, 4, { gain: 0.06 }); kick(e.A, e.drums, e.t); snare(e.A, e.drums, e.t, 0.7); }
      if (at === 8) { brass([58, 62, 65, 70], 4); lead(e, 77, 4, { gain: 0.06 }); kick(e.A, e.drums, e.t); snare(e.A, e.drums, e.t, 0.8); }
      if (at === 12) {
        brass([60, 64, 67, 72], 24, 0.05);
        lead(e, 79, 4, { gain: 0.06 });
        kick(e.A, e.drums, e.t);
        crash(e.A, e.drums, e.t, 1);
        snare(e.A, e.drums, e.t, 0.9);
        bass(e, 36, 24, { cutoff: 500, gain: 0.15 });
      }
      if (at === 16) lead(e, 84, 20, { gain: 0.06, cutoff: 3600 });
      if (at >= 12 && at < 36 && at % 2 === 0) pluck(e, [72, 76, 79, 84][(at / 2) % 4], { gain: 0.022 });
    },
  },

  podium: {
    bpm: 112,
    bars: 4,
    delayBeats: 0.75,
    step(e) {
      const chord = CH[['Cp', 'Gp', 'Amp', 'Fp'][e.bar % 4]];
      if (e.s === 0) pad(e, chord, 1, { cutoff: 2200, gain: 0.026, attack: 0.15 });
      if (e.s % 2 === 0) bass(e, chord.root + 12 + (e.s % 4 === 2 ? 12 : 0), 2, { cutoff: 380, gain: 0.12 });
      if (e.s % 4 === 0) {
        kick(e.A, e.drums, e.t, 0.75);
        pump(e, 0.4);
      }
      if (e.s === 4 || e.s === 12) clap(e.A, e.drums, e.t, 0.5);
      if (e.s % 2 === 1) hat(e.A, e.drums, e.t, 0.5);
      melody(e, PODIUM_BELLS, e.bar, (n, len) => bell(e, n, len));
      if (e.s % 4 === 2) pluck(e, arpNote(chord.pad, ARP_UP[e.s]) + 12, { gain: 0.018, type: 'triangle' });
    },
  },
};

/** Reproductor: una canción a la vez, con fundido entre canciones. */
export class Music {
  constructor(A) {
    this.A = A;
    this.playing = []; // canciones sonando (la anterior queda hasta terminar su fundido)
    this.name = null;
    this.intensity = 0;
    this.timer = null;
  }

  /** Cambia de canción (si ya suena, solo actualiza la intensidad). */
  play(name, intensity = this.intensity) {
    this.intensity = intensity;
    if (name === this.name) return;
    this.name = name;
    this.A.whenReady(() => this.start(name));
  }

  setIntensity(x) {
    this.intensity = x;
  }

  stop() {
    this.name = null;
    this.A.whenReady(() => this.fadeOutAll(0.8));
  }

  start(name) {
    if (name !== this.name) return; // se pidió otra mientras tanto
    const A = this.A;
    const def = SONGS[name];
    this.fadeOutAll(0.9);
    if (!def) return;
    const ctx = A.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 0.4);
    out.connect(A.music);
    const bus = (g) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(out);
      return n;
    };
    const beat = 60 / def.bpm;
    A.setDelayTime(beat * (def.delayBeats ?? 0.75));
    this.playing.push({
      name, def, out, beat, stepDur: beat / 4, step: 0, next: ctx.currentTime + 0.06, alive: true,
      drums: bus(0.9), pump: bus(1), lead: bus(1),
    });
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  fadeOutAll(seconds) {
    const t = this.A.ctx.currentTime;
    for (const song of this.playing) {
      if (!song.alive) continue;
      song.alive = false;
      song.out.gain.cancelScheduledValues(t);
      song.out.gain.setValueAtTime(song.out.gain.value, t);
      song.out.gain.linearRampToValueAtTime(0, t + seconds);
      song.endAt = t + seconds;
      setTimeout(() => song.out.disconnect(), seconds * 1000 + 3000);
    }
  }

  tick() {
    const A = this.A;
    const now = A.ctx.currentTime;
    for (const song of [...this.playing]) {
      if (!song.alive && now > song.endAt) {
        this.playing.splice(this.playing.indexOf(song), 1);
        continue;
      }
      // Si se atrasó igual, no se intenta "ponerse al día" tocando todo junto
      if (song.next < now - 0.2) song.next = now + 0.02;
      const ahead = document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
      while (song.next < now + ahead) {
        const def = song.def;
        const total = def.bars * 16;
        if (def.once && song.step >= total) {
          if (song.alive && this.name === song.name && def.next) {
            this.name = def.next;
            this.start(def.next);
          }
          break;
        }
        const i = song.step % total;
        def.step({
          A, t: song.next, s: i % 16, bar: Math.floor(i / 16), beat: song.beat, stepDur: song.stepDur,
          intensity: this.intensity, drums: song.drums, pump: song.pump, lead: song.lead,
        });
        song.step++;
        song.next += song.stepDur;
      }
    }
    if (!this.playing.length) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
