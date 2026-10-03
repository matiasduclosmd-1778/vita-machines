import * as THREE from 'three';

/**
 * Camino muestreado como polilínea (cerrada = circuito, abierta = atajo).
 * Además de la geometría 2D guarda, por muestra: altura, medio ancho, paredes por lado y huecos (sin piso).
 * `halfWidth` es el medio ancho máximo; el de cada muestra está en `hw` (tramos angostos).
 */
export class TrackPath {
  /**
   * @param controlPoints [[x, z], …]
   * @param samples       cantidad de muestras
   * @param closed        circuito cerrado o camino abierto
   * @param halfWidth     medio ancho del camino
   */
  constructor(controlPoints, samples, closed, halfWidth) {
    this.closed = closed;
    this.halfWidth = halfWidth;
    const curve = new THREE.CatmullRomCurve3(
      controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      closed,
      'centripetal',
    );
    const pts = curve.getSpacedPoints(samples);
    if (closed) pts.pop(); // en curvas cerradas el último punto repite el primero
    this.points = pts.map((p) => ({ x: p.x, z: p.z }));
    const n = this.points.length;
    this.segCount = closed ? n : n - 1;

    this.segDir = [];
    this.segLen = [];
    this.cum = [0];
    for (let i = 0; i < this.segCount; i++) {
      const a = this.points[i];
      const b = this.points[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      this.segLen.push(len);
      this.segDir.push({ x: (b.x - a.x) / len, z: (b.z - a.z) / len });
      this.cum.push(this.cum[i] + len);
    }
    this.length = this.cum[this.segCount];

    // Normal izquierda por punto (promedio de segmentos vecinos)
    this.normals = this.points.map((_, i) => {
      const d0 = this.segDir[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const d1 = this.segDir[closed ? i : Math.min(this.segCount - 1, i)];
      const tx = d0.x + d1.x;
      const tz = d0.z + d1.z;
      const l = Math.hypot(tx, tz);
      return { x: tz / l, z: -tx / l };
    });

    // Atributos por muestra (los completa Track según el diseño de la pista)
    this.height = new Float32Array(n);
    this.wallLeft = new Uint8Array(n).fill(1);
    this.wallRight = new Uint8Array(n).fill(1);
    this.gap = new Uint8Array(n);
    this.respawnable = new Uint8Array(n).fill(1);
    this.hw = new Float32Array(n).fill(halfWidth);
  }

  /** Medio ancho en la muestra i. */
  halfWidthAt(i) {
    return this.hw[i];
  }

  get count() {
    return this.points.length;
  }

  /** s normalizado: en circuitos da la vuelta, en caminos abiertos se limita. */
  wrapS(s) {
    if (this.closed) return ((s % this.length) + this.length) % this.length;
    return Math.min(this.length, Math.max(0, s));
  }

  /** Segmento que contiene s (búsqueda binaria). */
  segmentAt(s) {
    let lo = 0;
    let hi = this.segCount;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Índice de muestra más cercano a s. */
  indexAt(s) {
    s = this.wrapS(s);
    const lo = this.segmentAt(s);
    const i = s - this.cum[lo] > this.segLen[lo] / 2 ? lo + 1 : lo;
    return i % this.count;
  }

  /** Distancia de s1 a s2 en el sentido de avance (en circuitos, siempre positiva). */
  forward(s1, s2) {
    const d = s2 - s1;
    return this.closed ? ((d % this.length) + this.length) % this.length : d;
  }

  /** Punto más cercano de la línea central a (x, z). */
  project(x, z, out = {}) {
    let best = Infinity;
    let bi = 0;
    let bt = 0;
    for (let i = 0; i < this.segCount; i++) {
      const a = this.points[i];
      const d = this.segDir[i];
      let t = (x - a.x) * d.x + (z - a.z) * d.z;
      t = t < 0 ? 0 : t > this.segLen[i] ? this.segLen[i] : t;
      const qx = a.x + d.x * t;
      const qz = a.z + d.z * t;
      const dd = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (dd < best) {
        best = dd;
        bi = i;
        bt = t;
      }
    }
    const a = this.points[bi];
    const d = this.segDir[bi];
    const qx = a.x + d.x * bt;
    const qz = a.z + d.z * bt;
    const dist = Math.sqrt(best);
    out.s = this.cum[bi] + bt;
    out.i = bt > this.segLen[bi] / 2 ? (bi + 1) % this.count : bi;
    out.dist = dist;
    // Dirección desde la línea central hacia el punto (normal de empuje de pared)
    out.dirX = dist > 1e-6 ? (x - qx) / dist : d.z;
    out.dirZ = dist > 1e-6 ? (z - qz) / dist : -d.x;
    out.offset = dist * Math.sign((x - qx) * d.z - (z - qz) * d.x || 1);
    return out;
  }

  /** Posición a una distancia s, desplazada lateralmente (offset > 0 = izquierda). */
  pointAt(s, offset = 0) {
    s = this.wrapS(s);
    const i = this.segmentAt(s);
    const t = Math.min(1, (s - this.cum[i]) / this.segLen[i]);
    const n = this.count;
    const a = this.points[i];
    const b = this.points[(i + 1) % n];
    const na = this.normals[i];
    const nb = this.normals[(i + 1) % n];
    const d = this.segDir[i];
    return {
      x: a.x + (b.x - a.x) * t + (na.x + (nb.x - na.x) * t) * offset,
      z: a.z + (b.z - a.z) * t + (na.z + (nb.z - na.z) * t) * offset,
      y: this.height[i] + (this.height[(i + 1) % n] - this.height[i]) * t,
      heading: Math.atan2(d.x, d.z),
    };
  }

  /**
   * Altura del piso en s. Un tramo que empieza dentro de un hueco usa la altura de su
   * extremo con piso (el borde de aterrizaje no se mezcla con el aire del hueco).
   */
  heightAt(s) {
    s = this.wrapS(s);
    const i = this.segmentAt(s);
    const j = (i + 1) % this.count;
    if (this.gap[i]) return this.height[j];
    const t = Math.min(1, (s - this.cum[i]) / this.segLen[i]);
    return this.height[i] + (this.height[j] - this.height[i]) * t;
  }
}
