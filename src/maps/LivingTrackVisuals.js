import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { asphaltTexture, kerbTexture, hazardTexture, canvasTexture } from '../world/textures.js';
import { plastic, paintedMetal, chrome } from '../world/materials.js';
import { edge, runs, strip, quad } from '../track/TrackVisuals.js';
import { LIVING } from './living.js';
import { LM } from './livingMaterials.js';

const RAIL = 1; // altura de la barandita
const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...opts });

/**
 * Pista de juguete del living: losa de asfalto con cordones rojo y blanco, barandita donde hay
 * pared, columnas debajo de los tramos elevados, huecos cortados, atajo, largada y obstáculos.
 * Usa el medio ancho de cada muestra (tramos angostos).
 */
export function buildLivingTrack(track, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = cast;
        m.receiveShadow = receive;
      }
    });
    group.add(mesh);
    return mesh;
  };
  const slab = track.def.slabThickness;
  const mats = {
    road: std({ map: asphaltTexture(), roughness: 0.9 }),
    side: std({ color: '#26282e', roughness: 0.7 }),
    kerb: std({ map: kerbTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    rail: std({ map: kerbTexture(), roughness: 0.5 }),
    hazard: std({ map: hazardTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  for (const path of track.paths) buildRoad(track, path, add, mats, slab, path !== track.path);
  buildSupports(track, add, slab);
  if (track.loop) buildLoop(track.loop, add, mats, slab);
  buildTakeoffStripes(track, add, mats);
  buildStart(track, add);
  buildObstacles(track, add);
  return group;
}

/** Calzada, costados de la losa, cordones, barandas y cortes de los huecos de un camino. */
function buildRoad(track, P, add, mats, slab, isShortcut) {
  // El atajo solo se dibuja donde sale del principal
  const main = track.path;
  const visible = isShortcut ? (i) => main.project(P.points[i].x, P.points[i].z).dist > main.hw[main.project(P.points[i].x, P.points[i].z).i] - 0.5 : () => true;
  const ok = (i) => !P.gap[i] && visible(i);
  const hw = (i) => P.hw[i];

  for (const run of runs(P, ok)) {
    add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, hw(i), P.height[i]), (i) => edge(P, i, -hw(i), P.height[i]), (i, s, a) => [a ? 1 : 0, s / 24]), mats.road), { cast: false });
    // Costados y panza de la losa
    for (const side of [1, -1]) {
      add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, side * hw(i), P.height[i]), (i) => edge(P, i, side * hw(i), P.height[i] - slab), (i, s, a) => [s, a ? 1 : 0], side > 0), mats.side));
    }
    add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, -hw(i), P.height[i] - slab), (i) => edge(P, i, hw(i), P.height[i] - slab), (i, s, a) => [a ? 1 : 0, s / 24]), mats.side), { cast: false });
    // Cordones en los dos bordes
    for (const side of [1, -1]) {
      add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, side * hw(i), P.height[i] + 0.02), (i) => edge(P, i, side * (hw(i) - 0.9), P.height[i] + 0.02), (i, s, a) => [a ? 1 : 0, s / 3], side < 0), mats.kerb), { cast: false });
    }
  }
  // Barandita donde hay pared
  for (const side of [1, -1]) {
    const walls = side > 0 ? P.wallLeft : P.wallRight;
    for (const run of runs(P, (i) => walls[i] && ok(i))) {
      add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, side * (hw(i) + 0.3), P.height[i]), (i) => edge(P, i, side * (hw(i) + 0.3), P.height[i] + RAIL), (i, s, a) => [s / 2, a ? 1 : 0], side < 0), mats.rail));
      add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, side * (hw(i) + 0.3), P.height[i] + RAIL), (i) => edge(P, i, side * (hw(i) + 0.7), P.height[i] + RAIL), (i, s, a) => [a ? 1 : 0, s / 2], side < 0), mats.rail));
    }
  }
  // Cortes de los huecos: se ve la losa partida
  for (let i = 0; i < P.count - (P.closed ? 0 : 1); i++) {
    const j = (i + 1) % P.count;
    if (P.gap[i] === P.gap[j] || !visible(i)) continue;
    const k = P.gap[i] ? j : i;
    const a = edge(P, k, hw(k), P.height[k]);
    const b = edge(P, k, -hw(k), P.height[k]);
    add(new THREE.Mesh(quad(a, b, { ...b, y: P.height[k] - slab }, { ...a, y: P.height[k] - slab }, [0, 0], [1, 1]), new THREE.MeshStandardMaterial({ color: '#3a3c44', side: THREE.DoubleSide })));
  }
}

