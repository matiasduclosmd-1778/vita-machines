# Vita Machines — MVP

**Jugar online:** https://vita-machines.vercel.app

Juego de carreras de autitos de juguete en 3D (Three.js + Vite), 2 jugadores en el mismo teclado con cámara compartida.

```bash
npm install
npm run dev
```

## Menús (HUB)

Basados en `CDesign/VitaMachines HUB.html`. Flujo: **Carga → Inicio → Crear partida → carrera**.

- **Crear partida**: nombre, modo Carrera, mapa El Escritorio, rival y power-ups sí/no. Los otros modos y mapas figuran como *próximamente*.
  - **VS CPU**: un jugador (WASD + Espacio) contra la computadora, en Fácil / Normal / Difícil.
  - **VS Local**: dos jugadores en el mismo teclado.
- **Teclado**: reasignación real de las teclas de ambos jugadores (se intercambian si ya están en uso).
- **Configuración**: calidad gráfica, sombras, resolución interna, efecto miniatura, pantalla completa, brillo, tiempo fuera de pantalla y panel de debug.
- **Unirse al lobby / Lobby**: vista previa con datos de ejemplo (el multijugador online todavía no existe).
- Los ajustes y las teclas se guardan en el navegador (`localStorage`).
- Durante la carrera: `ESC` pausa (continuar, reiniciar o volver al menú).

Código en `src/ui/` (`Menu.js`, `menu.css`, `Settings.js`, tipografías en `src/ui/fonts/`); la ilustración de fondo está en `public/ui/street.jpg`.

## Controles

| | Acelerar | Frenar / reversa | Girar | Usar objeto |
|---|---|---|---|---|
| Jugador 1 | W | S | A / D | Espacio |
| Jugador 2 | ↑ | ↓ | ← / → | Enter |

- `ESC`: pausa
- `R`: reiniciar (también `Enter` en la pantalla de resultado)
- `G`: alternar calidad gráfica alta / baja
- `V`: activar/desactivar el modo debug (`GAME_CONFIG.debug.enabled` define el estado inicial)
- En desarrollo, `window.game` está expuesto en la consola.

## Reglas

Cada jugador está en uno de tres estados: `NORMAL`, `OUT_OF_SCREEN` o `ELIMINATED`.
Si sale de la zona segura (el rectángulo interno definido por `camera.safeMargin`) pasa a `OUT_OF_SCREEN` y empieza un countdown 3‑2‑1. Si vuelve antes, se cancela; si no, queda eliminado (su auto frena hasta detenerse) y gana el otro.
La cámara nunca se aleja más que `camera.maxDistance` para salvar al que va atrás.

## Piloto de la computadora (VS CPU)

`src/ai/AIDriver.js` genera el mismo input que el teclado y usa los objetos por el mismo sistema que un jugador: maneja el mismo auto con las mismas reglas. Calcula a qué velocidad puede tomar cada curva según el giro real del auto, frena con anticipación, es más prudente donde no hay baranda, llega rápido al salto, esquiva obstáculos, busca cajas y se destraba si queda contra algo. Su balance está en `GAME_CONFIG.ai.difficulties` (velocidad, prudencia en curvas y bordes, precisión, tiempo de reacción y criterio con los objetos).

## Power-ups

Hay 8 cajas "?" en la pista (`POWERUP_CONFIG.itemBoxes.positions`). Al tocar una, el jugador recibe un objeto al azar si su slot está vacío (`EMPTY` → `HAS_ITEM`); si ya tiene uno, la caja queda para el otro. Las cajas reaparecen a los `respawnTime` segundos.

| Objeto | Efecto |
|---|---|
| 🚀 TURBO | Más aceleración y velocidad máxima durante unos segundos |
| 💣 BOMB | Proyectil hacia adelante: al impactar empuja, hace girar y aturde al rival; contra una pared desaparece |
| 🛢️ OIL | Mancha detrás del auto: quien la pisa pierde grip y derrapa (el que la deja es inmune al principio) |
| 🧲 MAGNET | Atrae moderadamente al rival si está a menos de `maxDistance` |
| 🛡️ SHIELD | Cúpula que bloquea bomba, aceite e imán (una bomba la rompe) |

Para agregar uno nuevo: crear `src/powerups/types/MiObjeto.js` con `{ id, name, icon, color, config, use(ctx, car) }`, agregar su bloque en `POWERUP_CONFIG` y registrarlo en `src/powerups/types/index.js`. Los efectos temporales extienden `Effect` (`src/powerups/EffectManager.js`) y modifican `car.mods` (aceleración, velocidad máxima, grip, dirección, acelerador).

