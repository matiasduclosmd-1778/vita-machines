import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GAME_CONFIG } from '../config.js';

const M = GAME_CONFIG.vehicle.model;
const PAINT_NAME = /paint|body|carpaint|car_paint|exterior|coat|lack|pintura|chassis/i;
const NOT_PAINT = /glass|window|vidrio|light|lamp|chrome|tire|tyre|rubber|wheel|rim|interior|seat|plate|logo|badge|black|mirror/i;

/**
 * Carga el modelo 3D de un auto una sola vez y lo deja listo para clonar:
 *  - escalado al largo del auto del juego y apoyado en el piso (y = 0);
 *  - orientado con el frente hacia +Z (la convención de Car.js);
 *  - con el material de la carrocería identificado para poder pintarlo.
 * `spec` es su entrada en GAME_CONFIG.cars ({ id, paint, yawOffset, materials }).
 * Devuelve null si no se pudo cargar (el juego sigue con el auto hecho con primitivas).
 */
export async function loadCarModel(url, spec = {}) {
  let gltf;
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  } catch (e) {
    console.warn(`[auto] no se pudo cargar ${spec.id ?? url}, se usa el auto de primitivas:`, e);
    return null;
  }
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  bakeSkinnedMeshes(root);

  // Orientación: el eje horizontal más largo es el largo del auto → lo llevamos a Z
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.add(root);
  if (size.x > size.z) root.rotation.y = Math.PI / 2;
  root.rotation.y += spec.yawOffset ?? 0; // corrección manual si el frente queda al revés
  pivot.updateMatrixWorld(true);

  // Escala y apoyo en el piso, centrado
  box = new THREE.Box3().setFromObject(pivot);
  size = box.getSize(new THREE.Vector3());
  const scale = M.length / size.z;
  root.scale.multiplyScalar(scale);
  pivot.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(pivot);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  pivot.updateMatrixWorld(true);

  // Materiales: superficie por material para encontrar la carrocería
  const stats = new Map();
  const triArea = (geo, matrix) => {
    const pos = geo.attributes.position;
    const idx = geo.index;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let area = 0;
    const count = idx ? idx.count : pos.count;
    const step = Math.max(3, Math.floor(count / 3 / 4000) * 3); // muestreo en modelos muy densos
    for (let i = 0; i + 2 < count; i += step) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
      b.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
      c.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    return area * (step / 3);
  };
  let triangles = 0;
  pivot.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const s = stats.get(m) || { area: 0, meshes: 0 };
      s.area += triArea(o.geometry, o.matrixWorld) / mats.length;
      s.meshes++;
      stats.set(m, s);
    }
  });

  // Carrocería: la indicada en la configuración; si no, se adivina por nombre y superficie
  const named = [...stats.keys()].filter((m) => PAINT_NAME.test(m.name || '') && !NOT_PAINT.test(m.name || ''));
  let paint = [...stats.keys()].find((m) => m.name === spec.paint);
  paint ??= named.sort((x, y) => stats.get(y).area - stats.get(x).area)[0];
  if (!paint) {
    // Sin nombres útiles: el material claro, opaco y no metálico-espejo con más superficie
    paint = [...stats.keys()]
      .filter((m) => !m.transparent && !NOT_PAINT.test(m.name || '') && m.color && lum(m.color) > 0.45)
      .sort((x, y) => stats.get(y).area - stats.get(x).area)[0];
  }

  for (const m of stats.keys()) tuneMaterial(m, spec.materials ?? []);

  if (import.meta.env.DEV) {
    console.info(`[auto] ${spec.id ?? 'modelo'} cargado: ${Math.round(triangles)} triángulos, ${stats.size} materiales, escala ${scale.toFixed(4)}`);
    console.table([...stats].map(([m, s]) => ({ material: m.name, color: m.color?.getHexString(), area: s.area.toFixed(2), meshes: s.meshes, transparente: m.transparent, pintura: m === paint })));
  }
  return { id: spec.id, scene: pivot, paint, triangles };
}

/** Pintura de auto metalizada con barniz (azul medianoche, rojo, etc.). */
export function carPaint(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.6,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
}

/** Clona el modelo con la carrocería pintada de `color`. */
export function instantiateCar(model, color) {
  const clone = model.scene.clone(true);
  const paint = carPaint(color);
  clone.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material = o.material.map((m) => (m === model.paint ? paint : m));
    else if (o.material === model.paint) o.material = paint;
  });
  return { object: clone, paint };
}

/**
 * Algunos modelos vienen riggeados (cada pieza ubicada por un hueso). Un SkinnedMesh clonado pierde
 * sus huesos y no se dibuja, y además el auto no necesita animarse: se hornea la pose actual
 * en una malla común (posiciones y normales ya transformadas por los huesos).
 */
function bakeSkinnedMeshes(root) {
  const skinned = [];
  root.traverse((o) => o.isSkinnedMesh && skinned.push(o));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (const sm of skinned) {
    const src = sm.geometry;
    const pos = src.attributes.position;
    const nor = src.attributes.normal;
    const outPos = new Float32Array(pos.count * 3);
    const outNor = nor ? new Float32Array(pos.count * 3) : null;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      if (nor) q.copy(p).add(n.fromBufferAttribute(nor, i)); // la normal se transforma como diferencia de dos puntos
      sm.applyBoneTransform(i, p);
      p.toArray(outPos, i * 3);
      if (nor) {
        sm.applyBoneTransform(i, q);
        q.sub(p).normalize().toArray(outNor, i * 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'skinIndex' && name !== 'skinWeight') geo.setAttribute(name, attr);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    if (outNor) geo.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
    geo.setIndex(src.index);
    for (const g of src.groups) geo.addGroup(g.start, g.count, g.materialIndex);

    const mesh = new THREE.Mesh(geo, sm.material);
    mesh.name = sm.name;
    mesh.position.copy(sm.position);
    mesh.quaternion.copy(sm.quaternion);
    mesh.scale.copy(sm.scale);
    sm.parent.add(mesh);
    sm.parent.remove(sm);
  }
  // Los huesos quedan como grupos vacíos (no molestan); se actualizan las matrices de lo nuevo
  root.updateMatrixWorld(true);
}

/** Ajusta un material según la primera regla de `rules` ([regex del nombre, propiedades]) que coincida. */
function tuneMaterial(m, rules) {
  const rule = rules.find(([re]) => re.test(m.name || ''));
  if (!rule) return;
  const props = rule[1];
  for (const [k, v] of Object.entries(props)) {
    if (m[k]?.isColor) m[k].set(v);
    else m[k] = v;
  }
  m.needsUpdate = true;
}

function lum(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
