import { GAME_CONFIG } from './config.js';

const T = GAME_CONFIG.terrain;

/**
 * Física vertical de los autos y caídas.
 *  - En el piso: el auto sigue la altura de la pista; su velocidad vertical sale de la pendiente.
 *  - Si la superficie "cae" más rápido que la gravedad (fin de rampa, borde, hueco) → despega.
 *    Por eso la distancia del salto depende de la velocidad con la que se llega.
 *  - En el aire: gravedad. Aterriza al tocar una superficie; si choca contra el costado
 *    de una plataforma más alta, rebota hacia atrás (no llegó).
 *  - Si termina fuera de la pista (escritorio o piso) → cae y reaparece en el último punto seguro.
 */
export class Terrain {
  constructor(track) {
    this.track = track;
  }

  fixedUpdate(dt, cars) {
    for (const car of cars) this.step(car, dt, cars);
  }

  step(car, dt, cars) {
    const p = car.position;

    if (car.fall) {
      car.vy -= T.gravity * dt;
      p.y += car.vy * dt;
      const g = this.track.groundAt(p.x, p.z, p.y);
      if (p.y < g.h) {
        p.y = g.h;
        car.vy = 0;
        car.velocity.multiplyScalar(0.8);
      }
      car.fall.timer -= dt;
      if (car.fall.timer <= 0) this.respawn(car, cars);
      return;
    }

    let g = this.track.groundAt(p.x, p.z, p.y);
    if (g.above) {
      // Choque contra la cara de una superficie más alta: vuelve atrás y rebota
      p.x = car.prevX;
      p.z = car.prevZ;
      car.velocity.x *= -0.3;
      car.velocity.z *= -0.3;
      car.onImpact(8);
      car.updateCircles();
      g = this.track.groundAt(p.x, p.z, p.y);
    }

    if (car.grounded) {
      const ballistic = p.y + car.vy * dt - 0.5 * T.gravity * dt * dt;
      if (g.h < ballistic - 0.01) {
        car.grounded = false; // la superficie se aleja: despega
      } else {
        car.vy = Math.max(-30, Math.min(30, (g.h - p.y) / dt));
        p.y = g.h;
      }
    }
    if (!car.grounded) {
      car.vy -= T.gravity * dt;
      p.y += car.vy * dt;
      car.airTime += dt;
      if (p.y <= g.h) {
        const impact = -car.vy;
        p.y = g.h;
        car.vy = 0;
        car.grounded = true;
        if (car.airTime > 0.15) car.onImpact(impact * 0.8);
        if (car.airTime > 0.25 && impact > 3) car.sound('land', impact);
        car.airTime = 0;
      }
    }
    car.ground = g;

    // ¿Se cayó? (apoyado fuera de la pista, o muy por debajo de la calzada)
    if ((car.grounded && !g.onTrack) || p.y < -T.fallDepth) {
      car.fall = { timer: T.respawnDelay };
      car.grounded = false;
      car.falls++;
      car.sound('fall');
      return;
    }

    // Último punto seguro: apoyado en el camino principal, en zona apta y lejos del borde
    if (car.grounded && g.onTrack && g.path === this.track.path) {
      const P = g.path;
      if (P.respawnable[g.i] && Math.abs(g.offset) < P.halfWidth - 2) car.safeS = g.s;
    }
  }

  respawn(car, cars) {
    const others = cars.filter((c) => c !== car);
    const p = this.track.respawnPoint(car, others);
    car.respawnAt(p.x, p.y, p.z, p.heading, T.respawnBlink);
    car.sound('respawn');
    car.ground = this.track.groundAt(p.x, p.z, p.y);
    this.track.updateProgress(car);
  }
}
