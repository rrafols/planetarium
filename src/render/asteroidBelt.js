/**
 * Main-belt asteroid field.
 *
 * Every particle carries its own orbital elements and is propagated on the
 * GPU: the vertex shader solves Kepler's equation from a time uniform, so
 * 40,000 asteroids cost one draw call and no CPU work per frame. Doing this
 * on the CPU would mean 40,000 Newton iterations plus a buffer upload every
 * frame, which is exactly the kind of thing a vertex shader is for.
 *
 * The distribution is not uniform. Semi-major axes are drawn from the real
 * belt's range and then carved by the **Kirkwood gaps** — the resonances with
 * Jupiter at 2.50 (3:1), 2.82 (5:2), 2.95 (7:3) and 3.27 AU (2:1), where
 * repeated tugs pump eccentricity until an asteroid is removed. Those gaps are
 * the defining structure of the belt, so leaving them out would produce a
 * featureless ring that looks nothing like the real thing.
 *
 * Inclinations and eccentricities follow roughly Rayleigh distributions, which
 * is why the belt is a fat torus rather than a flat annulus — a point people
 * usually get wrong when picturing it.
 */

import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Vector3,
} from 'three';
import { AU, DEG, J2000 } from '../core/constants.js';

/** Resonance centres and how wide/deep each gap is carved, in AU. */
const KIRKWOOD_GAPS = [
  { a: 2.502, width: 0.028, depth: 0.96 }, // 3:1
  { a: 2.825, width: 0.020, depth: 0.85 }, // 5:2
  { a: 2.958, width: 0.016, depth: 0.72 }, // 7:3
  { a: 3.279, width: 0.030, depth: 0.94 }, // 2:1
];

const INNER_EDGE = 2.06;
const OUTER_EDGE = 3.35;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Survival probability of a semi-major axis against the resonance gaps. */
function gapSurvival(a) {
  let keep = 1;
  for (const g of KIRKWOOD_GAPS) {
    const d = (a - g.a) / g.width;
    keep *= 1 - g.depth * Math.exp(-d * d);
  }
  return keep;
}

