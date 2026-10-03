import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';

const CFG = POWERUP_CONFIG.flamethrower;

/**
 * Lanzallamas: chorro de fuego corto hacia adelante. Tiene `ammo` de carga (cada unidad es una
 * bocanada); mantener "usar objeto" lanza `fireRate` bocanadas por segundo, así que el tanque dura
 * ammo / fireRate segundos de fuego. Cada bocanada quema una vez a cada rival que toca y lo deja
 * ardiendo un rato. Ver PowerUpManager.fire (mismo sistema que la ametralladora).
 */

/** Tanque y boquilla sobre el vehículo mientras tiene carga, con un piloto encendido. */
export class FlamethrowerEffect extends Effect {
  static id = 'FLAME';
  static label = 'FLAME';
  static hidden = true; // la carga se ve en el casillero

  start() {
    this.flash = 0;
    this.time = 0;
    this.group = new THREE.Group();
    this.group.position.set(0, 1.2, -0.1);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.75, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c0392b', metalness: 0.4, roughness: 0.45 }));
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2d36', metalness: 0.7, roughness: 0.35 });
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.7, 10).rotateX(Math.PI / 2), metal);
    nozzle.position.set(0, 0.12, 0.65);
    this.pilot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: '#4cc9f0', transparent: true, opacity: 0.8, depthWrite: false }));
    this.pilot.position.set(0, 0.12, 1.05);
    this.group.add(tank, nozzle, this.pilot);
    this.car.mesh.add(this.group);
  }

  update(dt) {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 10);
    // Piloto azul que titila; al tirar fuego se pone naranja
    this.pilot.scale.setScalar(0.8 + Math.sin(this.time * 31) * 0.15 + this.flash * 0.8);
    this.pilot.material.color.set(this.flash > 0.2 ? '#ffb703' : '#4cc9f0');
  }

  end() {
    this.car.mesh.remove(this.group);
    this.group.traverse((m) => {
      m.geometry?.dispose();
      m.material?.dispose();
    });
  }
}

/** Ardiendo: después de tocarlo el fuego, sigue perdiendo un poco de vida y echa llamitas. */
export class BurningEffect extends Effect {
  static id = 'BURNING';
  static label = 'BURNING';

  start() {
    this.emitT = 0;
  }

  fixedUpdate(dt) {
    this.ctx.damage(this.car, CFG.burnDamage * dt);
  }

  update(dt) {
    this.emitT -= dt;
    if (this.emitT > 0) return;
    this.emitT = 0.05;
    const p = this.car.position;
    const r = () => (Math.random() * 2 - 1) * 0.7;
    const color = Math.random() < 0.5 ? '#ff9f1c' : '#ffd166';
    this.ctx.particles.emit({ x: p.x + r(), y: p.y + 0.9, z: p.z + r() }, { x: r(), y: 2.5 + Math.random() * 2, z: r() }, { color, size: 0.28, life: 0.4, drag: 1 });
  }
}

const flameGeometry = new THREE.SphereGeometry(1, 10, 8);
const flameBase = new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
const _c = new THREE.Color();
const HOT = new THREE.Color('#fff1a8');
const MID = new THREE.Color('#ff8c1a');
const COOL = new THREE.Color('#b0281a');

/** Dibujo de una bocanada según su edad (0..1): crece, pasa de amarillo a rojo y se apaga. */
function paintPuff(mesh, k) {
  mesh.scale.setScalar(CFG.radius[0] + (CFG.radius[1] - CFG.radius[0]) * Math.sqrt(k));
  if (k < 0.4) _c.copy(HOT).lerp(MID, k / 0.4);
  else _c.copy(MID).lerp(COOL, (k - 0.4) / 0.6);
  mesh.material.color.copy(_c);
  mesh.material.opacity = 0.85 * (1 - k * k);
}

