import { GAME_CONFIG } from '../config.js';
import { TrackPath } from './TrackPath.js';
import { buildTrackVisuals } from './TrackVisuals.js';

const TRACK = GAME_CONFIG.track;
const TERRAIN = GAME_CONFIG.terrain;
const OBSTACLE_RADIUS = { drum: 1.1, cone: 0.55, block: 1.2 };

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Circuito: camino principal (cerrado) + atajo (abierto).
 * Cada camino tiene, por muestra, altura, paredes por lado y huecos sin piso.
 * Fuera de los caminos está el escritorio (no es pista: si caés ahí, reaparecés)
 * y más abajo el piso de la habitación.
 */
export class Track {
  constructor(scene) {
    this.path = new TrackPath(TRACK.controlPoints, TRACK.samples, true, TRACK.halfWidth);
    this.halfWidth = TRACK.halfWidth;
    this.length = this.path.length;
    this.startS = this.sOf(TRACK.start);
    this.deskTop = -TRACK.slabThickness;

    this.applyElevationAndJump();
    this.applyCliffs();
    this.buildShortcut();
    this.markRespawnable();
    this.paths = [this.path, this.shortcut];

    this.obstacles = TRACK.obstacles.map((o) => {
      const p = this.path.pointAt(this.sOf(o.at), o.offset);
      return { x: p.x, y: p.y, z: p.z, r: OBSTACLE_RADIUS[o.type], type: o.type, heading: p.heading };
    });

    buildTrackVisuals(this, scene);
  }

  /** s del camino principal más cercano a un punto [x, z]. */
  sOf([x, z]) {
    return this.path.project(x, z).s;
  }

  // ---------------------------------------------------------------- diseño

  /** Subida, tramo elevado, rampa de despegue, hueco, aterrizaje y bajada. */
  applyElevationAndJump() {
    const P = this.path;
    const E = TRACK.elevated;
    const J = TRACK.jump;
    const s0 = this.sOf(E.from);
    const dJump = P.forward(s0, this.sOf(J.at)); // distancia hasta el despegue
    const dKick = dJump - J.kickerLength;
    const dGapEnd = dJump + J.gapLength;
    const dLandEnd = dGapEnd + J.landingLength;
    const dEnd = dLandEnd + J.rampDownLength;
    this.jumpInfo = { s0, dJump, dGapEnd, dLandEnd, dEnd };

    for (let i = 0; i < P.count; i++) {
      const d = P.forward(s0, P.cum[i]);
      if (d >= dEnd) continue;
      let h;
      if (d < E.rampLength) h = E.height * smooth(d / E.rampLength);
      else if (d < dKick) h = E.height;
      else if (d < dJump) h = E.height + J.kickerRise * ((d - dKick) / J.kickerLength); // lineal: lanza
      else if (d < dGapEnd) {
        // Sin piso; la altura sigue la pendiente para que el borde no se aplane al despegar
        h = E.height + J.kickerRise * ((d - dKick) / J.kickerLength);
        P.gap[i] = 1;
      } else if (d < dLandEnd) h = J.landingHeight;
      else h = J.landingHeight * (1 - smooth((d - dLandEnd) / J.rampDownLength));
      P.height[i] = h;

      const open = (!E.barriers && d >= E.rampLength && d < dLandEnd) || P.gap[i];
      if (open) P.wallLeft[i] = P.wallRight[i] = 0;
    }
  }

  applyCliffs() {
    const P = this.path;
    this.cliffRanges = TRACK.cliffs.map((c) => {
      const a = this.sOf(c.from);
      const len = P.forward(a, this.sOf(c.to));
      for (let i = 0; i < P.count; i++) {
        if (P.forward(a, P.cum[i]) > len) continue;
        if (c.side !== 'right') P.wallLeft[i] = 0;
        if (c.side !== 'left') P.wallRight[i] = 0;
      }
      return { s: a, len, side: c.side };
    });
  }

  /** Atajo: sale del principal por una abertura, sube a la regla y vuelve a bajar. */
  buildShortcut() {
    const S = TRACK.shortcut;
    const P = this.path;
    const sc = new TrackPath(S.points, 140, false, S.halfWidth);
    sc.wallLeft.fill(0);
    sc.wallRight.fill(0);
    sc.respawnable.fill(0);

    // Dónde el atajo cruza el borde de la pista principal (al salir y al volver)
    const outside = (i) => P.project(sc.points[i].x, sc.points[i].z).dist > P.halfWidth;
    let first = 0;
    while (first < sc.count - 1 && !outside(first)) first++;
    let last = sc.count - 1;
    while (last > 0 && !outside(last)) last--;
    const sUp = sc.cum[first];
    const sDown = sc.cum[last];
    for (let i = 0; i < sc.count; i++) {
      const s = sc.cum[i];
      const up = smooth(Math.min(1, Math.max(0, (s - sUp) / S.rampLength)));
      const down = smooth(Math.min(1, Math.max(0, (sDown - s) / S.rampLength)));
      sc.height[i] = S.height * Math.min(up, down);
    }

    // Aberturas en la pared del principal donde se conecta el atajo
    this.shortcutJoins = [first, last].map((k) => {
      const q = P.project(sc.points[k].x, sc.points[k].z);
      const side = q.offset > 0 ? 'left' : 'right';
      const walls = side === 'left' ? P.wallLeft : P.wallRight;
      const half = S.halfWidth + 1.5;
      for (let i = 0; i < P.count; i++) {
        const d = P.forward(q.s - half, P.cum[i]);
        if (d <= half * 2) walls[i] = 0;
      }
      return { s: q.s, side };
    });
    this.shortcut = sc;
  }

