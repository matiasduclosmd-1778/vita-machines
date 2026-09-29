import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GAME_CONFIG } from '../config.js';
import {
  PALETTE, asphaltTexture, sidewalkTexture, bookStackTexture, kerbTexture, hazardTexture,
  chevronTexture, rulerTexture, signTexture, canvasTexture,
} from '../world/textures.js';
import { chrome, glow, paintedMetal, plastic } from '../world/materials.js';

const TRACK = GAME_CONFIG.track;
const CURB = 0.35; // altura del cordón de la vereda
const RULER_THICKNESS = 0.4;

const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...opts });

/** Construye todos los meshes de la pista a partir de sus datos (no toca la lógica). */
export function buildTrackVisuals(track, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };
  const P = track.path;
  const hw = P.halfWidth;
  const SW = TRACK.sidewalkWidth;
  const deskTop = track.deskTop;
  const sideOffset = (i, side) => {
    const wall = side > 0 ? P.wallLeft[i] : P.wallRight[i];
    return wall ? hw + SW : hw;
  };
  const sideTop = (i, side) => P.height[i] + ((side > 0 ? P.wallLeft[i] : P.wallRight[i]) ? CURB : 0);

  // ---------------------------------------------------------------- calzada
  const roadMat = std({ map: asphaltTexture(), roughness: 0.92 });
  for (const run of runs(P, (i) => !P.gap[i])) {
    add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, hw, P.height[i]), (i) => edge(P, i, -hw, P.height[i]), (i, s, a) => [a ? 1 : 0, s / 24]), roadMat), { cast: false });
  }

  // ---------------------------------------------------------------- laterales (pilas de libros)
  const books = bookStackTexture();
  const bookMat = std({ map: books, roughness: 0.85 });
  for (const side of [1, -1]) {
    for (const run of runs(P, (i) => !P.gap[i])) {
      const geo = strip(
        P, run,
        (i) => edge(P, i, side * sideOffset(i, side), sideTop(i, side)),
        (i) => edge(P, i, side * sideOffset(i, side), deskTop),
        (i, s, a) => [s / 16, a ? deskTop / 8 : sideTop(i, side) / 8],
        side > 0,
      );
      add(new THREE.Mesh(geo, bookMat));
    }
  }
  // Caras del hueco del salto (se ve el corte de la pila de libros)
  for (let i = 0; i < P.count; i++) {
    const j = (i + 1) % P.count;
    if (P.gap[i] === P.gap[j]) continue;
    const k = P.gap[i] ? j : i; // muestra con piso junto al hueco
    const a = edge(P, k, hw, P.height[k]);
    const b = edge(P, k, -hw, P.height[k]);
    const geo = quad(a, b, { ...b, y: deskTop }, { ...a, y: deskTop }, [0, P.height[k] / 8], [2 * hw / 16, deskTop / 8]);
    const cap = add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: books, side: THREE.DoubleSide, roughness: 0.85 })));
    cap.userData.gapCap = true;
  }

  // ---------------------------------------------------------------- veredas y cordones
  const walkMat = std({ map: sidewalkTexture(), roughness: 0.9 });
  const curbMat = std({ color: PALETTE.curb, roughness: 0.7 });
  for (const side of [1, -1]) {
    const walls = side > 0 ? P.wallLeft : P.wallRight;
    for (const run of runs(P, (i) => walls[i] && !P.gap[i])) {
      add(new THREE.Mesh(strip(
        P, run,
        (i) => edge(P, i, side * hw, P.height[i] + CURB),
        (i) => edge(P, i, side * (hw + SW), P.height[i] + CURB),
        (i, s, a) => [a ? 1 : 0, s / 2.6],
        side > 0,
      ), walkMat), { cast: false });
      add(new THREE.Mesh(strip(
        P, run,
        (i) => edge(P, i, side * hw, P.height[i]),
        (i) => edge(P, i, side * hw, P.height[i] + CURB),
        (i, s, a) => [s, a ? 1 : 0],
        side > 0,
      ), curbMat));
    }
  }

  // ---------------------------------------------------------------- franjas de peligro (sin barrera)
  const kerbMat = std({ map: kerbTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const side of [1, -1]) {
    const walls = side > 0 ? P.wallLeft : P.wallRight;
    for (const run of runs(P, (i) => !walls[i] && !P.gap[i])) {
      add(new THREE.Mesh(strip(
        P, run,
        (i) => edge(P, i, side * hw, P.height[i] + 0.02),
        (i) => edge(P, i, side * (hw - 1), P.height[i] + 0.02),
        (i, s, a) => [a ? 1 : 0, s / 3],
        side < 0,
      ), kerbMat), { cast: false });
    }
  }

  // ---------------------------------------------------------------- salto: rampa rayada y flechas de velocidad
  const { s0, dJump } = track.jumpInfo;
  const kickStart = s0 + dJump - TRACK.jump.kickerLength;
  const hazardMat = std({ map: hazardTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const kickerRun = runs(P, (i) => {
    const d = P.forward(kickStart, P.cum[i]);
    return d <= TRACK.jump.kickerLength && !P.gap[i];
  });
  for (const run of kickerRun) {
    add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, hw - 1, P.height[i] + 0.03), (i) => edge(P, i, -(hw - 1), P.height[i] + 0.03), (i, s, a) => [a ? 3 : 0, s / 4]), hazardMat), { cast: false });
  }
  // Borde de aterrizaje rayado
  const landS = s0 + track.jumpInfo.dGapEnd;
  for (const run of runs(P, (i) => { const d = P.forward(landS, P.cum[i]); return d <= 1.5 && !P.gap[i]; })) {
    add(new THREE.Mesh(strip(P, run, (i) => edge(P, i, hw, P.height[i] + 0.03), (i) => edge(P, i, -hw, P.height[i] + 0.03), (i, s, a) => [a ? 3 : 0, s / 4]), hazardMat), { cast: false });
  }
  const chevronMat = new THREE.MeshStandardMaterial({ map: chevronTexture(), transparent: true, roughness: 0.7, depthWrite: false });
  for (let k = 1; k <= 4; k++) {
    const p = P.pointAt(kickStart - k * 7);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), chevronMat);
    m.rotation.set(-Math.PI / 2, p.heading + Math.PI, 0, 'YXZ');
    m.position.set(p.x, p.y + 0.04, p.z);
    add(m, { cast: false });
  }

  // ---------------------------------------------------------------- línea de largada
  const checker = canvasTexture('checker', 128, 32, (ctx, w, h) => {
    const q = h / 2;
    for (let x = 0; x < w / q; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#1d1d22' : '#f7f4ec';
      ctx.fillRect(x * q, y * q, q, q);
    }
  }, { nearest: true });
  {
    const p = P.pointAt(track.startS);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.8), std({ map: checker, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.set(-Math.PI / 2, p.heading, 0, 'YXZ');
    line.position.set(p.x, p.y + 0.03, p.z);
    add(line, { cast: false });
    // Mástiles con banderas a cuadros a los costados (no tapan a los autos con la cámara de atrás)
    const poleMat = chrome('#e6e9ee');
    const flagMat = new THREE.MeshPhysicalMaterial({ map: checker, roughness: 0.5, side: THREE.DoubleSide, sheen: 1, sheenColor: '#ffffff' });
    const nx = Math.cos(p.heading);
    const nz = -Math.sin(p.heading);
    for (const side of [1, -1]) {
      const bx = p.x + nx * (hw + 1.3) * side;
      const bz = p.z + nz * (hw + 1.3) * side;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 7, 24), poleMat);
      pole.position.set(bx, p.y + 3.5, bz);
      add(pole);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 12), poleMat);
      ball.position.set(bx, p.y + 7.1, bz);
      add(ball);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8, 8, 1), flagMat);
      // Ondulación simple de la tela
      const pos = flag.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin((pos.getX(k) + 1.5) * 2.2) * 0.18 * ((pos.getX(k) + 1.5) / 3));
      flag.geometry.computeVertexNormals();
      flag.position.set(bx + nx * 1.5 * side, p.y + 6.1, bz + nz * 1.5 * side);
      flag.rotation.y = p.heading; // la tela se extiende hacia afuera de la pista
      add(flag);
    }
  }

  // ---------------------------------------------------------------- faroles y arbustos en las veredas
  buildStreetProps(track, add);

  // ---------------------------------------------------------------- carteles de advertencia
  const signs = [
    ...track.cliffRanges.map((c) => ({ s: c.s - 6, side: c.side === 'right' ? 1 : -1, symbol: '!' })),
    { s: s0 + TRACK.elevated.rampLength - 14, side: 1, symbol: '!' },
    { s: kickStart - 34, side: 1, symbol: '▲' },
    ...track.shortcutJoins.slice(0, 1).map((j) => ({ s: j.s - 14, side: j.side === 'left' ? -1 : 1, symbol: '!' })),
  ];
  for (const sg of signs) buildSign(P, sg, add);

  // ---------------------------------------------------------------- atajo: regla de madera elevada
  buildShortcut(track, add);

  // ---------------------------------------------------------------- obstáculos
  buildObstacles(track, add);

  return group;
}

