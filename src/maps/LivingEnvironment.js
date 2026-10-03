import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GAME_CONFIG } from '../config.js';
import { canvasTexture } from '../world/textures.js';
import { paintedMetal, glow } from '../world/materials.js';
import { LIVING } from './living.js';
import { LM, worldUV } from './livingMaterials.js';
import { makeHuman, pose, reach, BONES } from './Human.js';

const GFX = GAME_CONFIG.graphics;
const BG = '#14151b';
const SLAB = 1.2;

const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...opts });

/**
 * El living de noche: habitación, muebles, luces cálidas y las dos personas de la referencia.
 * Misma forma que Environment (el escritorio): sun, follow(), buildEnvMap(), setActive(), update().
 * Texturas fotográficas (ver livingMaterials.js) con coordenadas en unidades de mundo (worldUV),
 * así la trama tiene el mismo tamaño en todos los muebles. La pista y los obstáculos los dibuja
 * LivingTrackVisuals; acá están los volúmenes, que respetan las superficies de la física
 * (LIVING_TRACK.surfaces).
 */
export class LivingEnvironment {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.floorY = track.floorY;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.background = new THREE.Color(BG);
    this.fog = null;
    this.walls = [];
    this.time = 0;

    this.setupLights();
    this.buildRoom();
    this.buildSofa();
    this.buildDining();
    this.buildCoffeeTable();
    this.buildShelf();
    this.buildRug();
    this.buildCube();
    this.buildPlants();
    this.buildLamps();
    this.buildPeople();
  }

  add(object, { cast = true, receive = true } = {}) {
    object.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = cast;
        m.receiveShadow = receive;
      }
    });
    this.group.add(object);
    return object;
  }

  /** Malla con coordenadas de textura en unidades de mundo (uvScale = unidades por repetición). */
  solid(geo, mat, x, y, z, uvScale = 0, { rx = 0, ry = 0, rz = 0, cast = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    if (uvScale) {
      m.updateMatrixWorld(true);
      worldUV(geo, uvScale, m.matrixWorld);
    }
    return this.add(m, { cast });
  }

  // ---------------------------------------------------------------- luz

  setupLights() {
    // De noche: la lámpara colgante y la de pie dan luz cálida; por el ventanal entra un azul frío
    this.group.add(new THREE.HemisphereLight('#ffe6c8', '#3b2c22', 0.85));
    const sun = new THREE.DirectionalLight('#ffd9ad', 2.3); // "techo": la que hace sombras
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.radius = GFX.shadowSoftness;
    const s = sun.shadow.camera;
    s.left = s.bottom = -120;
    s.right = s.top = 120;
    s.near = 1;
    s.far = 500;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.sunOffset = new THREE.Vector3(-60, 170, 70);
    this.sun = sun;
    this.group.add(sun, sun.target);
    const moon = new THREE.DirectionalLight('#7ea6ff', 0.6); // por el ventanal
    moon.position.set(-90, 80, -260);
    this.group.add(moon);
  }

  buildEnvMap(renderer) {
    // Reflejos de un interior de noche: techo cálido, piso oscuro y un rectángulo frío (el ventanal)
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(100, 32, 16);
    const colors = [];
    const top = new THREE.Color('#ffd8a8').multiplyScalar(0.9);
    const mid = new THREE.Color('#6b5444').multiplyScalar(0.8);
    const bottom = new THREE.Color('#2a211b');
    const pos = geo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 100;
      if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.7));
      else c.copy(mid).lerp(bottom, Math.pow(-y, 0.5));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(70, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9cc0ff').multiplyScalar(1.6), side: THREE.DoubleSide }));
    win.position.set(-40, 20, -80);
    win.lookAt(0, 0, 0);
    env.add(win);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
  }

  setActive(on) {
    this.group.visible = on;
    if (!on) return;
    this.scene.background = this.background;
    this.scene.fog = this.fog;
    this.scene.environment = this.envMap ?? null;
    this.scene.environmentIntensity = GFX.envIntensity * 0.8;
  }

  follow(focus) {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
  }

  /** Cada cuadro: paredes que tapan la cámara y la animación de las personas. */
  update(camera, dt = 1 / 60) {
    const p = camera.position;
    for (const w of this.walls) w.mesh.visible = w.inside(p);
    this.time += dt;
    this.animatePeople(this.time);
  }

  // ---------------------------------------------------------------- habitación

  buildRoom() {
    const R = LIVING.room;
    const W = R.maxX - R.minX;
    const Dp = R.maxZ - R.minZ;
    const y0 = this.floorY;
    this.solid(new THREE.PlaneGeometry(W + 60, Dp + 60), LM.parquet(), 0, y0, 0, 70, { rx: -Math.PI / 2, cast: false });

    const wallMat = LM.wall();
    const H = R.wallHeight;
    // Cada pared es un grupo: lo que cuelga de ella (ventana, pósters) se oculta junto con la pared
    const wall = (w, x, z, rotY, inside) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
      m.position.set(x, y0 + H / 2, z);
      m.rotation.y = rotY;
      m.receiveShadow = true;
      m.updateMatrixWorld(true);
      worldUV(m.geometry, 60, m.matrixWorld);
      g.add(m);
      this.group.add(g);
      this.walls.push({ mesh: g, inside });
      return g;
    };
    const back = wall(W, 0, R.minZ, 0, (p) => p.z > R.minZ); // fondo (ventanal)
    wall(W, 0, R.maxZ, Math.PI, (p) => p.z < R.maxZ); // frente
    const left = wall(Dp, R.minX, 0, Math.PI / 2, (p) => p.x > R.minX); // izquierda
    const right = wall(Dp, R.maxX, 0, -Math.PI / 2, (p) => p.x < R.maxX); // derecha
    const onWall = (g, obj) => {
      this.group.remove(obj);
      g.add(obj);
      return obj;
    };

    // Zócalo blanco
    const skirting = std({ color: '#f1ece2', roughness: 0.5 });
    onWall(back, this.solid(new RoundedBoxGeometry(W, 3, 0.9, 1, 0.3), skirting, 0, y0 + 1.5, R.minZ + 0.45));
    onWall(left, this.solid(new RoundedBoxGeometry(0.9, 3, Dp, 1, 0.3), skirting, R.minX + 0.45, y0 + 1.5, 0));
    onWall(right, this.solid(new RoundedBoxGeometry(0.9, 3, Dp, 1, 0.3), skirting, R.maxX - 0.45, y0 + 1.5, 0));

    // Ventanal de noche: jardín oscuro detrás del vidrio, persiana americana entreabierta y marco negro
    const Wn = LIVING.window;
    const ww = Wn.x1 - Wn.x0;
    const cx = (Wn.x0 + Wn.x1) / 2;
    const garden = new THREE.Mesh(new THREE.PlaneGeometry(ww, 78), new THREE.MeshStandardMaterial({ map: gardenTexture(), emissive: '#ffffff', emissiveMap: gardenTexture(), emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.2 }));
    garden.position.set(cx, y0 + 44, R.minZ + 0.2);
    onWall(back, this.add(garden, { cast: false }));
    const slatGeo = new RoundedBoxGeometry(ww - 2, 1.25, 0.35, 1, 0.15);
    const slats = new THREE.InstancedMesh(slatGeo, std({ color: '#e7ecf2', roughness: 0.35, metalness: 0.1 }), 22);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.95, 0, 0));
    for (let k = 0; k < 22; k++) {
      m4.compose(new THREE.Vector3(cx, y0 + 80 - k * 3.4, R.minZ + 1.6), q, new THREE.Vector3(1, 1, 1));
      slats.setMatrixAt(k, m4);
    }
    onWall(back, this.add(slats, { cast: false }));
    const frame = paintedMetal('#24262c');
    onWall(back, this.solid(new RoundedBoxGeometry(ww + 3, 2.4, 2, 1, 0.4), frame, cx, y0 + 4.6, R.minZ + 1));
    onWall(back, this.solid(new RoundedBoxGeometry(ww + 3, 2.4, 2, 1, 0.4), frame, cx, y0 + 83.4, R.minZ + 1));
    for (let k = 0; k <= 3; k++) onWall(back, this.solid(new RoundedBoxGeometry(1.8, 78, 2, 1, 0.4), frame, Wn.x0 + (ww * k) / 3, y0 + 44, R.minZ + 1));

    // Aire acondicionado
    const ac = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(46, 12, 9, 3, 2.5), std({ color: '#f5f4f0', roughness: 0.35 }));
    const vent = new THREE.Mesh(new RoundedBoxGeometry(40, 2, 1, 1, 0.4), std({ color: '#c9ccd2', roughness: 0.5 }));
    vent.position.set(0, -4.2, 4.2);
    ac.add(body, vent);
    ac.position.set(-150, y0 + 96, R.minZ + 4.6);
    onWall(back, this.add(ac));

    // Pósters enmarcados (como en la referencia)
    const posters = [
      ['VITA', '#1f3fa8', '#ffc93c', 26, 32],
      ['🏁', '#f4efe6', '#111', 20, 24],
      ['art', '#f4efe6', '#d0281e', 30, 22],
      ['🚗', '#e8691e', '#111', 18, 24],
      ['▲', '#2d5bd3', '#fff', 16, 22],
    ];
    let px = 8;
    posters.forEach(([text, bg, fg, w, h], k) => {
      const tex = posterTexture(k, text, bg, fg, w, h);
      const g = new THREE.Group();
      const fr = new THREE.Mesh(new RoundedBoxGeometry(w + 1.6, h + 1.6, 1, 1, 0.25), std({ color: '#141518', roughness: 0.4 }));
      const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std({ map: tex, roughness: 0.35 }));
      art.position.z = 0.55;
      g.add(fr, art);
      g.position.set(px + w / 2, y0 + 62 + (k % 2) * 16, R.minZ + 0.8);
      px += w + 6;
      onWall(back, this.add(g, { cast: false }));
    });
  }

  // ---------------------------------------------------------------- sillón

  buildSofa() {
    const S = LIVING.sofa;
    const y0 = this.floorY;
    const velvet = LM.velvet('#2f8a76');
    const velvetDark = LM.velvet('#256f60');
    const seatTop = S.seat - SLAB; // superficie del asiento (física)
    const backTop = S.back - SLAB;
    const armTop = S.arm - SLAB;
    const front = S.z1;
    const backZ = S.z0 + S.backDepth;
    // Base y patas negras
    const baseTop = seatTop - 6.2;
    const baseH = baseTop - (y0 + 2.4);
    this.solid(roundedBox(S.x1 - S.x0 + 8, baseH, S.z1 - S.z0, 1.6), velvetDark, (S.x0 + S.x1) / 2 + 2, y0 + 2.4 + baseH / 2, (S.z0 + S.z1) / 2, 16);
    const legMat = LM.blackOak();
    for (const x of [S.x0 - 2, S.x1 + 6]) for (const z of [S.z0 + 3, S.z1 - 3]) {
      this.solid(new THREE.CylinderGeometry(1.1, 0.8, 2.4, 12), legMat, x, y0 + 1.2, z);
    }
    // Almohadones del asiento: abultados en el centro (ahí apoya la pista con sus lomas)
    for (const x of LIVING.cushions) {
      const geo = pillowBox(48.5, seatTop - baseTop + 0.4, front - backZ - 0.5, 2.6, 1.6);
      this.solid(geo, velvet, x, baseTop + (seatTop - baseTop) / 2 - 0.2, (backZ + front) / 2, 16);
    }
    // Almohadones del respaldo: gruesos, apenas inclinados hacia atrás
    for (const x of LIVING.cushions) {
      const geo = pillowBox(48.5, backTop - seatTop + 1, S.backDepth - 1, 2.8, 1.2);
      this.solid(geo, velvet, x, seatTop + (backTop - seatTop) / 2 - 0.4, S.z0 + S.backDepth / 2 + 0.3, 16, { rx: -0.06 });
    }
    // Estructura del respaldo (detrás de los almohadones) y apoyabrazos redondeados
    this.solid(roundedBox(S.x1 - S.x0 + 8, backTop - baseTop - 2, 4, 1.5), velvetDark, (S.x0 + S.x1) / 2 + 2, baseTop + (backTop - baseTop - 2) / 2, S.z0 + 2, 16);
    for (const x of [S.x0 + S.armWidth / 2 - 4, S.x1 - S.armWidth / 2 + 4]) {
      this.solid(pillowBox(S.armWidth, armTop - baseTop + 0.6, S.z1 - S.z0 - 3, 3.2, 0.8), velvet, x, baseTop + (armTop - baseTop) / 2 - 0.3, (S.z0 + S.z1) / 2 + 1.5, 16);
    }
    // Almohadones decorativos de bouclé, apoyados en el respaldo
    [[22, 0.18, LM.boucle('#f1e4c8')], [-14, -0.22, LM.boucle('#e8d6b4')]].forEach(([x, rz, mat]) => {
      this.solid(pillowBox(16, 15, 5, 3.4, 2.4), mat, x, seatTop + 7, backZ + 2.8, 10, { rx: -0.32, rz });
    });
  }

  // ---------------------------------------------------------------- comedor

  buildDining() {
    const T = LIVING.dining;
    const y0 = this.floorY;
    const top = T.top - SLAB;
    const linen = LM.linen('#f4ead6');
    // Mantel: tapa y caída con pliegues (más marcados abajo)
    this.solid(new THREE.CylinderGeometry(T.r + 0.6, T.r + 0.6, 0.8, 96), linen, T.x, top - 0.4, T.z, 22);
    const dropH = top - (y0 + 7);
    const drape = new THREE.CylinderGeometry(T.r + 0.7, T.r + 3.2, dropH, 160, 10, true);
    {
      const pos = drape.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const k = 1 - (v.y + dropH / 2) / dropH; // 0 arriba, 1 abajo
        const a = Math.atan2(v.z, v.x);
        const fold = Math.sin(a * 22) * 0.9 + Math.sin(a * 37 + 1.3) * 0.45;
        const r = Math.hypot(v.x, v.z) + fold * Math.pow(k, 1.4);
        pos.setXYZ(i, Math.cos(a) * r, v.y, Math.sin(a) * r);
      }
      drape.computeVertexNormals();
    }
    const drapeMat = linen.clone();
    drapeMat.side = THREE.DoubleSide;
    this.solid(drape, drapeMat, T.x, y0 + 7 + dropH / 2, T.z, 22);
    // Dobladillo del borde
    this.solid(new THREE.TorusGeometry(T.r + 3.2, 0.35, 8, 160).rotateX(Math.PI / 2), linen, T.x, y0 + 7, T.z, 10);

    // Sobre la mesa: notebook encendida, celular, control remoto y la hoja con el dibujo de la pista
    const P = LIVING.people.sitting;
    const alu = std({ color: '#c3c6cc', metalness: 0.85, roughness: 0.32 });
    // Medidas reales (1 u ≈ 3 cm): notebook de 33 × 23 cm, celular de 15 cm, hoja A4
    const lap = new THREE.Group();
    const base = new THREE.Mesh(new RoundedBoxGeometry(11, 0.5, 7.6, 2, 0.2), alu);
    base.position.y = 0.25;
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 3.6), std({ map: keyboardTexture(), roughness: 0.6 }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, 0.52, -0.9);
    const lid = new THREE.Group();
    lid.position.set(0, 0.5, -3.7);
    lid.rotation.x = -0.28;
    const shell = new THREE.Mesh(new RoundedBoxGeometry(11, 7.5, 0.35, 2, 0.15), alu);
    shell.position.y = 3.75;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 6.5), new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: '#ffffff', emissiveMap: screenTexture(), emissiveIntensity: 0.85, roughness: 0.2 }));
    screen.position.set(0, 3.85, 0.2);
    lid.add(shell, screen);
    lap.add(base, keys, lid);
    lap.position.set(P.x, top, P.z + 10.5);
    lap.rotation.y = Math.PI; // la pantalla mira hacia él
    this.add(lap);
    this.lightScreen = new THREE.PointLight('#8fb8ff', 120, 22, 2); // la pantalla le ilumina la cara
    this.lightScreen.position.set(P.x, top + 4, P.z + 9);
    this.group.add(this.lightScreen);
    this.solid(new RoundedBoxGeometry(2.4, 0.3, 5, 2, 0.4), std({ color: '#0f1013', roughness: 0.2, metalness: 0.4 }), P.x + 10, top + 0.15, P.z + 9, 0, { ry: 0.5 });
    this.solid(new RoundedBoxGeometry(1.5, 0.5, 6, 2, 0.4), std({ color: '#ecebe6', roughness: 0.4 }), T.x + 30, top + 0.25, T.z + 34, 0, { ry: -0.7 });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(7, 10), std({ map: sketchTexture(), roughness: 0.9 }));
    sheet.rotation.set(-Math.PI / 2, 0, 0.35);
    sheet.position.set(P.x - 14, top + 0.05, P.z + 9);
    this.add(sheet, { cast: false });

    // La otra mitad de la mesa: frutero con frutas, florero con flores y revistas
    const ceramic = std({ color: '#f1ece2', roughness: 0.3 });
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ceramic);
    bowl.material.side = THREE.DoubleSide;
    bowl.scale.y = 0.5;
    bowl.position.set(T.x - 6, top + 3, T.z + 18);
    this.add(bowl);
    [['#e2462f', 0, 0], ['#f2b705', 3, 1.5], ['#7cbf3c', -2.6, 2], ['#e2462f', 1, -3], ['#f08a24', -3, -2]].forEach(([c, dx, dz]) => {
      this.solid(new THREE.SphereGeometry(1.9, 20, 14), std({ color: c, roughness: 0.4 }), T.x - 6 + dx, top + 2.8, T.z + 18 + dz);
    });
    const vase = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [2.4, 0], [2.8, 3], [1.4, 8.5], [1.7, 10]].map(([x, y]) => new THREE.Vector2(x, y)), 28), std({ color: '#2d5bd3', roughness: 0.15 }));
    vase.position.set(T.x + 22, top, T.z + 8);
    this.add(vase);
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6), std({ color: '#3f7a2c' }));
      stem.position.set(T.x + 22 + Math.cos(a) * 0.9, top + 13, T.z + 8 + Math.sin(a) * 0.9);
      stem.rotation.set(Math.sin(a) * 0.25, 0, Math.cos(a) * -0.25);
      const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), std({ color: ['#f3d6e3', '#ffffff', '#f2b705'][k % 3], roughness: 0.6 }));
      bloom.position.set(T.x + 22 + Math.cos(a) * 2.2, top + 17.6, T.z + 8 + Math.sin(a) * 2.2);
      this.add(stem);
      this.add(bloom);
    }
    [['#c3241d', 0.3], ['#1f3fa8', -0.15]].forEach(([c, r], k) => {
      this.solid(new RoundedBoxGeometry(7, 0.35, 9.5, 1, 0.1), std({ color: c, roughness: 0.5 }), T.x + 4 + k * 1.5, top + 0.2 + k * 0.36, T.z + 38 - k, 0, { ry: r });
    });

    // Sillas tapizadas (bouclé) con patas de roble
    const seatMat = LM.boucle('#efe2c8');
    const backMat = seatMat.clone();
    backMat.side = THREE.DoubleSide;
    const legMat = LM.oak('#f3e3cc');
    for (const [x, z, rot] of LIVING.chairs) {
      const g = new THREE.Group();
      const seatTop = 14 - SLAB;
      const seat = new THREE.Mesh(pillowBox(17, 3.2, 16.5, 1.4, 0.9), seatMat);
      seat.position.y = seatTop - 1.7;
      g.add(seat);
      for (const [lx, lz] of [[-6.6, -6.3], [6.6, -6.3], [-6.6, 6.3], [6.6, 6.3]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, seatTop - 3.4 - y0, 12), legMat);
        leg.position.set(lx, y0 + (seatTop - 3.4 - y0) / 2, lz);
        leg.rotation.set(lz > 0 ? 0.06 : -0.06, 0, lx > 0 ? -0.06 : 0.06);
        g.add(leg);
      }
      // La silla que hace de escalón hacia la mesa no tiene respaldo (atravesaría la pista)
      const q = this.track.path.project(x, z);
      if (q.dist > this.track.path.hw[q.i] + 12) {
        const back = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.4, 13, 32, 1, true, Math.PI * 0.72, Math.PI * 0.56), backMat);
        back.position.set(0, seatTop + 8, 1.6);
        back.scale.set(1, 1, 0.9);
        g.add(back);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      this.add(g);
      g.updateMatrixWorld(true);
      g.traverse((m) => m.isMesh && worldUV(m.geometry, 12, m.matrixWorld));
    }
  }

  buildCoffeeTable() {
    const C = LIVING.coffee;
    const y0 = this.floorY;
    const top = C.top - SLAB;
    const black = LM.blackOak();
    this.solid(new THREE.CylinderGeometry(C.r, C.r, 1.6, 64), black, C.x, top - 0.8, C.z, 26);
    this.solid(new THREE.TorusGeometry(C.r, 0.7, 10, 64).rotateX(Math.PI / 2), black, C.x, top - 0.9, C.z, 10);
    // Tres patas inclinadas de metal negro
    const metal = std({ color: '#141417', metalness: 0.7, roughness: 0.35 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const h = top - 1.6 - y0;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.55, h + 1, 12), metal);
      leg.position.set(C.x + Math.cos(a) * C.r * 0.62, y0 + h / 2, C.z + Math.sin(a) * C.r * 0.62);
      leg.rotation.set(Math.sin(a) * -0.12, 0, Math.cos(a) * 0.12);
      this.add(leg);
    }
  }

  buildShelf() {
    // Estante bajo de caños rojos (como el de la referencia): la pista lo atraviesa entre libros y
    // juguetes. Uno alto taparía la pista con la cámara a 25–60 u de altura.
    const B = LIVING.shelf;
    const y0 = this.floorY;
    const red = std({ color: '#c62a22', metalness: 0.55, roughness: 0.3, envMapIntensity: 1.2 });
    const top = B.level - SLAB;
    const H = top - y0 + 22;
    const tube = (a, b) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, d.length(), 14), red);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      this.add(m);
    };
    for (const [x, z] of [[B.x0, B.z0], [B.x1, B.z0], [B.x0, B.z1], [B.x1, B.z1]]) {
      // Un poste que caería sobre la pista no se pone (es decoración: los autos lo atravesarían)
      const q = this.track.path.project(x, z);
      if (q.dist < this.track.path.hw[q.i] + 2.5) continue;
      tube(new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y0 + H, z));
      this.solid(new THREE.SphereGeometry(1.1, 14, 10), red, x, y0 + H, z);
    }
    // Travesaño de atrás, arriba
    tube(new THREE.Vector3(B.x0, y0 + H, B.z0), new THREE.Vector3(B.x1, y0 + H, B.z0));
    this.solid(new RoundedBoxGeometry(B.x1 - B.x0, 1.4, B.z1 - B.z0, 1, 0.4), LM.oak('#e9cfa8'), (B.x0 + B.x1) / 2, top - 0.7, (B.z0 + B.z1) / 2, 30);
    // Libros parados y juguetes al fondo del estante, al costado de la pista
    const colors = ['#c3241d', '#2d5bd3', '#e0a908', '#1c6656', '#1a1414', '#e8691e', '#6b4bb5', '#efe1c0'];
    const pages = std({ color: '#f1ead8', roughness: 0.9 });
    let x = B.x0 + 3;
    for (let b = 0; x < B.x1 - 22; b++) {
      const w = 2.6 + ((b * 7) % 3) * 0.6;
      const h = 13 + ((b * 5) % 7);
      const cover = std({ color: colors[b % colors.length], roughness: 0.6 });
      const book = new THREE.Mesh(new RoundedBoxGeometry(w, h, 11, 1, 0.25), [cover, cover, pages, pages, std({ map: spineTexture(b, colors[b % colors.length]), roughness: 0.55 }), cover]);
      book.position.set(x + w / 2, top + h / 2, B.z0 + 7);
      book.rotation.z = b % 9 === 8 ? 0.12 : 0;
      this.add(book);
      x += w + 0.25;
    }
    // Casco de carrera y figura dorada
    const helmet = new THREE.Group();
    helmet.add(new THREE.Mesh(new THREE.SphereGeometry(5, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), std({ color: '#d42a20', roughness: 0.25, metalness: 0.2 })));
    const visor = new THREE.Mesh(new THREE.SphereGeometry(5.1, 24, 12, -0.9, 1.8, 1.1, 0.7), std({ color: '#141418', roughness: 0.08, metalness: 0.6 }));
    visor.rotation.y = Math.PI / 2;
    helmet.add(visor);
    helmet.position.set(B.x1 - 9, top + 3.4, B.z0 + 7);
    helmet.rotation.y = -Math.PI / 2;
    this.add(helmet);
    const gold = std({ color: '#d6a01c', metalness: 0.9, roughness: 0.3 });
    const fig = new THREE.Group();
    const part = (geo, y) => {
      const m = new THREE.Mesh(geo, gold);
      m.position.y = y;
      fig.add(m);
    };
    part(new RoundedBoxGeometry(5, 4, 4, 2, 1), 2);
    part(new RoundedBoxGeometry(4, 4, 3.4, 2, 1), 6);
    part(new THREE.SphereGeometry(1.9, 16, 12), 9.4);
    fig.position.set(B.x1 - 19, top, B.z0 + 6);
    this.add(fig);
  }

  buildRug() {
    // Alfombra a cuadros de lana: el dibujo es propio y el relieve, de la foto de bouclé
    const Rg = LIVING.rug;
    const w = Rg.x1 - Rg.x0;
    const d = Rg.z1 - Rg.z0;
    const mat = LM.boucle('#ffffff');
    mat.map = checkerTexture();
    mat.normalScale.set(0.7, 0.7);
    const rug = new THREE.Mesh(new RoundedBoxGeometry(w, 0.5, d, 1, 0.2), mat);
    rug.position.set((Rg.x0 + Rg.x1) / 2, this.floorY + 0.25, (Rg.z0 + Rg.z1) / 2);
    this.add(rug, { cast: false });
    rug.updateMatrixWorld(true);
    // Cuadros de 20 u (cada repetición de la textura son dos cuadros)
    worldUV(rug.geometry, 40, rug.matrixWorld);
  }

  /** Cubo azul luminoso (acrílico con luz adentro): la pista lo atraviesa como un túnel. */
  buildCube() {
    const Cb = LIVING.cube;
    const h = Cb.size * 0.75;
    const mat = new THREE.MeshPhysicalMaterial({ color: '#4fa8ff', emissive: '#2a6dff', emissiveIntensity: 0.8, transparent: true, opacity: 0.3, roughness: 0.08, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
    const cube = new THREE.Mesh(new RoundedBoxGeometry(Cb.size, h, Cb.size, 3, 1.2), mat);
    cube.position.set(Cb.x, this.floorY + h / 2, Cb.z);
    this.add(cube, { cast: false, receive: false });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(Cb.size, h, Cb.size)), new THREE.LineBasicMaterial({ color: '#b6dcff' }));
    edges.position.copy(cube.position);
    this.group.add(edges);
    const light = new THREE.PointLight('#4f8cff', 1100, 80, 2);
    light.position.set(Cb.x, this.floorY + 12, Cb.z);
    this.group.add(light);
  }

  buildPlants() {
    // Plantas de interior: maceta de cerámica y hojas anchas curvadas (con nervaduras)
    const pot = std({ color: '#7a4026', roughness: 0.6 });
    const soil = std({ color: '#2b1d14', roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
    LIVING.plants.forEach(([x, z], k) => {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(10, 7.5, 16, 32), pot);
      p.position.y = 8;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(10, 0.9, 10, 32).rotateX(Math.PI / 2), pot);
      rim.position.y = 16;
      const dirt = new THREE.Mesh(new THREE.CircleGeometry(9.4, 24).rotateX(-Math.PI / 2), soil);
      dirt.position.y = 15.2;
      g.add(p, rim, dirt);
      for (let j = 0; j < 13; j++) {
        const a = (j / 13) * Math.PI * 2 + k * 0.7;
        const len = 20 + ((j * 7) % 5) * 3;
        const leaf = new THREE.Mesh(leafGeometry(len, len * 0.42), leafMat);
        const stem = new THREE.Group();
        stem.position.set(Math.cos(a) * 2, 15, Math.sin(a) * 2);
        stem.rotation.set(0, -a + Math.PI / 2, 0);
        leaf.rotation.x = -(0.35 + ((j * 3) % 4) * 0.18); // inclinación hacia afuera
        stem.add(leaf);
        g.add(stem);
      }
      g.position.set(x, this.floorY, z);
      this.add(g);
    });
  }

  buildLamps() {
    const metal = std({ color: '#26272b', metalness: 0.6, roughness: 0.35 });
    // De pie, en la esquina (arco negro con pantalla)
    const fx = -200;
    const fz = -162;
    const y0 = this.floorY;
    this.solid(new THREE.CylinderGeometry(7, 8, 1.5, 32), metal, fx, y0 + 0.75, fz);
    const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 110, 0), new THREE.Vector3(26, 92, 18)), 40, 0.7, 10), metal);
    arc.position.set(fx, y0, fz);
    this.add(arc);
    const shade = new THREE.Mesh(new THREE.SphereGeometry(8, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#26272b', side: THREE.DoubleSide, roughness: 0.4, metalness: 0.5 }));
    shade.position.set(fx + 26, y0 + 92, fz + 18);
    this.add(shade);
    this.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), glow('#ffe2a6', 4))).position.set(fx + 26, y0 + 89, fz + 18);
    const l1 = new THREE.PointLight('#ffc27a', 5500, 170, 2);
    l1.position.set(fx + 26, y0 + 86, fz + 18);
    this.group.add(l1);
    // Colgante sobre la mesa del comedor
    const T = LIVING.dining;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 6), metal);
    cord.position.set(T.x, 135, T.z);
    this.add(cord);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(11, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#d9dbe0', metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide }));
    dome.position.set(T.x, 119, T.z);
    this.add(dome);
    this.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), glow('#ffe7b5', 4))).position.set(T.x, 118, T.z);
    const l2 = new THREE.PointLight('#ffd08a', 10000, 200, 2);
    l2.position.set(T.x, 112, T.z);
    this.group.add(l2);
  }

  // ---------------------------------------------------------------- personas

  buildPeople() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // Sentado a la mesa, con las manos en el teclado de la notebook
    {
      const P = LIVING.people.sitting;
      const h = makeHuman({ skin: '#b98260', hair: 'short', hairColor: '#1b120d', top: 'bomber', topColor: '#1e1f24', bottom: 'jeans', bottomColor: '#24262c', shoes: '#1a1b1f' });
      const seatTop = 14 - SLAB;
      h.group.position.set(P.x, seatTop + 3.4, P.z + 1);
      pose(h.joints, { spine: [0.2, 0, 0], neck: [0.12, 0, 0], head: [0.2, 0, 0] });
      this.add(h.group);
      h.group.updateMatrixWorld(true);
      const y0 = this.floorY;
      // Pies apoyados en el piso, un poco adelante de la silla
      for (const [side, hip, knee] of [[1, 'hipL', 'kneeL'], [-1, 'hipR', 'kneeR']]) {
        reach(h.joints[hip], h.joints[knee], ...BONES.leg, V(P.x + side * 4.2, y0 + 3.1, P.z + 14), V(P.x + side * 6, seatTop + 20, P.z + 40));
      }
      this.typist = { ...h, keys: V(P.x, LIVING.dining.top - SLAB + 1.3, P.z + 11.4) };
    }
    // Agachado en la alfombra, inclinado sobre la pista: empuja el autito rojo de un lado a otro
    {
      const P = LIVING.people.crouching;
      const h = makeHuman({ skin: '#c28a63', hair: 'curly', hairColor: '#2a1a10', top: 'tee', topColor: '#9ed34f', print: printTexture(), bottom: 'track', bottomColor: '#17181c', shoes: '#f4f4f0' });
      const y0 = this.floorY;
      h.group.position.set(P.x, y0 + 13.5, P.z);
      this.mover = this.track.movers?.[0] ?? null;
      if (this.mover) h.group.rotation.y = Math.atan2(this.mover.x - P.x, this.mover.z - P.z);
      pose(h.joints, { spine: [1.0, 0, 0], neck: [-0.5, 0, 0], head: [-0.35, 0, 0.08] });
      this.add(h.group);
      h.group.updateMatrixWorld(true);
      // Pies en el piso a los costados, rodillas hacia adelante y afuera (cuclillas)
      const fwd = V(Math.sin(h.group.rotation.y), 0, Math.cos(h.group.rotation.y));
      const right = V(fwd.z, 0, -fwd.x);
      for (const [side, hip, knee] of [[1, 'hipL', 'kneeL'], [-1, 'hipR', 'kneeR']]) {
        const foot = V(P.x, y0 + 3.1, P.z).addScaledVector(right, -side * 6.5).addScaledVector(fwd, 3);
        const pole = V(P.x, y0 + 16, P.z).addScaledVector(fwd, 30).addScaledVector(right, -side * 12);
        reach(h.joints[hip], h.joints[knee], ...BONES.leg, foot, pole);
      }
      this.pusher = { ...h, fwd, right };
    }
    this.animatePeople(0);
  }

  /** Animación: uno tipea; el otro lleva con la mano el autito que empuja (y apoya la otra en la rodilla). */
  animatePeople(t) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (this.typist) {
      const { joints: J, keys } = this.typist;
      for (const [side, sh, el, ph] of [[1, 'shoulderL', 'elbowL', 0], [-1, 'shoulderR', 'elbowR', 1.7]]) {
        const tap = Math.max(0, Math.sin(t * 12 + ph)) * 0.5;
        const target = V(keys.x + side * 2.6, keys.y + 1.6 + tap, keys.z - 1.5);
        reach(J[sh], J[el], ...BONES.arm, target, V(keys.x + side * 16, keys.y - 4, keys.z - 22));
      }
      J.wristL.rotation.set(0.9, 0, 0);
      J.wristR.rotation.set(0.9, 0, 0);
      J.head.rotation.y = Math.sin(t * 0.4) * 0.08;
    }
    if (this.pusher && this.mover) {
      const { joints: J, fwd, right } = this.pusher;
      const m = this.mover;
      // Mano derecha sobre el autito; la izquierda, apoyada en la rodilla izquierda
      reach(J.shoulderR, J.elbowR, ...BONES.arm, V(m.x, m.y + 2.4, m.z), V(m.x, m.y + 30, m.z).addScaledVector(fwd, -30).addScaledVector(right, 10));
      const knee = J.kneeL.getWorldPosition(V(0, 0, 0)).addScaledVector(fwd, 1.5).add(V(0, 2.5, 0));
      reach(J.shoulderL, J.elbowL, ...BONES.arm, knee, knee.clone().addScaledVector(fwd, -20).add(V(0, 10, 0)).addScaledVector(right, 15));
      J.wristR.rotation.set(1.1, 0, 0);
      J.head.rotation.y = Math.sin(t * 0.7) * 0.12;
    }
  }
}

