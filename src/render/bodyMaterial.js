/**
 * Materials for planet surfaces, cloud decks, atmospheres, rings and the Sun.
 *
 * These are hand-written ShaderMaterials rather than patched MeshStandard-
 * Materials. We need the whole direct-lighting path under our control (finite
 * solar disc, analytic eclipse coverage, ring shadows, non-Lambertian
 * regolith), and there is exactly one light in the scene, so most of what
 * MeshStandardMaterial does is dead weight here.
 *
 * All of them write *linear HDR*; tone mapping and sRGB encoding happen once,
 * at the end of the post chain, in OutputPass.
 */

import {
  ShaderMaterial, Vector3, Color, DoubleSide, BackSide, AdditiveBlending,
  NormalBlending, DataTexture, RGBAFormat,
} from 'three';
import { MAX_OCCLUDERS, AU } from '../core/constants.js';
import { ECLIPSE_COMMON, SPECULAR_GLSL } from './shaders/eclipse.glsl.js';

/** Every material that needs the per-frame Sun / occluder uniforms. */
const registry = [];

/**
 * Logarithmic depth support.
 *
 * The renderer runs with logarithmicDepthBuffer enabled, which is the only way
 * to get usable depth precision across a near/far range of 1e-4 to 1e10 scene
 * units. Three.js implements that by rewriting depth in the *material*: the
 * vertex stage passes the eye-space w through and the fragment stage writes
 * gl_FragDepth. A hand-written ShaderMaterial that omits these chunks keeps
 * plain projective depth, and mixing the two encodings in one buffer destroys
 * the depth test — a sphere z-fights against its own far side, so the back of
 * the planet shows through the front in polygon-shaped patches.
 *
 * The renderer defines USE_LOGDEPTHBUF and supplies logDepthBufFC by itself, so
 * including the chunks is all that is required.
 */
const LOGDEPTH_PARS_VERT = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOGDEPTH_VERT = '#include <logdepthbuf_vertex>';
const LOGDEPTH_PARS_FRAG = '#include <common>\n#include <logdepthbuf_pars_fragment>';
const LOGDEPTH_FRAG = '#include <logdepthbuf_fragment>';

/** 1x1 straight-up normal, standing in until a real map is fetched. */
let _flatNormal = null;
function flatNormalTexture() {
  if (!_flatNormal) {
    _flatNormal = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat);
    _flatNormal.needsUpdate = true;
  }
  return _flatNormal;
}

function baseUniforms() {
  const occPos = [];
  const occRad = [];
  for (let i = 0; i < MAX_OCCLUDERS; i++) {
    occPos.push(new Vector3());
    occRad.push(0);
  }
  return {
    uSunPos: { value: new Vector3() },
    uSunRadius: { value: 696 },
    uSunColor: { value: new Color(1.0, 0.98, 0.94) },
    uSunIntensity: { value: 2.2 },
    uAU: { value: AU },
    uIrradiance: { value: 1 },
    uOccCount: { value: 0 },
    uOccPos: { value: occPos },
    uOccRad: { value: occRad },
    uEclipseOn: { value: 1 },
    uHasRingShadow: { value: 0 },
    uRingCenter: { value: new Vector3() },
    uRingNormal: { value: new Vector3(0, 1, 0) },
    uRingInner: { value: 0 },
    uRingOuter: { value: 1 },
    uRingMap: { value: null },
  };
}

const VERT = /* glsl */ `
${LOGDEPTH_PARS_VERT}

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform vec3 uInvScaleSq;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // Correct normal transform under the non-uniform scale used for oblateness:
  // for M = R*S the normal matrix is R*S^-1 = mat3(M) * S^-2.
  vWorldNormal = normalize(mat3(modelMatrix) * (normal * uInvScaleSq));
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERT}
}
`;

