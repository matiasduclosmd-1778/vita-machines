import { GAME_CONFIG } from './config.js';

// Colisiones 2D simples basadas en círculos. Cada auto tiene dos círculos (car.circles).
// Orden recomendado por paso: auto↔auto → obstáculos → paredes (las paredes siempre ganan).

const C = GAME_CONFIG.collision;
const info = {};

/**
 * Paredes de la pista: solo existen en los tramos que las tienen (ver Track).
 * Donde no hay pared el auto puede salirse y caer.
 */
export function resolveCarTrack(car, track) {
  if (car.fall) return;
  let impact = 0;
  for (const path of track.paths) {
    const hw = path.halfWidth;
    for (const c of car.circles) {
      path.project(c.x, c.z, info);
      const limit = hw - c.r;
      if (info.dist <= limit || info.dist > hw + 2.5) continue;
      const walls = info.offset > 0 ? path.wallLeft : path.wallRight;
      if (!walls[info.i] || Math.abs(car.position.y - path.heightAt(info.s)) > 2) continue;
      const push = info.dist - limit;
      car.position.x -= info.dirX * push;
      car.position.z -= info.dirZ * push;
      impact = Math.max(impact, bounce(car, info.dirX, info.dirZ, C.wallBounce, C.wallFriction));
      car.updateCircles();
    }
  }
  if (impact > 1) car.onImpact(impact);
}

/** Obstáculos estáticos circulares { x, z, r }. */
export function resolveCarObstacles(car, obstacles) {
  let impact = 0;
  for (const o of obstacles) {
    if (Math.abs(car.position.y - o.y) > 1.5) continue;
    for (const c of car.circles) {
      const dx = c.x - o.x;
      const dz = c.z - o.z;
      const dist = Math.hypot(dx, dz);
      const overlap = c.r + o.r - dist;
      if (overlap <= 0 || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      car.position.x += nx * overlap;
      car.position.z += nz * overlap;
      const vn = bounce(car, -nx, -nz, C.obstacleBounce, C.wallFriction);
      if (vn > 0) addSpin(car, c, -nx, -nz, (1 + C.obstacleBounce) * vn, nx, nz);
      impact = Math.max(impact, vn);
      car.updateCircles();
    }
  }
  if (impact > 1) car.onImpact(impact);
}

/** Choque entre dos autos de igual masa: separa, rebota y agrega un poco de giro. */
export function resolveCarCar(a, b) {
  if (a.fall || b.fall || Math.abs(a.position.y - b.position.y) > 1.6) return;
  let impact = 0;
  for (const ca of a.circles) {
    for (const cb of b.circles) {
      const dx = cb.x - ca.x;
      const dz = cb.z - ca.z;
      const dist = Math.hypot(dx, dz);
      const overlap = ca.r + cb.r - dist;
      if (overlap <= 0) continue;
      const nx = dist > 1e-6 ? dx / dist : 1;
      const nz = dist > 1e-6 ? dz / dist : 0;

      // Separación posicional: nunca quedan superpuestos
      a.position.x -= (nx * overlap) / 2;
      a.position.z -= (nz * overlap) / 2;
      b.position.x += (nx * overlap) / 2;
      b.position.z += (nz * overlap) / 2;

      const vRel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
      if (vRel < 0) {
        const j = (-(1 + C.carBounce) * vRel) / 2;
        a.velocity.x -= j * nx;
        a.velocity.z -= j * nz;
        b.velocity.x += j * nx;
        b.velocity.z += j * nz;
        addSpin(a, ca, nx, nz, j, -nx, -nz);
        addSpin(b, cb, -nx, -nz, j, nx, nz);
        impact = Math.max(impact, -vRel);
      }
      a.updateCircles();
      b.updateCircles();
    }
  }
  if (impact > 1) {
    a.onImpact(impact);
    b.onImpact(impact);
  }
}

/**
 * Rebote contra una superficie. (nx, nz) = dirección hacia la superficie.
 * Devuelve la velocidad de impacto (0 si no se estaba moviendo hacia ella).
 */
function bounce(car, nx, nz, restitution, friction) {
  const v = car.velocity;
  const vn = v.x * nx + v.z * nz;
  if (vn <= 0) return 0;
  const tx = v.x - vn * nx;
  const tz = v.z - vn * nz;
  const keep = 1 - Math.min(0.35, vn * friction);
  v.x = tx * keep - restitution * vn * nx;
  v.z = tz * keep - restitution * vn * nz;
  return vn;
}

/**
 * Giro por golpe descentrado. circle = círculo del auto que tocó, (cx, cz) = dirección
 * hacia el punto de contacto, j = magnitud del impulso, (fx, fz) = dirección del impulso.
 */
function addSpin(car, circle, cx, cz, j, fx, fz) {
  const rx = circle.x + cx * circle.r - car.position.x;
  const rz = circle.z + cz * circle.r - car.position.z;
  car.spin = Math.max(-4, Math.min(4, car.spin + C.spin * j * (rz * fx - rx * fz)));
}
