/**
 * The path of totality, drawn on the ground.
 *
 * The track is built in Earth-*fixed* coordinates and parented to the planet's
 * orientation node, which is the whole trick: a ground track is a feature of
 * the rotating surface, not of space, so once it is expressed in body
 * coordinates it turns with the Earth for free and stays pinned to the
 * geography it actually crosses.
 *
 * The ribbon is drawn at the true width of the umbra rather than as a hairline.
 * That width is found by stepping sideways from the centre line until the point
 * is no longer totally eclipsed — the same circle-overlap geometry the shader
 * uses, run on the CPU — so a wide slow track near the sub-solar point and a
 * narrow grazing one at high latitude come out visibly different, as they are.
 *
 * Everything is recomputed only when the eclipse changes, not per frame.
 */

import {
  Vector3, Quaternion, BufferGeometry, BufferAttribute, Mesh,
  ShaderMaterial, DoubleSide, Object3D,
} from 'three';
import { KM } from '../core/constants.js';
import { SolarSystem } from '../ephem/system.js';

const R_SUN = 696000 * KM;
const R_EARTH = 6378.137 * KM;
const R_MOON = 1737.4 * KM;

/** Samples along the track, and sideways steps used to find its edge. */
const TRACK_SAMPLES = 400;
const WIDTH_STEPS = 14;

const _sun = new Vector3(0, 0, 0);
const _axis = new Vector3();
const _rel = new Vector3();
const _hit = new Vector3();
const _q = new Vector3();

/** Fraction of the Sun's disc hidden by the Moon, as seen from `p`. */
function obscurationAt(p, moon) {
  const toSun = _q.copy(_sun).sub(p);
  const dS = toSun.length();
  const dM = _rel.copy(moon).sub(p).length();
  if (dM >= dS) return 0;

  const rs = Math.asin(Math.min(1, R_SUN / dS));
  const rm = Math.asin(Math.min(1, R_MOON / dM));
  const cos = toSun.dot(_rel) / (dS * dM);
  const sep = Math.acos(Math.min(1, Math.max(-1, cos)));

  if (sep >= rs + rm) return 0;
  if (sep <= Math.abs(rs - rm)) return Math.min(1, (rm * rm) / (rs * rs));

  // Area shared by two circles of angular radii rs, rm separated by sep.
  const d2 = sep * sep;
  const a = (d2 + rs * rs - rm * rm) / (2 * sep * rs);
  const b = (d2 + rm * rm - rs * rs) / (2 * sep * rm);
  const t1 = rs * rs * Math.acos(Math.min(1, Math.max(-1, a)));
  const t2 = rm * rm * Math.acos(Math.min(1, Math.max(-1, b)));
  const t3 = 0.5 * Math.sqrt(Math.max(0,
    (-sep + rs + rm) * (sep + rs - rm) * (sep - rs + rm) * (sep + rs + rm)));
  return (t1 + t2 - t3) / (Math.PI * rs * rs);
}

/**
 * Where the Sun-Moon axis meets the Earth, as a unit vector from Earth's
 * centre in world axes, or null when the axis misses.
 */
