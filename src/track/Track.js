import { GAME_CONFIG } from '../config.js';
import { TrackPath } from './TrackPath.js';
import { buildTrackVisuals } from './TrackVisuals.js';
import { GuidedLoop } from './Loop.js';

const TERRAIN = GAME_CONFIG.terrain;
// Radio de colisión de cada tipo de obstáculo (los del living los dibuja su propio mapa)
const OBSTACLE_RADIUS = { drum: 1.1, cone: 0.55, block: 1.2, can: 0.9, tire: 1.3, pad: 1.4, pillow: 2.2, shoe: 2.0, arm: 1.5, mug: 1.5, flag: 1.0, toycar: 1.3 };

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Circuito: camino principal (cerrado) + atajo (abierto).
 * Cada camino tiene, por muestra, altura, medio ancho, paredes por lado y huecos sin piso.
 * Fuera de los caminos no es pista: si caés ahí, reaparecés. Debajo hay otra superficie (el
 * escritorio, los muebles) o el piso de la habitación.
 *
 * `def` es la pista de un mapa (ver src/maps/). Dos formatos:
 *  - El Escritorio: `elevated` + `jump` + `cliffs` + `shortcut` con `height` (un solo salto).
 *  - Genérico: `profile` (alturas por puntos), `gaps`, `open`, `widths`, `surfaces` y un
 *    `shortcut` con su propio `profile`: tantos desniveles y saltos como haga falta.
 */
export class Track {
  constructor(scene, def = GAME_CONFIG.track, buildVisuals = buildTrackVisuals) {
    this.def = def;
    this.path = new TrackPath(def.controlPoints, def.samples, true, def.halfWidth);
    this.halfWidth = def.halfWidth;
    this.length = this.path.length;
    this.startS = this.sOf(def.start);
    this.deskTop = -def.slabThickness;
    this.floorY = def.floorY;
    this.surfaces = def.surfaces ?? [];

    if (def.elevated) {
      this.applyElevationAndJump();
      this.applyCliffs();
      this.buildShortcut();
      this.markRespawnable();
      this.takeoffs = [this.jumpInfo.s0 + this.jumpInfo.dJump];
    } else {
      this.applyProfile(this.path, def.profile ?? [], (at) => this.sOf(at));
      this.applyWidths();
      this.applyOpen();
      this.applyGaps();
      this.cliffRanges = [];
      if (def.shortcut) this.buildProfiledShortcut();
      this.markRespawnableGeneric();
      if (def.loop) {
        this.loop = new GuidedLoop(this, def.loop);
        this.takeoffs.push(this.loop.s); // la CPU llega rápido al loop
      }
    }
    this.paths = [this.path, this.shortcut].filter(Boolean);

    this.obstacles = (def.obstacles ?? []).map((o) => {
      const p = this.path.pointAt(this.sOf(o.at), o.offset);
      return { x: p.x, y: p.y, z: p.z, r: o.r ?? OBSTACLE_RADIUS[o.type], type: o.type, heading: p.heading };
    });

    // Obstáculos que se mueven (van al final de la lista de obstáculos: chocan igual que los quietos)
    this.movers = (def.movers ?? []).map((m) => {
      const o = { type: m.type, r: m.r ?? OBSTACLE_RADIUS[m.type], s: this.sOf(m.at), offsets: m.offsets, period: m.period, x: 0, y: 0, z: 0, heading: 0, offset: 0, moving: true };
      this.obstacles.push(o);
      return o;
    });
    this.updateMovers(0);

    this.group = buildVisuals(this, scene);
  }

  /** Mueve los obstáculos móviles (t en segundos): van y vienen de un costado a otro de la pista. */
  updateMovers(t) {
    for (const o of this.movers) {
      const [a, b] = o.offsets;
      const k = 0.5 - 0.5 * Math.cos((t / o.period) * Math.PI * 2);
      o.offset = a + (b - a) * k;
      const p = this.path.pointAt(o.s, o.offset);
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
      o.heading = p.heading;
      if (o.mesh) {
        o.mesh.position.set(p.x, p.y, p.z);
        o.mesh.rotation.y = p.heading - Math.PI / 2; // de costado: lo empujan a lo ancho de la pista
      }
    }
  }

  /** s del camino principal más cercano a un punto [x, z]. */
  sOf([x, z]) {
    return this.path.project(x, z).s;
  }

