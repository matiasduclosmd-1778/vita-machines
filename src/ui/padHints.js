// Ayudas para jugar con joystick: íconos de botones (A, B, X, Y, START…) al costado de cada acción.
// El "modo mando" se activa al tocar un joystick y se apaga con el mouse o el teclado (ver main.js):
// en ese modo se ven los íconos del mando (.pad-hint) y se ocultan las teclas (.kbd-hint).

const LABELS = { A: 'A', B: 'B', X: 'X', Y: 'Y', Start: 'START', Back: 'BACK', LB: 'LB', RB: 'RB' };

/** Ícono de un botón. `always`: visible también fuera del modo mando (p. ej. la ayuda de cada jugador). */
export const padGlyph = (button, { always = false } = {}) =>
  `<i class="pad-glyph pad-${button.toLowerCase()} ${always ? '' : 'pad-hint'}" aria-hidden="true">${LABELS[button] ?? button}</i>`;

/** Agrega el ícono a cada botón con atajo de joystick: [data-pad="X"], y B en los de volver o cancelar. */
export function decoratePadButtons(scope) {
  scope.querySelectorAll('[data-pad], [data-back], [data-cancel]').forEach((el) => {
    if (el.querySelector(':scope > .pad-glyph')) return;
    el.insertAdjacentHTML('beforeend', padGlyph(el.dataset.pad ?? 'B'));
  });
}

export const padMode = () => document.documentElement.classList.contains('pad-mode');

export function setPadMode(on) {
  document.documentElement.classList.toggle('pad-mode', on);
}