// ======================================================================= geometrías

/** Caja de esquinas redondas. */
function roundedBox(w, h, d, r) {
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
}

/**
 * Almohadón: caja redondeada que se abulta en el centro de la cara de arriba y de adelante
 * (como un almohadón relleno).
 */
function pillowBox(w, h, d, r, bulge) {
  const geo = new RoundedBoxGeometry(w, h, d, 6, Math.min(r, w / 2 - 0.1, h / 2 - 0.1, d / 2 - 0.1));
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const fx = 1 - Math.pow(Math.min(1, Math.abs(v.x) / (w / 2)), 2);
    const fz = 1 - Math.pow(Math.min(1, Math.abs(v.z) / (d / 2)), 2);
    const fy = 1 - Math.pow(Math.min(1, Math.abs(v.y) / (h / 2)), 2);
    if (v.y > 0) v.y += bulge * fx * fz;
    if (v.z > 0) v.z += bulge * 0.6 * fx * fy;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Hoja de planta: plano subdividido que se curva a lo largo y se ahueca a lo ancho. */
function leafGeometry(len, width) {
  const geo = new THREE.PlaneGeometry(width, len, 4, 10);
  geo.translate(0, len / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const k = y / len;
    pos.setZ(i, k * k * len * 0.35 + (x * x) / (width * 1.2));
  }
  geo.computeVertexNormals();
  return geo;
}

// ======================================================================= texturas propias

function rand(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function checkerTexture() {
  return canvasTexture('living-checker2', 256, 256, (ctx, w, h) => {
    const q = w / 2;
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#1c1c20' : '#eee7d8';
      ctx.fillRect(x * q, y * q, q, q);
    }
    const r = rand(3);
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(r() * w, r() * h, 1.6, 1.6);
    }
  });
}

