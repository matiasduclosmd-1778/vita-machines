import * as THREE from 'three';
import { LM } from './livingMaterials.js';

/**
 * Persona estilizada (en la línea de los retratos de los pilotos), armada con articulaciones para
 * ponerla en pose y animarla. Medidas en unidades del juego (1 u ≈ 3 cm): ~58 u de alto.
 *
 * Jerarquía: root (cadera) → spine → chest → neck → head
 *                                    chest → shoulderL/R → elbow → wrist (mano)
 *            root → hipL/R → knee → ankle (pie)
 * Las rotaciones en x flexionan (negativo = hacia adelante en hombros y caderas).
 */
const SEG = 20;

/** Cápsula afinada que cuelga desde su articulación (y = 0) hasta -len. */
function limbGeometry(len, rTop, rBottom) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * rBottom, -len - Math.cos(a) * rBottom * 0.9));
  }
  for (let i = 6; i >= 0; i--) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * rTop, Math.cos(a) * rTop * 0.9));
  }
  return new THREE.LatheGeometry(pts, SEG);
}

/** Torso por perfil (radio según la altura), aplanado de adelante hacia atrás. */
function torsoGeometry(profile, depth = 0.62) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  g.scale(1, 1, depth);
  return g;
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/**
 * opts: { skin, hair: 'curly' | 'short', hairColor, top: 'tee' | 'bomber', topColor, print?,
 *         bottom: 'track' | 'jeans', bottomColor, shoes: color }
 */
