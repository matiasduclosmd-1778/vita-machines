import { DEFAULT_MODS } from '../Car.js';

/**
 * Efecto temporal aplicado a un auto (turbo, escudo, aturdido, resbalando…).
 * Para crear uno nuevo: extender Effect, darle un `static id` y sobrescribir lo necesario.
 */
export class Effect {
  static id = 'EFFECT';
  static label = 'EFFECT';

  constructor(ctx, car, duration) {
    this.ctx = ctx;
    this.car = car;
    this.duration = duration;
    this.remaining = duration;
  }

  get id() {
    return this.constructor.id;
  }

  get label() {
    return this.constructor.label;
  }

  /** Al activarse. */
  start() {}
  /** Si se vuelve a aplicar mientras está activo: por defecto renueva la duración. */
  refresh(duration) {
    this.remaining = Math.max(this.remaining, duration);
  }
  /** Modifica los multiplicadores del auto (car.mods) para el próximo paso de física. */
  modify(mods) {}
  /** Lógica de física a paso fijo. */
  fixedUpdate(dt) {}
  /** Visuales, una vez por frame. */
  update(dt) {}
  /** Al terminar o al reiniciar: limpiar meshes. */
  end() {}
}

/** Guarda los efectos activos de cada auto y recalcula car.mods en cada paso. */
export class EffectManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.effects = new Map(); // car → Effect[]
  }

  list(car) {
    return this.effects.get(car) || [];
  }

  get count() {
    let n = 0;
    for (const l of this.effects.values()) n += l.length;
    return n;
  }

  get(car, id) {
    return this.list(car).find((e) => e.id === id);
  }

  has(car, id) {
    return !!this.get(car, id);
  }

  add(car, EffectClass, duration, ...args) {
    const existing = this.get(car, EffectClass.id);
    if (existing) {
      existing.refresh(duration, ...args);
      return existing;
    }
    const effect = new EffectClass(this.ctx, car, duration, ...args);
    if (!this.effects.has(car)) this.effects.set(car, []);
    this.effects.get(car).push(effect);
    effect.start();
    return effect;
  }

  remove(car, id) {
    const list = this.list(car);
    const i = list.findIndex((e) => e.id === id);
    if (i >= 0) list.splice(i, 1)[0].end();
  }

  fixedUpdate(dt, cars) {
    for (const car of cars) {
      const list = this.list(car);
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.fixedUpdate(dt);
        e.remaining -= dt;
        if (e.remaining <= 0) {
          list.splice(i, 1);
          e.end();
        }
      }
      // Recalcular multiplicadores desde cero
      Object.assign(car.mods, DEFAULT_MODS);
      for (const e of list) e.modify(car.mods);
    }
  }

  update(dt) {
    for (const list of this.effects.values()) for (const e of list) e.update(dt);
  }

  clear() {
    for (const list of this.effects.values()) for (const e of list) e.end();
    this.effects.clear();
  }
}
