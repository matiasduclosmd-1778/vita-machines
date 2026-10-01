import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GAME_CONFIG } from './config.js';
import { paint as paintMaterial, tintedGlass, chrome, glow } from './world/materials.js';
import { instantiateCar } from './world/CarModel.js';

const V = GAME_CONFIG.vehicle;
const clamp = THREE.MathUtils.clamp;
const NO_INPUT = { throttle: 0, steer: 0 };
const STOP_INPUT = { throttle: 0, steer: 0, stop: true };
const WHEEL_RADIUS = 0.32;
const TUMBLE_CENTER = 0.6; // altura del eje sobre el que gira la carrocería al dar vueltas

/** Multiplicadores neutros. Los efectos de power-ups los modifican cada paso (ver EffectManager). */
export const DEFAULT_MODS = { acceleration: 1, maxSpeed: 1, grip: 1, steer: 1, throttle: 1 };

export const PlayerState = {
  NORMAL: 'NORMAL',
  OUT_OF_SCREEN: 'OUT_OF_SCREEN',
  ELIMINATED: 'ELIMINATED',
};

/**
 * Auto con física arcade en el plano XZ.
 * Convención: heading = 0 mira hacia +Z; forward = (sin h, cos h); izquierda = (cos h, -sin h).
 */
export class Car {
  constructor(player, scene) {
    this.player = player;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.circles = [
      { x: 0, z: 0, r: V.colliderRadius },
      { x: 0, z: 0, r: V.colliderRadius },
    ];

    this.buildMesh(new THREE.Color(player.paint ?? player.color));
    scene.add(this.mesh);
    this.setDriver(null);
    this.reset(0, 0, 0);
  }

