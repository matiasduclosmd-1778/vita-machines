import * as THREE from 'three';

// Texturas procedurales (canvas) del estilo visual: diorama de juguete estilizado,
// colores cálidos y saturados, superficies limpias con algo de desgaste.

export const PALETTE = {
  asphalt: '#5a5f6b',
  lineYellow: '#f2c14e',
  lineWhite: '#f3efe4',
  sidewalk: '#dccdb3',
  grout: '#c2b297',
  curb: '#c9c1b4',
  wood: '#c99a6b',
  terracotta: '#d9714e',
  cream: '#efe3c8',
  teal: '#3f8f8a',
  navy: '#3b5b7a',
  mustard: '#e2b13c',
  green: '#6cbf4a',
  greenDark: '#3f8d3a',
  red: '#d94b3d',
};

const cache = new Map();

/** Crea (y cachea) una textura dibujada en un canvas. */
export function canvasTexture(key, w, h, draw, { repeat = true, nearest = false } = {}) {
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (nearest) tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function speckle(ctx, w, h, count, colors, size = 2, rand = Math.random) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(rand() * colors.length) | 0];
    ctx.fillRect(rand() * w, rand() * h, size, size);
  }
}

/** Asfalto: una unidad de textura = 24 u de pista a lo largo, todo el ancho a lo ancho. */
export function asphaltTexture() {
  return canvasTexture('asphalt', 256, 512, (ctx, w, h) => {
    const r = rng(11);
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fillRect(0, 0, w, h);
    // manchas suaves (parches de reparación)
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 20 + r() * 40, 30 + r() * 70, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, w, h, 2600, ['rgba(255,255,255,0.07)', 'rgba(0,0,0,0.12)', 'rgba(40,40,50,0.2)'], 2, r);
    // grietas finas
    ctx.strokeStyle = 'rgba(25,25,32,0.55)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      let x = 30 + r() * (w - 60);
      let y = r() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 26;
        y += (r() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // líneas de borde blancas y central amarilla discontinua
    ctx.fillStyle = PALETTE.lineWhite;
    ctx.fillRect(12, 0, 6, h);
    ctx.fillRect(w - 18, 0, 6, h);
    ctx.fillStyle = PALETTE.lineYellow;
    ctx.fillRect(w / 2 - 4, 40, 8, 180);
    ctx.fillRect(w / 2 - 4, 296, 8, 180);
  });
}

/** Baldosas de vereda. */
export function sidewalkTexture() {
  return canvasTexture('sidewalk', 128, 128, (ctx, w, h) => {
    const r = rng(5);
    ctx.fillStyle = PALETTE.grout;
    ctx.fillRect(0, 0, w, h);
    const n = 2;
    const t = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const l = 225 + ((r() * 16) | 0);
        ctx.fillStyle = `rgb(${l},${l - 16},${l - 44})`;
        ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      }
    }
    speckle(ctx, w, h, 300, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.1)'], 2, r);
  });
}

/**
 * Pila de libros vista de costado (para los laterales de la pista).
 * v: 1 unidad de textura = 8 u de altura; u: 1 unidad = 16 u a lo largo.
 */
export function bookStackTexture() {
  return canvasTexture('books', 256, 512, (ctx, w, h) => {
    const r = rng(3);
    const covers = [PALETTE.terracotta, PALETTE.teal, PALETTE.navy, PALETTE.mustard, '#8c5a9e', '#5e8c4a', '#b84a4a'];
    let y = 0;
    while (y < h) {
      const bh = 40 + r() * 40;
      const color = covers[(r() * covers.length) | 0];
      ctx.fillStyle = color;
      ctx.fillRect(0, y, w, bh);
      // bloque de páginas (crema) con tapas de color arriba y abajo
      ctx.fillStyle = PALETTE.cream;
      ctx.fillRect(0, y + 7, w, bh - 14);
      ctx.strokeStyle = 'rgba(150,130,100,0.35)';
      ctx.lineWidth = 1;
      for (let k = y + 11; k < y + bh - 9; k += 4) {
        ctx.beginPath();
        ctx.moveTo(0, k);
        ctx.lineTo(w, k);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, y + bh - 2, w, 2);
      y += bh;
    }
  });
}

