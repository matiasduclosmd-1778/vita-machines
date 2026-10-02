import * as THREE from 'three';
import { POWERUP_CONFIG } from '../../config.js';
import { chrome, glow, paint, plastic } from '../../world/materials.js';

const CFG = POWERUP_CONFIG.missile;
const RADIUS = 0.3;
const REACH_Y = 2.5; // desnivel máximo con un auto para perseguirlo o pegarle (rampas empinadas)
const SMOKE_COLORS = ['#f1f1f4', '#d9dbe2', '#c3c6cf'];
const FIRE_COLORS = ['#ffd166', '#ff9f1c'];

/** Cohete de juguete: cuerpo blanco con barniz, nariz y aletas rojas, tobera cromada. Apunta a +Z. */
function buildRocket() {
  const group = new THREE.Group();
  const body = new THREE.Group(); // gira sobre su eje mientras vuela
  const white = paint('#f4f1ea');
  const red = paint('#e63946');

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, 1.1, 24).rotateX(Math.PI / 2), white);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(RADIUS, 0.55, 24).rotateX(Math.PI / 2), red);
  nose.position.z = 0.82;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 1.02, RADIUS * 1.02, 0.14, 24).rotateX(Math.PI / 2), red);
  stripe.position.z = 0.25;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.75, RADIUS * 0.55, 0.22, 16).rotateX(Math.PI / 2), chrome());
  nozzle.position.z = -0.64;

  // Cuatro aletas de plástico
  const finGeo = new THREE.BoxGeometry(0.05, 0.32, 0.38);
  const finMat = plastic('#e63946');
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.set(0, RADIUS + 0.12, -0.4);
    pivot.add(fin);
    body.add(pivot);
  }
  body.add(tube, nose, stripe, nozzle);
  body.traverse((m) => {
    if (m.isMesh) m.castShadow = true;
  });

  // Llama del motor (brilla con el bloom)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 12).rotateX(-Math.PI / 2), glow('#ffb703', 5));
  flame.position.z = -1.05;
  group.add(body, flame);
  return { group, body, flame };
}

/** Mira de fijación que flota sobre el auto perseguido. */
function buildReticle() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ff3b5c', transparent: true, opacity: 0.9, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 8, 40).rotateX(Math.PI / 2), mat);
  group.add(ring);
  const tick = new THREE.ConeGeometry(0.16, 0.4, 3).rotateZ(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const t = new THREE.Mesh(tick, mat);
    t.position.set(Math.cos(a) * 1.45, 0, Math.sin(a) * 1.45);
    t.rotation.y = -a; // punta hacia el centro
    group.add(t);
  }
  return group;
}

/** Misil teledirigido: sigue la pista y, cuando ve al rival cerca, va directo hacia él. */
class MissileProjectile {
  constructor(ctx, owner) {
    this.ctx = ctx;
    this.owner = owner;
    this.target = ctx.targetAhead(owner);
    this.yaw = owner.heading;
    this.speed = Math.max(CFG.launchSpeed, owner.forwardSpeed + 6);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.pos = new THREE.Vector3(owner.position.x + fx * 2.4, owner.position.y + CFG.hover, owner.position.z + fz * 2.4);
    this.age = 0;
    this.pitch = 0;
    this.sharpTurn = false;

    const rocket = buildRocket();
    this.mesh = rocket.group;
    this.body = rocket.body;
    this.flame = rocket.flame;
    this.mesh.rotation.order = 'YXZ';
    this.mesh.position.copy(this.pos);
    ctx.scene.add(this.mesh);

    this.reticle = buildReticle();
    this.reticle.visible = false;
    ctx.scene.add(this.reticle);

    ctx.particles.burst(this.pos, 12, { color: '#f1f1f4', speed: 4, up: 2, size: 0.35, life: 0.6 });
  }

  // Online: lo que necesitan los invitados para dibujarlo (ver MissileView)
  get netKind() {
    return 'missile';
  }

  netState() {
    const t = this.target && this.target.alive && this.age > CFG.armTime ? this.ctx.cars.indexOf(this.target) : -1;
    return [this.pos.x, this.pos.y, this.pos.z, this.yaw, this.pitch, t, this.age];
  }

