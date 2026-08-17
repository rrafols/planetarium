/**
 * Eclipse detection and search.
 *
 * The renderer already draws eclipses correctly without any of this — the
 * shader does not know what an eclipse *is*, it just computes how much of the
 * Sun each fragment can see. This module exists so the UI can say "a total
 * solar eclipse is happening right now" and so you can jump to the next one
 * instead of scrubbing through months of time.
 *
 * Geometry is the same circle-overlap calculation the shader uses, run on the
 * CPU at the best-placed observer.
 */

import { Vector3 } from 'three';
import { KM } from '../core/constants.js';
import { SolarSystem } from '../ephem/system.js';

const R_SUN = 696000 * KM;
const R_EARTH = 6378.137 * KM;
const R_MOON = 1737.4 * KM;

/**
 * Earth's shadow is enlarged by about 1/50 because the atmosphere refracts and
 * absorbs grazing sunlight. This is the classical Chauvenet/Danjon correction
 * used in published lunar-eclipse timings.
 */
const ATMOSPHERE_ENLARGEMENT = 1 / 50;

const SYNODIC = 29.530588861;
const NEW_MOON_EPOCH = 2451550.09766; // JD of the new moon of 2000 Jan 6

const _sun = new Vector3(0, 0, 0);
const _toSun = new Vector3();
const _toMoon = new Vector3();
const _axis = new Vector3();
const _w = new Vector3();
const _p = new Vector3();

/** Area shared by two circles — the CPU twin of the shader function. */
function circleOverlapArea(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  const rmin = Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return Math.PI * rmin * rmin;
  const d2 = d * d;
  const a1 = r1 * r1;
  const a2 = r2 * r2;
  const c1 = Math.min(1, Math.max(-1, (d2 + a1 - a2) / (2 * d * r1)));
  const c2 = Math.min(1, Math.max(-1, (d2 + a2 - a1) / (2 * d * r2)));
  const t = Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 * Math.acos(c1) + a2 * Math.acos(c2) - 0.5 * Math.sqrt(t);
}

