import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GAME_CONFIG } from '../config.js';

const G = GAME_CONFIG.graphics;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** Desenfoque gaussiano en una dirección, que crece fuera de una banda horizontal nítida. */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    dir: { value: new THREE.Vector2() },
    focus: { value: 0.5 },
    band: { value: 0.2 },
    maxBlur: { value: 2 },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 dir;
    uniform float focus;
    uniform float band;
    uniform float maxBlur;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - focus);
      vec2 off = dir * smoothstep(band, band + 0.35, d) * maxBlur;
      vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
      c += texture2D(tDiffuse, vUv + off * 1.3846) * 0.316216;
      c += texture2D(tDiffuse, vUv - off * 1.3846) * 0.316216;
      c += texture2D(tDiffuse, vUv + off * 3.2308) * 0.070270;
      c += texture2D(tDiffuse, vUv - off * 3.2308) * 0.070270;
      gl_FragColor = c;
    }`,
};

/** Corrección de color final: saturación, contraste, calidez y viñeta. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    warmth: { value: 0 },
    vignette: { value: 0 },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float warmth;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col += vec3(warmth, warmth * 0.35, -warmth);
      vec2 p = vUv - 0.5;
      col *= clamp(1.0 - dot(p, p) * vignette * 2.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * Cadena de posprocesado:
 *  render (MSAA, HDR) → oclusión ambiental → bloom → tone mapping → tilt-shift → color → (SMAA en baja)
 */
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = G.quality;
    this.focus = 0.5;
    this.build();
  }

  get high() {
    return this.quality === 'high';
  }

  toggleQuality() {
    this.quality = this.high ? 'low' : 'high';
    this.build();
    return this.quality;
  }

  build() {
    const r = this.renderer;
    this.composer?.dispose();
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.high ? G.maxPixelRatio : 1));
    r.toneMappingExposure = G.exposure;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = r.getPixelRatio();

    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: this.high ? 4 : 0 });
    const composer = new EffectComposer(r, target);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));

    this.ao = null;
    if (this.high && G.ambientOcclusion.enabled) {
      const ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = G.ambientOcclusion.intensity;
      ao.updateGtaoMaterial?.({ radius: G.ambientOcclusion.radius, distanceExponent: 1.4, thickness: 1.5, scale: 1, samples: 16 });
      ao.updatePdMaterial?.({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      composer.addPass(ao);
      this.ao = ao;
    }

    if (G.bloom.enabled) {
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), G.bloom.strength, G.bloom.radius, G.bloom.threshold));
    }

    composer.addPass(new OutputPass());

    this.tilt = [];
    if (this.high && G.tiltShift.enabled) {
      for (const d of [new THREE.Vector2(1 / (w * pr), 0), new THREE.Vector2(0, 1 / (h * pr))]) {
        const pass = new ShaderPass(TiltShiftShader);
        pass.uniforms.dir.value.copy(d).multiplyScalar(pr);
        pass.uniforms.band.value = G.tiltShift.focusBand;
        pass.uniforms.maxBlur.value = G.tiltShift.maxBlur;
        composer.addPass(pass);
        this.tilt.push(pass);
      }
    }

    const grade = new ShaderPass(GradeShader);
    Object.assign(grade.uniforms.saturation, { value: G.grade.saturation });
    Object.assign(grade.uniforms.contrast, { value: G.grade.contrast });
    Object.assign(grade.uniforms.warmth, { value: G.grade.warmth });
    Object.assign(grade.uniforms.vignette, { value: G.grade.vignette });
    composer.addPass(grade);

    if (!this.high) composer.addPass(new SMAAPass(w * pr, h * pr));
    this.composer = composer;
  }

  /** Altura de pantalla (0 abajo … 1 arriba) que queda nítida: la de los jugadores. */
  setFocus(y) {
    this.focus += (Math.min(0.85, Math.max(0.15, y)) - this.focus) * 0.1;
    for (const p of this.tilt) p.uniforms.focus.value = this.focus;
  }

  setSize(w, h) {
    this.build();
  }

  render() {
    this.composer.render();
  }
}