// ======================================================================= helpers de geometría

/** Punto sobre el borde: desplazado `offset` a la izquierda de la línea central, a altura y. */
function edge(path, i, offset, y) {
  const p = path.points[i];
  const n = path.normals[i];
  return { x: p.x + n.x * offset, y, z: p.z + n.z * offset };
}

/**
 * Tramos contiguos de muestras que cumplen pred. Cada tramo es una lista de índices;
 * en circuitos cerrados completos, el último repite el primero para cerrar el anillo.
 */
function runs(path, pred) {
  const n = path.count;
  const segOk = (i) => pred(i % n) && pred((i + 1) % n) && (path.closed || i + 1 < n);
  const result = [];
  const segs = path.closed ? n : n - 1;
  // Empezar en un segmento que no esté ok para no partir un tramo que cruza el índice 0
  let startAt = 0;
  if (path.closed) {
    while (startAt < n && segOk(startAt)) startAt++;
    if (startAt === n) return [[...Array(n + 1).keys()].map((k) => k % n)];
  }
  let cur = null;
  for (let k = 0; k < segs; k++) {
    const i = (startAt + k) % n;
    if (segOk(i)) {
      if (!cur) cur = [i];
      cur.push((i + 1) % n);
    } else if (cur) {
      result.push(cur);
      cur = null;
    }
  }
  if (cur) result.push(cur);
  return result;
}

