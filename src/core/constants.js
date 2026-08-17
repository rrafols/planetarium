/**
 * Units and frames.
 *
 * LENGTH: 1 scene unit = 1000 km (1 Mm). Chosen so the whole solar system
 *   (Neptune aphelion ~4.54e6 units) and the smallest rendered moon
 *   (Deimos-scale, ~6 units... we stop at Titan, 2575 km => 2.575 units)
 *   both fit comfortably inside float64 on the CPU. GPU precision is handled
 *   by the floating-origin system in core/origin.js.
 *
 * TIME: Julian Date (TT ~ TDB; we ignore the <1min TT-UTC offset except when
 *   formatting the clock, which is documented as UTC-approximate).
 *
 * FRAME: J2000 mean ecliptic, right-handed, +X toward the vernal equinox,
 *   +Z toward the ecliptic north pole. Three.js wants +Y up, so every vector
 *   crossing into scene space goes through eclipticToScene().
 */

export const KM = 1 / 1000; // km -> scene units
export const AU_KM = 149597870.7;
export const AU = AU_KM * KM; // 149597.8707 scene units

export const DAY_S = 86400;
export const YEAR_S = 365.25 * DAY_S;
export const J2000 = 2451545.0; // JD of 2000-01-01T12:00:00 TT

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Obliquity of the ecliptic at J2000, in radians. */
export const OBLIQUITY = 23.4392911 * DEG;

/** Earth/Moon mass ratio -> barycentre split factor. */
export const MOON_EARTH_MASS_RATIO = 0.0123000371;
export const EMB_MOON_FRACTION =
  MOON_EARTH_MASS_RATIO / (1 + MOON_EARTH_MASS_RATIO); // 0.0121505...

/** Maximum number of eclipse occluders any single body shader considers. */
export const MAX_OCCLUDERS = 10;

/** Julian date <-> JS Date (both treated as UTC for display purposes). */
export function dateToJD(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function jdToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

/** Julian centuries since J2000. */
export function centuries(jd) {
  return (jd - J2000) / 36525;
}

/** Days since J2000. */
export function days(jd) {
  return jd - J2000;
}

/** Normalise degrees into [0, 360). */
export function norm360(d) {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Normalise degrees into [-180, 180). */
export function norm180(d) {
  return norm360(d + 180) - 180;
}
