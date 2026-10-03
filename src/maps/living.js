// El Living: pista de juguete armada por todo un living de noche (sillón, mesa del comedor,
// estantería, alfombra a cuadros, mesita ratona). Ver la propuesta: plano, perfil y tramos.
//
// Coordenadas: x hacia la derecha, z hacia el frente (la ventana está en z negativo).
// Escala del juguete: 1 unidad ≈ 3 cm, así que los muebles tienen su altura real
// (mesa del comedor 78 cm = 26 u, mesita 39 cm = 13 u, respaldo 90 cm = 30 u).
// La calzada es una losa de 1.2 u: un mueble queda 1.2 u por debajo de la pista que lo cruza.

const SLAB = 1.2;

// Muebles (los usan la física y los visuales; alturas = arriba de la pista que los cruza)
export const LIVING = {
  room: { minX: -216, maxX: 216, minZ: -176, maxZ: 176, wallHeight: 110 },
  sofa: { x0: -72, x1: 82, z0: -156, z1: -106, seat: 14, back: 30, arm: 20, armWidth: 14, backDepth: 14 },
  cushions: [-36, 14, 64], // centro de cada almohadón del asiento (x)
  dining: { x: 120, z: 85, r: 62, top: 26 },
  chairs: [[120, 12, 0], [190, 115, 2.1], [72, 150, 3.6], [55, 98, 4.7]], // x, z, giro
  coffee: { x: -60, z: 105, r: 30, top: 13 },
  shelf: { x0: 108, x1: 174, z0: -172, z1: -142, level: 18 },
  rug: { x0: -96, x1: 54, z0: -92, z1: 12 },
  loop: { x: -186, z: -26, r: 13 },
  cube: { x: -150, z: 116, size: 28 },
  window: { x0: -206, x1: -36 },
  plants: [[-204, 30], [-200, 168], [196, -166]],
  people: {
    sitting: { x: 120, z: 18 }, // tipea en la notebook, en la mesa del comedor
    crouching: { x: -12, z: -73 }, // agachado en la alfombra, empuja el autito por la pista
  },
  arch: [-122, 157],
};

const S = LIVING.sofa;
const D = LIVING.dining;
const C = LIVING.coffee;

