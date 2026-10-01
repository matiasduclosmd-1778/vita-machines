import { GAME_CONFIG } from '../config.js';
import { InventoryState } from '../powerups/PlayerInventory.js';

const V = GAME_CONFIG.vehicle;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Piloto de la computadora. Genera el mismo input que el teclado ({ throttle, steer })
 * y usa objetos a través del PowerUpManager: maneja el mismo auto con las mismas reglas.
 *
 *  - Velocidad: mira las curvas que vienen, calcula a cuánto puede tomarlas según el giro
 *    real del auto y frena con anticipación. Es más prudente donde no hay baranda.
 *  - Salto: llega a la rampa con velocidad suficiente.
 *  - Línea: sigue la pista esquivando obstáculos y, si puede, pasando por las cajas.
 *  - Si queda trabado contra algo, retrocede y vuelve a intentar.
 */
export class AIDriver {
  constructor(car, game, difficulty = 'normal') {
    this.car = car;
    this.game = game;
    this.track = game.track;
    this.path = game.track.path;
    this.difficulty = difficulty;
    this.cfg = GAME_CONFIG.ai.difficulties[difficulty];
    this.precompute();
    this.reset();
  }

  reset() {
    this.offset = 0; // desplazamiento lateral de la línea que sigue
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.itemTimer = null;
    this.itemWait = 0;
    this.time = Math.random() * 10;
  }

  /** Radio de curvatura y tramos riesgosos por muestra, calculados una vez. */
  precompute() {
    const P = this.path;
    const n = P.count;
    this.radius = new Float32Array(n);
    this.risky = new Uint8Array(n);
    const heading = (i) => {
      const d = P.segDir[Math.min(i, P.segCount - 1)];
      return Math.atan2(d.x, d.z);
    };
    const span = 8 * (P.length / n); // las muestras están equiespaciadas
    for (let i = 0; i < n; i++) {
      const a = (i - 4 + n) % n;
      const b = (i + 4) % n;
      const turn = Math.abs(wrap(heading(b) - heading(a)));
      this.radius[i] = turn > 1e-4 ? span / turn : 1e4;
      this.risky[i] = !P.wallLeft[i] || !P.wallRight[i] ? 1 : 0;
    }
    const project = (x, z) => P.project(x, z);
    this.obstacles = this.track.obstacles.map((o) => {
      const q = project(o.x, o.z);
      return { s: q.s, offset: q.offset, r: o.r };
    });
    const J = this.track.jumpInfo;
    this.takeoffS = J.s0 + J.dJump;
  }

  /** Velocidad máxima para tomar una curva de radio R con el giro del auto. */
  cornerSpeed(R) {
    const ts = V.turnSpeed;
    const k = 1 - V.highSpeedTurnFactor;
    return (0.85 * R * ts) / (1 + (R * ts * k) / V.maxSpeed);
  }

  rival() {
    return this.game.cars.find((c) => c !== this.car && c.alive) || null;
  }

