/**
 * Comas and tails.
 *
 * A comet nucleus is a few km across — invisible at true scale from anywhere
 * useful. What you actually see is the coma and tail, which are a *response to
 * sunlight*, not fixed features: the nucleus is inert beyond roughly 3 AU and
 * switches on as it falls inward, sublimating ice into a coma that solar
 * radiation pressure and the solar wind blow outward.
 *
 * Two consequences drive everything here:
 *   - Activity scales steeply with heliocentric distance, so both coma and
 *     tail grow enormously near perihelion and vanish out past the belt.
 *   - The tail points *away from the Sun*, not backwards along the orbit. On
 *     the outbound leg a comet therefore travels tail-first, which is the
 *     detail most depictions get wrong.
 *
 * The dust tail also lags: heavier grains keep more of the comet's orbital
 * momentum, so the tail curves back along the track rather than lying exactly
 * anti-sunward. That is modelled by blending the anti-sun direction with the
 * comet's velocity.
 */

import {
  Mesh, PlaneGeometry, ShaderMaterial, AdditiveBlending, DoubleSide,
  Matrix4, Object3D, Vector3, Color,
} from 'three';
import { AU } from '../core/constants.js';
import { COMETS } from '../ephem/comets.js';

/** Beyond this heliocentric distance a comet is effectively inert. */
const ACTIVITY_ONSET_AU = 3.2;

const COMA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Bright condensed centre over a broad faint halo.
  float inner = exp(-pow(r * 4.5, 1.6));
  float outer = exp(-pow(r * 1.7, 1.2)) * 0.30;
  gl_FragColor = vec4(uColor * (inner + outer) * uIntensity, 1.0);
}
`;

const COMA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const TAIL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

/**
 * The tail is a camera-facing quad shaped entirely in the fragment shader,
 * not a cone.
 *
 * A cone brings two problems that a billboard does not: its wrap seam shows as
 * a hard edge under additive blending, and its silhouette reads as solid
 * geometry rather than as gas. Shaping a quad instead gives direct control of
 * the plume's taper and lets the edges fall off smoothly in every direction.
 *
 * The quad is built so v = 0 sits on the nucleus and v = 1 at the far end, so
 * density falls off *downstream* — which is the way round a real tail goes.
 */
const TAIL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uSpread;   // how much the plume fans out along its length

void main() {
  #include <logdepthbuf_fragment>
  float along = clamp(vUv.y, 0.0, 1.0);
  float across = vUv.x * 2.0 - 1.0;             // -1 .. 1 across the width

  // Narrow at the nucleus, fanning downstream.
  float halfWidth = mix(0.13, 1.0, pow(along, uSpread));
  float d = abs(across) / halfWidth;
  if (d > 1.0) discard;

  float profile = pow(1.0 - d * d, 1.7);        // soft edges
  float fade = pow(1.0 - along, 1.7);           // density drops with distance
  gl_FragColor = vec4(uColor * uIntensity * fade * profile, 1.0);
}
`;

function comaMaterial(color) {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uIntensity: { value: 1 },
    },
    vertexShader: COMA_VERT,
    fragmentShader: COMA_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

function tailMaterial(color, spread) {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uIntensity: { value: 1 },
      uSpread: { value: spread },
    },
    vertexShader: TAIL_VERT,
    fragmentShader: TAIL_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

const _sunDir = new Vector3();
const _vel = new Vector3();
const _dir = new Vector3();
const _centre = new Vector3();
const _toCam = new Vector3();
const _bx = new Vector3();
const _bz = new Vector3();
const _basis = new Matrix4();

export class CometVisuals {
  /**
   * @param {import('three').Scene} scene
   * @param {string[]} keys comet keys present in the body catalogue
   */
  constructor(scene, keys) {
    this.entries = new Map();
    this.root = new Object3D();
    scene.add(this.root);

    for (const key of keys) {
      const group = new Object3D();

      // Unit-sized primitives; scaled per frame from the activity level.
      const coma = new Mesh(new PlaneGeometry(1, 1), comaMaterial(0x9fd8ff));
      coma.renderOrder = 4;

      // Ion tail: narrow, straight, blue, driven straight down the anti-sun
      // line by the solar wind.
      const ion = new Mesh(new PlaneGeometry(1, 1), tailMaterial(0x7fb4ff, 1.1));
      ion.renderOrder = 3;

      // Dust tail: broader and warmer, and swung toward the direction of
      // travel because heavier grains keep more of the orbital momentum.
      const dust = new Mesh(new PlaneGeometry(1, 1), tailMaterial(0xffd9a8, 0.55));
      dust.renderOrder = 3;

      group.add(coma, ion, dust);
      this.root.add(group);
      this.entries.set(key, { group, coma, ion, dust, prevPos: new Vector3(), hasPrev: false });
    }
  }

