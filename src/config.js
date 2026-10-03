// Todos los valores ajustables del juego en un solo lugar.
// Unidades: 1 unidad ≈ 3 cm a escala juguete (el auto mide 2.4 u). Tiempos en segundos.
// Los valores "…Response" / "…Smoothing" son velocidades de suavizado (1/s): más alto = más rápido.

const DEG = Math.PI / 180;

export const GAME_CONFIG = {
  debug: {
    enabled: false, // DEBUG_MODE: panel, zona segura y marcadores. Tecla V para alternar.
    helpers3D: true, // punto medio, foco de cámara y línea entre jugadores dentro de la escena
  },

  // Gráficos. quality: 'high' (todo activado) | 'low' (para máquinas modestas). Tecla G alterna en vivo.
  graphics: {
    quality: 'low', // por defecto fluido; la tecla G (o Configuración) activa la alta
    maxPixelRatio: 2, // tope de resolución en pantallas retina (1 = más rápido)
    exposure: 1.0,
    envIntensity: 0.55, // cuánto reflejan/iluminan los materiales el entorno (cielo + ventana)
    shadowSoftness: 3, // radio de desenfoque de las sombras
    ambientOcclusion: { enabled: false, radius: 2.2, intensity: 0.85 }, // sombras de contacto (costoso)
    bloom: { enabled: true, strength: 0.45, radius: 0.35, threshold: 2.2 }, // brillo solo en luces (faroles, faros, turbo)
    tiltShift: { enabled: true, maxBlur: 2.2 }, // efecto miniatura (bordes desenfocados; la franja nítida depende de la vista de cámara)
    grade: { saturation: 1.08, contrast: 1.06, warmth: 0.03, vignette: 0.32 }, // corrección de color
  },

  physicsStep: 1 / 120,

  // Nombre flotante sobre cada auto (con su flechita). Con la cámara lejos se agranda en parte, así no
  // se pierde de vista: tamaño en pantalla ∝ (distancia / refDistance)^-(1 - keep).
  marker: {
    refDistance: 24, // hasta esta distancia de cámara se ve del tamaño original
    keep: 0.7, // cuánto se compensa el alejamiento (0 = se achica como todo, 1 = tamaño fijo en pantalla)
    maxScale: 2.6, // tope del agrandado
  },

  players: [
    {
      name: 'Jugador 1',
      short: 'P1',
      color: '#4d8bff', // color de interfaz (HUD, marcadores)
      paint: '#131c45', // pintura del auto: azul medianoche
      driver: 'coco', // piloto por defecto (se elige en "Elegí tu piloto")
      controlsLabel: 'WASD',
      useLabel: 'Espacio',
      controls: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', use: 'Space', jump: 'ShiftLeft' },
    },
    {
      name: 'Jugador 2',
      short: 'P2',
      color: '#ff5a36',
      paint: '#c8321f',
      driver: 'faxo',
      controlsLabel: 'Flechas',
      useLabel: 'Enter',
      controls: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', use: 'Enter', jump: 'ShiftRight' },
    },
    {
      name: 'Jugador 3',
      short: 'P3',
      color: '#5cc24a',
      paint: '#2f7d32',
      driver: 'domono',
      controlsLabel: 'IJKL',
      useLabel: 'U',
      controls: { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', use: 'KeyU', jump: 'KeyO' },
    },
    {
      name: 'Jugador 4',
      short: 'P4',
      color: '#ffc93c',
      paint: '#d99a00',
      driver: 'coco',
      controlsLabel: 'Num 8456',
      useLabel: 'Num 0',
      controls: { up: 'Numpad8', down: 'Numpad5', left: 'Numpad4', right: 'Numpad6', use: 'Numpad0', jump: 'NumpadEnter' },
    },
  ],
  // Partida local: hasta `max` autos entre personas (cada una con teclado o joystick, ver Input.js)
  // y pilotos de la computadora. Por defecto, 1 persona contra 1 CPU.
  localPlayers: { max: 4, humans: 1, cpus: 1, nameMax: 12 },

  // Pilotos de "Elegí tu piloto". Cada uno maneja su auto (`car`, ver `cars`) con su pintura.
  //  stats (0–10) cambian el manejo respecto de la base, ver `driverStats` · kmh: solo para mostrar
  //  portrait / carImage: imágenes en src/assets/pilots/ · w, t, l: tamaño y posición del retrato
  //  c1, c2: degradé del fondo de la tarjeta
  //  podium: cómo se ve arriba del podio (w: ancho relativo al escalón, hide: cuánto queda detrás del bloque)
  drivers: [
    {
      id: 'coco',
      name: 'El Coco',
      car: 'corolla',
      carLabel: 'Toyota Corolla',
      paint: '#1f2c63',
      paintName: 'Azul medianoche',
      quip: 'Mecánico de barrio. Le sacó cada caballo de fuerza a mano.',
      stats: { vel: 9, acel: 7, man: 5, res: 7 },
      kmh: 198,
      portrait: 'el-coco.webp',
      carImage: 'el-coco-toyota-corolla.webp',
      w: '112%', t: '0%', l: '52%',
      c1: '#5c7be0', c2: '#1f2c63',
      podium: { w: 1.55, hide: '44%' },
    },
    {
      id: 'domono',
      name: 'Dj Domono',
      car: 'partner',
      carLabel: 'Peugeot Partner',
      paint: '#f1f1ee',
      paintName: 'Blanca',
      quip: 'Llega a todas las fiestas con el equipo atrás. Nada lo frena.',
      stats: { vel: 6, acel: 5, man: 6, res: 10 },
      kmh: 162,
      portrait: 'dj-domono.webp',
      carImage: 'dj-domono-peugeot-partner.webp',
      w: '74%', t: '2%', l: '36%',
      c1: '#7f9a63', c2: '#2f4a2c',
      podium: { w: 0.8, hide: '26%' },
    },
    {
      id: 'faxo',
      name: 'Dr Faxo',
      car: 'clio',
      carLabel: 'Renault Clio Mío',
      paint: '#5e5a55',
      paintName: 'Gris topo',
      quip: 'Liviano y rápido. Dobla antes de que dispare el flash.',
      stats: { vel: 7, acel: 9, man: 9, res: 5 },
      kmh: 171,
      portrait: 'dr-faxo.webp',
      carImage: 'dr-faxo-renault-clio.webp',
      w: '64%', t: '3%', l: '36%',
      c1: '#a7e86e', c2: '#45423e',
      podium: { w: 0.7, hide: '24%' },
    },
    {
      id: 'pablo',
      name: 'PabloQuemandoRuedas',
      car: 'moto',
      carLabel: 'Yamaha XTZ 125',
      paint: '#1d2a4f',
      paintName: 'Azul y naranja',
      quip: 'Una rueda o dos, depende del día.',
      stats: { vel: 8, acel: 10, man: 8, res: 3 },
      kmh: 184,
      portrait: 'pablo-quemando-ruedas.webp',
      carImage: 'pablo-quemando-ruedas-yamaha-xtz125.webp',
      w: '64%', t: '0%', l: '38%',
      c1: '#f0883a', c2: '#1d2a4f',
      podium: { w: 0.6, hide: '34%' },
    },
  ],

  // Cuánto cambia el manejo cada punto de stat por encima o por debajo de `base`
  driverStats: {
    base: 7,
    maxSpeed: 0.025, // Velocidad: +2.5 % de velocidad máxima por punto
    acceleration: 0.04, // Aceleración: +4 % de empuje por punto
    handling: 0.03, // Manejo: +3 % de giro y de grip por punto
    toughness: 0.06, // Resistencia: −6 % de empujón, frenada y aturdimiento por bomba/misil por punto
  },

  // Modelos de los autos. Todos tienen la misma física; el manejo lo cambian las stats del piloto.
  //  file: modelo optimizado en src/assets/models/ · paint: material que se repinta con el color del jugador
  //  yawOffset: corrección si el frente queda al revés (Math.PI) · materials: ajustes por nombre de material
  //  length: largo propio (si no, vehicle.model.length) · textured: conserva su textura (no se repinta)
  //  lean: se inclina hacia adentro en las curvas (motos)
  //  fragile: vehículo liviano que sale en trompo cuando lo chocan (ver Car.knockSpin)
  //  jump: salto propio (si no, vehicle.jump; ver Car.jump)
  cars: [
    {
      id: 'corolla',
      name: 'Corolla',
      file: 'corolla.glb',
      paint: 'Carro_Pintura',
      yawOffset: 0,
      // Los materiales vienen sin metal ni brillo (se ven de plástico); nombres en portugués
      materials: [
        [/Espelho/i, { color: '#dfe3ea', metalness: 1, roughness: 0.05 }], // espejos
        [/Cromado|Roda/i, { metalness: 1, roughness: 0.2 }], // cromados y llantas
        [/Vidros_Vermelhos|Refletor_Lanterna/i, { emissive: '#ff1a1a', emissiveIntensity: 1.2 }], // luces traseras
        [/Vidros/i, { color: '#0b0f16', metalness: 0.6, roughness: 0.04, opacity: 0.65 }], // vidrios
        [/Farol/i, { metalness: 0.9, roughness: 0.15 }], // reflectores de los faros
        [/Laranja/i, { emissive: '#ff7a00', emissiveIntensity: 0.4 }], // giros
        [/Freio/i, { metalness: 0.7, roughness: 0.35 }], // frenos
        [/Pneu/i, { roughness: 0.92 }], // neumáticos
        [/Plastico|Preto|Interno/i, { roughness: 0.65 }], // plásticos y tapizado
      ],
    },
    {
      id: 'clio',
      name: 'Clio',
      file: 'clio.glb',
      paint: 'Tle_rouge',
      yawOffset: 0,
      // Nombres en francés
      materials: [
        [/^Vitres/i, { color: '#0b0f16', metalness: 0.6, roughness: 0.04 }], // vidrios
        [/^Phare\.001/i, { color: '#ff1a1a', metalness: 0.2, roughness: 0.2, emissive: '#ff1a1a', emissiveIntensity: 1.2 }], // luces traseras
        [/^Phare$/i, { color: '#fff4dc', metalness: 0.2, roughness: 0.1, emissive: '#fff1c2', emissiveIntensity: 1.5 }], // faros
        [/Enjoliveurs/i, { metalness: 1, roughness: 0.2 }], // tazas de las ruedas
        [/Dchet|Plastique|Material\.002/i, { roughness: 0.7 }], // gomas y plásticos
      ],
    },
    {
      id: 'partner',
      name: 'Partner',
      file: 'peugeot.glb',
      paint: 'carpaint',
      yawOffset: 0,
      materials: [
        [/^windows$/i, { color: '#0b0f16', metalness: 0.6, roughness: 0.04 }], // vidrios
        [/^vitre$/i, { color: '#0b0f16', metalness: 0.6, roughness: 0.04, opacity: 0.65 }],
        [/redglass|^rouge/i, { emissive: '#ff1a1a', emissiveIntensity: 1.2 }], // luces traseras
        [/clignotant/i, { color: '#ff7a00', emissive: '#ff7a00', emissiveIntensity: 0.4 }], // giros
        [/smallspecmap/i, { color: '#e8e8e8', metalness: 0.9, roughness: 0.15 }], // faros
        [/mirror|^gris$/i, { metalness: 1, roughness: 0.15 }], // espejos y cromados
      ],
    },
    {
      id: 'moto',
      name: 'Moto',
      file: 'moto.glb',
      textured: true, // un solo material con textura: no hay carrocería para repintar
      length: 2.1, // más corta que un auto (la colisión es la misma)
      lean: true,
      yawOffset: 0,
      fragile: {
        mass: 0.7, // en un choque contra un auto (masa 1) se lleva algo más de empujón
        minImpact: 6, // velocidad de choque (u/s) a partir de la cual sale en trompo (los roces no)
        fullImpact: 16, // a esta velocidad de choque, el trompo es completo
        spinRate: 8, // giro del trompo (rad/s)…
        spinTime: 0.6, // segundos sin control en el trompo completo
        spinDamping: 2.5, // …y se frena rápido: el trompo completo es ~media vuelta
        grip: 0.12, // agarre durante el trompo: patina
        knockRoll: 0.6, // cuánto queda tirada de costado mientras gira (rad)
        bump: 1.4, // rebote visual de los golpes, comparado con un auto
      },
      jump: { speed: 13, cooldown: 0.35 }, // la moto salta un poco más alto que los autos (ver vehicle.jump)
    },
  ],

  camera: {
    // Paneo cinematográfico alrededor del ganador de la ronda (ver CameraRig.cinematic). Ángulos
    // respecto del frente del auto: π = detrás. Rango [inicio, fin] para distancia, altura y lente.
    cinematic: {
      blend: 0.8, // segundos de transición desde la cámara de juego
      startAngle: Math.PI + 0.55, // empieza detrás y un poco a la derecha…
      sweep: -(Math.PI + 1.0), // …y gira ~237° pasando por el costado hasta quedar adelante
      distance: [8.5, 6.4],
      height: [4.2, 1.1], // termina a la altura del auto
      fov: 34, // lente un poco más cerrado: más cine
    },
    minDistance: 24, // MIN_CAMERA_DISTANCE: lo más cerca que llega
    maxDistance: 60, // MAX_CAMERA_DISTANCE: nunca se aleja más que esto

    // Vistas de cámara (Configuración → Juego). El encuadre siempre se calcula con `fov`; `speedFov` solo
    // abre el lente por encima de eso según la velocidad, así que nunca deja a nadie afuera.
    //  pitch:     inclinación respecto del piso (90 = cenital); más baja = más perspectiva, más camino adelante.
    //             Puede ser un rango [juntos, separados]: la cámara baja hacia el horizonte con los autos cerca
    //             y sube a una vista más cenital a medida que se separan (pitchSpread: separación en unidades
    //             de mundo, [desde, hasta], entre el primero y el último)
    //  fov:       lente base (grados)
    //  speedFov:  grados extra a velocidad máxima (abre con velocidad, cierra al frenar)
    //  focusBand: franja nítida del efecto miniatura; speedBand: cuánto se ensancha a velocidad máxima
    //  aim:       altura de pantalla (-1 abajo … 1 arriba) donde queda el grupo; sin aim se centra sobre el piso
    //             (con la cámara baja eso los sube y se vería el camino de atrás)
    //  minDistance / maxDistance: pisan a los generales. Un máximo más chico = cámara más cerca, pero el
    //             que queda atrás sale de pantalla (y queda eliminado) con menos distancia al líder
    view: 'classic',
    views: {
      classic: { label: 'Clásica', pitch: 48 * DEG, fov: 45, speedFov: 0, focusBand: 0.2, speedBand: 0 },
      perspective: { label: 'Perspectiva', pitch: [27 * DEG, 58 * DEG], pitchSpread: [2, 12], fov: 50, speedFov: 14, focusBand: 0.3, speedBand: 0.12, aim: -0.2, minDistance: 16, maxDistance: 30 },
    },
    fovSmoothing: 0.9, // qué tan rápido el lente sigue a la velocidad (1/s)
    fovRate: 0.35, // y como mucho cuánto cambia por segundo (fracción de speedFov): así no tiembla
    pitchSmoothing: 1.2, // qué tan rápido la inclinación sigue a la separación de los autos (1/s)

    // Zona segura: margen interno por lado, como fracción del ancho/alto de pantalla.
    // Un jugador fuera de este rectángulo pasa a OUT_OF_SCREEN.
    safeMargin: { x: 0.07, y: 0.09 },

    framing: 0.8, // ambos jugadores ocupan esta fracción de la zona segura al encuadrar
    leaderFraming: 0.85, // al llegar al zoom máximo, el líder nunca pasa de esta fracción
    hardFraming: 0.95, // si alguien pasa de esta fracción, la cámara se aleja sin suavizado (hasta el máximo)
    padding: 3, // margen alrededor de cada auto al encuadrar (unidades de mundo)
    lookAhead: 0.3, // segundos de anticipación según la velocidad promedio

    smoothing: 3.5, // paneo hacia el punto medio (1/s)
    aimSmoothing: 14, // vistas con `aim`: corrimiento por altura de pantalla e inclinación (rápido: ver CameraRig)
    zoomOutSmoothing: 3, // alejarse es más rápido…
    zoomInSmoothing: 1.0, // …que acercarse
    yawSmoothing: 1.4, // giro de la cámara siguiendo la pista (1/s)
    yawLookAhead: 24, // tramo de pista delante del líder que orienta la cámara…
    yawLookAheadTime: 0.6, // …más lo que recorre el líder en este tiempo (s): a más velocidad, anticipa antes las curvas
    heightSmoothing: 2, // altura del foco (saltos y desniveles): más lenta que el paneo, así no rebota (1/s)
    velocitySmoothing: 4, // velocidad usada para anticipar el encuadre: los choques no lo sacuden (1/s)
  },

  // Quedar atrás: salir de la zona segura elimina en el acto
  outOfScreen: {
    graceTime: 1, // segundos al inicio de la ronda sin chequeo
  },

  // Vida de cada jugador (0 = queda eliminado). El daño de cada objeto está en POWERUP_CONFIG (`damage`).
  health: {
    max: 100,
  },

  vehicle: {
    length: 2.4,
    width: 1.3,
    // Modelos 3D de los autos (ver `cars`; si falla la carga se usa el auto hecho con primitivas)
    // Salto (todos los vehículos; la moto tiene el suyo en `cars`)
    jump: {
      speed: 12.5, // velocidad vertical (u/s): sube ~1,9 u y pasa por encima de autos y obstáculos
      cooldown: 0.4, // segundos en el piso antes de poder volver a saltar
    },
    model: {
      enabled: true,
      length: 2.8, // largo al que se escala el modelo (el auto de colisión mide `length`)
    },
    // Colisión: dos círculos a lo largo del auto (adelante y atrás).
    colliderRadius: 0.68,
    colliderOffset: 0.55,

    acceleration: 34, // empuje a baja velocidad (u/s²)
    accelerationCurve: 0.75, // cuánto cae el empuje cerca de la vel. máxima (0 = constante)
    throttleResponse: 6, // qué tan rápido el acelerador llega a fondo → sensación de masa
    maxSpeed: 30,
    braking: 55,
    reverseAcceleration: 16,
    maxReverseSpeed: 10,
    friction: 5, // desaceleración sin acelerar (u/s²)
    drag: 0.2, // resistencia proporcional a la velocidad (1/s)

    turnSpeed: 2.9, // rad/s de giro máximo
    turnFullSpeed: 5, // velocidad desde la que gira a pleno (quieto no gira)
    highSpeedTurnFactor: 0.6, // factor de giro a velocidad máxima (gira menos rápido)
    steerResponse: 14, // suavizado del volante
    yawResponse: 9, // inercia de rotación: qué tan rápido el giro real alcanza al pedido

    grip: 9, // corrección del deslizamiento lateral: alto = va hacia donde apunta
    driftGripLoss: 0.25, // pérdida de grip girando fuerte a velocidad máxima (0..1)
  },

  collision: {
    wallBounce: 0.3, // rebote contra paredes (0 = se desliza, 1 = rebote total)
    wallFriction: 0.025, // pérdida de velocidad tangencial por unidad de impacto
    carBounce: 0.6,
    obstacleBounce: 0.45,
    spin: 0.06, // cuánto hace girar un golpe descentrado (auto↔auto, auto↔obstáculo)
    spinDamping: 4, // qué tan rápido se frena ese giro (1/s)
  },

  track: {
    halfWidth: 7,
    samples: 800,
    // La pista es una losa de juguete apoyada sobre un escritorio gigante.
    slabThickness: 1.2, // el escritorio queda 1.2 u por debajo de la calzada
    desk: { minX: -165, maxX: 148.5, minZ: -135, maxZ: 125, thickness: 5 },
    floorY: -70, // piso de la habitación, muy abajo
    sidewalkWidth: 2.6, // vereda de los sectores con barrera
    lampSpacing: 34, // faroles cada tantas unidades en los sectores seguros

    // Línea central del circuito (x, z), en orden de carrera. Progresión:
    // largada (seguro) → curvas → precipicio → subida → elevado sin barreras → salto
    // → bajada → atajo / rodeo → sector técnico → meta
    controlPoints: [
      [-60, 90], [0, 91], [50, 88], [95, 74], [118, 45], [141, 18], [141, -10], [141, -45],
      [130, -80], [95, -95], [60, -94], [35, -86], [10, -94], [-15, -97], [-40, -97],
      [-65, -95], [-100, -88], [-125, -60], [-122, -25], [-100, -5], [-60, 5], [-35, 25],
      [-55, 50], [-85, 52], [-112, 60], [-116, 82], [-95, 92],
    ],
    start: [-45, 90], // línea de largada/meta

    // PRECIPICIO: tramo pegado al borde del escritorio, sin barrera del lado indicado.
    cliffs: [{ from: [141, 18], to: [141, -52], side: 'right' }],

    // DESNIVEL + SECTOR SIN BARRERAS: sube con rampa y sigue elevado hasta el salto.
    elevated: {
      from: [100, -94], // comienzo de la rampa de subida
      height: 7, // altura sobre la calzada normal
      rampLength: 34, // largo de la subida (más corto = más empinada)
      barriers: false, // sin barreras una vez arriba
    },

    // SALTO: rampa de despegue al final del tramo elevado, hueco y plataforma de aterrizaje.
    jump: {
      at: [-12, -97], // punto de despegue (fin de la rampa)
      kickerLength: 12, // largo de la rampa de despegue
      kickerRise: 1.8, // cuánto sube la rampa (más = sale más alto)
      gapLength: 10, // largo del hueco: más largo = hace falta más velocidad
      landingHeight: 4, // altura de la plataforma de aterrizaje
      landingLength: 10, // plataforma plana sin barreras
      rampDownLength: 26, // bajada hasta la calzada normal
    },

    // ATAJO: regla angosta y elevada, sin barreras, que corta el rodeo del oeste.
    shortcut: {
      points: [[-80, -94], [-80, -80], [-80, -50], [-80, -20], [-80, 0]],
      halfWidth: 2.8,
      height: 3,
      rampLength: 10,
    },

    // Obstáculos: at = punto aproximado sobre la pista, offset = lateral (+izq)
    obstacles: [
      { at: [60, 86], offset: -3, type: 'cone' },
      { at: [64, 85], offset: -4.5, type: 'cone' },
      { at: [105, 64], offset: 3, type: 'drum' },
      { at: [-110, -75], offset: 3, type: 'block' },
      { at: [-123, -40], offset: -3, type: 'drum' },
      { at: [-45, 10], offset: 3.5, type: 'cone' },
      { at: [-70, 51], offset: -3, type: 'drum' },
    ],
  },

  // Piloto de la computadora (modo VS CPU). Una entrada por dificultad.
  // Online (Supabase Realtime, ver src/net/). El anfitrión simula la carrera y manda el estado a los demás.
  online: {
    maxPlayers: 6,
    nameMin: 2,
    nameMax: 16,
    snapshotRate: 12, // estados por segundo que manda el anfitrión (Supabase gratis: ~100 mensajes/s por proyecto)
    inputRate: 15, // máximo de envíos de controles por segundo de cada invitado (solo cuando cambian)
    interpolationDelay: 0.15, // los invitados muestran el estado con este retraso para interpolar sin saltos (s)
    adTimeout: 7, // un lobby que deja de anunciarse desaparece de la lista (s)
    joinTimeout: 6,
    dropTimeout: 8, // sin noticias de un jugador (o del anfitrión) durante este tiempo → desconectado
    // Color de interfaz y pintura de respaldo de cada lugar del lobby (la pintura se usa si el piloto se repite)
    slots: [
      { color: '#4d8bff', paint: '#131c45' },
      { color: '#ff5a36', paint: '#c8321f' },
      { color: '#5cc24a', paint: '#2f7d32' },
      { color: '#ffc93c', paint: '#d99a00' },
      { color: '#b06bff', paint: '#5b2a9e' },
      { color: '#4fc3e8', paint: '#1b8fb0' },
    ],
  },

  // Carrera: gana el primero que completa las vueltas (o el último que queda en pantalla)
  race: {
    // Partida a rondas: cada ronda la gana el último que queda (los demás quedaron atrás o sin vida).
    // Gana la partida el que más rondas gana; termina antes si ya nadie lo alcanza, y si al final
    // hay empate arriba se juega una ronda extra.
    roundOptions: [3, 6, 9], // opciones de "Crear partida"
    rounds: 6, // por defecto
    celebrate: 4.8, // segundos de festejo del ganador de la ronda (paneo de cámara, saltitos con vuelta)
    hops: [1.0, 2.5], // en qué momentos del festejo salta (con una vuelta sobre sí mismo)
    countdown: 3, // segundos de la cuenta 3…2…1 antes de largar (los autos quedan quietos)
    goShow: 0.8, // cuánto queda en pantalla el "¡YA!"
  },

  ai: {
    cpuName: 'CPU',
    difficulties: {
      easy: {
        label: 'Fácil',
        speedScale: 0.8, // fracción de la velocidad máxima que se permite
        cornerMargin: 1.35, // más alto = frena antes y toma las curvas más despacio
        riskMargin: 1.3, // prudencia extra en tramos sin baranda
        steerNoise: 0.12, // imprecisión al girar
        lookAhead: 7, // cuánto mira adelante para apuntar (u + 0.5 u por u/s)
        itemDelay: [2.5, 5], // segundos que tarda en usar un objeto (mín, máx)
        itemSkill: 0.45, // probabilidad de usar el objeto en el momento oportuno
        seeksBoxes: false,
      },
      normal: {
        label: 'Normal',
        speedScale: 0.92,
        cornerMargin: 1.12,
        riskMargin: 1.15,
        steerNoise: 0.05,
        lookAhead: 8,
        itemDelay: [1, 2.5],
        itemSkill: 0.75,
        seeksBoxes: true,
      },
      hard: {
        label: 'Difícil',
        speedScale: 1,
        cornerMargin: 1.0,
        riskMargin: 1.05,
        steerNoise: 0.015,
        lookAhead: 9,
        itemDelay: [0.3, 1],
        itemSkill: 1,
        seeksBoxes: true,
      },
    },
  },

  // Física vertical, caídas y respawn
  terrain: {
    gravity: 42, // u/s²: más alto = saltos más cortos y caídas más secas
    stepUp: 0.6, // desnivel máximo que el auto sube sin chocar
    fallDepth: 2.5, // si queda esta distancia por debajo de la calzada, se considera caído
    respawnDelay: 1.1, // segundos cayendo antes de reaparecer
    respawnBack: 6, // reaparece esta distancia antes del último punto seguro
    respawnBlink: 1.2, // segundos de parpadeo después de reaparecer
  },
};

// Power-ups: todos los valores de balance. Duraciones en segundos, fuerzas en u/s o u/s².
// weight = probabilidad relativa de salir de una caja (0 = desactivado).
export const POWERUP_CONFIG = {
  itemBoxes: {
    pickupRadius: 1.6,
    // Cantidad de power-ups elegida en "Crear partida": qué cajas aparecen y cada cuánto reaparecen
    amounts: {
      few: { label: 'Pocos', respawnTime: 10 },
      normal: { label: 'Medios', respawnTime: 6 },
      many: { label: 'Muchos', respawnTime: 3.5 },
    },
    // Posiciones manuales: at = punto aproximado sobre la pista, offset = lateral (+izq),
    // in = cantidades en las que aparece la caja
    positions: [
      // Medios: las 8 originales (en Muchos también)
      { at: [20, 90], offset: -3.5, in: ['normal', 'many'] }, { at: [20, 90], offset: 3.5, in: ['normal', 'many'] }, // recta de largada
      { at: [128, -65], offset: 0, in: ['few', 'normal', 'many'] }, // después del precipicio, antes de subir
      { at: [-66, -95], offset: -3, in: ['normal', 'many'] }, { at: [-66, -95], offset: 3, in: ['normal', 'many'] }, // tras el aterrizaje: ¿atajo o rodeo?
      { at: [-116, -10], offset: 0, in: ['normal', 'many'] }, // premio del rodeo largo
      { at: [-50, 13], offset: -2.5, in: ['normal', 'many'] }, { at: [-50, 13], offset: 2.5, in: ['normal', 'many'] }, // entrada al sector técnico
      // Pocos: una sola caja al centro donde Medios tiene dos (en Muchos completan filas de tres)
      { at: [20, 90], offset: 0, in: ['few', 'many'] },
      { at: [-66, -95], offset: 0, in: ['few', 'many'] },
      { at: [-50, 13], offset: 0, in: ['few', 'many'] },
      // Muchos: tramos seguros sin obstáculos, lejos de las demás cajas
      { at: [87, 79], offset: 0, in: ['many'] },
      { at: [120, 43], offset: 2, in: ['many'] },
      { at: [142, 1], offset: -2, in: ['many'] },
      { at: [108, -92], offset: 0, in: ['many'] },
      { at: [40, -87], offset: 0, in: ['many'] },
      { at: [-120, -70], offset: 0, in: ['many'] },
      { at: [-88, 52], offset: 2, in: ['many'] },
      { at: [-115, 83], offset: -2, in: ['many'] },
    ],
  },

  turbo: {
    weight: 1,
    duration: 2.5,
    speedMultiplier: 1.35,
    accelerationMultiplier: 1.9,
  },

  bomb: {
    weight: 1,
    damage: 35, // vida que saca (de health.max = 100)
    speed: 38, // velocidad mínima del proyectil (se suma a la del auto si va más rápido)
    lifetime: 2.2, // segundos antes de desaparecer
    maxDistance: 70,
    hitRadius: 1.1,
    speedKept: 0.5, // fracción de la velocidad que conserva el auto golpeado
    pushForce: 7, // empujón al impactar (u/s)
    launchSpeed: 14, // lo hace volar (u/s hacia arriba: ~0.7 s en el aire)
    turns: 1, // vueltas de barril en el aire
    spin: 3, // giro que provoca (rad/s)
    stunDuration: 0.7, // pérdida de control después de aterrizar
    stunSteer: 0.2, // fracción de dirección que queda durante el aturdimiento
    stunGrip: 0.3, // fracción de grip durante el aturdimiento
  },

  missile: {
    weight: 0.8,
    damage: 80, // vida que saca
    launchSpeed: 22, // sale despacio del auto…
    speed: 46, // …y acelera hasta esta velocidad
    acceleration: 60,
    cornerSpeed: 24, // en curvas cerradas frena hasta esta velocidad…
    braking: 120,
    sharpTurnAngle: 0.35, // …cuando el objetivo queda a más de este ángulo (rad)
    turnRate: 3.2, // giro máximo del guiado (rad/s)
    armTime: 0.25, // segundos en línea recta antes de empezar a guiarse
    lookAhead: 9, // cuánto adelante en la pista apunta mientras busca al rival
    directRange: 22, // más cerca que esto va directo hacia el rival…
    directCone: 0.5, // …si está adelante (coseno del ángulo: 0.5 = ±60°)
    dodgeRange: 12, // distancia a la que empieza a esquivar obstáculos
    dodgeMargin: 0.8, // espacio extra que deja al pasar al lado de un obstáculo
    hover: 0.9, // altura de vuelo sobre la pista
    lifetime: 6,
    hitRadius: 1.1,
    speedKept: 0.3, // fracción de la velocidad que conserva el auto golpeado
    pushForce: 6,
    launchSpeed: 17, // vuela más alto que con la bomba (~0.8 s en el aire)
    turns: 1,
    spin: 4,
    stunDuration: 0.9, // pérdida de control después de aterrizar
  },

  oil: {
    weight: 1,
    damage: 0, // vida que saca (0 = no hace daño)
    lifetime: 12, // cuánto dura la mancha en la pista
    radius: 2.2,
    ownerGrace: 1.5, // el que la deja es inmune durante estos segundos
    slipperyDuration: 1.2, // cuánto dura el efecto después de pisarla
    frictionMultiplier: 0.2, // grip mientras resbala
    steerMultiplier: 0.6,
    spin: 1.8, // pequeño derrape al pisarla (rad/s)
  },

  magnet: {
    weight: 1,
    damage: 15, // vida que saca (una vez por imán)
    duration: 3,
    force: 16, // aceleración hacia el usuario (u/s²)
    maxDistance: 40, // más lejos no tiene efecto
    minDistance: 4, // más cerca deja de tirar (evita que se peguen)
  },

  shield: {
    weight: 1,
    duration: 5,
    radius: 2,
    consumeOnBomb: true, // una bomba lo rompe (pero igual protege de ese golpe)
  },
  // Ametralladora: balas hacia donde apunta el vehículo. Tocar = un tiro; mantener = automático
  gun: {
    weight: 0.9,
    ammo: 40, // balas por arma
    damage: 4, // vida que saca cada bala
    fireRate: 10, // balas por segundo manteniendo apretado
    speed: 75, // u/s (se suma la velocidad del auto)
    lifetime: 0.75, // segundos de vuelo (alcance ~55 u)
    spread: 0.025, // dispersión (radianes)
    push: 1.2, // empujoncito por bala (u/s)
    color: '#ffd166',
  },
  // Lanzallamas: chorro de fuego corto hacia adelante. Tocar = una bocanada; mantener = fuego continuo
  flamethrower: {
    weight: 0.8,
    ammo: 70, // carga: bocanadas por tanque (a fireRate = 3.5 s de fuego)
    fireRate: 20, // bocanadas por segundo manteniendo apretado
    damage: 0.7, // vida que saca cada bocanada que lo toca (el tanque entero sobre un rival quieto, con el ardor: ~70)
    burnTime: 1.5, // después de tocarlo queda ardiendo…
    burnDamage: 4, // …perdiendo esta vida por segundo (se renueva mientras lo siga quemando)
    speed: 28, // u/s al salir (se suma casi toda la velocidad del auto)…
    drag: 2.2, // …y se frena: alcance ~11 u quieto, ~20 u a fondo (la ametralladora llega a ~55)
    lifetime: 0.55, // segundos que dura cada bocanada
    radius: [0.35, 1.5], // tamaño de la bocanada al salir y al apagarse (u): el chorro se abre
    spread: 0.08, // dispersión (radianes)
    rise: 1.2, // el fuego sube (u/s)
    push: 0.25, // empujoncito por bocanada (u/s)
    color: '#ff7b1c',
  },
  // Corazón de vida: al usarlo restaura el 100% de la vida
  heart: {
    weight: 0.6, // sale un poco menos que los demás
    color: '#ff4d6d',
    duration: 1.2, // lo que dura el efecto visual (el corazón que sube)
    aiUseBelow: 55, // la CPU lo guarda hasta tener esta vida o menos
  },
};

/** Límites de la zona segura en coordenadas normalizadas de pantalla (NDC, -1..1). */
export function safeZoneNDC() {
  const m = GAME_CONFIG.camera.safeMargin;
  return { x: 1 - 2 * m.x, y: 1 - 2 * m.y };
}
