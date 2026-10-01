import * as THREE from 'three';
import { GAME_CONFIG } from './config.js';

const CAM = GAME_CONFIG.camera;

/**
 * Herramientas de debug (GAME_CONFIG.debug.enabled / tecla V):
 *  - panel de texto con posiciones, velocidades, estados, cámara y countdown;
 *  - zona segura dibujada sobre la pantalla (el margen de peligro en rojo);
 *  - marcador sobre cada jugador con INSIDE / OUTSIDE;
 *  - ayudas 3D: punto medio, foco de cámara y línea entre jugadores.
 */
export class Debug {
  constructor(hudRoot, scene, players) {
    this.enabled = GAME_CONFIG.debug.enabled;
    this.root = document.createElement('div');
    this.root.className = 'debug';
    const m = CAM.safeMargin;
    this.root.style.setProperty('--safe-x', `${m.x * 100}%`);
    this.root.style.setProperty('--safe-y', `${m.y * 100}%`);
    this.root.innerHTML = `
      <div class="debug-safe"><span>ZONA SEGURA</span></div>
      ${players.map((p) => `<div class="debug-marker" style="--c:${p.color}"><div class="ring"></div><div class="label"></div></div>`).join('')}
      <pre class="debug-panel"></pre>`;
    hudRoot.appendChild(this.root);
    this.safe = this.root.querySelector('.debug-safe');
    this.markers = [...this.root.querySelectorAll('.debug-marker')];
    this.panel = this.root.querySelector('.debug-panel');

    this.helpers = new THREE.Group();
    const flat = (geo, color) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 10;
      return mesh;
    };
    this.midMarker = flat(new THREE.RingGeometry(0.8, 1.2, 24), '#ffffff');
    this.focusMarker = flat(new THREE.RingGeometry(1.6, 2.0, 4), '#ff2bd6');
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.8 }),
    );
    this.line.renderOrder = 10;
    this.helpers.add(this.midMarker, this.focusMarker, this.line);
    scene.add(this.helpers);
    this.apply();
  }

  dispose(scene) {
    this.root.remove();
    scene.remove(this.helpers);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.apply();
  }

  apply() {
    this.root.classList.toggle('hidden', !this.enabled);
    this.helpers.visible = this.enabled && GAME_CONFIG.debug.helpers3D;
  }

  /**
   * @param cars    autos
   * @param rig     CameraRig
   * @param tracker OffscreenTracker
   * @param powerups PowerUpManager
   */
  update(cars, rig, tracker, powerups) {
    if (!this.enabled) return;

    // Ayudas 3D
    this.midMarker.position.set(rig.midpoint.x, rig.midpoint.y + 0.05, rig.midpoint.z);
    this.focusMarker.position.set(rig.focus.x, rig.focus.y + 0.06, rig.focus.z);
    const pos = this.line.geometry.attributes.position;
    pos.setXYZ(0, cars[0].position.x, cars[0].position.y + 0.6, cars[0].position.z);
    pos.setXYZ(1, cars[1].position.x, cars[1].position.y + 0.6, cars[1].position.z);
    pos.needsUpdate = true;

    // Marcadores en pantalla
    const w = window.innerWidth;
    const h = window.innerHeight;
    let anyOut = false;
    const screen = cars.map((car, i) => {
      const ndc = rig.toNDC(car.position);
      const inside = rig.isInSafeZone(car.position);
      const px = ((ndc.x + 1) / 2) * w;
      const py = ((1 - ndc.y) / 2) * h;
      const remaining = tracker.remaining(i);
      const outside = car.alive && !inside;
      anyOut ||= outside;

      const marker = this.markers[i];
      marker.classList.toggle('out', outside);
      marker.classList.toggle('hidden', !car.alive);
      marker.style.transform = `translate(${clamp(px, 12, w - 12)}px, ${clamp(py, 12, h - 12)}px)`;
      marker.querySelector('.label').textContent = !car.alive
        ? `${car.player.short} ELIMINATED`
        : outside
          ? `${car.player.short} OUTSIDE ${remaining != null ? remaining.toFixed(1) + 's' : ''}`
          : `${car.player.short} INSIDE`;
      return { ndc, px, py, inside };
    });
    this.safe.classList.toggle('danger', anyOut);

    // Panel de texto
    const f = (n, d = 1) => n.toFixed(d).padStart(6);
    const lines = [];
    cars.forEach((car, i) => {
      lines.push(
        `${car.player.short}`,
        `  Position: ${f(car.position.x)} / ${f(car.position.z)}   Y ${f(car.position.y)}`,
        `  Speed:    ${f(car.speed)}  (fwd ${f(car.forwardSpeed)})`,
        `  State:    ${car.state}${car.fall ? '  FALLING' : car.grounded ? '' : '  AIR'}   falls ${car.falls}`,
      );
    });
    lines.push(
      'CAMERA',
      `  Distance:        ${f(rig.distance)}`,
      `  Target Distance: ${f(rig.targetDistance)}${rig.atMaxDistance ? '  ← MAX' : ''}`,
      `  Required:        ${f(rig.requiredDistance)}`,
      `  Min / Max:       ${f(CAM.minDistance)} / ${f(CAM.maxDistance)}`,
      'PLAYERS',
      `  Distance: ${f(cars[0].position.distanceTo(cars[1].position))}`,
    );
    screen.forEach((s, i) => {
      lines.push(`  ${cars[i].player.short} Screen: ${f(s.ndc.x, 2)} / ${f(s.ndc.y, 2)} ndc  (${Math.round(s.px)}, ${Math.round(s.py)}) px`);
    });
    screen.forEach((s, i) => {
      lines.push(`  ${cars[i].player.short} Screen State: ${s.inside ? 'INSIDE' : 'OUTSIDE'}`);
    });
    const cd = cars.map((c, i) => {
      const r = tracker.remaining(i);
      return `${c.player.short} ${c.alive && r != null ? r.toFixed(2) + 's' : '-'}`;
    });
    lines.push(`  Countdown: ${cd.join('   ')}`, 'POWER-UPS');
    cars.forEach((c) => lines.push(`  ${c.player.short} ITEM: ${powerups.inventory(c).item?.id ?? 'EMPTY'}`));
    lines.push(
      `  ITEM BOXES: ${powerups.activeBoxes} / ${powerups.boxes.length}`,
      `  ACTIVE EFFECTS: ${powerups.effects.count}   WORLD OBJECTS: ${powerups.entities.length}`,
    );
    cars.forEach((c) => {
      const list = powerups.effects.list(c);
      lines.push(`  ${c.player.short} EFFECTS:${list.length ? '' : ' -'}`);
      for (const e of list) lines.push(`    - ${e.label} ${e.remaining.toFixed(1)}s`);
    });
    lines.push('', '[V] debug  [R] reiniciar');
    this.panel.textContent = lines.join('\n');
  }
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
