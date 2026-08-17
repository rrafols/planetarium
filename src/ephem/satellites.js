/**
 * Planet-centric positions for the moons other than our own.
 *
 * Galilean moons: Meeus "Astronomical Algorithms" ch. 44, low-accuracy method.
 *   Mean longitudes are referred to the equinox of date and measured in the
 *   ecliptic; radii come out in Jupiter equatorial radii. Positional error is
 *   a few hundredths of a Jupiter radius, so mutual events and shadow transits
 *   land within a couple of minutes of reality.
 *
 * Everything else: Keplerian motion in the planet's equatorial (Laplace) plane.
 *   Semi-major axes, eccentricities, inclinations and periods are the measured
 *   values, so orbit sizes, speeds, planes and relative geometry are right.
 *   The *epoch phase* — where along its orbit each moon sits at J2000 — is
 *   approximate. Treat position-along-orbit for these as illustrative rather
 *   than predictive; everything else about them is real.
 *
 * Everything returns planet-centric J2000-ecliptic rectangular km.
 */

import { Vector3 } from 'three';
import { DEG, norm360, J2000 } from '../core/constants.js';
import { bodyPole } from './rotation.js';

const R_JUPITER = 71492; // km, equatorial
const MEEUS_EPOCH = 2443000.5; // 1976 Aug 10.0 TD

const _pole = new Vector3();
const _node = new Vector3();
const _perp = new Vector3();

/**
 * Basis of a planet's equatorial plane, expressed in ecliptic coordinates.
 * The ascending node of that plane on the ecliptic lies along z_hat x pole.
 */
function equatorialFrame(planetKey, jd) {
  bodyPole(planetKey, jd, _pole).normalize();
  _node.set(-_pole.y, _pole.x, 0);
  if (_node.lengthSq() < 1e-12) _node.set(1, 0, 0); // pole normal to the ecliptic
  _node.normalize();
  _perp.crossVectors(_pole, _node);
  return { pole: _pole, node: _node, perp: _perp };
}

/**
 * Place a body at ecliptic-of-date longitude `lonDeg` and distance `r`, but
 * lying in the planet's equatorial plane rather than the ecliptic.
 */
function inEquatorialPlane(planetKey, jd, lonDeg, r, out) {
  const f = equatorialFrame(planetKey, jd);
  const psi = Math.atan2(f.node.y, f.node.x) / DEG; // ecliptic longitude of the node
  const u = (lonDeg - psi) * DEG;
  return out
    .copy(f.node).multiplyScalar(r * Math.cos(u))
    .addScaledVector(f.perp, r * Math.sin(u));
}

/* --------------------------------------------------------- Galilean moons */

/** Galilean moons. Returns { io, europa, ganymede, callisto } in km. */
export function galileanPositions(jd, out) {
  const t = jd - MEEUS_EPOCH;

  const l1 = norm360(106.07719 + 203.48895579 * t);
  const l2 = norm360(175.73161 + 101.374724735 * t);
  const l3 = norm360(120.55883 + 50.317609207 * t);
  const l4 = norm360(84.44459 + 21.571071177 * t);

  const G = (331.18 + 50.310482 * t) * DEG;
  const H = (87.45 + 21.569231 * t) * DEG;

  const d12 = 2 * (l1 - l2) * DEG;
  const d23 = 2 * (l2 - l3) * DEG;

  // Principal periodic corrections to longitude (degrees) and radius (R_jup)
  const s1 = 0.473 * Math.sin(d12);
  const s2 = 1.065 * Math.sin(d23);
  const s3 = 0.165 * Math.sin(G);
  const s4 = 0.843 * Math.sin(H);

  const r1 = 5.9057 - 0.0244 * Math.cos(d12);
  const r2 = 9.3966 - 0.0882 * Math.cos(d23);
  const r3 = 14.9883 - 0.0216 * Math.cos(G);
  const r4 = 26.3627 - 0.1939 * Math.cos(H);

  inEquatorialPlane('jupiter', jd, l1 + s1, r1 * R_JUPITER, out.io);
  inEquatorialPlane('jupiter', jd, l2 + s2, r2 * R_JUPITER, out.europa);
  inEquatorialPlane('jupiter', jd, l3 + s3, r3 * R_JUPITER, out.ganymede);
  inEquatorialPlane('jupiter', jd, l4 + s4, r4 * R_JUPITER, out.callisto);
  return out;
}

/* ------------------------------------------------------ Keplerian moons */

