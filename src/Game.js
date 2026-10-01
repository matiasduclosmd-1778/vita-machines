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
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.input = new Input();
    this.laps = GAME_CONFIG.race.laps;
    this.net = null; // online: HostSync (anfitrión) o GuestSync (invitado), ver src/net/NetRace.js
    this.cars = [];
    this.powerups = new PowerUpManager(this.scene, this.track, this.cars);
    this.powerups.onPickup = (car) => {
      const i = this.cars.indexOf(car);
      this.hud.flashItem(i);
      this.net?.event(['p', i]);
    };
    this.setupPlayers(PLAYERS);
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);

    this.input.onPress((code) => {
      if (!this.running) return; // en menús y en pausa las teclas son del menú
      if (code === 'Escape') {
        // Online la carrera no se pausa: el menú se abre encima mientras sigue
        if (this.net) return this.callbacks.onOnlineMenu?.();
        this.pause();
        return this.callbacks.onPause?.();
      }
      if (!this.net && (code === 'KeyR' || (code === 'Enter' && this.state === 'finished'))) return this.restart();
      if (code === 'KeyV') this.debug.toggle();
      if (code === 'KeyG') console.info('[gráficos] calidad:', this.postfx.toggleQuality());
      if (this.state !== 'racing') return;
      if (this.net) {
        // Online: cualquiera de los dos juegos de teclas maneja el auto propio
        if (this.localControls.some((c) => c.use === code)) this.net.useItem();
        return;
      }
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

  // ---------------------------------------------------------------- jugadores

  /**
   * Arma los autos, el HUD y el seguimiento de pantalla para una lista de jugadores
   * ({ name, short, color, paint, controls?, controlsLabel, useLabel }). Local son los 2 de config.js;
   * online, hasta 6. Si la lista es la misma no rehace nada.
   */
  setupPlayers(players) {
    if (this.players === players) return;
    for (const car of this.cars) car.dispose(this.scene);
    this.players = players;
    this.cars = players.map((p) => new Car(p, this.scene));
    this.tracker = new OffscreenTracker(this.cars.length);
    this.drivers = this.cars.map(() => null);
    const debugOn = this.debug?.enabled;
    this.debug?.dispose(this.scene);
    this.hud = new HUD(this.hudRoot, players, () => this.restart(), () => this.callbacks.onMenu?.());
    this.hud.onlineActions = this.callbacks.online ?? {};
    this.hud.setLaps(this.laps);
    this.debug = new Debug(this.hudRoot, this.scene, players);
    if (debugOn != null) {
      this.debug.enabled = debugOn; // se mantiene lo que eligió el jugador (tecla V o configuración)
      this.debug.apply();
    }
    this.powerups.setCars(this.cars);
    if (this.carModels) this.setDrivers(players.map((p) => p.driver));
    this.restart();
  }

  /** Teclas del jugador propio en el online: sirven las del jugador 1 y las del jugador 2. */
  get localControls() {
    return PLAYERS.map((p) => p.controls);
  }

  /** Controles del jugador propio en el online (suma de los dos juegos de teclas). */
  localAxis() {
    const a = this.localControls.map((c) => this.input.axis(c));
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    return { throttle: clamp1(a[0].throttle + a[1].throttle), steer: clamp1(a[0].steer + a[1].steer) };
  }

  /**
   * Carrera online. net: HostSync o GuestSync (ver src/net/NetRace.js), que ya armó los jugadores.
   * race: { laps, powerups, players: [{ driver }] }
   */
  startOnlineRace(net, race) {
    this.net = net;
    this.laps = race.laps;
    this.hud.setLaps(race.laps);
    this.hud.setResultMode(net.isHost ? 'host' : 'guest');
    this.powerups.setAmount(race.powerups);
    this.setDrivers(race.players.map((p) => p.driver));
    this.restart();
    this.resume();
  }

  /** Sale del online: vuelve a los 2 jugadores locales. */
  endOnline() {
    this.net?.dispose();
    this.net = null;
    this.hud.setResultMode('local');
    this.setupPlayers(PLAYERS);
  }

  // ---------------------------------------------------------------- ciclo de vida (menú)

  /**
   * Arranca una carrera nueva con las opciones elegidas en "Crear partida".
   * opponent: 'cpu' (el jugador 2 lo maneja la computadora) | 'local' (dos personas)
   * drivers: id del piloto de cada jugador (GAME_CONFIG.drivers)
   * laps: vueltas para ganar · powerups: 'off' | 'few' | 'normal' | 'many'
   */
  startRace({ powerups = 'normal', opponent = 'local', difficulty = 'normal', drivers = [], laps = GAME_CONFIG.race.laps } = {}) {
    if (this.net) this.endOnline();
    this.setupPlayers(PLAYERS);
    this.laps = laps;
    this.hud.setLaps(laps);
    this.powerups.setAmount(powerups);
    this.setDrivers(drivers);
    this.setOpponent(opponent, difficulty);
    this.restart();
    this.resume();
  }

  /** Modelos 3D cargados ({ id → modelo }); cada auto arranca con el piloto de su jugador en config.js. */
  setCarModels(models) {
    this.carModels = models;
    this.setDrivers(PLAYERS.map((p) => p.driver));
  }

  /**
   * Pone en cada auto al piloto elegido: sus stats y su auto con su pintura.
   * Si los dos eligen el mismo piloto, el jugador 2 usa la pintura de su color para distinguirse.
   */
  setDrivers(ids) {
    this.cars.forEach((car, i) => {
      const driver = GAME_CONFIG.drivers.find((d) => d.id === ids[i]);
      if (!driver) return;
      car.setDriver(driver);
      const model = this.carModels?.[driver.car];
      const repeated = ids.slice(0, i).includes(ids[i]);
      if (model) car.applyModel(model, repeated ? car.player.paint : driver.paint);
    });
  }

  /** Define quién maneja cada auto (carrera local): teclado o piloto de la computadora. */
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
    this.result = null;
    this.state = 'racing';
    this.raceTime = 0;
    const leader = this.leader();
    this.rig.update(0, this.cars, leader, this.cameraYaw(this.cars, leader), true);
  }

  frame(time) {
    const dt = Math.min((time - (this.lastTime || time)) / 1000, 0.1);
    this.lastTime = time;

    const guest = this.net && !this.net.isHost;
    if (guest) {
      // Invitado: no simula; muestra el estado que manda el anfitrión
      this.net.apply(dt);
    } else {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.fixedUpdate(STEP);
        this.accumulator -= STEP;
      }
    }

    for (const car of this.cars) car.syncMesh(dt);
    this.powerups.update(dt);

    // La cámara encuadra a los autos vivos que no se están cayendo
    const framed = this.cars.filter((c) => c.alive && !c.fall);
    const leader = this.leader();
    this.rig.update(dt, framed, leader, this.cameraYaw(framed, leader));

    if (this.state === 'racing' && !guest) {
      this.raceTime += dt;
      if (this.raceTime > OUT.graceTime) {
        const out = this.tracker.update(dt, this.cars, this.rig);
        if (out.length) this.eliminate(out);
      }
    }
    if (this.net?.isHost) this.net.afterFrame(dt);

    this.environment.follow(this.rig.focus);
    this.updateHUD();
    this.debug.update(this.cars, this.rig, this.tracker, this.powerups);
    // El efecto miniatura mantiene nítida la franja de pantalla donde están los jugadores
    this.postfx.setFocus((this.rig.toNDC(this.rig.midpoint).y + 1) / 2);
    this.postfx.render();
  }

  /** ¿Alguien completó las vueltas? Gana el que más avanzó (por si cruzan en el mismo paso). */
  checkLaps() {
    if (this.state !== 'racing') return;
    const goal = this.laps * this.track.length;
    const done = this.cars.filter((c) => c.alive && c.progress >= goal);
    if (!done.length) return;
    const winner = done.sort((a, b) => b.progress - a.progress)[0];
    this.finish({ winner, byLaps: true });
  }

  /** Controles de cada auto: piloto de la CPU, jugador remoto (online) o teclado. */
  inputFor(i) {
    const driver = this.drivers?.[i];
    if (driver) return driver.update(STEP);
    if (this.net) return this.net.inputFor(i);
    return this.input.axis(this.cars[i].player.controls);
  }

  fixedUpdate(dt) {
    this.cars.forEach((car, i) => car.step(dt, this.inputFor(i)));
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) resolveCarCar(this.cars[i], this.cars[j]);
    }
    for (const car of this.cars) {
      resolveCarObstacles(car, this.track.obstacles);
      resolveCarTrack(car, this.track);
    }
    this.terrain.fixedUpdate(dt, this.cars);
    for (const car of this.cars) if (!car.fall) this.track.updateProgress(car);
    this.checkLaps();
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

  /** Autos que quedaron fuera de pantalla (o se desconectaron). Si queda uno solo (o ninguno), termina. */
  eliminate(indices) {
    if (this.state !== 'racing') return;
    indices.forEach((i) => this.cars[i].eliminate());
    const alive = this.cars.filter((c) => c.alive);
    if (alive.length <= 1) this.finish({ winner: alive[0] ?? null, eliminated: indices });
  }

  /**
   * Fin de la carrera: { winner, eliminated: [índices] } (el último en pie)
   * o { winner, byLaps: true } (completó las vueltas).
   */
  finish({ winner = null, eliminated = [], byLaps = false }) {
    this.state = 'finished';
    // Los que siguen en carrera vuelven a NORMAL: ya no corre el chequeo de pantalla
    this.cars.forEach((c, i) => {
      if (!c.alive) return;
      c.state = PlayerState.NORMAL;
      this.tracker.timers[i] = 0;
      this.tracker.inside[i] = true;
    });
    const many = this.cars.length > 2;
    const last = this.cars[eliminated[0]]?.player;
    this.result = winner
      ? {
          winner: this.cars.indexOf(winner),
          title: `¡${winner.player.name} gana!`,
          color: winner.player.color,
          sub: byLaps
            ? many
              ? `Completó las ${this.laps} vueltas primero.`
              : `Completó las ${this.laps} vueltas antes que ${this.cars.find((c) => c !== winner).player.name}.`
            : `${last?.name ?? 'El rival'} quedó fuera de pantalla y fue eliminado.`,
        }
      : { winner: -1, title: '¡Empate!', color: '', sub: 'Quedaron todos eliminados a la vez.' };
    this.hud.showResult(this.result);
  }

  updateHUD() {
    const ranking = [...this.cars].sort((a, b) => b.progress - a.progress);
    this.hud.update(
      this.cars.map((car, i) => ({
        lap: Math.min(this.laps, this.track.lap(car)),
        place: ranking.indexOf(car) + 1,
        state: car.state,
        falling: car.falling,
        item: this.powerups.inventory(car).item,
        effects: this.powerups.effects.list(car),
        countdown: car.state !== PlayerState.OUT_OF_SCREEN ? null : this.net && !this.net.isHost ? car.netCountdown : this.tracker.countdown(i),
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
