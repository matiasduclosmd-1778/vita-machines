# Vita Machines — MVP

**Jugar online:** https://vita-machines.vercel.app

Juego de carreras de autitos de juguete en 3D (Three.js + Vite), 2 jugadores en el mismo teclado con cámara compartida.

```bash
npm install
npm run dev
```

## Menús (HUB)

Basados en `CDesign/VitaMachines HUB.html`. Flujo local: **Carga → (nombre) → Inicio → Crear partida → Elegí tu piloto → carrera**. Online: ver [Online](#online).

- **Nombre**: obligatorio la primera vez que se entra; se cambia desde el inicio («✎ Cambiar nombre»).
- **Crear partida**: nombre, modo Carrera, mapa (El Escritorio o El Living), rival, vueltas (5, 8 o 10) y power-ups (No, Pocos, Medios o Muchos).
- **Elegí tu piloto**: cada jugador elige con sus teclas de girar y confirma con la de usar objeto (o con el mouse, el jugador 1); `ESC` deshace la confirmación. Con los dos listos, el jugador 1 arranca. Si eligen el mismo piloto, el auto del jugador 2 sale con su color. Los otros modos y mapas figuran como *próximamente*.
  - **VS CPU**: un jugador (WASD + Espacio) contra la computadora, en Fácil / Normal / Difícil. La CPU elige un piloto al azar distinto del tuyo.
  - **VS Local**: dos jugadores en el mismo teclado.
- **Teclado**: reasignación real de las teclas de ambos jugadores (se intercambian si ya están en uso).
- **Configuración**: calidad gráfica, sombras, resolución interna, efecto miniatura, pantalla completa, brillo, tiempo fuera de pantalla y panel de debug.
- **Jugar online**: lista de lobbies públicos, unirse con código o crear un lobby (ver [Online](#online)).
- Los ajustes, las teclas y los últimos pilotos elegidos se guardan en el navegador (`localStorage`).
- Durante la carrera: `ESC` pausa (continuar, reiniciar o volver al menú).

Código en `src/ui/` (`Menu.js`, `menu.css`, `Settings.js`, tipografías en `src/ui/fonts/`); la ilustración de fondo está en `public/ui/street.jpg`.

## Online

Hasta 6 jugadores, cada uno en su computadora. Usa **Supabase Realtime** (canales broadcast, sin base de datos) del proyecto `vita-machines` (organización CUPULABS). Las variables están en `.env.local` y en Vercel:

```
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…   # clave pública: puede ir en el navegador
```

Sin esas variables (o con `?net=local` en la URL) el online funciona entre **pestañas del mismo navegador** (BroadcastChannel), útil para probar.

Flujo:
1. **Crear lobby**: nombre, público (aparece en la lista) o privado (solo con el código de 6 letras), vueltas y power-ups.
2. **Lobby**: jugadores, chat y código. Cada invitado pone **Listo**; cuando están todos (y hay al menos 2), al anfitrión se le habilita **Seleccionar piloto**.
3. **Elegí tu piloto**: cada uno elige y confirma (se ve qué eligió cada uno). Se puede repetir piloto: el auto repetido sale con el color del lugar del jugador. Cuando confirman todos, arranca la carrera.
4. **Carrera**: cámara compartida como en local (el que queda fuera de pantalla 3 s queda eliminado; el último en pie o el primero en completar las vueltas gana). `ESC` no pausa: abre un menú para seguir o salir. Se maneja con WASD o flechas y se usa el objeto con Espacio o Enter.
5. Al terminar, el anfitrión vuelve a todos al **lobby** (los invitados tienen que volver a poner Listo).

Cómo funciona (`src/net/`):
- `transport.js`: canales de mensajes (Supabase o BroadcastChannel).
- `Online.js`: lista de lobbies (cada anfitrión se anuncia cada 2 s en un canal común) y sesión de lobby. El **anfitrión es la autoridad**: guarda el estado del lobby (jugadores, listos, pilotos, fase) y lo reenvía; detecta desconexiones por latido (`online.dropTimeout`).
- `NetRace.js`: en la carrera el anfitrión simula todo y manda el estado `online.snapshotRate` veces por segundo (autos, cajas, objetos en pista, efectos y eventos como explosiones). Los invitados no simulan: muestran ese estado con `online.interpolationDelay` de retraso, interpolando, y mandan sus controles cuando cambian. Por eso el auto propio de un invitado responde con un poco de demora (lo que tarda la ida y vuelta).
- `OnlineController.js`: une la sesión con el menú (`src/ui/OnlineScreens.js`) y el juego.
- Si el anfitrión se va, el lobby se cierra para todos. Un invitado que se desconecta en carrera queda eliminado.
- Plan gratis de Supabase: ~100 mensajes por segundo y 200 conexiones por proyecto; con 6 jugadores una carrera usa ~12 estados/s del anfitrión más los controles de cada uno.

## Controles

| | Acelerar | Frenar / reversa | Girar | Usar objeto | Saltar |
|---|---|---|---|---|---|
| Jugador 1 | W | S | A / D | Espacio | Shift izq. |
| Jugador 2 | ↑ | ↓ | ← / → | Enter | Shift der. |
| Jugador 3 | I | K | J / L | U | O |
| Jugador 4 | Num 8 | Num 5 | Num 4 / 6 | Num 0 | Num Enter |
| **Joystick** (todos igual) | RT | LT o B | Stick / cruceta | X (mantener = arma automática) | A |

Todo se reasigna en **Jugadores** (también qué joystick usa cada uno). Todos los vehículos saltan; la moto, un poco más alto.

- `ESC` / Start: pausa · `R`: reiniciar · `M`: silenciar · `G`: calidad gráfica · `V`: modo debug
- **Menús con joystick:** al tocar el mando aparecen los botones a apretar al costado de cada acción (modo mando). Cruceta o stick mueven, A elige, B vuelve; START arranca la partida; en la pausa, Y reinicia y X va al menú; en el podio, A revancha y B menú (online: A vuelve al lobby, B sale).
- En desarrollo, `window.game` está expuesto en la consola.

## Reglas

Cada ronda (también al reiniciar o en la revancha) empieza con una cuenta 3‑2‑1‑¡YA! (`race.countdown`): los autos quedan quietos y acelerar solo hace rugir el motor. Online la lleva el anfitrión.

La partida se juega a **rondas** (6 por defecto, `GAME_CONFIG.race.rounds`; no hay vueltas). Cada ronda la gana el último que queda en carrera. El ganador festeja en modo cine (franjas negras, sin HUD): la cámara baja desde la vista de juego y hace un paneo alrededor del vehículo, de atrás hasta el frente, terminando a su altura (`camera.cinematic`), mientras da dos saltitos con una vuelta sobre sí mismo y aparece "GANADOR {nombre}". Después todos vuelven a largar.

Gana la partida el que más rondas gana. Termina antes si alguien ya no puede ser alcanzado; si al final hay empate arriba, se juega una ronda extra. Si en una ronda quedan todos afuera a la vez, nadie suma y se repite.

Se pierde de dos formas:
- **Quedar atrás:** si la cámara te deja fuera de la zona segura (el rectángulo interno de `camera.safeMargin`), quedás eliminado en el acto.
- **Quedarse sin vida:** cada jugador tiene 100 de vida (`health.max`). La bomba saca 35, el misil 80 y el imán 15 (`damage` de cada objeto en `POWERUP_CONFIG`; el aceite, 0). Con 0 el auto explota y queda eliminado. El escudo bloquea el daño. La vida se ve en la fila de cada jugador y debajo de su nombre sobre el auto.
La cámara nunca se aleja más que `camera.maxDistance` para salvar al que va atrás.

## Piloto de la computadora (VS CPU)

`src/ai/AIDriver.js` genera el mismo input que el teclado y usa los objetos por el mismo sistema que un jugador: maneja el mismo auto con las mismas reglas. Calcula a qué velocidad puede tomar cada curva según el giro real del auto, frena con anticipación, es más prudente donde no hay baranda, llega rápido al salto, esquiva obstáculos, busca cajas y se destraba si queda contra algo. Su balance está en `GAME_CONFIG.ai.difficulties` (velocidad, prudencia en curvas y bordes, precisión, tiempo de reacción y criterio con los objetos).

## Power-ups

Cajas "?" en la pista según la cantidad elegida (`POWERUP_CONFIG.itemBoxes`): **Pocos** 4 cajas que reaparecen a los 10 s, **Medios** 8 cajas a los 6 s, **Muchos** 19 cajas a los 3,5 s. Cada posición indica en qué cantidades aparece (`in`). Al tocar una, el jugador recibe un objeto al azar si su slot está vacío (`EMPTY` → `HAS_ITEM`); si ya tiene uno, la caja queda para el otro.

| Objeto | Efecto |
|---|---|
| 🚀 TURBO | Más aceleración y velocidad máxima durante unos segundos |
| 💣 BOMB | Proyectil hacia adelante: al impactar hace volar al rival dando una vuelta en el aire y lo deja aturdido un rato después de aterrizar; contra una pared desaparece |
| 🎯 MISSILE | Misil teledirigido: sigue la pista y, cuando tiene al rival cerca, va directo hacia él (una mira roja marca al perseguido). Al impactar lo frena casi del todo y lo hace volar más alto que la bomba, con una vuelta en el aire y aturdimiento al aterrizar; choca contra paredes |
| 🛢️ OIL | Mancha detrás del auto: quien la pisa pierde grip y derrapa (el que la deja es inmune al principio) |
| 🧲 MAGNET | Atrae moderadamente al rival si está a menos de `maxDistance` |
| 🛡️ SHIELD | Cúpula que bloquea bomba, misil, aceite e imán (una bomba o un misil la rompen) |
| 🔫 GUN | Ametralladora con 40 balas hacia donde apunta el vehículo, 4 de daño cada una (160 en total). Tocar "usar objeto" dispara una; mantenerlo, en automático (10 por segundo). Queda en el casillero (con contador) hasta la última bala; el escudo, las paredes y los obstáculos frenan las balas |
| 🔥 FLAME | Lanzallamas: chorro de fuego corto hacia adelante (~11 u quieto, ~20 u a fondo). Tiene carga para 3,5 s de fuego (el casillero la muestra en %); tocar "usar objeto" lanza una bocanada y mantenerlo, fuego continuo. Cada bocanada que toca saca 0,7 de vida (el tanque entero sobre un rival quieto, unos 70 con el ardor) y deja al rival ardiendo 1,5 s (4 de vida por segundo). El escudo y las paredes lo apagan |
| ❤️ HEART | Corazón de vida: restaura el 100% de la vida. Sale un poco menos que los demás; la CPU lo guarda hasta tener 55 o menos |

Para agregar uno nuevo: crear `src/powerups/types/MiObjeto.js` con `{ id, name, icon, color, config, use(ctx, car) }`, agregar su bloque en `POWERUP_CONFIG` y registrarlo en `src/powerups/types/index.js`. Las explosiones que golpean un auto usan `ctx.blast(target, dir, cfg)` (frena, empuja, lo hace volar con `car.launch` y lo aturde). Los efectos temporales extienden `Effect` (`src/powerups/EffectManager.js`) y modifican `car.mods` (aceleración, velocidad máxima, grip, dirección, acelerador).

## Pilotos y autos

Cada piloto (`GAME_CONFIG.drivers`) maneja su auto con su pintura:

| Piloto | Auto | Velocidad | Aceleración | Manejo | Resistencia |
|---|---|---|---|---|---|
| El Coco | Toyota Corolla · azul medianoche | 9 | 7 | 5 | 7 |
| Dj Domono | Peugeot Partner · blanca | 6 | 5 | 6 | 10 |
| Dr Faxo | Renault Clio · gris topo | 7 | 9 | 9 | 5 |
| PabloQuemandoRuedas | Yamaha XTZ 125 · azul y naranja | 8 | 10 | 8 | 3 |

Las stats cambian el manejo respecto de la base (7) según `GAME_CONFIG.driverStats`: Velocidad → velocidad máxima, Aceleración → empuje, Manejo → giro y grip, Resistencia → cuánto lo empujan, frenan y aturden la bomba y el misil. Los km/h de la tarjeta son solo de muestra. Retratos e imágenes de los autos en `src/assets/pilots/` (WebP).

Los modelos 3D están en `GAME_CONFIG.cars` (`src/config.js`): archivo, material que se repinta con el color del piloto, corrección de orientación y ajustes de materiales por nombre. Un modelo `textured` (todo en una sola textura, como la moto) no se repinta: conserva su textura y, si el piloto está repetido, toma un tinte del color del jugador. `length` cambia su largo y `lean: true` lo inclina hacia adentro en las curvas. Si un piloto no tiene `portrait` o `carImage`, su tarjeta muestra sus iniciales y un render del modelo 3D. Los modelos se cargan en paralelo al iniciar (`src/world/CarModel.js`); si alguno está riggeado (piezas ubicadas por huesos, como el Partner) se hornea su pose en una malla común.

Para agregar uno:

```bash
npx @gltf-transform/cli optimize original.glb src/assets/models/nuevo.glb \
  --compress meshopt --texture-compress webp --texture-size 1024 --palette false \
  --simplify-ratio 0.3 --simplify-error 0.001
```

(`--palette false` es importante: sin eso se fusionan los materiales y no se puede identificar la pintura.) Después, sumar su entrada en `GAME_CONFIG.cars`.

## Gráficos

- Posprocesado (`src/world/PostFX.js`): MSAA → oclusión ambiental (GTAO) → bloom en luces → tone mapping ACES → efecto miniatura (tilt-shift) → corrección de color y viñeta. En calidad baja: sin AO ni tilt-shift, resolución 1x y SMAA.
- Iluminación basada en imagen: mapa de entorno generado en tiempo real (cielo de tarde + ventana del lado del sol) que ilumina y se refleja en todos los materiales.
- Materiales físicos (`src/world/materials.js`): pintura con barniz, plástico, cerámica, cromo, vidrio con refracción (cajas "?"), pompa iridiscente (escudo), aceite tornasolado.
- Todo se ajusta en `GAME_CONFIG.graphics`.

## Música y sonido

Todo el audio se sintetiza en vivo con Web Audio (sin archivos), en `src/audio/`. Arranca con la primera tecla, clic o botón del joystick (el navegador no deja sonar nada antes). Volúmenes en Configuración → Audio; **M** silencia.

- **Música** (`Music.js`): synthwave con secuenciador de 16 pasos, pads de sierras desafinadas, bajo con "bombeo" (sidechain), arpegios con delay a tempo, snare con reverb grande.
  - `menu` 118 BPM, La menor. En la elección de piloto entra la batería completa y la melodía.
  - `race` 138 BPM, Mi menor, con estribillo. En la última vuelta se abren los filtros y el lead no para.
  - `victory` fanfarria ♭VI–♭VII–I que sigue en `podium` (112 BPM, Do mayor).
- **Efectos** (`Sfx.js`): motores por auto (rpm con cambios simulados, la moto más aguda), derrape, choques, paredes, saltos, aterrizajes, trompos, caídas, cada power-up, explosiones, vueltas, última vuelta, cuenta fuera de pantalla, eliminación y la interfaz. Se panean según dónde está el auto en pantalla.
- Online, el anfitrión les manda a los invitados los sonidos que solo él simula (choques, objetos usados, etc.).
- **Locutor** (`Voices.js`): al confirmar un piloto se escucha su nombre; en el podio, "The winner is…" y el nombre del ganador. La música baja mientras habla. Las voces originales están en `NewSound/` y se procesan con `python3 tools/voices.py` (limpieza de ruido, tono más grave, capa una octava abajo, vocoder en La menor 7, EQ, saturación, compresión, chorus, eco a 118 BPM y reverb) → `src/assets/voices/`. Los ajustes de cada voz (semitonos, vocoder, reverb, eco) están al principio del script.

## Mapas

| Mapa | Cómo es |
|---|---|
| El Escritorio | Pista sobre un escritorio gigante: precipicio, tramo elevado sin barreras, un salto y un atajo por una regla |
| El Living | Pista de juguete por todo un living de noche (1 u ≈ 3 cm, los muebles con su altura real): sube a la mesa del comedor por una silla y baja por el mantel, pasa por adentro de un estante, cruza una regla angosta hasta el sillón (almohadones con ranuras; atajo por arriba del respaldo), salta del apoyabrazos al ventanal elevado (con un tramo roto), **loop guiado** (entrando a 20 u/s o más se da la vuelta; más lento, se despega arriba y se cae), chicana en la alfombra a cuadros donde la mano del que está agachado empuja un autito rojo de un lado a otro de la pista (obstáculo que se mueve), mesita ratona sin bordes y túnel por el cubo azul. Texturas fotográficas (parquet, terciopelo, lino, bouclé, yeso, roble, algodón y polar) y personas con articulaciones (cinemática inversa: uno tipea en la notebook, el otro sigue el autito con la mano) |

Cada mapa vive en `src/maps/` y se registra en `src/maps/index.js` con su pista, sus cajas de objetos, cómo se dibuja la pista y su ambiente. El Living usa el formato genérico de pista (`src/maps/living.js`): alturas por puntos clave (`profile`), huecos (`gaps`), tramos sin baranda (`open`), tramos angostos (`widths`), un atajo con su propio perfil y los muebles como superficies (`surfaces`: si te caés fuera de la pista, caés arriba del mueble). El juego arma cada mapa la primera vez que se juega. Online, el anfitrión elige el mapa al crear el lobby.

## Estructura

```
src/
  config.js           GAME_CONFIG: todos los valores ajustables (cámara, vehículo, colisiones, pista, debug)
  Game.js             Loop (física a paso fijo de 120 Hz), estados, reinicio
  Car.js              Malla del auto + física arcade + inclinación/suspensión visual
  Track.js            Línea central (TrackPath), superficie, paredes, obstáculos, decoración
  maps/               Mapas: registro (index.js), El Living (pista, visuales y ambiente)
  Collision.js        Colisiones con círculos: auto↔pared, auto↔obstáculo, auto↔auto
  CameraRig.js        Cámara compartida: encuadre, zoom acotado, prioridad al líder
  OffscreenTracker.js Estados OUT_OF_SCREEN / countdown / eliminación
  Debug.js            Panel de debug, zona segura en pantalla, marcadores y ayudas 3D
  net/                Online: transporte, lobbies, sincronización de la carrera (ver Online)
  powerups/
    PowerUpManager.js Cajas, inventarios, entidades del mundo y efectos; contexto para cada power-up
    ItemBox.js        Caja flotante con respawn
    PlayerInventory.js Slot único EMPTY / HAS_ITEM
    EffectManager.js  Efectos temporales por auto (clase base Effect)
    Particles.js      Partículas compartidas (un InstancedMesh)
    types/            Turbo, Bomb, Missile, Oil, Magnet, Shield + registro (index.js)
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

- Texturas fotográficas de El Living: [Poly Haven](https://polyhaven.com) (licencia CC0): rectangular_parquet, velour_velvet, rough_linen, wool_boucle, painted_plaster_wall, black_oak_veneer, oak_veneer_01, cotton_jersey, knitted_fleece. Recomprimidas en `public/textures/living/` (las telas, en gris para teñirlas con los colores de la referencia).

- Modelos de los autos (modificados: repintados con el color de cada jugador, materiales ajustados y optimizados con gltf-transform, en `src/assets/models/`):
  - [«2023 Toyota Corolla Hybrid»](https://sketchfab.com/3d-models/2023-toyota-corolla-hybrid-cd2f6b34664442ad906a40bd00136881) por [tonielpro520](https://sketchfab.com/tonielpro520), licencia [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) (`corolla.glb`).
  - [«Clio 2»](https://sketchfab.com/3d-models/clio-2-2c4d2cb0cda14dc9b2ddcd7d2b3a1f95) por [Nardeol](https://sketchfab.com/Nardeol), licencia [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) (`clio.glb`).
  - [«Peugeot Partner Tepee»](https://sketchfab.com/3d-models/peugeot-partner-tepee-403c297a63424f959906043cd6942cee) por [KOElkast1007](https://sketchfab.com/koelkastasbers), licencia [Sketchfab Standard](https://sketchfab.com/licenses) (`peugeot.glb`).
- Tipografías Lilita One, Nunito y JetBrains Mono (SIL Open Font License, ver `src/ui/fonts/LICENSE.md`), incluidas desde el diseño de `CDesign/`.