/**
 * Franja entre dos bordes a lo largo de un tramo.
 * uv(i, s, isB) → [u, v]; flip invierte la orientación de las caras.
 */
function strip(path, run, edgeA, edgeB, uv, flip = false) {
  const pos = [];
  const uvs = [];
  const idx = [];
  let s = path.cum[run[0]];
  run.forEach((i, k) => {
    if (k > 0) {
      const prev = run[k - 1];
      s += path.segLen[Math.min(prev, path.segCount - 1)];
    }
    const a = edgeA(i);
    const b = edgeB(i);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(...uv(i, s, false), ...uv(i, s, true));
    if (k > 0) {
      const o = (k - 1) * 2;
      // Normal de la cara = (B − A) × avance; flip la invierte
      if (flip) idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      else idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function quad(a, b, c, d, uvA, uvC) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([uvA[0], uvA[1], uvC[0], uvA[1], uvC[0], uvC[1], uvA[0], uvC[1]], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

// ======================================================================= objetos

function buildStreetProps(track, add) {
  const P = track.path;
  const hw = P.halfWidth;
  const SW = TRACK.sidewalkWidth;
  const lamps = [];
  const bushes = [];
  for (let s = 8; s < P.length; s += TRACK.lampSpacing / 2) {
    const i = P.indexAt(s);
    const isLamp = Math.round(s / (TRACK.lampSpacing / 2)) % 2 === 0;
    for (const side of [1, -1]) {
      const walls = side > 0 ? P.wallLeft : P.wallRight;
      // solo en tramos con vereda en varias muestras alrededor
      let ok = true;
      for (let d = -4; d <= 4; d++) if (!walls[(i + d + P.count) % P.count] || P.gap[(i + d + P.count) % P.count]) ok = false;
      if (!ok) continue;
      const p = edge(P, i, side * (hw + SW - 0.6), P.height[i] + CURB);
      if (isLamp && side === (Math.round(s / TRACK.lampSpacing) % 2 ? 1 : -1)) lamps.push({ ...p, heading: Math.atan2(P.segDir[Math.min(i, P.segCount - 1)].x, P.segDir[Math.min(i, P.segCount - 1)].z), side });
      else if (!isLamp && (i * 7 + (side > 0 ? 3 : 0)) % 3 === 0) bushes.push(p);
    }
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  // Faroles: poste, brazo y farol con luz cálida
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.18, 4.4, 12);
  const headGeo = new THREE.SphereGeometry(0.42, 20, 12);
  const poles = new THREE.InstancedMesh(poleGeo, paintedMetal('#2f3a3a'), lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, glow('#ffd98a', 3.2), lamps.length);
  lamps.forEach((l, k) => {
    m4.compose(new THREE.Vector3(l.x, l.y + 2.2, l.z), q.identity(), one);
    poles.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(l.x, l.y + 4.6, l.z), q.identity(), one);
    heads.setMatrixAt(k, m4);
  });
  add(poles);
  add(heads, { cast: false });

  // Arbustos estilizados (low-poly)
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const bushMesh = new THREE.InstancedMesh(bushGeo, std({ color: PALETTE.green, flatShading: true, roughness: 0.9 }), bushes.length * 2);
  let k = 0;
  bushes.forEach((b, n) => {
    for (let c = 0; c < 2; c++) {
      const sc = 0.7 + ((n * 13 + c * 7) % 5) * 0.12;
      q.setFromEuler(new THREE.Euler(n, c * 2, 0));
      m4.compose(new THREE.Vector3(b.x + (c ? 0.5 : -0.4), b.y + 0.55 * sc, b.z + (c ? -0.4 : 0.3)), q, new THREE.Vector3(sc, sc, sc));
      bushMesh.setMatrixAt(k++, m4);
    }
  });
  add(bushMesh);
}

function buildSign(P, { s, side, symbol }, add) {
  const p = P.pointAt(s);
  const i = P.indexAt(s);
  const walls = side > 0 ? P.wallLeft : P.wallRight;
  const off = side * (P.halfWidth + (walls[i] ? 1.2 : 1.6));
  const nx = Math.cos(p.heading);
  const nz = -Math.sin(p.heading);
  const base = { x: p.x + nx * off, y: p.y + (walls[i] ? CURB : 0), z: p.z + nz * off };
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 12), paintedMetal('#3a3f47'));
  pole.position.set(base.x, base.y + 1.7, base.z);
  add(pole);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: signTexture(symbol), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }));
  board.position.set(base.x, base.y + 3.6, base.z);
  board.rotation.y = p.heading + Math.PI; // mirando hacia los autos que llegan
  add(board);
}

