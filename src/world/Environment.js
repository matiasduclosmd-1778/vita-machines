import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GAME_CONFIG } from '../config.js';
import { PALETTE, deskTexture, floorTexture, rugTexture } from './textures.js';
import { ceramic, chrome, liquid, plastic, varnishedWood } from './materials.js';

const TRACK = GAME_CONFIG.track;
const GFX = GAME_CONFIG.graphics;
const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.75, ...opts });

export const SKY_COLOR = '#ecd9c2';

/**
 * Mundo alrededor de la pista: un escritorio enorme en una habitación con luz de tarde.
 * Todo es decorativo salvo la altura del escritorio y del piso (los usa Track.groundAt).
 */
export class Environment {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.placed = [];

    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.Fog(SKY_COLOR, 170, 470);
    this.setupLights();
    this.buildDesk();
    this.buildFloor();
    this.buildDeskProps();
    this.buildFloorProps();
  }

  setupLights() {
    // Luz de tarde: sol cálido y bajo (sombras largas) + relleno frío del cielo
    // El mapa de entorno ya aporta luz ambiente: el hemisférico queda como relleno suave
    this.scene.add(new THREE.HemisphereLight('#cfe0ff', '#b98d62', 0.55));
    const sun = new THREE.DirectionalLight('#ffd6a0', 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.radius = GFX.shadowSoftness;
    const s = sun.shadow.camera;
    s.left = s.bottom = -110;
    s.right = s.top = 110;
    s.near = 1;
    s.far = 400;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    this.sunOffset = new THREE.Vector3(-80, 95, 55);
    this.sun = sun;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#9fc2ff', 0.45);
    fill.position.set(60, 40, -80);
    this.scene.add(fill);
  }

  /**
   * Iluminación basada en imagen: un "cielo" de tarde generado en tiempo real, con una
   * ventana luminosa del lado del sol. Los materiales reflejan este entorno.
   */
  buildEnvMap(renderer) {
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(100, 48, 24);
    const colors = [];
    const top = new THREE.Color('#b9d2ff').multiplyScalar(1.1);
    const horizon = new THREE.Color('#ffe0bd').multiplyScalar(1.3);
    const bottom = new THREE.Color('#a57a55').multiplyScalar(0.6);
    const pos = geo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 100;
      if (y > 0) c.copy(horizon).lerp(top, Math.pow(y, 0.6));
      else c.copy(horizon).lerp(bottom, Math.pow(-y, 0.5));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    // Ventana cálida (el sol) y un panel frío opuesto: reflejos definidos en superficies brillantes
    const panel = (w, h, color, strength, dir) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }),
      );
      m.position.copy(dir).normalize().multiplyScalar(80);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(50, 34, '#fff0d8', 2.6, this.sunOffset);
    panel(60, 20, '#cfe2ff', 1.6, new THREE.Vector3(70, 35, -60));
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = GFX.envIntensity;
    pmrem.dispose();
  }

  /** La sombra sigue a la cámara para tener buena resolución donde se juega. */
  follow(focus) {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
  }

  add(mesh, { cast = true, receive = true } = {}) {
    mesh.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = cast;
        m.receiveShadow = receive;
      }
    });
    this.group.add(mesh);
    return mesh;
  }

  buildDesk() {
    const d = TRACK.desk;
    const w = d.maxX - d.minX;
    const depth = d.maxZ - d.minZ;
    const tex = deskTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 60, depth / 60);
    const top = new THREE.Mesh(new RoundedBoxGeometry(w, d.thickness, depth, 3, 1.2), varnishedWood(tex));
    top.position.set((d.minX + d.maxX) / 2, this.track.deskTop - d.thickness / 2, (d.minZ + d.maxZ) / 2);
    this.add(top, { cast: false });
    const legH = this.track.deskTop - d.thickness - TRACK.floorY;
    const legMat = varnishedWood(null, '#a8764a');
    for (const [x, z] of [[d.minX + 14, d.minZ + 14], [d.maxX - 14, d.minZ + 14], [d.minX + 14, d.maxZ - 14], [d.maxX - 14, d.maxZ - 14]]) {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(10, legH, 10, 2, 1), legMat);
      leg.position.set(x, TRACK.floorY + legH / 2, z);
      this.add(leg);
    }
  }

  buildFloor() {
    const tex = floorTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(60, 60);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), std({ map: tex, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = TRACK.floorY;
    this.add(floor, { cast: false });
    const rug = new THREE.Mesh(new THREE.CircleGeometry(95, 64), std({ map: rugTexture(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(215, TRACK.floorY + 0.1, -10);
    this.add(rug, { cast: false });
  }

  // ------------------------------------------------------------------ props

  /** ¿Hay lugar para un objeto de radio r en (x, z) sin invadir la pista? */
  isClear(x, z, r) {
    for (const path of this.track.paths) {
      const q = path.project(x, z);
      if (q.dist < path.halfWidth + TRACK.sidewalkWidth + r + 2) return false;
    }
    return !this.placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2);
  }

  /** Coloca un objeto en el primer lugar libre de la lista de candidatos. */
  place(candidates, r, build, onFloor = false) {
    for (const [x, z, rot = 0] of candidates) {
      if (!onFloor && !this.isClear(x, z, r)) continue;
      const obj = build();
      obj.position.set(x, onFloor ? TRACK.floorY : this.track.deskTop, z);
      obj.rotation.y = rot;
      this.add(obj);
      this.placed.push({ x, z, r });
      return obj;
    }
    return null;
  }

  buildDeskProps() {
    // Taza gigante
    this.place([[40, 5], [55, 20], [20, -20]], 13, () => mug(11, 19));
    // Pilas de libros
    this.place([[-25, -42], [-10, -50], [-30, -35]], 14, () => bookStack(3, 1.2));
    this.place([[95, -35], [90, -25], [100, 0]], 11, () => bookStack(2, 1.3));
    // Planta en maceta (árbol estilizado, como los de la referencia)
    this.place([[-5, 45], [0, 40], [10, 50]], 12, () => plant());
    this.place([[-150, 100], [-145, 108], [-140, -110]], 9, () => plant(0.8));
    // Lápices, goma, bloques, pelota y hojas de papel
    this.place([[70, -15, 0.4], [60, -30, 0.2], [80, 0, 0.9]], 10, () => pencil(24, PALETTE.mustard));
    this.place([[-35, -8, 1.2], [-40, -15, 1.4]], 8, () => pencil(20, PALETTE.teal));
    this.place([[112, -8, 0.3], [110, 5, 0.3]], 6, () => eraser());
    this.place([[-145, -40], [-150, -20], [-150, 20]], 7, () => ball(6));
    this.place([[25, -60, 0.3], [15, -55, 0.2]], 5, () => toyBlock(6, PALETTE.red));
    this.place([[-55, -60, 0.8], [-50, -40, 0.6]], 5, () => toyBlock(5, PALETTE.mustard));
    this.place([[-40, 118, 0.1], [0, 115, 0.1]], 5, () => toyBlock(5, PALETTE.teal));
    this.place([[-150, 60, 0.4], [-150, 70]], 8, () => paper(14, 18));
    this.place([[65, 35, -0.3], [75, 30, -0.3]], 9, () => paper(12, 16));
  }

  buildFloorProps() {
    // Visibles al asomarse por el precipicio: el mundo continúa abajo
    this.place([[205, -40, 0.4]], 0, () => toyBlock(18, PALETTE.red), true);
    this.place([[230, 30, 0.9]], 0, () => toyBlock(14, PALETTE.mustard), true);
    this.place([[190, 60]], 0, () => ball(16), true);
    this.place([[250, -90, 0.2]], 0, () => bookStack(3, 3), true);
  }
}

// ======================================================================= objetos (escala exagerada)

function mug(r, h) {
  const g = new THREE.Group();
  const cer = ceramic(PALETTE.cream);
  const inside = ceramic(PALETTE.cream);
  inside.side = THREE.DoubleSide;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.94, h, 64, 1, true), inside);
  body.position.y = h / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.005, r * 0.985, h * 0.18, 64, 1, true), ceramic(PALETTE.terracotta));
  band.position.y = h * 0.62;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.94, 48), cer);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.05;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 48), liquid('#3a2114'));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = h * 0.82;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.5, 12, 64), cer);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(h * 0.26, 1.3, 16, 32), cer);
  handle.position.set(r + h * 0.16, h * 0.52, 0);
  g.add(body, band, bottom, coffee, rim, handle);
  return g;
}