  /** Hacia dónde quiere ir: directo al rival si está cerca y a la vista; si no, por la pista. */
  aimPoint(lane) {
    const t = this.target;
    if (t && t.alive) {
      const dx = t.position.x - this.pos.x;
      const dz = t.position.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      // Solo si está adelante: con el rival al costado, el giro no le alcanza y termina en la pared
      const ahead = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d;
      if (d < CFG.directRange && ahead > CFG.directCone && Math.abs(t.position.y + CFG.hover - this.pos.y) < REACH_Y) return t.position;
    }
    if (!lane) return null;
    // Punto un poco más adelante en la pista, volviendo de a poco al centro
    return lane.path.pointAt(lane.s + CFG.lookAhead, lane.offset * 0.5);
  }

  /** Tramo de pista debajo del misil. Sobre el hueco del salto usa la pista de todos modos (altura del otro lado). */
  laneUnder(g) {
    if (g.onTrack) return g;
    for (const path of this.ctx.track.paths) {
      const info = path.project(this.pos.x, this.pos.z);
      if (info.dist <= path.halfWidth + 0.5) return { path, s: info.s, offset: info.offset, h: path.heightAt(info.s), gap: true };
    }
    return null;
  }

  /** Hacia qué lado girar para no pegarle al obstáculo más cercano en su trayectoria (0 = ninguno). */
  dodgeDir() {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const floorY = this.pos.y - CFG.hover;
    let nearest = Infinity;
    let dir = 0;
    for (const o of this.ctx.track.obstacles) {
      if (Math.abs(o.y - floorY) > 1.5) continue;
      const dx = o.x - this.pos.x;
      const dz = o.z - this.pos.z;
      const fwd = dx * fx + dz * fz;
      if (fwd < 0 || fwd > CFG.dodgeRange || fwd > nearest) continue;
      const lat = dx * fz - dz * fx; // > 0: el obstáculo queda del lado hacia donde gira un yaw mayor
      if (Math.abs(lat) > o.r + RADIUS + CFG.dodgeMargin) continue;
      nearest = fwd;
      dir = lat > 0 ? -1 : 1;
    }
    return dir;
  }

  /** Devuelve false cuando terminó. */
  fixedUpdate(dt) {
    const { ctx } = this;
    this.age += dt;

    const g = ctx.track.groundAt(this.pos.x, this.pos.z, this.pos.y - CFG.hover);
    const lane = this.laneUnder(g);

    // Guiado: gira hacia el objetivo con un giro máximo (después de salir del auto).
    // Si tiene un obstáculo adelante, primero lo esquiva.
    if (this.age > CFG.armTime) {
      const max = CFG.turnRate * dt;
      const dodge = this.dodgeDir();
      const aim = dodge ? null : this.aimPoint(lane);
      if (dodge) {
        this.yaw += dodge * max;
      } else if (aim) {
        const want = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
        let diff = want - this.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.yaw += Math.max(-max, Math.min(max, diff));
        this.sharpTurn = Math.abs(diff) > CFG.sharpTurnAngle;
      }
    }
    // En curvas cerradas frena para que el giro le alcance; en recta acelera
    if (this.sharpTurn && this.speed > CFG.cornerSpeed) this.speed = Math.max(CFG.cornerSpeed, this.speed - CFG.braking * dt);
    else this.speed = Math.min(CFG.speed, this.speed + CFG.acceleration * dt);

    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;

    // Altura: vuela a ras de la pista; sobre el hueco del salto va hacia la altura del otro lado;
    // fuera de la pista cae despacio hasta estrellarse
    const prevY = this.pos.y;
    if (lane) {
      const want = lane.h + CFG.hover;
      if (!lane.gap && want - this.pos.y > 1.5) return this.explode(0.5); // escalón demasiado alto: choca
      this.pos.y += (want - this.pos.y) * Math.min(1, dt * (lane.gap ? 4 : 10));
    } else {
      this.pos.y -= 3 * dt;
      if (this.pos.y < g.h + 0.3) return this.explode(0.5);
    }
    this.pitch = Math.atan2(this.pos.y - prevY, this.speed * dt);

    // Contra un auto (cualquiera menos el que lo lanzó)
    for (const car of ctx.cars) {
      if (car === this.owner || !car.alive || Math.abs(car.position.y + 0.5 - this.pos.y) > REACH_Y) continue;
      for (const c of car.circles) {
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < CFG.hitRadius + c.r * 0.5) {
          this.hit(car);
          return false;
        }
      }
    }
    // Contra pared u obstáculo
    const hitsObstacle = ctx.track.obstacles.some((o) => Math.abs(o.y + 0.5 - this.pos.y) < 1.5 && Math.hypot(o.x - this.pos.x, o.z - this.pos.z) < o.r + RADIUS);
    if (ctx.track.hitsWall(this.pos.x, this.pos.y - CFG.hover, this.pos.z, RADIUS) || hitsObstacle) return this.explode(0.6);
    if (this.age > CFG.lifetime) return this.explode(0.5);
    return true;
  }

  explode(scale) {
    this.ctx.explosion({ x: this.pos.x, y: this.pos.y - CFG.hover, z: this.pos.z }, scale);
    return false;
  }

  hit(target) {
    const { ctx } = this;
    ctx.explosion({ x: this.pos.x, y: this.pos.y - CFG.hover, z: this.pos.z }, 1.2);
    if (!ctx.tryAffect(target, { strong: true })) return;
    ctx.damage(target, CFG.damage);

    // Empujón en la dirección del misil, con algo del centro de la explosión hacia el auto
    const dir = new THREE.Vector3(target.position.x - this.pos.x, 0, target.position.z - this.pos.z).normalize();
    dir.x += Math.sin(this.yaw) * 2;
    dir.z += Math.cos(this.yaw) * 2;
    ctx.blast(target, dir.normalize(), CFG);
  }

  update(dt) {
    animateMissile(this, dt, this.target && this.target.alive && this.age > CFG.armTime ? this.target : null);
  }

  dispose() {
    disposeMissile(this);
  }
}

