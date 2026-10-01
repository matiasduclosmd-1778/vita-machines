import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';

const CFG = POWERUP_CONFIG.magnet;
const ARCS = 3;
const ARC_POINTS = 20;

/** Durante unos segundos atrae moderadamente al rival hacia el usuario. */
export class MagnetEffect extends Effect {
  static id = 'MAGNET';
  static label = 'MAGNET';

  start() {
    this.target = null;
    this.pulling = false;
    this.time = 0;

    // Imán de herradura sobre el auto
    this.icon = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 0.6, roughness: 0.3 });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.17, 10, 20, Math.PI), red);
    arc.rotation.z = Math.PI;
    for (const x of [-0.5, 0.5]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10), steel);
      leg.position.set(x, 0.15, 0);
      this.icon.add(leg);
    }
    this.icon.add(arc);
    this.icon.position.y = 3.2;
    this.car.mesh.add(this.icon);

    // Arcos visuales entre los dos autos
    this.arcs = [];
    for (let i = 0; i < ARCS; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: ARC_POINTS }, () => new THREE.Vector3()));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: i % 2 ? '#c77dff' : '#ff4dd2', transparent: true, opacity: 0.85 }));
      line.frustumCulled = false;
      line.visible = false;
      this.ctx.scene.add(line);
      this.arcs.push(line);
    }
  }

  // Online: el invitado no simula; recibe a quién atrae y si está tirando
  netExtra() {
    return [this.target ? this.ctx.cars.indexOf(this.target) : -1, this.pulling ? 1 : 0];
  }

  applyNetExtra([target, pulling]) {
    this.target = this.ctx.cars[target] ?? null;
    this.pulling = !!pulling;
  }

  fixedUpdate(dt) {
    const target = this.ctx.rivalOf(this.car);
    this.target = target;
    this.pulling = false;
    if (!target) return;
    const dx = this.car.position.x - target.position.x;
    const dz = this.car.position.z - target.position.z;
    const d = Math.hypot(dx, dz);
    if (d > CFG.maxDistance || d < CFG.minDistance) return;
    if (!this.ctx.tryAffect(target, { strong: false })) return;
    // Fuerza moderada sobre la velocidad del rival: no teletransporta ni toca su dirección
    target.velocity.x += (dx / d) * CFG.force * dt;
    target.velocity.z += (dz / d) * CFG.force * dt;
    this.pulling = true;
  }

  update(dt) {
    this.time += dt;
    this.icon.rotation.y += dt * 3;
    this.icon.position.y = 3.2 + Math.sin(this.time * 6) * 0.15;
    const show = this.pulling && this.target;
    for (const [i, line] of this.arcs.entries()) {
      line.visible = !!show;
      if (!show) continue;
      const a = this.target.position;
      const b = this.car.position;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len; // perpendicular
      const pz = dx / len;
      const pos = line.geometry.attributes.position;
      for (let k = 0; k < ARC_POINTS; k++) {
        const t = k / (ARC_POINTS - 1);
        const wave = Math.sin(t * Math.PI * 3 + this.time * 14 + i * 2) * Math.sin(t * Math.PI) * (0.6 + i * 0.25);
        const lift = Math.sin(t * Math.PI) * (1 + i * 0.5);
        pos.setXYZ(k, a.x + dx * t + px * wave, a.y + (b.y - a.y) * t + 0.8 + lift, a.z + dz * t + pz * wave);
      }
      pos.needsUpdate = true;
    }
    // Chispas que viajan del rival hacia el usuario
    if (show && Math.random() < 0.6) {
      const a = this.target.position;
      const b = this.car.position;
      this.ctx.particles.emit(
        { x: a.x, y: a.y + 1, z: a.z },
        { x: (b.x - a.x) * 1.6, y: 0.5, z: (b.z - a.z) * 1.6 },
        { life: 0.55, size: 0.22, color: '#ff4dd2', drag: 0 },
      );
    }
  }

  end() {
    this.car.mesh.remove(this.icon);
    this.icon.traverse((m) => m.geometry?.dispose());
    for (const line of this.arcs) {
      this.ctx.scene.remove(line);
      line.geometry.dispose();
    }
  }
}

export const Magnet = {
  id: 'MAGNET',
  name: 'MAGNET',
  icon: '🧲',
  color: '#c77dff',
  config: CFG,
  use(ctx, car) {
    ctx.effects.add(car, MagnetEffect, CFG.duration);
  },
};
