import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';

const CFG = POWERUP_CONFIG.gun;

/**
 * Ametralladora: `ammo` balas que salen hacia donde apunta el vehículo. Tocar "usar objeto" dispara
 * una; mantenerlo apretado dispara en automático (`fireRate` por segundo). Ver PowerUpManager.fire.
 */

/** Torreta sobre el vehículo mientras tiene balas (solo visual; el fogonazo lo marca `flash`). */
export class GunEffect extends Effect {
  static id = 'GUN';
  static label = 'GUN';
  static hidden = true; // no se lista en los efectos del HUD (las balas se ven en el casillero)

  start() {
    this.flash = 0;
    this.group = new THREE.Group();
    this.group.position.set(0, 1.25, 0.15);
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2d36', metalness: 0.7, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.18, 12), dark);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.08, 0.45);
    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0, depthWrite: false }),
    );
    this.muzzle.position.set(0, 0.08, 0.95);
    this.group.add(base, barrel, this.muzzle);
    this.car.mesh.add(this.group);
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 14);
    this.muzzle.material.opacity = this.flash;
    this.muzzle.scale.setScalar(0.6 + this.flash);
    this.group.position.z = 0.15 - this.flash * 0.08; // retroceso
  }

  end() {
    this.car.mesh.remove(this.group);
    this.group.traverse((m) => m.geometry?.dispose());
  }
}

const bulletMaterial = new THREE.MeshBasicMaterial({ color: CFG.color });
const bulletGeometry = new THREE.CapsuleGeometry(0.09, 0.55, 2, 6).rotateX(Math.PI / 2);

/** Bala: avanza en línea recta (siguiendo la altura de la pista) hasta pegar o agotarse. */
class Bullet {
  constructor(ctx, owner) {
    this.ctx = ctx;
    this.owner = owner;
    this.yaw = owner.heading + (Math.random() * 2 - 1) * CFG.spread;
    this.dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.speed = CFG.speed + Math.max(0, owner.forwardSpeed);
    this.pos = new THREE.Vector3(owner.position.x + this.dir.x * 2, owner.position.y + 0.8, owner.position.z + this.dir.z * 2);
    this.age = 0;
    this.mesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
    this.mesh.rotation.y = this.yaw;
    this.mesh.position.copy(this.pos);
    ctx.scene.add(this.mesh);
  }

  // Online: lo que necesitan los invitados para dibujarla (ver BulletView)
  get netKind() {
    return 'bullet';
  }

  netState() {
    return [this.pos.x, this.pos.y, this.pos.z, this.yaw];
  }

  /** Devuelve false cuando terminó. */
  fixedUpdate(dt) {
    const { ctx } = this;
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.age += dt;
    const g = ctx.track.groundAt(this.pos.x, this.pos.z, this.pos.y - 0.8);
    if (g.onTrack) this.pos.y += (g.h + 0.8 - this.pos.y) * Math.min(1, dt * 12);

    for (const car of ctx.cars) {
      if (car === this.owner || !car.alive || Math.abs(car.position.y + 0.6 - this.pos.y) > 1.3) continue;
      if (car.circles.some((c) => Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < c.r + 0.2)) {
        this.hit(car);
        return false;
      }
    }
    const hitsObstacle = ctx.track.obstacles.some((o) => Math.abs(o.y + 0.5 - this.pos.y) < 1.5 && Math.hypot(o.x - this.pos.x, o.z - this.pos.z) < o.r + 0.1);
    if (ctx.track.hitsWall(this.pos.x, this.pos.y - 0.8, this.pos.z, 0.1) || hitsObstacle) {
      this.sparks('#ffe9a8', 6);
      return false;
    }
    return this.age < CFG.lifetime;
  }

  hit(target) {
    const { ctx } = this;
    this.sparks(CFG.color, 10);
    if (!ctx.tryAffect(target, { strong: false })) return; // el escudo la frena
    ctx.damage(target, CFG.damage);
    ctx.sound('bullet-hit', target.position);
    target.velocity.addScaledVector(this.dir, CFG.push);
    target.onImpact(2);
  }

  sparks(color, n) {
    this.ctx.particles.burst({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, n, { color, speed: 5, up: 2, size: 0.16, life: 0.3 });
  }

  update() {
    this.mesh.position.copy(this.pos);
  }

  dispose() {
    this.ctx.scene.remove(this.mesh);
  }
}

/** Invitado online: la bala que simula el anfitrión, solo para verla. */
export class BulletView {
  constructor(ctx) {
    this.ctx = ctx;
    this.mesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
    ctx.scene.add(this.mesh);
  }

  set([x, y, z, yaw]) {
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = yaw;
  }

  update() {}

  dispose() {
    this.ctx.scene.remove(this.mesh);
  }
}

export const Gun = {
  id: 'GUN',
  name: 'GUN',
  icon: '🔫',
  color: CFG.color,
  config: CFG,
  ammo: CFG.ammo, // el objeto queda en el casillero hasta gastar todas las balas
  /** Al juntarla: aparece la torreta. */
  onPickup(ctx, car) {
    ctx.effects.add(car, GunEffect, 999);
  },
  /** Un disparo. */
  fire(ctx, car) {
    ctx.spawn(new Bullet(ctx, car));
    const fx = ctx.effects.get(car, 'GUN');
    if (fx) fx.flash = 1;
    const p = car.position;
    const s = Math.sin(car.heading);
    const c = Math.cos(car.heading);
    ctx.particles.burst({ x: p.x + s * 2.1, y: p.y + 1.35, z: p.z + c * 2.1 }, 3, { color: '#ffd166', speed: 3, up: 1, size: 0.14, life: 0.12 });
  },
  /** Sin balas: se va la torreta. */
  onEmpty(ctx, car) {
    ctx.effects.remove(car, 'GUN');
  },
};