function bookStack(count, scale) {
  const g = new THREE.Group();
  const covers = [PALETTE.teal, PALETTE.terracotta, PALETTE.navy, PALETTE.mustard, '#8c5a9e'];
  let y = 0;
  for (let i = 0; i < count; i++) {
    const w = (18 - i * 2) * scale;
    const d = (13 - i) * scale;
    const t = (2.6 + (i % 2) * 0.8) * scale;
    const book = new THREE.Group();
    const cover = new THREE.Mesh(new RoundedBoxGeometry(w, t, d, 2, 0.25 * scale), std({ color: covers[(i * 2 + count) % covers.length], roughness: 0.7 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, t * 0.72, d * 0.94), std({ color: PALETTE.cream, roughness: 0.9 }));
    pages.position.x = 0.35 * scale;
    book.add(cover, pages);
    book.position.y = y + t / 2;
    book.rotation.y = (i - 1) * 0.18;
    g.add(book);
    y += t;
  }
  return g;
}

function plant(scale = 1) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(6 * scale, 4.6 * scale, 8 * scale, 40), ceramic(PALETTE.terracotta));
  pot.position.y = 4 * scale;
  const soil = new THREE.Mesh(new THREE.CircleGeometry(5.6 * scale, 24), std({ color: '#5a3b26' }));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 7.6 * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * scale, 0.9 * scale, 10 * scale, 8), std({ color: '#7a5233' }));
  trunk.position.y = 12 * scale;
  g.add(pot, soil, trunk);
  const leafMat = std({ color: PALETTE.green, flatShading: true, roughness: 0.9 });
  const leafDark = std({ color: PALETTE.greenDark, flatShading: true, roughness: 0.9 });
  const blobs = [[0, 19, 0, 5.5], [3.5, 16.5, 2, 4], [-3.8, 17, -1.5, 4.2], [1, 22, -2, 3.8], [-1.5, 21, 3, 3.4]];
  blobs.forEach(([x, y, z, r], i) => {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 1), i % 2 ? leafDark : leafMat);
    b.position.set(x * scale, y * scale, z * scale);
    g.add(b);
  });
  return g;
}

