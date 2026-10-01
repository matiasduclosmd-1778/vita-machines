import './menu.css';
import { GAME_CONFIG, POWERUP_CONFIG } from '../config.js';
import { ACTIONS, RESERVED_KEYS, defaultSettings, keyLabel, saveSettings } from './Settings.js';
import { OnlineScreens } from './OnlineScreens.js';

const PLAYERS = GAME_CONFIG.players;
const VERSION = 'v0.2.0 · Local y online · hasta 6 jugadores';

const TIPS = [
  'Llegá rápido a la rampa rayada: si vas lento, no alcanzás la plataforma.',
  'La regla del atajo no tiene barandas: es más corta, pero si caés perdés tiempo.',
  'Si quedás 3 segundos fuera de pantalla, quedás eliminado.',
  'El escudo te protege de la bomba, el misil, el aceite y el imán.',
  'El misil 🎯 persigue al rival por la pista: lanzalo cuando lo tengas adelante.',
  'En el borde del escritorio no hay baranda: frená antes de la curva.',
  'El turbo sirve para recuperar terreno cuando la cámara te está dejando atrás.',
  'Online: creá un lobby y pasales el código de 6 letras a tus amigos (hasta 6 jugadores).',
];

const MODES = [
  { id: 'race', title: 'Carrera', desc: 'Llegá primero y dejá al rival fuera de pantalla.', ready: true },
  { id: 'crash', title: 'Choque total', desc: 'Derribá máquinas rivales en la arena.', ready: false },
  { id: 'core', title: 'Núcleo', desc: 'Capturá y defendé el núcleo del barrio.', ready: false },
];