const SURFACE_FRAG = /* glsl */ `
precision highp float;
${LOGDEPTH_PARS_FRAG}

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform vec3  uBaseColor;
uniform float uRoughness;
uniform float uAmbient;
uniform vec3  uPoleWorld;

#ifdef USE_MAP
uniform sampler2D uMap;
#endif
#ifdef USE_NIGHTMAP
uniform sampler2D uNightMap;
uniform float uNightStrength;
#endif
#ifdef USE_NORMALMAP
uniform sampler2D uNormalMap;
uniform float uNormalScale;
// Runtime 0..1 fade. Kept as a uniform rather than a second #define so that
// easing the relief in by distance never triggers a shader recompile, which
// would hitch exactly as the camera closes on the body.
uniform float uNormalStrength;
#endif
#ifdef USE_SPECMAP
uniform sampler2D uSpecMap;
#endif
#ifdef USE_LUNAR
uniform float uLunarK;
#endif
#ifdef IS_CLOUD
uniform float uCloudOpacity;
#endif

${ECLIPSE_COMMON}
${SPECULAR_GLSL}

void main() {
  ${LOGDEPTH_FRAG}
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 dSun = uSunPos - vWorldPos;
  float sunDist = max(length(dSun), 1e-4);
  vec3 L = dSun / sunDist;
  float sunAng = asin(clamp(uSunRadius / sunDist, 0.0, 0.9999));

#ifdef USE_NORMALMAP
  // Equirectangular UVs on a sphere give an analytic tangent frame: east is
  // perpendicular to both the spin axis and the surface normal.
  vec3 east = cross(uPoleWorld, N);
  float eastLen = length(east);
  if (eastLen > 1e-4 && uNormalStrength > 0.001) {
    vec3 T = east / eastLen;
    vec3 B = cross(N, T);
    vec3 nt = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
    nt.xy *= uNormalScale * uNormalStrength;
    N = normalize(T * nt.x + B * nt.y + N * nt.z);
  }
#endif

  float c = dot(N, L);
  float ndl = discNdotL(c, sunAng);

  float vis = sunVisibility(vWorldPos, L, sunDist, sunAng);
  vis *= ringShadow(vWorldPos, L);

  float atten = uIrradiance;
  vec3 irradiance = uSunColor * uSunIntensity * atten * vis;

  vec4 texel = vec4(1.0);
#ifdef USE_MAP
  texel = texture2D(uMap, vUv);
#endif
  vec3 albedo = texel.rgb * uBaseColor;

  float diffuse = ndl;
#ifdef USE_LUNAR
  diffuse = lunarLambert(ndl, max(dot(N, V), 1e-3), uLunarK);
#endif

  vec3 color = albedo * irradiance * diffuse;

#ifdef USE_SPECMAP
  // The Solar System Scope specular map is a land/ocean mask: white = water.
  float ocean = texture2D(uSpecMap, vUv).r;
  if (ocean > 0.01 && c > 0.0) {
    vec3 H = normalize(L + V);
    float ndh = max(dot(N, H), 0.0);
    float ndv = max(dot(N, V), 1e-4);
    float ndlc = max(c, 1e-4);
    float rough = mix(0.6, 0.12, ocean);
    float spec = d_ggx(ndh, rough) * v_smith(ndv, ndlc, rough);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    color += irradiance * spec * fresnel * ocean * ndlc * 1.6;
  }
#endif

#ifdef USE_NIGHTMAP
  // City lights fade in as total illumination drops, so the umbra of a solar
  // eclipse lights up as a dark patch with cities showing through.
  float darkness = 1.0 - smoothstep(0.0, 0.12, diffuse * vis);
  vec3 lights = texture2D(uNightMap, vUv).rgb;
  color += lights * lights * uNightStrength * darkness;
#endif

  // Ambient is a stand-in for the little light that is not direct sunlight, and
  // it has to scale with the local sunlight. As an absolute value it survives
  // auto-exposure: at Jupiter the frame is opened ~27x versus ~2x at Mars, so a
  // fixed ambient made Jupiter's night side roughly twelve times brighter than
  // Mars's for no physical reason.
  float ambient = uAmbient * uIrradiance;
  color += albedo * ambient;

  float alpha = 1.0;
#ifdef IS_CLOUD
  // The cloud map is greyscale; its luminance is the coverage.
  alpha = clamp(texel.r * uCloudOpacity, 0.0, 1.0);
  color = albedo * irradiance * diffuse + albedo * ambient;
#endif

  gl_FragColor = vec4(color, alpha);
}
`;

