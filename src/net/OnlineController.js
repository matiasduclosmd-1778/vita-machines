import { GAME_CONFIG } from '../config.js';
import { controlsSummary, keyLabel } from '../ui/Settings.js';
import { OnlineSession, browseLobbies } from './Online.js';
import { HostSync, GuestSync } from './NetRace.js';

const NET = GAME_CONFIG.online;
const P1 = GAME_CONFIG.players[0];

/**
 * Une la sesión online con el menú y el juego:
 *  lobby → (todos listos, el anfitrión elige) → elegir piloto → (todos confirman) → carrera → lobby.
 * Cada cambio de fase lo decide el anfitrión; acá cada equipo muestra la pantalla que corresponde.
 */
export class OnlineController {
  constructor(menu, getGame, settings) {
    this.menu = menu;
    this.getGame = getGame;
    this.settings = settings;
    this.id = crypto.randomUUID(); // uno por pestaña: dos pestañas son dos jugadores distintos
    this.session = null;
    this.chat = [];
    this.view = null; // 'lobby' | 'pilots' | 'race'
    window.addEventListener('beforeunload', () => this.session?.leave());
  }

  get profile() {
    return { id: this.id, name: this.settings.profile.name };
  }

  browse(onChange) {
    return browseLobbies(onChange);
  }

  async create(options) {
    this.attach(await OnlineSession.host(this.profile, options));
  }

  async join(code) {
    this.attach(await OnlineSession.join(this.profile, code));
  }

  attach(session) {
    this.session = session;
    this.chat = [];
    this.view = null;
    session.on('state', () => this.onState());
    session.on('chat', (m) => {
      this.chat.push(m);
      if (this.chat.length > 80) this.chat.shift();
      this.menu.onlineChat?.(m);
    });
    session.on('race', (race) => this.startRace(race));
    session.on('closed', (reason) => this.onClosed(reason));
    this.onState();
  }

  /** Muestra la pantalla de la fase actual (o solo la actualiza si ya está). */
  onState() {
    const s = this.session;
    if (!s) return;
    const phase = s.state.phase;
    if (phase === 'lobby' && this.view !== 'lobby') {
      this.stopRace();
      this.view = 'lobby';
      this.menu.showLobby();
    } else if (phase === 'pilots' && this.view !== 'pilots') {
      this.view = 'pilots';
      this.menu.showOnlinePilots();
    } else {
      this.menu.onlineUpdate?.();
    }
    // El anfitrión arranca la carrera cuando todos confirmaron su piloto
    if (s.isHost && phase === 'pilots' && s.allConfirmed && !this.startTimer) {
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        if (this.session === s && s.state.phase === 'pilots' && s.allConfirmed) this.startRace(s.startRace());
      }, 900);
    }
  }

  /** Arma los autos de todos (mismo orden en cada equipo) y arranca la carrera. */
  startRace(race) {
    const game = this.getGame();
    const s = this.session;
    const players = race.players.map((p) => {
      const slot = NET.slots[p.slot] ?? NET.slots[0];
      const me = p.id === s.me.id;
      return {
        id: p.id,
        name: p.name,
        short: p.name.slice(0, 3).toUpperCase(),
        color: slot.color,
        paint: slot.paint,
        driver: p.driver,
        controlsLabel: me ? controlsSummary(P1.controls) : '',
        useLabel: me ? keyLabel(P1.controls.use) : '',
      };
    });
    game.setupPlayers(players);
    const sync = s.isHost ? new HostSync(game, s, race) : new GuestSync(game, s, race);
    game.hud.markLocal(sync.localIndex);
    this.view = 'race';
    this.menu.hide();
    game.startOnlineRace(sync, race);
  }

  stopRace() {
    const game = this.getGame();
    if (!game?.net) return;
    game.stop();
    game.endOnline();
  }

  /** Anfitrión, al terminar la carrera: todos vuelven al lobby. */
  backToLobby() {
    this.session?.isHost && this.session.backToLobby();
  }

  leave() {
    clearTimeout(this.startTimer);
    this.startTimer = null;
    this.session?.leave();
    this.session = null;
    this.view = null;
    this.stopRace();
    this.menu.showOnline();
  }

  onClosed(reason) {
    clearTimeout(this.startTimer);
    this.startTimer = null;
    this.session = null;
    this.view = null;
    this.stopRace();
    this.menu.showOnline();
    this.menu.toast(reason);
  }
}
