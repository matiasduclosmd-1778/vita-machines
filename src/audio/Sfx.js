import { synth, noise, kick, mtof } from './Synth.js';

// Efectos de sonido sintetizados, con la misma paleta que la música (ondas cuadradas y sierra,
// ruido filtrado, mucho brillo). Cada uno recibe (A, out, t, o) con o = { gain, pan, strength }.

const S = { bus: 'sfx' };
const blip = (A, out, t, freq, dur, o = {}) =>
  synth(A, out, t, { freq, dur, type: o.type ?? 'square', gain: o.gain ?? 0.12, attack: 0.002, decay: dur, sustain: 0.4, release: 0.05, cutoff: o.cutoff ?? 5000, pan: o.pan, sweepTo: o.sweepTo, sweepTime: o.sweepTime, sends: o.sends, bus: 'sfx' });
const arp = (A, out, t, notes, step, o = {}) => notes.forEach((n, i) => blip(A, out, t + i * step, mtof(n), step * 1.4, o));

export const SFX = {
  // ---------------------------------------------------------------- menús
  'ui-move': (A, out, t, o) => blip(A, out, t, 1320, 0.035, { gain: 0.05 * o.gain, type: 'triangle' }),
  'ui-select': (A, out, t, o) => arp(A, out, t, [79, 86], 0.045, { gain: 0.07 * o.gain }),
  'ui-back': (A, out, t, o) => arp(A, out, t, [79, 72], 0.045, { gain: 0.06 * o.gain }),
  'ui-confirm': (A, out, t, o) => {
    arp(A, out, t, [72, 76, 79, 84], 0.04, { gain: 0.07 * o.gain, sends: { delay: 0.25, reverb: 0.2 } });
  },
  'ui-start': (A, out, t, o) => {
    noise(A, out, t, { dur: 0.9, freq: 300, sweepTo: 6000, sweepTime: 0.85, q: 2, gain: 0.12 * o.gain, attack: 0.6, ...S, sends: { reverb: 0.3 } });
    arp(A, out, t + 0.75, [64, 71, 76, 83], 0.05, { gain: 0.08 * o.gain, type: 'sawtooth', sends: { reverb: 0.3, delay: 0.2 } });
  },

  // ---------------------------------------------------------------- carrera
  // Cuenta de largada (estilo semáforo arcade): un bip por número y uno más agudo y largo en el "¡YA!"
  count: (A, out, t, o) => {
    blip(A, out, t, 660, 0.16, { gain: 0.13 * o.gain, sends: { reverb: 0.2 } });
    blip(A, out, t, 330, 0.16, { gain: 0.06 * o.gain, type: 'sawtooth', cutoff: 1500 });
  },
  'count-go': (A, out, t, o) => {
    blip(A, out, t, 1320, 0.5, { gain: 0.13 * o.gain, type: 'sawtooth', cutoff: 5000, sends: { reverb: 0.35, delay: 0.2 } });
    blip(A, out, t, 660, 0.5, { gain: 0.08 * o.gain, sends: { reverb: 0.3 } });
    noise(A, out, t, { dur: 0.6, freq: 1200, sweepTo: 9000, sweepTime: 0.4, q: 1.2, gain: 0.08 * o.gain, ...S });
    kick(A, out, t, 0.6 * o.gain);
  },
  // Ganador de la ronda: fanfarria corta (Do mayor, como el podio) con platillo
  'round-win': (A, out, t, o) => {
    arp(A, out, t, [67, 72, 76, 79], 0.07, { gain: 0.09 * o.gain, type: 'sawtooth', cutoff: 4500, sends: { reverb: 0.3 } });
    [60, 64, 67, 72].forEach((n) => synth(A, out, t + 0.3, { freq: mtof(n), dur: 0.9, type: 'sawtooth', detune: [-9, 9], gain: 0.035 * o.gain, attack: 0.02, release: 0.5, cutoff: 3000, bus: 'sfx', sends: { reverb: 0.4 } }));
    synth(A, out, t + 0.3, { freq: mtof(84), dur: 0.8, type: 'square', gain: 0.05 * o.gain, vibrato: 18, cutoff: 4000, bus: 'sfx', sends: { delay: 0.3, reverb: 0.3 } });
    noise(A, out, t + 0.3, { dur: 1.2, freq: 6000, filter: 'highpass', q: 0.4, gain: 0.08 * o.gain, ...S });
    kick(A, out, t + 0.3, 0.6 * o.gain);
  },
  // Daño a la vida: zumbido descendente + golpe (más fuerte cuanto más daño)
  hurt: (A, out, t, o) => {
    const k = Math.min(1, (o.strength ?? 35) / 80);
    synth(A, out, t, { freq: 520, sweepTo: 110, sweepTime: 0.25, dur: 0.25, type: 'square', detune: [-20, 20], gain: (0.06 + 0.05 * k) * o.gain, cutoff: 2200, pan: o.pan, bus: 'sfx' });
    synth(A, out, t, { freq: 160, sweepTo: 55, sweepTime: 0.15, dur: 0.15, type: 'sine', gain: (0.15 + 0.15 * k) * o.gain, pan: o.pan, bus: 'sfx' });
  },
  eliminated: (A, out, t, o) => {
    synth(A, out, t, { freq: 440, sweepTo: 55, sweepTime: 0.7, dur: 0.7, type: 'sawtooth', detune: [-15, 15], gain: 0.12 * o.gain, cutoff: 1800, pan: o.pan, release: 0.1, bus: 'sfx', sends: { reverb: 0.3 } });
    noise(A, out, t, { dur: 0.5, freq: 400, q: 0.8, gain: 0.12 * o.gain, pan: o.pan, ...S });
  },

  // ---------------------------------------------------------------- objetos
  pickup: (A, out, t, o) => arp(A, out, t, [72, 76, 79, 84, 88], 0.035, { gain: 0.08 * o.gain, pan: o.pan, sends: { delay: 0.2 } }),
  'use-TURBO': (A, out, t, o) => {
    noise(A, out, t, { dur: 0.9, freq: 400, sweepTo: 3500, sweepTime: 0.25, q: 2.5, gain: 0.25 * o.gain, pan: o.pan, ...S });
    synth(A, out, t, { freq: 110, sweepTo: 330, sweepTime: 0.3, dur: 0.5, type: 'sawtooth', gain: 0.1 * o.gain, cutoff: 1500, pan: o.pan, release: 0.2, bus: 'sfx' });
  },
  'use-BOMB': (A, out, t, o) => {
    synth(A, out, t, { freq: 180, sweepTo: 70, sweepTime: 0.12, dur: 0.12, type: 'square', gain: 0.14 * o.gain, cutoff: 900, pan: o.pan, bus: 'sfx' });
    noise(A, out, t + 0.08, { dur: 0.35, freq: 5000, filter: 'highpass', gain: 0.05 * o.gain, pan: o.pan, ...S }); // mecha
  },
  'use-MISSILE': (A, out, t, o) => {
    noise(A, out, t, { dur: 0.7, freq: 900, sweepTo: 2500, q: 1, gain: 0.22 * o.gain, attack: 0.01, pan: o.pan, ...S });
    synth(A, out, t, { freq: 300, sweepTo: 1400, sweepTime: 0.6, dur: 0.6, type: 'sawtooth', gain: 0.06 * o.gain, cutoff: 3000, pan: o.pan, bus: 'sfx', sends: { delay: 0.25 } });
  },
  'use-OIL': (A, out, t, o) => {
    noise(A, out, t, { dur: 0.25, freq: 600, sweepTo: 150, q: 3, gain: 0.25 * o.gain, pan: o.pan, ...S });
    synth(A, out, t, { freq: 320, sweepTo: 90, sweepTime: 0.2, dur: 0.2, type: 'sine', gain: 0.14 * o.gain, pan: o.pan, bus: 'sfx' });
  },
  'use-MAGNET': (A, out, t, o) =>
    synth(A, out, t, { freq: 220, sweepTo: 660, sweepTime: 0.6, dur: 0.6, type: 'square', gain: 0.07 * o.gain, cutoff: 1600, q: 6, vibrato: 60, vibratoRate: 14, pan: o.pan, bus: 'sfx', sends: { reverb: 0.2 } }),
  // Disparo: golpe corto de ruido + "pew" que cae (suena bien en ráfaga)
  'use-GUN': (A, out, t, o) => {
    noise(A, out, t, { dur: 0.07, freq: 2600, q: 1.2, gain: 0.16 * o.gain, pan: o.pan, ...S });
    synth(A, out, t, { freq: 950, sweepTo: 180, sweepTime: 0.07, dur: 0.07, type: 'square', gain: 0.05 * o.gain, cutoff: 3500, pan: o.pan, bus: 'sfx' });
    synth(A, out, t, { freq: 120, sweepTo: 60, sweepTime: 0.05, dur: 0.05, type: 'sine', gain: 0.12 * o.gain, pan: o.pan, bus: 'sfx' });
  },
  // Lanzallamas: soplido de ruido grave y áspero (suena 20 veces por segundo: corto y suave)
  'use-FLAME': (A, out, t, o) => {
    noise(A, out, t, { dur: 0.09, freq: 700, q: 0.7, gain: 0.09 * o.gain, attack: 0.01, pan: o.pan, ...S });
    noise(A, out, t, { dur: 0.06, freq: 3200, filter: 'highpass', gain: 0.025 * o.gain, pan: o.pan, ...S });
  },
  // Se prende fuego un auto: "fwoosh" que sube
  burn: (A, out, t, o) => {
    noise(A, out, t, { dur: 0.45, freq: 400, sweepTo: 2200, sweepTime: 0.3, q: 1.2, gain: 0.16 * o.gain, attack: 0.02, pan: o.pan, ...S, sends: { reverb: 0.15 } });
    synth(A, out, t, { freq: 160, sweepTo: 90, sweepTime: 0.3, dur: 0.3, type: 'sawtooth', gain: 0.04 * o.gain, cutoff: 800, pan: o.pan, bus: 'sfx' });
  },
  'bullet-hit': (A, out, t, o) => {
    synth(A, out, t, { freq: 2200, dur: 0.05, type: 'triangle', gain: 0.06 * o.gain, release: 0.06, pan: o.pan, bus: 'sfx' });
    noise(A, out, t, { dur: 0.06, freq: 4000, q: 2, gain: 0.07 * o.gain, pan: o.pan, ...S });
  },
  'use-SHIELD': (A, out, t, o) => {
    [72, 79, 84, 91].forEach((n, i) => synth(A, out, t + i * 0.03, { freq: mtof(n), dur: 0.5, type: 'triangle', detune: [-8, 8], gain: 0.045 * o.gain, attack: 0.02, release: 0.4, pan: o.pan, bus: 'sfx', sends: { reverb: 0.4 } }));
  },
  // Corazón de vida: arpegio mayor que sube, con brillo
  'use-HEART': (A, out, t, o) => {
    arp(A, out, t, [72, 76, 79, 84, 88, 91], 0.05, { gain: 0.07 * o.gain, type: 'triangle', pan: o.pan, sends: { reverb: 0.35, delay: 0.2 } });
    [76, 79, 84].forEach((n) => synth(A, out, t + 0.28, { freq: mtof(n), dur: 0.6, type: 'sine', gain: 0.05 * o.gain, attack: 0.05, release: 0.5, pan: o.pan, bus: 'sfx', sends: { reverb: 0.4 } }));
    noise(A, out, t, { dur: 0.7, freq: 5000, sweepTo: 10000, filter: 'highpass', q: 0.5, gain: 0.04 * o.gain, pan: o.pan, ...S });
  },
  'shield-hit': (A, out, t, o) => {
    synth(A, out, t, { freq: 1760, dur: 0.25, type: 'sine', gain: 0.1 * o.gain, release: 0.3, pan: o.pan, bus: 'sfx', sends: { reverb: 0.4 } });
    synth(A, out, t, { freq: 2490, dur: 0.18, type: 'sine', gain: 0.06 * o.gain, release: 0.2, pan: o.pan, bus: 'sfx' });
  },
  slip: (A, out, t, o) =>
    synth(A, out, t, { freq: 700, sweepTo: 250, sweepTime: 0.5, dur: 0.5, type: 'triangle', gain: 0.08 * o.gain, vibrato: 80, vibratoRate: 9, pan: o.pan, bus: 'sfx' }),
  explosion: (A, out, t, o) => {
    const g = Math.min(1.4, o.strength ?? 1) * o.gain;
    noise(A, out, t, { dur: 1.1, freq: 3000, sweepTo: 120, sweepTime: 0.9, filter: 'lowpass', q: 0.8, gain: 0.26 * g, pan: o.pan, ...S, sends: { reverb: 0.25 } });
    synth(A, out, t, { freq: 90, sweepTo: 28, sweepTime: 0.6, dur: 0.6, type: 'sine', gain: 0.2 * g, sustain: 0.8, release: 0.2, pan: o.pan, bus: 'sfx' });
    kick(A, out, t, 0.35 * g);
  },

  // ---------------------------------------------------------------- golpes y movimiento
  crash: (A, out, t, o) => {
    const k = Math.min(1, (o.strength ?? 6) / 14);
    noise(A, out, t, { dur: 0.18 + k * 0.15, freq: 900, q: 0.9, gain: (0.12 + k * 0.25) * o.gain, pan: o.pan, ...S });
    synth(A, out, t, { freq: 140, sweepTo: 60, sweepTime: 0.12, dur: 0.12, type: 'sine', gain: (0.15 + k * 0.3) * o.gain, pan: o.pan, bus: 'sfx' });
    // Chapa: dos parciales inarmónicos
    synth(A, out, t, { freq: 523, dur: 0.12, type: 'square', gain: 0.03 * k * o.gain, cutoff: 3000, release: 0.15, pan: o.pan, bus: 'sfx' });
    synth(A, out, t, { freq: 787, dur: 0.1, type: 'square', gain: 0.025 * k * o.gain, cutoff: 3000, release: 0.12, pan: o.pan, bus: 'sfx' });
  },
  wall: (A, out, t, o) => {
    const k = Math.min(1, (o.strength ?? 5) / 14);
    noise(A, out, t, { dur: 0.15, freq: 500, q: 0.8, gain: (0.08 + 0.2 * k) * o.gain, pan: o.pan, ...S });
    synth(A, out, t, { freq: 110, sweepTo: 50, sweepTime: 0.1, dur: 0.1, type: 'sine', gain: (0.1 + 0.25 * k) * o.gain, pan: o.pan, bus: 'sfx' });
  },
  jump: (A, out, t, o) => {
    synth(A, out, t, { freq: 220, sweepTo: 880, sweepTime: 0.18, dur: 0.2, type: 'square', gain: 0.07 * o.gain, cutoff: 3000, pan: o.pan, bus: 'sfx', sends: { delay: 0.15 } });
    noise(A, out, t, { dur: 0.2, freq: 1500, sweepTo: 4000, q: 1.5, gain: 0.06 * o.gain, pan: o.pan, ...S });
  },
  land: (A, out, t, o) => {
    const k = Math.min(1, (o.strength ?? 6) / 18);
    synth(A, out, t, { freq: 120, sweepTo: 45, sweepTime: 0.1, dur: 0.1, type: 'sine', gain: (0.12 + 0.25 * k) * o.gain, pan: o.pan, bus: 'sfx' });
    noise(A, out, t, { dur: 0.12, freq: 400, q: 0.7, gain: (0.06 + 0.12 * k) * o.gain, pan: o.pan, ...S });
  },
  spinout: (A, out, t, o) => {
    synth(A, out, t, { freq: 900, sweepTo: 200, sweepTime: 0.8, dur: 0.8, type: 'sawtooth', gain: 0.06 * o.gain, cutoff: 2200, vibrato: 120, vibratoRate: 11, pan: o.pan, bus: 'sfx' });
    noise(A, out, t, { dur: 0.8, freq: 2500, q: 4, gain: 0.08 * o.gain, pan: o.pan, ...S }); // chirrido de goma
  },
  fall: (A, out, t, o) =>
    synth(A, out, t, { freq: 1400, sweepTo: 180, sweepTime: 1, dur: 1, type: 'triangle', gain: 0.08 * o.gain, vibrato: 25, vibratoRate: 7, pan: o.pan, bus: 'sfx', sends: { reverb: 0.3 } }),
  respawn: (A, out, t, o) => arp(A, out, t, [67, 74, 79, 86], 0.04, { gain: 0.05 * o.gain, type: 'triangle', pan: o.pan, sends: { reverb: 0.3 } }),
  stun: (A, out, t, o) => [88, 84, 88, 84].forEach((n, i) => blip(A, out, t + 0.2 + i * 0.09, mtof(n), 0.06, { gain: 0.09 * o.gain, type: 'triangle', pan: o.pan })),
};