export function makeHuman(opts) {
  const skin = new THREE.MeshStandardMaterial({ color: opts.skin, roughness: 0.6, envMapIntensity: 0.4 });
  const hairMat = new THREE.MeshStandardMaterial({ color: opts.hairColor ?? '#21160f', roughness: 0.85 });
  const top = opts.top === 'bomber' ? LM.fleece(opts.topColor) : LM.jersey(opts.topColor);
  const bottom = opts.bottom === 'jeans' ? LM.fleece(opts.bottomColor) : LM.jersey(opts.bottomColor);
  const shoeMat = new THREE.MeshStandardMaterial({ color: opts.shoes ?? '#f4f4f0', roughness: 0.55 });
  const sole = new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1412', roughness: 0.4 });
  const long = opts.top === 'bomber';

  const root = new THREE.Group();
  const J = { root };

  // ---- cadera y tronco
  mesh(torsoGeometry([[0.01, -3.5], [5.6, -3.2], [6.3, -0.5], [6.0, 2.5], [0.01, 3]], 0.7), bottom, root);
  J.spine = joint(root, 0, 2.2, 0);
  J.chest = joint(J.spine, 0, 0, 0);
  // Torso: cintura, pecho y hombros (la remera o la campera)
  mesh(torsoGeometry([[0.01, -0.5], [5.7, -0.2], [5.9, 4], [6.9, 9.5], [7.2, 13], [6.2, 16], [3, 17.4], [0.01, 17.6]], 0.6), top, J.chest);
  if (long) {
    // Bomber: cuello y cintura de punto, cierre
    const rib = LM.fleece('#2a2b31');
    mesh(new THREE.TorusGeometry(3.1, 0.75, 10, 24).rotateX(Math.PI / 2).scale(1, 1, 0.75), rib, J.chest, 0, 17, 0);
    mesh(new THREE.TorusGeometry(5.9, 0.8, 10, 28).rotateX(Math.PI / 2).scale(1, 1, 0.62), rib, J.chest, 0, 0.4, 0);
    mesh(new THREE.BoxGeometry(0.35, 15, 0.3), new THREE.MeshStandardMaterial({ color: '#8d9099', metalness: 0.8, roughness: 0.35 }), J.chest, 0, 8.5, 4.35);
  } else if (opts.print) {
    // Estampado de la remera
    const print = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 6.2), new THREE.MeshStandardMaterial({ map: opts.print, transparent: true, roughness: 0.8 }));
    print.position.set(0, 10.5, 4.42);
    print.rotation.x = -0.08;
    J.chest.add(print);
  }

  // ---- cuello y cabeza
  J.neck = joint(J.chest, 0, 17, 0.2);
  mesh(limbGeometry(2.6, 1.9, 2.1).rotateX(Math.PI), skin, J.neck, 0, 0, 0);
  J.head = joint(J.neck, 0, 2.6, 0.3);
  const skull = mesh(new THREE.SphereGeometry(3.9, 32, 24), skin, J.head, 0, 4.2, 0);
  skull.scale.set(0.92, 1.06, 1);
  mesh(new THREE.SphereGeometry(2.9, 24, 16), skin, J.head, 0, 2.4, 1.0).scale.set(0.95, 0.85, 1); // mandíbula
  mesh(new THREE.SphereGeometry(1, 12, 10), skin, J.head, 3.45, 3.9, 0).scale.set(0.45, 1, 0.75); // orejas
  mesh(new THREE.SphereGeometry(1, 12, 10), skin, J.head, -3.45, 3.9, 0).scale.set(0.45, 1, 0.75);
  mesh(new THREE.SphereGeometry(0.62, 12, 10), skin, J.head, 0, 3.6, 3.85).scale.set(0.8, 1, 1.1); // nariz
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.58, 14, 10), white, J.head, side * 1.35, 4.55, 3.25).scale.set(1, 0.8, 0.6);
    mesh(new THREE.SphereGeometry(0.3, 10, 8), dark, J.head, side * 1.35, 4.5, 3.6);
    const brow = mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), hairMat, J.head, side * 1.4, 5.5, 3.45);
    brow.rotation.z = Math.PI / 2 + side * 0.12;
  }
  mesh(new THREE.CapsuleGeometry(0.2, 1.1, 4, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#9c5a4a', roughness: 0.6 }), J.head, 0, 2.35, 3.55); // boca
  if (opts.hair === 'curly') {
    // Rulos: muchos bucles chicos sobre la parte de arriba y atrás de la cabeza
    const curl = new THREE.IcosahedronGeometry(1.15, 1);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = rnd() * 1.25; // desde arriba hacia los costados
      if (Math.cos(theta) > 0.55 && phi > 0.75) continue; // la frente queda despejada
      const r = 3.9 + rnd() * 0.5;
      const m = mesh(curl, hairMat, J.head, Math.sin(phi) * Math.sin(theta) * r * 0.95, 4.4 + Math.cos(phi) * r, Math.sin(phi) * Math.cos(theta) * r - 0.3);
      m.scale.setScalar(0.85 + rnd() * 0.5);
      m.rotation.set(rnd() * 3, rnd() * 3, 0);
    }
  } else {
    // Corto: casquete con la línea del pelo marcada
    // Media esfera inclinada hacia atrás: el borde de adelante queda ~3 u sobre el centro (arriba de
    // las cejas) y el de atrás, ~3 u por debajo (la nuca)
    const shortHair = new THREE.MeshStandardMaterial({ color: opts.hairColor ?? '#21160f', map: hairTexture(), bumpMap: hairTexture(), bumpScale: 0.6, roughness: 0.75 });
    const cap = mesh(new THREE.SphereGeometry(4.0, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.5), shortHair, J.head, 0, 4.25, -0.18);
    cap.scale.set(0.95, 1.07, 1.03);
    cap.rotation.set(-0.85, Math.PI, 0); // la costura de la textura queda en la nuca
    // Barba corta
    const beard = mesh(new THREE.SphereGeometry(3.0, 24, 16, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: '#2a1b14', roughness: 0.95, transparent: true, opacity: 0.55 }), J.head, 0, 2.5, 1.05);
    beard.scale.set(0.98, 0.88, 1.03);
  }

  // ---- brazos
  for (const side of [-1, 1]) {
    const sh = (J[side < 0 ? 'shoulderR' : 'shoulderL'] = joint(J.chest, side * 6.6, 14.6, 0));
    mesh(new THREE.SphereGeometry(2.05, 16, 12), top, sh, -side * 0.35, 0.1, 0); // hombro (metido en el torso)
    mesh(limbGeometry(9.6, 2.3, 1.9), long ? top : top, sh); // brazo (manga)
    if (!long) mesh(limbGeometry(4.6, 2.55, 2.45), top, sh); // manga corta
    const el = (J[side < 0 ? 'elbowR' : 'elbowL'] = joint(sh, 0, -9.6, 0));
    mesh(limbGeometry(8.6, 1.85, 1.45), long ? top : skin, el); // antebrazo
    if (long) mesh(new THREE.TorusGeometry(1.3, 0.32, 8, 16).rotateX(Math.PI / 2), LM.fleece('#2a2b31'), el, 0, -8.4, 0); // puño
    const wr = (J[side < 0 ? 'wristR' : 'wristL'] = joint(el, 0, -8.8, 0));
    // Mano: palma, dedos y pulgar
    const palm = mesh(new THREE.BoxGeometry(2.6, 2.9, 1.1, 2, 2, 2), skin, wr, 0, -1.5, 0);
    rounded(palm.geometry, 0.5);
    const fingers = mesh(new THREE.BoxGeometry(2.5, 2.4, 0.95, 2, 2, 2), skin, wr, 0, -3.9, 0.12);
    rounded(fingers.geometry, 0.45);
    fingers.rotation.x = 0.35;
    const thumb = mesh(new THREE.CapsuleGeometry(0.42, 1.4, 4, 8), skin, wr, side * -1.45, -1.9, 0.5);
    thumb.rotation.z = side * 0.6;
  }

  // ---- piernas
  for (const side of [-1, 1]) {
    const hip = (J[side < 0 ? 'hipR' : 'hipL'] = joint(root, side * 3.2, -0.8, 0));
    mesh(limbGeometry(14.6, 3.2, 2.35), bottom, hip);
    const kn = (J[side < 0 ? 'kneeR' : 'kneeL'] = joint(hip, 0, -14.6, 0));
    mesh(limbGeometry(13.4, 2.3, 1.7), bottom, kn);
    if (opts.bottom === 'track') {
      // Dos franjas blancas al costado del pantalón deportivo
      for (const [len, r, parent] of [[14.6, 3.25, hip], [13.4, 2.35, kn]]) {
        for (const k of [-0.32, 0.32]) {
          const st = mesh(new THREE.BoxGeometry(0.28, len, 0.32), white, parent, side * (r - 0.05), -len / 2, k);
          st.rotation.z = side * -0.05;
        }
      }
    }
    const an = (J[side < 0 ? 'ankleR' : 'ankleL'] = joint(kn, 0, -13.6, 0));
    // Zapatilla: capellada, suela y puntera redondeada
    const upper = mesh(new THREE.BoxGeometry(3.3, 2.6, 8.4, 3, 2, 4), shoeMat, an, 0, -1.6, 1.9);
    rounded(upper.geometry, 1.1);
    const s = mesh(new THREE.BoxGeometry(3.5, 0.8, 8.8, 2, 1, 4), sole, an, 0, -2.95, 1.9);
    rounded(s.geometry, 0.35);
  }

  return { group: root, joints: J };
}

