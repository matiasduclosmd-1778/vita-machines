import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { POWERUP_CONFIG } from '../config.js';
import { glass } from '../world/materials.js';

const BOX = POWERUP_CONFIG.itemBoxes;
let sharedMaterials = null;

/** Caja flotante que entrega un power-up al tocarla y reaparece después de un tiempo. */
export class ItemBox {
  constructor(scene, x, y, z, phase) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.phase = phase;
    this.respawnTimer = 0;

    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.cube = new THREE.Mesh(new RoundedBoxGeometry(1.25, 1.25, 1.25, 3, 0.18), materials());
    this.cube.castShadow = true;
    // Cáscara de vidrio: refracta el cubo de colores y la pista detrás
    this.frame = new THREE.Mesh(new RoundedBoxGeometry(1.85, 1.85, 1.85, 4, 0.35), glass('#eaf6ff', { thickness: 0.6, roughness: 0.02, ior: 1.5 }));
    this.cube.add(this.frame);
    // Sombra falsa en el piso para que se lea la altura
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.group.add(this.cube, this.shadow);
    scene.add(this.group);
  }

  get active() {
    return this.respawnTimer <= 0;
  }

  collect() {
    this.respawnTimer = BOX.respawnTime;
    this.group.visible = false;
  }

  reset() {
    this.respawnTimer = 0;
    this.group.visible = true;
  }

  update(dt, time) {
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.group.visible = true;
        this.spawnAnim = 0;
      }
      return;
    }
    // Reaparición: crece desde cero
    if (this.spawnAnim != null) {
      this.spawnAnim = Math.min(1, this.spawnAnim + dt * 3);
      const k = this.spawnAnim;
      this.cube.scale.setScalar(k < 1 ? k * (1.3 - 0.3 * k) : 1);
      if (k >= 1) this.spawnAnim = null;
    }
    const t = time + this.phase;
    this.cube.position.y = 1.3 + Math.sin(t * 2.2) * 0.22;
    this.cube.rotation.set(0.35, t * 1.3, 0.2);
    this.frame.rotation.y = -t * 0.8;
    this.shadow.scale.setScalar(1 - Math.sin(t * 2.2) * 0.1);
  }
}

function materials() {
  if (sharedMaterials) return sharedMaterials;
  const colors = ['#ff4d6d', '#ffbe0b', '#3a86ff', '#8338ec', '#06d6a0', '#fb5607'];
  sharedMaterials = colors.map((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 118, 118);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 90px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, emissive: c, emissiveIntensity: 0.55 });
  });
  return sharedMaterials;
}
