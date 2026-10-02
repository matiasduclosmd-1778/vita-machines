import './podium.css';
import { GAME_CONFIG } from '../config.js';
import { pilotImage, vehicleImage, initials, breakableName } from './pilots.js';
import { padGlyph } from './padHints.js';

// Podio del final de la carrera (diseño de Update/podio.html). Lo arma el HUD con el resultado de Game.finish.

const DRIVERS = GAME_CONFIG.drivers;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

// Estilo de cada escalón: alto del bloque y del escenario, color, tamaño del número, ancho del auto,
// demora de la animación y escala del piloto
const PLACES = {
  1: { bh: 215, sh: 300, bc: 'var(--pd-yellow)', ps: 100, cw: '58%', d: 0.9, scale: 1.12 },
  2: { bh: 175, sh: 270, bc: 'var(--pd-silver)', ps: 78, cw: '54%', d: 0.45, scale: 1 },
  3: { bh: 162, sh: 240, bc: 'var(--pd-bronze)', ps: 62, cw: '54%', d: 0, scale: 0.94 },
};

// El podio se arma en un lienzo de 1440×960 que se escala para entrar en la ventana
const fit = () => document.documentElement.style.setProperty('--pd-scale', Math.min(innerWidth / 1440, innerHeight / 960));
fit();
window.addEventListener('resize', fit);

/** Esqueleto del podio (los botones son los del HUD: .restart, .menu-btn, .net-back, .net-leave). */
export function podiumHTML() {
  return `
    <div class="pd-screen">
      <div class="pd-top">
        <div>
          <span class="pd-kicker">PARTIDA TERMINADA</span>
          <h1 class="pd-title"></h1>
          <div class="pd-sub"></div>
          <div class="pd-hazard" aria-hidden="true"></div>
        </div>
        <div class="pd-players"></div>
      </div>
      <section class="pd-podium" aria-label="Podio"></section>
      <div class="pd-rest" aria-label="Resto de los puestos"></div>
      <div class="pd-foot">
        <div class="result-hint kbd-hint">o presioná <kbd>R</kbd> / <kbd>Enter</kbd> para la revancha</div>
        <div class="result-actions" data-mode="local">
          <button class="pd-btn menu-btn">Volver al menú ${padGlyph('B')}</button>
          <button class="pd-btn primary restart">Revancha ${padGlyph('A')}<span class="kbd-hint" aria-hidden="true">›</span></button>
        </div>
        <div class="result-actions hidden" data-mode="host">
          <button class="pd-btn net-leave">Cerrar lobby ${padGlyph('B')}</button>
          <button class="pd-btn primary net-back">Volver al lobby ${padGlyph('A')}<span class="kbd-hint" aria-hidden="true">›</span></button>
        </div>
        <div class="result-actions hidden" data-mode="guest">
          <div class="result-wait">Esperando al anfitrión…</div>
          <button class="pd-btn net-leave">Salir ${padGlyph('B')}</button>
        </div>
      </div>
    </div>
    <div class="pd-confetti" aria-hidden="true"></div>`;
}

/**
 * Llena el podio con el resultado ({ title, sub, standings }, ver Game.finish).
 * Cada puesto muestra el nombre del jugador (con su color) y el de su piloto.
 */