/** Una bocanada de fuego: avanza frenándose, crece y quema una vez a cada auto que toca. */
class Puff {
  constructor(ctx, owner) {
    this.ctx = ctx;
    this.owner = owner;
    const yaw = owner.heading + (Math.random() * 2 - 1) * CFG.spread;
    this.dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.speed = CFG.speed + Math.max(0, owner.forwardSpeed) * 0.9;
    this.pos = new THREE.Vector3(owner.position.x + this.dir.x * 2, owner.position.y + 0.9, owner.position.z + this.dir.z * 2);
    this.age = 0;
    this.hit = new Set();
    this.mesh = new THREE.Mesh(flameGeometry, flameBase.clone());
    this.mesh.position.copy(this.pos);
    paintPuff(this.mesh, 0);
    ctx.scene.add(this.mesh);
  }

  get k() {
    return Math.min(1, this.age / CFG.lifetime);
  }

  // Online: lo que necesitan los invitados para dibujarla (ver FlameView)
  get netKind() {
    return 'flame';
  }

  netState() {
    return [this.pos.x, this.pos.y, this.pos.z, this.k];
  }

  /** Devuelve false cuando terminó. */
  fixedUpdate(dt) {
    const { ctx } = this;
    this.age += dt;
    this.speed *= Math.exp(-CFG.drag * dt);
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.pos.y += CFG.rise * dt; // el fuego sube un poco
    if (this.age >= CFG.lifetime) return false;
    if (ctx.track.hitsWall(this.pos.x, this.pos.y - 0.9, this.pos.z, 0.2)) return false;

    const reach = CFG.radius[0] + (CFG.radius[1] - CFG.radius[0]) * Math.sqrt(this.k);
    for (const car of ctx.cars) {
      if (car === this.owner || !car.alive || this.hit.has(car) || Math.abs(car.position.y + 0.6 - this.pos.y) > reach + 0.8) continue;
      if (!car.circles.some((c) => Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < c.r + reach * 0.8)) continue;
      this.hit.add(car);
      // El escudo apaga la bocanada (y suena como mucho cada tanto, no 20 veces por segundo)
      if (ctx.effects.has(car, 'SHIELD')) {
        if ((car.flameShieldAt ?? -1) <= ctx.time) {
          ctx.tryAffect(car);
          car.flameShieldAt = ctx.time + 0.25;
        }
        return false;
      }
      ctx.damage(car, CFG.damage);
      if (!ctx.effects.has(car, 'BURNING')) ctx.sound('burn', car.position); // al prenderse (lo manda el anfitrión)
      ctx.effects.add(car, BurningEffect, CFG.burnTime);
      car.velocity.addScaledVector(this.dir, CFG.push);
      car.hurt = 1;
    }
    return true;
  }

  update() {
    this.mesh.position.copy(this.pos);
    paintPuff(this.mesh, this.k);
  }

  dispose() {
    this.ctx.scene.remove(this.mesh);
    this.mesh.material.dispose();
  }
}

/** Invitado online: la bocanada que simula el anfitrión, solo para verla. */
export class FlameView {
  constructor(ctx) {
    this.ctx = ctx;
    this.mesh = new THREE.Mesh(flameGeometry, flameBase.clone());
    ctx.scene.add(this.mesh);
  }

  set([x, y, z, k]) {
    this.mesh.position.set(x, y, z);
    paintPuff(this.mesh, k ?? 0);
  }

  update() {}

  dispose() {
    this.ctx.scene.remove(this.mesh);
    this.mesh.material.dispose();
  }
}

export const Flamethrower = {
  id: 'FLAME',
  name: 'FLAME',
  icon: '🔥',
  color: CFG.color,
  config: CFG,
  ammo: CFG.ammo, // el objeto queda en el casillero hasta gastar la carga
  fuel: true, // el casillero muestra la carga en % (no en balas)
  /** Al juntarlo: aparece el tanque. */
  onPickup(ctx, car) {
    ctx.effects.add(car, FlamethrowerEffect, 999);
  },
  /** Una bocanada. */
  fire(ctx, car) {
    ctx.spawn(new Puff(ctx, car));
    const fx = ctx.effects.get(car, 'FLAME');
    if (fx) fx.flash = 1;
  },
  /** Sin carga: se va el tanque. */
  onEmpty(ctx, car) {
    ctx.effects.remove(car, 'FLAME');
  },
};