/** Franjas rojas y blancas de advertencia (bordes sin barrera). */
export function kerbTexture() {
  return canvasTexture('kerb', 32, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f5f1e8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(0, 0, w, h / 2);
  }, { nearest: true });
}

/** Franjas diagonales amarillas y negras (rampa de salto). */
export function hazardTexture() {
  return canvasTexture('hazard', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26262c';
    for (let k = -w; k < w * 2; k += 64) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + 32, 0);
      ctx.lineTo(k + 32 - h, h);
      ctx.lineTo(k - h, h);
      ctx.fill();
    }
  });
}

/** Flechas pintadas "▲▲" que avisan: ¡velocidad! */
export function chevronTexture() {
  return canvasTexture('chevron', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const y of [20, 70]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.lineTo(w - 14, y + 34);
      ctx.lineTo(w - 36, y + 34);
      ctx.lineTo(w / 2, y + 14);
      ctx.lineTo(36, y + 34);
      ctx.lineTo(14, y + 34);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Regla de madera (atajo). u = a lo ancho, v = a lo largo (1 unidad = 10 u). */
export function rulerTexture() {
  return canvasTexture('ruler', 128, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f1d58c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(160,110,40,0.25)';
    for (let x = 4; x < w; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 4, h * 0.3, x - 4, h * 0.6, x, h);
      ctx.stroke();
    }
    ctx.fillStyle = '#3b3024';
    for (let k = 0; k < 20; k++) {
      const y = (k / 20) * h;
      ctx.fillRect(w - (k % 5 === 0 ? 40 : 22), y, k % 5 === 0 ? 36 : 18, 3);
      ctx.fillRect(4, y, k % 5 === 0 ? 36 : 18, 3);
    }
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let k = 0; k < 4; k++) ctx.fillText(String(k + 1), w / 2, (k / 4) * h + 70);
  });
}

/** Cartel de advertencia (rombo amarillo con símbolo). */
export function signTexture(symbol) {
  return canvasTexture('sign-' + symbol, 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#26262c';
    ctx.fillRect(-44, -44, 88, 88);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(-39, -39, 78, 78);
    ctx.restore();
    ctx.fillStyle = '#26262c';
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, w / 2, h / 2 + 3);
  });
}

/** Madera del escritorio: tablas anchas y cálidas. */
export function deskTexture() {
  return canvasTexture('desk', 512, 512, (ctx, w, h) => {
    const r = rng(21);
    const tones = ['#cf9f6c', '#c89565', '#d6a874', '#c4905f'];
    const plank = h / 4;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = tones[i];
      ctx.fillRect(0, i * plank, w, plank);
      ctx.strokeStyle = 'rgba(120,70,30,0.16)';
      ctx.lineWidth = 2;
      for (let g = 0; g < 7; g++) {
        const y = i * plank + 8 + g * (plank - 16) / 6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i * 3 + g) * 3);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(90,50,20,0.35)';
      ctx.fillRect(0, i * plank, w, 3);
    }
    speckle(ctx, w, h, 800, ['rgba(255,255,255,0.05)', 'rgba(80,40,10,0.06)'], 3, r);
  });
}

/** Piso de la habitación (baldosas cálidas). */
export function floorTexture() {
  return canvasTexture('floor', 256, 256, (ctx, w, h) => {
    const r = rng(8);
    ctx.fillStyle = '#a98a6d';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const l = 200 + ((r() * 20) | 0);
        ctx.fillStyle = `rgb(${l},${l - 30},${l - 62})`;
        ctx.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      }
    }
  });
}

/** Alfombra circular. */
export function rugTexture() {
  return canvasTexture('rug', 512, 512, (ctx, w, h) => {
    const colors = [PALETTE.teal, PALETTE.cream, PALETTE.terracotta, PALETTE.cream, PALETTE.mustard, PALETTE.cream, PALETTE.teal];
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, (w / 2) * (1 - i / colors.length), 0, Math.PI * 2);
      ctx.fill();
    });
  }, { repeat: false });
}
