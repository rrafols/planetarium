/**
 * Heliocentric planet positions from JPL's "Keplerian Elements for Approximate
 * Positions of the Major Planets" (Standish, Solar System Dynamics Group).
 *
 * The 1800 AD - 2050 AD element set is used; it is good to roughly 10-40
 * arcseconds over that span, which is far below anything visible here.
 * Outside that window positions degrade gracefully rather than blowing up.
 *
 * Output is J2000 mean-ecliptic heliocentric rectangular coordinates in AU.
 */

import { DEG, centuries } from '../core/constants.js';

// a (AU), e, I (deg), L (deg), longPeri (deg), longNode (deg)
// second row of each entry = rate per Julian century
const ELEMENTS = {
  mercury: {
    e0: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    dt: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  venus: {
    e0: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    dt: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  },
  // Earth-Moon barycentre, not Earth itself. See emb.js.
  emb: {
    e0: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    dt: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  mars: {
    e0: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    dt: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  jupiter: {
    e0: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    dt: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    e0: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    dt: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  uranus: {
    e0: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    dt: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  neptune: {
    e0: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    dt: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
};

export const PLANET_KEYS = Object.keys(ELEMENTS);

/** Solve Kepler's equation M = E - e* sin E (e* in degrees) by Newton. */
function solveKepler(Mdeg, e) {
  const eStar = (180 / Math.PI) * e;
  let E = Mdeg + eStar * Math.sin(Mdeg * DEG);
  for (let i = 0; i < 12; i++) {
    const dM = Mdeg - (E - eStar * Math.sin(E * DEG));
    const dE = dM / (1 - e * Math.cos(E * DEG));
    E += dE;
    if (Math.abs(dE) < 1e-11) break;
  }
  return E;
}

/**
 * @param {string} key one of PLANET_KEYS
 * @param {number} jd
 * @param {{x:number,y:number,z:number}} out written in place, AU, J2000 ecliptic
 */
export function planetPosition(key, jd, out = { x: 0, y: 0, z: 0 }) {
  const el = ELEMENTS[key];
  if (!el) throw new Error(`unknown planet "${key}"`);
  const T = centuries(jd);

  const a = el.e0[0] + el.dt[0] * T;
  const e = el.e0[1] + el.dt[1] * T;
  const I = (el.e0[2] + el.dt[2] * T) * DEG;
  const L = el.e0[3] + el.dt[3] * T;
  const peri = el.e0[4] + el.dt[4] * T;
  const node = (el.e0[5] + el.dt[5] * T) * DEG;

  const omega = peri * DEG - node; // argument of perihelion
  let M = ((((L - peri) % 360) + 540) % 360) - 180; // wrap to [-180,180)

  const E = solveKepler(M, e) * DEG;

  // position in the orbital plane
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(I);
  const si = Math.sin(I);

  // rotate: argument of perihelion -> inclination -> longitude of node
  const x1 = cw * xp - sw * yp;
  const y1 = sw * xp + cw * yp;

  out.x = cn * x1 - sn * ci * y1;
  out.y = sn * x1 + cn * ci * y1;
  out.z = si * y1;
  return out;
}

/** Sidereal orbital period in days, from the mean-longitude rate. */
export function orbitalPeriodDays(key) {
  return (360 / ELEMENTS[key].dt[3]) * 36525;
}

/** Osculating semi-major axis in AU, for orbit-path drawing. */
export function semiMajorAxis(key, jd) {
  const el = ELEMENTS[key];
  return el.e0[0] + el.dt[0] * centuries(jd);
}