function angleBetween(a, b) {
  const c = a.dot(b) / (a.length() * b.length());
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/* ---------------------------------------------------------- solar eclipse */

/**
 * State of any solar eclipse in progress, evaluated at the point on Earth's
 * surface that lies closest to the Moon's shadow axis (roughly the point of
 * greatest eclipse).
 *
 * @returns {{active:boolean, obscuration:number, magnitude:number, type:string, reach:number}}
 */
export function solarEclipse(system) {
  const E = system.pos('earth');
  const M = system.pos('moon');

  _toSun.copy(_sun).sub(E);
  _toMoon.copy(M).sub(E);
  const dSun = _toSun.length();
  const dMoon = _toMoon.length();

  const rs = Math.asin(R_SUN / dSun);
  const rm = Math.asin(R_MOON / dMoon);
  const sep = angleBetween(_toSun, _toMoon);

  // How far inside "first contact somewhere on Earth" we are, in radians.
  // Positive means at least a partial eclipse is visible from some location.
  const reach = rs + rm + R_EARTH / dMoon - sep;

  if (reach <= 0) {
    return { active: false, obscuration: 0, magnitude: 0, type: 'none', reach };
  }

  // Best-placed observer: step from Earth's centre toward the shadow axis.
  _axis.copy(M).normalize(); // axis runs Sun -> Moon; the Sun is at the origin
  _w.copy(E).addScaledVector(_axis, -E.dot(_axis)); // Earth's offset from the axis
  const perp = _w.length();

  _p.copy(E);
  if (perp > 1e-9) _p.addScaledVector(_w, -Math.min(R_EARTH, perp) / perp);

  const pSun = _toSun.copy(_sun).sub(_p);
  const pMoon = _toMoon.copy(M).sub(_p);
  const dS = pSun.length();
  const dM = pMoon.length();
  const rs2 = Math.asin(Math.min(1, R_SUN / dS));
  const rm2 = Math.asin(Math.min(1, R_MOON / dM));
  const sep2 = angleBetween(pSun, pMoon);

  const obscuration = circleOverlapArea(rs2, rm2, sep2) / (Math.PI * rs2 * rs2);
  // Eclipse magnitude is the covered *fraction of the diameter*, not of area.
  const magnitude = Math.min(1.5, Math.max(0, (rs2 + rm2 - sep2) / (2 * rs2)));

  let type = 'partial';
  if (sep2 <= Math.abs(rs2 - rm2)) type = rm2 >= rs2 ? 'total' : 'annular';
  else if (obscuration > 0.999) type = 'total';

  return { active: true, obscuration, magnitude, type, reach };
}

/* ---------------------------------------------------------- lunar eclipse */

/**
 * @returns {{active:boolean, type:string, umbralMagnitude:number, penumbralMagnitude:number}}
 */
export function lunarEclipse(system) {
  const E = system.pos('earth');
  const M = system.pos('moon');

  const dSunEarth = E.length();
  _axis.copy(E).normalize(); // Sun -> Earth, i.e. the shadow axis

  const t = M.dot(_axis);
  if (t < dSunEarth) {
    return { active: false, type: 'none', umbralMagnitude: 0, penumbralMagnitude: 0 };
  }

  _w.copy(M).addScaledVector(_axis, -t);
  const rho = _w.length(); // Moon's perpendicular distance from the shadow axis
  const d = t - dSunEarth; // distance beyond Earth along the axis

  const Re = R_EARTH * (1 + ATMOSPHERE_ENLARGEMENT);
  const umbra = Re - (d * (R_SUN - Re)) / dSunEarth;
  const penumbra = Re + (d * (R_SUN + Re)) / dSunEarth;

  const penumbralMagnitude = (penumbra + R_MOON - rho) / (2 * R_MOON);
  const umbralMagnitude = (umbra + R_MOON - rho) / (2 * R_MOON);

  let type = 'none';
  if (umbralMagnitude >= 1) type = 'total';
  else if (umbralMagnitude > 0) type = 'partial';
  else if (penumbralMagnitude > 0) type = 'penumbral';

  return {
    active: type !== 'none',
    type,
    umbralMagnitude: Math.max(0, umbralMagnitude),
    penumbralMagnitude: Math.max(0, penumbralMagnitude),
  };
}

/* ------------------------------------------------------------------ search */

const scratch = new SolarSystem();

/** Geocentric ecliptic longitude difference Moon - Sun, radians in [0, 2pi). */
function elongation(jd) {
  scratch.update(jd);
  const E = scratch.pos('earth');
  const M = scratch.pos('moon');
  // scene axes -> ecliptic: ecl.x = scene.x, ecl.y = -scene.z
  const lonSun = Math.atan2(E.z, -E.x); // direction Earth -> Sun is -E
  const lonMoon = Math.atan2(-(M.z - E.z), M.x - E.x);
  let d = lonMoon - lonSun;
  d %= Math.PI * 2;
  if (d < 0) d += Math.PI * 2;
  return d;
}

/** Refine to the moment of exact new (target 0) or full (target pi) moon. */
function refineSyzygy(jdGuess, target) {
  let jd = jdGuess;
  const rate = (2 * Math.PI) / SYNODIC; // rad/day
  for (let i = 0; i < 8; i++) {
    let diff = elongation(jd) - target;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const step = -diff / rate;
    jd += step;
    if (Math.abs(step) < 1e-6) break;
  }
  return jd;
}

/**
 * Scan a window around a syzygy for the instant of greatest eclipse.
 * @param {(sys:SolarSystem)=>number} score  larger is more eclipsed
 */
function peakNear(jd, score, halfWidth = 0.6, coarse = 0.02) {
  let bestJd = jd;
  let best = -Infinity;
  for (let t = jd - halfWidth; t <= jd + halfWidth; t += coarse) {
    scratch.update(t);
    const s = score(scratch);
    if (s > best) { best = s; bestJd = t; }
  }
  // Refine around the coarse peak.
  for (let t = bestJd - coarse; t <= bestJd + coarse; t += coarse / 25) {
    scratch.update(t);
    const s = score(scratch);
    if (s > best) { best = s; bestJd = t; }
  }
  return { jd: bestJd, score: best };
}

const solarScore = (sys) => solarEclipse(sys).reach;
const lunarScore = (sys) => {
  const e = lunarEclipse(sys);
  return e.penumbralMagnitude;
};

/**
 * Find the next (or previous) eclipse.
 *
 * Eclipses can only happen at syzygy, so we walk lunation by lunation rather
 * than stepping blindly through time: locate each new or full moon, then check
 * whether the Moon is close enough to a node for the shadow to connect.
 *
 * @param {'solar'|'lunar'} kind
 * @param {number} fromJd
 * @param {1|-1} direction
 * @param {number} maxLunations
 * @returns {{jd:number, info:object}|null}
 */
export function findEclipse(kind, fromJd, direction = 1, maxLunations = 60) {
  const target = kind === 'solar' ? 0 : Math.PI;
  const score = kind === 'solar' ? solarScore : lunarScore;
  const isHit = (sys) => (kind === 'solar' ? solarEclipse(sys).active : lunarEclipse(sys).active);

  let k = Math.round((fromJd - NEW_MOON_EPOCH) / SYNODIC);
  if (kind === 'lunar') k += 0; // full moons sit half a lunation later; refine handles it

  for (let i = 0; i <= maxLunations; i++) {
    const kk = k + direction * i;
    let guess = NEW_MOON_EPOCH + SYNODIC * kk;
    if (kind === 'lunar') guess += SYNODIC / 2;

    const syzygy = refineSyzygy(guess, target);

    // Only consider events strictly ahead of / behind where we started.
    const ahead = direction > 0 ? syzygy > fromJd + 0.05 : syzygy < fromJd - 0.05;
    if (!ahead) continue;

    const peak = peakNear(syzygy, score);
    scratch.update(peak.jd);
    if (isHit(scratch)) {
      const info = kind === 'solar' ? solarEclipse(scratch) : lunarEclipse(scratch);
      return { jd: peak.jd, info };
    }
  }
  return null;
}
