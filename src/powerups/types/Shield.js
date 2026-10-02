import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';

const CFG = POWERUP_CONFIG.shield;

/** Cúpula protectora: bloquea bomba, misil, aceite e imán mientras dura. */
export class ShieldEffect extends Effect {
  static id = 'SHIELD';
  static label = 'SHIELD';

  start() {
    this.flash = 0;
    this.group = new THREE.Group();
    this.group.position.y = 0.7;
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(CFG.radius, 32, 16),
      // Pompa de jabón: vidrio finísimo con reflejos tornasolados
      new THREE.MeshPhysicalMaterial({
        color: '#dff8ff',
        transmission: 1,
        thickness: 0.05,
        roughness: 0,
        ior: 1.2,
        iridescence: 1,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [250, 800],
        emissive: '#38c7ff',
        emissiveIntensity: 0.05,
        depthWrite: false,
      }),
    );
    this.wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(CFG.radius * 1.02, 1),
      new THREE.MeshBasicMaterial({ color: '#bff6ff', wireframe: true, transparent: true, opacity: 0.45 }),
    );
    this.group.add(this.bubble, this.wire);
    this.car.mesh.add(this.group);
    this.ctx.particles.burst({ x: this.car.position.x, y: this.car.position.y + 1, z: this.car.position.z }, 16, { color: '#7fe8ff', speed: 6, size: 0.25 });
  }

  /** Recibe un ataque: siempre protege. Si el golpe es fuerte, puede romperse. */
  absorb(strong) {
    if (this.flash < 0.3) {
      const p = this.car.position;
      this.ctx.particles.burst({ x: p.x, y: p.y + 1, z: p.z }, strong ? 26 : 8, { color: '#bff6ff', speed: strong ? 12 : 5, size: 0.3 });
    }
    this.flash = 1;
    this.ctx.sound('shield-hit', this.car.position);
    if (strong && CFG.consumeOnBomb) this.remaining = Math.min(this.remaining, 0.25);
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 3);
    this.wire.rotation.y += dt * 0.8;
    this.wire.rotation.x += dt * 0.3;
    this.group.scale.setScalar(1 + this.flash * 0.25);
    this.bubble.material.emissiveIntensity = 0.05 + this.flash * 1.5;
    // Parpadea en el último segundo para avisar que se termina
    this.group.visible = this.remaining > 1 || Math.floor(this.remaining * 10) % 2 === 0;
  }

  end() {
    this.car.mesh.remove(this.group);
    this.bubble.geometry.dispose();
    this.wire.geometry.dispose();
  }
}

export const Shield = {
  id: 'SHIELD',
  name: 'SHIELD',
  icon: '🛡️',
  color: '#38c7ff',
  config: CFG,
  use(ctx, car) {
    ctx.effects.add(car, ShieldEffect, CFG.duration);
  },
};
