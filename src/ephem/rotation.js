/**
 * Body orientation from the IAU/IAG Working Group rotational elements
 * (Archinal et al., 2015 report).
 *
 * Each body has a north pole direction (alpha0, delta0) given in the ICRF
 * *equatorial* J2000 frame, and a prime meridian angle
 *   W = W0 + Wdot * d          (d = days since J2000)
 * measured eastward from the ascending node of the body equator on the ICRF
 * equator. A negative Wdot means retrograde rotation (Venus, Uranus).
 *
 * We convert the pole into the J2000 *ecliptic* frame used everywhere else,
 * then build the body-fixed basis:
 *   Zb = north pole
 *   Xb = prime meridian direction  = node rotated east by W
 *   Yb = Zb x Xb
 */

import { Vector3, Matrix4 } from 'three';
import { DEG, OBLIQUITY, centuries, days } from '../core/constants.js';
import { deltaTDays } from '../core/deltat.js';

// key: [a0, a0_dotT, d0, d0_dotT, W0, Wdot]   degrees, rates per century / per day
const IAU = {
  sun: [286.13, 0, 63.87, 0, 84.176, 14.1844 ],
  mercury: [281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108],
  venus: [272.76, 0, 67.16, 0, 160.2, -1.4813688],
  earth: [0.0, -0.641, 90.0, -0.557, 190.147, 360.9856235],
  moon: [269.9949, 0.0031, 66.5392, 0.013, 38.3213, 13.17635815],
  mars: [317.269202, -0.10927, 54.432516, -0.05827, 176.049863, 350.891982443297],
  jupiter: [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.536],
  saturn: [40.589, -0.036, 83.537, -0.004, 38.9, 810.7939024],
  uranus: [257.311, 0, -15.175, 0, 203.81, -501.1600928],
  neptune: [299.36, 0, 43.46, 0, 253.18, 536.3128492],
  io: [268.05, -0.009, 64.5, 0.003, 200.39, 203.4889538],
  europa: [268.08, -0.009, 64.51, 0.003, 36.022, 101.3747235],
  ganymede: [268.2, -0.009, 64.57, 0.003, 44.064, 50.3176081],
  callisto: [268.72, -0.009, 64.83, 0.003, 259.51, 21.5710715],
  titan: [39.4827, 0, 83.4279, 0, 186.5855, 22.5769768],
  ceres: [291.418, 0, 66.764, 0, 170.65, 952.1532],
  // Pluto and Charon are mutually tidally locked, so they share a spin rate
  // and a pole; only the prime-meridian offset differs.
  pluto: [132.993, 0, -6.163, 0, 302.695, 56.3625225],
  charon: [132.993, 0, -6.163, 0, 122.695, 56.3625225],
};

const _pole = new Vector3();
const _node = new Vector3();
const _xb = new Vector3();
const _yb = new Vector3();
const _tmp = new Vector3();

/** Rotate an ICRF-equatorial vector into the J2000 ecliptic frame, in place. */
export function equatorialToEcliptic(v) {
  const c = Math.cos(OBLIQUITY);
  const s = Math.sin(OBLIQUITY);
  const y = v.y;
  const z = v.z;
  v.y = y * c + z * s;
  v.z = -y * s + z * c;
  return v;
}

/** North pole unit vector in the J2000 ecliptic frame. */
export function bodyPole(key, jd, out = new Vector3()) {
  const e = IAU[key];
  if (!e) return out.set(0, 0, 1);
  const T = centuries(jd);
  const a0 = (e[0] + e[1] * T) * DEG;
  const d0 = (e[2] + e[3] * T) * DEG;
  const cd = Math.cos(d0);
  out.set(cd * Math.cos(a0), cd * Math.sin(a0), Math.sin(d0));
  return equatorialToEcliptic(out);
}

/**
 * Bodies whose spin must be driven by UT1 rather than TT.
 *
 * Only the Earth, and only because it is the one body whose surface features
 * we compare against an external shadow. Delta-T worth of rotation is ~0.29 deg
 * of longitude today; on any other body there is no geography we are trying to
 * line up with, so the IAU convention is used as published.
 */
const USES_UT1 = new Set(['earth']);

/** Prime meridian angle W in degrees. */
export function primeMeridian(key, jd) {
  const e = IAU[key];
  if (!e) return 0;
  const d = USES_UT1.has(key) ? days(jd) - deltaTDays(jd) : days(jd);
  return e[4] + e[5] * d;
}

/** Sidereal rotation period in days (negative for retrograde rotators). */
export function rotationPeriodDays(key) {
  const e = IAU[key];
  if (!e || !e[5]) return Infinity;
  return 360 / e[5];
}

/** Axial tilt (obliquity to the ecliptic) in degrees. */
export function axialTilt(key, jd = 2451545.0) {
  bodyPole(key, jd, _tmp);
  return Math.acos(Math.min(1, Math.max(-1, _tmp.z))) / DEG;
}

/**
 * Full body-fixed orientation as a rotation matrix, in the J2000 ecliptic frame.
 *
 * Three.js SphereGeometry puts its poles on local +Y/-Y and the texture's
 * prime meridian (u = 0.5) on local +X, with u increasing eastward as a
 * right-handed rotation about +Y. So we map local +Y -> pole and local +X ->
 * prime meridian, which forces local +Z -> -Yb to stay right-handed.
 */
export function bodyOrientation(key, jd, out = new Matrix4()) {
  const e = IAU[key];
  if (!e) return out.identity();

  const T = centuries(jd);
  const a0 = (e[0] + e[1] * T) * DEG;

  bodyPole(key, jd, _pole);

  // Ascending node of the body equator on the ICRF equator is at RA = a0 + 90
  _node.set(-Math.sin(a0), Math.cos(a0), 0);
  equatorialToEcliptic(_node);

  const W = primeMeridian(key, jd) * DEG;
  // Xb = node rotated eastward about the pole by W
  _tmp.copy(_pole).cross(_node); // pole x node, completes the right-handed pair
  _xb.copy(_node).multiplyScalar(Math.cos(W)).addScaledVector(_tmp, Math.sin(W)).normalize();
  _yb.copy(_pole).cross(_xb).normalize();

  return out.makeBasis(_xb, _pole, _yb.negate());
}

/** Orientation of a body's equatorial plane only (no spin) — used for satellite orbits. */
export function equatorialBasis(key, jd) {
  const e = IAU[key] || [0, 0, 90, 0, 0, 0];
  const T = centuries(jd);
  const a0 = (e[0] + e[1] * T) * DEG;
  const pole = bodyPole(key, jd, new Vector3());
  const node = equatorialToEcliptic(new Vector3(-Math.sin(a0), Math.cos(a0), 0)).normalize();
  const third = new Vector3().crossVectors(pole, node);
  return { pole, node, third };
}

export const HAS_ROTATION = (key) => key in IAU;
