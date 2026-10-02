import * as THREE from 'three';
import { GAME_CONFIG, POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';

const CFG = POWERUP_CONFIG.heart;

/** Corazón de vida: un corazón que sube sobre el auto y un anillo que se abre (solo visual). */
export class HealEffect extends Effect {
  static id = 'HEAL';
  static label = '+VIDA';

  start() {
    // Corazón: dos lóbulos y una punta (forma 2D extruida)
    const s = new THREE.Shape();
    s.moveTo(0, -0.55);
    s.bezierCurveTo(-0.15, -0.35, -0.75, -0.1, -0.75, 0.25);
    s.bezierCurveTo(-0.75, 0.6, -0.3, 0.75, 0, 0.42);
    s.bezierCurveTo(0.3, 0.75, 0.75, 0.6, 0.75, 0.25);
    s.bezierCurveTo(0.75, -0.1, 0.15, -0.35, 0, -0.55);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 });
    geo.center();
    this.heart = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: CFG.color, emissive: CFG.color, emissiveIntensity: 0.6, roughness: 0.35, transparent: true }),
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.15, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd1dc', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.15;
    this.heart.position.y = 2;
    this.car.mesh.add(this.heart, this.ring);
    const p = this.car.position;
    this.ctx.particles.burst({ x: p.x, y: p.y + 1.2, z: p.z }, 24, { color: CFG.color, speed: 5, up: 6, size: 0.3 });
    this.ctx.particles.burst({ x: p.x, y: p.y + 1.2, z: p.z }, 12, { color: '#ffffff', speed: 3, up: 7, size: 0.2 });
  }

  update() {
    const k = 1 - this.remaining / this.duration; // 0 → 1
    this.heart.position.y = 2 + k * 1.6;
    this.heart.rotation.y = k * Math.PI * 2;
    this.heart.scale.setScalar(0.6 + Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) * 0.5);
    this.heart.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    this.ring.scale.setScalar(1 + k * 2.5);
    this.ring.material.opacity = 0.8 * (1 - k);
  }

  end() {
    this.car.mesh.remove(this.heart, this.ring);
    this.heart.geometry.dispose();
    this.ring.geometry.dispose();
  }
}

export const Heart = {
  id: 'HEART',
  name: 'HEART',
  icon: '❤️',
  color: CFG.color,
  config: CFG,
  use(ctx, car) {
    car.health = GAME_CONFIG.health.max; // vida completa
    ctx.effects.add(car, HealEffect, CFG.duration);
  },
};
