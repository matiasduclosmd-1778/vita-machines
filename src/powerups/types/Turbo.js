import * as THREE from 'three';
import { GAME_CONFIG, POWERUP_CONFIG } from '../../config.js';
import { Effect } from '../EffectManager.js';

const CFG = POWERUP_CONFIG.turbo;
const HALF_LENGTH = GAME_CONFIG.vehicle.length / 2;
const FLAME_COLORS = ['#ffd166', '#ff9f1c', '#ff5400'];

/** Más aceleración y velocidad máxima por un rato. El jugador mantiene el control. */
export class TurboEffect extends Effect {
  static id = 'TURBO';
  static label = 'TURBO';

  start() {
    this.emitAcc = 0;
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 1.2, 10),
      new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.85 }),
    );
    this.flame.rotation.x = -Math.PI / 2; // punta hacia atrás
    this.flame.position.set(0, 0.5, -HALF_LENGTH - 0.6);
    this.car.mesh.add(this.flame);
    this.car.paintMaterial.emissive.set('#ff7b00');
  }

  modify(mods) {
    mods.acceleration *= CFG.accelerationMultiplier;
    mods.maxSpeed *= CFG.speedMultiplier;
  }

  update(dt) {
    const car = this.car;
    // Brillo de la carrocería que se apaga al final
    car.paintMaterial.emissiveIntensity = 0.55 * Math.min(1, this.remaining / 0.5);
    this.flame.scale.set(1, 0.8 + Math.random() * 0.6, 1);

    // Partículas de fuego y estela
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    this.emitAcc += dt * 70;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const back = { x: car.position.x - fx * (HALF_LENGTH + 0.4), y: car.position.y + 0.5, z: car.position.z - fz * (HALF_LENGTH + 0.4) };
      const color = FLAME_COLORS[(Math.random() * FLAME_COLORS.length) | 0];
      this.ctx.particles.emit(
        back,
        { x: -fx * 8 + (Math.random() - 0.5) * 3, y: Math.random() * 1.5, z: -fz * 8 + (Math.random() - 0.5) * 3 },
        { life: 0.35, size: 0.35, color },
      );
      // Estela blanca de velocidad a los costados
      const side = Math.random() < 0.5 ? -1 : 1;
      this.ctx.particles.emit(
        { x: car.position.x + fz * 0.75 * side, y: car.position.y + 0.3, z: car.position.z - fx * 0.75 * side },
        { x: 0, y: 0, z: 0 },
        { life: 0.4, size: 0.18, color: '#fff6d8', drag: 0 },
      );
    }
  }

  end() {
    this.car.mesh.remove(this.flame);
    this.flame.geometry.dispose();
    this.car.paintMaterial.emissive.set('#000000');
    this.car.paintMaterial.emissiveIntensity = 1;
  }
}

export const Turbo = {
  id: 'TURBO',
  name: 'TURBO',
  icon: '🚀',
  color: '#ff9f1c',
  config: CFG,
  use(ctx, car) {
    ctx.effects.add(car, TurboEffect, CFG.duration);
  },
};
