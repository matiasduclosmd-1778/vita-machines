import { PlayerState } from './Car.js';
import { controlsSummary, keyLabel } from './ui/Settings.js';

/** HUD en HTML/CSS superpuesto al canvas. */
export class HUD {
  constructor(root, players, onRestart, onMenu) {
    this.root = root;
    root.innerHTML = `
      <div class="top">
        ${players.map((p, i) => `
          <div class="card" data-i="${i}" style="--c:${p.color}">
            <div class="card-name">${p.name}</div>
            <div class="card-keys">${p.controlsLabel}</div>
            <div class="card-info"><span class="place"></span> · Vuelta <span class="lap">1</span></div>
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
      <div class="result hidden">
        <div class="result-box">
          <div class="band"></div>
          <div class="result-body">
            <div class="result-title"></div>
            <div class="result-sub"></div>
            <div class="result-actions">
              <button class="vm-btn yellow center restart">REVANCHA</button>
              <button class="vm-btn center menu-btn">MENÚ</button>
            </div>
            <div class="result-hint">o presioná <kbd>R</kbd> / <kbd>Enter</kbd></div>
          </div>
        </div>
      </div>`;

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
    // "Pausa" simula la tecla ESC para reusar el mismo camino que el teclado
    root.querySelector('.pause-btn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    });
  }

  /** Actualiza las etiquetas de controles (después de reasignar teclas o cambiar de rival). */
  refreshControls(players) {
    players.forEach((p, i) => {
      p.controlsLabel = controlsSummary(p.controls);
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
      card.querySelector('.place').textContent = p.place === 1 ? '1º' : '2º';
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

  showResult(winner, loser) {
    const title = this.result.querySelector('.result-title');
    const sub = this.result.querySelector('.result-sub');
    if (winner) {
      title.textContent = `¡${winner.name} gana!`;
      title.style.color = winner.color;
      sub.textContent = `${loser.name} quedó fuera de pantalla y fue eliminado.`;
    } else {
      title.textContent = '¡Empate!';
      title.style.color = '';
      sub.textContent = 'Ambos jugadores fueron eliminados a la vez.';
    }
    this.result.classList.remove('hidden');
  }

  hideResult() {
    this.result.classList.add('hidden');
  }
}