function buildShortcut(track, add) {
  const S = track.shortcut;
  const main = track.path;
  const hw = S.halfWidth;
  // Solo se dibuja la parte que sale de la pista principal
  const outside = (i) => main.project(S.points[i].x, S.points[i].z).dist > main.halfWidth - 0.5;
  const rulerTex = rulerTexture();
  // Regla barnizada: refleja el cielo al mirarla en ángulo
  const topMat = new THREE.MeshPhysicalMaterial({ map: rulerTex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  const sideMat = new THREE.MeshPhysicalMaterial({ color: '#d9b865', roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  for (const run of runs(S, outside)) {
    add(new THREE.Mesh(strip(S, run, (i) => edge(S, i, hw, S.height[i] + 0.01), (i) => edge(S, i, -hw, S.height[i] + 0.01), (i, s, a) => [a ? 1 : 0, s / 10]), topMat));
    add(new THREE.Mesh(strip(S, run, (i) => edge(S, i, -hw, S.height[i] - RULER_THICKNESS), (i) => edge(S, i, hw, S.height[i] - RULER_THICKNESS), (i, s, a) => [a ? 1 : 0, s / 10]), sideMat));
    for (const side of [1, -1]) {
      add(new THREE.Mesh(strip(
        S, run,
        (i) => edge(S, i, side * hw, S.height[i] + 0.01),
        (i) => edge(S, i, side * hw, S.height[i] - RULER_THICKNESS),
        (i, s, a) => [s, a ? 1 : 0],
        side > 0,
      ), sideMat));
    }
  }
  // Pilares: pequeñas pilas de libros debajo de la parte alta de la regla
  const covers = [PALETTE.teal, PALETTE.terracotta, PALETTE.navy, PALETTE.mustard];
  const maxH = Math.max(...S.height);
  let n = 0;
  for (let s = 0; s < S.length; s += 22) {
    const p = S.pointAt(s);
    if (p.y < maxH - 0.01) continue;
    const top = p.y - RULER_THICKNESS;
    const levels = 3;
    const lh = (top - track.deskTop) / levels;
    for (let l = 0; l < levels; l++) {
      const book = new THREE.Mesh(new RoundedBoxGeometry(hw * 1.8, lh, 3.2, 2, 0.15), plastic(covers[(n + l) % covers.length], 0.6));
      book.position.set(p.x, track.deskTop + lh * (l + 0.5), p.z);
      book.rotation.y = p.heading + (l - 1) * 0.12;
      add(book);
    }
    n++;
  }
}

function buildObstacles(track, add) {
  const drumColors = [PALETTE.terracotta, PALETTE.teal, '#8c5a9e'];
  track.obstacles.forEach((o, i) => {
    const g = new THREE.Group();
    if (o.type === 'drum') {
      // Carretel de hilo
      const body = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.78, o.r * 0.78, 1.6, 32), std({ color: drumColors[i % 3], roughness: 0.9 }));
      body.position.y = 0.8;
      const rimGeo = new THREE.CylinderGeometry(o.r, o.r, 0.24, 32);
      const rimMat = new THREE.MeshPhysicalMaterial({ color: '#e9d2a4', roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.15 });
      const top = new THREE.Mesh(rimGeo, rimMat);
      top.position.y = 1.62;
      const bottom = new THREE.Mesh(rimGeo, rimMat);
      bottom.position.y = 0.12;
      g.add(body, top, bottom);
    } else if (o.type === 'cone') {
      const orange = plastic('#ff7a1a', 0.35);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(o.r, 1.6, 32), orange);
      cone.position.y = 0.8;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.52, o.r * 0.62, 0.22, 32), plastic('#ffffff', 0.3));
      stripe.position.y = 0.85;
      const base = new THREE.Mesh(new RoundedBoxGeometry(o.r * 2.2, 0.14, o.r * 2.2, 2, 0.05), orange);
      base.position.y = 0.07;
      g.add(cone, stripe, base);
    } else {
      const block = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.8, 1.8, 3, 0.2), plastic(PALETTE.navy));
      block.position.y = 0.9;
      g.add(block);
    }
    g.traverse((m) => {
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    g.position.set(o.x, o.y, o.z);
    g.rotation.y = o.heading + 0.4;
    add(g);
  });
}