/**
 * Orbital elements referred to the parent's equatorial plane.
 *
 *   a       semi-major axis, km
 *   period  sidereal period, days
 *   e       eccentricity
 *   i       inclination to the parent's equator, degrees
 *           (values above 90 are retrograde — Triton)
 *   node    longitude of the ascending node in that plane, degrees
 *   peri    argument of pericentre, degrees
 *   l0      mean longitude at J2000, degrees  — APPROXIMATE, see file header
 */
export const KEPLERIAN_MOONS = {
  // Mars
  phobos: { parent: 'mars', a: 9376, period: 0.318910, e: 0.0151, i: 1.093, node: 0, peri: 150, l0: 232 },
  deimos: { parent: 'mars', a: 23463, period: 1.263, e: 0.00033, i: 0.93, node: 0, peri: 260, l0: 5 },

  // Saturn
  mimas: { parent: 'saturn', a: 185539, period: 0.942422, e: 0.0196, i: 1.574, node: 0, peri: 160, l0: 105 },
  enceladus: { parent: 'saturn', a: 237948, period: 1.370218, e: 0.0047, i: 0.009, node: 0, peri: 120, l0: 200 },
  tethys: { parent: 'saturn', a: 294619, period: 1.887802, e: 0.0001, i: 1.091, node: 0, peri: 0, l0: 285 },
  dione: { parent: 'saturn', a: 377396, period: 2.736915, e: 0.0022, i: 0.028, node: 0, peri: 170, l0: 20 },
  rhea: { parent: 'saturn', a: 527108, period: 4.518212, e: 0.001, i: 0.331, node: 0, peri: 45, l0: 148 },
  titan: { parent: 'saturn', a: 1221870, period: 15.945421, e: 0.0288, i: 0.34854, node: 0, peri: 180, l0: 158 },
  iapetus: { parent: 'saturn', a: 3560820, period: 79.3215, e: 0.0286, i: 15.47, node: 0, peri: 230, l0: 320 },

  // Uranus
  miranda: { parent: 'uranus', a: 129390, period: 1.413479, e: 0.0013, i: 4.232, node: 0, peri: 155, l0: 30 },
  ariel: { parent: 'uranus', a: 190900, period: 2.520379, e: 0.0012, i: 0.26, node: 0, peri: 85, l0: 190 },
  umbriel: { parent: 'uranus', a: 266000, period: 4.144177, e: 0.0039, i: 0.128, node: 0, peri: 265, l0: 95 },
  titania: { parent: 'uranus', a: 436300, period: 8.705872, e: 0.0011, i: 0.34, node: 0, peri: 285, l0: 250 },
  oberon: { parent: 'uranus', a: 583500, period: 13.463239, e: 0.0014, i: 0.058, node: 0, peri: 105, l0: 340 },

  // Neptune — Triton's 157 deg inclination is what makes it retrograde
  triton: { parent: 'neptune', a: 354759, period: 5.876854, e: 0.000016, i: 156.885, node: 0, peri: 0, l0: 60 },
};

function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 10; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/**
 * Keplerian satellite position, planet-centric, ecliptic km.
 * @param {string} key one of KEPLERIAN_MOONS
 */
export function keplerianMoonPosition(key, jd, out) {
  const el = KEPLERIAN_MOONS[key];
  const f = equatorialFrame(el.parent, jd);

  const n = 360 / el.period;
  const M = (norm360(el.l0 + n * (jd - J2000) - el.peri)) * DEG;
  const E = solveKepler(M, el.e);

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const r = el.a * (1 - el.e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - el.e * el.e) * sinE, cosE - el.e);

  const u = nu + el.peri * DEG; // argument of latitude
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const ci = Math.cos(el.i * DEG);
  const si = Math.sin(el.i * DEG);
  const cn = Math.cos(el.node * DEG);
  const sn = Math.sin(el.node * DEG);

  // Standard Keplerian rotation, expressed in the parent's equatorial frame.
  const xe = r * (cn * cu - sn * su * ci);
  const ye = r * (sn * cu + cn * su * ci);
  const ze = r * su * si;

  // That frame's axes, in ecliptic coordinates.
  return out
    .copy(f.node).multiplyScalar(xe)
    .addScaledVector(f.perp, ye)
    .addScaledVector(f.pole, ze);
}

/** Orbital periods in days, for the info panel. */
export const SATELLITE_PERIODS = {
  moon: 27.321661,
  io: 1.769137786,
  europa: 3.551181041,
  ganymede: 7.15455296,
  callisto: 16.6890184,
  ...Object.fromEntries(
    Object.entries(KEPLERIAN_MOONS).map(([k, v]) => [k, v.period]),
  ),
};