  get alive() {
    return this.state !== PlayerState.ELIMINATED;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get falling() {
    return !!this.fall;
  }

  reset(x, z, heading, y = 0) {
    this.state = PlayerState.NORMAL;
    this.falls = 0;
    this.safeS = null;
    this.respawnAt(x, y, z, heading, 0);
  }

  /** Coloca el auto quieto en un punto (largada o respawn después de caerse). */
  respawnAt(x, y, z, heading, blink) {
    this.position.set(x, y, z);
    this.prevX = x;
    this.prevZ = z;
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    // Vertical
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;
    this.fall = null; // { timer } mientras cae
    this.ground = null;
    this.blink = blink;
    this.throttle = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.spin = 0; // giro extra provocado por golpes
    this.tumble = null; // vuelta en el aire después de una explosión
    this.mods = { ...this.baseMods };
    this.forwardSpeed = 0;
    this.accelLong = 0;
    // Visual
    this.roll = 0;
    this.pitch = 0;
    this.bump = 0;
    this.bumpVel = 0;
    this.wheelAngle = 0;
    this.slope = 0;
    this.marker.visible = this.alive;
    this.mesh.visible = true;
    // Progreso en la carrera (lo actualiza Track); se conserva al reaparecer
    this.trackS ??= 0;
    this.progress ??= 0;
    this.updateCircles();
    this.syncMesh(0);
  }

  /** Saca el auto de la escena (al rearmar los jugadores para el online). */
  dispose(scene) {
    scene.remove(this.mesh);
    this.paintMaterial.dispose();
  }

  eliminate() {
    this.state = PlayerState.ELIMINATED;
    this.marker.visible = false;
  }

  step(dt, input = NO_INPUT) {
    if (!this.alive || this.fall) input = STOP_INPUT;
    this.prevX = this.position.x;
    this.prevZ = this.position.z;
    if (!this.grounded) return this.stepAir(dt);
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const v = this.velocity;

    let fwd = v.x * sinH + v.z * cosH;
    let lat = v.x * cosH - v.z * sinH;
    const prevFwd = fwd;

    const mods = this.mods;
    const maxSpeed = V.maxSpeed * mods.maxSpeed;

    // Acelerador progresivo (sube en ~1/throttleResponse s); freno y reversa inmediatos
    const throttleInput = input.throttle * mods.throttle;
    this.throttle = throttleInput > 0 ? Math.min(throttleInput, this.throttle + V.throttleResponse * dt) : throttleInput;

    if (input.stop) {
      // Eliminado: frena hasta detenerse
      const b = V.braking * 0.5 * dt;
      fwd = Math.abs(fwd) <= b ? 0 : fwd - Math.sign(fwd) * b;
    } else if (this.throttle > 0) {
      if (fwd < -0.5) fwd = Math.min(0, fwd + V.braking * dt);
      else {
        const r = Math.max(0, fwd) / maxSpeed;
        if (r < 1) {
          const thrust = V.acceleration * mods.acceleration * (1 - V.accelerationCurve * r * r) * this.throttle * dt;
          fwd = Math.min(maxSpeed, fwd + thrust);
        }
      }
    } else if (this.throttle < 0) {
      if (fwd > 0.5) fwd = Math.max(0, fwd - V.braking * dt);
      else fwd -= V.reverseAcceleration * dt;
    } else {
      const f = V.friction * dt;
      fwd = Math.abs(fwd) <= f ? 0 : fwd - Math.sign(fwd) * f;
    }
    fwd -= fwd * V.drag * dt;
    // Por encima del máximo (p. ej. al terminar un turbo) vuelve de a poco, no de golpe
    if (fwd > maxSpeed) fwd = maxSpeed + (fwd - maxSpeed) * Math.exp(-3 * dt);
    fwd = Math.max(fwd, -V.maxReverseSpeed);

    // Volante suavizado; el giro depende de la velocidad:
    // quieto no gira, a baja velocidad gira rápido, a alta velocidad gira menos.
    this.steer += (input.steer * mods.steer - this.steer) * Math.min(1, V.steerResponse * dt);
    const speedRatio = clamp(Math.abs(fwd) / V.maxSpeed, 0, 1);
    const lowSpeed = clamp(fwd / V.turnFullSpeed, -1, 1);
    const highSpeed = 1 - (1 - V.highSpeedTurnFactor) * speedRatio;
    const targetYawRate = this.steer * V.turnSpeed * lowSpeed * highSpeed;
    // Inercia de rotación: el giro real alcanza al pedido en ~1/yawResponse s
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, V.yawResponse * dt);

    // Grip lateral: girando fuerte a alta velocidad desliza apenas
    const grip = V.grip * mods.grip * (1 - V.driftGripLoss * Math.abs(this.steer) * speedRatio);
    lat *= Math.exp(-grip * dt);

    // Recomponer con los ejes actuales y luego rotar: la inercia genera un leve deslizamiento
    v.x = fwd * sinH + lat * cosH;
    v.z = fwd * cosH - lat * sinH;
    this.heading += (this.yawRate + this.spin) * dt;
    this.spin *= Math.exp(-GAME_CONFIG.collision.spinDamping * dt);
    this.position.x += v.x * dt;
    this.position.z += v.z * dt;

    this.forwardSpeed = fwd;
    this.accelLong = (fwd - prevFwd) / dt;
    this.updateCircles();
  }

  /** En el aire: sin tracción ni dirección, conserva la inercia (la gravedad la aplica Terrain). */
  stepAir(dt) {
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.heading += (this.yawRate + this.spin) * dt;
    this.yawRate *= Math.exp(-3 * dt);
    this.spin *= Math.exp(-GAME_CONFIG.collision.spinDamping * dt);
    this.forwardSpeed = this.velocity.x * Math.sin(this.heading) + this.velocity.z * Math.cos(this.heading);
    this.accelLong = 0;
    this.updateCircles();
  }

  /**
   * Explosión debajo del auto: lo despega con velocidad vertical `vy` y da `turns` vueltas
   * de barril (side: 1 = hacia la izquierda, -1 = hacia la derecha) que terminan al aterrizar.
   * Devuelve cuánto tiempo va a estar en el aire (en piso plano).
   */
  launch(vy, turns, side) {
    if (this.fall) return 0;
    this.grounded = false;
    this.vy = Math.max(this.vy, vy);
    this.airTime = 0;
    const air = (2 * this.vy) / GAME_CONFIG.terrain.gravity;
    const total = -side * turns * Math.PI * 2; // rotar sobre +Z lleva el techo hacia la derecha
    this.tumble = { angle: 0, total, rate: total / air };
    return air;
  }

