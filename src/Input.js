const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter']);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressHandlers = [];

    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressHandlers.forEach((fn) => fn(e.code));
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Devuelve { throttle, steer } en -1..1 para un set de controles. steer > 0 = izquierda. */
  axis(controls) {
    const k = (code) => (this.down.has(code) ? 1 : 0);
    return {
      throttle: k(controls.up) - k(controls.down),
      steer: k(controls.left) - k(controls.right),
    };
  }

  onPress(fn) {
    this.pressHandlers.push(fn);
  }
}
