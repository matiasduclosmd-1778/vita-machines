// Motor de audio: todo se sintetiza en vivo con Web Audio (sin archivos).
//
//  master ─┬─ música  (music) ──┐
//          └─ efectos (sfx) ────┴─ compresor → limitador → salida
//  Cada bus tiene envíos de reverb (convolución con impulso generado) y delay (el de la música,
//  sincronizado al tempo).
//
// El navegador no deja sonar nada hasta que el jugador interactúa: el contexto se crea con la
// primera tecla, clic o botón del joystick (unlock), y lo que se pidió antes arranca en ese momento.

// Ganancia de compensación del bus master (+6 dB): con los volúmenes por defecto el juego queda a un
// nivel parecido al de otros juegos; los picos los contiene el limitador
const MAKEUP = 2;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, music: 0.7, sfx: 0.8 };
    this.muted = false;
    this.onUnlock = [];
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Crea (o reanuda) el contexto. Llamar desde un gesto del usuario. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.ready || this.ctx.state !== 'closed') {
      const fns = this.onUnlock;
      this.onUnlock = [];
      fns.forEach((fn) => fn());
    }
  }

  /** Ejecuta fn cuando haya audio (enseguida si ya lo hay). */
  whenReady(fn) {
    if (this.ctx) fn();
    else this.onUnlock.push(fn);
  }

  build() {
    const ctx = this.ctx;
    // Cadena final: compresor suave que "pega" la mezcla + limitador que evita picos
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.2;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    this.master = ctx.createGain();
    this.master.connect(this.comp).connect(this.limiter).connect(ctx.destination);

    this.music = ctx.createGain();
    // La música baja mientras habla el locutor (ver duckMusic)
    this.duck = ctx.createGain();
    // Filtro de la música: se cierra en pausa (suena "detrás de una puerta")
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.music.connect(this.duck).connect(this.musicFilter).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    // Cada bus tiene su reverb (sala grande y brillante, la del snare de los 80) y su delay con eco
    // filtrado: así el volumen de música o de efectos incluye sus colas
    this.ir = impulse(ctx, 2.6, 2.4);
    this.musicSends = this.fxChain(this.music, 0.9, 0.55);
    this.sfxSends = this.fxChain(this.sfx, 0.7, 0.4);

    this.noise = noiseBuffer(ctx, 2);
    this.applyVolumes();
  }

  /** Reverb + delay que terminan en `bus`. Devuelve los envíos { reverb, delay } (nodos de entrada). */
  fxChain(bus, reverbLevel, delayLevel) {
    const ctx = this.ctx;
    const reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this.ir;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = reverbLevel;
    reverbIn.connect(conv).connect(reverbOut).connect(bus);

    const delayIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    delayIn.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = delayLevel;
    tone.connect(delayOut).connect(bus);
    return { reverb: reverbIn, delay: delayIn, delayNode: delay };
  }

  setDelayTime(seconds) {
    if (!this.ctx) return;
    this.musicSends.delayNode.delayTime.setTargetAtTime(Math.min(1.9, seconds), this.ctx.currentTime, 0.05);
  }

  /** volumes: { master, music, sfx } en 0..1 */
  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.volumes;
    // Curva perceptual: el control lineal del menú se siente parejo
    const curve = (x) => x * x;
    this.master.gain.setTargetAtTime(this.muted ? 0 : curve(v.master) * MAKEUP, t, 0.03);
    this.music.gain.setTargetAtTime(curve(v.music) * 0.9, t, 0.03);
    this.sfx.gain.setTargetAtTime(curve(v.sfx), t, 0.03);
  }

  /** Baja la música (-8 dB) entre `from` y `to` (tiempos del contexto) para que se entienda la voz. */
  duckMusic(from, to) {
    const g = this.duck.gain;
    g.cancelScheduledValues(from);
    g.setTargetAtTime(0.4, from, 0.06);
    g.setTargetAtTime(1, to, 0.25);
  }

  /** Pausa: la música baja y se filtra; los efectos se callan. */
  setPaused(paused) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(paused ? 700 : 20000, t, 0.08);
    this.sfx.gain.setTargetAtTime(paused ? 0 : this.volumes.sfx ** 2, t, 0.05);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}

/** Respuesta al impulso estéreo: ruido con caída exponencial (reverb sintética). */
function impulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // Un poco de pre-delay y caída más rápida en agudos (aproximada con ruido suavizado)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay) * (i < rate * 0.012 ? 0 : 1);
    }
  }
  return buf;
}

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
