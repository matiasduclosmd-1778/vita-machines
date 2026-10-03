import * as THREE from 'three';
import { GAME_CONFIG } from './config.js';
import { input, isUse, isJump, isAnyPadUse, isAnyPadJump, parsePad } from './Input.js';
import { Track } from './track/Track.js';
import { MAPS, DEFAULT_MAP } from './maps/index.js';
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
import { POWERUP_TYPES, EFFECT_TYPES, ENTITY_VIEWS } from './powerups/types/index.js';
import { localPlayerName } from './ui/Settings.js';
import { audio } from './audio/index.js';

const { physicsStep: STEP, players: PLAYERS, camera: CAM, outOfScreen: OUT, race: RACE } = GAME_CONFIG;
const HOLD = { throttle: 0, steer: 0 }; // en la cuenta regresiva nadie se mueve
const BRAKE = { throttle: 0, steer: 0, stop: true }; // en el festejo, el ganador frena

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
    this.worlds = {}; // mapas ya armados: { id → { track, environment } }
    this.setMap(DEFAULT_MAP);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.input = input;
    this.rounds = RACE.rounds;
    this.net = null; // online: HostSync (anfitrión) o GuestSync (invitado), ver src/net/NetRace.js
    this.cars = [];
    this.powerups = new PowerUpManager(this.scene, this.track, this.cars);
    this.powerups.onPickup = (car) => {
      const i = this.cars.indexOf(car);
      this.hud.flashItem(i);
      this.net?.event(['p', i]); // el invitado lo muestra y lo hace sonar
      this.sfx('pickup', { car, local: true });
    };
    this.powerups.onUse = (car, type) => this.sfx(`use-${type.id}`, { car });
    this.powerups.onSound = (name, pos, opts = {}) => this.sfx(name, { pos, ...opts });
    // Sin vida: el auto explota y queda eliminado
    this.powerups.onKnockout = (car) => {
      this.powerups.explosion(car.position, 1.4);
      this.eliminate([this.cars.indexOf(car)]);
    };
    this.setupPlayers(this.localPlayers(2));
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);

    this.input.onPress((code) => {
      if (!this.running) return; // en menús y en pausa las teclas son del menú
      const pad = parsePad(code)?.button;
      if (code === 'Escape' || pad === 'Start') {
        // Online la carrera no se pausa: el menú se abre encima mientras sigue
        if (this.net) return this.callbacks.onOnlineMenu?.();
        this.pause();
        return this.callbacks.onPause?.();
      }
      const confirm = code === 'Enter' || pad === 'A';
      if (!this.net && (code === 'KeyR' || (confirm && this.state === 'finished'))) return this.restart();
      // Podio con el mando: B = volver al menú (online: A = volver al lobby si sos el anfitrión, B = salir)
      if (this.state === 'finished' && pad) {
        if (!this.net && pad === 'B') return this.callbacks.onMenu?.();
        if (this.net?.isHost && pad === 'A') return this.callbacks.online?.back?.();
        if (this.net && pad === 'B') return this.callbacks.online?.leave?.();
      }
      if (code === 'KeyV') this.debug.toggle();
      if (code === 'KeyG') console.info('[gráficos] calidad:', this.postfx.toggleQuality());
      if (this.state !== 'racing') return;
      if (this.net) {
        // Online: cualquier juego de teclas o joystick maneja el auto propio
        if (this.localControls.some((c) => c.use === code) || isAnyPadUse(code)) this.net.useItem();
        if (this.localControls.some((c) => c.jump === code) || isAnyPadJump(code)) this.net.jump();
        return;
      }
      this.cars.forEach((car, i) => {
        if (this.drivers?.[i]) return;
        if (isUse(code, car.player)) this.powerups.use(car);
        if (isJump(code, car.player)) car.jump();
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
   * ({ name, short, color, paint, controls?, pad?, controlsLabel, useLabel }). Local son los primeros
   * 2 a 4 de config.js; online, hasta 6. Si la lista es la misma no rehace nada.
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
    this.debug = new Debug(this.hudRoot, this.scene, players);
    if (debugOn != null) {
      this.debug.enabled = debugOn; // se mantiene lo que eligió el jugador (tecla V o configuración)
      this.debug.apply();
    }
    this.powerups.setCars(this.cars);
    if (this.carModels) this.setDrivers(players.map((p) => p.driver));
    this.restart();
  }

  /** Los primeros n jugadores de config.js (siempre la misma lista para el mismo n). */
  localPlayers(n) {
    this.localLists ??= {};
    return (this.localLists[n] ??= PLAYERS.slice(0, n));
  }

  /** Teclas del jugador propio en el online: sirven las de todos los jugadores locales. */
  get localControls() {
    return PLAYERS.map((p) => p.controls);
  }

  /** Controles del jugador propio en el online (suma de todos los juegos de teclas y joysticks). */
  localAxis() {
    const a = [
      ...this.localControls.map((c) => this.input.axis(c)),
      ...this.input.pads.map((_, n) => this.input.padAxis(n)),
    ];
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const sum = (k) => clamp1(a.reduce((t, x) => t + x[k], 0));
    return { throttle: sum('throttle'), steer: sum('steer'), fire: a.some((x) => x.fire) };
  }

  /**
   * Carrera online. net: HostSync o GuestSync (ver src/net/NetRace.js), que ya armó los jugadores.
   * race: { rounds, powerups, players: [{ driver }] }
   */
  startOnlineRace(net, race) {
    this.setMap(race.map ?? DEFAULT_MAP);
    this.net = net;
    this.rounds = race.rounds ?? RACE.rounds;
    this.hud.setResultMode(net.isHost ? 'host' : 'guest');
    this.powerups.setAmount(race.powerups);
    this.setDrivers(race.players.map((p) => p.driver));
    this.restart();
    this.resume();
  }

  /** Sale del online: vuelve a los jugadores locales. */
  endOnline() {
    this.net?.dispose();
    this.net = null;
    this.hud.setResultMode('local');
    this.setupPlayers(this.localPlayers(2));
  }

  // ---------------------------------------------------------------- ciclo de vida (menú)

  /**
   * Arranca una carrera nueva con las opciones elegidas en "Crear partida".
   * humans: personas (jugadores 1…humans) · cpus: pilotos de la computadora (los autos que siguen)
   * drivers: id del piloto de cada auto (GAME_CONFIG.drivers)
   * rounds: rondas de la partida · powerups: 'off' | 'few' | 'normal' | 'many' · map: id del mapa (src/maps/)
   */
  startRace({ map = DEFAULT_MAP, powerups = 'normal', humans = 1, cpus = 1, difficulty = 'normal', drivers = [], rounds = RACE.rounds } = {}) {
    if (this.net) this.endOnline();
    this.setMap(map);
    this.setupPlayers(this.localPlayers(humans + cpus));
    this.rounds = rounds;
    this.powerups.setAmount(powerups);
    this.setDrivers(drivers);
    this.setCpus(humans, difficulty);
    this.restart();
    this.resume();
  }

  /** Modelos 3D cargados ({ id → modelo }); cada auto arranca con el piloto de su jugador en config.js. */
  setCarModels(models) {
    this.carModels = models;
    this.setDrivers(this.players.map((p) => p.driver));
  }

  /**
   * Pone en cada auto al piloto elegido: sus stats y su auto con su pintura.
   * Si un piloto está repetido, todos los autos de ese piloto usan la pintura de su jugador
   * (el mismo color que su etiqueta y su tarjeta del HUD) para distinguirse.
   */
  setDrivers(ids) {
    this.cars.forEach((car, i) => {
      const driver = GAME_CONFIG.drivers.find((d) => d.id === ids[i]);
      if (!driver) return;
      car.setDriver(driver);
      const model = this.carModels?.[driver.car];
      const repeated = ids.filter((id) => id === ids[i]).length > 1;
      if (model) car.applyModel(model, repeated ? car.player.paint : driver.paint, repeated);
    });
  }

  /** Quién maneja cada auto (carrera local): los primeros `humans` son personas, el resto la computadora. */
  setCpus(humans, difficulty) {
    const cpus = this.cars.length - humans;
    const label = 'Computadora · ' + GAME_CONFIG.ai.difficulties[difficulty].label;
    this.drivers = this.cars.map((car, i) => (i >= humans ? new AIDriver(car, this, difficulty) : null));
    this.players.forEach((p, i) => {
      const k = i - humans + 1;
      p.cpuLabel = i >= humans ? label : null;
      p.cpuName = cpus > 1 ? `${GAME_CONFIG.ai.cpuName} ${k}` : GAME_CONFIG.ai.cpuName;
      p.cpuShort = cpus > 1 ? `CP${k}` : 'CPU';
    });
    this.refreshNames();
  }

  /** Pone los nombres (de la persona o de la CPU) en el HUD y en la etiqueta de cada auto. */
  refreshNames() {
    for (const p of this.players) {
      p.name = p.cpuLabel ? p.cpuName : p.humanName ?? p.name;
      p.short = p.cpuLabel ? p.cpuShort : p.humanShort ?? p.short;
    }
    this.hud.setNames(this.players);
    for (const car of this.cars) car.setLabel(car.player.name);
  }

  pause() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.input.down.clear();
    audio.setPaused(true);
  }

  resume() {
    this.running = true;
    audio.setPaused(false);
    if (this.state === 'racing') audio.music.play('race', this.musicIntensity());
    this.lastTime = 0; // evita un salto de tiempo después de la pausa
    this.accumulator = 0;
    this.setHudVisible(true);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** Vuelve al menú: se detiene el render y se oculta el HUD. */
  stop() {
    this.pause();
    this.setHudVisible(false);
    audio.engines.stopAll();
    audio.setPaused(false);
  }

  setHudVisible(on) {
    this.hudRoot.classList.toggle('hidden', !on);
  }

  /**
   * Mapa en juego (ver src/maps/). La primera vez arma su pista y su ambiente; después solo
   * muestra el mundo de ese mapa y oculta los demás.
   */
  setMap(id) {
    const map = MAPS[id] ?? MAPS[DEFAULT_MAP];
    if (this.map === map) return;
    for (const w of Object.values(this.worlds)) w.setActive(false);
    let world = this.worlds[map.id];
    if (!world) {
      const track = new Track(this.scene, map.track, map.visuals);
      const environment = new map.Environment(this.scene, track);
      environment.buildEnvMap(this.renderer);
      world = this.worlds[map.id] = {
        track,
        environment,
        setActive(on) {
          track.group.visible = on;
          environment.setActive(on);
        },
      };
    }
    world.setActive(true);
    this.map = map;
    this.track = world.track;
    this.environment = world.environment;
    this.terrain = new Terrain(world.track);
    this.powerups?.setTrack(world.track, map.boxes);
    if (this.video) this.applyShadows(this.video);
    // Shaders del mapa nuevo compilados ahora (en la pantalla de carga), no en plena carrera
    if (this.rig) this.renderer.compile(this.scene, this.rig.camera);
  }

  /** Sombras del sol del mapa en juego según los ajustes de video. */
  applyShadows(v) {
    const sun = this.environment.sun;
    sun.castShadow = v.shadows !== 'off';
    const size = v.shadows === 'high' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
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

    this.video = v;
    this.applyShadows(v);

    this.rig.setView(settings.game.camera);

    this.debug.enabled = settings.game.debug;
    this.debug.apply();

    settings.controls.forEach((c, i) => Object.assign(PLAYERS[i].controls, c));
    PLAYERS.forEach((p, i) => {
      p.pad = settings.pads[i] ?? null;
      const { name, short } = localPlayerName(settings, i);
      p.humanName = name;
      p.humanShort = short;
    });
    if (!this.net) this.refreshNames();
  }

  /** Compila los shaders por adelantado para que la carrera no tartamudee al empezar. */
  warmup() {
    // Todo lo que aparece recién en carrera (efectos de los objetos, proyectiles, explosiones, vistas
    // del online) se crea una vez acá, en silencio: así sus shaders se compilan durante la carga y no
    // con un tirón la primera vez que alguien usa un objeto
    const pu = this.powerups;
    const car = this.cars[0];
    this.muted = true;
    for (const type of POWERUP_TYPES) {
      if (type.fire) {
        type.onPickup?.(pu, car);
        type.fire(pu, car);
      } else type.use(pu, car);
    }
    for (const E of Object.values(EFFECT_TYPES)) if (!pu.effects.get(car, E.id)) pu.effects.add(car, E, 0.5);
    pu.explosion(car.position, 1);
    const views = Object.values(ENTITY_VIEWS).map((View) => new View(pu, [car.position.x, car.position.y, car.position.z, 0, 0]));
    pu.update(1 / 60);
    for (const c of this.cars) c.syncMesh(0);
    this.renderer.compile(this.scene, this.rig.camera);
    this.postfx.render();
    views.forEach((v) => v.dispose());
    pu.reset();
    for (const c of this.cars) c.health = GAME_CONFIG.health.max;
    this.muted = false;
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

  /** Partida nueva: marcador en cero y primera ronda. */
  restart() {
    this.round = 1;
    this.scores = this.cars.map(() => 0);
    this.tiebreak = false;
    this.hud.hideResult();
    this.result = null;
    this.startRound();
  }

  /** Ronda: todos a la grilla con la vida llena, objetos reiniciados y cuenta 3…2…1. */
  startRound() {
    this.cars.forEach((car, i) => {
      const p = this.track.startPosition(i);
      car.reset(p.x, p.z, p.heading, p.y);
      car.eliminatedAt = null;
      this.track.resetProgress(car);
    });
    this.tracker.reset();
    this.powerups.reset();
    this.drivers?.forEach((d) => d?.reset());
    // Cuenta regresiva 3…2…1 antes de largar (ver frame); después, 'racing'
    this.state = 'countdown';
    this.countdown = RACE.countdown;
    this.goTimer = 0;
    this.raceTime = 0;
    this.celebrant = -1;
    this.celebrateTime = 0;
    this.hud.setRound(this.round, this.rounds, this.tiebreak);
    this.hud.hideRoundWinner();
    this.startCue = true; // en el primer cuadro se calla la música anterior (la de carrera entra con el "¡YA!")
    const leader = this.leader();
    this.rig.update(0, this.cars, leader, this.cameraYaw(this.cars, leader), true);
  }

  frame(time) {
    const dt = Math.min((time - (this.lastTime || time)) / 1000, 0.1);
    this.lastTime = time;

    const guest = this.net && !this.net.isHost;
    // Cuenta regresiva (la lleva el anfitrión; el invitado recibe cuánto falta)
    if (this.state === 'countdown' && !guest) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.go();
    }
    // Festejo del ganador de la ronda: saltitos con vuelta y, al terminar, la ronda siguiente
    if (this.state === 'celebrate' && !guest) {
      const t0 = this.celebrateTime;
      this.celebrateTime += dt;
      const champ = this.cars[this.celebrant];
      RACE.hops.forEach((at, k) => champ && t0 < at && this.celebrateTime >= at && champ.hop(k % 2 ? -1 : 1));
      if (this.celebrateTime >= RACE.celebrate) this.nextRound();
    }
    if (guest && this.state === 'racing' && this.prevState === 'countdown') this.goTimer = RACE.goShow;
    this.prevState = this.state;
    this.goTimer = Math.max(0, this.goTimer - dt);
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
    this.updateAudio(dt);
    this.powerups.update(dt);

    // La cámara encuadra a los autos vivos que no se están cayendo; en el festejo, de cerca al ganador
    const champ = this.state === 'celebrate' ? this.cars[this.celebrant] : null;
    const framed = champ ? [champ] : this.cars.filter((c) => c.alive && !c.fall);
    const leader = champ ?? this.leader();
    if (champ) {
      this.rig.cinematic(dt, champ); // festejo: paneo cinematográfico alrededor del ganador
      champ.marker.visible = false; // su nombre flotante taparía la toma (vuelve en la ronda siguiente)
    }
    else this.rig.update(dt, framed, leader, this.cameraYaw(framed, leader));

    if (this.state === 'racing' && !guest) {
      this.raceTime += dt;
      if (this.raceTime > OUT.graceTime) {
        const out = this.tracker.update(dt, this.cars, this.rig);
        if (out.length) this.eliminate(out);
      }
    }
    if (this.net?.isHost) this.net.afterFrame(dt);

    for (const car of this.cars) car.scaleMarker(this.rig.camera.position);
    this.environment.follow(this.rig.focus);
    this.worldTime = (this.worldTime ?? 0) + dt;
    this.track.updateMovers?.(this.worldTime); // obstáculos que se mueven (el autito del living)
    this.environment.update?.(this.rig.camera, dt); // living: paredes entre la cámara y la pista, personas
    this.updateHUD();
    this.debug.update(this.cars, this.rig, this.tracker, this.powerups);
    // El efecto miniatura mantiene nítida la franja de pantalla donde están los jugadores
    this.postfx.setFocus((this.rig.toNDC(this.rig.midpoint).y + 1) / 2, this.rig.focusBand);
    this.postfx.render();
  }

  /** ¡Largada! Termina la cuenta regresiva. */
  go() {
    this.countdown = 0;
    this.state = 'racing';
    this.goTimer = RACE.goShow;
    for (const car of this.cars) car.rev = 0;
  }

  /** Controles de cada auto: piloto de la CPU, jugador remoto (online) o teclado/joystick. */
  inputFor(i) {
    if (this.state === 'celebrate' || this.state === 'finished') return BRAKE;
    if (this.state === 'countdown') {
      // Quietos; acelerar solo hace rugir el motor
      const car = this.cars[i];
      const throttle = this.drivers?.[i] ? 0.35 : (this.net ? this.net.inputFor(i) : this.input.axis(car.player.controls, car.player.pad)).throttle;
      car.rev = Math.max(0, throttle);
      return HOLD;
    }
    const driver = this.drivers?.[i];
    if (driver) return driver.update(STEP);
    if (this.net) return this.net.inputFor(i);
    const p = this.cars[i].player;
    return this.input.axis(p.controls, p.pad);
  }

  fixedUpdate(dt) {
    const loop = this.track.loop; // loop guiado (El Living): mientras un auto está en el aro, lo mueve el loop
    this.cars.forEach((car, i) => {
      const input = this.inputFor(i);
      if (!car.loop) car.step(dt, input);
      // Arma: mantener "usar objeto" dispara en automático
      this.powerups.trigger(car, this.state === 'racing' && !!input.fire, dt);
    });
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) if (!this.cars[i].loop && !this.cars[j].loop) resolveCarCar(this.cars[i], this.cars[j]);
    }
    for (const car of this.cars) {
      if (car.loop) continue;
      resolveCarObstacles(car, this.track.obstacles);
      resolveCarTrack(car, this.track);
    }
    this.terrain.fixedUpdate(dt, this.cars);
    for (const car of this.cars) if (car.loop) loop.step(car, dt);
    for (const car of this.cars) {
      if (car.fall || car.loop) continue;
      const prevS = car.trackS;
      this.track.updateProgress(car);
      loop?.check(car, prevS);
    }
    this.powerups.fixedUpdate(dt);
  }

  /**
   * Hacia dónde mira la cámara: el sentido promedio de la pista entre el punto medio
   * de los jugadores (en progreso de carrera) y un tramo por delante del líder, más largo
   * cuanto más rápido va (así empieza a girar antes de las curvas).
   */
  cameraYaw(cars, leader) {
    if (!leader) return this.rig.yaw;
    const mid = cars.reduce((sum, c) => sum + c.progress, 0) / cars.length;
    const speed = Math.hypot(leader.velocity.x, leader.velocity.z);
    const ahead = leader.progress - mid + CAM.yawLookAhead + CAM.yawLookAheadTime * speed;
    return this.track.headingAround(this.track.startS + mid, 0, ahead);
  }

  /** El auto vivo (y no cayendo) con más progreso en la carrera. */
  leader() {
    let best = null;
    for (const c of this.cars) if (c.alive && !c.fall && (!best || c.progress > best.progress)) best = c;
    return best;
  }

  /** Autos que quedaron atrás, sin vida o se desconectaron. Si queda uno solo (o ninguno), termina la ronda. */
  eliminate(indices) {
    if (this.state !== 'racing') return;
    indices.forEach((i) => {
      this.cars[i].eliminate();
      this.sfx('eliminated', { car: this.cars[i] });
      this.cars[i].eliminatedAt = this.raceTime;
    });
    const alive = this.cars.filter((c) => c.alive);
    if (alive.length <= 1) this.endRound(alive[0] ?? null);
  }

  /** Fin de la ronda: el ganador suma y festeja (si quedaron todos afuera a la vez, nadie suma y se repite). */
  endRound(winner) {
    this.state = 'celebrate';
    this.celebrateTime = 0;
    this.celebrant = winner ? this.cars.indexOf(winner) : -1;
    if (winner) this.scores[this.celebrant]++;
    this.cars.forEach((c) => {
      if (c.alive) c.state = PlayerState.NORMAL;
    });
  }

  /** Después del festejo: ronda siguiente, ronda extra (empate arriba) o fin de la partida. */
  nextRound() {
    if (this.celebrant < 0) return this.startRound(); // ronda sin ganador: se repite
    const sorted = [...this.scores].sort((a, b) => b - a);
    const [top, second = 0] = sorted;
    const left = Math.max(0, this.rounds - this.round);
    const clear = top > second; // un solo líder
    if (clear && (top > second + left || this.round >= this.rounds)) {
      return this.finish({ winner: this.cars[this.scores.indexOf(top)] });
    }
    this.round++;
    this.tiebreak = this.round > this.rounds; // empate arriba al final: ronda extra
    this.startRound();
  }

  /** La música de carrera va a fondo en la última ronda, en la ronda extra o si alguien puede ganar la partida. */
  musicIntensity() {
    const need = Math.floor(this.rounds / 2) + 1;
    return this.round >= this.rounds || this.tiebreak || Math.max(...(this.scores ?? [0])) >= need - 1 ? 1 : 0;
  }

  /** Fin de la partida: podio con las rondas ganadas por cada uno. */
  finish({ winner = null }) {
    this.state = 'finished';
    const p = winner?.player;
    const wins = winner ? this.scores[this.cars.indexOf(winner)] : 0;
    const played = this.scores.reduce((a, b) => a + b, 0);
    this.result = {
      winner: winner ? this.cars.indexOf(winner) : -1,
      title: winner ? `¡${p.name} gana!` : '¡Empate!',
      color: p?.color ?? '',
      sub: winner ? `Ganó ${wins} de ${played} ${played === 1 ? 'ronda' : 'rondas'}.` : 'Nadie ganó la partida.',
      standings: this.standings(winner),
    };
    this.hud.showResult(this.result);
  }

  /** Clasificación final por rondas ganadas (el ganador, primero). Solo datos simples: el online la manda tal cual. */
  standings(winner) {
    const order = this.cars
      .map((car, i) => ({ car, i, wins: this.scores[i] }))
      .sort((a, b) => (b.car === winner) - (a.car === winner) || b.wins - a.wins || a.i - b.i);
    return order.map(({ car, i, wins }) => ({
      index: i,
      name: car.player.name,
      color: car.player.color,
      cpu: !!car.player.cpuLabel,
      driver: car.driver?.id ?? null,
      wins,
    }));
  }

  // ---------------------------------------------------------------- sonido

  /**
   * Efecto de sonido de la carrera, paneado según dónde está en pantalla (car o pos).
   * Online, el anfitrión se lo manda a los invitados (salvo `local`: lo que ellos ya recrean solos).
   */
  sfx(name, { car = null, pos = car?.position, gain = 1, strength, local = false } = {}) {
    if (this.muted) return; // precalentamiento (ver warmup)
    const x = pos ? this.rig.toNDC({ x: pos.x, y: pos.y ?? 0, z: pos.z }).x : 0;
    const pan = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) * 0.8 : 0;
    const g = gain * (car ? this.loudness(car) : 1);
    audio.play(name, { pan, gain: g, strength });
    if (this.net?.isHost && !local) this.net.event(['s', name, +pan.toFixed(2), +g.toFixed(2), +(strength ?? 0).toFixed(1)]);
  }

  /** Volumen de los sonidos de un auto: los de personas más fuertes que los de la CPU o los rivales online. */
  loudness(car) {
    const i = this.cars.indexOf(car);
    if (this.net) return i === this.net.localIndex ? 1 : 0.6;
    return this.drivers?.[i] ? 0.5 : 1;
  }

  /** Cada cuadro: motores, sonidos de los autos y la música según el momento de la ronda. */
  updateAudio(dt) {
    if (this.startCue) {
      this.startCue = false;
      audio.music.stop(); // silencio con los motores en marcha durante la cuenta
    }
    if (this.state === 'racing' && this.audioState === 'countdown') audio.music.play('race', this.musicIntensity());
    if (this.state === 'celebrate' && this.audioState === 'racing') {
      audio.music.stop();
      audio.play(this.celebrant >= 0 ? 'round-win' : 'eliminated');
    }
    this.audioState = this.state;
    const racing = this.state === 'racing' || this.state === 'countdown' || this.state === 'celebrate';
    audio.engines.update(
      dt,
      racing ? this.cars : [],
      (car) => Math.max(-1, Math.min(1, this.rig.toNDC(car.position).x)) * 0.7,
      (car) => this.loudness(car),
    );
    // Choques, saltos, caídas… (los pide cada auto; online solo los simula el anfitrión)
    for (const car of this.cars) {
      for (const [name, strength] of car.sounds) this.sfx(name, { car, strength });
      car.sounds.length = 0;
    }
  }

  updateHUD() {
    for (const car of this.cars) car.setHealth(car.health / GAME_CONFIG.health.max);
    // Cartel de largada: 3, 2, 1 y "¡YA!"
    this.hud.setStart(this.state === 'countdown' ? Math.max(1, Math.ceil(this.countdown)) : this.goTimer > 0 ? 'go' : null);
    // Ronda en curso y cartel del ganador de la ronda (también en los invitados, con lo que manda el anfitrión)
    this.hud.setRound(this.round, this.rounds, this.tiebreak);
    this.hud.setCinema(this.state === 'celebrate' && this.celebrant >= 0);
    if (this.state === 'celebrate') {
      const champ = this.cars[this.celebrant];
      this.hud.showRoundWinner(champ ? { name: champ.player.name, color: champ.player.color, wins: this.scores[this.celebrant], round: this.round } : null);
    } else this.hud.hideRoundWinner();
    const ranking = [...this.cars].sort((a, b) => b.progress - a.progress);
    this.hud.update(
      this.cars.map((car, i) => ({
        wins: this.scores?.[i] ?? 0,
        place: ranking.indexOf(car) + 1,
        state: car.state,
        falling: car.falling,
        item: this.powerups.inventory(car).item,
        ammo: this.powerups.inventory(car).ammo,
        effects: this.powerups.effects.list(car),
        health: car.health / GAME_CONFIG.health.max,
      })),
    );
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.setAspect(window.innerWidth / window.innerHeight);
    this.postfx.setSize(window.innerWidth, window.innerHeight);
  }
}