function makeDefines(def, extra = {}) {
  const d = { MAX_OCC: MAX_OCCLUDERS, ...extra };
  return d;
}

/** Registers a material so updateFrameUniforms() reaches it. */
function register(mat, opts = {}) {
  registry.push({ mat, ...opts });
  return mat;
}

export function createSurfaceMaterial(def, tex, opts = {}) {
  const defines = makeDefines(def);
  const uniforms = {
    ...baseUniforms(),
    uBaseColor: { value: new Color(opts.tint ?? 0xffffff) },
    uRoughness: { value: def.roughness ?? 0.9 },
    uAmbient: { value: opts.ambient ?? 0.006 },
    uPoleWorld: { value: new Vector3(0, 1, 0) },
    uInvScaleSq: { value: new Vector3(1, 1, 1) },
  };

  if (tex.map) {
    defines.USE_MAP = '';
    uniforms.uMap = { value: tex.map };
  }
  if (tex.nightMap) {
    defines.USE_NIGHTMAP = '';
    uniforms.uNightMap = { value: tex.nightMap };
    uniforms.uNightStrength = { value: 1.4 };
  }
  if (tex.normalMap || def.relief) {
    defines.USE_NORMALMAP = '';
    // A body whose relief arrives later still compiles with the path enabled,
    // bound to a flat placeholder, so swapping the real map in is just a
    // texture assignment.
    uniforms.uNormalMap = { value: tex.normalMap ?? flatNormalTexture() };
    uniforms.uNormalScale = { value: def.relief?.scale ?? def.normalScale ?? 0.5 };
    uniforms.uNormalStrength = { value: def.relief ? 0 : 1 };
  }
  if (tex.specularMap) {
    defines.USE_SPECMAP = '';
    uniforms.uSpecMap = { value: tex.specularMap };
  }
  if (opts.airless) {
    defines.USE_LUNAR = '';
    uniforms.uLunarK = { value: 0.85 };
  }

  const mat = new ShaderMaterial({
    defines,
    uniforms,
    vertexShader: VERT,
    fragmentShader: SURFACE_FRAG,
  });
  mat.name = `${def.key}-surface`;
  return register(mat, { bodyKey: def.key, wantsOccluders: true, wantsPole: true });
}