  // ---------------------------------------------------------------- diseño

  /** Subida, tramo elevado, rampa de despegue, hueco, aterrizaje y bajada. */
  applyElevationAndJump() {
    const P = this.path;
    const E = this.def.elevated;
    const J = this.def.jump;
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
    this.cliffRanges = this.def.cliffs.map((c) => {
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
    const S = this.def.shortcut;
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

  // ---------------------------------------------------------------- diseño genérico

  /**
   * Alturas por puntos clave: [[x, z, h, forma?], …] en orden de carrera. Entre dos puntos la
   * altura cambia suave; con forma 'lin' cambia en línea recta (rampas de salto: lanzan).
   * sOfKey ubica cada punto sobre el camino.
   */
  applyProfile(P, keys, sOfKey) {
    if (!keys.length) return;
    const s0 = sOfKey(keys[0]);
    const ds = keys.map((k) => (k === keys[0] ? 0 : P.forward(s0, sOfKey(k))));
    if (!P.closed) ds.forEach((d, k) => (ds[k] = sOfKey(keys[k]) - s0));
    const end = P.closed ? P.length : ds[ds.length - 1];
    for (let i = 0; i < P.count; i++) {
      const d = P.closed ? P.forward(s0, P.cum[i]) : P.cum[i] - s0;
      let k = 0;
      while (k < ds.length - 1 && ds[k + 1] <= d) k++;
      const a = keys[k];
      const last = k === ds.length - 1;
      if (last && !P.closed) {
        P.height[i] = a[2];
        continue;
      }
      if (d < 0) {
        P.height[i] = keys[0][2];
        continue;
      }
      const b = last ? keys[0] : keys[k + 1];
      const len = (last ? end : ds[k + 1]) - ds[k];
      const t = len > 0 ? Math.min(1, (d - ds[k]) / len) : 1;
      P.height[i] = a[2] + (b[2] - a[2]) * (b[3] === 'lin' ? t : smooth(t));
    }
  }

  /** Recorre las muestras del principal entre `from` y `to` (puntos [x, z]): fn(i, d, len). */
  eachBetween(from, to, fn) {
    const P = this.path;
    const a = this.sOf(from);
    const len = P.forward(a, this.sOf(to));
    for (let i = 0; i < P.count; i++) {
      const d = P.forward(a, P.cum[i]);
      if (d <= len) fn(i, d, len);
    }
  }

  /** Tramos angostos: { from, to, halfWidth } (se angosta y se ensancha en `blend` unidades). */
  applyWidths() {
    for (const w of this.def.widths ?? []) {
      const blend = w.blend ?? 6;
      this.eachBetween(w.from, w.to, (i, d, len) => {
        const k = smooth(Math.min(1, Math.min(d, len - d) / blend));
        this.path.hw[i] = Math.min(this.path.hw[i], this.def.halfWidth + (w.halfWidth - this.def.halfWidth) * k);
      });
    }
  }

  /** Tramos sin baranda: { from, to, side: 'left' | 'right' | 'both' }. */
  applyOpen() {
    const P = this.path;
    for (const o of this.def.open ?? []) {
      this.eachBetween(o.from, o.to, (i) => {
        if (o.side !== 'right') P.wallLeft[i] = 0;
        if (o.side !== 'left') P.wallRight[i] = 0;
      });
    }
  }

  /** Huecos sin piso: { at: [x, z], length }. Se saltan; el que no llega, se cae. */
  applyGaps() {
    const P = this.path;
    this.gaps = (this.def.gaps ?? []).map((g) => {
      const s = this.sOf(g.at);
      for (let i = 0; i < P.count; i++) {
        if (P.forward(s, P.cum[i]) >= g.length) continue;
        P.gap[i] = 1;
        P.wallLeft[i] = P.wallRight[i] = 0;
      }
      return { s, length: g.length };
    });
    // Para la CPU: dónde despegar (llegar con velocidad)
    this.takeoffs = this.gaps.map((g) => g.s);
  }

  /** Atajo con su propio perfil de alturas (sale y vuelve al principal a cualquier altura). */
  buildProfiledShortcut() {
    const S = this.def.shortcut;
    const P = this.path;
    const sc = new TrackPath(S.points, S.samples ?? 160, false, S.halfWidth);
    if (!S.walls) {
      sc.wallLeft.fill(0);
      sc.wallRight.fill(0);
    }
    sc.respawnable.fill(0);
    this.applyProfile(sc, S.profile, (k) => sc.project(k[0], k[1]).s);
    // Dónde se separa del principal (al salir y al volver): ahí el principal no tiene baranda
    const outside = (i) => P.project(sc.points[i].x, sc.points[i].z).dist > P.hw[P.project(sc.points[i].x, sc.points[i].z).i];
    let first = 0;
    while (first < sc.count - 1 && !outside(first)) first++;
    let last = sc.count - 1;
    while (last > 0 && !outside(last)) last--;
    this.shortcutJoins = [first, last].map((k) => {
      const q = P.project(sc.points[k].x, sc.points[k].z);
      const side = q.offset > 0 ? 'left' : 'right';
      const walls = side === 'left' ? P.wallLeft : P.wallRight;
      const half = S.halfWidth + 2;
      for (let i = 0; i < P.count; i++) if (P.forward(q.s - half, P.cum[i]) <= half * 2) walls[i] = 0;
      return { s: q.s, side };
    });
    this.shortcut = sc;
  }

  /** Dónde se puede reaparecer: con piso, casi plano, ancho y lejos de los huecos. */
  markRespawnableGeneric() {
    const P = this.path;
    for (let i = 0; i < P.count; i++) {
      const j = (i + 1) % P.count;
      const slope = Math.abs(P.height[j] - P.height[i]) / P.segLen[Math.min(i, P.segCount - 1)];
      const nearGap = this.gaps.some((g) => {
        const d = P.forward(g.s, P.cum[i]);
        return d < g.length + 8 || d > P.length - 18;
      });
      P.respawnable[i] = !P.gap[i] && slope < 0.03 && P.hw[i] >= 5 && !nearGap ? 1 : 0;
    }
  }

  /** Dónde se puede reaparecer: plano, con piso y lejos del salto. */
  markRespawnable() {
    const P = this.path;
    const { s0, dJump, dEnd } = this.jumpInfo;
    for (let i = 0; i < P.count; i++) {
      const d = P.forward(s0, P.cum[i]);
      const j = (i + 1) % P.count;
      const slope = Math.abs(P.height[j] - P.height[i]) / P.segLen[Math.min(i, P.segCount - 1)];
      const nearJump = d > dJump - this.def.jump.kickerLength - 15 && d < dEnd;
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
      if (info.dist > path.hw[info.i] + 0.05 || path.gap[info.i]) continue;
      const h = path.heightAt(info.s);
      if (h > reach) {
        above = true;
        continue;
      }
      if (!best || h > best.h) best = { h, onTrack: true, path, s: info.s, i: info.i, offset: info.offset, dist: info.dist };
    }
    if (!best) {
      const d = this.def.desk;
      if (d) {
        const onDesk = x > d.minX && x < d.maxX && z > d.minZ && z < d.maxZ && this.deskTop <= reach;
        best = { h: onDesk ? this.deskTop : this.floorY, onTrack: false };
      } else {
        // Muebles: se puede caer encima; si están más altos que el auto, son una pared
        let h = this.floorY;
        for (const sf of this.surfaces) {
          if (!insideSurface(sf, x, z)) continue;
          if (sf.top <= reach) h = Math.max(h, sf.top);
          else above = true;
        }
        best = { h, onTrack: false };
      }
    }
    best.above = above;
    return best;
  }

  /** ¿Una esfera en (x, y, z) de radio r toca una pared? (para proyectiles) */
  hitsWall(x, y, z, r) {
    for (const path of this.paths) {
      const info = path.project(x, z);
      const hw = path.hw[info.i];
      if (info.dist < hw - r || info.dist > hw + 1) continue;
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
    car.loopExit = null; // ronda nueva: el loop vuelve a estar disponible
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

/** ¿El punto (x, z) cae sobre la superficie? Caja { box: [minX, minZ, maxX, maxZ] } o círculo { circle: [x, z, r] }. */
function insideSurface(sf, x, z) {
  if (sf.box) {
    const [x0, z0, x1, z1] = sf.box;
    return x >= x0 && x <= x1 && z >= z0 && z <= z1;
  }
  const [cx, cz, r] = sf.circle;
  return (x - cx) * (x - cx) + (z - cz) * (z - cz) <= r * r;
}
