import * as THREE from 'three';

// Texturas fotográficas del living (Poly Haven, CC0), recomprimidas en public/textures/living/.
// Cada juego tiene color (_diff), relieve (_nor) y rugosidad (_rough). Se cargan en segundo plano:
// el material existe desde el principio (los shaders se compilan en la carga) y la imagen llega después.
const BASE = `${import.meta.env.BASE_URL}textures/living/`;
const loader = new THREE.TextureLoader();
const cache = new Map();

function texture(name, kind) {
  const key = `${name}_${kind}`;
  if (!cache.has(key)) {
    const t = loader.load(`${BASE}${key}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
  }
  return cache.get(key);
}

/**
 * Material con textura fotográfica. `tint` multiplica el color de la foto (así una tela gris toma el
 * color de la referencia sin perder la trama). Las coordenadas de textura van en unidades de mundo
 * (ver worldUV): `scale` = cuántas unidades ocupa una repetición de la foto.
 */
export function photo(name, { tint = '#ffffff', roughness = 1, normal = 1, metalness = 0, env = 1, ...rest } = {}) {
  return new THREE.MeshStandardMaterial({
    map: texture(name, 'diff'),
    normalMap: texture(name, 'nor'),
    normalScale: new THREE.Vector2(normal, normal),
    roughnessMap: texture(name, 'rough'),
    color: tint,
    roughness,
    metalness,
    envMapIntensity: env,
    ...rest,
  });
}

/**
 * Coordenadas de textura en unidades de mundo (proyección por caras, como una caja): la trama
 * tiene el mismo tamaño en todos los muebles, sin estirarse. Se aplica a la geometría ya ubicada.
 */
export function worldUV(geometry, scale, matrix = null) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal ?? (geometry.computeVertexNormals(), geometry.attributes.normal);
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    if (matrix) {
      p.applyMatrix4(matrix);
      n.applyMatrix3(nm).normalize();
    }
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    let u;
    let v;
    if (ay >= ax && ay >= az) [u, v] = [p.x, p.z];
    else if (ax >= az) [u, v] = [p.z, p.y];
    else [u, v] = [p.x, p.y];
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Aplica worldUV a todas las mallas de un objeto ya ubicado en la escena (usa su posición final). */
export function worldUVAll(object, scale) {
  object.updateMatrixWorld(true);
  object.traverse((m) => {
    if (!m.isMesh) return;
    const s = m.userData.uvScale ?? scale;
    if (s) worldUV(m.geometry, s, m.matrixWorld);
  });
}

// Paleta de materiales del living (tonos de la referencia, con la luz cálida del juego). Las telas
// vienen en gris (se les sacó el color): el tinte define su color final.
export const LM = {
  parquet: () => photo('rectangular_parquet', { tint: '#fff1de', roughness: 0.7, normal: 0.8, env: 0.7 }),
  wall: () => photo('painted_plaster_wall', { tint: '#fff6ea', roughness: 1, normal: 0.5, env: 0.4 }),
  velvet: (tint = '#2f8f7a') => photo('velour_velvet', { tint, roughness: 1, normal: 0.9, env: 0.35 }),
  boucle: (tint = '#f3e7cf') => photo('wool_boucle', { tint, roughness: 1, normal: 1.2, env: 0.3 }),
  linen: (tint = '#f6eedd') => photo('rough_linen', { tint, roughness: 1, normal: 0.8, env: 0.4 }),
  blackOak: () => photo('black_oak_veneer', { tint: '#5c5a5e', roughness: 0.35, normal: 0.4, env: 1 }),
  oak: (tint = '#ffffff') => photo('oak_veneer_01', { tint, roughness: 0.65, normal: 0.6, env: 0.7 }),
  jersey: (tint) => photo('cotton_jersey', { tint, roughness: 1, normal: 0.9, env: 0.35 }),
  fleece: (tint) => photo('knitted_fleece', { tint, roughness: 1, normal: 0.9, env: 0.3 }),
};