/** Redondea una caja subdividida empujando sus vértices hacia una caja de esquinas redondas. */
function rounded(geo, radius) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const hx = (b.max.x - b.min.x) / 2 - radius;
  const hy = (b.max.y - b.min.y) / 2 - radius;
  const hz = (b.max.z - b.min.z) / 2 - radius;
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    v.sub(c).setLength(radius).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Pose: { joint: [x, y, z] } en radianes. */
export function pose(J, p) {
  for (const [name, [x = 0, y = 0, z = 0]] of Object.entries(p)) J[name]?.rotation.set(x, y, z);
}

const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Cinemática inversa de dos huesos (brazo o pierna): orienta `upper` (hombro / cadera) y `lower`
 * (codo / rodilla) para que la punta (muñeca / tobillo) llegue a `target`. `pole` indica hacia dónde
 * dobla la articulación del medio (el codo hacia atrás, la rodilla hacia adelante). Coordenadas de mundo.
 * Los huesos cuelgan en -y desde su articulación; a y b son sus largos.
 */
export function reach(upper, lower, a, b, target, pole) {
  upper.parent.updateWorldMatrix(true, false);
  upper.getWorldPosition(_s);
  _d.subVectors(target, _s);
  const d = Math.min(Math.max(_d.length(), Math.abs(a - b) + 0.01), a + b - 0.01);
  _d.normalize();
  // Codo / rodilla: en el plano de (hombro, punta, polo), a la distancia justa de los dos
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _p.subVectors(pole, _s);
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();
  _e.copy(_s).addScaledVector(_d, cosA * a).addScaledVector(_p, sinA * a);
  // Hueso de arriba hacia el codo (en el espacio de su padre)
  const parentInv = upper.parent.getWorldQuaternion(_q).invert();
  const dirUpper = _e.clone().sub(_s).normalize().applyQuaternion(parentInv);
  upper.quaternion.setFromUnitVectors(DOWN, dirUpper);
  // Hueso de abajo hacia la punta (en el espacio del hueso de arriba)
  upper.updateWorldMatrix(false, false);
  const upperInv = upper.getWorldQuaternion(new THREE.Quaternion()).invert();
  const dirLower = target.clone().sub(_e).normalize().applyQuaternion(upperInv);
  lower.quaternion.setFromUnitVectors(DOWN, dirLower);
}

/** Largos de los huesos (para reach). */
export const BONES = { arm: [9.6, 8.8], leg: [14.6, 13.6] };

/** Pelo corto: mechones finos claros y oscuros (se lee como pelo y no como un gorro liso). */
let hairTex = null;
function hairTexture() {
  if (hairTex) return hairTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const v = rnd() < 0.5 ? 40 + rnd() * 50 : 140 + rnd() * 90;
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 2, y + 3 + rnd() * 4);
    ctx.stroke();
  }
  hairTex = new THREE.CanvasTexture(c);
  hairTex.wrapS = hairTex.wrapT = THREE.RepeatWrapping;
  hairTex.repeat.set(3, 2);
  return hairTex;
}
