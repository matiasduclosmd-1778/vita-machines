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
    this.camera = new THREE.PerspectiveCamera(CAM.fov, aspect, 0.5, 2000);
    this.tanHalf = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
    this.sinP = Math.sin(CAM.pitch);
    this.cosP = Math.cos(CAM.pitch);
    this.focus = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.midpoint = new THREE.Vector3();
    this.distance = CAM.minDistance;
    this.targetDistance = CAM.minDistance;
    this.requiredDistance = CAM.minDistance; // la que haría falta sin límite máximo
    this.playerDistance = 0;
    this.yaw = 0;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** true cuando los jugadores no entran ni con la distancia máxima. */
  get atMaxDistance() {
    return this.requiredDistance >= CAM.maxDistance;
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
   * @param cars    autos a encuadrar (vivos)
   * @param leader  auto que va primero (o null)
   * @param yawGoal hacia dónde debe mirar la cámara (heading, misma convención que los autos)
   * @param snap    saltar sin suavizado (al reiniciar)
   * @param closeup distancia fija de cámara (festejo del ganador de la ronda) o null
   */
  update(dt, cars, leader, yawGoal, snap = false, closeup = null) {
    this.closeup = closeup;
    if (snap) this.yaw = yawGoal;
    else this.yaw += wrapAngle(yawGoal - this.yaw) * (1 - Math.exp(-CAM.yawSmoothing * dt));

    // Ejes de la cámara sobre el piso: forward = hacia donde mira, right = derecha de pantalla
    this.fx = Math.sin(this.yaw);
    this.fz = Math.cos(this.yaw);
    this.rx = -this.fz;
    this.rz = this.fx;

    if (cars.length > 0) this.computeTarget(cars, leader);

    if (snap) {
      this.focus.copy(this.target);
      this.distance = this.targetDistance;
    } else {
      this.focus.lerp(this.target, 1 - Math.exp(-CAM.smoothing * dt));
      const k = this.closeup != null ? 3.5 : this.targetDistance > this.distance ? CAM.zoomOutSmoothing : CAM.zoomInSmoothing;
      this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-k * dt));
      // El suavizado nunca debe dejar a alguien fuera antes de llegar al máximo (salvo en el primer plano del festejo)
      if (this.closeup == null) this.distance = Math.max(this.distance, Math.min(this.hardDistance(cars), CAM.maxDistance));
    }

    // Detrás del foco (opuesto a forward) y elevada
    const D = this.distance;
    const back = D * this.cosP;
    this.camera.position.set(this.focus.x - this.fx * back, this.focus.y + D * this.sinP, this.focus.z - this.fz * back);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
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
    let vu = 0;
    let vv = 0;
    this.midpoint.set(0, 0, 0);
    for (const c of cars) {
      const u = toU(c.position.x, c.position.z);
      const v = toV(c.position.x, c.position.z);
      minU = Math.min(minU, u - pad);
      maxU = Math.max(maxU, u + pad);
      minV = Math.min(minV, v - pad);
      maxV = Math.max(maxV, v + pad);
      vu += toU(c.velocity.x, c.velocity.z) / cars.length;
      vv += toV(c.velocity.x, c.velocity.z) / cars.length;
      this.midpoint.addScaledVector(c.position, 1 / cars.length);
    }
    this.playerDistance = cars.length > 1 ? cars[0].position.distanceTo(cars[1].position) : 0;

    // 1. Distancia necesaria para que ambos ocupen `framing` de la zona segura
    const safe = safeZoneNDC();
    const fit = this.extents(safe.x * CAM.framing, safe.y * CAM.framing);
    const needU = (maxU - minU) / (2 * fit.halfX);
    const needV = (maxV - minV) / (fit.near + fit.far);
    this.requiredDistance = Math.max(needU, needV);
    const D = this.closeup ?? clamp(this.requiredDistance, CAM.minDistance, CAM.maxDistance);
    this.targetDistance = D;

    // 2. Foco en el punto medio (centrado en la franja visible, compensando near/far)
    let tu = (minU + maxU) / 2 + vu * CAM.lookAhead;
    let tv = (minV + maxV) / 2 - ((fit.near - fit.far) * D) / 2 + vv * CAM.lookAhead;

    // 3. Límite máximo alcanzado: el foco no se aleja del líder más de lo que permite
    //    la zona segura. El que va atrás queda afuera; la cámara no lo "rescata".
    if (leader) {
      const lim = this.extents(safe.x * CAM.leaderFraming, safe.y * CAM.leaderFraming);
      const lu = toU(leader.position.x, leader.position.z);
      const lv = toV(leader.position.x, leader.position.z);
      tu = clamp(tu, lu - lim.halfX * D, lu + lim.halfX * D);
      tv = clamp(tv, lv - lim.near * D, lv + lim.far * D);
    }

    // Volver a coordenadas de mundo (la altura del foco sigue la altura media de los autos)
    this.target.set(tu * this.rx - tv * this.fx, this.midpoint.y, tu * this.rz - tv * this.fz);
  }

  /**
   * Distancia mínima para que, con el foco actual, todos los autos queden dentro de la
   * zona segura (con un pequeño margen interno de `hardFraming`).
   */
  hardDistance(cars) {
    const safe = safeZoneNDC();
    const e = this.extents(safe.x * CAM.hardFraming, safe.y * CAM.hardFraming);
    let D = 0;
    for (const c of cars) {
      const dx = c.position.x - this.focus.x;
      const dz = c.position.z - this.focus.z;
      const u = dx * this.rx + dz * this.rz;
      const v = -(dx * this.fx + dz * this.fz); // v < 0 = adelante (arriba en pantalla)
      D = Math.max(D, Math.abs(u) / e.halfX, v < 0 ? -v / e.far : v / e.near);
    }
    return D;
  }

  /** Posición en pantalla normalizada (-1..1) de un punto del mundo. */
  toNDC(pos) {
    _v.set(pos.x, pos.y + 0.5, pos.z).project(this.camera);
    return { x: _v.x, y: _v.y, behind: _v.z > 1 };
  }

  /** ¿Está el punto dentro de la zona segura? */
  isInSafeZone(pos) {
    const p = this.toNDC(pos);
    const safe = safeZoneNDC();
    return !p.behind && Math.abs(p.x) <= safe.x && Math.abs(p.y) <= safe.y;
  }
}