const DIFFICULTIES = GAME_CONFIG.ai.difficulties;
const rivalText = (r) => (r.opponent === 'cpu' ? `CPU · ${DIFFICULTIES[r.difficulty].label}` : 'Local (2 jugadores)');
const LAP_OPTIONS = GAME_CONFIG.race.lapOptions;
const POWERUP_AMOUNTS = { off: 'No', ...Object.fromEntries(Object.entries(POWERUP_CONFIG.itemBoxes.amounts).map(([id, a]) => [id, a.label])) };
const powerupsText = (r) => (r.powerups === 'off' ? 'Sin objetos' : POWERUP_AMOUNTS[r.powerups]);
const DRIVERS = GAME_CONFIG.drivers;
// Retratos y autos de los pilotos (Vite los optimiza y devuelve sus URLs)
const PILOT_IMAGES = import.meta.glob('../assets/pilots/*.webp', { query: '?url', import: 'default', eager: true });
const pilotImage = (file) => PILOT_IMAGES[`../assets/pilots/${file}`];
const STAT_LABELS = { vel: 'Velocidad', acel: 'Aceleración', man: 'Manejo', res: 'Resistencia' };

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Tarjetas de "Elegí tu piloto" (también las usa la versión online). p2Tag: texto de la etiqueta del segundo jugador. */
export function pilotCardsHTML(p2Tag = 'J2') {
  const bar = (v) => `<div class="vm-pk-bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div>`;
  return DRIVERS.map((d, i) => `
            <article class="vm-pk-card" role="option" data-i="${i}" style="--c1:${d.c1};--c2:${d.c2};--paint:${d.paint};--w:${d.w};--t:${d.t};--l:${d.l}">
              <div class="vm-pk-portrait">
                <div class="vm-pk-tags"><span class="vm-pk-tag p1">J1</span><span class="vm-pk-tag p2">${p2Tag}</span></div>
                <span class="vm-pk-ready">LISTO</span>
                <img class="vm-pk-who" src="${pilotImage(d.portrait)}" alt="${esc(d.name)}">
                <img class="vm-pk-car" src="${pilotImage(d.carImage)}" alt="${esc(d.carLabel)} ${esc(d.paintName.toLowerCase())}">
              </div>
              <div class="vm-pk-body">
                <h2 class="vm-pk-name">${esc(d.name)}</h2>
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
    this.race = { name: 'Carrera en el escritorio', mode: 'race', map: 'desk', powerups: 'normal', laps: GAME_CONFIG.race.laps, opponent: 'cpu', difficulty: 'normal' };
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

  render(html, { back = null, onMount } = {}) {
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
  }

  onKey(e) {
    if (!this.visible) return;
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
      if (this.modal) this.modalCancel?.();
      else this.back?.();
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
        <button class="vm-btn dark vm-back" data-back>‹ ${backLabel} <span class="vm-kbd">ESC</span></button>
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
            <button class="vm-btn yellow hero" data-go="create"><span>CREAR PARTIDA</span><span>›</span></button>
            <button class="vm-btn" data-go="online"><span>JUGAR ONLINE</span><span>›</span></button>
            <button class="vm-btn" data-go="keys"><span>TECLADO</span><span>›</span></button>
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
      { id: 'desk', name: 'El Escritorio', style: mapThumb, ready: true },
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
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px">
                ${maps.map((m) => `
                  <button class="vm-map ${r.map === m.id ? 'selected' : ''}" ${m.ready ? '' : 'disabled'}>
                    ${m.ready ? '' : '<span class="vm-soon">PRÓXIMAMENTE</span>'}
                    <div class="thumb" style="${m.style}"></div>
                    <div class="name">${m.name}</div>
                  </button>`).join('')}
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:28px">
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">RIVAL</div>
                <div class="vm-seg" data-opponent>
                  <button class="${r.opponent === 'cpu' ? 'on' : ''}" data-v="cpu">VS CPU</button>
                  <button class="${r.opponent === 'local' ? 'on' : ''}" data-v="local">VS Local</button>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px;${r.opponent === 'cpu' ? '' : 'opacity:.35;pointer-events:none'}" data-diff-box>
                <div class="vm-label">DIFICULTAD</div>
                <div class="vm-seg" style="grid-template-columns:repeat(3,1fr)" data-difficulty>
                  ${Object.entries(DIFFICULTIES).map(([id, d]) => `<button class="${r.difficulty === id ? 'on' : ''}" data-v="${id}">${d.label}</button>`).join('')}
                </div>
              </div>
            </div>
          </div>
          <div class="vm-panel" style="padding:30px;display:flex;flex-direction:column;gap:20px">
            <div style="display:flex;flex-direction:column;gap:20px">
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">VUELTAS</div>
                <div class="vm-seg" style="grid-template-columns:repeat(${LAP_OPTIONS.length},1fr)" data-laps>
                  ${LAP_OPTIONS.map((n) => `<button class="${r.laps === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}
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
              ${[['Modo', 'Carrera', ''], ['Mapa', 'El Escritorio', ''], ['Rival', rivalText(r), 'data-summary-rival'], ['Vueltas', r.laps, 'data-summary-laps'], ['Power-ups', powerupsText(r), 'data-summary-pu']].map(([k, v, attr]) => `
                <div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:2px solid var(--vm-line)">
                  <span class="vm-muted">${k}</span><span ${attr}>${v}</span>
                </div>`).join('')}
            </div>
            <button class="vm-btn yellow hero center" style="margin-top:auto" data-start>¡A CORRER!</button>
          </div>
        </div>
      </div>`, {
      back: () => this.showHome(),
      onMount: (el) => {
        const name = el.querySelector('[data-name]');
        name.addEventListener('input', () => {
          r.name = name.value.trim() || 'Carrera en el escritorio';
          el.querySelector('[data-summary-name]').textContent = r.name;
        });
        el.querySelectorAll('[data-powerups] button').forEach((b) => b.addEventListener('click', () => {
          r.powerups = b.dataset.v;
          el.querySelectorAll('[data-powerups] button').forEach((x) => x.classList.toggle('on', x === b));
          el.querySelector('[data-summary-pu]').textContent = powerupsText(r);
        }));
        el.querySelectorAll('[data-laps] button').forEach((b) => b.addEventListener('click', () => {
          r.laps = +b.dataset.v;
          el.querySelectorAll('[data-laps] button').forEach((x) => x.classList.toggle('on', x === b));
          el.querySelector('[data-summary-laps]').textContent = r.laps;
        }));
        const seg = (sel, apply) => el.querySelectorAll(`${sel} button`).forEach((b) => b.addEventListener('click', () => {
          apply(b.dataset.v);
          el.querySelectorAll(`${sel} button`).forEach((x) => x.classList.toggle('on', x === b));
          el.querySelector('[data-summary-rival]').textContent = rivalText(r);
        }));
        seg('[data-opponent]', (v) => {
          r.opponent = v;
          const box = el.querySelector('[data-diff-box]');
          box.style.opacity = v === 'cpu' ? '' : '.35';
          box.style.pointerEvents = v === 'cpu' ? '' : 'none';
        });
        seg('[data-difficulty]', (v) => (r.difficulty = v));
        el.querySelector('[data-start]').addEventListener('click', () => this.showPilots());
      },
    });
  }

  // ------------------------------------------------------------------ ELEGÍ TU PILOTO

  /**
   * Cada jugador elige piloto con sus teclas de girar y confirma con la de usar objeto.
   * Contra la CPU, la computadora elige un piloto al azar (distinto) cuando el jugador 1 confirma.
   * Con los dos listos, el jugador 1 arranca la carrera.
   */
  showPilots() {
    const r = this.race;
    const cpu = r.opponent === 'cpu';
    const n = DRIVERS.length;
    const index = (id) => Math.max(0, DRIVERS.findIndex((d) => d.id === id));
    const st = { p: [index(this.settings.drivers[0]), index(this.settings.drivers[1])], ready: [false, false], go: false };
    if (cpu) st.p[1] = -1; // todavía no eligió
    const controls = this.settings.controls;
    const keys = (i) => `<kbd>${keyLabel(controls[i].left)}</kbd><kbd>${keyLabel(controls[i].right)}</kbd> elegir <kbd>${keyLabel(controls[i].use)}</kbd> confirmar`;

    this.render(`
      <div class="vm-screen vm-pk">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px">
          ${this.header('ELEGÍ TU PILOTO')}
          <div class="vm-pk-players">
            <div class="vm-pk-dots"><span class="vm-pk-dot p1">1</span><span class="vm-pk-dot p2">${cpu ? '🤖' : '2'}</span></div>
            <div><b>${esc(PLAYERS[0].name)} · ${cpu ? 'CPU' : esc(PLAYERS[1].humanName ?? PLAYERS[1].name)}</b><small>${cpu ? `VS CPU · ${DIFFICULTIES[r.difficulty].label.toUpperCase()}` : 'VS LOCAL'}</small></div>
          </div>
        </div>
        <section class="vm-pk-grid" role="listbox" aria-label="Pilotos">
          ${pilotCardsHTML(cpu ? 'CPU' : 'J2')}
        </section>
        <div class="vm-pk-foot">
          <div class="vm-pk-keys">
            <span><i class="vm-pk-pill" style="background:var(--pk-p1)"></i>J1 ${keys(0)}</span>
            ${cpu ? '' : `<span><i class="vm-pk-pill" style="background:var(--pk-p2)"></i>J2 ${keys(1)}</span>`}
          </div>
          <div style="display:flex;align-items:center;gap:22px">
            <span class="vm-pk-status" data-status aria-live="polite"></span>
            <button class="vm-btn yellow vm-pk-cta" data-cta><span data-cta-text></span><span>›</span></button>
          </div>
        </div>
      </div>`, {
      back: () => {
        // Primero se deshace la confirmación; sin nada confirmado, vuelve a Crear partida
        if (st.go) return;
        if (st.ready[0]) {
          st.ready[0] = false;
          if (cpu) {
            st.ready[1] = false;
            st.p[1] = -1;
          }
        } else if (st.ready[1]) st.ready[1] = false;
        else return this.showCreate();
        update();
      },
      onMount: (el) => {
        el.querySelectorAll('.vm-pk-card').forEach((c) => c.addEventListener('click', () => {
          if (st.ready[0] || st.go) return;
          st.p[0] = +c.dataset.i;
          update();
        }));
        el.querySelector('[data-cta]').addEventListener('click', () => confirm1());
      },
    });

    const el = this.layer;
    const cards = [...el.querySelectorAll('.vm-pk-card')];
    const name = (i) => DRIVERS[st.p[i]].name;
    function update() {
      cards.forEach((c, i) => {
        c.classList.toggle('sel', i === st.p[0]);
        c.classList.toggle('sel-p2', i === st.p[1]);
        c.classList.toggle('ready-on', (st.ready[0] && i === st.p[0]) || (st.ready[1] && i === st.p[1]));
        c.setAttribute('aria-selected', i === st.p[0]);
      });
      const text = el.querySelector('[data-cta-text]');
      const status = el.querySelector('[data-status]');
      const both = st.ready[0] && st.ready[1];
      if (st.go) text.textContent = 'Cargando pista…';
      else if (both) text.textContent = 'Arrancar carrera';
      else if (st.ready[0]) text.textContent = 'Esperando a J2';
      else text.textContent = 'Confirmar J1';
      if (both || st.go) status.textContent = `${name(0)} vs ${name(1)}`;
      else if (st.ready[0]) status.textContent = `J2 confirma con ${keyLabel(controls[1].use)}`;
      else if (cpu) status.textContent = 'La CPU elige cuando confirmes';
      else status.textContent = st.ready[1] ? 'J2 está listo' : 'Faltan confirmar los 2 jugadores';
      el.querySelector('[data-cta]').disabled = st.go || (st.ready[0] && !st.ready[1]);
    }
    const confirm1 = () => {
      if (st.go) return;
      if (!st.ready[0]) {
        st.ready[0] = true;
        if (cpu) {
          const others = DRIVERS.map((_, i) => i).filter((i) => i !== st.p[0]);
          st.p[1] = others[Math.floor(Math.random() * others.length)];
          st.ready[1] = true;
        }
      } else if (st.ready[1]) {
        st.go = true;
        const drivers = st.p.map((i) => DRIVERS[i].id);
        this.settings.drivers = cpu ? [drivers[0], this.settings.drivers[1]] : drivers;
        saveSettings(this.settings);
        update();
        this.cb.onStartRace({ ...r, drivers });
        return;
      }
      update();
    };
    this.screenKey = (code) => {
      if (st.go) return false;
      const move = (i, dir) => {
        if (st.ready[i] || (i === 1 && cpu)) return;
        st.p[i] = (st.p[i] + dir + n) % n;
      };
      if (code === controls[0].left) move(0, -1);
      else if (code === controls[0].right) move(0, 1);
      else if (code === controls[0].use) return confirm1(), true;
      else if (!cpu && code === controls[1].left) move(1, -1);
      else if (!cpu && code === controls[1].right) move(1, 1);
      else if (!cpu && code === controls[1].use) st.ready[1] = !st.ready[1];
      else if (code === 'Backspace') return this.back(), true;
      else return false;
      update();
      return true;
    };
    update();
  }

  // ------------------------------------------------------------------ TECLADO

  showKeyboard() {
    const s = this.settings;
    const column = (pi) => {
      const p = PLAYERS[pi];
      return `
        <div class="vm-panel" style="padding:32px 34px;display:flex;flex-direction:column;gap:10px">
          <div class="vm-panel-title" style="display:flex;align-items:center;gap:14px">
            <span class="vm-avatar" style="--c:${p.color};width:48px;height:48px;font-size:22px;border-width:4px">${pi + 1}</span>${esc(p.humanName ?? p.name)}
          </div>
          ${ACTIONS.map((a) => {
            const code = s.controls[pi][a.id];
            const label = keyLabel(code);
            const listening = this.listening && this.listening.player === pi && this.listening.action === a.id;
            return `
              <div class="vm-row" style="min-height:76px">
                <span style="font-size:25px">${a.label}</span>
                <button class="vm-keycap ${label.length > 5 ? 'long' : ''} ${listening ? 'listening' : ''}" data-p="${pi}" data-a="${a.id}">${listening ? '¿TECLA?' : label}</button>
              </div>`;
          }).join('')}
        </div>`;
    };
    const general = [['Reiniciar carrera', 'R'], ['Pausa / menú', 'ESC'], ['Modo debug', 'V'], ['Calidad gráfica', 'G']];
    this.render(`
      <div class="vm-screen">
        ${this.header('TECLADO')}
        <div style="flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:36px;align-items:start">
          ${column(0)}
          ${column(1)}
          <div class="vm-panel" style="padding:32px 34px;display:flex;flex-direction:column;gap:10px">
            <div class="vm-panel-title">General</div>
            ${general.map(([l, k]) => `
              <div class="vm-row" style="min-height:76px">
                <span style="font-size:25px">${l}</span><button class="vm-keycap" disabled>${k}</button>
              </div>`).join('')}
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:24px">${this.listening ? 'Pulsá la tecla nueva… (ESC cancela)' : 'Hacé clic en una tecla para reasignarla. Si ya está en uso, se intercambian.'}</div>
          <button class="vm-btn dark small" style="height:76px;font-size:30px" data-reset>RESTABLECER</button>
        </div>
      </div>`, {
      back: () => this.showHome(),
      onMount: (el) => {
        el.querySelectorAll('.vm-keycap[data-p]').forEach((b) => b.addEventListener('click', () => {
          this.listening = { player: Number(b.dataset.p), action: b.dataset.a };
          this.showKeyboard();
        }));
        el.querySelector('[data-reset]').addEventListener('click', () => {
          s.controls = defaultSettings().controls;
          this.commitSettings();
          this.showKeyboard();
          this.toast('Teclas restablecidas');
        });
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
    // Si la tecla ya estaba en uso (por cualquiera de los dos), se intercambian
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
      'game.outCountdown': [[2, '2 segundos'], [3, '3 segundos'], [4, '4 segundos'], [5, '5 segundos']],
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
      content = `
        <div style="padding:30px 0;display:flex;flex-direction:column;gap:18px">
          <div class="vm-display" style="--stroke:0px;--drop:0px;font-size:44px">Sin sonido por ahora <span class="vm-soon">PRÓXIMAMENTE</span></div>
          <div class="vm-muted" style="font-weight:800;font-size:24px">El juego todavía no tiene música ni efectos. Estos ajustes se activan cuando llegue el audio.</div>
        </div>
        ${['Volumen general', 'Música', 'Efectos'].map((l) => row(l, '<div class="vm-range"><input type="range" disabled value="80"><div class="value">80</div></div>')).join('')}`;
    } else {
      content = [
        row('Tiempo fuera de pantalla', stepper('game.outCountdown', OPTIONS['game.outCountdown'], g.outCountdown), 'Cuánto aguanta un piloto fuera de la zona segura'),
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
              <button class="vm-btn dark small" style="height:76px;font-size:30px" data-defaults>RESTABLECER</button>
              <button class="vm-btn yellow small" style="height:76px;font-size:30px" data-apply>APLICAR</button>
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
            <button class="vm-btn red stroked center" data-quit>SALIR</button>
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
            <button class="vm-btn yellow center" data-resume>CONTINUAR</button>
            <button class="vm-btn center" data-restart>REINICIAR CARRERA</button>
            <button class="vm-btn red stroked center" data-menu>MENÚ PRINCIPAL</button>
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
