import { PlayerState } from './Car.js';
import { controlsSummary, keyLabel } from './ui/Settings.js';
import { podiumHTML, renderPodium } from './ui/Podium.js';
import { audio } from './audio/index.js';
import { padGlyph } from './ui/padHints.js';

/** HUD en HTML/CSS superpuesto al canvas. */
export class HUD {
  constructor(root, players, onRestart, onMenu) {
    this.root = root;
    this.onlineActions = {}; // { back(), leave() } en el online (los pone main.js)
    root.innerHTML = `
      <div class="top">
        ${players.map((p, i) => `
          <div class="card" data-i="${i}" style="--c:${p.color}">
            <div class="card-name">${p.name}</div>
            <div class="card-keys">${p.controlsLabel}</div>
            <div class="card-info"><span class="place"></span> · <span class="wins" title="Rondas ganadas">★ 0</span></div>
            <div class="item" data-state="EMPTY">
              <span class="item-icon"></span><span class="item-name">EMPTY</span><kbd class="item-key">${p.useLabel}</kbd><b class="item-ammo"></b>
            </div>
            <div class="hp"><i></i></div>
            <div class="effects"></div>
            <div class="card-status"></div>
          </div>`).join('')}
      </div>
      <div class="top-actions">
        <button class="hud-btn pause-btn">Pausa <kbd class="kbd-hint">ESC</kbd>${padGlyph('Start')}</button>
        <button class="hud-btn restart kbd-hint">Reiniciar <kbd>R</kbd></button>
      </div>
      <div class="round-tag"></div>
      <div class="start-count hidden" aria-live="assertive"><span></span></div>
      <div class="round-win hidden" aria-live="assertive">
        <div class="rw-kicker">GANADOR</div>
        <div class="rw-name"></div>
        <div class="rw-sub"></div>
      </div>
      <div class="result hidden">${podiumHTML()}</div>`;

    this.cards = [...root.querySelectorAll('.card')];
    this.result = root.querySelector('.result');
    this.startCount = root.querySelector('.start-count');
    this.roundTag = root.querySelector('.round-tag');
    this.roundWin = root.querySelector('.round-win');
    this.roundShown = null;
    this.startShown = null;
    this.lastHealth = players.map(() => 1);
    root.querySelectorAll('.restart').forEach((b) =>
      b.addEventListener('click', () => {
        b.blur();
        onRestart();
      }),
    );
    root.querySelector('.menu-btn').addEventListener('click', () => onMenu?.());
    root.querySelector('.net-back').addEventListener('click', () => this.onlineActions.back?.());
    root.querySelectorAll('.net-leave').forEach((b) => b.addEventListener('click', () => this.onlineActions.leave?.()));
    // "Pausa" simula la tecla ESC para reusar el mismo camino que el teclado
    root.querySelector('.pause-btn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    });
  }

  /** Actualiza las etiquetas de controles (después de reasignar teclas o cambiar de rival). */
  refreshControls(players) {
    players.forEach((p, i) => {
      p.controlsLabel = controlsSummary(p.controls, p.pad);
      p.useLabel = keyLabel(p.controls.use);
      this.cards[i].querySelector('.card-keys').textContent = p.cpuLabel || p.controlsLabel;
      const key = this.cards[i].querySelector('.item-key');
      key.textContent = p.useLabel;
      key.style.visibility = p.cpuLabel ? 'hidden' : '';
    });
  }

  /** Nombres de los pilotos (el jugador 2 puede ser la CPU). */
  setNames(players) {
    players.forEach((p, i) => {
      this.cards[i].querySelector('.card-name').textContent = p.name;
    });
    this.refreshControls(players);
  }

  /**
   * players: [{ wins, place, state: PlayerState, falling, item, ammo, effects, health (0..1) }]
   */
  update(players) {
    players.forEach((p, i) => {
      const card = this.cards[i];
      const wins = `★ ${p.wins}`;
      const winsEl = card.querySelector('.wins');
      if (winsEl.textContent !== wins) winsEl.textContent = wins;
      card.querySelector('.place').textContent = `${p.place}º`;
      card.dataset.state = p.state;

      // Objeto guardado (un solo slot)
      const slot = card.querySelector('.item');
      const id = p.item ? p.item.id : 'EMPTY';
      if (slot.dataset.item !== id) {
        slot.dataset.item = id;
        slot.dataset.state = p.item ? 'HAS_ITEM' : 'EMPTY';
        slot.style.setProperty('--ic', p.item ? p.item.color : '');
        slot.querySelector('.item-icon').textContent = p.item ? p.item.icon : '';
        slot.querySelector('.item-name').textContent = p.item ? p.item.name : 'EMPTY';
      }
      // Balas del arma (contador sobre el casillero)
      const ammo = p.item?.fire ? String(p.ammo) : '';
      const ammoEl = slot.querySelector('.item-ammo');
      if (ammoEl.textContent !== ammo) ammoEl.textContent = ammo;
      // Efectos activos con tiempo restante
      const fx = p.effects.filter((e) => !e.constructor.hidden).map((e) => `${e.label} ${e.remaining.toFixed(1)}s`).join(' · ');
      const fxEl = card.querySelector('.effects');
      if (fxEl.textContent !== fx) fxEl.textContent = fx;
      card.querySelector('.card-status').textContent =
        p.state === PlayerState.ELIMINATED ? 'ELIMINADO' : p.falling ? '¡SE CAYÓ!' : '';

      // Vida: barra (verde → amarillo → rojo) y destello cuando baja
      const hp = Math.max(0, Math.min(1, p.health ?? 1));
      if (hp !== this.lastHealth[i]) {
        const bar = card.querySelector('.hp');
        bar.style.setProperty('--hp', hp);
        bar.dataset.level = hp > 0.6 ? 'ok' : hp > 0.3 ? 'mid' : 'low';
        if (hp < this.lastHealth[i]) {
          card.classList.remove('hit');
          void card.offsetWidth; // reinicia la animación
          card.classList.add('hit');
        }
        this.lastHealth[i] = hp;
      }
    });
  }

  /** Cuenta de largada: 3, 2, 1, 'go' ("¡YA!") o null (oculta). Cada cambio suena y "golpea" en pantalla. */
  setStart(value) {
    if (value === this.startShown) return;
    this.startShown = value;
    this.startCount.classList.toggle('hidden', value == null);
    if (value == null) return;
    const span = this.startCount.querySelector('span');
    span.textContent = value === 'go' ? '¡YA!' : value;
    this.startCount.dataset.value = value;
    span.classList.remove('pop');
    void span.offsetWidth; // reinicia la animación
    span.classList.add('pop');
    audio.play(value === 'go' ? 'count-go' : 'count');
  }

  /** Resalta el slot cuando el jugador recoge un objeto. */
  flashItem(i) {
    const slot = this.cards[i].querySelector('.item');
    slot.classList.remove('got');
    void slot.offsetWidth;
    slot.classList.add('got');
  }

  /** Total de vueltas de la carrera (se muestra como "Vuelta 2/5"). */
  /** Indicador de ronda (arriba al centro). */
  setRound(round, rounds, tiebreak = false) {
    const text = tiebreak ? 'RONDA EXTRA' : `RONDA ${round} / ${rounds}`;
    if (this.roundTag.textContent !== text) this.roundTag.textContent = text;
  }

  /** Cartel del ganador de la ronda: { name, color, wins, round }, o null = ronda sin ganador. */
  showRoundWinner(w) {
    const key = w ? `${w.round}:${w.name}` : 'none';
    if (this.roundShown === key) return;
    this.roundShown = key;
    const name = this.roundWin.querySelector('.rw-name');
    this.roundWin.querySelector('.rw-kicker').textContent = w ? 'GANADOR' : 'SIN GANADOR';
    name.textContent = w ? w.name : '¡Todos afuera!';
    name.style.setProperty('--c', w?.color ?? '#fff4dc');
    this.roundWin.querySelector('.rw-sub').textContent = w
      ? `${'★'.repeat(w.wins)} · ${w.wins} ${w.wins === 1 ? 'ronda ganada' : 'rondas ganadas'}`
      : 'La ronda se repite';
    this.roundWin.classList.remove('hidden', 'pop');
    void this.roundWin.offsetWidth; // reinicia la animación
    this.roundWin.classList.add('pop');
  }

  hideRoundWinner() {
    if (this.roundShown == null) return;
    this.roundShown = null;
    this.roundWin.classList.add('hidden');
  }

  /** Podio del final: result = { winner, title, sub, standings } (ver Game.finish). */
  showResult(result) {
    if (this.result.classList.contains('hidden')) {
      audio.music.play('victory');
      // Locutor: "The winner is…" y el nombre del piloto ganador (una vez, mientras sube el podio)
      const champ = result.winner >= 0 ? result.standings?.[0]?.driver : null;
      if (champ) audio.voices.sequence(['winner', champ], 0.8);
    }
    renderPodium(this.result, result);
    this.result.classList.remove('hidden');
  }

  /** Botones del cartel de resultado: 'local' (revancha / menú), 'host' (volver al lobby) o 'guest' (esperar). */
  setResultMode(mode) {
    this.result.querySelectorAll('.result-actions').forEach((el) => el.classList.toggle('hidden', el.dataset.mode !== mode));
    this.result.querySelector('.result-hint').classList.toggle('hidden', mode !== 'local');
    // Online no se reinicia la carrera (la maneja el anfitrión)
    this.root.querySelector('.top-actions .restart').classList.toggle('hidden', mode !== 'local');
  }

  /** Online: resalta la tarjeta del jugador propio y oculta las teclas de los demás. */
  markLocal(index) {
    this.cards.forEach((card, i) => {
      card.classList.toggle('me', i === index);
      if (i !== index) card.querySelector('.card-keys').textContent = '';
    });
  }

  hideResult() {
    if (!this.result.classList.contains('hidden')) {
      audio.voices.cancel();
      audio.voices.stop();
    }
    this.result.classList.add('hidden');
    this.result.querySelector('.pd-confetti').innerHTML = '';
  }
}