/** Rayleigh sample with the given mode, used for e and i. */
function rayleigh(rnd, sigma, max) {
  for (let i = 0; i < 16; i++) {
    const v = sigma * Math.sqrt(-2 * Math.log(1 - rnd()));
    if (v <= max) return v;
  }
  return max * rnd();
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aSemi;   // AU
attribute float aEcc;
attribute float aInc;    // radians
attribute float aNode;   // radians
attribute float aPeri;   // radians
attribute float aM0;     // radians
attribute float aRate;   // radians per day
attribute float aMag;    // relative brightness / size

uniform float uDays;     // days since J2000
uniform vec3  uOrigin;   // floating-origin offset, scene units
uniform float uAU;       // scene units per AU
uniform float uPointScale;
uniform float uBlend;    // 0 realistic .. 1 schematic
uniform float uOrbitRef;
uniform float uOrbitExp;

varying float vMag;

void main() {
  // --- Kepler ------------------------------------------------------------
  float M = mod(aM0 + aRate * uDays, 6.283185307);
  float E = M + aEcc * sin(M);
  // Four Newton steps is ample: e < 0.35 here, and the iteration is quadratic.
  for (int i = 0; i < 4; i++) {
    E -= (E - aEcc * sin(E) - M) / (1.0 - aEcc * cos(E));
  }

  float xp = aSemi * (cos(E) - aEcc);
  float yp = aSemi * sqrt(1.0 - aEcc * aEcc) * sin(E);

  // --- Orbit orientation, in the ecliptic frame --------------------------
  float cw = cos(aPeri), sw = sin(aPeri);
  float cn = cos(aNode), sn = sin(aNode);
  float ci = cos(aInc),  si = sin(aInc);

  float x1 = cw * xp - sw * yp;
  float y1 = sw * xp + cw * yp;
  vec3 ecl = vec3(cn * x1 - sn * ci * y1,
                  sn * x1 + cn * ci * y1,
                  si * y1) * uAU;

  // --- Same radial remap the rest of the scene uses ----------------------
  float r = length(ecl);
  if (uBlend > 0.0001 && r > 1e-6) {
    float schematic = uOrbitRef * pow(r / uAU, uOrbitExp);
    ecl *= mix(r, schematic, uBlend) / r;
  }

  // Ecliptic -> scene axes, then the floating-origin shift.
  vec3 world = vec3(ecl.x, ecl.z, -ecl.y) - uOrigin;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 1e-3);
  gl_PointSize = clamp(uPointScale * aMag / dist, 0.7, 5.0);
  vMag = aMag;

  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform float uIntensity;
varying float vMag;

void main() {
  #include <logdepthbuf_fragment>
  // Round, softly-edged point instead of a hard square.
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float falloff = smoothstep(0.25, 0.02, r2);
  gl_FragColor = vec4(uColor * uIntensity * vMag * falloff, 1.0);
}
`;

export class AsteroidBelt {
  /**
   * @param {import('three').Scene} scene
   * @param {number} count
   */
  constructor(scene, count = 40000) {
    const rnd = mulberry32(0xbe17);
    const geo = new BufferGeometry();

    const semi = new Float32Array(count);
    const ecc = new Float32Array(count);
    const inc = new Float32Array(count);
    const node = new Float32Array(count);
    const peri = new Float32Array(count);
    const m0 = new Float32Array(count);
    const rate = new Float32Array(count);
    const mag = new Float32Array(count);
    // Points still need a `position` attribute even though the shader ignores it.
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Rejection-sample the semi-major axis so the Kirkwood gaps appear.
      let a;
      do {
        a = INNER_EDGE + rnd() * (OUTER_EDGE - INNER_EDGE);
      } while (rnd() > gapSurvival(a));

      semi[i] = a;
      ecc[i] = rayleigh(rnd, 0.105, 0.35);
      inc[i] = rayleigh(rnd, 0.115, 0.42); // radians; mean ~7 deg, tail to 24
      node[i] = rnd() * Math.PI * 2;
      peri[i] = rnd() * Math.PI * 2;
      m0[i] = rnd() * Math.PI * 2;
      // Kepler's third law: n = k / a^1.5, with k in degrees/day.
      rate[i] = (0.9856076686 / (a * Math.sqrt(a))) * DEG;
      // Steep size distribution: mostly faint, a few noticeably brighter.
      mag[i] = 0.35 + 0.65 * rnd() ** 3;
    }

    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSemi', new BufferAttribute(semi, 1));
    geo.setAttribute('aEcc', new BufferAttribute(ecc, 1));
    geo.setAttribute('aInc', new BufferAttribute(inc, 1));
    geo.setAttribute('aNode', new BufferAttribute(node, 1));
    geo.setAttribute('aPeri', new BufferAttribute(peri, 1));
    geo.setAttribute('aM0', new BufferAttribute(m0, 1));
    geo.setAttribute('aRate', new BufferAttribute(rate, 1));
    geo.setAttribute('aMag', new BufferAttribute(mag, 1));
    // The shader ignores `position`, so frustum culling has nothing to work with.
    geo.boundingSphere = null;

    this.material = new ShaderMaterial({
      uniforms: {
        uDays: { value: 0 },
        uOrigin: { value: new Vector3() },
        uAU: { value: AU },
        uPointScale: { value: 2.2e5 },
        uBlend: { value: 0 },
        uOrbitRef: { value: 0.16 * AU },
        uOrbitExp: { value: 0.45 },
        uColor: { value: new Vector3(1.0, 0.88, 0.72) },
        uIntensity: { value: 1.0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -3;
    scene.add(this.points);
    this.count = count;
  }

  /**
   * @param {number} jd
   * @param {Vector3} origin floating-origin offset
   * @param {number} blend view-transform blend
   * @param {number} exposure current tone-mapping exposure, to keep the belt
   *   at a steady apparent brightness as the camera stop changes
   */
  update(jd, origin, blend, exposure) {
    const u = this.material.uniforms;
    u.uDays.value = jd - J2000;
    u.uOrigin.value.copy(origin);
    u.uBlend.value = blend;
    u.uIntensity.value = Math.min(1.6, 0.55 / Math.max(exposure, 0.05));
  }

  setVisible(v) {
    this.points.visible = v;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
