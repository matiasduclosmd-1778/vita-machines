import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';
import { chrome, glow } from '../../world/materials.js';

const CFG = POWERUP_CONFIG.bomb;
const RADIUS = 0.45;

/** Pérdida de control después de recibir una bomba. */
export class StunnedEffect extends Effect {
  static id = 'STUNNED';
  static label = 'STUNNED';

  start() {
    // Estrellitas girando sobre el auto
    this.stars = new THREE.Group();
    this.stars.position.y = 2;
    const geo = new THREE.OctahedronGeometry(0.22);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffe14d' });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(geo, mat);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
      this.stars.add(s);
    }
    this.car.mesh.add(this.stars);
  }

  modify(mods) {
    mods.steer *= CFG.stunSteer;
    mods.grip *= CFG.stunGrip;
    mods.throttle *= 0.4;
  }

  update(dt) {
    this.stars.rotation.y += dt * 7;
  }

  end() {
    this.car.mesh.remove(this.stars);
    this.stars.children[0].geometry.dispose();
  }
}

/** Proyectil que avanza en línea recta hasta chocar o agotarse. */
class BombProjectile {
  constructor(ctx, owner) {
    this.ctx = ctx;
    this.owner = owner;
    const fx = Math.sin(owner.heading);
    const fz = Math.cos(owner.heading);
    const speed = Math.max(CFG.speed, owner.forwardSpeed + 14);
    this.pos = new THREE.Vector3(owner.position.x + fx * 2.2, owner.position.y + 0.5, owner.position.z + fz * 2.2);
    this.vy = 0;
    this.vel = new THREE.Vector3(fx * speed, 0, fz * speed);
    this.age = 0;
    this.travelled = 0;

    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 32, 20),
      new THREE.MeshPhysicalMaterial({ color: '#1c1c22', roughness: 0.25, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
    body.castShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 16), chrome());
    cap.position.y = RADIUS;
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow('#ffcc44', 6));
    this.spark.position.y = RADIUS + 0.2;
    this.mesh.add(body, cap, this.spark);
    this.mesh.position.copy(this.pos);
    ctx.scene.add(this.mesh);
  }

  /** Devuelve false cuando terminó. */
  fixedUpdate(dt) {
    const { ctx } = this;
    this.pos.addScaledVector(this.vel, dt);
    this.age += dt;
    this.travelled += this.vel.length() * dt;

    // Sigue el piso de la pista; si no hay piso debajo, cae
    const g = ctx.track.groundAt(this.pos.x, this.pos.z, this.pos.y - 0.5);
    if (g.onTrack && this.pos.y - 0.5 <= g.h + 0.6) {
      this.pos.y = g.h + 0.5;
      this.vy = 0;
    } else {
      this.vy -= 42 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < g.h + 0.5 || this.vy < -25) {
        ctx.explosion(this.pos, 0.4);
        return false;
      }
    }

    // Contra otro auto
    for (const car of ctx.cars) {
      if (car === this.owner || !car.alive || Math.abs(car.position.y + 0.5 - this.pos.y) > 1.6) continue;
      for (const c of car.circles) {
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < CFG.hitRadius + c.r * 0.5) {
          this.hit(car);
          return false;
        }
      }
    }
    // Contra pared u obstáculo: desaparece con un pequeño estallido
    const hitsObstacle = ctx.track.obstacles.some((o) => Math.abs(o.y + 0.5 - this.pos.y) < 1.5 && Math.hypot(o.x - this.pos.x, o.z - this.pos.z) < o.r + RADIUS);
    if (ctx.track.hitsWall(this.pos.x, this.pos.y - 0.5, this.pos.z, RADIUS) || hitsObstacle) {
      ctx.explosion(this.pos, 0.5);
      return false;
    }
    if (this.age > CFG.lifetime || this.travelled > CFG.maxDistance) {
      ctx.explosion(this.pos, 0.4);
      return false;
    }
    return true;
  }

  hit(target) {
    const { ctx } = this;
    ctx.explosion(this.pos, 1);
    if (!ctx.tryAffect(target, { strong: true })) return;

    // Empujón: mezcla de la dirección de la bomba y del centro de la explosión hacia el auto
    const dir = new THREE.Vector3(target.position.x - this.pos.x, 0, target.position.z - this.pos.z).normalize();
    dir.addScaledVector(this.vel.clone().normalize(), 1).normalize();
    target.velocity.addScaledVector(dir, CFG.pushForce);
    target.bumpVel += CFG.upKick * 0.15;
    target.spin += (Math.random() < 0.5 ? -1 : 1) * CFG.spin;
    ctx.effects.add(target, StunnedEffect, CFG.stunDuration);
  }

  update(dt) {
    // Rebotes cortos mientras avanza
    this.mesh.position.set(this.pos.x, this.pos.y + Math.abs(Math.sin(this.age * 11)) * 0.35, this.pos.z);
    this.mesh.rotation.x += dt * 12;
    this.spark.visible = Math.random() < 0.7;
    if (Math.random() < 0.5) {
      this.ctx.particles.emit(this.mesh.position, { x: 0, y: 2, z: 0 }, { life: 0.25, size: 0.15, color: '#ffcc33' });
    }
  }

  dispose() {
    this.ctx.scene.remove(this.mesh);
    this.mesh.traverse((m) => m.geometry?.dispose());
  }
}

export const Bomb = {
  id: 'BOMB',
  name: 'BOMB',
  icon: '💣',
  color: '#ff4d6d',
  config: CFG,
  use(ctx, car) {
    ctx.spawn(new BombProjectile(ctx, car));
  },
};
