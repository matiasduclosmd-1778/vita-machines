import * as THREE from 'three';

const MAX = 600;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Partículas simples compartidas por todos los efectos: un único InstancedMesh de cubitos
 * que se achican hasta desaparecer. Barato y sin texturas.
 */
export class Particles {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    // El buffer de colores existe desde el principio: si se creara con la primera partícula, el
    // material cambiaría y se recompilaría en plena carrera (un tirón)
    this.mesh.setColorAt(0, new THREE.Color('#ffffff'));
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.list = [];
  }

  /**
   * @param pos   {x,y,z}
   * @param vel   {x,y,z}
   * @param opts  { life, size, color, gravity, drag }
   */
  emit(pos, vel, { life = 0.6, size = 0.3, color = '#ffffff', gravity = 0, drag = 2 } = {}) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: vel.x, vy: vel.y, vz: vel.z,
      life, maxLife: life, size, gravity, drag,
      color: _c.set(color).getHex(),
      rot: Math.random() * Math.PI,
    });
  }

  /** Estallido radial. */
  burst(pos, count, { speed = 8, up = 4, ...opts } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(pos, { x: Math.cos(a) * s, y: up * Math.random(), z: Math.sin(a) * s }, opts);
    }
  }

  update(dt) {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      p.rot += dt * 4;
      const sc = p.size * (p.life / p.maxLife);
      _q.setFromAxisAngle(_s.set(0.3, 1, 0.2).normalize(), p.rot);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c.setHex(p.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.list.length = 0;
    this.mesh.count = 0;
  }
}
