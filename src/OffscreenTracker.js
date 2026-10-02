import { PlayerState } from './Car.js';

/**
 * Quedar atrás: el auto que sale de la zona segura de la cámara queda eliminado en el acto.
 */
export class OffscreenTracker {
  constructor(count) {
    this.timers = new Array(count).fill(0);
    this.inside = new Array(count).fill(true);
  }

  reset() {
    this.timers.fill(0);
    this.inside.fill(true);
  }

  /** Devuelve los índices de autos eliminados en este frame. */
  update(dt, cars, rig) {
    const eliminated = [];
    cars.forEach((car, i) => {
      if (!car.alive || car.fall) return; // cayendo: no cuenta hasta que reaparece
      this.inside[i] = rig.isInSafeZone(car.position);
      if (this.inside[i]) return;
      car.state = PlayerState.OUT_OF_SCREEN;
      eliminated.push(i);
    });
    return eliminated;
  }
}
