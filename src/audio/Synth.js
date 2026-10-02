// Instrumentos sintetizados (los usan la música y los efectos). Cada función agenda una nota en el
// tiempo `t` del contexto y libera sus nodos cuando termina. `A` es el AudioEngine; `out`, el nodo destino.

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Nota de sintetizador: osciladores (con detune en cents) → filtro (con envolvente) → amplitud ADSR.
 *  type: forma de onda · detune: [cents…] (varios = sonido gordo) · gain: pico
 *  attack / decay / sustain / release (s, nivel 0..1) · cutoff / q: filtro pasabajos
 *  filterEnv: cuánto se abre el filtro al inicio (Hz extra) · filterDecay: cuánto tarda en cerrarse
 *  glide: frecuencia desde la que se desliza · vibrato: profundidad en cents
 *  pan: -1..1 · sends: { reverb, delay } niveles de envío (los nodos los da `bus`)
 */
export function synth(A, out, t, o) {
  const ctx = A.ctx;
  const dur = o.dur ?? 0.25;
  const attack = o.attack ?? 0.005;
  const decay = o.decay ?? 0.12;
  const sustain = o.sustain ?? 0.6;
  const release = o.release ?? 0.12;
  const peak = o.gain ?? 0.2;
  const end = t + dur + release;

  const filter = ctx.createBiquadFilter();
  filter.type = o.filter ?? 'lowpass';
  filter.Q.value = o.q ?? 0.8;
  const cutoff = o.cutoff ?? 8000;
  if (o.filterEnv) {
    filter.frequency.setValueAtTime(cutoff + o.filterEnv, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoff), t + (o.filterDecay ?? 0.2));
  } else filter.frequency.setValueAtTime(cutoff, t);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + attack);
  amp.gain.setTargetAtTime(peak * sustain, t + attack, Math.max(0.005, decay / 3));
  amp.gain.setValueAtTime(peak * sustain, t + dur);
  amp.gain.setTargetAtTime(0, t + dur, Math.max(0.005, release / 4));

  let node = filter.connect(amp);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = amp.connect(p);
  }
  node.connect(out);
  if (o.sends) send(A, node, o.sends, o.bus);

  let vib = null;
  if (o.vibrato) {
    vib = ctx.createOscillator();
    vib.frequency.value = o.vibratoRate ?? 5.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(o.vibrato, t + Math.min(0.25, dur)); // el vibrato entra de a poco
    vib.connect(depth);
    vib.start(t);
    vib.stop(end);
    vib.depth = depth;
  }
  for (const cents of o.detune ?? [0]) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sawtooth';
    osc.detune.value = cents;
    if (o.glide) {
      osc.frequency.setValueAtTime(o.glide, t);
      osc.frequency.exponentialRampToValueAtTime(o.freq, t + (o.glideTime ?? 0.06));
    } else osc.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.sweepTime ?? dur));
    if (vib) vib.depth.connect(osc.detune);
    osc.connect(filter);
    osc.start(t);
    osc.stop(end + 0.05);
  }
  return amp;
}

/** Envíos a reverb / delay del bus (música o efectos). */
export function send(A, node, sends, bus = 'music') {
  const target = bus === 'sfx' ? A.sfxSends : A.musicSends;
  for (const k of ['reverb', 'delay']) {
    if (!sends[k]) continue;
    const g = A.ctx.createGain();
    g.gain.value = sends[k];
    node.connect(g).connect(target[k]);
  }
}

/** Ruido filtrado con envolvente (golpes, viento, explosiones, hats). */
export function noise(A, out, t, o) {
  const ctx = A.ctx;
  const dur = o.dur ?? 0.2;
  const src = ctx.createBufferSource();
  src.buffer = A.noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter ?? 'bandpass';
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.freq ?? 2000, t);
  if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.sweepTime ?? dur));
  const amp = ctx.createGain();
  const peak = o.gain ?? 0.3;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + (o.attack ?? 0.002));
  if (o.hold) amp.gain.setValueAtTime(peak, t + o.hold);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = src.connect(filter).connect(amp);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = node.connect(p);
  }
  node.connect(out);
  if (o.sends) send(A, node, o.sends, o.bus);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
  return amp;
}

// ------------------------------------------------------------------ batería (estilo caja de ritmos de los 80)

export function kick(A, out, t, gain = 1) {
  const ctx = A.ctx;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(155, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.11);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.4);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.95 * gain, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + 0.5);
  // Click del parche
  noise(A, out, t, { dur: 0.018, freq: 3500, q: 0.7, gain: 0.18 * gain });
}

/** Snare grande con reverb (el sonido "gated" del synthwave). */
export function snare(A, out, t, gain = 1, o = {}) {
  const ctx = A.ctx;
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(230, t);
  body.frequency.exponentialRampToValueAtTime(160, t + 0.08);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.5 * gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  body.connect(amp).connect(out);
  body.start(t);
  body.stop(t + 0.16);
  const n = noise(A, out, t, { dur: 0.22, freq: 2400, q: 0.6, filter: 'highpass', gain: 0.42 * gain });
  send(A, n, { reverb: o.reverb ?? 0.55 }, o.bus);
}

export function clap(A, out, t, gain = 1) {
  for (let i = 0; i < 3; i++) noise(A, out, t + i * 0.011, { dur: 0.03, freq: 1300, q: 1.2, gain: 0.3 * gain });
  const tail = noise(A, out, t + 0.033, { dur: 0.2, freq: 1300, q: 1, gain: 0.25 * gain });
  send(A, tail, { reverb: 0.4 });
}

export function hat(A, out, t, gain = 1, open = false) {
  noise(A, out, t, { dur: open ? 0.26 : 0.045, freq: open ? 7500 : 9000, filter: 'highpass', q: 0.5, gain: (open ? 0.16 : 0.13) * gain, pan: open ? -0.15 : 0.15 });
}

export function tom(A, out, t, freq, gain = 1) {
  const ctx = A.ctx;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.55 * gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  osc.connect(amp).connect(out);
  send(A, amp, { reverb: 0.35 });
  osc.start(t);
  osc.stop(t + 0.4);
}

/** Platillo de crash para entradas de sección. */
export function crash(A, out, t, gain = 1) {
  const n = noise(A, out, t, { dur: 1.6, freq: 6000, filter: 'highpass', q: 0.4, gain: 0.16 * gain, attack: 0.003 });
  send(A, n, { reverb: 0.3 });
}
