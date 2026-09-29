import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GAME_CONFIG } from '../config.js';

const M = GAME_CONFIG.vehicle.model;
const PAINT_NAME = /paint|body|carpaint|car_paint|exterior|coat|lack|pintura|chassis/i;
const NOT_PAINT = /glass|window|vidrio|light|lamp|chrome|tire|tyre|rubber|wheel|rim|interior|seat|plate|logo|badge|black|mirror/i;

/**
 * Carga el modelo 3D del auto una sola vez y lo deja listo para clonar:
 *  - escalado al largo del auto del juego y apoyado en el piso (y = 0);
 *  - orientado con el frente hacia +Z (la convención de Car.js);
 *  - con el material de la carrocería identificado para poder pintarlo.
 * Devuelve null si no se pudo cargar (el juego sigue con el auto hecho con primitivas).
 */
export async function loadCarModel(url) {
  let gltf;
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  } catch (e) {
    console.warn('[auto] no se pudo cargar el modelo, se usa el auto de primitivas:', e);
    return null;
  }
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // Orientación: el eje horizontal más largo es el largo del auto → lo llevamos a Z
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.add(root);
  if (size.x > size.z) root.rotation.y = Math.PI / 2;
  root.rotation.y += M.yawOffset; // corrección manual si el frente queda al revés
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

  const named = [...stats.keys()].filter((m) => PAINT_NAME.test(m.name || '') && !NOT_PAINT.test(m.name || ''));
  let paint = named.sort((x, y) => stats.get(y).area - stats.get(x).area)[0];
  if (!paint) {
    // Sin nombres útiles: el material claro, opaco y no metálico-espejo con más superficie
    paint = [...stats.keys()]
      .filter((m) => !m.transparent && !NOT_PAINT.test(m.name || '') && m.color && lum(m.color) > 0.45)
      .sort((x, y) => stats.get(y).area - stats.get(x).area)[0];
  }

  for (const m of stats.keys()) tuneMaterial(m);

  if (import.meta.env.DEV) {
    console.info(`[auto] modelo cargado: ${Math.round(triangles)} triángulos, ${stats.size} materiales, escala ${scale.toFixed(4)}`);
    console.table([...stats].map(([m, s]) => ({ material: m.name, color: m.color?.getHexString(), area: s.area.toFixed(2), meshes: s.meshes, transparente: m.transparent, pintura: m === paint })));
  }
  return { scene: pivot, paint, triangles };
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
 * El modelo trae todos los materiales sin metal ni brillo (se ven de plástico).
 * Se ajustan por nombre (los nombres del archivo están en portugués).
 */
const MATERIAL_TUNING = [
  [/Espelho/i, { color: '#dfe3ea', metalness: 1, roughness: 0.05 }], // espejos
  [/Cromado|Roda/i, { metalness: 1, roughness: 0.2 }], // cromados y llantas
  [/Vidros_Vermelhos|Refletor_Lanterna/i, { emissive: '#ff1a1a', emissiveIntensity: 1.2 }], // luces traseras
  [/Vidros/i, { color: '#0b0f16', metalness: 0.6, roughness: 0.04, opacity: 0.65 }], // vidrios
  [/Farol/i, { metalness: 0.9, roughness: 0.15 }], // reflectores de los faros
  [/Laranja/i, { emissive: '#ff7a00', emissiveIntensity: 0.4 }], // giros
  [/Freio/i, { metalness: 0.7, roughness: 0.35 }], // frenos
  [/Pneu/i, { roughness: 0.92 }], // neumáticos
  [/Plastico|Preto|Interno/i, { roughness: 0.65 }], // plásticos y tapizado
];

function tuneMaterial(m) {
  const rule = MATERIAL_TUNING.find(([re]) => re.test(m.name || ''));
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
