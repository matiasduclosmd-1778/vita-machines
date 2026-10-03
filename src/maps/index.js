// Registro de mapas. Cada uno tiene su pista (ver Track), sus cajas de objetos, cómo se dibuja
// la pista y su ambiente (luces, habitación, muebles). Game arma un mapa la primera vez que se
// juega y después lo reutiliza.
import { GAME_CONFIG, POWERUP_CONFIG } from '../config.js';
import { buildTrackVisuals } from '../track/TrackVisuals.js';
import { Environment } from '../world/Environment.js';
import { LIVING_TRACK, LIVING_BOXES } from './living.js';
import { buildLivingTrack } from './LivingTrackVisuals.js';
import { LivingEnvironment } from './LivingEnvironment.js';

export const MAPS = {
  desk: {
    id: 'desk',
    name: 'El Escritorio',
    raceName: 'Carrera en el escritorio', // nombre por defecto de la partida
    thumb: null, // la miniatura se saca de la escena al cargar (ver Game.makeThumbnails)
    track: GAME_CONFIG.track,
    boxes: POWERUP_CONFIG.itemBoxes.positions,
    visuals: buildTrackVisuals,
    Environment,
  },
  living: {
    id: 'living',
    name: 'El Living',
    raceName: 'Carrera en el living',
    thumb: '/ui/living.jpg',
    track: LIVING_TRACK,
    boxes: LIVING_BOXES,
    visuals: buildLivingTrack,
    Environment: LivingEnvironment,
    // Paneo de presentación (posición de cámara → a dónde mira): vista general, mesa del comedor,
    // sillón y loop; después baja hasta detrás de la grilla de largada (ver CameraRig.flyThrough)
    intro: [
      [[150, 165, 215], [10, 0, -10]],
      [[70, 52, 18], [122, 24, 70]],
      [[10, 50, -62], [5, 16, -132]],
      [[-140, 34, -8], [-187, 11, -30]],
    ],
  },
};

export const DEFAULT_MAP = 'desk';
