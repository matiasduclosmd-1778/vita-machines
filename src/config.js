// Todos los valores ajustables del juego en un solo lugar.
// Unidades: 1 unidad ≈ 3 cm a escala juguete (el auto mide 2.4 u). Tiempos en segundos.
// Los valores "…Response" / "…Smoothing" son velocidades de suavizado (1/s): más alto = más rápido.

const DEG = Math.PI / 180;

export const GAME_CONFIG = {
  debug: {
    enabled: true, // DEBUG_MODE: panel, zona segura y marcadores. Tecla V para alternar.
    helpers3D: true, // punto medio, foco de cámara y línea entre jugadores dentro de la escena
  },

  // Gráficos. quality: 'high' (todo activado) | 'low' (para máquinas modestas). Tecla G alterna en vivo.
  graphics: {
    quality: 'high',
    maxPixelRatio: 2, // tope de resolución en pantallas retina (1 = más rápido)
    exposure: 1.0,
    envIntensity: 0.55, // cuánto reflejan/iluminan los materiales el entorno (cielo + ventana)
    shadowSoftness: 3, // radio de desenfoque de las sombras
    ambientOcclusion: { enabled: false, radius: 2.2, intensity: 0.85 }, // sombras de contacto (costoso)
    bloom: { enabled: true, strength: 0.45, radius: 0.35, threshold: 2.2 }, // brillo solo en luces (faroles, faros, turbo)
    tiltShift: { enabled: true, focusBand: 0.2, maxBlur: 2.2 }, // efecto miniatura (bordes desenfocados)
    grade: { saturation: 1.08, contrast: 1.06, warmth: 0.03, vignette: 0.32 }, // corrección de color
  },

  physicsStep: 1 / 120,

  players: [
    {
      name: 'Jugador 1',
      short: 'P1',
      color: '#4d8bff', // color de interfaz (HUD, marcadores)
      paint: '#131c45', // pintura del auto: azul medianoche
      controlsLabel: 'WASD',
      useLabel: 'Espacio',
      controls: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', use: 'Space' },
    },
    {
      name: 'Jugador 2',
      short: 'P2',
      color: '#ff5a36',
      paint: '#c8321f',
      controlsLabel: 'Flechas',
      useLabel: 'Enter',
      controls: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', use: 'Enter' },
    },
  ],

  camera: {
    minDistance: 24, // MIN_CAMERA_DISTANCE: lo más cerca que llega
    maxDistance: 60, // MAX_CAMERA_DISTANCE: nunca se aleja más que esto
    fov: 45,
    pitch: 48 * DEG, // inclinación respecto del piso (90 = cenital)

    // Zona segura: margen interno por lado, como fracción del ancho/alto de pantalla.
    // Un jugador fuera de este rectángulo pasa a OUT_OF_SCREEN.
    safeMargin: { x: 0.07, y: 0.09 },

    framing: 0.8, // ambos jugadores ocupan esta fracción de la zona segura al encuadrar
    leaderFraming: 0.85, // al llegar al zoom máximo, el líder nunca pasa de esta fracción
    hardFraming: 0.95, // si alguien pasa de esta fracción, la cámara se aleja sin suavizado (hasta el máximo)
    padding: 3, // margen alrededor de cada auto al encuadrar (unidades de mundo)
    lookAhead: 0.3, // segundos de anticipación según la velocidad promedio

    smoothing: 3.5, // paneo hacia el punto medio (1/s)
    zoomOutSmoothing: 3, // alejarse es más rápido…
    zoomInSmoothing: 1.0, // …que acercarse
    yawSmoothing: 1.4, // giro de la cámara siguiendo la pista (1/s)
    yawLookAhead: 24, // tramo de pista delante del líder que orienta la cámara
  },

  outOfScreen: {
    countdown: 3, // segundos fuera de la zona segura antes de ser eliminado
    graceTime: 1, // segundos al inicio de la ronda sin chequeo
  },

  vehicle: {
    length: 2.4,
    width: 1.3,
    // Modelo 3D del auto (si falla la carga se usa el auto hecho con primitivas)
    model: {
      enabled: true,
      length: 2.8, // largo al que se escala el modelo (el auto de colisión mide `length`)
      yawOffset: 0, // corrección en radianes si el frente queda mirando al revés (Math.PI)
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
    respawnTime: 6, // segundos hasta que una caja recogida reaparece
    pickupRadius: 1.6,
    // Posiciones manuales: at = fracción del recorrido, offset = lateral (+izq)
    // Posiciones manuales: at = punto aproximado sobre la pista, offset = lateral (+izq)
    positions: [
      { at: [20, 90], offset: -3.5 }, { at: [20, 90], offset: 3.5 }, // recta de largada
      { at: [128, -65], offset: 0 }, // después del precipicio, antes de subir
      { at: [-66, -95], offset: -3 }, { at: [-66, -95], offset: 3 }, // tras el aterrizaje: ¿atajo o rodeo?
      { at: [-116, -10], offset: 0 }, // premio del rodeo largo
      { at: [-50, 13], offset: -2.5 }, { at: [-50, 13], offset: 2.5 }, // entrada al sector técnico
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
    speed: 38, // velocidad mínima del proyectil (se suma a la del auto si va más rápido)
    lifetime: 2.2, // segundos antes de desaparecer
    maxDistance: 70,
    hitRadius: 1.1,
    pushForce: 16, // empujón al impactar (u/s)
    upKick: 14, // salto visual de la carrocería
    spin: 5, // giro que provoca (rad/s)
    stunDuration: 1.1, // pérdida de control
    stunSteer: 0.2, // fracción de dirección que queda durante el aturdimiento
    stunGrip: 0.3, // fracción de grip durante el aturdimiento
  },

  oil: {
    weight: 1,
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
};

/** Límites de la zona segura en coordenadas normalizadas de pantalla (NDC, -1..1). */
export function safeZoneNDC() {
  const m = GAME_CONFIG.camera.safeMargin;
  return { x: 1 - 2 * m.x, y: 1 - 2 * m.y };
}
