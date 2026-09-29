import * as THREE from 'three';
import { POWERUP_CONFIG } from '../config.js';
import { ItemBox } from './ItemBox.js';
import { PlayerInventory, InventoryState } from './PlayerInventory.js';
import { EffectManager } from './EffectManager.js';
import { Particles } from './Particles.js';
import { POWERUP_TYPES } from './types/index.js';

/**
 * Sistema de power-ups. Game solo le avisa: fixedUpdate / update / use / reset.
 *
 * También funciona como "contexto" para cada power-up (ctx), exponiendo:
 *   scene, track, cars, effects, particles,
 *   spawn(entity), rivalOf(car), tryAffect(target, { strong }), explosion(pos, scale)
 *
 * Entidades del mundo (bombas, manchas de aceite, explosiones) implementan:
 *   fixedUpdate(dt) → false para terminar · update(dt) · dispose()
 */
export class PowerUpManager {
  constructor(scene, track, cars) {
    this.scene = scene;
    this.track = track;
    this.cars = cars;
    this.particles = new Particles(scene);
    this.effects = new EffectManager(this);
    this.inventories = new Map(cars.map((c) => [c, new PlayerInventory()]));
    this.entities = [];
    this.time = 0;
    this.onPickup = null; // (car, type) → void, opcional (HUD)
    this.enabled = true;

    this.boxes = POWERUP_CONFIG.itemBoxes.positions.map((p, i) => {
      const q = track.path.pointAt(track.sOf(p.at), p.offset);
      return new ItemBox(scene, q.x, q.y, q.z, i * 0.7);
    });
  }

  inventory(car) {
    return this.inventories.get(car);
  }

  get activeBoxes() {
    return this.enabled ? this.boxes.filter((b) => b.active).length : 0;
  }

  /** Partida "sin objetos": las cajas desaparecen y no se puede recoger nada. */
  setEnabled(on) {
    this.enabled = on;
    for (const box of this.boxes) box.group.visible = on && box.active;
  }

  /** Usa el objeto del jugador, si tiene. */
  use(car) {
    if (!car.alive) return false;
    const type = this.inventory(car).take();
    if (!type) return false;
    type.use(this, car);
    return true;
  }

  /** Power-up aleatorio según `weight` de cada uno en POWERUP_CONFIG. */
  randomType() {
    const total = POWERUP_TYPES.reduce((s, t) => s + (t.config.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const t of POWERUP_TYPES) {
      r -= t.config.weight ?? 1;
      if (r < 0) return t;
    }
    return POWERUP_TYPES[0];
  }

  // ------------------------------------------------------------ API para power-ups

  spawn(entity) {
    this.entities.push(entity);
    return entity;
  }

  /** Rival más cercano vivo (con 2 jugadores, el otro). */
  rivalOf(car) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.cars) {
      if (c === car || !c.alive) continue;
      const d = c.position.distanceToSquared(car.position);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** ¿El ataque afecta al objetivo? Si tiene escudo, el escudo lo absorbe y devuelve false. */
  tryAffect(target, { strong = false } = {}) {
    const shield = this.effects.get(target, 'SHIELD');
    if (shield) {
      shield.absorb(strong);
      return false;
    }
    return true;
  }

  explosion(pos, scale = 1) {
    const y = pos.y ?? 0;
    this.particles.burst({ x: pos.x, y: y + 0.6, z: pos.z }, Math.round(28 * scale), { color: '#ff9f1c', speed: 12 * scale, up: 8 * scale, size: 0.45 * scale, gravity: 14 });
    this.particles.burst({ x: pos.x, y: y + 0.6, z: pos.z }, Math.round(14 * scale), { color: '#ffe14d', speed: 7 * scale, up: 5, size: 0.35 * scale });
    this.particles.burst({ x: pos.x, y: y + 0.8, z: pos.z }, Math.round(10 * scale), { color: '#555566', speed: 4 * scale, up: 4, size: 0.7 * scale, life: 0.9 });
    this.spawn(new Flash(this.scene, pos, scale));
  }

  // ------------------------------------------------------------ ciclo

  fixedUpdate(dt) {
    const R2 = POWERUP_CONFIG.itemBoxes.pickupRadius ** 2;
    for (const car of this.cars) {
      if (!car.alive || !this.enabled) continue;
      const inv = this.inventory(car);
      if (inv.state === InventoryState.HAS_ITEM) continue; // la caja queda para el otro
      for (const box of this.boxes) {
        if (!box.active) continue;
        const dx = car.position.x - box.x;
        const dz = car.position.z - box.z;
        if (dx * dx + dz * dz > R2 || Math.abs(car.position.y - box.y) > 2.5) continue;
        const type = this.randomType();
        box.collect();
        inv.give(type);
        this.particles.burst({ x: box.x, y: box.y + 1.3, z: box.z }, 18, { color: type.color, speed: 7, up: 5, size: 0.3 });
        this.onPickup?.(car, type);
        break;
      }
    }

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.fixedUpdate && e.fixedUpdate(dt) === false) {
        e.dispose();
        this.entities.splice(i, 1);
      }
    }

    this.effects.fixedUpdate(dt, this.cars);
  }

  update(dt) {
    this.time += dt;
    if (this.enabled) for (const box of this.boxes) box.update(dt, this.time);
    for (const e of this.entities) e.update?.(dt);
    this.effects.update(dt);
    this.particles.update(dt);
  }

  reset() {
    for (const inv of this.inventories.values()) inv.clear();
    this.effects.clear();
    for (const e of this.entities) e.dispose();
    this.entities.length = 0;
    for (const box of this.boxes) {
      box.reset();
      box.group.visible = this.enabled;
    }
    this.particles.clear();
    for (const car of this.cars) car.paintMaterial.emissive.set('#000000');
  }
}

/** Destello esférico breve de una explosión. */
class Flash {
  constructor(scene, pos, scale) {
    this.scene = scene;
    this.age = 0;
    this.scale = scale;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.mesh.position.set(pos.x, (pos.y ?? 0) + 0.6, pos.z);
    scene.add(this.mesh);
  }

  fixedUpdate(dt) {
    this.age += dt;
    return this.age < 0.35;
  }

  update() {
    const k = this.age / 0.35;
    this.mesh.scale.setScalar((0.5 + k * 2.5) * this.scale);
    this.mesh.material.opacity = 0.8 * (1 - k);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
