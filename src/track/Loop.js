import { GAME_CONFIG } from '../config.js';

const T = GAME_CONFIG.terrain;
const TAU = Math.PI * 2;

/**
 * Loop guiado. El motor maneja la pista como un piso con alturas, así que un loop no puede
 * resolverse con la física normal: al cruzar la entrada, el loop toma el control del auto y lo
 * lleva por el aro (posición, cabeceo boca abajo y velocidad).
 *
 * La velocidad baja al subir y sube al bajar, con una "gravedad de loop" calculada para que haga
 * falta entrar a `minSpeed` o más: arriba la fuerza centrífuga tiene que alcanzar para no despegarse
 * (v² / R ≥ g). Si no alcanza, el auto se despega del aro y se cae (reaparece antes del loop).
 *
 * El aro avanza `shift` unidades hacia la izquierda en la vuelta (como los de juguete), y el auto
 * sale en el mismo punto de la pista donde entró, corrido de costado.
 *
 * def: { at: [x, z], radius, minSpeed, shift, halfWidth }
 */
export class GuidedLoop {
  constructor(track, def) {
    this.track = track;
    this.R = def.radius;
    this.minSpeed = def.minSpeed;
    this.shift = def.shift ?? 0;
    this.halfWidth = def.halfWidth ?? 4.5; // ancho del aro (el auto se acomoda adentro)
    this.s = track.sOf(def.at);
    const p = track.path.pointAt(this.s);
    this.base = p; // punto de la pista donde apoya el aro
    this.heading = p.heading;
    this.fx = Math.sin(p.heading);
    this.fz = Math.cos(p.heading);
    this.lx = Math.cos(p.heading); // izquierda de la pista
    this.lz = -Math.sin(p.heading);
    this.g = (this.minSpeed * this.minSpeed) / (5 * this.R);
  }

  /** Punto del aro a un ángulo (0 = entrada, π = arriba) y desplazamiento lateral `offset`. */
  pointAt(angle, offset = 0) {
    const R = this.R;
    const side = offset + (this.shift * angle) / TAU;
    const along = R * Math.sin(angle);
    return {
      x: this.base.x + this.fx * along + this.lx * side,
      y: this.base.y + R * (1 - Math.cos(angle)),
      z: this.base.z + this.fz * along + this.lz * side,
    };
  }

  /** ¿El auto acaba de cruzar la entrada? (prevS / s: antes y después del paso, sobre el principal) */
  check(car, prevS) {
    if (car.loop || car.fall || !car.alive || !car.grounded || car.forwardSpeed <= 0) return;
    if (car.ground?.path !== this.track.path) return;
    // Recién salió del aro: al quedar corrido de costado puede proyectarse apenas antes de la entrada
    if (car.loopExit != null && car.progress < car.loopExit + 15) return;
    const P = this.track.path;
    const crossed = P.forward(this.s, car.trackS) < 6 && P.forward(this.s, prevS) > P.length - 6;
    if (crossed) this.enter(car);
  }

  enter(car) {
    // El aro se corre `shift` de costado en la vuelta (de -shift/2 a +shift/2): el auto entra
    // acomodado dentro del aro y sale corrido, siempre dentro de la pista
    const room = this.halfWidth - 1.5 - this.shift / 2;
    const o = Math.max(-room, Math.min(room, this.track.path.project(car.position.x, car.position.z).offset));
    car.loop = { angle: 0, v0: car.forwardSpeed, v: car.forwardSpeed, offset: o - this.shift / 2 };
    car.heading = this.heading;
    car.yawRate = 0;
    car.spin = 0;
  }

  /** Un paso de física de un auto que está en el aro. */
  step(car, dt) {
    const L = car.loop;
    const R = this.R;
    // Energía: baja al subir. Contacto: la centrífuga tiene que ganarle a la gravedad arriba
    L.v = Math.sqrt(Math.max(0, L.v0 * L.v0 - 2 * this.g * R * (1 - Math.cos(L.angle))));
    if (L.angle > Math.PI / 2 && (L.v * L.v) / R + this.g * Math.cos(L.angle) < 0) return this.fail(car);
    L.angle += (Math.max(L.v, 2) / R) * dt;
    if (L.angle >= TAU) return this.exit(car);
    const p = this.pointAt(L.angle, L.offset);
    car.position.set(p.x, p.y, p.z);
    const c = Math.cos(L.angle);
    car.forwardSpeed = L.v;
    car.velocity.set(this.fx * L.v * c, 0, this.fz * L.v * c);
    car.vy = L.v * Math.sin(L.angle);
    car.grounded = true;
    car.updateCircles();
  }

  /** Completó la vuelta: sale disparado por la pista, corrido de costado. */
  exit(car) {
    const L = car.loop;
    const p = this.track.path.pointAt(this.s, L.offset + this.shift);
    car.position.set(p.x, p.y, p.z);
    car.heading = this.heading;
    car.velocity.set(this.fx * L.v0, 0, this.fz * L.v0);
    car.forwardSpeed = L.v0;
    car.vy = 0;
    car.slope = 0;
    car.loop = null;
    car.loopExit = car.progress; // no vuelve a entrar hasta avanzar un poco (ver check)
    car.updateCircles();
  }

  /** No le alcanzó la velocidad: se despega del aro y cae (reaparece antes del loop). */
  fail(car) {
    const L = car.loop;
    const c = Math.cos(L.angle);
    car.velocity.set(this.fx * L.v * c, 0, this.fz * L.v * c);
    car.vy = L.v * Math.sin(L.angle);
    car.loop = null;
    car.slope = Math.atan2(Math.sin(-L.angle), Math.cos(-L.angle));
    car.grounded = false;
    car.fall = { timer: T.respawnDelay + 0.4 };
    car.falls++;
    car.sound('fall');
  }
}