/**
 * El loop: una cinta de pista que da la vuelta (el asfalto mira al centro), con cordones,
 * barandas rojas por fuera y torres amarillas que lo sostienen, como el de juguete.
 */
function buildLoop(L, add, mats, slab) {
  const N = 144;
  const hw = L.halfWidth;
  const off0 = -L.shift / 2;
  const P = (a, side, inward) => {
    const c = L.pointAt(a, off0 + side);
    // Normal hacia el centro del aro
    const nx = -L.fx * Math.sin(a);
    const ny = Math.cos(a);
    const nz = -L.fz * Math.sin(a);
    return [c.x + nx * inward, c.y + ny * inward, c.z + nz * inward];
  };
  const ribbon = (sideA, inA, sideB, inB, mat, uvScale = 24, vSpan = 1) => {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pos.push(...P(a, sideA, inA), ...P(a, sideB, inB));
      const s = (a * L.R) / uvScale;
      uv.push(0, s, vSpan, s);
      if (i) {
        const o = (i - 1) * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = mat.clone();
    m.side = THREE.DoubleSide;
    const mesh = add(new THREE.Mesh(geo, m));
    if (m.transparent) mesh.castShadow = false;
    return mesh;
  };
  const lift = 0.06; // apenas por encima de la pista donde apoya
  // Aro de acrílico rojo traslúcido (como el de juguete): con la cámara de atrás y arriba, uno
  // opaco taparía al auto boca abajo
  const acrylic = new THREE.MeshPhysicalMaterial({
    color: '#ff4a3d', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  ribbon(hw, lift, -hw, lift, acrylic).renderOrder = 2; // calzada (mira al centro)
  for (const side of [1, -1]) {
    ribbon(side * (hw + 0.3), lift + 1.2, side * (hw + 0.3), -0.5, mats.rail, 2); // baranda roja (sólida)
  }
  // Torres amarillas a los costados, a media altura del aro, y la base
  const yellow = plastic('#f2b705', 0.4);
  const y0 = L.base.y - slab;
  for (const side of [1, -1]) {
    const lat = off0 + L.shift / 2 + side * (hw + 4.6); // por fuera de la baranda de la pista
    const x = L.base.x + L.lx * lat;
    const z = L.base.z + L.lz * lat;
    const h = L.R + 2;
    const tower = new THREE.Mesh(new RoundedBoxGeometry(2.6, h, 3.4, 2, 0.4), yellow);
    tower.position.set(x, y0 + h / 2, z);
    tower.rotation.y = L.heading;
    add(tower);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.8, 12), yellow);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = L.heading;
    arm.position.set(x - L.lx * side * 2.3, L.base.y + L.R, z - L.lz * side * 2.3);
    add(arm);
  }
  const plate = new THREE.Mesh(new RoundedBoxGeometry((hw + 5) * 2, 0.8, L.R * 2.2, 2, 0.3), yellow);
  plate.position.set(L.base.x + L.lx * (off0 + L.shift / 2), y0 + 0.2, L.base.z + L.lz * (off0 + L.shift / 2));
  plate.rotation.y = L.heading;
  add(plate, { cast: false });
}

/** ¿(x, z) cae sobre el mueble, con `margin` de más alrededor? */
function insideSurface(sf, x, z, margin = 0) {
  return sf.box
    ? x >= sf.box[0] - margin && x <= sf.box[2] + margin && z >= sf.box[1] - margin && z <= sf.box[3] + margin
    : (x - sf.circle[0]) ** 2 + (z - sf.circle[1]) ** 2 <= (sf.circle[2] + margin) ** 2;
}

/**
 * Dónde apoya una columna que baja desde `bottom` en (x, z): el mueble o el piso que tiene debajo.
 * null = no se pone: pasaría por adentro o pegada al costado de un mueble (el mantel que cae, un
 * almohadón abultado).
 */
function postBase(track, x, z, bottom) {
  let h = track.floorY;
  for (const sf of track.surfaces) {
    if (insideSurface(sf, x, z) && sf.top <= bottom + 0.3) h = Math.max(h, sf.top);
  }
  for (const sf of track.surfaces) {
    if (sf.top > h + 1 && sf.top < bottom + 0.3 && insideSurface(sf, x, z, 4)) return null;
    if (sf.top >= bottom + 0.3 && insideSurface(sf, x, z, 4)) return null; // el mueble llega hasta la pista
  }
  return h;
}

/** Columnas rojas de juguete debajo de los tramos que van en el aire. */
function buildSupports(track, add, slab) {
  const posts = [];
  for (const P of track.paths) {
    const step = 11;
    for (let s = 4; s < P.length; s += step) {
      const i = P.indexAt(s);
      if (P.gap[i]) continue;
      const p = P.pointAt(s);
      for (const side of [1, -1]) {
        const off = side * (P.hw[i] - 1.2);
        const x = p.x + Math.cos(p.heading) * off;
        const z = p.z - Math.sin(p.heading) * off;
        const bottom = p.y - slab;
        const ground = postBase(track, x, z, bottom);
        if (ground == null || bottom - ground < 2.5) continue;
        posts.push({ x, z, y0: ground, y1: bottom });
      }
    }
  }
  if (!posts.length) return;
  const geo = new THREE.BoxGeometry(1.4, 1, 1.4);
  const mesh = new THREE.InstancedMesh(geo, plastic('#c8231b', 0.45), posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach((p, k) => {
    m4.makeScale(1, p.y1 - p.y0, 1).setPosition(p.x, (p.y0 + p.y1) / 2, p.z);
    mesh.setMatrixAt(k, m4);
  });
  add(mesh);
}

/** Franja rayada en el último tramo antes de cada hueco: "acá se salta". */
function buildTakeoffStripes(track, add, mats) {
  const P = track.path;
  for (const g of track.gaps ?? []) {
    if (g.length < 3) continue; // las ranuras del sillón no se marcan
    const from = g.s - 4;
    const run = runs(P, (i) => {
      const d = P.forward(from, P.cum[i]);
      return d <= 4 && !P.gap[i];
    });
    for (const r of run) add(new THREE.Mesh(strip(P, r, (i) => edge(P, i, P.hw[i] - 0.9, P.height[i] + 0.03), (i) => edge(P, i, -(P.hw[i] - 0.9), P.height[i] + 0.03), (i, s, a) => [a ? 3 : 0, s / 4]), mats.hazard), { cast: false });
  }
}

/** Línea de largada y el arco "VITA MACHINES". */
function buildStart(track, add) {
  const P = track.path;
  const p = P.pointAt(track.startS);
  const hw = P.halfWidth;
  const checker = canvasTexture('checker', 128, 32, (ctx, w, h) => {
    const q = h / 2;
    for (let x = 0; x < w / q; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#1d1d22' : '#f7f4ec';
      ctx.fillRect(x * q, y * q, q, q);
    }
  }, { nearest: true });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.8), std({ map: checker, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.rotation.set(-Math.PI / 2, p.heading, 0, 'YXZ');
  line.position.set(p.x, p.y + 0.03, p.z);
  add(line, { cast: false });

  // Arco: dos columnas y un cartel arriba (detrás de la línea, mirando a los que llegan)
  const a = P.pointAt(track.sOf(LIVING.arch));
  const nx = Math.cos(a.heading);
  const nz = -Math.sin(a.heading);
  const blue = paintedMetal('#1f3fa8');
  const H = 15;
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(2, H, 2, 2, 0.3), blue);
    post.position.set(a.x + nx * (hw + 2) * side, a.y + H / 2, a.z + nz * (hw + 2) * side);
    add(post);
  }
  const banner = canvasTexture('vm-banner', 512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#1f3fa8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffc93c';
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, h - 8, w, 8);
    ctx.font = 'italic 900 58px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#111318';
    ctx.strokeText('VITA MACHINES', w / 2, h / 2 + 2);
    ctx.fillStyle = '#fff4dc';
    ctx.fillText('VITA MACHINES', w / 2, h / 2 + 2);
  }, { repeat: false });
  const sign = new THREE.Mesh(new RoundedBoxGeometry((hw + 3) * 2, 4.4, 1, 2, 0.3), [blue, blue, blue, blue, std({ map: banner, roughness: 0.5 }), std({ map: banner, roughness: 0.5 })]);
  sign.position.set(a.x, a.y + H - 1, a.z);
  sign.rotation.y = a.heading + Math.PI;
  add(sign);
}