  /**
   * @param {object} ctx
   * @param {(key:string)=>Vector3} ctx.displayPos origin-relative position
   * @param {Vector3} ctx.sunPos origin-relative Sun position
   * @param {(key:string)=>number} ctx.trueDistanceAU real heliocentric distance
   * @param {number} ctx.exposure
   * @param {(key:string)=>number} ctx.lengthScale displayed/true radial ratio,
   *   so the coma shrinks with the orbits in schematic mode
   */
  update(ctx) {
    for (const [key, e] of this.entries) {
      const def = COMETS[key];
      const pos = ctx.displayPos(key);
      const rAU = ctx.trueDistanceAU(key);

      // Activity: effectively zero beyond the onset distance, rising steeply
      // inward. The exponent is empirical but the shape is the real one.
      const t = Math.max(0, (ACTIVITY_ONSET_AU - rAU) / ACTIVITY_ONSET_AU);
      const activity = Math.min(1, t * t * 1.6);

      const visible = activity > 0.004;
      e.group.visible = visible;
      if (!visible) {
        e.hasPrev = false;
        continue;
      }

      e.group.position.copy(pos);

      // Anti-sunward direction, in scene space.
      _sunDir.copy(pos).sub(ctx.sunPos).normalize();

      // Velocity direction, from the last frame's position.
      if (e.hasPrev) _vel.copy(pos).sub(e.prevPos);
      else _vel.set(0, 0, 0);
      e.prevPos.copy(pos);
      e.hasPrev = true;

      /*
       * Coma and tail are sized in AU, not as multiples of the nucleus.
       * A nucleus is a few km; a coma is a million and a tail can run a third
       * of an AU. Deriving them from the nucleus radius would keep them
       * invisibly small — the enormous ratio between the solid body and the
       * cloud it sheds is the whole point of a comet.
       *
       * A bigger nucleus outgasses more, but sub-linearly, so activity scales
       * with the square root of radius, normalised to Halley.
       */
      const sizeFactor = Math.sqrt(def.radius / 5.5);
      const lengthScale = ctx.lengthScale(key);

      const comaSize = AU * (0.0008 + 0.006 * activity) * sizeFactor * lengthScale;
      e.coma.scale.setScalar(comaSize);
      e.coma.quaternion.copy(ctx.cameraQuaternion);
      e.coma.material.uniforms.uIntensity.value = intensity(activity, ctx.exposure, 1.1);

      const tailLength = AU * (0.01 + 0.30 * activity) * sizeFactor * lengthScale;
      const tailWidth = comaSize * 1.15;

      this._orientTail(e.ion, _sunDir, tailLength, tailWidth,
        intensity(activity, ctx.exposure, 0.9), pos);

      // Dust lags toward the direction of travel; heavier grains keep more of
      // the comet's orbital momentum and fall behind the ion tail.
      _dir.copy(_sunDir);
      if (_vel.lengthSq() > 0) _dir.addScaledVector(_vel.normalize(), -0.28).normalize();
      this._orientTail(e.dust, _dir, tailLength * 0.72, tailWidth * 1.9,
        intensity(activity, ctx.exposure, 0.7), pos);
    }
  }

  /**
   * Lay the plume quad down `dir` with its near edge on the nucleus, rotated
   * about that axis to face the camera as squarely as possible.
   */
  _orientTail(mesh, dir, length, width, intensityValue, nucleusPos) {
    mesh.scale.set(width, length, 1);
    mesh.position.copy(dir).multiplyScalar(length * 0.5);

    // Camera sits at the scene origin, so the view direction from the quad's
    // centre is simply -centre.
    _centre.copy(nucleusPos).addScaledVector(dir, length * 0.5);
    _toCam.copy(_centre).negate().normalize();

    _bx.crossVectors(dir, _toCam);
    if (_bx.lengthSq() < 1e-12) _bx.set(1, 0, 0); // looking straight down the tail
    _bx.normalize();
    _bz.crossVectors(_bx, dir).normalize();
    _basis.makeBasis(_bx, dir, _bz);
    mesh.quaternion.setFromRotationMatrix(_basis);

    mesh.material.uniforms.uIntensity.value = intensityValue;
  }

  setVisible(v) {
    this.root.visible = v;
  }
}

function intensity(activity, exposure, gain) {
  // Keep apparent brightness steady as auto-exposure opens and closes.
  return Math.min(6, (activity * gain) / Math.max(exposure, 0.05));
}
