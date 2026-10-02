import { GAME_CONFIG } from '../config.js';
import { openChannel } from './transport.js';

const NET = GAME_CONFIG.online;
const DIRECTORY = 'vm-lobbies';
const room = (code) => `vm-lobby-${code}`;

/** Código de lobby de 6 caracteres, sin letras que se confunden (0/O, 1/I). */
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

/**
 * Lista de lobbies públicos. Cada anfitrión se anuncia cada pocos segundos en un canal común;
 * los anuncios que dejan de llegar vencen. onChange(lobbies[]) se llama cuando cambia la lista.
 */
export async function browseLobbies(onChange) {
  const ch = await openChannel(DIRECTORY);
  const lobbies = new Map(); // code → { ...anuncio, seen }
  const emit = () => onChange([...lobbies.values()].sort((a, b) => a.name.localeCompare(b.name)));
  ch.onMessage((m) => {
    if (m.t === 'ad') {
      lobbies.set(m.lobby.code, { ...m.lobby, seen: performance.now() });
      emit();
    } else if (m.t === 'gone' && lobbies.delete(m.code)) emit();
  });
  const ask = () => ch.send({ t: 'who' });
  ask();
  const timer = setInterval(() => {
    const now = performance.now();
    let changed = false;
    for (const [code, l] of lobbies) {
      if (now - l.seen > NET.adTimeout * 1000) changed = lobbies.delete(code);
    }
    if (changed) emit();
  }, 1000);
  return {
    refresh: ask,
    close() {
      clearInterval(timer);
      ch.close();
    },
  };
}

/**
 * Sesión en un lobby (anfitrión o invitado). El anfitrión es la autoridad: guarda el estado del lobby
 * (jugadores, listos, pilotos, fase) y lo reenvía a todos cada vez que cambia.
 *
 * Eventos (on): 'state' (lobby), 'chat' ({ name, text, system }), 'race' (config de la carrera),
 * 'snap' / 'ev' (carrera, solo invitados), 'input' / 'use' / 'jump' / 'left' (carrera, solo anfitrión), 'closed' (motivo).
 */
export class OnlineSession {
  /** Crea un lobby nuevo como anfitrión. */
  static async host(profile, { name, isPublic, rounds, powerups }) {
    const code = makeCode();
    const s = new OnlineSession(profile, code, true);
    s.channel = await openChannel(room(code));
    s.directory = await openChannel(DIRECTORY);
    s.state = {
      code,
      name,
      public: isPublic,
      rounds,
      powerups,
      max: NET.maxPlayers,
      phase: 'lobby',
      players: [{ id: profile.id, name: profile.name, slot: 0, host: true, ready: true, driver: null, confirmed: false }],
    };
    s.listen();
    s.directory.onMessage((m) => m.t === 'who' && s.advertise());
    s.timers.push(setInterval(() => s.hostTick(), 1000));
    s.advertise();
    return s;
  }

  /** Entra a un lobby por su código. Resuelve con la sesión o falla con el motivo. */
  static async join(profile, code) {
    code = code.trim().toUpperCase();
    const s = new OnlineSession(profile, code, false);
    s.channel = await openChannel(room(code));
    s.listen();
    await new Promise((resolve, reject) => {
      const send = () => s.channel.send({ t: 'join', id: profile.id, name: profile.name });
      send();
      const retry = setInterval(send, 1000);
      const fail = setTimeout(() => done(new Error('No se encontró el lobby. Revisá el código.')), NET.joinTimeout * 1000);
      const done = (err) => {
        clearInterval(retry);
        clearTimeout(fail);
        s.joinWaiter = null;
        if (err) {
          s.channel.close();
          reject(err);
        } else resolve();
      };
      s.joinWaiter = done;
    });
    s.timers.push(setInterval(() => s.guestTick(), 1000));
    return s;
  }

  constructor(profile, code, isHost) {
    this.me = profile;
    this.code = code;
    this.isHost = isHost;
    this.handlers = {};
    this.timers = [];
    this.lastSeen = new Map(); // anfitrión: id → último mensaje
    this.hostSeen = performance.now(); // invitado: último mensaje del anfitrión
    this.closed = false;
    this.ticks = 0;
  }