  updateCircles() {
    const fx = Math.sin(this.heading) * V.colliderOffset;
    const fz = Math.cos(this.heading) * V.colliderOffset;
    const [a, b] = this.circles;
    a.x = this.position.x + fx;
    a.z = this.position.z + fz;
    b.x = this.position.x - fx;
    b.z = this.position.z - fz;
  }

  /** Golpe visual de la carrocería (strength ≈ velocidad de impacto). */
  onImpact(strength) {
    this.bumpVel += Math.min(strength, 20) * 0.12;
  }

  syncMesh(dt) {
    this.mesh.position.copy(this.position);
    // Cabeceo según la trayectoria: sube la trompa en rampas, la baja al caer
    const horiz = Math.max(4, Math.abs(this.forwardSpeed));
    const targetSlope = -Math.atan(this.vy / horiz) * Math.sign(this.forwardSpeed || 1);
    this.slope += (clamp(targetSlope, -0.6, 0.6) - this.slope) * (1 - Math.exp(-12 * dt));
    this.mesh.rotation.set(this.slope, this.heading, 0, 'YXZ');
    // Parpadeo después de reaparecer
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt);
    this.mesh.visible = this.blink <= 0 || Math.floor(this.blink * 12) % 2 === 0;

    // Inclinación: se inclina hacia afuera en curva y cabecea al acelerar/frenar
    const targetRoll = clamp(this.forwardSpeed * this.yawRate * 0.006, -0.14, 0.14);
    const targetPitch = clamp(-this.accelLong * 0.0035, -0.09, 0.09);
    const k = 1 - Math.exp(-10 * dt);
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;

    // Resorte de suspensión para los golpes
    this.bumpVel += (-180 * this.bump - 12 * this.bumpVel) * dt;
    this.bump += this.bumpVel * dt;

    // Vuelta de barril: en el aire gira al ritmo del vuelo; si aterriza antes, completa la vuelta rápido
    let tumble = 0;
    const t = this.tumble;
    if (t) {
      t.angle += t.rate * dt * (this.grounded ? 3 : 1);
      if (Math.abs(t.angle) >= Math.abs(t.total)) this.tumble = null;
      else tumble = t.angle;
    }
    this.chassis.rotation.set(this.pitch, 0, this.roll + tumble);
    // Girar alrededor del centro de la carrocería (no de la base)
    this.chassis.position.x = TUMBLE_CENTER * Math.sin(tumble);
    this.chassis.position.y = Math.max(-0.1, this.bump) + TUMBLE_CENTER * (1 - Math.cos(tumble));

