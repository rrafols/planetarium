/**
 * Per-frame state for every body: absolute position and body-fixed orientation,
 * expressed in *scene* axes (three.js +Y up) and scene units (1 = 1000 km).
 *
 * The ephemeris itself works in the J2000 ecliptic frame (+Z = ecliptic north),
 * so everything gets rotated by ECL_TO_SCENE = Rx(-90 deg) on the way out.
 * That is a pure rotation, so it can be applied to positions and to orientation
 * matrices alike without touching handedness.
 */

import { Vector3, Matrix4 } from 'three';
import { AU_KM, KM, EMB_MOON_FRACTION } from '../core/constants.js';
import { BODIES } from '../data/bodies.js';
import { planetPosition, minorBodyPosition, minorBodyPeriod,
  orbitalPeriodDays } from './planets.js';
import { moonPosition } from './moon.js';
import { galileanPositions, keplerianMoonPosition, keplerianMoonPeriod,
  CHARON_MASS_FRACTION } from './satellites.js';
import { bodyOrientation, bodyPole, HAS_ROTATION } from './rotation.js';
import { cometPosition, cometPeriod, COMETS } from './comets.js';

export const ECL_TO_SCENE = new Matrix4().makeRotationX(-Math.PI / 2);

const _ecl = { x: 0, y: 0, z: 0 };
const _moonKm = { x: 0, y: 0, z: 0 };
const _v = new Vector3();
const _galilean = {
  io: new Vector3(), europa: new Vector3(),
  ganymede: new Vector3(), callisto: new Vector3(),
};
const _kep = new Vector3();
const _toParent = new Vector3();
const _spin = new Vector3();
const _side = new Vector3();

export class SolarSystem {
  constructor() {
    /** @type {Map<string, {key:string, pos:Vector3, orient:Matrix4, radius:number, parent:string|null}>} */
    this.state = new Map();
    for (const b of BODIES) {
      this.state.set(b.key, {
        key: b.key,
        pos: new Vector3(),
        orient: new Matrix4(),
        radius: b.radius * KM,
        polarRadius: (b.polar ?? b.radius) * KM,
        parent: b.parent,
        def: b,
      });
    }
    this.jd = 2451545.0;
  }

  get(key) {
    return this.state.get(key);
  }

  /** Absolute scene-space position of a body (do not mutate the result). */
  pos(key) {
    return this.state.get(key).pos;
  }

