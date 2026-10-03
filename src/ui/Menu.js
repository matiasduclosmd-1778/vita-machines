import './menu.css';
import { GAME_CONFIG, POWERUP_CONFIG } from '../config.js';
import { MAPS } from '../maps/index.js';
import { ACTIONS, RESERVED_KEYS, defaultSettings, keyLabel, localPlayerName, saveSettings } from './Settings.js';
import { OnlineScreens } from './OnlineScreens.js';
import { input, parsePad, MAX_PADS } from '../Input.js';
import { pilotImage, vehicleImage, initials, breakableName } from './pilots.js';
import { audio } from '../audio/index.js';
import { padGlyph, decoratePadButtons, padMode } from './padHints.js';

const PLAYERS = GAME_CONFIG.players;
const VERSION = 'v0.3.0 · Local hasta 4 jugadores (teclado o joystick) · Online hasta 6';

const TIPS = [
  'Llegá rápido a la rampa rayada: si vas lento, no alcanzás la plataforma.',
  'La regla del atajo no tiene barandas: es más corta, pero si caés perdés tiempo.',
  'Si la cámara te deja atrás, quedás eliminado. Y si te quedás sin vida, también.',
  'Cada ronda la gana el último que queda en pie. Gana la partida el que más rondas gana.',
  'Bomba: -35 de vida. Misil: -80. Imán: -15. El escudo te salva de todo.',
  'El escudo te protege de la bomba, el misil, el aceite y el imán.',
  'El misil 🎯 persigue al rival por la pista: lanzalo cuando lo tengas adelante.',
  'En el borde del escritorio no hay baranda: frená antes de la curva.',
  'El turbo sirve para recuperar terreno cuando la cámara te está dejando atrás.',
  'Online: creá un lobby y pasales el código de 6 letras a tus amigos (hasta 6 jugadores).',
  'Todos pueden saltar por encima de los autos (Shift o A del joystick). La moto salta más alto.',
  'En local pueden correr hasta 4 autos, entre personas y CPU. Los joysticks y nombres se eligen en Jugadores.',
];

const MODES = [
  { id: 'race', title: 'Carrera', desc: 'Ganá rondas: dejá a los rivales atrás o sin vida.', ready: true },
  { id: 'crash', title: 'Choque total', desc: 'Derribá máquinas rivales en la arena.', ready: false },
  { id: 'core', title: 'Núcleo', desc: 'Capturá y defendé el núcleo del barrio.', ready: false },
];

const DIFFICULTIES = GAME_CONFIG.ai.difficulties;
const LOCAL = GAME_CONFIG.localPlayers;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const rivalText = (r) =>
  plural(r.humans, 'jugador', 'jugadores') + (r.cpus ? ` + ${plural(r.cpus, 'CPU', 'CPU')} · ${DIFFICULTIES[r.difficulty].label}` : '');
const ROUND_OPTIONS = GAME_CONFIG.race.roundOptions;
const POWERUP_AMOUNTS = { off: 'No', ...Object.fromEntries(Object.entries(POWERUP_CONFIG.itemBoxes.amounts).map(([id, a]) => [id, a.label])) };
const powerupsText = (r) => (r.powerups === 'off' ? 'Sin objetos' : POWERUP_AMOUNTS[r.powerups]);
const DRIVERS = GAME_CONFIG.drivers;

const STAT_LABELS = { vel: 'Velocidad', acel: 'Aceleración', man: 'Manejo', res: 'Resistencia' };

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Tarjetas de "Elegí tu piloto" (también las usa la versión online). p2Tag: texto de la etiqueta del segundo jugador. */
export function pilotCardsHTML(p2Tag = 'J2') {
  const bar = (v) => `<div class="vm-pk-bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div>`;
  const car = vehicleImage;
  return DRIVERS.map((d, i) => `
            <article class="vm-pk-card" role="option" data-i="${i}" style="--c1:${d.c1};--c2:${d.c2};--paint:${d.paint};--w:${d.w};--t:${d.t};--l:${d.l}">
              <div class="vm-pk-portrait">
                <div class="vm-pk-tags"><span class="vm-pk-tag p1">J1</span><span class="vm-pk-tag p2">${p2Tag}</span></div>
                <span class="vm-pk-ready">LISTO</span>
                ${d.portrait
                  ? `<img class="vm-pk-who" src="${pilotImage(d.portrait)}" alt="${esc(d.name)}">`
                  : `<div class="vm-pk-who vm-pk-noportrait" aria-hidden="true">${esc(initials(d.name))}</div>`}
                ${car(d) ? `<img class="vm-pk-car ${d.carImage ? '' : 'render'}" src="${car(d)}" alt="${esc(d.carLabel)} ${esc(d.paintName.toLowerCase())}">` : ''}
              </div>
              <div class="vm-pk-body">
                <h2 class="vm-pk-name ${d.name.length > 12 ? 'long' : ''}">${breakableName(esc(d.name))}</h2>
                <p class="vm-pk-ride">${esc(d.carLabel)} <span><i class="vm-pk-sw"></i>${esc(d.paintName)}</span></p>
                <p class="vm-pk-quip">${esc(d.quip)}</p>
                <dl class="vm-pk-stats">
                  ${Object.entries(d.stats).map(([k, v]) => `
                    <div class="vm-pk-stat ${k === 'vel' ? 'speed' : ''}"><dt>${STAT_LABELS[k]}</dt><dd>${bar(v)}</dd><dd class="vm-pk-val">${k === 'vel' ? `${d.kmh} km/h` : `${v}/10`}</dd></div>`).join('')}
                </dl>
              </div>
            </article>`).join('');
}

/**
 * Menús del juego (HUB). Pantallas: carga, inicio, crear partida, unirse (vista previa),
 * lobby (vista previa), teclado, configuración, salir y pausa.
 */
