import './style.css';
import { Game } from './Game.js';
import { Menu } from './ui/Menu.js';
import { setVehicleRenders } from './ui/pilots.js';
import { audio } from './audio/index.js';
import { input, parsePad } from './Input.js';
import { setPadMode } from './ui/padHints.js';
import { loadSettings } from './ui/Settings.js';
import { GAME_CONFIG } from './config.js';
import { POWERUP_TYPES } from './powerups/types/index.js';
import { loadCarModel, renderCarImage } from './world/CarModel.js';
import { OnlineController } from './net/OnlineController.js';
// Modelos 3D de los autos, optimizados con gltf-transform (Vite los copia al build y devuelve sus URLs)
const MODEL_URLS = import.meta.glob('./assets/models/*.glb', { query: '?url', import: 'default', eager: true });

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const settings = loadSettings();
let game = null;

// Audio: el navegador lo habilita recién con un gesto del jugador (tecla, clic o joystick)
audio.setVolumes(settings.audio);
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);
input.onPress((code) => {
  unlock();
  if (parsePad(code)) setPadMode(true); // modo mando: se ven los botones del joystick en la interfaz
  return false; // no se queda con el evento
});
// Mouse o teclado (reales) vuelven a mostrar las teclas
window.addEventListener('keydown', (e) => e.isTrusted && setPadMode(false), true);
window.addEventListener('mousemove', (e) => Math.abs(e.movementX) + Math.abs(e.movementY) > 6 && setPadMode(false)); // un temblor no cuenta
// M: silenciar / volver a escuchar
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || e.target.closest?.('input')) return;
  const muted = audio.toggleMute();
  menu.toast(muted ? 'Sonido silenciado (M)' : 'Sonido activado');
});

const menu = new Menu(document.getElementById('menu'), settings, {
  onStartRace: (race) => startRace(race),
  onApplySettings: (s) => game?.applySettings(s),
  onResume: () => game.resume(),
  onRestart: () => {
    game.restart();
    game.resume();
  },
  onQuitToMenu: () => {
    game.stop();
    menu.showHome();
  },
});
// Online: lobbies, elección de piloto y carrera sincronizada (ver src/net/)
const online = new OnlineController(menu, () => game, settings);
menu.online = online;

async function boot() {
  const started = performance.now();
  menu.showLoading('CARGANDO CALLES…');
  warmGlyphs();
  // Los modelos de los autos se descargan (en paralelo) mientras se arma el resto
  const carModels = GAME_CONFIG.vehicle.model.enabled
    ? Promise.all(GAME_CONFIG.cars.map((spec) => loadCarModel(MODEL_URLS[`./assets/models/${spec.file}`], spec)))
    : Promise.resolve([]);
  await document.fonts.load('40px "Lilita One"').catch(() => {});
  drawFavicon();
  menu.setProgress(0.12);
  await nextFrame();

  // Construir el mundo es lo más pesado: pista, entorno, autos, posprocesado
  game = new Game(document.getElementById('app'), document.getElementById('hud'), {
    onPause: () => menu.showPause(),
    onMenu: () => {
      game.stop();
      menu.showHome();
    },
    onOnlineMenu: () => menu.showOnlinePause(),
    online: { back: () => online.backToLobby(), leave: () => online.leave() },
  });
  game.applySettings(settings);
  // Solo en desarrollo (npm run dev): acceso para pruebas automáticas desde la consola
  if (import.meta.env.DEV) window.__vm = { game, menu, startRace };
  menu.setProgress(0.5);
  const models = (await carModels).filter(Boolean);
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  game.setCarModels(byId);
  // Pilotos sin ilustración del vehículo: la tarjeta usa un render del modelo 3D
  setVehicleRenders(
    Object.fromEntries(
      GAME_CONFIG.drivers.filter((d) => !d.carImage && byId[d.car]).map((d) => [d.id, renderCarImage(byId[d.car], d.paint)]),
    ),
  );
  menu.setProgress(0.65);
  await nextFrame();

  game.warmup(); // compila shaders antes de la primera carrera
  menu.setProgress(0.85);
  await nextFrame();

  menu.setThumbnails(game.makeThumbnails());
  menu.setProgress(1);
  // La pantalla de carga se ve al menos un momento (y deja leer el consejo)
  await wait(Math.max(0, 1400 - (performance.now() - started)));
  // El nombre del piloto es obligatorio: la primera vez se pide antes de llegar al inicio
  if (settings.profile.name) menu.showHome();
  else menu.showName({ required: true });

  if (import.meta.env.DEV) Object.assign(window, { game, menu, online, audio });
}

async function startRace(race) {
  menu.showLoading(race.name.toUpperCase() + '…');
  menu.setProgress(0.3);
  await nextFrame();
  game.startRace(race);
  game.pause(); // arranca quieta mientras termina la "carga"
  game.warmup();
  menu.setProgress(1);
  await wait(700);
  menu.hide();
  game.resume();
}

/**
 * Los emojis de los objetos (🚀 💣 🛡️ ❤️…) y los símbolos del HUD se dibujan una vez, invisibles,
 * durante la carga: la primera vez que el navegador pinta un emoji carga su fuente, y si eso pasara
 * al juntar la primera caja, la carrera daría un tirón.
 */
function warmGlyphs() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:0;bottom:0;opacity:0.01;pointer-events:none;font-size:18px;z-index:-1';
  el.textContent = [...POWERUP_TYPES.map((t) => t.icon), '★', '🎮', '🤖', '✚', '✓'].join(' ');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/** Ícono de la pestaña, dibujado como en el diseño: asfalto, monograma VM y franja de obra. */
function drawFavicon() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = 14;
  ctx.beginPath();
  ctx.roundRect(1, 1, size - 2, size - 2, r);
  ctx.fillStyle = '#3b4250';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ffc93c';
  ctx.fillRect(28, 0, 3, size);
  // franja de obra inclinada
  ctx.translate(0, 48);
  ctx.rotate(-0.12);
  ctx.fillStyle = '#111318';
  ctx.fillRect(-10, -2, size + 20, 14);
  ctx.fillStyle = '#ffc93c';
  for (let x = -10; x < size + 10; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x + 6, 10);
    ctx.lineTo(x + 12, 0);
    ctx.lineTo(x + 6, 0);
    ctx.fill();
  }
  ctx.restore();
  ctx.font = '34px "Lilita One", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#111318';
  for (const [ch, x, color] of [['V', 8, '#fff4dc'], ['M', 29, '#ffc93c']]) {
    ctx.strokeText(ch, x, 43);
    ctx.fillStyle = color;
    ctx.fillText(ch, x, 43);
  }
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = c.toDataURL('image/png');
}

boot();
