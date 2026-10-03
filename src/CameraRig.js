import * as THREE from 'three';
import { GAME_CONFIG, safeZoneNDC } from './config.js';

const CAM = GAME_CONFIG.camera;
const clamp = THREE.MathUtils.clamp;
const _v = new THREE.Vector3();
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Cámara compartida: una sola cámara que intenta mantener a todos los autos vivos
 * dentro de la zona segura.
 *
 * Cada frame:
 *  1. Toma las posiciones de los autos, su punto medio y la distancia entre ellos.
 *  2. Calcula la distancia de cámara necesaria para encuadrarlos (acotada a min/max).
 *  3. Mueve el foco hacia el punto medio y la distancia hacia la necesaria, con suavizado.
 *  4. Si con la distancia máxima no entran, el foco se corre lo justo para que el líder
 *     siga dentro de la zona segura: el que va atrás empieza a salir de pantalla.
 *
 * La cámara mira a `focus` desde atrás (orientada con `yaw` según el sentido de la pista)
 * y desde arriba, con inclinación fija. El encuadre usa la proyección real: el borde de
 * abajo (cercano) y el de arriba (lejano) no son simétricos.
 */
export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 2000);
    this.focus = new THREE.Vector3();
    this.target = new THREE.Vector3();
    // Con `aim`, el foco = punto del grupo (suavizado normal, va unas unidades atrás de los autos) +
    // corrimiento para dejar el grupo a esa altura de pantalla. El corrimiento se calcula desde donde está
    // de verdad ese punto, no desde su objetivo: si no, el grupo queda más arriba de lo previsto, el
    // primero toca el borde y el límite duro sacude la cámara
    this.anchor = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // velocidad promedio del grupo, suavizada (anticipación del encuadre)
    this.shift = new THREE.Vector3();
    this.shiftTarget = new THREE.Vector3();
    this.midpoint = new THREE.Vector3();
    this.distance = CAM.minDistance;
    this.targetDistance = CAM.minDistance;
    this.requiredDistance = CAM.minDistance; // la que haría falta sin límite máximo
    this.playerDistance = 0;
    this.yaw = 0;
    this.setView(CAM.view);
  }

  /** Vista de cámara (ver GAME_CONFIG.camera.views): inclinación y lente. */
  setView(id) {
    this.view = CAM.views[id] ?? CAM.views.classic;
    this.tanHalf = Math.tan(THREE.MathUtils.degToRad(this.view.fov / 2));
    this.setPitch(this.pitchRange[0]);
    this.speedK = 0; // 0..1: velocidad de los autos, suavizada (abre el lente)
    // Límites de distancia: los de la vista, o los generales
    this.minDistance = this.view.minDistance ?? CAM.minDistance;
    this.maxDistance = this.view.maxDistance ?? CAM.maxDistance;
    this.applyFov(this.view.fov);
  }

  /** Inclinación [juntos, separados]: la vista puede tener un valor fijo o un rango. */
  get pitchRange() {
    const p = this.view.pitch;
    return Array.isArray(p) ? p : [p, p];
  }

  setPitch(pitch) {
    this.pitch = pitch;
    this.sinP = Math.sin(pitch);
    this.cosP = Math.cos(pitch);
  }

  /**
   * Inclinación según qué tan separados están los autos (sobre el piso, así no depende de la propia
   * inclinación): juntos = baja, mirando al horizonte; separados = alta, más cenital, para que el que va
   * adelante no quede chiquito en el fondo de la perspectiva.
   */
  pitchGoal(cars) {
    const [close, far] = this.pitchRange;
    if (close === far || cars.length < 2) return close;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of cars) {
      minX = Math.min(minX, c.position.x);
      maxX = Math.max(maxX, c.position.x);
      minZ = Math.min(minZ, c.position.z);
      maxZ = Math.max(maxZ, c.position.z);
    }
    const [s0, s1] = this.view.pitchSpread;
    const k = clamp((Math.hypot(maxX - minX, maxZ - minZ) - s0) / (s1 - s0), 0, 1);
    return close + (far - close) * k * k * (3 - 2 * k);
  }

  /** Lente actual: el de la vista más lo que abre la velocidad. */
  get fov() {
    return this.view.fov + this.view.speedFov * this.speedK;
  }

  /** Franja nítida del efecto miniatura (se ensancha con el lente). */
  get focusBand() {
    return this.view.focusBand + this.view.speedBand * this.speedK;
  }

  applyFov(fov) {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** true cuando los jugadores no entran ni con la distancia máxima. */
  get atMaxDistance() {
    return this.requiredDistance >= this.maxDistance;
  }

  /**
   * Cuánto piso se ve alrededor del foco, por unidad de distancia de cámara, para que un
   * punto quede dentro de ±ndcX / ±ndcY de la pantalla.
   * near = hacia la cámara (abajo en pantalla), far = hacia adelante (arriba).
   */
  extents(ndcX, ndcY) {
    const ty = ndcY * this.tanHalf;
    const near = ty / (this.sinP + ty * this.cosP);
    const far = ty / Math.max(0.05, this.sinP - ty * this.cosP);
    // Horizontal, medido en la profundidad del borde cercano (el caso más estrecho)
    const halfX = ndcX * this.tanHalf * this.camera.aspect * (1 - near * this.cosP);
    return { near, far, halfX };
  }

  /**
   * Cuánto piso hay hacia adelante del foco (por unidad de distancia de cámara) hasta el punto que se ve
   * a `ty` = ndcY · tan(fov/2) del centro de pantalla (negativo = hacia la cámara). Es lineal en la
   * distancia, así que sirve para ubicar el grupo a cualquier altura de pantalla.
   */
  ground(ty) {
    return ty / Math.max(0.05, this.sinP - ty * this.cosP);
  }

  /**
   * @param cars    autos a encuadrar (vivos)
   * @param leader  auto que va primero (o null)
   * @param yawGoal hacia dónde debe mirar la cámara (heading, misma convención que los autos)
   * @param snap    saltar sin suavizado (al reiniciar)
   */
  update(dt, cars, leader, yawGoal, snap = false) {
    this.endCinematic();
    if (snap) this.yaw = yawGoal;
    else this.yaw += wrapAngle(yawGoal - this.yaw) * (1 - Math.exp(-CAM.yawSmoothing * dt));

    // Ejes de la cámara sobre el piso: forward = hacia donde mira, right = derecha de pantalla
    this.fx = Math.sin(this.yaw);
    this.fz = Math.cos(this.yaw);
    this.rx = -this.fz;
    this.rz = this.fx;

    // Inclinación según la separación (antes del encuadre, que depende de ella)
    const pitch = this.pitchGoal(cars);
    this.setPitch(snap ? pitch : this.pitch + (pitch - this.pitch) * (1 - Math.exp(-CAM.pitchSmoothing * dt)));

    // Velocidad del grupo, suavizada: anticipa el encuadre sin que un choque lo sacuda
    if (cars.length > 0) {
      _v.set(0, 0, 0);
      for (const c of cars) _v.set(_v.x + c.velocity.x / cars.length, 0, _v.z + c.velocity.z / cars.length);
      if (snap) this.vel.copy(_v);
      else this.vel.lerp(_v, 1 - Math.exp(-CAM.velocitySmoothing * dt));
      this.computeTarget(cars, leader);
    }

    // El lente se abre con la velocidad promedio y se cierra al frenar. El encuadre (computeTarget,
    // hardDistance) usa el lente base: abrir más solo agrega pantalla alrededor, nunca deja a alguien afuera.
    if (this.view.speedFov > 0 && cars.length > 0) {
      const speed = cars.reduce((sum, c) => sum + Math.hypot(c.velocity.x, c.velocity.z), 0) / cars.length;
      const goal = clamp(speed / GAME_CONFIG.vehicle.maxSpeed, 0, 1);
      // Suave y con velocidad de cambio limitada: choques, saltos y frenadas no hacen "respirar" al lente
      const step = clamp((goal - this.speedK) * (1 - Math.exp(-CAM.fovSmoothing * dt)), -CAM.fovRate * dt, CAM.fovRate * dt);
      this.speedK = snap ? goal : this.speedK + step;
    } else this.speedK = 0;
    this.applyFov(this.fov);

    if (snap) {
      this.anchor.copy(this.target);
      this.distance = this.targetDistance;
    } else {
      // Paneo y altura con suavizados distintos: un salto o un desnivel mueve la cámara amortiguado
      const y = this.anchor.y + (this.target.y - this.anchor.y) * (1 - Math.exp(-CAM.heightSmoothing * dt));
      this.anchor.lerp(this.target, 1 - Math.exp(-CAM.smoothing * dt));
      this.anchor.y = y;
      const k = this.targetDistance > this.distance ? CAM.zoomOutSmoothing : CAM.zoomInSmoothing;
      this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-k * dt));
    }
    this.placeAim();
    if (snap) this.shift.copy(this.shiftTarget);
    else this.shift.lerp(this.shiftTarget, 1 - Math.exp(-CAM.aimSmoothing * dt));
    this.focus.addVectors(this.anchor, this.shift);
    // El suavizado nunca debe dejar a alguien fuera antes de llegar al máximo
    if (!snap) this.distance = Math.max(this.distance, Math.min(this.hardDistance(cars), this.maxDistance));

    // Detrás del foco (opuesto a forward) y elevada
    const D = this.distance;
    const back = D * this.cosP;
    this.camera.position.set(this.focus.x - this.fx * back, this.focus.y + D * this.sinP, this.focus.z - this.fz * back);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }

  /**
   * Festejo del ganador de la ronda: la cámara baja desde la vista de juego y orbita alrededor del
   * auto (de atrás, por el costado, hasta el frente), terminando a su altura. Suave y con lente más
   * cerrado. Cada pantalla lo calcula sola (también los invitados online).
   */
  cinematic(dt, car) {
    const C = CAM.cinematic;
    if (this.cine?.car !== car) {
      this.cine = { car, t: 0, from: this.camera.position.clone(), heading: car.heading, y: car.position.y };
    }
    const cine = this.cine;
    cine.t += dt;
    const total = GAME_CONFIG.race.celebrate;
    const smooth = (x) => x * x * (3 - 2 * x);
    const e = smooth(clamp(cine.t / total, 0, 1)); // avance del paneo (acelera y frena suave)
    const b = smooth(clamp(cine.t / C.blend, 0, 1)); // transición desde la cámara de juego
    const lerp = (r) => r[0] + (r[1] - r[0]) * e;
    // Los saltitos se siguen a medias (la cámara no tiembla)
    cine.y += (car.position.y - cine.y) * Math.min(1, dt * 2.5);
    const p = car.position;
    // Mira un poco por encima del auto: el auto queda en el tercio de abajo y el cartel tiene aire arriba
    const look = _v.set(p.x, cine.y * 0.5 + p.y * 0.5 + 1.05, p.z);
    const angle = cine.heading + C.startAngle + C.sweep * e;
    const d = lerp(C.distance);
    const orbit = new THREE.Vector3(p.x + Math.sin(angle) * d, cine.y + lerp(C.height), p.z + Math.cos(angle) * d);
    this.camera.position.lerpVectors(cine.from, orbit, b);
    cine.fov ??= this.camera.fov;
    this.applyFov(cine.fov + (C.fov - cine.fov) * b);
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld();
    // Foco (sombras, efecto miniatura) en el auto
    this.focus.copy(p);
    this.anchor.copy(p);
    this.shift.set(0, 0, 0);
    this.midpoint.copy(p);
  }

  /** Vuelve de la cámara del festejo a la de juego. */
  endCinematic() {
    if (!this.cine) return;
    this.cine = null;
    this.applyFov(this.fov);
  }

  /**
   * El encuadre se calcula en coordenadas locales de la cámara:
   * u = horizontal de pantalla, v = profundidad (v < 0 = adelante / arriba en pantalla).
   */
  computeTarget(cars, leader) {
    const toU = (x, z) => x * this.rx + z * this.rz;
    const toV = (x, z) => -(x * this.fx + z * this.fz);
    const pad = CAM.padding;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    const vu = toU(this.vel.x, this.vel.z);
    const vv = toV(this.vel.x, this.vel.z);
    this.midpoint.set(0, 0, 0);
    // Un auto más alto que el foco se ve más arriba en pantalla: cuenta como si estuviera más
    // adelante en el piso (en una mesa o un sillón, si no, se saldría por arriba sin que la cámara lo vea)
    let midY = 0;
    let mu = 0;
    let mv = 0;
    for (const c of cars) {
      midY += c.position.y / cars.length;
      mu += toU(c.position.x, c.position.z) / cars.length;
      mv += toV(c.position.x, c.position.z) / cars.length;
    }
    const lift = (c) => this.lift(-(toV(c.position.x, c.position.z) - mv), c.position.y - midY, this.distance);
    for (const c of cars) {
      const u = toU(c.position.x, c.position.z);
      const v = toV(c.position.x, c.position.z) - lift(c);
      minU = Math.min(minU, u - pad);
      maxU = Math.max(maxU, u + pad);
      minV = Math.min(minV, v - pad);
      maxV = Math.max(maxV, v + pad);
      this.midpoint.addScaledVector(c.position, 1 / cars.length);
    }
    this.playerDistance = cars.length > 1 ? cars[0].position.distanceTo(cars[1].position) : 0;

    // 1. Distancia necesaria para que ambos ocupen `framing` de la zona segura
    const safe = safeZoneNDC();
    const fit = this.extents(safe.x * CAM.framing, safe.y * CAM.framing);
    const needU = (maxU - minU) / (2 * fit.halfX);
    const needV = (maxV - minV) / (fit.near + fit.far);
    this.requiredDistance = Math.max(needU, needV);
    const D = clamp(this.requiredDistance, this.minDistance, this.maxDistance);
    this.targetDistance = D;

    // 2. Foco en el punto medio: centrado en la franja visible (compensando near/far) o, si la vista
    //    tiene `aim`, a esa altura de pantalla (el grupo abajo deja ver el camino de adelante)
    let tu = (minU + maxU) / 2 + vu * CAM.lookAhead;
    let tv = (minV + maxV) / 2 + vv * CAM.lookAhead;
    const toWorld = (out, u, v, y) => out.set(u * this.rx - v * this.fx, y, u * this.rz - v * this.fz);
    if (this.view.aim != null) {
      // La altura de pantalla y los límites se aplican en placeAim, sobre el punto ya suavizado
      const lim = leader && this.extents(safe.x * CAM.leaderFraming, safe.y * CAM.leaderFraming);
      this.aimFrame = {
        aheadK: this.ground(this.view.aim * this.tanHalf),
        near: fit.near,
        far: fit.far,
        minV,
        maxV,
        lim,
        lu: leader ? toU(leader.position.x, leader.position.z) : 0,
        lv: leader ? toV(leader.position.x, leader.position.z) - lift(leader) : 0,
      };
      toWorld(this.target, tu, tv, this.midpoint.y);
      return;
    }
    tv -= ((fit.near - fit.far) * D) / 2;

    // 3. Límite máximo alcanzado: el foco no se aleja del líder más de lo que permite
    //    la zona segura. El que va atrás queda afuera; la cámara no lo "rescata".
    if (leader) {
      const lim = this.extents(safe.x * CAM.leaderFraming, safe.y * CAM.leaderFraming);
      const lu = toU(leader.position.x, leader.position.z);
      const lv = toV(leader.position.x, leader.position.z) - lift(leader);
      tu = clamp(tu, lu - lim.halfX * D, lu + lim.halfX * D);
      tv = clamp(tv, lv - lim.near * D, lv + lim.far * D);
    }

    // Volver a coordenadas de mundo (la altura del foco sigue la altura media de los autos)
    toWorld(this.target, tu, tv, this.midpoint.y);
  }

  /**
   * Vistas con `aim`: corre el foco desde donde está el punto suavizado para que el grupo quede a esa
   * altura de pantalla mientras sobre lugar; si no, lo más cerca posible sin que nadie salga de la franja
   * (separados, ocupan toda la franja como en la vista clásica, así la distancia no crece por esto).
   * Después, como en la clásica, el foco no se aleja del líder más de lo que permite la zona segura.
   */
  placeAim() {
    const A = this.view.aim != null && this.aimFrame;
    if (!A) {
      this.shiftTarget.set(0, 0, 0);
      return;
    }
    const D = this.distance;
    const au = this.anchor.x * this.rx + this.anchor.z * this.rz;
    const av = -(this.anchor.x * this.fx + this.anchor.z * this.fz);
    const lo = A.maxV - A.near * D; // más atrás no: el último saldría por abajo
    const hi = A.minV + A.far * D; // más adelante no: el primero saldría por arriba
    let tv = clamp(av + A.aheadK * D, Math.min(lo, hi), Math.max(lo, hi));
    let tu = au;
    if (A.lim) {
      tu = clamp(tu, A.lu - A.lim.halfX * D, A.lu + A.lim.halfX * D);
      tv = clamp(tv, A.lv - A.lim.near * D, A.lv + A.lim.far * D);
    }
    const du = tu - au;
    const dv = tv - av;
    this.shiftTarget.set(du * this.rx - dv * this.fx, 0, du * this.rz - dv * this.fz);
  }

  /**
   * Distancia mínima para que, con el foco actual, todos los autos queden dentro de la
   * zona segura (con un pequeño margen interno de `hardFraming`).
   */
  hardDistance(cars) {
    const safe = safeZoneNDC();
    const e = this.extents(safe.x * CAM.hardFraming, safe.y * CAM.hardFraming);
    // La altura de un auto depende de la distancia de la cámara (ver lift): dos pasadas alcanzan
    let D = this.distance;
    for (let pass = 0; pass < 2; pass++) {
      const est = Math.max(D, this.minDistance);
      D = 0;
      for (const c of cars) {
        const dx = c.position.x - this.focus.x;
        const dz = c.position.z - this.focus.z;
        const u = dx * this.rx + dz * this.rz;
        const v0 = -(dx * this.fx + dz * this.fz); // v < 0 = adelante (arriba en pantalla)
        const v = v0 - this.lift(-v0, c.position.y - this.focus.y, est);
        D = Math.max(D, Math.abs(u) / e.halfX, v < 0 ? -v / e.far : v / e.near);
      }
    }
    return D;
  }

  /**
   * Un punto a `dy` de altura sobre el foco y `a` unidades por delante (sobre el piso) se ve en
   * pantalla donde se vería un punto del piso a a + lift: cuánto "más adelante" cuenta por estar
   * alto (en una mesa o un sillón). Proyección exacta con la cámara a distancia D.
   */
  lift(a, dy, D) {
    const H = D * this.sinP; // altura de la cámara sobre el foco
    const B = D * this.cosP; // distancia horizontal de la cámara al foco
    const k = H / Math.max(H * 0.2, H - dy); // si el punto llegara a la altura de la cámara, se acota
    return (B + a) * k - B - a;
  }

  /** Posición en pantalla normalizada (-1..1) de un punto del mundo. */
  toNDC(pos) {
    _v.set(pos.x, pos.y + 0.5, pos.z).project(this.camera);
    return { x: _v.x, y: _v.y, behind: _v.z > 1 };
  }

  /** ¿Está el punto dentro de la zona segura? top: false = salir por arriba no cuenta. */
  isInSafeZone(pos, { top = true } = {}) {
    const p = this.toNDC(pos);
    const safe = safeZoneNDC();
    return !p.behind && Math.abs(p.x) <= safe.x && p.y >= -safe.y && (!top || p.y <= safe.y);
  }
}