  on(event, fn) {
    (this.handlers[event] ??= []).push(fn);
    return this;
  }

  off(event) {
    delete this.handlers[event];
  }

  emit(event, data) {
    this.handlers[event]?.forEach((fn) => fn(data));
  }

  get player() {
    return this.state?.players.find((p) => p.id === this.me.id);
  }

  // ------------------------------------------------------------------ mensajes

  listen() {
    this.channel.onMessage((m) => {
      if (this.closed) return;
      if (this.isHost) this.onHostMessage(m);
      else this.onGuestMessage(m);
    });
  }

  onHostMessage(m) {
    if (m.id) this.lastSeen.set(m.id, performance.now());
    const p = this.state.players.find((x) => x.id === m.id);
    switch (m.t) {
      case 'join': {
        if (p) return this.broadcastState(); // reintento: ya está adentro
        if (this.state.phase !== 'lobby') return this.channel.send({ t: 'reject', id: m.id, reason: 'La partida ya empezó.' });
        if (this.state.players.length >= this.state.max) return this.channel.send({ t: 'reject', id: m.id, reason: 'El lobby está lleno.' });
        const used = new Set(this.state.players.map((x) => x.slot));
        const slot = [...Array(this.state.max).keys()].find((i) => !used.has(i));
        this.state.players.push({ id: m.id, name: cleanName(m.name), slot, host: false, ready: false, driver: null, confirmed: false });
        this.system(`${cleanName(m.name)} entró al lobby.`);
        this.changed();
        break;
      }
      case 'ready':
        if (p && this.state.phase === 'lobby') {
          p.ready = !!m.on;
          this.changed();
        }
        break;
      case 'pilot':
        if (p && this.state.phase === 'pilots') {
          p.driver = m.driver;
          p.confirmed = !!m.confirmed;
          this.changed();
        }
        break;
      case 'chat':
        if (p) this.emit('chat', { name: p.name, slot: p.slot, text: m.text });
        break;
      case 'leave':
        if (p) this.removePlayer(p, `${p.name} salió del lobby.`);
        break;
      case 'in':
        if (p) this.emit('input', m);
        break;
      case 'use':
        if (p) this.emit('use', m);
        break;
      case 'jump':
        if (p) this.emit('jump', m);
        break;
    }
  }

  onGuestMessage(m) {
    this.hostSeen = performance.now();
    switch (m.t) {
      case 'state': {
        const prev = this.state;
        this.state = m.lobby;
        if (!this.player) {
          // Ya no estoy en la lista (me sacaron por desconexión)
          if (prev) this.close('Te desconectaste del lobby.');
          return;
        }
        this.joinWaiter?.();
        this.emit('state', this.state);
        break;
      }
      case 'reject':
        if (m.id === this.me.id) this.joinWaiter?.(new Error(m.reason));
        break;
      case 'chat':
        this.emit('chat', m);
        break;
      case 'race':
        this.emit('race', m.race);
        break;
      case 's':
        this.emit('snap', m);
        break;
      case 'ev':
        this.emit('ev', m);
        break;
      case 'closed':
        this.close('El anfitrión cerró el lobby.');
        break;
    }
  }

  // ------------------------------------------------------------------ acciones

  setReady(on) {
    if (this.isHost) return;
    this.player.ready = on; // se ve al instante; el anfitrión confirma
    this.channel.send({ t: 'ready', id: this.me.id, on });
    this.emit('state', this.state);
  }

  setPilot(driver, confirmed) {
    const p = this.player;
    p.driver = driver;
    p.confirmed = confirmed;
    if (this.isHost) this.changed();
    else {
      this.channel.send({ t: 'pilot', id: this.me.id, driver, confirmed });
      this.emit('state', this.state);
    }
  }

  chat(text) {
    text = String(text).trim().slice(0, 120);
    if (!text) return;
    const msg = { t: 'chat', id: this.me.id, name: this.me.name, slot: this.player.slot, text };
    this.channel.send(msg);
    this.emit('chat', msg);
  }

