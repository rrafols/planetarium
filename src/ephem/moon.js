/**
 * Geocentric Moon position — Meeus, "Astronomical Algorithms" ch. 47,
 * the truncated ELP-2000/82 series (60 longitude/distance terms, 60 latitude
 * terms). Accuracy is about 10" in longitude and 4" in latitude, which is
 * roughly 1/200 of the Moon's apparent diameter — good enough that solar and
 * lunar eclipses come out on the correct dates with sensible geometry.
 *
 * Meeus' series is referred to the mean equinox *of date*; the rest of this
 * program works in J2000. The two drift apart by the general precession in
 * longitude (~50"/yr), which after a few decades exceeds the Moon's own
 * diameter and would wreck eclipse alignment, so we rotate back to J2000
 * explicitly at the end.
 */

import { DEG, centuries, norm360 } from '../core/constants.js';

// D, M, M', F, sigma-l (1e-6 deg), sigma-r (1e-3 km)   [Meeus table 47.A]
const TERMS_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

// D, M, M', F, sigma-b (1e-6 deg)   [Meeus table 47.B]
const TERMS_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

/**
 * Geocentric ecliptic position of the Moon, J2000 frame, in km.
 * @param {number} jd
 * @param {{x:number,y:number,z:number}} out
 */
export function moonPosition(jd, out = { x: 0, y: 0, z: 0 }) {
  const T = centuries(jd);
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  // Mean elements (Meeus 47.1 - 47.5), degrees
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;

  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;
  const A3 = 313.45 + 481266.484 * T;

  // Eccentricity correction for terms involving the Sun's anomaly
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;

  const Dr = D * DEG;
  const Mr = M * DEG;
  const Mpr = Mp * DEG;
  const Fr = F * DEG;

  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < TERMS_LR.length; i++) {
    const t = TERMS_LR[i];
    const arg = t[0] * Dr + t[1] * Mr + t[2] * Mpr + t[3] * Fr;
    const am = t[1] < 0 ? -t[1] : t[1];
    const ecc = am === 1 ? E : am === 2 ? E2 : 1;
    sumL += t[4] * ecc * Math.sin(arg);
    sumR += t[5] * ecc * Math.cos(arg);
  }

  let sumB = 0;
  for (let i = 0; i < TERMS_B.length; i++) {
    const t = TERMS_B[i];
    const arg = t[0] * Dr + t[1] * Mr + t[2] * Mpr + t[3] * Fr;
    const am = t[1] < 0 ? -t[1] : t[1];
    const ecc = am === 1 ? E : am === 2 ? E2 : 1;
    sumB += t[4] * ecc * Math.sin(arg);
  }

  // Additive terms from Venus, Jupiter and the flattening of the Earth
  sumL += 3958 * Math.sin(A1 * DEG)
    + 1962 * Math.sin((Lp - F) * DEG)
    + 318 * Math.sin(A2 * DEG);

  sumB += -2235 * Math.sin(Lp * DEG)
    + 382 * Math.sin(A3 * DEG)
    + 175 * Math.sin((A1 - F) * DEG)
    + 175 * Math.sin((A1 + F) * DEG)
    + 127 * Math.sin((Lp - Mp) * DEG)
    - 115 * Math.sin((Lp + Mp) * DEG);

  let lambda = Lp + sumL / 1e6; // deg, mean equinox of date
  const beta = sumB / 1e6; // deg
  const delta = 385000.56 + sumR / 1000; // km

  // Mean equinox of date -> J2000: subtract the general precession in longitude.
  // p_A = 5029.0966" T + 1.11113" T^2  (Lieske et al.), converted to degrees.
  lambda -= 1.3969713 * T + 0.00030865 * T2;
  lambda = norm360(lambda);

  const lr = lambda * DEG;
  const br = beta * DEG;
  const cb = Math.cos(br);

  out.x = delta * cb * Math.cos(lr);
  out.y = delta * cb * Math.sin(lr);
  out.z = delta * Math.sin(br);
  return out;
}

/** Mean elongation of the Moon from the Sun, degrees — used by the eclipse finder. */
export function meanElongation(jd) {
  const T = centuries(jd);
  return norm360(
    297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868,
  );
}

/** Synodic month, days. */
export const SYNODIC_MONTH = 29.530588861;