function gardenTexture() {
  return canvasTexture('living-garden', 512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b1a33');
    g.addColorStop(0.6, '#13303a');
    g.addColorStop(1, '#0d1d18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r = rand(9);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${30 + r() * 20}, ${70 + r() * 40}, ${50 + r() * 20}, ${0.35 + r() * 0.35})`;
      ctx.beginPath();
      ctx.arc(r() * w, h * (0.3 + r() * 0.6), 18 + r() * 46, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(255, 220, 160, 0.8)';
      ctx.beginPath();
      ctx.arc(r() * w, h * (0.2 + r() * 0.3), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: false });
}

function posterTexture(k, text, bg, fg, w, h) {
  return canvasTexture(`living-poster-${k}`, 256, Math.round((256 * h) / w), (ctx, cw, ch) => {
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = bg;
    ctx.fillRect(12, 12, cw - 24, ch - 24);
    if (k === 0) {
      ctx.fillStyle = '#d0281e';
      ctx.beginPath();
      ctx.ellipse(cw / 2, ch / 2, cw * 0.36, ch * 0.2, -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = fg;
    ctx.font = `italic 900 ${Math.round(cw * (text.length > 2 ? 0.26 : 0.4))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);
  }, { repeat: false });
}

function keyboardTexture() {
  return canvasTexture('living-keyboard', 256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#b9bcc2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d1f24';
    for (let row = 0; row < 5; row++) for (let col = 0; col < 14; col++) ctx.fillRect(6 + col * 17.5, 6 + row * 17, 15, 14);
  }, { repeat: false });
}

function screenTexture() {
  return canvasTexture('living-screen', 256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#16233a';
    ctx.fillRect(0, 0, w, h);
    const r = rand(4);
    const cols = ['#7fd4ff', '#ffc93c', '#9ed34f', '#ff8a7a', '#c9d3e6'];
    for (let y = 10; y < h - 8; y += 9) {
      let x = 10 + Math.floor(r() * 3) * 12;
      while (x < w - 30 && r() > 0.12) {
        const len = 12 + r() * 40;
        ctx.fillStyle = cols[Math.floor(r() * cols.length)];
        ctx.fillRect(x, y, len, 4);
        x += len + 6;
      }
    }
  }, { repeat: false });
}

function sketchTexture() {
  return canvasTexture('living-sketch', 256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#f8f5ee';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2b2d33';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.36, h * 0.3, 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.3);
    ctx.bezierCurveTo(w * 0.6, h * 0.1, w * 0.9, h * 0.6, w * 0.4, h * 0.8);
    ctx.stroke();
    ctx.strokeRect(w * 0.12, h * 0.12, w * 0.2, h * 0.08);
  }, { repeat: false });
}

function spineTexture(k, color) {
  return canvasTexture(`living-spine-${k}`, 32, 128, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(4, 14, w - 8, 3);
    ctx.fillRect(4, h - 20, w - 8, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let y = 30; y < h - 30; y += 10) ctx.fillRect(9, y, w - 18, 4);
  }, { repeat: false });
}

function leafTexture() {
  return canvasTexture('living-leaf', 128, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5aa64a');
    g.addColorStop(1, '#2c6b2c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.bezierCurveTo(-w * 0.15, h * 0.65, w * 0.05, h * 0.1, w / 2, 0);
    ctx.bezierCurveTo(w * 0.95, h * 0.1, w * 1.15, h * 0.65, w / 2, h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210, 240, 180, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(w / 2, 6);
    for (let y = h * 0.85; y > 20; y -= 22) {
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w * 0.3, y - 10, w * 0.14, y - 22);
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w * 0.7, y - 10, w * 0.86, y - 22);
    }
    ctx.stroke();
  }, { repeat: false });
}

function printTexture() {
  // Estampado de la remera: un autito de carreras con letras
  return canvasTexture('living-print', 256, 212, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1f3fa8';
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 30);
    ctx.fill();
    ctx.fillStyle = '#ffc93c';
    ctx.font = 'italic 900 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VITA', w / 2, 78);
    ctx.fillStyle = '#d0281e';
    ctx.beginPath();
    ctx.roundRect(48, 108, 160, 46, 18);
    ctx.fill();
    ctx.fillStyle = '#111';
    for (const x of [82, 174]) {
      ctx.beginPath();
      ctx.arc(x, 158, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: false });
}
