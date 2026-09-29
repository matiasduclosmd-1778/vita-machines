import { GAME_CONFIG } from './config.js';
import { PlayerState } from './Car.js';

const OUT = GAME_CONFIG.outOfScreen;

/**
 * Mecánica OUT_OF_SCREEN:
 *  - fuera de la zona segura → estado OUT_OF_SCREEN y arranca el countdown;
 *  - vuelve a entrar → se cancela al instante y vuelve a NORMAL;
 *  - completa el countdown → queda eliminado.
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
      if (!car.alive || car.fall) return; // cayendo: el countdown queda congelado hasta que reaparece
      this.inside[i] = rig.isInSafeZone(car.position);
      if (this.inside[i]) {
        this.timers[i] = 0;
        car.state = PlayerState.NORMAL;
        return;
      }
      car.state = PlayerState.OUT_OF_SCREEN;
      this.timers[i] += dt;
      if (this.timers[i] >= OUT.countdown) eliminated.push(i);
    });
    return eliminated;
  }

  /** Segundos restantes de countdown, o null si el jugador está dentro. */
  remaining(i) {
    return this.inside[i] ? null : Math.max(0, OUT.countdown - this.timers[i]);
  }

  /** Número que se muestra (3, 2, 1) o null si no hay countdown. */
  countdown(i) {
    const r = this.remaining(i);
    return r == null ? null : Math.max(1, Math.ceil(r));
  }
}