export class Menu {
  /**
   * @param root      contenedor DOM
   * @param settings  ajustes actuales (ver Settings.js)
   * @param callbacks { onStartRace(race), onApplySettings(settings), onResume(), onRestart(), onQuitToMenu() }
   */
  constructor(root, settings, callbacks) {
    this.root = root;
    this.settings = settings;
    this.cb = callbacks;
    this.race = { name: 'Carrera en el escritorio', mode: 'race', map: 'desk', powerups: 'normal', rounds: GAME_CONFIG.race.rounds, difficulty: 'normal', humans: LOCAL.humans, cpus: LOCAL.cpus };
    this.thumbs = { map: null, car: null };
    this.listening = null;

    root.classList.add('vm-root');
    root.innerHTML = `
      <div class="vm-stage">
        <div class="vm-bg"></div>
        <div class="vm-layer"></div>
        <div class="vm-modal-host"></div>
      </div>`;
    this.stage = root.querySelector('.vm-stage');
    this.layer = root.querySelector('.vm-layer');
    this.modalHost = root.querySelector('.vm-modal-host');

    const fit = () => root.style.setProperty('--vm-scale', Math.min(innerWidth / 1920, innerHeight / 1080));
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    // Joysticks: la cruceta o el stick mueven el foco, A elige, B vuelve
    input.onPress((code) => this.onPad(code));
    // Ayuda del mando (solo en modo mando): mover, elegir, volver
    this.stage.insertAdjacentHTML(
      'beforeend',
      `<div class="vm-padbar pad-only">${padGlyph('A', { always: true })} Elegir ${padGlyph('B', { always: true })} Volver <span class="vm-padbar-move">✚</span> Mover</div>`,
    );
    // Sonidos de la interfaz: pasar por encima de un botón y elegirlo (volver tiene el suyo)
    const control = (e) => e.target.closest?.('button:not([disabled]), .vm-pk-card');
    root.addEventListener('click', (e) => {
      const c = control(e);
      if (c) audio.play(c.matches('[data-back], [data-cancel]') ? 'ui-back' : 'ui-select');
    }, true);
    root.addEventListener('pointerover', (e) => {
      const c = control(e);
      if (c && c !== this.hovered) audio.play('ui-move');
      this.hovered = c;
    });
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
    this.closeModal();
  }

  setThumbnails(thumbs) {
    Object.assign(this.thumbs, thumbs);
  }

  // ------------------------------------------------------------------ navegación