function shadowPoint(earth, moon, out) {
  _axis.copy(moon).sub(_sun).normalize();
  _rel.copy(earth).sub(_sun);
  const tca = _rel.dot(_axis);
  const closest = _hit.copy(_sun).addScaledVector(_axis, tca);
  const miss = closest.distanceTo(earth);
  if (miss >= R_EARTH) return null;
  const back = Math.sqrt(R_EARTH * R_EARTH - miss * miss);
  return out.copy(_sun).addScaledVector(_axis, tca - back).sub(earth).normalize();
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vEdge;
attribute float aEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying float vEdge;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  #include <logdepthbuf_fragment>
  // Solid down the centre line, softening to the umbra's edge.
  float a = (1.0 - vEdge * vEdge) * 0.55 + 0.45 * (1.0 - smoothstep(0.75, 1.0, vEdge));
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

export class EclipsePath {
  constructor() {
    this.scratch = new SolarSystem();
    this.root = new Object3D();
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Vector3(1.0, 0.78, 0.35) },
        uOpacity: { value: 0.85 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = null;
    this.key = null;    // identifies the eclipse currently drawn
    this.window = null; // cached bracket, so the search is not repeated per frame
    this.attached = null;
  }

  /**
   * @param {number} jd
   * @param {object} earthEntry the builder entry for Earth
   * @param {boolean} enabled
   */
  update(jd, earthEntry, enabled) {
    if (!enabled || !earthEntry) {
      this.root.visible = false;
      return;
    }

    // Parent to Earth's orientation node so the track turns with the surface.
    if (this.attached !== earthEntry.orient) {
      earthEntry.orient.add(this.root);
      this.attached = earthEntry.orient;
    }

    /*
     * Reuse the bracketed window while the clock stays inside it. Searching
     * costs ~150 full ephemeris updates, which is fine once per eclipse and
     * absurd once per frame — and an eclipse's window does not move.
     */
    let window = this.window;
    if (!window || jd < window.start - 0.05 || jd > window.end + 0.05) {
      window = this._windowFor(jd);
      this.window = window;
    }
    if (!window) {
      this.root.visible = false;
      this.key = null;
      return;
    }

    const key = Math.round(window.peak * 1440); // to the minute
    if (key !== this.key) {
      this._build(window);
      this.key = key;
    }
    this.root.visible = !!this.mesh;
  }

  /**
   * Bracket the central eclipse around `jd`: the span over which the axis
   * actually touches the Earth. Returns null when nothing central is near.
   */
  _windowFor(jd) {
    const s = this.scratch;
    const central = (t) => {
      s.update(t);
      return shadowPoint(s.pos('earth'), s.pos('moon'), _hit) !== null;
    };

    // Coarse sweep of half a day either side, which comfortably contains any
    // central eclipse, then refine each end.
    let inside = null;
    for (let i = -48; i <= 48; i++) {
      const t = jd + i * (0.5 / 48);
      if (central(t)) { inside = t; break; }
    }
    if (inside === null) return null;

    const edge = (dir) => {
      let lo = inside;
      let hi = inside + dir * 0.35;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (central(mid)) lo = mid; else hi = mid;
      }
      return lo;
    };
    const start = edge(-1);
    const end = edge(1);
    return { start, end, peak: (start + end) / 2 };
  }

  _build(window) {
    const s = this.scratch;

    /*
     * Pass one: the centre line, plus the state needed to measure the track at
     * each point. Widths need the *track direction*, which is only known once
     * neighbouring samples exist, so it cannot be done in a single pass.
     */
    const track = [];
    for (let i = 0; i <= TRACK_SAMPLES; i++) {
      const t = window.start + (window.end - window.start) * (i / TRACK_SAMPLES);
      s.update(t);
      const centre = new Vector3();
      if (!shadowPoint(s.pos('earth'), s.pos('moon'), centre)) continue;
      track.push({
        centre,
        earth: s.pos('earth').clone(),
        moon: s.pos('moon').clone(),
        // The system's own matrix, which already carries the ecliptic-to-scene
        // rotation that positions use. Calling bodyOrientation() directly
        // returns the ecliptic-frame basis and silently mixes the two frames.
        quat: new Quaternion().setFromRotationMatrix(s.get('earth').orient).invert(),
      });
    }
    if (track.length < 2) { this._dispose(); this.mesh = null; return; }

    // Pass two: step across the track to find where totality is lost.
    const left = [];
    const right = [];
    const across = new Vector3();
    const tangent = new Vector3();
    const probe = new Vector3();

    for (let i = 0; i < track.length; i++) {
      const { centre, earth, moon, quat } = track[i];
      const prev = track[Math.max(0, i - 1)].centre;
      const next = track[Math.min(track.length - 1, i + 1)].centre;

      tangent.copy(next).sub(prev);
      // Perpendicular to both the surface normal and the direction of travel;
      // measuring along the track instead would wildly overstate the width.
      across.crossVectors(centre, tangent);
      if (across.lengthSq() < 1e-16) across.set(1, 0, 0);
      across.normalize();

      let lo = 0;
      let hi = 0.05; // radians of arc; the umbra never approaches this
      for (let k = 0; k < WIDTH_STEPS; k++) {
        const mid = (lo + hi) / 2;
        probe.copy(centre).addScaledVector(across, Math.tan(mid)).normalize()
          .multiplyScalar(R_EARTH).add(earth);
        if (obscurationAt(probe, moon) > 0.999) lo = mid; else hi = mid;
      }
      const half = Math.max(lo, 2e-5);

      for (const [side, out] of [[-1, left], [1, right]]) {
        probe.copy(centre).addScaledVector(across, side * Math.tan(half)).normalize()
          .applyQuaternion(quat).multiplyScalar(R_EARTH * 1.0015);
        out.push(probe.x, probe.y, probe.z);
      }
    }

    this._dispose();
    const n = left.length / 3;
    if (n < 2) { this.mesh = null; return; }

    // Two rails zipped into a strip.
    const pos = new Float32Array(n * 6);
    const edge = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos.set(left.slice(i * 3, i * 3 + 3), i * 6);
      pos.set(right.slice(i * 3, i * 3 + 3), i * 6 + 3);
      edge[i * 2] = 1;
      edge[i * 2 + 1] = -1;
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aEdge', new BufferAttribute(edge, 1));
    geo.setIndex(index);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.root.add(this.mesh);
  }

  _dispose() {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }
}