/**
 * Motores: un sonido continuo por auto. La "vuelta" (rpm) sale de la velocidad con cambios simulados
 * (sube dentro de cada marcha y cae al pasar a la siguiente); la carga (acelerar) abre el filtro.
 * La moto suena más aguda y áspera. También hay chirrido de gomas al derrapar.
 */
export class EngineSounds {
  constructor(A) {
    this.A = A;
    this.voices = new Map(); // car → voz
  }

  voiceFor(car) {
    let v = this.voices.get(car);
    if (v) return v;
    const ctx = this.A.ctx;
    const moto = !!car.lean;
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    out.connect(pan).connect(this.A.sfx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = moto ? 5 : 3;
    filter.connect(out);
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = moto ? 'square' : 'sawtooth';
    const bGain = ctx.createGain();
    bGain.gain.value = moto ? 0.5 : 0.7;
    a.connect(filter);
    b.connect(bGain).connect(filter);
    // Traqueteo de los cilindros: modulación de amplitud a la frecuencia de encendido
    const am = ctx.createOscillator();
    am.type = 'square';
    const amDepth = ctx.createGain();
    amDepth.gain.value = moto ? 0.35 : 0.2;
    am.connect(amDepth).connect(out.gain);
    // Gomas: ruido filtrado, solo cuando derrapa
    const tire = ctx.createBufferSource();
    tire.buffer = this.A.noise;
    tire.loop = true;
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 2200;
    tireFilter.Q.value = 3;
    const tireGain = ctx.createGain();
    tireGain.gain.value = 0;
    tire.connect(tireFilter).connect(tireGain).connect(pan);
    const t = ctx.currentTime;
    for (const o of [a, b, am, tire]) o.start(t);
    v = { out, pan, filter, a, b, am, amDepth, tire, tireGain, moto, rpm: 0.2, speed: 0 };
    this.voices.set(car, v);
    return v;
  }

  /** Cada cuadro: cars = autos de la carrera, panOf(car) → -1..1, loud(car) → volumen (personas > CPU). */
  update(dt, cars, panOf, loud) {
    if (!this.A.ctx) return;
    const t = this.A.ctx.currentTime;
    for (const [car, v] of this.voices) if (!cars.includes(car)) this.release(car, v);
    for (const car of cars) {
      const v = this.voiceFor(car);
      const speed = Math.abs(car.forwardSpeed ?? 0);
      const accel = (speed - v.speed) / Math.max(dt, 1e-3);
      v.speed = speed;
      const ratio = Math.min(1.2, speed / 30);
      // Cambios: 4 marchas; dentro de cada una las rpm van de 0.35 a 1
      const gears = 4;
      const g = Math.min(gears - 1, Math.floor(ratio * gears));
      const inGear = ratio * gears - g;
      // En la largada, acelerar quieto hace rugir el motor (car.rev)
      const rev = speed < 1 ? (car.rev ?? 0) : 0;
      const target = speed < 0.5 ? 0.18 + 0.75 * rev : 0.35 + 0.65 * inGear;
      v.rpm += (target - v.rpm) * Math.min(1, dt * 10);
      const load = Math.max(rev, Math.min(1, accel / 25 + (speed > 1 ? 0.25 : 0)));
      const base = v.moto ? 70 : 42;
      const f = base * (1 + v.rpm * 1.8 + g * 0.18);
      v.a.frequency.setTargetAtTime(f, t, 0.03);
      v.b.frequency.setTargetAtTime(f * (v.moto ? 1.5 : 0.5), t, 0.03);
      v.am.frequency.setTargetAtTime(f * (v.moto ? 0.5 : 0.25), t, 0.03);
      v.filter.frequency.setTargetAtTime(300 + v.rpm * 900 + load * 1200 + (v.moto ? 500 : 0), t, 0.05);
      const alive = car.alive !== false && !car.fall;
      const vol = alive ? loud(car) * (0.45 + 0.35 * v.rpm + 0.2 * load) : 0;
      v.out.gain.setTargetAtTime(vol * 0.11, t, 0.08);
      v.amDepth.gain.setTargetAtTime(vol * 0.11 * (v.moto ? 0.35 : 0.2), t, 0.08);
      const p = panOf(car);
      if (Number.isFinite(p)) v.pan.pan.setTargetAtTime(p, t, 0.05);
      // Derrape: velocidad lateral (lo que no va hacia el frente)
      const vx = car.velocity?.x ?? 0;
      const vz = car.velocity?.z ?? 0;
      const lateral = Math.abs(vx * Math.cos(car.heading) - vz * Math.sin(car.heading));
      const skid = alive && car.grounded !== false ? Math.max(0, Math.min(1, (lateral - 4) / 8)) : 0;
      v.tireGain.gain.setTargetAtTime(skid * loud(car) * 0.07, t, 0.06);
    }
  }

  release(car, v) {
    const t = this.A.ctx.currentTime;
    v.out.gain.setTargetAtTime(0, t, 0.1);
    v.tireGain.gain.setTargetAtTime(0, t, 0.1);
    for (const o of [v.a, v.b, v.am, v.tire]) o.stop(t + 0.6);
    this.voices.delete(car);
  }

  /** Silencia todos (menú, fin de carrera). */
  stopAll() {
    if (!this.A.ctx) return;
    for (const [car, v] of this.voices) this.release(car, v);
  }
}
