import './style.css';
import { Game } from './Game.js';
import { Menu } from './ui/Menu.js';
import { loadSettings } from './ui/Settings.js';
import { GAME_CONFIG } from './config.js';
import { loadCarModel } from './world/CarModel.js';
// Modelo 3D del auto, optimizado con gltf-transform (Vite lo copia al build y devuelve su URL)
import carModelUrl from './assets/models/corolla.glb?url';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const settings = loadSettings();
let game = null;

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

async function boot() {
  const started = performance.now();
  menu.showLoading('CARGANDO CALLES…');
  // El modelo del auto se descarga mientras se arma el resto
  const carModel = GAME_CONFIG.vehicle.model.enabled ? loadCarModel(carModelUrl) : Promise.resolve(null);
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
  });
  game.applySettings(settings);
  menu.setProgress(0.5);
  const model = await carModel;
  if (model) for (const car of game.cars) car.applyModel(model);
  menu.setProgress(0.65);
  await nextFrame();

  game.warmup(); // compila shaders antes de la primera carrera
  menu.setProgress(0.85);
  await nextFrame();

  menu.setThumbnails(game.makeThumbnails());
  menu.setProgress(1);
  // La pantalla de carga se ve al menos un momento (y deja leer el consejo)
  await wait(Math.max(0, 1400 - (performance.now() - started)));
  menu.showHome();

  if (import.meta.env.DEV) Object.assign(window, { game, menu });
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
