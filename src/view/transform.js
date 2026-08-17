/**
 * Realistic <-> schematic view transform.
 *
 * The solar system is mostly empty. At true scale Earth is 1/12,000 of the way
 * across its own orbit, so any view wide enough to show the system shows
 * nothing but dots. The classic fix is an orrery: keep the *angles* honest and
 * lie about the radii.
 *
 * That is exactly what this does. Directions are never touched, so conjunctions,
 * oppositions, retrograde loops, transits and the phase of every body remain
 * the real thing at the real date. Only distances-from-centre and body radii
 * are remapped, both by power laws:
 *
 *   radius:            R' = C * sqrt(R)          small bodies grow much more
 *   heliocentric dist: d' = A * (d/AU)^0.45      compresses the outer system
 *   satellite dist:    d' = R'parent * (d/Rparent)^0.35
 *
 * Square-root-ish laws are what keep Mercury and Jupiter on the same screen:
 * a linear multiplier that makes Mercury visible turns Jupiter into a wall.
 *
 * `blend` cross-fades between the identity (0, physically true) and the fully
 * schematic mapping (1), so the transition can be animated instead of snapping.
 */

import { Vector3 } from 'three';
import { AU, KM } from '../core/constants.js';

/** Earth's radius in the fully schematic mapping, in scene units (1 = 1000 km). */
const EARTH_SCHEMATIC_RADIUS = 255;
const RADIUS_EXP = 0.5;
const RADIUS_C = EARTH_SCHEMATIC_RADIUS / (6378.137 * KM) ** RADIUS_EXP;

/** The Sun is shrunk relative to the same law, or it dominates everything. */
const STAR_DAMPING = 0.6;

/** Earth's orbit lands here in the fully schematic mapping. */
const ORBIT_REF = 0.16 * AU;
const ORBIT_EXP = 0.45;

/**
 * Satellite orbits are expressed in parent radii and compressed hard. The
 * exponent is chosen so the Moon still covers the Sun in schematic mode —
 * otherwise every solar eclipse would degrade to annular.
 */
const SAT_EXP = 0.35;

const _dir = new Vector3();

export class ViewTransform {
  constructor() {
    /** 0 = physically true, 1 = fully schematic. */
    this.blend = 0;
    /** Extra multiplier applied to body radii on top of everything else. */
    this.sizeExaggeration = 1;
  }

  get isRealistic() {
    return this.blend < 0.001 && this.sizeExaggeration < 1.02;
  }

  /** Displayed radius for a true radius, in scene units. */
  radius(trueRadius, isStar = false) {
    const schematic = RADIUS_C * trueRadius ** RADIUS_EXP * (isStar ? STAR_DAMPING : 1);
    const r = trueRadius + (schematic - trueRadius) * this.blend;
    return r * (isStar ? 1 : this.sizeExaggeration);
  }

  /** Scale factor applied to a body's radius — rings inherit it. */
  radiusScale(trueRadius, isStar = false) {
    return this.radius(trueRadius, isStar) / trueRadius;
  }

  /** Remap a heliocentric position. Direction is preserved exactly. */
  mapHeliocentric(pos, out) {
    const d = pos.length();
    if (d < 1e-9 || this.blend < 1e-6) return out.copy(pos);
    const schematic = ORBIT_REF * (d / AU) ** ORBIT_EXP;
    const d2 = d + (schematic - d) * this.blend;
    return out.copy(pos).multiplyScalar(d2 / d);
  }

  /**
   * Remap a planet-centric satellite position.
   * @param {Vector3} rel        satellite position relative to its parent
   * @param {number} parentTrue  parent's true radius
   * @param {number} parentDisp  parent's displayed radius
   */
  mapSatellite(rel, parentTrue, parentDisp, out) {
    const d = rel.length();
    if (d < 1e-9 || this.blend < 1e-6) return out.copy(rel);
    const schematic = parentDisp * (d / parentTrue) ** SAT_EXP;
    const d2 = d + (schematic - d) * this.blend;
    return out.copy(rel).multiplyScalar(d2 / d);
  }

  /** How far out the camera should sit to frame the whole system. */
  systemExtent() {
    _dir.set(30 * AU, 0, 0);
    return this.mapHeliocentric(_dir, _dir).length();
  }
}
