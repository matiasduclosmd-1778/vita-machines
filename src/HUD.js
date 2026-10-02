import { PlayerState } from './Car.js';
import { controlsSummary, keyLabel } from './ui/Settings.js';
import { podiumHTML, renderPodium } from './ui/Podium.js';
import { audio } from './audio/index.js';

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
            <div class="card-info"><span class="place"></span> · Vuelta <span class="lap">1</span>/<span class="laps">5</span></div>
            <div class="item" data-state="EMPTY">
              <span class="item-icon"></span><span class="item-name">EMPTY</span><kbd class="item-key">${p.useLabel}</kbd>
            </div>
            <div class="effects"></div>
            <div class="card-status"></div>
          </div>`).join('')}
      </div>
      <div class="top-actions">
        <button class="hud-btn pause-btn">Pausa <kbd>ESC</kbd></button>
        <button class="hud-btn restart">Reiniciar <kbd>R</kbd></button>
      </div>
      <div class="countdowns">
        ${players.map((p) => `
          <div class="cd hidden" style="--c:${p.color}">
            <div class="cd-label">¡${p.name} fuera de pantalla!</div>
            <div class="cd-num">3</div>
          </div>`).join('')}
      </div>
      ${players.map((p) => `<div class="edge-arrow hidden" style="--c:${p.color}"><span class="arrow">➤</span><span class="tag">${p.short}</span></div>`).join('')}
      <div class="result hidden">${podiumHTML()}</div>`;

    this.cards = [...root.querySelectorAll('.card')];
    this.countdowns = [...root.querySelectorAll('.cd')];
    this.arrows = [...root.querySelectorAll('.edge-arrow')];
    this.result = root.querySelector('.result');
    this.lastNumbers = players.map(() => null);
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
      this.countdowns[i].querySelector('.cd-label').textContent = `¡${p.name} fuera de pantalla!`;
      this.arrows[i].querySelector('.tag').textContent = p.short;
    });
    this.refreshControls(players);
  }

  /**
   * players: [{ lap, place, state: PlayerState, item, effects, countdown, ndc: {x,y,behind} }]
   */
  update(players) {
    players.forEach((p, i) => {
      const card = this.cards[i];
      card.querySelector('.lap').textContent = p.lap;
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
      // Efectos activos con tiempo restante
      const fx = p.effects.map((e) => `${e.label} ${e.remaining.toFixed(1)}s`).join(' · ');
      const fxEl = card.querySelector('.effects');
      if (fxEl.textContent !== fx) fxEl.textContent = fx;
      card.querySelector('.card-status').textContent =
        p.state === PlayerState.ELIMINATED ? 'ELIMINADO'
          : p.falling ? '¡SE CAYÓ!'
            : p.state === PlayerState.OUT_OF_SCREEN ? '¡FUERA DE PANTALLA!' : '';

      // Countdown grande
      const cd = this.countdowns[i];
      cd.classList.toggle('hidden', p.countdown == null);
      if (p.countdown != null && p.countdown !== this.lastNumbers[i]) {
        const num = cd.querySelector('.cd-num');
        num.textContent = p.countdown;
        audio.play('out-tick', { pan: Math.max(-1, Math.min(1, p.ndc.x)) * 0.8, minGap: 0.1 });
        num.classList.remove('pop');
        void num.offsetWidth; // reinicia la animación
        num.classList.add('pop');
      }
      this.lastNumbers[i] = p.countdown;

      // Flecha en el borde apuntando al auto que salió
      const arrow = this.arrows[i];
      const show = p.state === PlayerState.OUT_OF_SCREEN;
      arrow.classList.toggle('hidden', !show);
      if (show) {
        let { x, y } = p.ndc;
        if (p.ndc.behind) {
          x = -x;
          y = -y;
        }
        const m = Math.max(Math.abs(x), Math.abs(y), 1e-6);
        const k = Math.min(1, 0.93 / m);
        const w = window.innerWidth;
        const h = window.innerHeight;
        const sx = ((x * k + 1) / 2) * w;
        const sy = ((1 - y * k) / 2) * h;
        const angle = Math.atan2(-y, x);
        arrow.style.transform = `translate(${sx}px, ${sy}px)`;
        arrow.querySelector('.arrow').style.transform = `rotate(${angle}rad)`;
      }
    });
  }

  /** Resalta el slot cuando el jugador recoge un objeto. */
  flashItem(i) {
    const slot = this.cards[i].querySelector('.item');
    slot.classList.remove('got');
    void slot.offsetWidth;
    slot.classList.add('got');
  }

  /** Total de vueltas de la carrera (se muestra como "Vuelta 2/5"). */
  setLaps(laps) {
    this.root.querySelectorAll('.laps').forEach((el) => (el.textContent = laps));
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
