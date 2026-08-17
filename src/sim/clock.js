/**
 * Simulation clock.
 *
 * Positions are analytic functions of Julian date, so there is no integrator to
 * destabilise: an arbitrarily large time step is exactly as accurate as a small
 * one. That is what lets the rate span nine orders of magnitude and lets the
 * eclipse finder teleport across years.
 */

import { dateToJD, jdToDate, DAY_S, YEAR_S } from '../core/constants.js';
import { deltaTDays } from '../core/deltat.js';

/**
 * Fixed rate steps rather than a continuous slider.
 *
 * A log slider sounds flexible but is hard to land on anything meaningful.
 * These are the rates you actually want: real-time for watching a spacecraft's
 * worth of motion, minutes for an eclipse, hours for a rotation, a day per
 * second for orbits.
 */
export const RATE_STEPS = [
  { rate: 1, label: 'real-time' },
  { rate: 60, label: '1 min/s' },
  { rate: 1800, label: '30 min/s' },
  { rate: 3600, label: '1 h/s' },
  { rate: 28800, label: '8 h/s' },
  { rate: 86400, label: '24 h/s' },
];

export const DEFAULT_STEP = 0; // real-time

export class Clock {
  constructor(jd = dateToJD(new Date())) {
    this.jd = jd;
    this.stepIndex = DEFAULT_STEP;
    this.direction = 1;
    this.paused = false;
  }

  get rate() {
    return RATE_STEPS[this.stepIndex].rate;
  }

  get rateLabel() {
    return RATE_STEPS[this.stepIndex].label;
  }

  advance(dtReal) {
    if (this.paused) return;
    this.jd += (this.rate * this.direction * dtReal) / DAY_S;
  }

  get signedRate() {
    return this.paused ? 0 : this.rate * this.direction;
  }

  /** @param {number} i step index, clamped */
  setStep(i) {
    this.stepIndex = Math.max(0, Math.min(RATE_STEPS.length - 1, Math.round(i)));
  }

  nudgeStep(dir) {
    this.setStep(this.stepIndex + dir);
  }

  /**
   * The simulation argument is TT; civil time is UT. They differ by Delta-T
   * (~69 s today), so the two are converted rather than conflated.
   */
  toDate() {
    return jdToDate(this.jd - deltaTDays(this.jd));
  }

  now() {
    const utc = dateToJD(new Date());
    this.jd = utc + deltaTDays(utc);
  }
}

/** Human-readable "x per second" for the rate readout. */
export function formatRate(secondsPerSecond) {
  const s = Math.abs(secondsPerSecond);
  if (s === 0) return 'paused';
  if (s < 60) return `${trim(s)} s/s`;
  if (s < 3600) return `${trim(s / 60)} min/s`;
  if (s < DAY_S) return `${trim(s / 3600)} h/s`;
  if (s < DAY_S * 30) return `${trim(s / DAY_S)} day/s`;
  if (s < YEAR_S) return `${trim(s / (DAY_S * 30.4375))} mo/s`;
  return `${trim(s / YEAR_S)} yr/s`;
}

function trim(x) {
  if (x >= 100) return Math.round(x).toLocaleString();
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2).replace(/\.?0+$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date) {
  const y = date.getUTCFullYear();
  const era = y <= 0 ? ` BCE` : '';
  const yy = y <= 0 ? 1 - y : y;
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${yy}${era}`;
}

export function formatTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}

/** Distances: scene units are 1000 km, so switch to AU once that gets silly. */
export function formatDistance(units) {
  const km = units * 1000;
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 1e6) return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  const au = km / 149597870.7;
  if (au < 0.1) return `${(km / 1e6).toFixed(2)} million km`;
  return `${au.toFixed(3)} AU`;
}

export function formatPeriod(days) {
  if (days == null || !isFinite(days)) return '—';
  const d = Math.abs(days);
  const suffix = days < 0 ? ' (retrograde)' : '';
  if (d < 1 / 24) return `${(d * 1440).toFixed(1)} min${suffix}`;
  if (d < 2) return `${(d * 24).toFixed(2)} h${suffix}`;
  if (d < 800) return `${d.toFixed(2)} days${suffix}`;
  return `${(d / 365.25).toFixed(2)} years${suffix}`;
}