export const LIVING_TRACK = {
  halfWidth: 7,
  samples: 1400,
  slabThickness: SLAB,
  floorY: -SLAB, // el parquet, debajo de la pista apoyada en el piso
  start: [-110, 158], // línea de largada/meta, bajo el arco

  // Línea central (x, z), en orden de carrera
  controlPoints: [
    // 1 · Largada: recta sobre el parquet
    [-150, 156], [-100, 158], [-40, 158], [5, 150],
    // 2 · Silla y mesa del comedor: curva alrededor de la notebook, entre los brazos
    [30, 126], [46, 102], [63, 90], [86, 62], [116, 47], [148, 54], [168, 76],
    // 3 · Tobogán del mantel hasta el piso y subida pegada a la pared derecha
    [186, 70], [200, 46], [201, 6], [199, -42],
    // 4 · Estantería: se pasa por adentro del estante
    [196, -90], [184, -134], [158, -153], [128, -152], [110, -146],
    // 5 · Regla (recta) hasta el apoyabrazos y almohadones del sillón
    [98, -138.5], [86, -131], [70, -124], [40, -121], [14, -120], [-11, -121], [-36, -121], [-56, -123],
    // 6 · Salto del apoyabrazos izquierdo · 7 · Ventanal elevado con un tramo roto
    [-70, -130], [-90, -140], [-121, -150], [-145, -152], [-168, -144], [-187, -118], [-192, -84],
    // 8 · Loop guiado (ver loop más abajo)
    [-190, -54], [-186, -24], [-178, 0],
    // 9 · Damero: chicana sobre la alfombra
    [-152, 12], [-116, -20], [-82, -46], [-46, -24], [-12, -54], [24, -30], [55, -8],
    // 10 · Mesita ratona · 11 · Cubo azul y vuelta a la largada
    [62, 26], [30, 68], [-12, 98], [-34, 103], [-60, 105], [-86, 108], [-112, 113], [-150, 117], [-178, 136],
  ],

  // Alturas por puntos clave [x, z, altura, 'lin' = rampa recta que lanza]
  profile: [
    [-150, 156, 0],
    [30, 126, 0],
    [46, 102, 14], // asiento de la silla
    [63, 90, D.top], // mesa del comedor
    [181, 73, D.top], // borde de la mesa: empieza el tobogán del mantel
    [195, 59, 9],
    [201, 40, 0],
    [199, -42, 0],
    [196, -90, 10],
    [184, -134, LIVING.shelf.level], // estante
    [110, -146, LIVING.shelf.level],
    [86, -131, S.arm], // apoyabrazos derecho
    [76, -126, S.arm],
    [44, -121, S.seat], // bajada larga y suave al almohadón 1 (si es corta, a fondo sale volando)
    [14, -120, S.seat + 2.5], // almohadón 2
    [-11, -121, S.seat],
    [-36, -121, S.seat + 2.5], // almohadón 3
    [-54, -123, S.seat],
    [-70, -130, S.arm + 1, 'lin'], // rampa del apoyabrazos izquierdo: lanza
    [-84, -137, 16], // aterrizaje en el ventanal (el hueco está en el medio)
    [-118, -150, 16],
    [-126, -151, 17.2, 'lin'], // rampita antes del tramo roto
    [-133, -152, 16],
    [-168, -144, 16],
    [-187, -118, 11],
    [-192, -84, 4],
    [-190, -54, 0],
    [-12, 98, 0],
    [-34, 103, C.top], // rampa a la mesita ratona
    [-87, 108, C.top],
    [-96, 110, 9], // bajada después del salto de la mesita
    [-112, 113, 0],
  ],

  // 8 · Loop guiado: entrando a minSpeed o más se da la vuelta; más lento, se despega arriba y se cae
  loop: { at: [-187, -30], radius: 10, minSpeed: 20, shift: 4, halfWidth: 5 },

  // Huecos sin piso: se saltan. Velocidad aproximada que piden (g = 42 u/s²):
  gaps: [
    { at: [42.5, -121], length: 2.5 }, // ranuras entre almohadones (terminan en la unión): ~12 u/s
    { at: [-8.5, -121], length: 2.5 },
    { at: [-71, -130.5], length: 11 }, // apoyabrazos → ventanal: ~21 u/s (el salto grande)
    { at: [-127, -151], length: 5 }, // tramo roto del ventanal: ~18 u/s
    { at: [-88, 108], length: 3 }, // borde de la mesita: ~10 u/s
  ],

  // Sin baranda (side: lado izquierdo/derecho según el sentido de carrera)
  open: [
    { from: [148, 54], to: [186, 70], side: 'both' }, // final de la mesa del comedor y comienzo del mantel
    { from: [108, -145], to: [84, -130], side: 'both' }, // regla
    { from: [74, -125], to: [-70, -130], side: 'both' }, // almohadones
    { from: [-84, -137], to: [-168, -144], side: 'left' }, // ventanal: del lado del living
    { from: [-34, 103], to: [-87, 108], side: 'both' }, // mesita ratona
  ],

  // Tramos angostos
  widths: [
    { from: [176, -142], to: [112, -147], halfWidth: 4.8 }, // dentro del estante
    { from: [108, -145], to: [84, -130], halfWidth: 3.2, blend: 3 }, // regla
  ],

  // Atajo: por arriba del respaldo (más alto, angosto y sin nada a los costados). Sale del estante,
  // sube por fuera del sillón y se saltea la regla, el apoyabrazos y los almohadones. Sube y baja
  // solo donde ya no se superpone con la pista principal (si no, la parte alta funciona como pared
  // para los que van por abajo); al final baja a la altura del principal antes de juntarse.
  shortcut: {
    halfWidth: 3.6,
    samples: 180,
    points: [[118, -149], [104, -149.5], [88, -149], [60, -149], [20, -149], [-20, -149], [-38, -148], [-46, -141], [-51, -133], [-53, -125]],
    // Al final se tira desde el borde del respaldo: es un salto al vacío hacia la rampa del apoyabrazos
    profile: [[118, -149, LIVING.shelf.level], [103, -149.5, LIVING.shelf.level], [87, -149, S.back], [-46, -141, S.back], [-51, -133, S.seat], [-53, -125, S.seat]],
  },

  // Obstáculos que se mueven: el autito rojo que empuja la mano del que está agachado, de un
  // lado a otro de la pista en la punta de la chicana del damero
  movers: [{ type: 'toycar', at: [-12, -54], offsets: [-1, 5], period: 3.4, r: 1.3 }],

  // Muebles: superficies donde se puede caer fuera de la pista (y paredes si están más altas)
  surfaces: [
    { circle: [C.x, C.z, C.r], top: C.top - SLAB },
    { circle: [D.x, D.z, D.r], top: D.top - SLAB },
    ...LIVING.chairs.map(([x, z]) => ({ box: [x - 8.5, z - 8.3, x + 8.5, z + 8.3], top: 14 - SLAB })),
    { box: [S.x0 + S.armWidth - 4, S.z0 + S.backDepth, S.x1 - S.armWidth + 4, S.z1], top: S.seat - SLAB },
    { box: [S.x0, S.z0, S.x1 + 4, S.z0 + S.backDepth], top: S.back - SLAB },
    { box: [S.x0 - 4, S.z0 + 4, S.x0 + S.armWidth - 4, S.z1], top: S.arm - SLAB },
    { box: [S.x1 - S.armWidth + 4, S.z0 + 4, S.x1 + 4, S.z1], top: S.arm - SLAB },
    { box: [LIVING.shelf.x0, LIVING.shelf.z0, LIVING.shelf.x1, LIVING.shelf.z1], top: LIVING.shelf.level - SLAB },
  ],

  // Obstáculos: at = punto aproximado sobre la pista, offset = lateral (+izq)
  obstacles: [
    // Mesa del comedor: la taza del que tipea y el banderín a cuadros (como en la referencia)
    { at: [108, 51], offset: 4.4, type: 'mug' },
    { at: [138, 50], offset: -4.4, type: 'flag' },
    // Almohadones decorativos
    { at: [14, -120], offset: 3.4, type: 'pillow' },
    { at: [-36, -121], offset: -3.4, type: 'pillow' },
    // Damero: conos, neumáticos y las zapatillas del que está agachado
    { at: [-116, -20], offset: 3.2, type: 'cone' },
    { at: [-112, -24], offset: 4.5, type: 'cone' },
    { at: [-82, -46], offset: -3, type: 'tire' },
    { at: [-46, -24], offset: 3.4, type: 'cone' },
    { at: [-20, -48], offset: -3.6, type: 'shoe' },
    { at: [24, -30], offset: 3, type: 'tire' },
    // Mesita ratona: la lata y el joystick
    { at: [-50, 104], offset: 2.6, type: 'can' },
    { at: [-74, 107], offset: -2.8, type: 'pad' },
  ],
};

// Cajas de objetos: at/offset sobre la pista; in = cantidades en las que aparece
export const LIVING_BOXES = [
  { at: [-60, 158], offset: -3.5, in: ['normal', 'many'] }, { at: [-60, 158], offset: 3.5, in: ['normal', 'many'] },
  { at: [-60, 158], offset: 0, in: ['few', 'many'] },
  { at: [201, 0], offset: 0, in: ['few', 'normal', 'many'] }, // después del tobogán
  { at: [198, -60], offset: -3, in: ['normal', 'many'] }, { at: [198, -60], offset: 3, in: ['many'] },
  { at: [-178, 0], offset: 0, in: ['normal', 'many'] }, // salida del loop
  { at: [-30, -40], offset: -3, in: ['normal', 'many'] }, { at: [-30, -40], offset: 3, in: ['few', 'many'] }, // damero
  { at: [45, 45], offset: 0, in: ['normal', 'many'] }, // antes de la mesita
  { at: [-150, 117], offset: 0, in: ['many'] }, // en el cubo
  { at: [100, 52], offset: -3, in: ['many'] }, // arriba de la mesa
];