  update(jd) {
    this.jd = jd;

    // --- Sun ---------------------------------------------------------------
    this.state.get('sun').pos.set(0, 0, 0);

    // --- Planets (heliocentric, AU -> scene units) --------------------------
    for (const b of BODIES) {
      if (b.ephem !== 'planet') continue;
      planetPosition(b.key, jd, _ecl);
      this._setEcliptic(b.key, _ecl.x * AU_KM * KM, _ecl.y * AU_KM * KM, _ecl.z * AU_KM * KM);
    }

    // --- Earth and Moon around the Earth-Moon barycentre --------------------
    planetPosition('emb', jd, _ecl);
    moonPosition(jd, _moonKm);
    const embX = _ecl.x * AU_KM;
    const embY = _ecl.y * AU_KM;
    const embZ = _ecl.z * AU_KM; // km

    const f = EMB_MOON_FRACTION;
    this._setEcliptic('earth',
      (embX - f * _moonKm.x) * KM,
      (embY - f * _moonKm.y) * KM,
      (embZ - f * _moonKm.z) * KM);
    this._setEcliptic('moon',
      (embX + (1 - f) * _moonKm.x) * KM,
      (embY + (1 - f) * _moonKm.y) * KM,
      (embZ + (1 - f) * _moonKm.z) * KM);

    // --- Galilean moons, relative to Jupiter --------------------------------
    galileanPositions(jd, _galilean);
    const jup = this.state.get('jupiter').pos;
    for (const key of ['io', 'europa', 'ganymede', 'callisto']) {
      _v.copy(_galilean[key]).multiplyScalar(KM).applyMatrix4(ECL_TO_SCENE);
      this.state.get(key).pos.copy(jup).add(_v);
    }

    // --- Minor bodies (Ceres) ----------------------------------------------
    for (const b of BODIES) {
      if (b.ephem !== 'minor') continue;
      minorBodyPosition(b.key, jd, _ecl);
      this._setEcliptic(b.key, _ecl.x * AU_KM * KM, _ecl.y * AU_KM * KM, _ecl.z * AU_KM * KM);
    }

    // --- Comets -------------------------------------------------------------
    for (const b of BODIES) {
      if (b.ephem !== 'comet') continue;
      cometPosition(b.key, jd, _ecl);
      this._setEcliptic(b.key, _ecl.x * AU_KM * KM, _ecl.y * AU_KM * KM, _ecl.z * AU_KM * KM);
    }

    // --- Pluto and Charon about their common barycentre ---------------------
    // Charon carries about 12% of the system mass, so the barycentre lies some
    // 2100 km above Pluto's surface: unlike every other planet-moon pair, Pluto
    // visibly circles a point outside itself. Standish's elements give that
    // barycentre, so Pluto has to be offset back from it before the generic
    // satellite pass places Charon relative to Pluto.
    if (this.state.has('pluto')) {
      planetPosition('pluto', jd, _ecl);
      keplerianMoonPosition('charon', jd, _kep);
      _v.copy(_kep).multiplyScalar(KM).applyMatrix4(ECL_TO_SCENE);
      this._setEcliptic('pluto',
        _ecl.x * AU_KM * KM, _ecl.y * AU_KM * KM, _ecl.z * AU_KM * KM);
      this.state.get('pluto').pos.addScaledVector(_v, -CHARON_MASS_FRACTION);
    }

    // --- Keplerian moons, relative to their planet --------------------------
    for (const b of BODIES) {
      if (b.ephem !== 'kepler') continue;
      keplerianMoonPosition(b.key, jd, _kep);
      _v.copy(_kep).multiplyScalar(KM).applyMatrix4(ECL_TO_SCENE);
      this.state.get(b.key).pos.copy(this.state.get(b.parent).pos).add(_v);
    }

    // --- Orientations -------------------------------------------------------
    for (const b of BODIES) {
      const st = this.state.get(b.key);
      if (b.tidal && !HAS_ROTATION(b.key)) {
        this._tidalOrientation(b, jd, st);
      } else {
        bodyOrientation(b.key, jd, st.orient);
        st.orient.premultiply(ECL_TO_SCENE);
      }
    }
  }

  /**
   * Orientation of a synchronous rotator that has no published IAU entry.
   *
   * Tidal locking pins one hemisphere at the planet, so the body-fixed frame is
   * fully determined by geometry: spin axis along the planet's pole, prime
   * meridian pointing at the planet. That is the same convention the IAU uses
   * for the Moon and the Galileans, so these bodies behave consistently with
   * the ones that do have tabulated elements.
   */
  _tidalOrientation(def, jd, st) {
    bodyPole(def.parent, jd, _spin).normalize().applyMatrix4(ECL_TO_SCENE);

    _toParent.copy(this.state.get(def.parent).pos).sub(st.pos);
    // Remove any component along the spin axis so the basis stays orthonormal.
    _toParent.addScaledVector(_spin, -_toParent.dot(_spin));
    if (_toParent.lengthSq() < 1e-12) _toParent.set(1, 0, 0);
    _toParent.normalize();

    _side.crossVectors(_spin, _toParent).normalize();
    st.orient.makeBasis(_toParent, _spin, _side.negate());
  }

  _setEcliptic(key, x, y, z) {
    // (x, y, z)_ecliptic -> (x, z, -y)_scene
    this.state.get(key).pos.set(x, z, -y);
  }

  /** Heliocentric distance in scene units. */
  sunDistance(key) {
    return this.state.get(key).pos.length();
  }

  /** Sidereal orbital period in days, or null when we do not model one. */
  orbitalPeriod(key) {
    const b = this.state.get(key)?.def;
    if (!b) return null;
    if (b.ephem === 'planet' || b.ephem === 'pluto') return orbitalPeriodDays(b.key);
    if (b.key === 'earth') return orbitalPeriodDays('emb');
    if (b.ephem === 'minor') return minorBodyPeriod(b.key);
    if (b.ephem === 'comet') return cometPeriod(COMETS[b.key]);
    return keplerianMoonPeriod(b.key);
  }
}
