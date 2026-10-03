// Registro de power-ups. Para agregar uno nuevo (Rocket, Freeze, …):
//  1. crear types/MiPowerUp.js exportando { id, name, icon, color, config, use(ctx, car) };
//  2. agregar su bloque en POWERUP_CONFIG (con `weight`);
//  3. sumarlo a esta lista;
//  4. online: si deja un objeto en pista, darle netKind/netState() y una vista en ENTITY_VIEWS;
//     si aplica un efecto, sumar su clase a EFFECT_TYPES.
import { Turbo, TurboEffect } from './Turbo.js';
import { Bomb, StunnedEffect, BombView } from './Bomb.js';
import { Missile, MissileView } from './Missile.js';
import { Oil, SlippingEffect, OilView } from './Oil.js';
import { Magnet, MagnetEffect } from './Magnet.js';
import { Shield, ShieldEffect } from './Shield.js';
import { Heart, HealEffect } from './Heart.js';
import { Gun, GunEffect, BulletView } from './Gun.js';
import { Flamethrower, FlamethrowerEffect, BurningEffect, FlameView } from './Flamethrower.js';

export const POWERUP_TYPES = [Turbo, Bomb, Missile, Oil, Magnet, Shield, Heart, Gun, Flamethrower];

// Online: efectos y objetos en pista que el invitado recrea a partir del estado del anfitrión
export const EFFECT_TYPES = Object.fromEntries([TurboEffect, StunnedEffect, SlippingEffect, MagnetEffect, ShieldEffect, HealEffect, GunEffect, FlamethrowerEffect, BurningEffect].map((E) => [E.id, E]));
export const ENTITY_VIEWS = { bomb: BombView, missile: MissileView, oil: OilView, bullet: BulletView, flame: FlameView };
