/**
 * Orbital particle fields — the asteroid belt and the meteoroid streams.
 *
 * Every particle carries its own orbital elements and is propagated on the
 * GPU: the vertex shader solves Kepler's equation from a time uniform, so tens
 * of thousands of bodies cost one draw call and no CPU work per frame. Doing
 * it on the CPU would mean a Newton iteration per particle plus a full buffer
 * upload every frame, which is precisely what a vertex shader exists to avoid.
 *
 * Both fields share this machinery because they are the same problem: a swarm
 * of test particles on fixed Keplerian orbits.
 */

import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending,
  Vector3, Color,
} from 'three';
import { AU, DEG, J2000 } from '../core/constants.js';
import { COMETS, METEOR_STREAMS, semiMajorAxis } from '../ephem/comets.js';

/* --------------------------------------------------------------- shaders */

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
attribute vec3  aTint;

uniform float uDays;     // days since J2000
uniform vec3  uOrigin;   // floating-origin offset, scene units
uniform float uAU;
uniform float uPointScale;
uniform float uBlend;    // 0 realistic .. 1 schematic
uniform float uOrbitRef;
uniform float uOrbitExp;

varying float vMag;
varying vec3  vTint;

void main() {
  // --- Kepler ------------------------------------------------------------
  float M = mod(aM0 + aRate * uDays, 6.283185307);
  float E = M + aEcc * sin(M);
  // Six Newton steps: ample for the belt, and enough for the eccentric
  // (e ~ 0.9) cometary streams where the iteration converges more slowly.
  for (int i = 0; i < 6; i++) {
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

  vec3 world = vec3(ecl.x, ecl.z, -ecl.y) - uOrigin;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 1e-3);
  gl_PointSize = clamp(uPointScale * aMag / dist, 0.7, 5.0);
  vMag = aMag;
  vTint = aTint;

  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uIntensity;
varying float vMag;
varying vec3  vTint;

void main() {
  #include <logdepthbuf_fragment>
  // Round, softly-edged point rather than a hard square.
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float falloff = smoothstep(0.25, 0.02, r2);
  gl_FragColor = vec4(vTint * uIntensity * vMag * falloff, 1.0);
}
`;

/* ----------------------------------------------------------------- utils */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal deviate. */
function gaussian(rnd) {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Mean motion in radians/day from the semi-major axis in AU. */
function meanMotion(a) {
  return (0.9856076686 / (a * Math.sqrt(a))) * DEG;
}

/* --------------------------------------------------------------- field */

class ParticleField {
  /** @param {ReturnType<typeof buildBelt>} data */
  constructor(scene, data, opts = {}) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(data.count * 3), 3));
    for (const [name, arr, size] of [
      ['aSemi', data.semi, 1], ['aEcc', data.ecc, 1], ['aInc', data.inc, 1],
      ['aNode', data.node, 1], ['aPeri', data.peri, 1], ['aM0', data.m0, 1],
      ['aRate', data.rate, 1], ['aMag', data.mag, 1], ['aTint', data.tint, 3],
    ]) {
      geo.setAttribute(name, new BufferAttribute(arr, size));
    }
    // The shader ignores `position`, so culling has nothing to work from.
    geo.boundingSphere = null;

    this.material = new ShaderMaterial({
      uniforms: {
        uDays: { value: 0 },
        uOrigin: { value: new Vector3() },
        uAU: { value: AU },
        uPointScale: { value: opts.pointScale ?? 2.2e5 },
        uBlend: { value: 0 },
        uOrbitRef: { value: 0.16 * AU },
        uOrbitExp: { value: 0.45 },
        uIntensity: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.baseIntensity = opts.intensity ?? 0.55;
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder ?? -3;
    scene.add(this.points);
  }

  update(jd, origin, blend, exposure) {
    const u = this.material.uniforms;
    u.uDays.value = jd - J2000;
    u.uOrigin.value.copy(origin);
    u.uBlend.value = blend;
    // Hold a steady apparent brightness as the camera stop changes.
    u.uIntensity.value = Math.min(1.8, this.baseIntensity / Math.max(exposure, 0.05));
  }

  setVisible(v) {
    this.points.visible = v;
  }
}

/* ------------------------------------------------------------ the belt */

/** Resonance centres and how wide/deep each gap is carved, in AU. */
const KIRKWOOD_GAPS = [
  { a: 2.502, width: 0.028, depth: 0.96 }, // 3:1
  { a: 2.825, width: 0.020, depth: 0.85 }, // 5:2
  { a: 2.958, width: 0.016, depth: 0.72 }, // 7:3
  { a: 3.279, width: 0.030, depth: 0.94 }, // 2:1
];

const INNER_EDGE = 2.06;
const OUTER_EDGE = 3.35;

/** Survival probability of a semi-major axis against the resonance gaps. */
function gapSurvival(a) {
  let keep = 1;
  for (const g of KIRKWOOD_GAPS) {
    const d = (a - g.a) / g.width;
    keep *= 1 - g.depth * Math.exp(-d * d);
  }
  return keep;
}

/** Rayleigh sample, used for eccentricity and inclination. */
function rayleigh(rnd, sigma, max) {
  for (let i = 0; i < 16; i++) {
    const v = sigma * Math.sqrt(-2 * Math.log(1 - rnd()));
    if (v <= max) return v;
  }
  return max * rnd();
}

function allocate(count) {
  return {
    count,
    semi: new Float32Array(count),
    ecc: new Float32Array(count),
    inc: new Float32Array(count),
    node: new Float32Array(count),
    peri: new Float32Array(count),
    m0: new Float32Array(count),
    rate: new Float32Array(count),
    mag: new Float32Array(count),
    tint: new Float32Array(count * 3),
  };
}

/**
 * The main belt.
 *
 * Semi-major axes are rejection-sampled against the Kirkwood gaps — the
 * resonances with Jupiter where repeated tugs pump eccentricity until an
 * asteroid is thrown out. Those gaps are the belt's defining structure.
 * Eccentricity and inclination follow Rayleigh distributions, which is why the
 * belt is a fat torus rather than the flat ring it is usually drawn as.
 */
export function buildBelt(count, seed = 0xbe17) {
  const rnd = mulberry32(seed);
  const d = allocate(count);
  const c = new Color(1.0, 0.86, 0.68);

  for (let i = 0; i < count; i++) {
    let a;
    do {
      a = INNER_EDGE + rnd() * (OUTER_EDGE - INNER_EDGE);
    } while (rnd() > gapSurvival(a));

    d.semi[i] = a;
    d.ecc[i] = rayleigh(rnd, 0.105, 0.35);
    d.inc[i] = rayleigh(rnd, 0.115, 0.42); // mean ~7 deg, tail to 24
    d.node[i] = rnd() * Math.PI * 2;
    d.peri[i] = rnd() * Math.PI * 2;
    d.m0[i] = rnd() * Math.PI * 2;
    d.rate[i] = meanMotion(a);
    d.mag[i] = 0.35 + 0.65 * rnd() ** 3; // steep size distribution
    d.tint[i * 3] = c.r; d.tint[i * 3 + 1] = c.g; d.tint[i * 3 + 2] = c.b;
  }
  return d;
}

/**
 * Meteoroid streams.
 *
 * A meteor shower is not a comet: it is the debris a comet has strung out along
 * its own orbit, which Earth ploughs through on the same calendar date each
 * year. So each stream is its parent's orbit with the particles spread all the
 * way around in mean anomaly and slightly dispersed in the other elements —
 * exactly how a real trail widens as differential perturbations act on it.
 *
 * The consequence is visible: watch Earth in mid-August and it passes straight
 * through the Perseid stream laid down by 109P/Swift-Tuttle.
 */
export function buildStreams(perStream, seed = 0x5eed) {
  const keys = Object.keys(METEOR_STREAMS);
  const d = allocate(keys.length * perStream);
  const rnd = mulberry32(seed);
  const col = new Color();

  let k = 0;
  for (const key of keys) {
    const stream = METEOR_STREAMS[key];
    const parent = COMETS[stream.parent];
    const a0 = semiMajorAxis(parent);
    col.set(stream.color);

    for (let i = 0; i < perStream; i++) {
      // Dispersion grows with each revolution; a few percent in a is realistic
      // for an established stream and is what gives it width at the crossing.
      const a = a0 * (1 + gaussian(rnd) * 0.035);
      d.semi[k] = a;
      d.ecc[k] = Math.min(0.985, Math.max(0.05, parent.e + gaussian(rnd) * 0.006));
      d.inc[k] = (parent.i + gaussian(rnd) * 0.35) * DEG;
      d.node[k] = (parent.node + gaussian(rnd) * 0.4) * DEG;
      d.peri[k] = (parent.peri + gaussian(rnd) * 0.6) * DEG;
      d.m0[k] = rnd() * Math.PI * 2; // debris fills the whole orbit
      d.rate[k] = meanMotion(a);
      d.mag[k] = 0.25 + 0.5 * rnd() ** 2;
      d.tint[k * 3] = col.r; d.tint[k * 3 + 1] = col.g; d.tint[k * 3 + 2] = col.b;
      k++;
    }
  }
  return d;
}

export class AsteroidBelt extends ParticleField {
  constructor(scene, count = 40000) {
    super(scene, buildBelt(count), { intensity: 0.55, pointScale: 2.2e5 });
  }
}

export class MeteorStreams extends ParticleField {
  constructor(scene, perStream = 3500) {
    super(scene, buildStreams(perStream), {
      intensity: 0.22,
      pointScale: 1.5e5,
      renderOrder: -3,
    });
  }
}