  update(dt) {
    const car = this.car;
    this.time += dt;
    if (!car.alive || car.fall || !car.grounded) return { throttle: 0, steer: 0 };

    const P = this.path;
    const cfg = this.cfg;
    const info = P.project(car.position.x, car.position.z);
    const s = info.s;
    const v = Math.max(0, car.forwardSpeed);

    // 1. Velocidad objetivo: la curva más exigente que viene, teniendo en cuenta cuánto se puede frenar
    let target = V.maxSpeed * cfg.speedScale * car.mods.maxSpeed;
    const decel = V.braking * 0.5;
    const horizon = 20 + v * 1.6;
    for (let d = 4; d <= horizon; d += 4) {
      const i = P.indexAt(s + d);
      let vc = this.cornerSpeed(this.radius[i] / cfg.cornerMargin);
      if (this.risky[i]) vc /= cfg.riskMargin;
      target = Math.min(target, Math.sqrt(vc * vc + 2 * decel * d));
    }
    // Rampa de salto: hay que llegar rápido o no se alcanza la plataforma
    const toTakeoff = P.forward(s, this.takeoffS);
    if (toTakeoff < 35) target = Math.max(target, 27);

    // 2. Línea: esquivar obstáculos y, si conviene, pasar por una caja
    let wanted = 0;
    const inv = this.game.powerups.inventory(car);
    if (cfg.seeksBoxes && this.game.powerups.enabled && inv.state === InventoryState.EMPTY) {
      let best = Infinity;
      for (const box of this.game.powerups.boxes) {
        if (!box.active) continue;
        const q = P.project(box.x, box.z);
        const d = P.forward(s, q.s);
        if (d > 5 && d < 35 && d < best) {
          best = d;
          wanted = q.offset;
        }
      }
    }
    for (const o of this.obstacles) {
      const d = P.forward(s, o.s);
      if (d < 0 || d > 30) continue;
      const gap = o.r + 2.4;
      if (Math.abs(wanted - o.offset) < gap) wanted = o.offset > 0 ? o.offset - gap : o.offset + gap;
    }
    const i0 = P.indexAt(s);
    const limit = this.risky[i0] ? 2 : P.halfWidth - 2; // sin baranda: cerca del centro
    wanted = clamp(wanted, -limit, limit);
    this.offset += (wanted - this.offset) * Math.min(1, 3 * dt);

    // 3. Dirección: apuntar a un punto por delante sobre la línea
    const aim = P.pointAt(s + cfg.lookAhead + v * 0.5, this.offset);
    const desired = Math.atan2(aim.x - car.position.x, aim.z - car.position.z);
    const noise = Math.sin(this.time * 1.7) * cfg.steerNoise;
    let steer = clamp(wrap(desired - car.heading) * 2.4 + noise, -1, 1);

    // 4. Acelerar / frenar
    let throttle = v > target + 1.5 ? -1 : clamp((target - v) * 0.5, 0, 1);

    // 5. Destrabarse: si acelera y no avanza, marcha atrás un momento
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      return { throttle: -1, steer: -steer };
    }
    if (throttle > 0.3 && v < 1.5) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 1.2) {
      this.stuckTime = 0;
      this.reverseTime = 0.9;
    }

    this.thinkItems(dt, s);
    return { throttle, steer };
  }

  // ------------------------------------------------------------------ objetos

  thinkItems(dt, s) {
    const inv = this.game.powerups.inventory(this.car);
    if (!inv.item) {
      this.itemTimer = null;
      return;
    }
    if (this.itemTimer == null) {
      const [a, b] = this.cfg.itemDelay;
      this.itemTimer = a + Math.random() * (b - a);
      this.itemWait = 0;
    }
    this.itemTimer -= dt;
    this.itemWait += dt;
    if (this.itemTimer > 0) return;
    this.itemTimer = 0.25; // vuelve a evaluar cada cuarto de segundo

    // Los pilotos menos hábiles usan el objeto en cualquier momento; al rato lo usan igual
    const smart = Math.random() < this.cfg.itemSkill;
    if (!smart || this.itemWait > 9 || this.goodMoment(inv.item.id, s)) this.game.powerups.use(this.car);
  }

  goodMoment(id, s) {
    const car = this.car;
    const rival = this.rival();
    if (!rival) return id === 'TURBO' || id === 'SHIELD';
    const dx = rival.position.x - car.position.x;
    const dz = rival.position.z - car.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const ahead = (dx * Math.sin(car.heading) + dz * Math.cos(car.heading)) / dist; // 1 = justo adelante
    const sameLevel = Math.abs(rival.position.y - car.position.y) < 1.5;
    const P = this.path;

    switch (id) {
      case 'BOMB':
        return ahead > 0.96 && dist < 40 && sameLevel;
      case 'MISSILE':
        return rival.progress > car.progress && dist < 60;
      case 'OIL':
        return ahead < -0.7 && dist < 30;
      case 'MAGNET':
        return rival.progress > car.progress && dist > 6 && dist < 35;
      case 'SHIELD':
        return dist < 22;
      case 'TURBO': {
        // En recta y sin bordes peligrosos cerca (o para el salto)
        if (P.forward(s, this.takeoffS) < 45) return true;
        for (let d = 0; d <= 50; d += 5) {
          const i = P.indexAt(s + d);
          if (this.radius[i] < 30 || this.risky[i]) return false;
        }
        return true;
      }
      default:
        return true;
    }
  }
}
