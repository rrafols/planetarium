/**
 * Delta-T: the difference between Terrestrial Time and Universal Time.
 *
 * Why this matters here: the ephemeris runs on TT, but the Earth physically
 * rotates on UT1. The IAU rotational elements express the prime meridian as
 * W = W0 + Wdot * d with d in TDB days, which quietly ignores that difference.
 * Left uncorrected, Earth's geography ends up rotated by Delta-T worth of spin
 * relative to the true Sun-Moon geometry — currently about 69 s, or 0.29 deg of
 * longitude, roughly 32 km at the equator.
 *
 * That is a significant fraction of a solar eclipse umbra (typically 100-270 km
 * wide), so correcting it is what lets the shadow land on the right piece of
 * coastline rather than merely the right continent.
 *
 * Polynomials are the Espenak & Meeus set used by NASA's eclipse pages.
 * Delta-T is not predictable in the long run — it depends on the Earth's core
 * and on ice mass — so values far from the present are estimates by nature.
 */

import { jdToDate } from './constants.js';

/** Decimal year from a Julian date. */
function decimalYear(jd) {
  const d = jdToDate(jd);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (end - start);
}

/**
 * @param {number} jd Julian date (TT; the distinction is far below the
 *   precision of the polynomials themselves)
 * @returns {number} TT - UT1 in seconds
 */
export function deltaTSeconds(jd) {
  const y = decimalYear(jd);

  if (y >= 2005 && y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (y >= 1986 && y < 2005) {
    const t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y >= 1961 && y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - (t ** 3) / 718;
  }
  if (y >= 1941 && y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + (t ** 3) / 2547;
  }
  if (y >= 1920 && y < 1941) {
    const t = y - 1920;
    return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t ** 3;
  }
  if (y >= 1900 && y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t * t
      + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y >= 2050 && y < 2150) {
    return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  }

  // Long-term parabola (Morrison & Stephenson), used outside the tabulated span.
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Delta-T expressed in days, for shifting a time argument. */
export function deltaTDays(jd) {
  return deltaTSeconds(jd) / 86400;
}
