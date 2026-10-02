// Voces del locutor (procesadas con tools/voices.py a partir de NewSound/): el nombre de cada piloto
// al elegirlo y "The winner is…" + el nombre del ganador en el podio.

// Vite copia los archivos al build y devuelve sus URLs: { 'coco': url, 'winner': url, … }
const URLS = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/voices/*.m4a', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [
    path.split('/').pop().replace('.m4a', ''),
    url,
  ]),
);

export class Voices {
  constructor(A) {
    this.A = A;
    this.buffers = {}; // id → { buffer, speechEnd } (speechEnd: dónde termina la voz, antes de la cola de reverb)
    this.current = null;
    this.timers = [];
    A.whenReady(() => this.load());
  }

  async load() {
    await Promise.all(
      Object.entries(URLS).map(async ([id, url]) => {
        try {
          const data = await (await fetch(url)).arrayBuffer();
          const buffer = await this.A.ctx.decodeAudioData(data);
          this.buffers[id] = { buffer, speechEnd: speechEnd(buffer) };
        } catch (e) {
          console.warn(`[audio] no se pudo cargar la voz ${id}:`, e);
        }
      }),
    );
  }

  has(id) {
    return id in URLS;
  }

  /** Dice una voz (corta la anterior). Devuelve cuándo termina de hablar (tiempo del contexto) o null. */
  say(id, when = this.A.now) {
    const v = this.buffers[id];
    if (!v || !this.A.ready) return null;
    const ctx = this.A.ctx;
    this.stop(when);
    const src = ctx.createBufferSource();
    src.buffer = v.buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1.1;
    src.connect(gain).connect(this.A.sfx);
    src.start(when);
    this.current = { src, gain };
    const end = when + v.speechEnd;
    this.A.duckMusic(when, end);
    return end;
  }

  /** Varias voces seguidas ("The winner is…" → "¡Coco!"), empezando dentro de `delay` segundos. */
  sequence(ids, delay = 0) {
    this.cancel();
    const run = () => {
      let t = this.A.now + delay;
      for (const id of ids) {
        const v = this.buffers[id];
        if (!v) continue;
        // Se agenda con un temporizador para que `say` corte la anterior justo al empezar la siguiente
        const at = t;
        this.timers.push(setTimeout(() => this.say(id, Math.max(this.A.now, at)), Math.max(0, (at - this.A.now - 0.05) * 1000)));
        t += v.speechEnd + 0.08;
      }
    };
    if (Object.keys(this.buffers).length) run();
    else this.A.whenReady(() => setTimeout(run, 300)); // todavía cargando
  }

  cancel() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  stop(when = this.A.now) {
    if (!this.current) return;
    const { src, gain } = this.current;
    gain.gain.setTargetAtTime(0, when, 0.03);
    src.stop(when + 0.2);
    this.current = null;
  }
}

/** Fin de la voz: último momento a menos de 26 dB del pico (lo que sigue es cola de reverb y eco). */
function speechEnd(buffer) {
  const d = buffer.getChannelData(0);
  const win = Math.floor(buffer.sampleRate * 0.02);
  let peak = 0;
  const rms = [];
  for (let i = 0; i + win < d.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += d[j] * d[j];
    const r = Math.sqrt(s / win);
    rms.push(r);
    peak = Math.max(peak, r);
  }
  const limit = peak * 0.05;
  let last = rms.length - 1;
  while (last > 0 && rms[last] < limit) last--;
  return ((last + 1) * win) / buffer.sampleRate;
}