  render(html, { back = null, onMount, music = 0 } = {}) {
    // Música del menú: tranquila; en la elección de piloto (music = 1), con batería y melodía
    audio.music.play('menu', music);
    audio.music.setIntensity(music);
    this.opaque();
    this.root.classList.remove('hidden');
    this.closeModal();
    this.back = back;
    this.screenKey = null; // teclas propias de la pantalla (la de pilotos)
    // Lo que dejó andando la pantalla anterior (lista de lobbies, avisos del lobby)
    this.leaveScreen?.();
    this.leaveScreen = null;
    this.onlineUpdate = null;
    this.onlineChat = null;
    this.layer.innerHTML = html;
    this.layer.firstElementChild?.classList.add('vm-enter');
    this.layer.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => back?.()));
    onMount?.(this.layer);
    decoratePadButtons(this.layer);
    if (padMode()) this.focusDefault(this.layer);
  }

  /** Foco en la acción principal (data-default, o el botón amarillo, o el primero): A la elige de entrada. */
  focusDefault(scope = this.modal ?? this.layer) {
    const el =
      scope.querySelector('[data-default]:not([disabled])') ??
      scope.querySelector('.vm-btn.yellow:not([disabled])') ??
      scope.querySelector('button:not([disabled])');
    el?.focus({ preventScroll: true });
  }

  onKey(e) {
    if (!this.visible) return;
    // Escribiendo en un campo (nombres): las teclas son del texto; Escape solo sale del campo
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        t.blur();
      }
      return;
    }
    if (this.listening) {
      e.preventDefault();
      e.stopPropagation();
      this.captureKey(e.code);
      return;
    }
    if (!this.modal && this.screenKey?.(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.modal || this.back) audio.play('ui-back');
      if (this.modal) this.modalCancel?.();
      else this.back?.();
    }
  }

  /** Botón de joystick con el menú abierto. Devuelve true (el menú se queda con el evento). */
  onPad(code) {
    const pad = parsePad(code);
    if (!pad || !this.visible) return false;
    if (this.listening) return true;
    if (!this.modal && this.screenKey?.(code)) return true;
    const b = pad.button;
    // Atajos: el botón con [data-pad="X" | "Y" | "Start"] de la pantalla (o del diálogo abierto)
    if (b === 'X' || b === 'Y' || b === 'Start') {
      const target = [...(this.modal ?? this.layer).querySelectorAll(`[data-pad="${b}"]`)].find((e) => !e.disabled && e.getClientRects().length);
      if (target) target.click();
      return true;
    }
    if (b === 'B' || b === 'Back') {
      audio.play('ui-back');
      if (this.modal) this.modalCancel?.();
      else this.back?.();
    } else if (b === 'Up' || b === 'Down' || b === 'Left' || b === 'Right') {
      this.moveFocus(b);
    } else if (b === 'A') {
      const el = document.activeElement;
      if (el && el !== document.body && this.root.contains(el)) el.click();
      else this.focusDefault();
    }
    return true;
  }

  /** Mueve el foco al control más cercano en esa dirección (o al primero si no hay ninguno). */
  moveFocus(dir) {
    const scope = this.modal ?? this.layer;
    const items = [...scope.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(
      (e) => e.getClientRects().length && getComputedStyle(e).pointerEvents !== 'none',
    );
    if (!items.length) return;
    const cur = items.includes(document.activeElement) ? document.activeElement : null;
    const delta = { Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] }[dir];
    if (!cur || !delta) return this.focusDefault(scope);
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    const [x0, y0] = center(cur);
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const [x, y] = center(el);
      const along = (x - x0) * delta[0] + (y - y0) * delta[1];
      if (along <= 1) continue;
      const across = Math.abs((x - x0) * delta[1] - (y - y0) * delta[0]);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus();
      audio.play('ui-move');
    }
  }

  toast(text) {
    this.stage.querySelector('.vm-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'vm-toast';
    t.textContent = text;
    this.stage.appendChild(t);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.remove(), 2200);
  }

  openModal(html, { onCancel } = {}) {
    this.modalHost.innerHTML = `<div class="vm-modal">${html}</div>`;
    this.modal = this.modalHost.firstElementChild;
    this.modalCancel = onCancel;
    decoratePadButtons(this.modal);
    if (padMode()) setTimeout(() => this.modal && this.focusDefault(this.modal));
    return this.modal;
  }

  closeModal() {
    this.modalHost.innerHTML = '';
    this.modal = null;
    this.modalCancel = null;
  }

  header(title, backLabel = 'VOLVER') {
    return `
      <div class="vm-header">
        <button class="vm-btn dark vm-back" data-back>‹ ${backLabel} <span class="vm-kbd kbd-hint">ESC</span></button>
        <div class="vm-display">${title}</div>
        <div class="vm-stripe"></div>
      </div>`;
  }

  // ------------------------------------------------------------------ CARGA

  showLoading(title = 'CARGANDO CALLES…') {
    this.opaque();
    this.root.classList.remove('hidden');
    this.closeModal();
    this.back = null;
    this.screenKey = null;
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.layer.innerHTML = `
      <div class="vm-shade-bottom" style="display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div class="vm-logo big" style="margin-top:-120px">
          <div class="vm-display">VITA</div>
          <div class="vm-display yellow">MACHINES</div>
          <div class="vm-stripe" style="border-width:6px;border-radius:14px"></div>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:110px;display:flex;flex-direction:column;align-items:center;gap:22px">
          <div class="vm-display" style="--stroke:6px;--drop:0px;width:1100px;display:flex;justify-content:space-between;align-items:center;font-size:40px;letter-spacing:1px">
            <div style="display:flex;align-items:center;gap:18px"><div class="vm-spinner"></div><span class="vm-load-title">${esc(title)}</span></div>
            <span class="vm-load-pct" style="color:var(--vm-yellow)">0%</span>
          </div>
          <div class="vm-loading-bar"><div style="width:0%"></div></div>
          <div style="font-size:28px;font-weight:800;max-width:1100px;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.8)">
            <span style="color:var(--vm-yellow);font-weight:900;letter-spacing:2px">CONSEJO · </span>${esc(tip)}
          </div>
        </div>
      </div>`;
  }

  setProgress(p) {
    const pct = Math.round(Math.min(1, p) * 100);
    const bar = this.layer.querySelector('.vm-loading-bar > div');
    if (bar) bar.style.width = pct + '%';
    const label = this.layer.querySelector('.vm-load-pct');
    if (label) label.textContent = pct + '%';
  }

  // ------------------------------------------------------------------ INICIO

  showHome() {
    this.render(`
      <div>
        <div class="vm-shade-left"></div>
        <div class="vm-profile">
          <div class="vm-avatars">
            <div class="vm-avatar" style="--c:${PLAYERS[0].color}">${esc(this.settings.profile.name[0]?.toUpperCase() ?? '?')}</div>
          </div>
          <div>
            <div class="name">${esc(this.settings.profile.name)}</div>
            <button class="vm-profile-edit" data-go="name">✎ CAMBIAR NOMBRE</button>
          </div>
        </div>
        <div style="position:absolute;left:120px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:64px">
          <div class="vm-logo">
            <div class="vm-display">VITA</div>
            <div class="vm-display yellow">MACHINES</div>
            <div class="vm-stripe"></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:22px;width:560px">
            <button class="vm-btn yellow hero" data-go="create" data-default><span>CREAR PARTIDA</span><span>›</span></button>
            <button class="vm-btn" data-go="online"><span>JUGAR ONLINE</span><span>›</span></button>
            <button class="vm-btn" data-go="keys"><span>JUGADORES</span><span>›</span></button>
            <button class="vm-btn" data-go="config"><span>CONFIGURACIÓN</span><span>›</span></button>
            <button class="vm-btn red stroked" data-go="exit"><span>SALIR</span><span>✕</span></button>
          </div>
        </div>
        <div class="vm-mono vm-muted" style="position:absolute;left:120px;bottom:40px;font-size:18px">${VERSION}</div>
        <div class="vm-muted" style="position:absolute;right:72px;bottom:40px;font-size:17px;font-weight:700;text-align:right">
          Modelo del auto: «2023 Toyota Corolla Hybrid» por tonielpro520 (Sketchfab) · CC BY 4.0
        </div>
      </div>`, {
      back: () => this.showExit(),
      onMount: (el) => {
        const go = {
          create: () => this.showCreate(),
          online: () => this.showOnline(),
          name: () => this.showName(),
          keys: () => this.showKeyboard(),
          config: () => this.showConfig(),
          exit: () => this.showExit(),
        };
        el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go[b.dataset.go]()));
      },
    });
  }

  // ------------------------------------------------------------------ CREAR PARTIDA

  showCreate() {
    const r = this.race;
    const mapThumb = this.thumbs.map ? `background-image:url(${this.thumbs.map})` : 'background:#333';
    const art = (size, pos) => `background-image:url(/ui/street.jpg);background-size:${size};background-position:${pos}`;
    const maps = [
      { id: 'desk', name: MAPS.desk.name, style: mapThumb, ready: true },
      { id: 'living', name: MAPS.living.name, style: `background-image:url(${MAPS.living.thumb});background-size:cover;background-position:50% 55%`, ready: true },
      { id: 'avenue', name: 'Avenida Rota', style: art('160% auto', '50% 62%'), ready: false },
      { id: 'brick', name: 'Barrio Ladrillo', style: art('260% auto', '4% 40%'), ready: false },
    ];
    this.render(`
      <div class="vm-screen">
        ${this.header('CREAR PARTIDA')}
        <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) 620px;gap:40px;min-height:0">
          <div class="vm-panel" style="display:flex;flex-direction:column;gap:30px">
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="vm-label">NOMBRE DE LA PARTIDA</div>
              <input class="vm-input" maxlength="28" value="${esc(r.name)}" data-name>
            </div>
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="vm-label">MODO DE JUEGO</div>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px">
                ${MODES.map((m) => `
                  <button class="vm-card ${r.mode === m.id ? 'selected' : ''}" ${m.ready ? '' : 'disabled'} data-mode="${m.id}">
                    ${m.ready ? '' : '<span class="vm-soon">PRÓXIMAMENTE</span>'}
                    <span class="title">${m.title}</span><span class="desc">${m.desc}</span>
                  </button>`).join('')}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="vm-label">MAPA</div>
              <div style="display:grid;grid-template-columns:repeat(${maps.length},minmax(0,1fr));gap:20px">
                ${maps.map((m) => `
                  <button class="vm-map ${r.map === m.id ? 'selected' : ''}" ${m.ready ? `data-map="${m.id}"` : 'disabled'}>
                    ${m.ready ? '' : '<span class="vm-soon">PRÓXIMAMENTE</span>'}
                    <div class="thumb" style="${m.style}"></div>
                    <div class="name">${m.name}</div>
                  </button>`).join('')}
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:28px">
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">JUGADORES</div>
                <div class="vm-seg" style="grid-template-columns:repeat(${LOCAL.max},1fr)" data-humans>
                  ${Array.from({ length: LOCAL.max }, (_, i) => i + 1).map((n) => `<button class="${r.humans === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">CPU</div>
                <div class="vm-seg" style="grid-template-columns:repeat(${LOCAL.max},1fr)" data-cpus>
                  ${Array.from({ length: LOCAL.max }, (_, n) => n).map((n) => `<button class="${r.cpus === n ? 'on' : ''}" data-v="${n}" ${r.humans + n > LOCAL.max || r.humans + n < 2 ? 'disabled' : ''}>${n}</button>`).join('')}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px;${r.cpus ? '' : 'opacity:.35;pointer-events:none'}">
                <div class="vm-label">DIFICULTAD CPU</div>
                <div class="vm-seg" style="grid-template-columns:repeat(3,1fr)" data-difficulty>
                  ${Object.entries(DIFFICULTIES).map(([id, d]) => `<button class="${r.difficulty === id ? 'on' : ''}" data-v="${id}">${d.label}</button>`).join('')}
                </div>
              </div>
            </div>
          </div>
          <div class="vm-panel" style="padding:30px;display:flex;flex-direction:column;gap:20px">
            <div style="display:flex;flex-direction:column;gap:20px">
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">RONDAS</div>
                <div class="vm-seg" style="grid-template-columns:repeat(${ROUND_OPTIONS.length},1fr)" data-rounds>
                  ${ROUND_OPTIONS.map((n) => `<button class="${r.rounds === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">POWER-UPS</div>
                <div class="vm-seg" style="grid-template-columns:repeat(4,1fr)" data-powerups>
                  ${Object.entries(POWERUP_AMOUNTS).map(([id, label]) => `<button class="${r.powerups === id ? 'on' : ''}" data-v="${id}">${label}</button>`).join('')}
                </div>
              </div>
            </div>
            <div>
              <div class="vm-display" style="--stroke:0px;--drop:0px;font-size:48px" data-summary-name>${esc(r.name)}</div>
              <div class="vm-muted" style="font-weight:800;font-size:22px">Resumen de la partida</div>
            </div>
            <div style="display:flex;flex-direction:column;font-weight:800;font-size:24px">
              ${[['Modo', 'Carrera', ''], ['Mapa', MAPS[r.map]?.name ?? MAPS.desk.name, 'data-summary-map'], ['Corredores', rivalText(r), 'data-summary-rival'], ['Rondas', r.rounds, 'data-summary-rounds'], ['Power-ups', powerupsText(r), 'data-summary-pu']].map(([k, v, attr]) => `
                <div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:2px solid var(--vm-line)">
                  <span class="vm-muted">${k}</span><span ${attr}>${v}</span>
                </div>`).join('')}
            </div>
            <button class="vm-btn yellow hero center" style="margin-top:auto" data-start data-pad="Start" data-default>¡A CORRER!</button>
          </div>
        </div>
      </div>`, {
      back: () => this.showHome(),
      onMount: (el) => {
        const name = el.querySelector('[data-name]');
        name.addEventListener('input', () => {
          r.name = name.value.trim() || MAPS[r.map].raceName;
          el.querySelector('[data-summary-name]').textContent = r.name;
        });
        // Mapa: si la partida tenía el nombre por defecto, toma el del mapa nuevo
        el.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => {
          const wasDefault = Object.values(MAPS).some((m) => m.raceName === r.name);
          r.map = b.dataset.map;
          el.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('selected', x === b));
          el.querySelector('[data-summary-map]').textContent = MAPS[r.map].name;
          if (wasDefault) {
            r.name = MAPS[r.map].raceName;
            name.value = r.name;
            el.querySelector('[data-summary-name]').textContent = r.name;
          }
        }));
        el.querySelectorAll('[data-powerups] button').forEach((b) => b.addEventListener('click', () => {
          r.powerups = b.dataset.v;
          el.querySelectorAll('[data-powerups] button').forEach((x) => x.classList.toggle('on', x === b));
          el.querySelector('[data-summary-pu]').textContent = powerupsText(r);
        }));
        el.querySelectorAll('[data-rounds] button').forEach((b) => b.addEventListener('click', () => {
          r.rounds = +b.dataset.v;
          el.querySelectorAll('[data-rounds] button').forEach((x) => x.classList.toggle('on', x === b));
          el.querySelector('[data-summary-rounds]').textContent = r.rounds;
        }));
        const seg = (sel, apply) => el.querySelectorAll(`${sel} button`).forEach((b) => b.addEventListener('click', () => {
          apply(b.dataset.v);
          el.querySelectorAll(`${sel} button`).forEach((x) => x.classList.toggle('on', x === b));
          el.querySelector('[data-summary-rival]').textContent = rivalText(r);
        }));
        // Personas y CPU suman de 2 a LOCAL.max autos: al cambiar uno se ajusta el otro y se rearma la pantalla
        const count = (key) => el.querySelectorAll(`[data-${key}] button`).forEach((b) => b.addEventListener('click', () => {
          r[key] = +b.dataset.v;
          if (key === 'humans') r.cpus = Math.min(Math.max(r.cpus, 2 - r.humans), LOCAL.max - r.humans);
          this.showCreate();
          this.layer.querySelector(`[data-${key}] [data-v="${r[key]}"]`).focus();
        }));
        count('humans');
        count('cpus');
        seg('[data-difficulty]', (v) => (r.difficulty = v));
        el.querySelector('[data-start]').addEventListener('click', () => this.showPilots());
      },
    });
  }

  // ------------------------------------------------------------------ ELEGÍ TU PILOTO

  /**
   * Selección por turnos: elige un jugador por vez (con sus teclas o su joystick: girar para moverse,
   * usar objeto / A para confirmar). Al confirmar, el locutor dice el nombre del piloto y recién
   * cuando termina le toca al siguiente. Con todas las personas listas, las CPU eligen al azar
   * (prefiriendo pilotos libres) y cualquiera arranca la carrera. Volver deshace la última elección.
   */
  showPilots() {
    const r = this.race;
    const count = r.humans + r.cpus;
    const players = PLAYERS.slice(0, count);
    const n = DRIVERS.length;
    const index = (id) => Math.max(0, DRIVERS.findIndex((d) => d.id === id));
    const humans = players.map((_, i) => i).filter((i) => i < r.humans);
    const cpus = players.map((_, i) => i).filter((i) => i >= r.humans);
    const st = { p: players.map((_, i) => (i < r.humans ? index(this.settings.drivers[i]) : -1)), ready: players.map(() => false), go: false, waiting: false };
    const controls = this.settings.controls;
    const pads = this.settings.pads;
    const name = (i) => (i < r.humans ? players[i].humanName ?? players[i].name : cpus.length > 1 ? `CPU ${i - r.humans + 1}` : 'CPU');
    const tag = (i) => (i < r.humans ? `J${i + 1}` : cpus.length > 1 ? `CPU${i - r.humans + 1}` : 'CPU');
    // Teclas de cada jugador y, si tiene joystick, sus botones (cruceta elige, A confirma)
    const keys = (i) =>
      `<span class="kbd-hint"><kbd>${keyLabel(controls[i].left)}</kbd><kbd>${keyLabel(controls[i].right)}</kbd> elegir <kbd>${keyLabel(controls[i].use)}</kbd> confirmar</span>` +
      (pads[i] != null ? ` <span>🎮${pads[i] + 1} ✚ elegir ${padGlyph('A', { always: true })} confirmar</span>` : '');
    const sub = `${plural(r.humans, 'JUGADOR', 'JUGADORES')}${r.cpus ? ` · ${r.cpus} CPU · ${DIFFICULTIES[r.difficulty].label.toUpperCase()}` : ''}`;
    /** A quién le toca: la primera persona sin confirmar (null = ya eligieron todas). */
    const turn = () => humans.find((h) => !st.ready[h]) ?? null;

    this.render(`
      <div class="vm-screen vm-pk">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px">
          ${this.header('ELEGÍ TU PILOTO')}
          <div class="vm-pk-players">
            <div class="vm-pk-dots">${players.map((p, i) => `<span class="vm-pk-dot" data-dot="${i}" style="background:${p.color};${i ? 'margin-left:-11px' : ''}">${i < r.humans ? i + 1 : '🤖'}</span>`).join('')}</div>
            <div><b data-names>${players.map((_, i) => esc(name(i))).join(' · ')}</b><small>${sub}</small></div>
          </div>
        </div>
        <section class="vm-pk-grid" role="listbox" aria-label="Pilotos">
          ${pilotCardsHTML()}
        </section>
        <div class="vm-pk-foot">
          <div class="vm-pk-keys" ${humans.length > 2 ? 'style="font-size:.82em"' : ''}>
            ${humans.map((i) => `<span data-keys="${i}"><i class="vm-pk-pill" style="background:${players[i].color}"></i><input class="vm-pk-player" maxlength="${LOCAL.nameMax}" value="${esc(this.settings.names[i])}" placeholder="${esc(localPlayerName({ ...this.settings, names: [] }, i).name)}" data-player-name="${i}" aria-label="Nombre del jugador ${i + 1}" title="Tu nombre: hacé clic para cambiarlo"> ${keys(i)}</span>`).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:22px">
            <span class="vm-pk-status" data-status aria-live="polite"></span>
            <button class="vm-btn yellow vm-pk-cta" data-cta data-pad="Start"><span data-cta-text></span><span>›</span></button>
          </div>
        </div>
      </div>`, {
      music: 1,
      back: () => {
        // Deshace la última elección (le vuelve a tocar a ese jugador; si el locutor estaba hablando,
        // se corta); sin nada elegido, vuelve a Crear partida
        if (st.go) return;
        clearTimeout(st.timer);
        st.waiting = false;
        const last = [...humans].reverse().find((h) => st.ready[h]);
        if (last == null) return this.showCreate();
        unready(last);
        update();
      },
      onMount: (el) => {
        el.querySelectorAll('.vm-pk-card').forEach((c) => c.addEventListener('click', () => {
          const i = turn();
          if (i == null || st.go || st.waiting) return;
          st.p[i] = +c.dataset.i;
          update();
        }));
        el.querySelector('[data-cta]').addEventListener('click', () => confirm(turn() ?? humans[0]));
        el.querySelectorAll('.vm-pk-tags').forEach((t) => (t.innerHTML = ''));
        // Nombre de cada jugador: se escribe acá mismo (es el mismo de la pantalla Jugadores)
        el.querySelectorAll('[data-player-name]').forEach((field) => {
          const pi = Number(field.dataset.playerName);
          const save = () => {
            this.settings.names[pi] = field.value.replace(/\s+/g, ' ').trim();
            this.commitSettings(); // actualiza humanName (cartel, HUD y podio)
            el.querySelector('[data-names]').textContent = players.map((_, i) => name(i)).join(' · ');
            update();
          };
          field.addEventListener('change', save);
          field.addEventListener('keydown', (e) => {
            e.stopPropagation(); // las letras son del nombre, no para elegir piloto
            if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') field.blur();
          });
        });
      },
    });

    const el = this.layer;
    const cards = [...el.querySelectorAll('.vm-pk-card')];
    const allReady = () => st.ready.every(Boolean);
    function update() {
      if (!cards[0]?.isConnected) return; // ya se pasó a la pantalla de carga
      const now = turn();
      cards.forEach((c, i) => {
        // En cada tarjeta: el cursor del que está eligiendo y las elecciones ya confirmadas
        const cursor = now != null && !st.waiting && st.p[now] === i;
        const chosen = players.map((_, j) => j).filter((j) => st.ready[j] && st.p[j] === i);
        c.classList.toggle('sel', cursor);
        c.classList.toggle('sel-p2', chosen.length > 0);
        if (chosen.length) c.style.setProperty('--pk-p2', players[chosen[chosen.length - 1]].color);
        c.classList.toggle('ready-on', chosen.length > 0);
        c.setAttribute('aria-selected', cursor);
        const tags = [...chosen, ...(cursor ? [now] : [])];
        c.querySelector('.vm-pk-tags').innerHTML = tags
          .map((j) => `<span class="vm-pk-tag" style="display:inline-block;background:${players[j].color}">${esc(tag(j))}${st.ready[j] ? ' ✓' : ''}</span>`)
          .join('');
      });
      // Resalta al que le toca (punto de arriba y sus teclas abajo)
      el.querySelectorAll('[data-dot]').forEach((d) => {
        const on = +d.dataset.dot === now;
        d.style.transform = on ? 'scale(1.25)' : '';
        d.style.zIndex = on ? 2 : '';
        d.style.boxShadow = on ? '0 0 0 4px var(--pk-yellow)' : '';
      });
      el.querySelectorAll('[data-keys]').forEach((k) => (k.style.opacity = now == null || +k.dataset.keys === now ? '' : '0.35'));
      const text = el.querySelector('[data-cta-text]');
      const status = el.querySelector('[data-status]');
      const last = [...humans].reverse().find((h) => st.ready[h]);
      if (st.go) text.textContent = 'Cargando pista…';
      else if (st.waiting) text.textContent = `¡${DRIVERS[st.p[last]].name}!`;
      else if (allReady()) text.textContent = 'Arrancar carrera';
      else text.textContent = `Confirmar ${tag(now)}`;
      if (allReady() || st.go) status.textContent = st.p.map((d) => DRIVERS[d].name).join(' vs ');
      else if (st.waiting) status.textContent = `${name(last)} eligió a ${DRIVERS[st.p[last]].name}`;
      else status.textContent = `Turno de ${name(now)}${humans.length > 1 ? ` (${humans.indexOf(now) + 1} de ${humans.length})` : ''}${cpus.length && now === humans[humans.length - 1] ? ' · después eligen las CPU' : ''}`;
      el.querySelector('[data-cta]').disabled = st.go || st.waiting;
    }
    /** Las CPU eligen al azar entre los pilotos menos usados (así se repite lo menos posible). */
    const pickCpus = () => {
      for (const i of cpus) {
        const uses = DRIVERS.map((_, d) => st.p.filter((x) => x === d).length);
        const least = Math.min(...uses);
        const options = DRIVERS.map((_, d) => d).filter((d) => uses[d] === least);
        st.p[i] = options[Math.floor(Math.random() * options.length)];
        st.ready[i] = true;
      }
    };
    const unready = (i) => {
      st.ready[i] = false;
      for (const c of cpus) {
        st.ready[c] = false;
        st.p[c] = -1;
      }
      audio.voices.stop();
    };
    const start = () => {
      st.go = true;
      audio.play('ui-start');
      const drivers = st.p.map((i) => DRIVERS[i].id);
      // Se recuerda el piloto de cada persona (el de la CPU no)
      this.settings.drivers = this.settings.drivers.map((id, i) => (humans.includes(i) ? drivers[i] : id));
      saveSettings(this.settings);
      update();
      this.cb.onStartRace({ ...r, drivers });
    };
    /** Confirma la elección del que tiene el turno; el siguiente espera a que el locutor termine. */
    const confirm = (i) => {
      if (st.go || st.waiting) return;
      if (allReady()) return start();
      if (i !== turn()) return;
      st.ready[i] = true;
      audio.play('ui-confirm');
      const end = audio.voices.say(DRIVERS[st.p[i]].id); // el locutor dice el nombre del piloto elegido
      if (humans.every((h) => st.ready[h])) pickCpus();
      st.waiting = true;
      update();
      const ms = end != null ? Math.max(350, (end - audio.engine.now) * 1000) : 450;
      st.timer = setTimeout(() => {
        st.waiting = false;
        update();
      }, ms);
    };
    this.screenKey = (code) => {
      if (st.go) return false;
      if (code === 'Backspace') return this.back(), true;
      const pad = parsePad(code);
      const i = pad ? humans.find((h) => pads[h] === pad.pad) : humans.find((h) => Object.values(controls[h]).includes(code));
      if (i == null) return false;
      const action = pad
        ? { Left: 'left', Right: 'right', A: 'use', X: 'use', B: 'back', Start: 'use' }[pad.button]
        : Object.keys(controls[i]).find((a) => controls[i][a] === code);
      if (action === 'back') {
        audio.play('ui-back');
        this.back();
        return true;
      }
      // Con todas listas, cualquiera arranca; si no, solo cuenta el que tiene el turno
      if (action === 'use' && allReady()) return confirm(i), true;
      if (i !== turn() || st.waiting) return action === 'left' || action === 'right' || action === 'use' || !!pad;
      if (action === 'left' || action === 'right') {
        st.p[i] = (st.p[i] + (action === 'right' ? 1 : -1) + n) % n;
        audio.play('ui-move');
      } else if (action === 'use') confirm(i);
      else return !!pad; // otro botón del joystick: no hace nada (y no mueve el foco)
      update();
      return true;
    };
    update();
  }

  // ------------------------------------------------------------------ CONTROLES (teclado y joystick)

  showKeyboard() {
    const s = this.settings;
    const padName = (n) => (n == null ? 'NINGUNO' : `JOYSTICK ${n + 1}`);
    const column = (pi) => {
      const p = PLAYERS[pi];
      const pad = s.pads[pi];
      const connected = pad != null && pad < input.padCount;
      return `
        <div class="vm-panel" style="padding:26px 24px;display:flex;flex-direction:column;gap:6px">
          <div class="vm-panel-title" style="display:flex;align-items:center;gap:14px;font-size:32px">
            <span class="vm-avatar" style="--c:${p.color};width:44px;height:44px;font-size:21px;border-width:4px;flex:none">${pi + 1}</span>
            <input class="vm-input" style="min-width:0;flex:1;height:58px;font-size:26px;padding:0 14px" maxlength="${LOCAL.nameMax}"
              value="${esc(s.names[pi])}" placeholder="${esc(localPlayerName({ ...s, names: [] }, pi).name)}" data-player-name="${pi}" aria-label="Nombre del jugador ${pi + 1}">
          </div>
          ${ACTIONS.map((a) => {
            const code = s.controls[pi][a.id];
            const label = keyLabel(code);
            const listening = this.listening && this.listening.player === pi && this.listening.action === a.id;
            return `
              <div class="vm-row" style="min-height:68px;gap:10px">
                <span style="font-size:21px">${a.label}</span>
                <button class="vm-keycap ${label.length > 5 ? 'long' : ''} ${listening ? 'listening' : ''}" data-p="${pi}" data-a="${a.id}">${listening ? '¿TECLA?' : label}</button>
              </div>`;
          }).join('')}
          <div class="vm-row" style="min-height:68px;gap:10px">
            <span style="font-size:21px">Joystick<span class="hint" style="display:block;font-size:16px">${pad == null ? 'Solo teclado' : connected ? 'Conectado' : 'Sin conectar'}</span></span>
            <button class="vm-keycap long" style="min-width:150px" data-pad="${pi}">${padName(pad)}</button>
          </div>
        </div>`;
    };
    const general = [['Reiniciar', 'R'], ['Pausa / menú', 'ESC'], ['Silenciar', 'M'], ['Debug', 'V'], ['Calidad gráfica', 'G']];
    const padHelp = [['Girar', 'Stick / cruceta'], ['Acelerar', 'RT'], ['Frenar', 'LT o B'], ['Saltar', 'A'], ['Usar objeto', 'X (mantener = automático)'], ['Pausa', 'Start']];
    this.render(`
      <div class="vm-screen">
        ${this.header('JUGADORES Y CONTROLES')}
        <div style="flex:1;display:grid;grid-template-columns:repeat(${PLAYERS.length},minmax(0,1fr));gap:24px;align-items:start">
          ${PLAYERS.map((_, i) => column(i)).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-weight:800;font-size:20px">
          <div><span class="vm-muted">JOYSTICK ·</span> ${padHelp.map(([l, k]) => `${l}: <b>${k}</b>`).join(' · ')} <span class="vm-muted">· Joysticks conectados: ${input.padCount} (si no aparece, apretá un botón)</span></div>
          <div><span class="vm-muted">GENERAL ·</span> ${general.map(([l, k]) => `${l}: <b>${k}</b>`).join(' · ')}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:24px">${this.listening ? 'Pulsá la tecla nueva… (ESC cancela)' : 'Escribí el nombre de cada jugador. Hacé clic en una tecla para reasignarla (si ya está en uso, se intercambian) o en el joystick para cambiarlo.'}</div>
          <button class="vm-btn dark small" style="height:76px;font-size:30px" data-reset data-pad="Y">RESTABLECER</button>
        </div>
      </div>`, {
      back: () => this.showHome(),
      onMount: (el) => {
        // Nombres: se aplican al salir del campo, con Enter o al dejar la pantalla
        let namesDirty = false;
        el.querySelectorAll('[data-player-name]').forEach((field) => {
          const pi = Number(field.dataset.playerName);
          field.addEventListener('input', () => {
            s.names[pi] = field.value.replace(/\s+/g, ' ').trim();
            namesDirty = true;
          });
          field.addEventListener('change', () => {
            namesDirty = false;
            this.commitSettings();
          });
          field.addEventListener('keydown', (e) => {
            e.stopPropagation(); // las letras son del nombre, no atajos del juego
            if (e.code === 'Enter' || e.code === 'NumpadEnter') field.blur();
          });
        });
        el.querySelectorAll('.vm-keycap[data-p]').forEach((b) => b.addEventListener('click', () => {
          this.listening = { player: Number(b.dataset.p), action: b.dataset.a };
          this.showKeyboard();
        }));
        // Joystick: recorre Ninguno → 1 → 2 → 3 → 4; si otro jugador ya lo tenía, se intercambian
        el.querySelectorAll('[data-pad]').forEach((b) => b.addEventListener('click', () => {
          const pi = Number(b.dataset.pad);
          const cur = s.pads[pi];
          const next = cur == null ? 0 : cur + 1 >= MAX_PADS ? null : cur + 1;
          const other = s.pads.findIndex((n, j) => j !== pi && n === next && next != null);
          if (other >= 0) s.pads[other] = cur;
          s.pads[pi] = next;
          this.commitSettings();
          this.showKeyboard();
          this.layer.querySelector(`[data-pad="${pi}"]`).focus();
        }));
        el.querySelector('[data-reset]').addEventListener('click', () => {
          const d = defaultSettings();
          s.controls = d.controls;
          s.pads = d.pads;
          this.commitSettings();
          this.showKeyboard();
          this.toast('Controles restablecidos');
        });
        // Se actualiza el estado "Conectado" cuando se enchufa o desenchufa un joystick
        const refresh = () => this.layer.querySelector('[data-pad]') && !this.listening && this.showKeyboard();
        window.addEventListener('gamepadconnected', refresh);
        window.addEventListener('gamepaddisconnected', refresh);
        this.leaveScreen = () => {
          if (namesDirty) this.commitSettings();
          window.removeEventListener('gamepadconnected', refresh);
          window.removeEventListener('gamepaddisconnected', refresh);
        };
      },
    });
  }

  captureKey(code) {
    const { player, action } = this.listening;
    this.listening = null;
    if (code === 'Escape') return this.showKeyboard();
    if (RESERVED_KEYS.includes(code)) {
      this.showKeyboard();
      return this.toast(`${keyLabel(code)} está reservada para el juego`);
    }
    const controls = this.settings.controls;
    const previous = controls[player][action];
    // Si la tecla ya estaba en uso (por cualquier jugador), se intercambian
    for (const c of controls) for (const a of Object.keys(c)) if (c[a] === code) c[a] = previous;
    controls[player][action] = code;
    this.commitSettings();
    this.showKeyboard();
  }

  // ------------------------------------------------------------------ CONFIGURACIÓN

  showConfig(tab = 'video', draft = null) {
    draft ??= structuredClone({ video: this.settings.video, game: this.settings.game });
    const v = draft.video;
    const g = draft.game;
    const stepper = (key, options, value) => {
      const i = options.findIndex((o) => o[0] === value);
      return `
        <div class="vm-stepper">
          <button class="vm-btn" data-step="${key}" data-dir="-1">‹</button>
          <div class="value">${options[Math.max(0, i)][1]}</div>
          <button class="vm-btn" data-step="${key}" data-dir="1">›</button>
        </div>`;
    };
    const OPTIONS = {
      'video.quality': [['high', 'Alta'], ['low', 'Baja']],
      'video.shadows': [['high', 'Altas'], ['low', 'Bajas'], ['off', 'Desactivadas']],
      'video.renderScale': [[1, '100 %'], [0.75, '75 %'], [0.5, '50 %']],
      'game.camera': Object.entries(GAME_CONFIG.camera.views).map(([id, view]) => [id, view.label]),
    };
    const row = (label, control, hint = '') => `<div class="vm-row"><span>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</span>${control}</div>`;
    const toggle = (key, on) => `<button class="vm-toggle ${on ? 'on' : ''}" data-toggle="${key}"></button>`;
    const fullscreen = !!document.fullscreenElement;

    let content = '';
    if (tab === 'video') {
      content = [
        row('Calidad gráfica', stepper('video.quality', OPTIONS['video.quality'], v.quality), 'Alta: reflejos, bloom y efecto miniatura'),
        row('Sombras', stepper('video.shadows', OPTIONS['video.shadows'], v.shadows)),
        row('Resolución interna', stepper('video.renderScale', OPTIONS['video.renderScale'], v.renderScale), 'Bajarla mejora el rendimiento'),
        row('Efecto miniatura', toggle('video.miniature', v.miniature), 'Desenfoque tilt-shift en los bordes'),
        row('Pantalla completa', `<button class="vm-toggle ${fullscreen ? 'on' : ''}" data-fullscreen></button>`),
        row('Brillo', `<div class="vm-range"><input type="range" min="0" max="100" value="${v.brightness}" data-range="video.brightness"><div class="value">${v.brightness}</div></div>`),
      ].join('');
    } else if (tab === 'audio') {
      // Los volúmenes se aplican y guardan en el momento (no hace falta APLICAR)
      const a = this.settings.audio;
      const slider = (key, label, hint) =>
        row(label, `<div class="vm-range"><input type="range" min="0" max="100" value="${a[key]}" data-volume="${key}"><div class="value">${a[key]}</div></div>`, hint);
      content = [
        slider('master', 'Volumen general', 'También: tecla M para silenciar'),
        slider('music', 'Música', 'Synthwave en vivo: menú, carrera y podio'),
        slider('sfx', 'Efectos', 'Motores, choques, objetos y menús'),
      ].join('');
    } else {
      content = [
        row('Vista de cámara', stepper('game.camera', OPTIONS['game.camera'], g.camera), 'Perspectiva: más baja, se ve más camino y el lente se abre con la velocidad'),
        row('Panel de debug', toggle('game.debug', g.debug), 'También con la tecla V durante la carrera'),
      ].join('');
    }

    this.render(`
      <div class="vm-screen">
        ${this.header('CONFIGURACIÓN')}
        <div style="flex:1;display:grid;grid-template-columns:380px minmax(0,1fr);gap:40px;min-height:0">
          <div style="display:flex;flex-direction:column;gap:18px">
            ${[['video', 'Vídeo'], ['audio', 'Audio'], ['game', 'Juego']].map(([id, l]) => `
              <button class="vm-btn ${tab === id ? 'yellow' : 'dark'}" style="height:96px" data-tab="${id}">${l}</button>`).join('')}
          </div>
          <div class="vm-panel" style="padding:24px 44px;display:flex;flex-direction:column">
            ${content}
            <div style="display:flex;justify-content:flex-end;gap:24px;margin-top:auto;padding-top:24px">
              <button class="vm-btn dark small" style="height:76px;font-size:30px" data-defaults data-pad="Y">RESTABLECER</button>
              <button class="vm-btn yellow small" style="height:76px;font-size:30px" data-apply data-pad="X">APLICAR</button>
            </div>
          </div>
        </div>
      </div>`, {
      back: () => this.showHome(),
      onMount: (el) => {
        const set = (path, value) => {
          const [a, b] = path.split('.');
          draft[a][b] = value;
        };
        const get = (path) => path.split('.').reduce((o, k) => o[k], draft);
        el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => this.showConfig(b.dataset.tab, draft)));
        el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
          const opts = OPTIONS[b.dataset.step];
          const i = opts.findIndex((o) => o[0] === get(b.dataset.step));
          set(b.dataset.step, opts[(i + Number(b.dataset.dir) + opts.length) % opts.length][0]);
          this.showConfig(tab, draft);
        }));
        el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
          set(b.dataset.toggle, !get(b.dataset.toggle));
          b.classList.toggle('on');
        }));
        el.querySelectorAll('[data-volume]').forEach((r) => {
          r.addEventListener('input', () => {
            this.settings.audio[r.dataset.volume] = Number(r.value);
            r.nextElementSibling.textContent = r.value;
            audio.setVolumes(this.settings.audio);
            audio.play(r.dataset.volume === 'music' ? 'ui-move' : 'pickup', { minGap: 0.12 });
          });
          r.addEventListener('change', () => saveSettings(this.settings));
        });
        el.querySelectorAll('[data-range]').forEach((r) => r.addEventListener('input', () => {
          set(r.dataset.range, Number(r.value));
          r.nextElementSibling.textContent = r.value;
        }));
        el.querySelector('[data-fullscreen]')?.addEventListener('click', async (e) => {
          try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
          } catch {
            this.toast('El navegador no permitió la pantalla completa');
          }
          e.target.classList.toggle('on', !!document.fullscreenElement);
        });
        el.querySelector('[data-defaults]').addEventListener('click', () => {
          const d = defaultSettings();
          this.showConfig(tab, { video: d.video, game: d.game });
          this.toast('Valores por defecto (falta APLICAR)');
        });
        el.querySelector('[data-apply]').addEventListener('click', () => {
          this.settings.video = draft.video;
          this.settings.game = draft.game;
          this.commitSettings();
          this.toast('Ajustes aplicados');
        });
      },
    });
  }

  commitSettings() {
    saveSettings(this.settings);
    this.cb.onApplySettings(this.settings);
  }

  // ------------------------------------------------------------------ SALIR

  showExit() {
    this.showHome();
    const m = this.openModal(`
      <div class="vm-dialog">
        <div class="band"></div>
        <div class="body">
          <div class="title">¿Salir de Vita Machines?</div>
          <div class="text" data-text>Se cerrará el juego. Tus ajustes ya están guardados.</div>
          <div class="actions">
            <button class="vm-btn center" data-cancel>CANCELAR</button>
            <button class="vm-btn red stroked center" data-quit data-pad="X">SALIR</button>
          </div>
        </div>
      </div>`, { onCancel: () => this.closeModal() });
    m.querySelector('[data-cancel]').addEventListener('click', () => this.closeModal());
    m.querySelector('[data-quit]').addEventListener('click', () => {
      window.close();
      // Los navegadores solo dejan cerrar pestañas abiertas por un script
      setTimeout(() => {
        m.querySelector('[data-text]').textContent = 'El navegador no deja cerrar la pestaña desde el juego: podés cerrarla vos.';
      }, 150);
    });
    m.querySelector('[data-cancel]').focus();
  }

  // ------------------------------------------------------------------ PAUSA (durante la carrera)

  showPause() {
    this.root.classList.remove('hidden');
    this.layer.innerHTML = '';
    this.stage.querySelector('.vm-bg').style.display = 'none';
    this.back = null;
    const resume = () => {
      this.stage.querySelector('.vm-bg').style.display = '';
      this.hide();
      this.cb.onResume();
    };
    const m = this.openModal(`
      <div class="vm-dialog">
        <div class="band"></div>
        <div class="body">
          <div class="title">Pausa</div>
          <div class="text">La carrera está detenida.</div>
          <div class="actions three">
            <button class="vm-btn yellow center" data-resume data-pad="Start" data-default>CONTINUAR</button>
            <button class="vm-btn center" data-restart data-pad="Y">REINICIAR PARTIDA</button>
            <button class="vm-btn red stroked center" data-menu data-pad="X">MENÚ PRINCIPAL</button>
          </div>
        </div>
      </div>`, { onCancel: resume });
    this.root.style.background = 'transparent';
    this.stage.style.background = 'transparent';
    m.querySelector('[data-resume]').addEventListener('click', resume);
    m.querySelector('[data-restart]').addEventListener('click', () => {
      this.stage.querySelector('.vm-bg').style.display = '';
      this.hide();
      this.cb.onRestart();
    });
    m.querySelector('[data-menu]').addEventListener('click', () => {
      this.stage.querySelector('.vm-bg').style.display = '';
      this.cb.onQuitToMenu();
    });
    m.querySelector('[data-resume]').focus();
  }

  /** Vuelve a usar el fondo opaco (después de una pausa). */
  opaque() {
    this.root.style.background = '';
    this.stage.style.background = '';
    this.stage.querySelector('.vm-bg').style.display = '';
  }
}

// Pantallas del online (nombre, lista de lobbies, lobby, pilotos online), ver OnlineScreens.js
Object.assign(Menu.prototype, OnlineScreens);
