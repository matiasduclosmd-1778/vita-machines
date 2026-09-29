import * as THREE from 'three';
import { GAME_CONFIG } from './config.js';
import { Input } from './Input.js';
import { Track } from './track/Track.js';
import { Environment } from './world/Environment.js';
import { PostFX } from './world/PostFX.js';
import { Terrain } from './Terrain.js';
import { Car, PlayerState } from './Car.js';
import { CameraRig } from './CameraRig.js';
import { OffscreenTracker } from './OffscreenTracker.js';
import { HUD } from './HUD.js';
import { Debug } from './Debug.js';
import { PowerUpManager } from './powerups/PowerUpManager.js';
import { resolveCarCar, resolveCarObstacles, resolveCarTrack } from './Collision.js';
import { AIDriver } from './ai/AIDriver.js';

const { physicsStep: STEP, players: PLAYERS, camera: CAM, outOfScreen: OUT } = GAME_CONFIG;

export class Game {
  /**
   * @param callbacks { onPause(), onMenu() } — los maneja el menú (main.js)
   */
  constructor(container, hudRoot, callbacks = {}) {
    this.callbacks = callbacks;
    this.hudRoot = hudRoot;
    this.running = false; // el loop corre solo durante la carrera (en el menú no se renderiza)
    // El antialiasing lo hace el posprocesado (MSAA en su render target, o SMAA en calidad baja)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.track = new Track(this.scene);
    this.environment = new Environment(this.scene, this.track);
    this.environment.buildEnvMap(this.renderer);
    this.terrain = new Terrain(this.track);
    this.cars = PLAYERS.map((p) => new Car(p, this.scene));
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.tracker = new OffscreenTracker(this.cars.length);
    this.input = new Input();
    this.hud = new HUD(hudRoot, PLAYERS, () => this.restart(), () => this.callbacks.onMenu?.());
    this.debug = new Debug(hudRoot, this.scene, PLAYERS);
    this.powerups = new PowerUpManager(this.scene, this.track, this.cars);
    this.powerups.onPickup = (car) => this.hud.flashItem(this.cars.indexOf(car));
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);

    this.input.onPress((code) => {
      if (!this.running) return; // en menús y en pausa las teclas son del menú
      if (code === 'Escape') {
        this.pause();
        return this.callbacks.onPause?.();
      }
      if (code === 'KeyR' || (code === 'Enter' && this.state === 'finished')) return this.restart();
      if (code === 'KeyV') this.debug.toggle();
      if (code === 'KeyG') console.info('[gráficos] calidad:', this.postfx.toggleQuality());
      if (this.state !== 'racing') return;
      this.cars.forEach((car, i) => {
        if (!this.drivers?.[i] && code === car.player.controls.use) this.powerups.use(car);
      });
    });
    window.addEventListener('resize', () => this.onResize());

