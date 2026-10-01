import { GAME_CONFIG, POWERUP_CONFIG } from '../config.js';
import { saveSettings, keyLabel } from './Settings.js';
import { esc, pilotCardsHTML } from './Menu.js';
import { transportKind } from '../net/transport.js';

// Pantallas del online. Se suman a Menu (Object.assign en Menu.js); `this` es el menú.
// La sesión y la carrera las maneja OnlineController (this.online).

const NET = GAME_CONFIG.online;
const DRIVERS = GAME_CONFIG.drivers;
const LAP_OPTIONS = GAME_CONFIG.race.lapOptions;
const POWERUP_AMOUNTS = { off: 'No', ...Object.fromEntries(Object.entries(POWERUP_CONFIG.itemBoxes.amounts).map(([id, a]) => [id, a.label])) };
const slotColor = (slot) => NET.slots[slot]?.color ?? '#9aa0ad';
const powerupsText = (id) => (id === 'off' ? 'Sin objetos' : POWERUP_AMOUNTS[id]);

export const OnlineScreens = {
  // ------------------------------------------------------------------ NOMBRE

  /** Nombre del piloto. Si es obligatorio (primera vez), no se puede salir sin ponerlo. */
  showName({ required = false } = {}) {
    const current = this.settings.profile.name;
    this.render(`
      <div class="vm-screen" style="align-items:center;justify-content:center">
        <div class="vm-panel" style="width:900px;padding:56px;display:flex;flex-direction:column;gap:26px">
          <div class="vm-display" style="font-size:76px">${required ? '¡BIENVENIDO!' : 'TU NOMBRE'}</div>
          <div class="vm-muted" style="font-weight:800;font-size:24px;line-height:1.35">
            ${required ? 'Antes de correr, elegí tu nombre de piloto. ' : ''}Es el que ven los demás en el lobby y en la carrera.
          </div>
          <input class="vm-input" maxlength="${NET.nameMax}" placeholder="Tu nombre" value="${esc(current)}" data-name
            style="height:104px;font-family:'Lilita One';font-size:52px;padding:0 30px">
          <div class="vm-muted" data-error style="font-weight:800;font-size:20px;min-height:1.2em;color:var(--vm-orange)"></div>
          <div style="display:grid;grid-template-columns:${required ? '1fr' : '1fr 1fr'};gap:20px">
            ${required ? '' : '<button class="vm-btn dark center" data-cancel>CANCELAR</button>'}
            <button class="vm-btn yellow hero center" data-ok>${required ? 'ENTRAR' : 'GUARDAR'}</button>
          </div>
        </div>
      </div>`, {
      back: required ? null : () => this.showHome(),
      onMount: (el) => {
        const input = el.querySelector('[data-name]');
        const save = () => {
          const name = input.value.replace(/\s+/g, ' ').trim();
          if (name.length < NET.nameMin) {
            el.querySelector('[data-error]').textContent = `Tiene que tener al menos ${NET.nameMin} letras.`;
            input.focus();
            return;
          }
          this.settings.profile.name = name;
          saveSettings(this.settings);
          this.showHome();
        };
        el.querySelector('[data-ok]').addEventListener('click', save);
        el.querySelector('[data-cancel]')?.addEventListener('click', () => this.showHome());
        input.addEventListener('keydown', (e) => {
          if (e.code === 'Enter' || e.code === 'NumpadEnter') save();
        });
        input.focus();
        input.select();
      },
    });
  },

  // ------------------------------------------------------------------ JUGAR ONLINE

  showOnline() {
    const local = transportKind === 'local';
    this.render(`
      <div class="vm-screen">
        ${this.header('JUGAR ONLINE')}
        <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) 560px;gap:40px;min-height:0;align-items:start">
          <div class="vm-panel" style="display:flex;flex-direction:column;gap:14px;max-height:100%;overflow:auto">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div class="vm-panel-title" style="margin:0">Lobbies públicos ${local ? '<span class="vm-soon">MODO PRUEBA</span>' : ''}</div>
              <button class="vm-btn dark small" data-refresh>↻ ACTUALIZAR</button>
            </div>
            <div class="vm-table-head vm-label vm-net-row" style="font-size:17px">
              <span>LOBBY</span><span>VUELTAS</span><span>POWER-UPS</span><span>JUGADORES</span><span></span>
            </div>
            <div data-list><div class="vm-muted vm-net-empty">Buscando lobbies…</div></div>
            ${local ? '<div class="vm-muted" style="font-weight:800;font-size:18px">Sin Supabase configurado: solo se ven los lobbies de otras pestañas de este navegador.</div>' : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:30px">
            <div class="vm-panel" style="display:flex;flex-direction:column;gap:22px">
              <div class="vm-panel-title" style="margin:0">Crear un lobby</div>
              <div class="vm-muted" style="font-weight:700;font-size:22px">Armá tu partida (hasta ${NET.maxPlayers} jugadores) y pasales el código.</div>
              <button class="vm-btn yellow hero center" data-create>CREAR LOBBY</button>
            </div>
            <div class="vm-panel" style="display:flex;flex-direction:column;gap:22px">
              <div class="vm-panel-title" style="margin:0">Unirse con código</div>
              <input class="vm-input" maxlength="6" placeholder="ABC123" data-code style="height:100px;text-align:center;font-family:'Lilita One';font-size:60px;letter-spacing:18px;text-transform:uppercase">
              <button class="vm-btn hero center" data-code-join>UNIRSE</button>
            </div>
          </div>
        </div>
      </div>`, {
      back: () => this.showHome(),
      onMount: (el) => {
        const list = el.querySelector('[data-list]');
        const draw = (lobbies) => {
          if (!lobbies.length) {
            list.innerHTML = '<div class="vm-muted vm-net-empty">No hay lobbies públicos abiertos. ¡Creá uno!</div>';
            return;
          }
          list.innerHTML = lobbies.map((l) => {
            const full = l.players >= l.max;
            const playing = l.phase !== 'lobby';
            const label = playing ? 'EN CURSO' : full ? 'LLENO' : 'UNIRSE';
            return `
              <div class="vm-lobby-row vm-net-row">
                <div>${esc(l.name)}<span class="host">Anfitrión: ${esc(l.host)}</span></div>
                <div>${l.laps}</div><div>${powerupsText(l.powerups)}</div>
                <div style="${full ? 'color:var(--vm-orange)' : ''}">${l.players} / ${l.max}</div>
                <button class="vm-btn ${full || playing ? 'dark' : 'yellow'} small center" ${full || playing ? 'disabled' : ''} data-join="${l.code}">${label}</button>
              </div>`;
          }).join('');
          list.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => this.joinLobby(b.dataset.join)));
        };
        let browser = null;
        this.online.browse(draw).then(
          (b) => {
            if (this.leaveScreen === stop) browser = b;
            else b.close(); // ya se cambió de pantalla
          },
          () => (list.innerHTML = '<div class="vm-muted vm-net-empty">No se pudo conectar al servidor. Revisá tu conexión.</div>'),
        );
        const stop = () => browser?.close();
        this.leaveScreen = stop;
        el.querySelector('[data-refresh]').addEventListener('click', () => browser?.refresh());
        el.querySelector('[data-create]').addEventListener('click', () => this.showCreateLobby());
        const code = el.querySelector('[data-code]');
        const joinCode = () => {
          const c = code.value.trim().toUpperCase();
          if (c.length !== 6) return this.toast('El código tiene 6 caracteres');
          this.joinLobby(c);
        };
        el.querySelector('[data-code-join]').addEventListener('click', joinCode);
        code.addEventListener('keydown', (e) => e.code === 'Enter' && joinCode());
      },
    });
  },

  async joinLobby(code) {
    this.showLoading(`ENTRANDO A ${code}…`);
    this.setProgress(0.5);
    try {
      await this.online.join(code);
    } catch (e) {
      this.showOnline();
      this.toast(e.message || 'No se pudo entrar al lobby');
    }
  },

  // ------------------------------------------------------------------ CREAR LOBBY

  showCreateLobby() {
    const name = this.settings.profile.name;
    const o = (this.lobbyOptions ??= { name: `Lobby de ${name}`, isPublic: true, laps: GAME_CONFIG.race.laps, powerups: 'normal' });
    const seg = (key, options) => Object.entries(options).map(([v, label]) => `<button class="${String(o[key]) === v ? 'on' : ''}" data-v="${v}">${label}</button>`).join('');
    this.render(`
      <div class="vm-screen">
        ${this.header('CREAR LOBBY')}
        <div style="flex:1;display:flex;justify-content:center;align-items:flex-start">
          <div class="vm-panel" style="width:1100px;padding:44px;display:flex;flex-direction:column;gap:32px">
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="vm-label">NOMBRE DEL LOBBY</div>
              <input class="vm-input" maxlength="28" value="${esc(o.name)}" data-lobby-name>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">VISIBILIDAD</div>
                <div class="vm-seg" data-key="isPublic">${seg('isPublic', { true: 'Público', false: 'Privado' })}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px">
                <div class="vm-label">VUELTAS</div>
                <div class="vm-seg" style="grid-template-columns:repeat(${LAP_OPTIONS.length},1fr)" data-key="laps">${seg('laps', Object.fromEntries(LAP_OPTIONS.map((n) => [n, n])))}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="vm-label">POWER-UPS</div>
              <div class="vm-seg" style="grid-template-columns:repeat(4,1fr)" data-key="powerups">${seg('powerups', POWERUP_AMOUNTS)}</div>
            </div>
            <div class="vm-muted" style="font-weight:800;font-size:20px">Público: aparece en la lista de lobbies. Privado: solo se entra con el código.</div>
            <button class="vm-btn yellow hero center" data-create>CREAR LOBBY</button>
          </div>
        </div>
      </div>`, {
      back: () => this.showOnline(),
      onMount: (el) => {
        const nameInput = el.querySelector('[data-lobby-name]');
        nameInput.addEventListener('input', () => (o.name = nameInput.value.trim() || `Lobby de ${name}`));
        el.querySelectorAll('.vm-seg[data-key]').forEach((group) => group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          const key = group.dataset.key;
          o[key] = key === 'isPublic' ? b.dataset.v === 'true' : key === 'laps' ? +b.dataset.v : b.dataset.v;
          group.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        })));
        el.querySelector('[data-create]').addEventListener('click', async () => {
          this.showLoading('CREANDO LOBBY…');
          this.setProgress(0.5);
          try {
            await this.online.create({ ...o });
          } catch (e) {
            this.showCreateLobby();
            this.toast(e.message || 'No se pudo crear el lobby');
          }
        });
      },
    });
  },

  // ------------------------------------------------------------------ LOBBY

  showLobby() {
    const online = this.online;
    const s = online.session;
    const st = s.state;
    this.render(`
      <div class="vm-screen">
        <div class="vm-header">
          <button class="vm-btn dark vm-back" data-back>‹ ${s.isHost ? 'CERRAR LOBBY' : 'SALIR DEL LOBBY'}</button>
          <div style="min-width:0">
            <div class="vm-display" style="font-size:62px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-lobby-title>${esc(st.name)}</div>
            <div class="vm-muted" style="font-weight:800;font-size:22px">Carrera · El Escritorio · ${st.public ? 'Público' : 'Privado'}</div>
          </div>
          <div class="vm-stripe"></div>
          <div class="vm-btn small" style="height:76px;gap:20px;cursor:default">
            <span class="vm-label" style="color:var(--vm-ink);font-size:17px">CÓDIGO</span>
            <span style="font-size:38px;letter-spacing:8px">${esc(st.code)}</span>
          </div>
        </div>
        <div style="flex:1;display:grid;grid-template-columns:minmax(0,1fr) 560px;gap:40px;min-height:0">
          <div style="display:flex;flex-direction:column;gap:30px;min-height:0">
            <div class="vm-panel" style="padding:30px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
                <div class="vm-panel-title" style="margin:0">Pilotos</div>
                <div class="vm-display" style="--stroke:0px;--drop:0px;font-size:30px;color:var(--vm-yellow)" data-count></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" data-players></div>
            </div>
            <div class="vm-panel" style="flex:1;min-height:0;padding:30px;display:flex;flex-direction:column;gap:16px">
              <div class="vm-net-chat" data-chat></div>
              <input class="vm-input" maxlength="120" placeholder="Escribí un mensaje y pulsá Enter" data-chat-input>
            </div>
          </div>
          <div class="vm-panel" style="padding:30px;display:flex;flex-direction:column;gap:22px">
            <div class="vm-panel-title" style="margin:0">Partida</div>
            <div style="display:flex;flex-direction:column;font-weight:800;font-size:24px">
              ${[['Modo', 'Carrera'], ['Mapa', 'El Escritorio'], ['Vueltas', st.laps], ['Power-ups', powerupsText(st.powerups)], ['Máximo', `${st.max} jugadores`]].map(([k, v]) => `
                <div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:2px solid var(--vm-line)">
                  <span class="vm-muted">${k}</span><span>${v}</span>
                </div>`).join('')}
            </div>
            <div class="vm-muted" style="font-weight:800;font-size:20px;line-height:1.4;margin-top:auto" data-hint></div>
            <button class="vm-btn hero center" style="font-size:40px" data-action></button>
          </div>
        </div>
      </div>`, {
      back: () => online.leave(),
      onMount: (el) => {
        const chat = el.querySelector('[data-chat]');
        const addChat = (m) => {
          const line = document.createElement('div');
          line.innerHTML = m.system
            ? `<span style="color:var(--vm-yellow)">Sistema:</span> ${esc(m.text)}`
            : `<span style="color:${slotColor(m.slot)}">${esc(m.name)}:</span> ${esc(m.text)}`;
          chat.appendChild(line);
          chat.scrollTop = chat.scrollHeight;
        };
        online.chat.forEach(addChat);
        this.onlineChat = addChat;
        const input = el.querySelector('[data-chat-input]');
        input.addEventListener('keydown', (e) => {
          if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
          s.chat(input.value);
          input.value = '';
        });

        const action = el.querySelector('[data-action]');
        action.addEventListener('click', () => {
          if (s.isHost) s.startPilots();
          else s.setReady(!s.player.ready);
        });

        const update = () => {
          const st2 = s.state;
          const slots = [...st2.players].sort((a, b) => a.slot - b.slot);
          el.querySelector('[data-count]').textContent = `${slots.length} / ${st2.max}`;
          el.querySelector('[data-players]').innerHTML =
            slots.map((p) => `
              <div class="vm-slot ${p.id === s.me.id ? 'me' : ''}">
                <div class="vm-avatar" style="--c:${slotColor(p.slot)}">${esc(p.name[0].toUpperCase())}</div>
                <div class="who">${esc(p.name)} ${p.host ? '<span class="tag">ANFITRIÓN</span>' : ''}<small>${p.id === s.me.id ? 'Vos' : 'Jugador ' + (p.slot + 1)}</small></div>
                <span class="vm-state ${p.ready ? 'ready' : ''}">${p.ready ? 'LISTO' : 'ESPERANDO'}</span>
              </div>`).join('') +
            Array.from({ length: st2.max - slots.length }, () => '<div class="vm-slot empty">Esperando piloto…</div>').join('');

          const waiting = st2.players.filter((p) => !p.host && !p.ready).map((p) => p.name);
          const hint = el.querySelector('[data-hint]');
          if (s.isHost) {
            action.innerHTML = 'SELECCIONAR PILOTO';
            action.className = `vm-btn hero center ${s.canStart ? 'yellow' : ''}`;
            action.disabled = !s.canStart;
            hint.textContent = st2.players.length < 2
              ? `Pasales el código ${st2.code} a tus amigos para que entren.`
              : waiting.length
                ? `Esperando que estén listos: ${waiting.join(', ')}.`
                : '¡Están todos listos! Pasen a elegir piloto.';
          } else {
            const ready = s.player?.ready;
            action.innerHTML = ready ? 'YA NO ESTOY LISTO' : 'ESTOY LISTO';
            action.className = `vm-btn hero center ${ready ? '' : 'yellow'}`;
            action.disabled = false;
            hint.textContent = ready ? 'Cuando estén todos listos, el anfitrión elige cuándo arrancar.' : 'Poné «Listo» para que el anfitrión pueda arrancar.';
          }
        };
        this.onlineUpdate = update;
        update();
      },
    });
  },

  // ------------------------------------------------------------------ ELEGÍ TU PILOTO (online)

  showOnlinePilots() {
    const online = this.online;
    const s = online.session;
    const n = DRIVERS.length;
    const start = DRIVERS.findIndex((d) => d.id === this.settings.drivers[0]);
    const st = { i: Math.max(0, start) };
    const controls = this.settings.controls;
    const keys = `<kbd>${keyLabel(controls[0].left)}</kbd><kbd>${keyLabel(controls[0].right)}</kbd> o <kbd>←</kbd><kbd>→</kbd> elegir <kbd>${keyLabel(controls[0].use)}</kbd> o <kbd>ENTER</kbd> confirmar`;

    this.render(`
      <div class="vm-screen vm-pk">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px">
          ${this.header('ELEGÍ TU PILOTO', s.isHost ? 'CERRAR LOBBY' : 'SALIR')}
          <div class="vm-pk-players">
            <div class="vm-pk-dots">${[...s.state.players].sort((a, b) => a.slot - b.slot).map((p, i) => `<span class="vm-pk-dot" style="background:${slotColor(p.slot)};${i ? 'margin-left:-11px' : ''}">${esc(p.name[0].toUpperCase())}</span>`).join('')}</div>
            <div><b>${esc(s.state.name)}</b><small>ONLINE · ${s.state.players.length} JUGADORES</small></div>
          </div>
        </div>
        <section class="vm-pk-grid" role="listbox" aria-label="Pilotos">${pilotCardsHTML()}</section>
        <div class="vm-pk-foot">
          <div class="vm-pk-keys"><span>${keys}</span></div>
          <div style="display:flex;align-items:center;gap:22px">
            <span class="vm-pk-status" data-status aria-live="polite"></span>
            <button class="vm-btn yellow vm-pk-cta" data-cta><span data-cta-text></span><span>›</span></button>
          </div>
        </div>
      </div>`, {
      back: () => online.leave(), // botón SALIR (ESC solo deshace la confirmación, ver screenKey)
      onMount: (el) => {
        el.querySelectorAll('.vm-pk-card').forEach((c) => c.addEventListener('click', () => {
          if (s.player?.confirmed) return;
          st.i = +c.dataset.i;
          s.setPilot(DRIVERS[st.i].id, false);
        }));
        el.querySelector('[data-cta]').addEventListener('click', () => confirm());
        // Las tarjetas muestran quién eligió cada piloto (puntos de color con la inicial)
        el.querySelectorAll('.vm-pk-tags').forEach((t) => (t.innerHTML = ''));
      },
    });

    const el = this.layer;
    const cards = [...el.querySelectorAll('.vm-pk-card')];
    const confirm = () => {
      if (!s.player) return;
      s.setPilot(DRIVERS[st.i].id, !s.player.confirmed);
    };
    const update = () => {
      const me = s.player;
      if (!me) return;
      if (me.driver) st.i = Math.max(0, DRIVERS.findIndex((d) => d.id === me.driver));
      const players = s.state.players;
      cards.forEach((c, i) => {
        const id = DRIVERS[i].id;
        c.classList.toggle('sel', i === st.i);
        c.classList.toggle('ready-on', i === st.i && me.confirmed);
        const pickers = players.filter((p) => p.driver === id);
        c.querySelector('.vm-pk-tags').innerHTML = pickers
          .map((p) => `<span class="vm-pk-tag" style="display:inline-block;background:${slotColor(p.slot)}">${esc(p.name.slice(0, 10))}${p.confirmed ? ' ✓' : ''}</span>`)
          .join('');
      });
      const waiting = players.filter((p) => !p.confirmed).map((p) => p.name);
      el.querySelector('[data-cta-text]').textContent = me.confirmed ? 'Cambiar piloto' : 'Confirmar';
      el.querySelector('[data-status]').textContent = waiting.length ? `Faltan confirmar: ${waiting.join(', ')}` : '¡Arranca la carrera!';
    };
    this.onlineUpdate = update;
    this.screenKey = (code) => {
      if (code === 'Escape' || code === 'Backspace') {
        if (s.player?.confirmed) s.setPilot(DRIVERS[st.i].id, false);
        return true;
      }
      const left = code === controls[0].left || code === controls[1].left;
      const right = code === controls[0].right || code === controls[1].right;
      if (left || right) {
        if (s.player?.confirmed) return true;
        st.i = (st.i + (right ? 1 : -1) + n) % n;
        s.setPilot(DRIVERS[st.i].id, false);
        return true;
      }
      if (code === controls[0].use || code === controls[1].use || code === 'Enter' || code === 'NumpadEnter') {
        confirm();
        return true;
      }
      return false;
    };
    // Al entrar, el piloto resaltado queda elegido (sin confirmar) para que los demás lo vean
    s.setPilot(DRIVERS[st.i].id, false);
    update();
  },

  // ------------------------------------------------------------------ PAUSA ONLINE

  /** ESC en una carrera online: la carrera sigue; solo se puede volver o salir. */
  showOnlinePause() {
    const s = this.online.session;
    this.root.classList.remove('hidden');
    this.layer.innerHTML = '';
    this.stage.querySelector('.vm-bg').style.display = 'none';
    this.back = null;
    const resume = () => {
      this.stage.querySelector('.vm-bg').style.display = '';
      this.hide();
    };
    const m = this.openModal(`
      <div class="vm-dialog">
        <div class="band"></div>
        <div class="body">
          <div class="title">Partida online</div>
          <div class="text">La carrera sigue mientras tanto: no se puede pausar.</div>
          <div class="actions">
            <button class="vm-btn yellow center" data-resume>SEGUIR</button>
            <button class="vm-btn red stroked center" data-leave>${s?.isHost ? 'CERRAR LOBBY' : 'SALIR'}</button>
          </div>
        </div>
      </div>`, { onCancel: resume });
    this.root.style.background = 'transparent';
    this.stage.style.background = 'transparent';
    m.querySelector('[data-resume]').addEventListener('click', resume);
    m.querySelector('[data-leave]').addEventListener('click', () => {
      this.stage.querySelector('.vm-bg').style.display = '';
      this.online.leave();
    });
    m.querySelector('[data-resume]').focus();
  },
};
