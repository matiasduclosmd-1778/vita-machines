import * as THREE from 'three';

// Materiales físicos del estilo "juguete limpio". Todos reciben reflejos del mapa de entorno
// (scene.environment), así que se ven coherentes con la luz de la escena.

/** Pintura de auto de juguete: base satinada con barniz brillante encima. */
export function paint(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 });
}

/** Plástico de juguete (bloques, pelota, conos). */
export function plastic(color, roughness = 0.42) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18 });
}

/** Cerámica esmaltada (taza, maceta brillante). */
export function ceramic(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
}

/** Metal cromado (llantas, virola del lápiz). */
export function chrome(color = '#d9dde3') {
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.16 });
}

/** Metal pintado (postes). */
export function paintedMetal(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 });
}

/** Vidrio oscuro reflectante (cabina de los autos). */
export function tintedGlass() {
  return new THREE.MeshPhysicalMaterial({ color: '#1b2430', roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 });
}

/** Vidrio transparente con refracción real (transmission). */
export function glass(tint = '#ffffff', { thickness = 0.8, roughness = 0.03, ior = 1.45 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    transmission: 1,
    thickness,
    roughness,
    ior,
    metalness: 0,
    attenuationColor: tint,
    attenuationDistance: 2.5,
    specularIntensity: 1,
  });
}

/** Líquido brillante (café, aceite). */
export function liquid(color, { iridescence = 0 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.04,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence,
    iridescenceIOR: 1.5,
    iridescenceThicknessRange: [180, 600],
  });
}

/** Madera barnizada (escritorio). */
export function varnishedWood(map, color = '#ffffff') {
  return new THREE.MeshPhysicalMaterial({ map, color, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.35 });
}

/** Luz emisiva que dispara el bloom. */
export function glow(color, intensity = 2.5) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.3 });
}