export function createCloudMaterial(def, cloudTex) {
  const defines = makeDefines(def, { USE_MAP: '', IS_CLOUD: '' });
  const uniforms = {
    ...baseUniforms(),
    uMap: { value: cloudTex },
    uBaseColor: { value: new Color(0xffffff) },
    uRoughness: { value: 1 },
    uAmbient: { value: 0.006 },
    uPoleWorld: { value: new Vector3(0, 1, 0) },
    uInvScaleSq: { value: new Vector3(1, 1, 1) },
    uCloudOpacity: { value: 1.0 },
  };
  const mat = new ShaderMaterial({
    defines,
    uniforms,
    vertexShader: VERT,
    fragmentShader: SURFACE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  mat.name = `${def.key}-clouds`;
  return register(mat, { bodyKey: def.key, wantsOccluders: true, wantsPole: true });
}

/* ------------------------------------------------------------------ atmosphere */

const ATMO_FRAG = /* glsl */ `
precision highp float;
${LOGDEPTH_PARS_FRAG}
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform vec3  uAtmoColor;
uniform float uStrength;
uniform vec3  uBodyCenter;
uniform float uBodyRadius;

${ECLIPSE_COMMON}

void main() {
  ${LOGDEPTH_FRAG}
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 dSun = uSunPos - vWorldPos;
  float sunDist = max(length(dSun), 1e-4);
  vec3 L = dSun / sunDist;
  float sunAng = asin(clamp(uSunRadius / sunDist, 0.0, 0.9999));

  // Rim: thickest where we graze the limb.
  float rim = 1.0 - abs(dot(N, V));
  rim = pow(clamp(rim, 0.0, 1.0), 2.4);

  // Forward scattering makes the sunward limb far brighter.
  float mu = dot(L, -V);
  float phase = 0.75 * (1.0 + mu * mu);

  float lit = discNdotL(dot(N, L), sunAng);
  float vis = sunVisibility(vWorldPos, L, sunDist, sunAng);

  float atten = uIrradiance;
  float amount = rim * phase * lit * vis * uStrength * uIrradiance;

  gl_FragColor = vec4(uAtmoColor * uSunColor * uSunIntensity * amount, 1.0);
}
`;

export function createAtmosphereMaterial(def) {
  const a = def.atmosphere;
  const mat = new ShaderMaterial({
    defines: makeDefines(def),
    uniforms: {
      ...baseUniforms(),
      uAtmoColor: { value: new Color(a.color) },
      uStrength: { value: a.strength },
      uBodyCenter: { value: new Vector3() },
      uBodyRadius: { value: 1 },
      uInvScaleSq: { value: new Vector3(1, 1, 1) },
    },
    vertexShader: VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    side: BackSide,
    depthWrite: false,
  });
  mat.name = `${def.key}-atmosphere`;
  return register(mat, { bodyKey: def.key, wantsOccluders: true });
}

/* ----------------------------------------------------------------------- rings */

const RING_FRAG = /* glsl */ `
precision highp float;
${LOGDEPTH_PARS_FRAG}
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform sampler2D uMap;
uniform float uAmbient;

${ECLIPSE_COMMON}

void main() {
  ${LOGDEPTH_FRAG}
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 dSun = uSunPos - vWorldPos;
  float sunDist = max(length(dSun), 1e-4);
  vec3 L = dSun / sunDist;
  float sunAng = asin(clamp(uSunRadius / sunDist, 0.0, 0.9999));

  vec4 texel = texture2D(uMap, vec2(vUv.x, 0.5));
  if (texel.a < 0.01) discard;

  float ndl = abs(dot(N, L));
  float vis = sunVisibility(vWorldPos, L, sunDist, sunAng);
  float atten = uIrradiance;

  // Particles scatter mostly backward toward the lit face, but the unlit face
  // still glows from light forward-scattered through the ring plane.
  bool sameSide = (dot(N, L) * dot(N, V)) > 0.0;
  float response = sameSide ? ndl : ndl * 0.30;

  vec3 color = texel.rgb * uSunColor * uSunIntensity * atten * vis * response;
  color += texel.rgb * uAmbient * uIrradiance;

  gl_FragColor = vec4(color, texel.a);
}
`;

export function createRingMaterial(def, ringTex) {
  const mat = new ShaderMaterial({
    defines: makeDefines(def),
    uniforms: {
      ...baseUniforms(),
      uMap: { value: ringTex },
      uAmbient: { value: 0.01 },
      uInvScaleSq: { value: new Vector3(1, 1, 1) },
    },
    vertexShader: VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    blending: NormalBlending,
  });
  mat.name = `${def.key}-rings`;
  // Rings are shadowed by their planet, which occludersFor() supplies.
  return register(mat, { bodyKey: def.key, wantsOccluders: true, ringSelfShadow: false });
}

/* ------------------------------------------------------------------------- sun */

const SUN_FRAG = /* glsl */ `
precision highp float;
${LOGDEPTH_PARS_FRAG}
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform sampler2D uMap;
uniform float uIntensity;
uniform vec3  uTint;

void main() {
  ${LOGDEPTH_FRAG}
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = clamp(dot(N, V), 0.0, 1.0);

  // Eddington limb darkening, I(mu)/I(1) = 0.4 + 0.6*mu, plus a little extra
  // reddening toward the limb.
  float limb = 0.4 + 0.6 * mu;
  vec3 tex = texture2D(uMap, vUv).rgb;
  vec3 warm = mix(vec3(1.0, 0.55, 0.25), vec3(1.0), pow(mu, 0.45));

  gl_FragColor = vec4(tex * uTint * warm * limb * uIntensity, 1.0);
}
`;

export function createSunMaterial(sunTex) {
  const mat = new ShaderMaterial({
    uniforms: {
      uMap: { value: sunTex },
      uIntensity: { value: 14.0 },
      uTint: { value: new Color(1.0, 0.96, 0.88) },
      uInvScaleSq: { value: new Vector3(1, 1, 1) },
    },
    vertexShader: VERT,
    fragmentShader: SUN_FRAG,
  });
  mat.name = 'sun-surface';
  return mat;
}

/** Soft corona billboard around the Sun. */
const CORONA_FRAG = /* glsl */ `
precision highp float;
${LOGDEPTH_PARS_FRAG}
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;

void main() {
  ${LOGDEPTH_FRAG}
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Two-lobe falloff: a tight bright inner halo over a broad faint one.
  float inner = exp(-pow(r * 5.2, 1.7));
  float outer = exp(-pow(r * 2.1, 1.25)) * 0.22;
  gl_FragColor = vec4(uColor * (inner + outer) * uIntensity, 1.0);
}
`;

export function createCoronaMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(1.0, 0.85, 0.6) },
      uIntensity: { value: 2.6 },
    },
    vertexShader: /* glsl */ `
      ${LOGDEPTH_PARS_VERT}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${LOGDEPTH_VERT}
      }
    `,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}

