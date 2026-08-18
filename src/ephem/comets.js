/**
 * Comets, from published osculating elements at a stated perihelion passage.
 *
 * Comets are given by perihelion distance `q` and time of perihelion `tp`
 * rather than by semi-major axis and mean longitude, because that is how they
 * are actually observed and catalogued — and because for a near-parabolic
 * orbit like Hale-Bopp's, `a` is enormous and poorly constrained while `q` is
 * measured precisely.
 *
 * ACCURACY. These are single-epoch two-body elements. Real comets are
 * perturbed by the giant planets and, near perihelion, pushed around by
 * outgassing (non-gravitational forces — Encke is the classic case, its period
 * drifting measurably each return). So a comet's position is right to within
 * days near its reference passage and degrades over many revolutions. Orbit
 * shape, orientation, period and the perihelion date itself are sound; treat
 * the position far from the reference epoch as indicative.
 */

import { DEG } from '../core/constants.js';

/**
 * q      perihelion distance, AU
 * e      eccentricity
 * i      inclination, degrees (>90 is retrograde)
 * node   longitude of ascending node, degrees
 * peri   argument of perihelion, degrees
 * tp     Julian date of a perihelion passage
 * radius nucleus mean radius, km
 */
export const COMETS = {
  halley: {
    name: '1P/Halley',
    q: 0.58597811, e: 0.96714291, i: 162.26269, node: 58.42008, peri: 111.33249,
    tp: 2446470.95891, // 1986 Feb 9.46
    radius: 5.5,
    note: 'Retrograde. Last perihelion 1986, next 2061.',
  },
  encke: {
    name: '2P/Encke',
    q: 0.33601, e: 0.84833, i: 11.78109, node: 334.56784, peri: 186.54170,
    tp: 2457822.6, // 2017 Mar 10
    radius: 2.4,
    note: 'Shortest period of any known comet, 3.3 years.',
  },
  swiftTuttle: {
    name: '109P/Swift-Tuttle',
    q: 0.95952, e: 0.96300, i: 113.45400, node: 139.38110, peri: 152.98210,
    tp: 2448968.82, // 1992 Dec 12
    radius: 13.0,
    note: 'Parent of the Perseid meteor shower.',
  },
  tempelTuttle: {
    name: '55P/Tempel-Tuttle',
    q: 0.97638, e: 0.90551, i: 162.48650, node: 235.27090, peri: 172.50020,
    tp: 2450872.59, // 1998 Feb 28
    radius: 1.8,
    note: 'Parent of the Leonids. Retrograde.',
  },
  churyumov: {
    name: '67P/Churyumov-Gerasimenko',
    q: 1.24320, e: 0.64100, i: 7.04050, node: 50.14700, peri: 12.78020,
    tp: 2457247.59, // 2015 Aug 13
    radius: 1.65,
    note: 'Visited and landed on by Rosetta and Philae.',
  },
  haleBopp: {
    name: 'C/1995 O1 (Hale-Bopp)',
    q: 0.91411, e: 0.99511, i: 89.42870, node: 282.47070, peri: 130.59100,
    tp: 2450539.64, // 1997 Apr 1
    radius: 30.0,
    note: 'Near-polar orbit; visible to the naked eye for 18 months.',
  },
};

const GAUSS_K = 0.01720209895; // Gaussian gravitational constant, rad/day

/** Semi-major axis in AU. */
export function semiMajorAxis(c) {
  return c.q / (1 - c.e);
}

/** Orbital period in days. */
export function cometPeriod(c) {
  const a = semiMajorAxis(c);
  return 365.256898326 * a * Math.sqrt(a);
}

function solveKepler(M, e) {
  // Wrap into [-pi, pi] so the iteration starts near the root.
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  if (m < -Math.PI) m += 2 * Math.PI;

  // High eccentricity needs a better seed than M, or Newton wanders.
  let E = e < 0.8 ? m : Math.sign(m) * Math.PI * 0.5;
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/**
 * Heliocentric J2000-ecliptic position, in AU.
 * @param {string} key one of COMETS
 */
export function cometPosition(key, jd, out = { x: 0, y: 0, z: 0 }) {
  const c = COMETS[key];
  const a = semiMajorAxis(c);
  const n = GAUSS_K / (a * Math.sqrt(a)); // rad/day
  const M = n * (jd - c.tp);
  const E = solveKepler(M, c.e);

  const xp = a * (Math.cos(E) - c.e);
  const yp = a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);

  const w = c.peri * DEG;
  const node = c.node * DEG;
  const I = c.i * DEG;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(I);
  const si = Math.sin(I);

  const x1 = cw * xp - sw * yp;
  const y1 = sw * xp + cw * yp;

  out.x = cn * x1 - sn * ci * y1;
  out.y = sn * x1 + cn * ci * y1;
  out.z = si * y1;
  return out;
}

/**
 * Meteor showers, as the debris streams of their parent comets.
 *
 * A shower is not a comet — it is what happens when Earth crosses the trail of
 * dust a comet has left strung along its orbit. So each stream is generated
 * from its parent's elements with the debris spread all the way around the
 * orbit and slightly dispersed in a, e and i, which is what makes the crossing
 * happen on the same calendar date every year.
 */
export const METEOR_STREAMS = {
  perseids: { parent: 'swiftTuttle', name: 'Perseids', peak: 'Aug 12', color: 0x9fd0ff },
  leonids: { parent: 'tempelTuttle', name: 'Leonids', peak: 'Nov 17', color: 0xffd9a0 },
  orionids: { parent: 'halley', name: 'Orionids', peak: 'Oct 21', color: 0xc9b6ff },
  taurids: { parent: 'encke', name: 'Taurids', peak: 'Nov 5', color: 0xffc39a },
};