/** Vuelo, estela y mira sobre el perseguido (m: { mesh, body, flame, reticle, pos, yaw, pitch, age, ctx }). */
function animateMissile(m, dt, target) {
  const { ctx } = m;
  m.mesh.position.copy(m.pos);
  m.mesh.position.y += Math.sin(m.age * 18) * 0.04; // vibración del motor
  m.mesh.rotation.set(-m.pitch, m.yaw, 0);
  m.body.rotation.z += dt * 6;
  m.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);

  // Estela de humo y chispas desde la tobera
  const back = { x: m.pos.x - Math.sin(m.yaw) * 1.1, y: m.pos.y, z: m.pos.z - Math.cos(m.yaw) * 1.1 };
  for (let i = 0; i < 2; i++) {
    const color = SMOKE_COLORS[(Math.random() * SMOKE_COLORS.length) | 0];
    ctx.particles.emit(back, { x: (Math.random() - 0.5) * 1.2, y: 0.6 + Math.random(), z: (Math.random() - 0.5) * 1.2 }, { life: 0.7, size: 0.32, color });
  }
  if (Math.random() < 0.6) {
    const color = FIRE_COLORS[(Math.random() * FIRE_COLORS.length) | 0];
    ctx.particles.emit(back, { x: -Math.sin(m.yaw) * 5, y: 0, z: -Math.cos(m.yaw) * 5 }, { life: 0.2, size: 0.2, color });
  }

  // Mira sobre el auto perseguido
  m.reticle.visible = !!target;
  if (target) {
    m.reticle.position.set(target.position.x, target.position.y + 0.15, target.position.z);
    m.reticle.rotation.y += dt * 3;
    m.reticle.scale.setScalar(1 + Math.sin(m.age * 12) * 0.08);
  }
}

function disposeMissile(m) {
  m.ctx.scene.remove(m.mesh, m.reticle);
  const geos = new Set();
  m.mesh.traverse((o) => o.geometry && geos.add(o.geometry));
  m.reticle.traverse((o) => o.geometry && geos.add(o.geometry));
  for (const g of geos) g.dispose();
}

/** Invitado online: el misil que simula el anfitrión, solo para verlo. */
export class MissileView {
  constructor(ctx) {
    this.ctx = ctx;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.age = 0;
    this.target = -1;
    const rocket = buildRocket();
    this.mesh = rocket.group;
    this.body = rocket.body;
    this.flame = rocket.flame;
    this.mesh.rotation.order = 'YXZ';
    ctx.scene.add(this.mesh);
    this.reticle = buildReticle();
    this.reticle.visible = false;
    ctx.scene.add(this.reticle);
  }

  set([x, y, z, yaw, pitch, target, age]) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.target = target;
    this.age = age;
  }

  update(dt) {
    animateMissile(this, dt, this.ctx.cars[this.target] ?? null);
  }

  dispose() {
    disposeMissile(this);
  }
}

export const Missile = {
  id: 'MISSILE',
  name: 'MISSILE',
  icon: '🎯',
  color: '#7bd64a',
  config: CFG,
  use(ctx, car) {
    ctx.spawn(new MissileProjectile(ctx, car));
  },
};