/** Obstáculos del living, con su forma y material reales (escala del juguete: 1 u ≈ 3 cm). */
function buildObstacles(track, add) {
  const metal = (color, rough = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: rough });
  const plasticM = (color, rough = 0.35) => new THREE.MeshStandardMaterial({ color, roughness: rough, envMapIntensity: 1 });
  for (const o of track.obstacles) {
    const g = new THREE.Group();
    switch (o.type) {
      case 'can': {
        // Lata de gaseosa: cuerpo con etiqueta, hombros afinados y tapa de aluminio
        const prof = [[0, 0], [o.r * 0.8, 0], [o.r * 0.95, 0.25], [o.r * 0.95, 3.2], [o.r * 0.78, 3.7], [o.r * 0.72, 3.8], [0, 3.8]];
        const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 32), new THREE.MeshStandardMaterial({ map: canLabel(), metalness: 0.6, roughness: 0.3 }));
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.7, o.r * 0.7, 0.05, 24), metal('#cfd3d8'));
        lid.position.y = 3.82;
        g.add(body, lid);
        break;
      }
      case 'pad': {
        // Joystick: cuerpo con dos empuñaduras, palancas y botones
        const black = plasticM('#16171b', 0.4);
        const body = new THREE.Mesh(new RoundedBoxGeometry(4.2, 0.9, 2.2, 3, 0.4), black);
        body.position.y = 0.6;
        g.add(body);
        for (const side of [-1, 1]) {
          const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 1.4, 4, 12), black);
          grip.rotation.x = Math.PI / 2 + 0.5;
          grip.rotation.z = side * 0.35;
          grip.position.set(side * 1.6, 0.55, 1.1);
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.35, 16), plasticM('#2a2c31', 0.6));
          stick.position.set(side * 0.9, 1.15, 0.35);
          g.add(grip, stick);
        }
        ['#3fbf6a', '#e2463f', '#3f7fe2', '#e8c33f'].forEach((c, k) => {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), plasticM(c, 0.2));
          b.position.set(1.5 + Math.cos(k * 1.57) * 0.33, 1.08, -0.35 + Math.sin(k * 1.57) * 0.33);
          g.add(b);
        });
        break;
      }
      case 'pillow': {
        // Almohadoncito mullido de bouclé (abultado en el centro)
        const geo = new RoundedBoxGeometry(o.r * 2.4, 3, o.r * 2.1, 6, 1.4);
        const pos = geo.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const x = pos.getX(k) / (o.r * 1.2);
          const z = pos.getZ(k) / (o.r * 1.05);
          pos.setY(k, pos.getY(k) * (1 + 0.45 * (1 - x * x) * (1 - z * z)));
        }
        geo.computeVertexNormals();
        const p = new THREE.Mesh(geo, LM.boucle('#efe2c4'));
        p.position.y = 1.5;
        p.rotation.set(0.1, 0.5, 0.08);
        g.add(p);
        break;
      }
      case 'tire':
        for (let k = 0; k < 3; k++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.7, o.r * 0.32, 14, 28), new THREE.MeshStandardMaterial({ color: '#141417', roughness: 0.85, normalMap: tireTread(), normalScale: new THREE.Vector2(0.6, 0.6) }));
          t.rotation.x = Math.PI / 2;
          t.position.y = 0.42 + k * 0.82;
          t.rotation.z = k * 0.4;
          g.add(t);
        }
        break;
      case 'shoe': {
        // Zapatilla blanca suelta: capellada, suela, cordones
        const upper = new THREE.Mesh(new RoundedBoxGeometry(o.r * 1.15, 2.2, o.r * 2.5, 4, 0.9), new THREE.MeshStandardMaterial({ color: '#f5f4f0', roughness: 0.55 }));
        upper.position.y = 1.5;
        const sole = new THREE.Mesh(new RoundedBoxGeometry(o.r * 1.25, 0.6, o.r * 2.65, 2, 0.25), new THREE.MeshStandardMaterial({ color: '#d4d1c9', roughness: 0.8 }));
        sole.position.y = 0.3;
        g.add(upper, sole);
        for (let k = 0; k < 4; k++) {
          const lace = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, o.r * 0.8, 6), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
          lace.rotation.z = Math.PI / 2;
          lace.position.set(0, 2.62, 0.2 + k * 0.55);
          g.add(lace);
        }
        break;
      }
      case 'mug': {
        // Taza de cerámica con café
        const cer = new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.25 });
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 0.9, 3.4, 32, 1, true), cer);
        cup.material.side = THREE.DoubleSide;
        cup.position.y = 1.7;
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(o.r * 0.9, 24).rotateX(-Math.PI / 2), cer);
        bottom.position.y = 0.02;
        const coffee = new THREE.Mesh(new THREE.CircleGeometry(o.r * 0.95, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a2214', roughness: 0.1 }));
        coffee.position.y = 2.9;
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.22, 10, 20, Math.PI * 1.3), cer);
        handle.rotation.z = -Math.PI * 0.65;
        handle.position.set(o.r + 0.3, 1.8, 0);
        g.add(cup, bottom, coffee, handle);
        break;
      }
      case 'flag': {
        // Banderín a cuadros sobre una base (el de la referencia)
        const base = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.1, 0.4, 24), metal('#1d1e22', 0.4));
        base.position.y = 0.2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.5, 8), metal('#c9ccd2'));
        pole.position.y = 3.4;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4, 8, 1), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.7 }));
        const pos = cloth.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin((pos.getX(k) + 1.8) * 1.8) * 0.25);
        cloth.geometry.computeVertexNormals();
        cloth.position.set(1.8, 5.4, 0);
        g.add(base, pole, cloth);
        break;
      }
      case 'toycar': {
        // El autito rojo que empuja la mano: carrocería, cabina vidriada y ruedas
        const red = new THREE.MeshStandardMaterial({ color: '#d42a20', roughness: 0.25, metalness: 0.2 });
        const body = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.9, 1.4, 3, 0.35), red);
        body.position.y = 0.75;
        const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.7, 1.2, 3, 0.3), new THREE.MeshStandardMaterial({ color: '#1d2a3a', roughness: 0.1, metalness: 0.5 }));
        cabin.position.set(-0.15, 1.45, 0);
        g.add(body, cabin);
        for (const [x, z] of [[-0.85, 0.7], [0.85, 0.7], [-0.85, -0.7], [0.85, -0.7]]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 }));
          w.rotation.x = Math.PI / 2;
          w.position.set(x, 0.38, z);
          g.add(w);
        }
        g.scale.setScalar(1.15);
        o.mesh = g; // lo mueve Track.updateMovers
        break;
      }
      case 'arm': {
        const a = new THREE.Mesh(new THREE.CapsuleGeometry(o.r * 0.8, 9, 4, 12), new THREE.MeshStandardMaterial({ color: '#1d1e22', roughness: 0.9 }));
        a.rotation.x = Math.PI / 2;
        a.position.y = 1.4;
        g.add(a);
        break;
      }
      default: {
        // Cono de obra con franja reflectiva y base
        const orange = plasticM('#ff6a14', 0.35);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(o.r, 1.9, 32), orange);
        cone.position.y = 1.05;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.48, o.r * 0.6, 0.3, 32), plasticM('#ffffff', 0.2));
        band.position.y = 1.05;
        const base = new THREE.Mesh(new RoundedBoxGeometry(o.r * 2.3, 0.18, o.r * 2.3, 2, 0.06), orange);
        base.position.y = 0.09;
        g.add(cone, band, base);
      }
    }
    g.traverse((m) => {
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    g.position.set(o.x, o.y, o.z);
    if (o.type !== 'toycar') g.rotation.y = o.heading + 0.4;
    add(g);
  }
}

function canLabel() {
  return canvasTexture('living-can', 256, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a8f3f');
    g.addColorStop(1, '#1b6a2d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d7dadf';
    ctx.fillRect(0, 0, w, 10);
    ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 34px sans-serif';
    ctx.fillText('LIMA', 20, 76);
    ctx.fillStyle = '#f2d14b';
    ctx.beginPath();
    ctx.arc(196, 64, 22, 0, Math.PI * 2);
    ctx.fill();
  });
}

function flagTexture() {
  return canvasTexture('living-flag', 96, 64, (ctx, w, h) => {
    const q = 16;
    for (let x = 0; x < w / q; x++) for (let y = 0; y < h / q; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#161618' : '#f6f4ee';
      ctx.fillRect(x * q, y * q, q, q);
    }
  }, { repeat: false });
}

function tireTread() {
  return canvasTexture('living-tread', 64, 64, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(128,60,255)';
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 3, h);
  });
}
