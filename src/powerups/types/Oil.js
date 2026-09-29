import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';
import { liquid } from '../../world/materials.js';

const CFG = POWERUP_CONFIG.oil;

/** Resbalando: poco grip y menos dirección por un momento. */
export class SlippingEffect extends Effect {
  static id = 'SLIPPING';
  static label = 'SLIPPING';

  start() {
    this.emitAcc = 0;
    this.car.spin += (Math.random() < 0.5 ? -1 : 1) * CFG.spin;
    const p = this.car.position;
    this.ctx.particles.burst({ x: p.x, y: p.y + 0.2, z: p.z }, 12, { color: '#2b2233', speed: 5, up: 3, size: 0.3, gravity: 12 });
  }

  modify(mods) {
    mods.grip *= CFG.frictionMultiplier;
    mods.steer *= CFG.steerMultiplier;
  }

  update(dt) {
    // Humito de las ruedas mientras derrapa
    const car = this.car;
    if (car.speed < 3) return;
    this.emitAcc += dt * 30;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      this.ctx.particles.emit(
        { x: car.position.x - fx * 0.8 + fz * 0.6 * side, y: car.position.y + 0.25, z: car.position.z - fz * 0.8 - fx * 0.6 * side },
        { x: (Math.random() - 0.5) * 2, y: 1.5, z: (Math.random() - 0.5) * 2 },
        { life: 0.5, size: 0.4, color: '#d9d9d9' },
      );
    }
  }
}

/** Mancha de aceite que queda en la pista durante `lifetime`. */
class OilSlick {
  constructor(ctx, owner) {
    this.ctx = ctx;
    this.owner = owner;
    this.age = 0;
    const fx = Math.sin(owner.heading);
    const fz = Math.cos(owner.heading);
    let x = owner.position.x - fx * 2.8;
    let z = owner.position.z - fz * 2.8;
    // Mantenerla sobre la pista: si detrás no hay piso (borde, hueco), queda debajo del auto
    let g = ctx.track.groundAt(x, z, owner.position.y + 1);
    if (!g.onTrack) {
      x = owner.position.x;
      z = owner.position.z;
      g = ctx.track.groundAt(x, z, owner.position.y + 1);
    }
    this.x = x;
    this.y = g.onTrack ? g.h : owner.position.y;
    this.z = z;

    this.mesh = new THREE.Mesh(
      blobGeometry(CFG.radius),
      liquid('#141018', { iridescence: 1 }), // aceite con brillo tornasolado
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.rotation.z = Math.random() * Math.PI * 2;
    this.mesh.position.set(x, this.y + 0.03, z);
    this.mesh.receiveShadow = true;
    ctx.scene.add(this.mesh);
    ctx.particles.burst({ x, y: this.y + 0.3, z }, 10, { color: '#2b2233', speed: 4, up: 3, size: 0.25, gravity: 12 });
  }

  fixedUpdate(dt) {
    this.age += dt;
    for (const car of this.ctx.cars) {
      if (!car.alive) continue;
      if (car === this.owner && this.age < CFG.ownerGrace) continue;
      if (Math.hypot(car.position.x - this.x, car.position.z - this.z) > CFG.radius + 0.4) continue;
      if (Math.abs(car.position.y - this.y) > 1 || !car.grounded) continue;
      if (this.ctx.tryAffect(car, { strong: false })) this.ctx.effects.add(car, SlippingEffect, CFG.slipperyDuration);
    }
    return this.age < CFG.lifetime;
  }

  update() {
    // Se achica en el último segundo
    const k = Math.min(1, (CFG.lifetime - this.age) / 1);
    this.mesh.scale.setScalar(Math.max(0.01, k));
  }

  dispose() {
    this.ctx.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

/** Círculo con borde irregular. */
function blobGeometry(radius) {
  const shape = new THREE.Shape();
  const n = 18;
  const phase = Math.random() * 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius * (0.82 + 0.18 * Math.sin(a * 3 + phase) + 0.08 * Math.sin(a * 7 + phase * 2));
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape, 4);
}

export const Oil = {
  id: 'OIL',
  name: 'OIL',
  icon: '🛢️',
  color: '#8e7cc3',
  config: CFG,
  use(ctx, car) {
    ctx.spawn(new OilSlick(ctx, car));
  },
};
