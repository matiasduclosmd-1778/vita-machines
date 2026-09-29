// Registro de power-ups. Para agregar uno nuevo (Rocket, Freeze, …):
//  1. crear types/MiPowerUp.js exportando { id, name, icon, color, config, use(ctx, car) };
//  2. agregar su bloque en POWERUP_CONFIG (con `weight`);
//  3. sumarlo a esta lista.
import { Turbo } from './Turbo.js';
import { Bomb } from './Bomb.js';
import { Oil } from './Oil.js';
import { Magnet } from './Magnet.js';
import { Shield } from './Shield.js';

export const POWERUP_TYPES = [Turbo, Bomb, Oil, Magnet, Shield];