    this.wheelAngle += (this.forwardSpeed * dt) / WHEEL_RADIUS;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    for (const p of this.frontPivots) p.rotation.y = this.steer * 0.45;
  }

  /**
   * Piloto que maneja este auto (GAME_CONFIG.drivers, o null = auto base): sus stats
   * se convierten en multiplicadores fijos de manejo (baseMods) y de resistencia a golpes.
   */
  setDriver(driver) {
    this.driver = driver;
    const S = GAME_CONFIG.driverStats;
    const d = (k) => (driver ? driver.stats[k] - S.base : 0);
    this.baseMods = {
      ...DEFAULT_MODS,
      maxSpeed: 1 + d('vel') * S.maxSpeed,
      acceleration: 1 + d('acel') * S.acceleration,
      steer: 1 + d('man') * S.handling,
      grip: 1 + d('man') * S.handling,
    };
    this.toughness = Math.max(0.3, 1 - d('res') * S.toughness); // < 1: los golpes le hacen menos
    this.mods = { ...this.baseMods };
  }

  /**
   * Reemplaza la carrocería de primitivas por un modelo 3D (ver world/CarModel.js).
   * La física, las colisiones y la inclinación siguen siendo las mismas.
   */
  applyModel(model, color = this.player.paint ?? this.player.color) {
    const key = `${model.id}:${color}`;
    if (this.modelKey === key) return;
    if (this.model) {
      // Cambio de auto entre carreras: se saca el anterior (la geometría es compartida, la pintura no)
      this.chassis.remove(this.model);
      this.paintMaterial.dispose();
    }
    const { object, paint } = instantiateCar(model, color);
    for (const child of [...this.chassis.children]) child.visible = false;
    for (const w of this.wheels) w.visible = false;
    this.chassis.add(object);
    this.paintMaterial = paint; // el turbo hace brillar la pintura nueva
    this.model = object;
    this.modelKey = key;
  }

  buildMesh(color) {
    const L = V.length;
    const W = V.width;
    const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.1, ...extra });
    // Cajas con bordes redondeados: se ven más "juguete" y reflejan mejor la luz
    const box = (w, h, d, material, x, y, z) => {
      const radius = Math.min(w, h, d) * 0.28;
      const geo = radius > 0.03 ? new RoundedBoxGeometry(w, h, d, 3, radius) : new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    this.mesh = new THREE.Group();
    this.chassis = new THREE.Group();
    this.mesh.add(this.chassis);

    const paint = paintMaterial(color);
    this.paintMaterial = paint; // los efectos (turbo) cambian su brillo
    const dark = mat(0x1d1f24, { roughness: 0.6 });
    const glass = tintedGlass();
    const white = paintMaterial(0xf4f1ea);

    this.chassis.add(box(W, 0.42, L, paint, 0, 0.48, 0)); // carrocería
    this.chassis.add(box(W * 0.78, 0.36, L * 0.42, glass, 0, 0.86, -0.12)); // cabina
    this.chassis.add(box(W * 0.8, 0.06, L * 0.36, paint, 0, 1.06, -0.12)); // techo
    this.chassis.add(box(0.28, 0.02, L * 0.98, white, 0, 0.7, 0)); // franja
    this.chassis.add(box(W * 1.05, 0.18, 0.2, dark, 0, 0.36, L / 2)); // paragolpes
    this.chassis.add(box(W * 1.05, 0.08, 0.3, paint, 0, 0.98, -L / 2 + 0.12)); // alerón
    this.chassis.add(box(0.08, 0.28, 0.08, dark, -W * 0.35, 0.8, -L / 2 + 0.12));
    this.chassis.add(box(0.08, 0.28, 0.08, dark, W * 0.35, 0.8, -L / 2 + 0.12));
    const light = glow('#fff1c2', 3);
    this.chassis.add(box(0.26, 0.12, 0.05, light, -W * 0.3, 0.55, L / 2 + 0.01));
    this.chassis.add(box(0.26, 0.12, 0.05, light, W * 0.3, 0.55, L / 2 + 0.01));
    const tail = glow('#ff2a2a', 2);
    this.chassis.add(box(0.24, 0.1, 0.05, tail, -W * 0.32, 0.56, -L / 2 - 0.01));
    this.chassis.add(box(0.24, 0.1, 0.05, tail, W * 0.32, 0.56, -L / 2 - 0.01));

    // Ruedas (fuera del chasis para que la carrocería se incline sobre ellas)
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.BoxGeometry(0.3, 0.36, 0.1); // marca visible del giro
    const tire = mat(0x16171a, { roughness: 0.85 });
    const hub = chrome();
    this.wheels = [];
    this.frontPivots = [];
    const wx = W / 2;
    const wz = L * 0.32;
    for (const [x, z, front] of [[wx, wz, true], [-wx, wz, true], [wx, -wz, false], [-wx, -wz, false]]) {
      const wheel = new THREE.Mesh(wheelGeo, tire);
      wheel.add(new THREE.Mesh(hubGeo, hub));
      wheel.castShadow = true;
      this.wheels.push(wheel);
      if (front) {
        const pivot = new THREE.Group();
        pivot.position.set(x, WHEEL_RADIUS, z);
        pivot.add(wheel);
        this.frontPivots.push(pivot);
        this.mesh.add(pivot);
      } else {
        wheel.position.set(x, WHEEL_RADIUS, z);
        this.mesh.add(wheel);
      }
    }

    // Marcador flotante con el color del jugador (para ubicarlo con zoom lejano)
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.8, 4),
      new THREE.MeshBasicMaterial({ color: this.player.color }), // color de interfaz, bien visible
    );
    marker.rotation.x = Math.PI;
    marker.position.y = 2.4;
    this.marker = marker;
    this.mesh.add(marker);
  }
}