  /** Dónde se puede reaparecer: plano, con piso y lejos del salto. */
  markRespawnable() {
    const P = this.path;
    const { s0, dJump, dEnd } = this.jumpInfo;
    for (let i = 0; i < P.count; i++) {
      const d = P.forward(s0, P.cum[i]);
      const j = (i + 1) % P.count;
      const slope = Math.abs(P.height[j] - P.height[i]) / P.segLen[Math.min(i, P.segCount - 1)];
      const nearJump = d > dJump - TRACK.jump.kickerLength - 15 && d < dEnd;
      P.respawnable[i] = !P.gap[i] && slope < 0.01 && !nearJump ? 1 : 0;
    }
  }

  // ---------------------------------------------------------------- consultas

  /**
   * Piso debajo de (x, z) alcanzable desde la altura y.
   * @returns { h, onTrack, path, s, i, offset, dist, above }
   *   above = hay pista por encima (más alta que y + stepUp): funciona como pared.
   */
  groundAt(x, z, y) {
    const reach = y + TERRAIN.stepUp;
    let best = null;
    let above = false;
    for (const path of this.paths) {
      const info = path.project(x, z);
      if (info.dist > path.halfWidth + 0.05 || path.gap[info.i]) continue;
      const h = path.heightAt(info.s);
      if (h > reach) {
        above = true;
        continue;
      }
      if (!best || h > best.h) best = { h, onTrack: true, path, s: info.s, i: info.i, offset: info.offset, dist: info.dist };
    }
    if (!best) {
      const d = TRACK.desk;
      const onDesk = x > d.minX && x < d.maxX && z > d.minZ && z < d.maxZ && this.deskTop <= reach;
      best = { h: onDesk ? this.deskTop : TRACK.floorY, onTrack: false };
    }
    best.above = above;
    return best;
  }

  /** ¿Una esfera en (x, y, z) de radio r toca una pared? (para proyectiles) */
  hitsWall(x, y, z, r) {
    for (const path of this.paths) {
      const info = path.project(x, z);
      if (info.dist < path.halfWidth - r || info.dist > path.halfWidth + 1) continue;
      const walls = info.offset > 0 ? path.wallLeft : path.wallRight;
      if (walls[info.i] && Math.abs(y - path.heightAt(info.s)) < 2) return true;
    }
    return false;
  }

  /** Posición de largada para el jugador `slot` (0–5): filas de a dos detrás de la línea. */
  startPosition(slot) {
    const row = Math.floor(slot / 2);
    return this.path.pointAt(this.startS - 5 - row * 5.5, slot % 2 === 0 ? 2.6 : -2.6);
  }

  /** Dónde reaparece un auto que se cayó: un poco antes de su último punto seguro. */
  respawnPoint(car, others = []) {
    const P = this.path;
    let s = (car.safeS ?? this.startS) - TERRAIN.respawnBack;
    for (let k = 0; k < 200 && !P.respawnable[P.indexAt(s)]; k++) s -= 2;
    let p = P.pointAt(s, 0);
    // No aparecer encima del otro auto
    if (others.some((o) => Math.hypot(o.position.x - p.x, o.position.z - p.z) < 3)) p = P.pointAt(s, 3.2);
    return { ...p, s };
  }

  // ---------------------------------------------------------------- progreso

  /** s en el camino principal (en el atajo se interpola entre sus dos conexiones). */
  mainS(car) {
    const g = car.ground;
    if (g && g.path === this.shortcut) {
      const [a, b] = this.shortcutJoins;
      return this.path.wrapS(a.s + (g.s / this.shortcut.length) * this.path.forward(a.s, b.s));
    }
    return this.path.project(car.position.x, car.position.z).s;
  }

  resetProgress(car) {
    const s = this.mainS(car);
    car.trackS = s;
    let d = s - this.startS;
    if (d > this.length / 2) d -= this.length;
    car.progress = d;
    car.safeS = s;
  }

  /** Acumula distancia recorrida (negativa si va al revés). */
  updateProgress(car) {
    const s = this.mainS(car);
    let ds = s - car.trackS;
    if (ds > this.length / 2) ds -= this.length;
    else if (ds < -this.length / 2) ds += this.length;
    car.progress += ds;
    car.trackS = s;
  }

  lap(car) {
    return Math.max(1, Math.floor(car.progress / this.length) + 1);
  }

  /** Dirección promedio de la pista entre s+from y s+to (suaviza curvas cerradas). */
  headingAround(s, from, to) {
    let x = 0;
    let z = 0;
    for (let d = from; d <= to; d += 2) {
      const h = this.path.pointAt(s + d).heading;
      x += Math.sin(h);
      z += Math.cos(h);
    }
    return Math.atan2(x, z);
  }
}