function pencil(len, color) {
  const g = new THREE.Group();
  const r = 1.4;
  const lacquer = plastic(color, 0.3);
  lacquer.flatShading = true;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), lacquer);
  const wood = new THREE.Mesh(new THREE.ConeGeometry(r, 3.2, 6), std({ color: '#efcf9c', flatShading: true }));
  wood.position.y = len / 2 + 1.6;
  const lead = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1, 6), std({ color: '#3a3a40' }));
  lead.position.y = len / 2 + 2.9;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 1.6, 24), chrome());
  ferrule.position.y = -len / 2 - 0.8;
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.8, 12), std({ color: '#f08fa0' }));
  eraser.position.y = -len / 2 - 2.5;
  const p = new THREE.Group();
  p.add(body, wood, lead, ferrule, eraser);
  p.rotation.z = Math.PI / 2;
  p.position.y = r;
  g.add(p);
  return g;
}

function eraser() {
  const g = new THREE.Group();
  const a = new THREE.Mesh(new RoundedBoxGeometry(7, 2.4, 3.6, 3, 0.5), std({ color: '#f08fa0', roughness: 0.9 }));
  a.position.set(-1.8, 1.2, 0);
  const b = new THREE.Mesh(new RoundedBoxGeometry(3.6, 2.4, 3.6, 3, 0.5), std({ color: '#5b8fd9', roughness: 0.9 }));
  b.position.set(3.5, 1.2, 0);
  g.add(a, b);
  return g;
}

function ball(r) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), plastic(PALETTE.red, 0.3));
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(r * 1.001, r * 0.12, 12, 48), plastic(PALETTE.cream, 0.3));
  stripe.rotation.x = Math.PI / 2.4;
  s.add(stripe);
  s.position.y = r;
  g.add(s);
  return g;
}

function toyBlock(size, color) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new RoundedBoxGeometry(size, size, size, 3, size * 0.1), plastic(color));
  b.position.y = size / 2;
  const inset = new THREE.Mesh(new RoundedBoxGeometry(size * 0.62, size * 0.62, size * 1.02, 2, size * 0.06), plastic(PALETTE.cream));
  b.add(inset);
  g.add(b);
  return g;
}

function paper(w, d) {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), std({ color: '#f7f3ea', roughness: 0.95 }));
  sheet.position.y = 0.06;
  g.add(sheet);
  return g;
}