/* ------------------------------------------------------------ frame uniforms */

const _tmpVec = new Vector3();

/**
 * Push the per-frame Sun and occluder state into every registered material.
 *
 * @param {object} ctx
 * @param {Vector3} ctx.sunPos      Sun position relative to the floating origin
 * @param {number}  ctx.sunRadius
 * @param {boolean} ctx.eclipsesOn
 * @param {(key:string) => Array<{pos:Vector3, radius:number}>} ctx.occludersFor
 * @param {(key:string) => Vector3} ctx.poleFor
 * @param {object|null} ctx.ringShadow  { center, normal, inner, outer, map }
 */
export function updateFrameUniforms(ctx) {
  for (const entry of registry) {
    const u = entry.mat.uniforms;
    if (!u.uSunPos) continue;

    u.uSunPos.value.copy(ctx.sunPos);
    u.uSunRadius.value = ctx.sunRadius;
    u.uEclipseOn.value = ctx.eclipsesOn ? 1 : 0;

    if (u.uIrradiance) u.uIrradiance.value = ctx.irradianceFor(entry.bodyKey);

    if (entry.wantsOccluders) {
      // Already ranked by angular size at the source, so truncating keeps the
      // occluders that could actually cover the Sun.
      const occ = ctx.occludersFor(entry.bodyKey);
      const n = Math.min(occ.length, MAX_OCCLUDERS);
      for (let i = 0; i < n; i++) {
        u.uOccPos.value[i].copy(occ[i].pos);
        u.uOccRad.value[i] = occ[i].radius;
      }
      u.uOccCount.value = n;
    }

    if (entry.wantsPole && u.uPoleWorld) {
      u.uPoleWorld.value.copy(ctx.poleFor(entry.bodyKey) || _tmpVec.set(0, 1, 0));
    }

    // Saturn (and its cloud/atmosphere layers) receive the ring shadow.
    const rs = ctx.ringShadow;
    if (rs && rs.bodyKey === entry.bodyKey && entry.ringSelfShadow !== false) {
      u.uHasRingShadow.value = 1;
      u.uRingCenter.value.copy(rs.center);
      u.uRingNormal.value.copy(rs.normal);
      u.uRingInner.value = rs.inner;
      u.uRingOuter.value = rs.outer;
      u.uRingMap.value = rs.map;
    } else {
      u.uHasRingShadow.value = 0;
    }
  }
}

/**
 * Bind a real texture to every uRingMap sampler. WebGL complains about
 * unbound samplers even on branches that never execute, so all materials get
 * the ring strip whether or not they will ever sample it.
 */
export function setFallbackRingMap(tex) {
  for (const entry of registry) {
    const u = entry.mat.uniforms;
    if (u.uRingMap && !u.uRingMap.value) u.uRingMap.value = tex;
  }
}

export function setSunIntensity(value) {
  for (const entry of registry) {
    if (entry.mat.uniforms.uSunIntensity) entry.mat.uniforms.uSunIntensity.value = value;
  }
}