    this.accumulator = 0;
    this.lastTime = 0;
    this.restart();
    this.setHudVisible(false);
  }

  // ---------------------------------------------------------------- ciclo de vida (menú)

  /**
   * Arranca una carrera nueva con las opciones elegidas en "Crear partida".
   * opponent: 'cpu' (el jugador 2 lo maneja la computadora) | 'local' (dos personas)
   */
  startRace({ powerups = true, opponent = 'local', difficulty = 'normal' } = {}) {
    this.powerups.setEnabled(powerups);
    this.setOpponent(opponent, difficulty);
    this.restart();
    this.resume();
  }

  /** Define quién maneja cada auto: teclado o piloto de la computadora. */
  setOpponent(opponent, difficulty) {
    const p2 = PLAYERS[1];
    p2.humanName ??= p2.name;
    p2.humanShort ??= p2.short;
    this.drivers = this.cars.map(() => null);
    if (opponent === 'cpu') {
      this.drivers[1] = new AIDriver(this.cars[1], this, difficulty);
      p2.name = GAME_CONFIG.ai.cpuName;
      p2.short = 'CPU';
      p2.cpuLabel = 'Computadora · ' + GAME_CONFIG.ai.difficulties[difficulty].label;
    } else {
      p2.name = p2.humanName;
      p2.short = p2.humanShort;
      p2.cpuLabel = null;
    }
    this.hud.setNames(PLAYERS);
  }

  pause() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.input.down.clear();
  }

  resume() {
    this.running = true;
    this.lastTime = 0; // evita un salto de tiempo después de la pausa
    this.accumulator = 0;
    this.setHudVisible(true);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** Vuelve al menú: se detiene el render y se oculta el HUD. */
  stop() {
    this.pause();
    this.setHudVisible(false);
  }

  setHudVisible(on) {
    this.hudRoot.classList.toggle('hidden', !on);
  }

  /** Aplica los ajustes del menú (gráficos, juego y teclas). */
  applySettings(settings) {
    const G = GAME_CONFIG.graphics;
    const v = settings.video;
    G.maxPixelRatio = 2 * v.renderScale;
    G.tiltShift.enabled = v.miniature;
    G.exposure = 0.6 + (v.brightness / 100) * 0.8;
    this.postfx.quality = v.quality;
    this.postfx.build();

    const sun = this.environment.sun;
    sun.castShadow = v.shadows !== 'off';
    const size = v.shadows === 'high' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }

    GAME_CONFIG.outOfScreen.countdown = settings.game.outCountdown;
    this.debug.enabled = settings.game.debug;
    this.debug.apply();

    settings.controls.forEach((c, i) => Object.assign(PLAYERS[i].controls, c));
    this.hud.refreshControls(PLAYERS);
  }

  /** Compila los shaders por adelantado para que la carrera no tartamudee al empezar. */
  warmup() {
    this.renderer.compile(this.scene, this.rig.camera);
    this.postfx.render();
  }

  /** Captura de la escena desde una cámara dada (para miniaturas del menú). */
  snapshot(position, target, fov = 40, width = 640, height = 360) {
    const cam = new THREE.PerspectiveCamera(fov, width / height, 0.5, 2000);
    cam.position.copy(position);
    cam.lookAt(target);
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.environment.follow(target);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.85);
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y);
    return url;
  }

  /** Miniaturas del mapa (vista aérea) y del auto del jugador 1. */
  makeThumbnails() {
    this.debug.helpers.visible = false;
    const map = this.snapshot(new THREE.Vector3(10, 260, 170), new THREE.Vector3(10, 0, -5), 45);
    const c = this.cars[0];
    const car = c.position;
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    // Tres cuartos de frente, desde la izquierda del auto
    const carShot = this.snapshot(
      new THREE.Vector3(car.x + fx * 5 + fz * 3.5, car.y + 2.6, car.z + fz * 5 - fx * 3.5),
      new THREE.Vector3(car.x, car.y + 0.6, car.z),
      35,
      640,
      300,
    );
    this.debug.apply();
    return { map, car: carShot };
  }

  restart() {
    this.cars.forEach((car, i) => {
      const p = this.track.startPosition(i);
      car.reset(p.x, p.z, p.heading, p.y);
      this.track.resetProgress(car);
    });
    this.tracker.reset();
    this.powerups.reset();
    this.drivers?.forEach((d) => d?.reset());
    this.hud.hideResult();
    this.state = 'racing';
    this.raceTime = 0;
    const leader = this.leader();
    this.rig.update(0, this.cars, leader, this.cameraYaw(this.cars, leader), true);
  }

  frame(time) {
    const dt = Math.min((time - (this.lastTime || time)) / 1000, 0.1);
    this.lastTime = time;

    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.fixedUpdate(STEP);
      this.accumulator -= STEP;
    }

    for (const car of this.cars) car.syncMesh(dt);
    this.powerups.update(dt);

    // La cámara encuadra a los autos vivos que no se están cayendo
    const framed = this.cars.filter((c) => c.alive && !c.fall);
    const leader = this.leader();
    this.rig.update(dt, framed, leader, this.cameraYaw(framed, leader));

    if (this.state === 'racing') {
      this.raceTime += dt;
      if (this.raceTime > OUT.graceTime) {
        const out = this.tracker.update(dt, this.cars, this.rig);
        if (out.length) this.finish(out);
      }
    }

    this.environment.follow(this.rig.focus);
    this.updateHUD();
    this.debug.update(this.cars, this.rig, this.tracker, this.powerups);
    // El efecto miniatura mantiene nítida la franja de pantalla donde están los jugadores
    this.postfx.setFocus((this.rig.toNDC(this.rig.midpoint).y + 1) / 2);
    this.postfx.render();
  }

  fixedUpdate(dt) {
    this.cars.forEach((car, i) => {
      const driver = this.drivers?.[i];
      car.step(dt, driver ? driver.update(dt) : this.input.axis(car.player.controls));
    });
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) resolveCarCar(this.cars[i], this.cars[j]);
    }
    for (const car of this.cars) {
      resolveCarObstacles(car, this.track.obstacles);
      resolveCarTrack(car, this.track);
    }
    this.terrain.fixedUpdate(dt, this.cars);
    for (const car of this.cars) if (!car.fall) this.track.updateProgress(car);
    this.powerups.fixedUpdate(dt);
  }

  /**
   * Hacia dónde mira la cámara: el sentido promedio de la pista entre el punto medio
   * de los jugadores (en progreso de carrera) y un poco por delante del líder.
   */
  cameraYaw(cars, leader) {
    if (!leader) return this.rig.yaw;
    const mid = cars.reduce((sum, c) => sum + c.progress, 0) / cars.length;
    const ahead = leader.progress - mid + CAM.yawLookAhead;
    return this.track.headingAround(this.track.startS + mid, 0, ahead);
  }

  /** El auto vivo (y no cayendo) con más progreso en la carrera. */
  leader() {
    let best = null;
    for (const c of this.cars) if (c.alive && !c.fall && (!best || c.progress > best.progress)) best = c;
    return best;
  }

  finish(eliminatedIdx) {
    eliminatedIdx.forEach((i) => this.cars[i].eliminate());
    this.state = 'finished';
    // El sobreviviente vuelve a NORMAL: ya no corre el chequeo de pantalla
    this.cars.forEach((c, i) => {
      if (!c.alive) return;
      c.state = PlayerState.NORMAL;
      this.tracker.timers[i] = 0;
      this.tracker.inside[i] = true;
    });
    const winner = this.cars.find((c) => c.alive);
    const loser = this.cars[eliminatedIdx[0]];
    this.hud.showResult(winner ? winner.player : null, loser.player);
  }

  updateHUD() {
    const ranking = [...this.cars].sort((a, b) => b.progress - a.progress);
    this.hud.update(
      this.cars.map((car, i) => ({
        lap: this.track.lap(car),
        place: ranking.indexOf(car) + 1,
        state: car.state,
        falling: car.falling,
        item: this.powerups.inventory(car).item,
        effects: this.powerups.effects.list(car),
        countdown: car.state === PlayerState.OUT_OF_SCREEN ? this.tracker.countdown(i) : null,
        ndc: this.rig.toNDC(car.position),
      })),
    );
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.setAspect(window.innerWidth / window.innerHeight);
    this.postfx.setSize(window.innerWidth, window.innerHeight);
  }
}