export function renderPodium(root, result) {
  const st = result.standings ?? [];
  const lead = st[0];
  const winnerTime = st.find((s) => s.time != null)?.time ?? null; // (resultados con tiempos; las rondas usan `wins`)
  const driver = (s) => DRIVERS.find((d) => d.id === s?.driver) ?? null;

  // Título: el jugador que ganó y con qué piloto
  const champ = result.winner >= 0 ? lead : null;
  const title = root.querySelector('.pd-title');
  title.textContent = champ ? `¡GANÓ ${champ.name.toUpperCase()}!` : '¡EMPATE!';
  title.classList.toggle('long', !!champ && champ.name.length > 10);
  const champDriver = driver(champ);
  root.querySelector('.pd-sub').textContent = champDriver ? `con ${champDriver.name} · ${result.sub}` : result.sub;

  // Corredores de la partida (arriba a la derecha)
  const byIndex = [...st].sort((a, b) => a.index - b.index);
  root.querySelector('.pd-players').innerHTML = `
    <div class="pd-dots">${byIndex.map((s, i) => `<span class="pd-dot" style="background:${s.color};${i ? 'margin-left:-14px' : ''}">${s.cpu ? '🤖' : esc(s.name[0].toUpperCase())}</span>`).join('')}</div>
    <div><b>${byIndex.map((s) => esc(s.name)).join(' · ')}</b><small>${st.length} CORREDORES</small></div>`;

  const timeText = (s) => {
    if (s.wins != null) return [`${'★'.repeat(Math.min(s.wins, 9))}${s.wins ? '' : '—'}`, `${s.wins} ${s.wins === 1 ? 'ronda ganada' : 'rondas ganadas'}`];
    if (s.out) return ['ELIMINADO', `en la vuelta ${s.lap}`];
    if (s.time != null) return [fmt(s.time), ''];
    if (s.gap != null && winnerTime != null) return [fmt(winnerTime + s.gap * 1000), `+${s.gap.toFixed(3)} s`];
    return ['—', ''];
  };

  // Podio: 2º · 1º · 3º (con menos corredores, los que haya)
  const order = [1, 0, 2].filter((i) => i < Math.min(3, st.length));
  const podium = root.querySelector('.pd-podium');
  podium.style.gridTemplateColumns = order.map((i) => (i === 0 ? '1.15fr' : '1fr')).join(' ');
  podium.style.maxWidth = ['420px', '760px', ''][order.length - 1] ?? ''; // con menos escalones, más angosto
  podium.innerHTML = order
    .map((i) => {
      const s = st[i];
      const d = driver(s);
      const p = PLACES[i + 1];
      const [time, gap] = timeText(s);
      const portrait = d?.portrait
        ? `<img class="pd-who" src="${pilotImage(d.portrait)}" alt="${esc(d.name)}">`
        : d ? `<div class="pd-who pd-noportrait">${esc(initials(d.name))}</div>` : '';
      const car = d && vehicleImage(d) ? `<img class="pd-car" src="${vehicleImage(d)}" alt="">` : '';
      const w = (d?.podium?.w ?? 0.8) * 100 * p.scale;
      return `
        <div class="pd-slot" style="--bh:${p.bh}px;--sh:${p.sh}px;--bc:${p.bc};--ps:${p.ps}px;--cw:${p.cw};--d:${p.d}s;--w:${w}%;--hide:${d?.podium?.hide ?? '30%'}">
          <div class="pd-stage">${portrait}${car}</div>
          <div class="pd-block">
            ${i === 0 && champ ? '<span class="pd-crown">GANADOR</span>' : ''}
            <span class="pd-tag" style="background:${s.color}">${esc(s.name)}</span>
            <span class="pd-pos">${i + 1}°</span>
            <span class="pd-name ${(d?.name.length ?? 0) > 12 ? 'long' : ''}">${d ? breakableName(esc(d.name)) : ''}</span>
            <span class="pd-time">${time}</span>
            ${gap ? `<span class="pd-gap">${gap}</span>` : ''}
          </div>
        </div>`;
    })
    .join('');

  // 4º en adelante
  root.querySelector('.pd-rest').innerHTML = st
    .slice(3)
    .map((s, k) => {
      const d = driver(s);
      const [time, gap] = timeText(s);
      return `
        <div class="pd-row" style="--paint:${d?.c1 ?? '#555'}">
          <span class="pd-n">${k + 4}°</span>
          ${d?.portrait ? `<img src="${pilotImage(d.portrait)}" alt="">` : '<i class="pd-thumb"></i>'}
          <span class="pd-nm">${d ? esc(d.name) : ''}</span>
          <span class="pd-tg" style="background:${s.color}">${esc(s.name)}</span>
          <span class="pd-t">${time}</span>${gap ? `<span class="pd-g">${gap}</span>` : ''}
        </div>`;
    })
    .join('');

  // Confeti con los colores del ganador
  const colors = ['var(--pd-yellow)', 'var(--pd-red)', 'var(--pd-cream)', champ?.color, champDriver?.c1, champDriver?.paint].filter(Boolean);
  root.querySelector('.pd-confetti').innerHTML = champ
    ? Array.from({ length: 70 }, () => {
        const c = colors[Math.floor(Math.random() * colors.length)];
        return `<i style="left:${Math.random() * 100}%;background:${c};animation-duration:${2.4 + Math.random() * 2.2}s;animation-delay:${1.1 + Math.random() * 1.2}s;transform:rotate(${Math.random() * 180}deg)"></i>`;
      }).join('')
    : '';
}