  /** Salir: el anfitrión cierra el lobby para todos. */
  leave() {
    if (this.closed) return;
    this.channel.send(this.isHost ? { t: 'closed' } : { t: 'leave', id: this.me.id });
    if (this.isHost) this.directory.send({ t: 'gone', code: this.code });
    this.close(null);
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.timers.forEach(clearInterval);
    // Se da un momento para que salga el último mensaje antes de cerrar el canal
    setTimeout(() => {
      this.channel.close();
      this.directory?.close();
    }, 300);
    if (reason) this.emit('closed', reason);
  }

  // ------------------------------------------------------------------ anfitrión

  /** ¿Puede el anfitrión pasar a elegir pilotos? Todos los invitados listos y al menos 2 jugadores. */
  get canStart() {
    const ps = this.state.players;
    return ps.length >= 2 && ps.every((p) => p.host || p.ready);
  }

  startPilots() {
    if (!this.canStart) return;
    this.state.phase = 'pilots';
    for (const p of this.state.players) {
      p.driver = null;
      p.confirmed = false;
    }
    this.changed();
  }

  get allConfirmed() {
    return this.state.players.every((p) => p.confirmed && p.driver);
  }

  /** Arranca la carrera con los pilotos elegidos. Devuelve la configuración (la misma que reciben todos). */
  startRace() {
    const s = this.state;
    s.phase = 'race';
    const race = {
      rounds: s.rounds,
      powerups: s.powerups,
      players: [...s.players].sort((a, b) => a.slot - b.slot).map((p) => ({ id: p.id, name: p.name, slot: p.slot, driver: p.driver })),
    };
    this.changed();
    this.channel.send({ t: 'race', race });
    return race;
  }

  /** Terminada la carrera, todos vuelven al lobby (los invitados tienen que volver a poner Listo). */
  backToLobby() {
    this.state.phase = 'lobby';
    for (const p of this.state.players) {
      p.ready = p.host;
      p.confirmed = false;
    }
    this.changed();
  }

  setOptions({ rounds, powerups, name, isPublic }) {
    Object.assign(this.state, { rounds, powerups, name, public: isPublic });
    this.changed();
  }

  sendSnapshot(snap) {
    this.channel.send(snap);
  }

  sendEvents(list) {
    if (list.length) this.channel.send({ t: 'ev', list });
  }

  removePlayer(p, message) {
    this.state.players = this.state.players.filter((x) => x !== p);
    this.lastSeen.delete(p.id);
    this.system(message);
    this.emit('left', p);
    this.changed();
  }

  system(text) {
    const msg = { t: 'chat', system: true, text };
    this.channel.send(msg);
    this.emit('chat', msg);
  }

  changed() {
    this.broadcastState();
    this.advertise();
    this.emit('state', this.state);
  }

  broadcastState() {
    this.channel.send({ t: 'state', lobby: this.state });
  }

  advertise() {
    const s = this.state;
    if (!s.public) return this.directory.send({ t: 'gone', code: s.code });
    const host = s.players.find((p) => p.host);
    this.directory.send({
      t: 'ad',
      lobby: { code: s.code, name: s.name, host: host.name, players: s.players.length, max: s.max, phase: s.phase, rounds: s.rounds, powerups: s.powerups },
    });
  }

  hostTick() {
    // El estado periódico también sirve de latido para los invitados
    this.broadcastState();
    if (++this.ticks % 2 === 0) this.advertise();
    const now = performance.now();
    for (const p of [...this.state.players]) {
      if (p.host) continue;
      const seen = this.lastSeen.get(p.id) ?? now;
      if (!this.lastSeen.has(p.id)) this.lastSeen.set(p.id, now);
      if (now - seen > NET.dropTimeout * 1000) this.removePlayer(p, `${p.name} se desconectó.`);
    }
  }

  // ------------------------------------------------------------------ invitado

  guestTick() {
    this.channel.send({ t: 'hb', id: this.me.id });
    if (performance.now() - this.hostSeen > NET.dropTimeout * 1000) this.close('Se perdió la conexión con el anfitrión.');
  }

  sendInput(input) {
    this.channel.send({ t: 'in', id: this.me.id, ...input });
  }

  sendUse() {
    this.channel.send({ t: 'use', id: this.me.id });
  }

  sendJump() {
    this.channel.send({ t: 'jump', id: this.me.id });
  }
}

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NET.nameMax) || 'Piloto';
}
