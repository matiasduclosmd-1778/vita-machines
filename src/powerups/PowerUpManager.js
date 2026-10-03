import * as THREE from 'three';
import { POWERUP_CONFIG } from '../config.js';
import { ItemBox } from './ItemBox.js';
import { PlayerInventory, InventoryState } from './PlayerInventory.js';
import { EffectManager } from './EffectManager.js';
import { Particles } from './Particles.js';
import { POWERUP_TYPES } from './types/index.js';
import { StunnedEffect } from './types/Bomb.js';

/**
 * Sistema de power-ups. Game solo le avisa: fixedUpdate / update / use / reset.
 *
 * También funciona como "contexto" para cada power-up (ctx), exponiendo:
 *   scene, track, cars, effects, particles,
 *   spawn(entity), rivalOf(car), tryAffect(target, { strong }), explosion(pos, scale),
 *   blast(target, dir, cfg)
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
    this.nextId = 0;
    this.time = 0;
    this.onPickup = null; // (car, type) → void, opcional (HUD)
    this.onUse = null; // (car, type) → void, opcional (sonido)
    this.onSound = null; // (nombre, posición, { local, strength }) → void (ver Game.sfx)
    this.onKnockout = null; // (car) → void: se quedó sin vida (Game lo elimina)
    this.enabled = true;
    this.boxes = [];
    this.positions = POWERUP_CONFIG.itemBoxes.positions;
    this.setAmount('normal');
  }

  /** Otro mapa: su pista y sus cajas (se rearman con la cantidad actual). */
  setTrack(track, positions) {
    this.track = track;
    this.positions = positions;
    this.level = null;
    this.setAmount(this.enabled ? this.amount ?? 'normal' : 'off');
  }

  /** Nuevos autos (al rearmar los jugadores): inventarios y efectos desde cero. */
  setCars(cars) {
    this.effects.clear();
    this.cars = cars;
    this.inventories = new Map(cars.map((c) => [c, new PlayerInventory()]));
  }

  inventory(car) {
    return this.inventories.get(car);
  }

  get activeBoxes() {
    return this.enabled ? this.boxes.filter((b) => b.active).length : 0;
  }

  /**
   * Cantidad de power-ups: 'off' (sin objetos) | 'few' | 'normal' | 'many'
   * (ver POWERUP_CONFIG.itemBoxes: qué cajas aparecen y cada cuánto reaparecen).
   */
  setAmount(amount) {
    this.amount = amount;
    this.enabled = amount !== 'off';
    const level = this.enabled ? amount : 'normal';
    if (level !== this.level) {
      this.level = level;
      for (const box of this.boxes) box.dispose();
      const B = POWERUP_CONFIG.itemBoxes;
      const respawn = B.amounts[level].respawnTime;
      this.boxes = this.positions
        .filter((p) => p.in.includes(level))
        .map((p, i) => {
          const q = this.track.path.pointAt(this.track.sOf(p.at), p.offset);
          return new ItemBox(this.scene, q.x, q.y, q.z, i * 0.7, respawn);
        });
    }
    for (const box of this.boxes) box.group.visible = this.enabled && box.active;
  }

  /** Usa el objeto del jugador, si tiene. Un arma no se gasta: dispara una vez (ver fire). */
  use(car) {
    if (!car.alive) return false;
    if (this.inventory(car).item?.fire) return this.fire(car);
    const type = this.inventory(car).take();
    if (!type) return false;
    type.use(this, car);
    this.onUse?.(car, type);
    return true;
  }

  /** Un disparo del arma (si ya pasó el tiempo entre balas). Sin balas, el arma se va. */
  fire(car) {
    const inv = this.inventory(car);
    const type = inv.item;
    if (!type?.fire || !car.alive || (car.gunCooldown ?? 0) > 0 || inv.ammo <= 0) return false;
    type.fire(this, car);
    this.onUse?.(car, type);
    car.gunCooldown = 1 / type.config.fireRate;
    if (--inv.ammo <= 0) {
      inv.clear();
      type.onEmpty?.(this, car);
    }
    return true;
  }

  /** Gatillo mantenido (cada paso de física): dispara en automático mientras haya balas. */
  trigger(car, held, dt) {
    car.gunCooldown = Math.max(0, (car.gunCooldown ?? 0) - dt);
    if (held && this.inventory(car).item?.fire) this.fire(car);
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
    entity.netId = ++this.nextId; // para identificarla en el online
    this.entities.push(entity);
    return entity;
  }

  /** Para el misil: el auto más cercano que va adelante en la carrera (si no hay, el más cercano). */
  targetAhead(car) {
    let best = null;
    let bestGap = Infinity;
    for (const c of this.cars) {
      if (c === car || !c.alive) continue;
      const gap = c.progress - car.progress;
      if (gap > 0 && gap < bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    return best ?? this.rivalOf(car);
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

  /**
   * Golpe de explosión (bomba, misil): frena al auto, lo empuja en `dir` (horizontal, normalizada),
   * lo hace volar dando una vuelta y lo deja aturdido hasta un rato después de aterrizar.
   * cfg: { speedKept, pushForce, launchSpeed, turns, spin, stunDuration }
   * La resistencia del piloto (target.toughness) achica el empujón, la frenada y el aturdimiento.
   */
  blast(target, dir, cfg) {
    const t = target.toughness ?? 1;
    target.velocity.multiplyScalar(1 - (1 - cfg.speedKept) * t);
    target.velocity.x += dir.x * cfg.pushForce * t;
    target.velocity.z += dir.z * cfg.pushForce * t;
    target.spin += (Math.random() < 0.5 ? -1 : 1) * cfg.spin;
    // Gira hacia el lado al que lo empuja la explosión (izquierda del auto = (cos h, -sin h))
    const left = dir.x * Math.cos(target.heading) - dir.z * Math.sin(target.heading);
    const air = target.launch(cfg.launchSpeed, cfg.turns, left >= 0 ? 1 : -1);
    this.sound('stun', target.position);
    this.effects.add(target, StunnedEffect, air + cfg.stunDuration * t);
  }

  /** Daño de un objeto: le saca vida; si llega a 0, queda eliminado. */
  damage(target, amount) {
    if (!amount || !target.alive || target.health <= 0) return;
    target.health = Math.max(0, target.health - amount);
    target.hurt = 1;
    if (amount >= 10) this.sound('hurt', target.position, { strength: amount }); // las balas tienen su propio sonido
    if (target.health <= 0) this.onKnockout?.(target);
  }

  /** Sonido con posición (lo reproduce Game; online, el anfitrión se lo manda a los invitados). */
  sound(name, pos, opts) {
    this.onSound?.(name, pos, opts);
  }

  explosion(pos, scale = 1) {
    this.onExplosion?.(pos, scale); // online: el anfitrión se lo avisa a los invitados
    this.sound('explosion', pos, { local: true, strength: scale }); // los invitados la recrean (y suena ahí)
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
        type.onPickup?.(this, car);
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

  /** Invitado online: solo avanza lo puramente visual que vive en este equipo (destellos de explosiones). */
  stepLocalVisuals(dt) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.fixedUpdate(dt) === false) {
        e.dispose();
        this.entities.splice(i, 1);
      }
    }
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