## Gráficos

- Posprocesado (`src/world/PostFX.js`): MSAA → oclusión ambiental (GTAO) → bloom en luces → tone mapping ACES → efecto miniatura (tilt-shift) → corrección de color y viñeta. En calidad baja: sin AO ni tilt-shift, resolución 1x y SMAA.
- Iluminación basada en imagen: mapa de entorno generado en tiempo real (cielo de tarde + ventana del lado del sol) que ilumina y se refleja en todos los materiales.
- Materiales físicos (`src/world/materials.js`): pintura con barniz, plástico, cerámica, cromo, vidrio con refracción (cajas "?"), pompa iridiscente (escudo), aceite tornasolado.
- Todo se ajusta en `GAME_CONFIG.graphics`.

## Estructura

```
src/
  config.js           GAME_CONFIG: todos los valores ajustables (cámara, vehículo, colisiones, pista, debug)
  Game.js             Loop (física a paso fijo de 120 Hz), estados, reinicio
  Car.js              Malla del auto + física arcade + inclinación/suspensión visual
  Track.js            Línea central (TrackPath), superficie, paredes, obstáculos, decoración
  Collision.js        Colisiones con círculos: auto↔pared, auto↔obstáculo, auto↔auto
  CameraRig.js        Cámara compartida: encuadre, zoom acotado, prioridad al líder
  OffscreenTracker.js Estados OUT_OF_SCREEN / countdown / eliminación
  Debug.js            Panel de debug, zona segura en pantalla, marcadores y ayudas 3D
  powerups/
    PowerUpManager.js Cajas, inventarios, entidades del mundo y efectos; contexto para cada power-up
    ItemBox.js        Caja flotante con respawn
    PlayerInventory.js Slot único EMPTY / HAS_ITEM
    EffectManager.js  Efectos temporales por auto (clase base Effect)
    Particles.js      Partículas compartidas (un InstancedMesh)
    types/            Turbo, Bomb, Oil, Magnet, Shield + registro (index.js)
  HUD.js / style.css  Interfaz HTML/CSS
  Input.js            Teclado
```

## Cómo funciona la cámara

1. Toma los autos vivos, su punto medio y la distancia entre ellos.
2. Calcula la distancia de cámara necesaria para que ambos ocupen `camera.framing` de la zona segura (con la proyección real: el borde de abajo y el de arriba no son simétricos por la inclinación).
3. La limita entre `minDistance` y `maxDistance`.
4. Mueve el foco hacia el punto medio y la distancia hacia la necesaria con suavizado (`smoothing`, `zoomOutSmoothing`, `zoomInSmoothing`). Si el suavizado se atrasa y alguien está por salir de la zona segura, la distancia sube de inmediato (`hardFraming`), pero nunca por encima del máximo.
5. Con la distancia máxima alcanzada, el foco se restringe para que el líder (el que más avanzó en la pista) siga dentro de `leaderFraming`: el que va atrás sale de pantalla.
6. La orientación sigue el sentido de la pista entre el punto medio de los jugadores y un poco por delante del líder (`yawLookAhead`, `yawSmoothing`).

## Qué ajustar primero (`src/config.js`)

- Cámara: `camera.minDistance`, `maxDistance`, `safeMargin`, `framing`, `smoothing`, `pitch`.
- Manejo: `vehicle.acceleration`, `accelerationCurve`, `throttleResponse`, `maxSpeed`, `braking`, `friction`, `drag`, `turnSpeed`, `highSpeedTurnFactor`, `yawResponse`, `grip`, `driftGripLoss`.
- Colisiones: `collision.wallBounce`, `wallFriction`, `carBounce`, `spin`.
- Eliminación: `outOfScreen.countdown`, `graceTime`.
- Pista: `track.controlPoints` (spline cerrada) y `track.obstacles`.
- Power-ups: `POWERUP_CONFIG` (duraciones, fuerzas, probabilidades `weight`, posiciones y respawn de cajas).

## Créditos

- Modelo del auto: [«2023 Toyota Corolla Hybrid»](https://sketchfab.com/3d-models/2023-toyota-corolla-hybrid-cd2f6b34664442ad906a40bd00136881) por [tonielpro520](https://sketchfab.com/tonielpro520), licencia [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Modificado: repintado (azul medianoche / rojo), materiales ajustados y optimizado con gltf-transform (`src/assets/models/corolla.glb`).
- Tipografías Lilita One, Nunito y JetBrains Mono (SIL Open Font License, ver `src/ui/fonts/LICENSE.md`), incluidas desde el diseño de `CDesign/`.
