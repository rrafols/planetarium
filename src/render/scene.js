/**
 * Scene construction and the per-frame sync from ephemeris state to objects.
 *
 * FLOATING ORIGIN
 * ---------------
 * Scene coordinates span 1e-3 (a crater on the Moon) to 4.5e6 (Neptune) units.
 * float32 has ~7 significant digits, so a vertex at Neptune's distance
 * resolves to ~0.5 units and a fragment shader differencing two such positions
 * loses everything. We therefore keep the camera pinned at (0,0,0) and shift
 * the whole system by -cameraAbsolutePosition each frame. Every object's
 * translation is computed in float64 on the CPU and only the (small) result
 * reaches the GPU.
 *
 * The corollary is that vertex data must stay local: a body's vertices are
 * relative to the body, and an orbit path's vertices are relative to the body
 * it orbits, never absolute.
 *
 * TRUE vs DISPLAYED POSITIONS
 * ---------------------------
 * `system` holds physically true positions. Everything drawn goes through
 * ViewTransform first, giving `this.display`. The shaders are fed displayed
 * positions and displayed radii, so shadows always agree with what you can
 * actually see — in schematic mode they are self-consistent rather than real.
 */

import {
  Object3D, Mesh, SphereGeometry, RingGeometry, BufferGeometry, BufferAttribute,
  LineBasicMaterial, LineLoop, Vector3, Matrix4, Color, PlaneGeometry, MathUtils,
} from 'three';
import { KM, AU_KM } from '../core/constants.js';
import { BODIES, BY_KEY, occludersFor } from '../data/bodies.js';
import {
  createSurfaceMaterial, createCloudMaterial, createAtmosphereMaterial,
  createRingMaterial, createSunMaterial, createCoronaMaterial,
} from './bodyMaterial.js';
import { proceduralTexture } from './proceduralTextures.js';
import { planetPosition, minorBodyPosition, minorBodyPeriod } from '../ephem/planets.js';
import { SATELLITE_PERIODS } from '../ephem/satellites.js';
import { ViewTransform } from '../view/transform.js';

const AIRLESS = new Set(['moon', 'mercury', 'io', 'europa', 'ganymede', 'callisto']);

const _m = new Matrix4();
const _v = new Vector3();
const _rel = new Vector3();

function ringGeometry(innerU, outerU, segments = 256) {
  const geo = new RingGeometry(innerU, outerU, segments, 6);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new Vector3();
  // Remap UVs so u runs radially across the ring strip texture.
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = v.length();
    uv.setXY(i, (r - innerU) / (outerU - innerU), 0.5);
  }
  // RingGeometry lies in XY with a +Z normal; the body's pole is local +Y.
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export class SceneBuilder {
  /**
   * @param {import('three').Scene} scene
   * @param {Record<string, import('three').Texture>} textures
   * @param {{sphereSegments?: number, orbitSegments?: number}} quality
   */
  constructor(scene, textures, quality = {}) {
    this.scene = scene;
    this.textures = textures;
    this.quality = {
      sphereSegments: quality.sphereSegments ?? 128,
      orbitSegments: quality.orbitSegments ?? 512,
    };

    /** @type {Map<string, any>} */
    this.bodies = new Map();
    /** Displayed (post-transform) absolute positions. */
    this.display = new Map();
    this.origin = new Vector3();
    this.view = new ViewTransform();

    this.root = new Object3D();
    scene.add(this.root);
    this.orbitRoot = new Object3D();
    scene.add(this.orbitRoot);

    // Two levels of detail: a 6 km moon does not need a 16k-triangle sphere.
    const seg = this.quality.sphereSegments;
    this.sphereGeo = new SphereGeometry(1, seg, seg / 2);
    this.sphereGeoLow = new SphereGeometry(1, Math.max(32, seg / 3), Math.max(16, seg / 6));

    for (const def of BODIES) {
      this.display.set(def.key, new Vector3());
      this._buildBody(def);
    }
    this._buildOrbits();
  }

  _tex(name) {
    return name ? this.textures[name] : null;
  }

  /* --------------------------------------------------------------- build */

  _buildBody(def) {
    const group = new Object3D();
    const orient = new Object3D();
    group.add(orient);
    this.root.add(group);

    const rEq = def.radius * KM;
    const rPol = (def.polar ?? def.radius) * KM;

    let material;
    if (def.emissive) {
      material = createSunMaterial(this._tex(def.map));
    } else {
      const map = def.procedural
        ? proceduralTexture(def.procedural, def.radius < 100 ? 256 : def.radius < 900 ? 512 : 1024)
        : this._tex(def.map);
      material = createSurfaceMaterial(def, {
        map,
        nightMap: this._tex(def.nightMap),
        normalMap: this._tex(def.normalMap),
        specularMap: this._tex(def.specularMap),
      }, { airless: AIRLESS.has(def.key) });
    }

    const geo = def.radius < 1000 ? this.sphereGeoLow : this.sphereGeo;
    const mesh = new Mesh(geo, material);
    mesh.userData.bodyKey = def.key;
    orient.add(mesh);

    const entry = {
      def, key: def.key, group, orient, mesh, material,
      rEq, rPol, drawRadius: rEq, scaleVersion: null,
      isStar: def.kind === 'star',
    };

    if (def.clouds) {
      const cm = createCloudMaterial(def, this._tex(def.clouds.map));
      entry.cloudMesh = new Mesh(this.sphereGeo, cm);
      entry.cloudMaterial = cm;
      orient.add(entry.cloudMesh);
    }

    if (def.atmosphere) {
      const am = createAtmosphereMaterial(def);
      entry.atmoMesh = new Mesh(this.sphereGeo, am);
      entry.atmoMesh.renderOrder = 5;
      orient.add(entry.atmoMesh);
    }

    if (def.rings) {
      entry.ringInner = def.rings.inner * KM;
      entry.ringOuter = def.rings.outer * KM;
      const rm = createRingMaterial(def, this._tex(def.rings.map));
      entry.ringMesh = new Mesh(ringGeometry(entry.ringInner, entry.ringOuter), rm);
      entry.ringMesh.renderOrder = 6;
      entry.ringMesh.userData.bodyKey = def.key;
      orient.add(entry.ringMesh);
    }

    if (def.emissive) {
      entry.corona = new Mesh(new PlaneGeometry(1, 1), createCoronaMaterial());
      entry.corona.renderOrder = -5;
      group.add(entry.corona);
    }

    this.bodies.set(def.key, entry);
  }

  _buildOrbits() {
    this.orbits = new Map();

    for (const def of BODIES) {
      if (def.kind === 'star') continue;

      const isPlanet = HELIOCENTRIC.has(def.ephem);
      const segments = isPlanet ? this.quality.orbitSegments : 192;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(segments * 3), 3));

      const line = new LineLoop(geo, new LineBasicMaterial({
        color: new Color(def.color).multiplyScalar(isPlanet ? 0.55 : 0.32),
        transparent: true,
        opacity: isPlanet ? 0.42 : 0.22,
        depthWrite: false,
        toneMapped: false, // the whole frame is tone mapped once, in OutputPass
      }));
      line.frustumCulled = false;
      line.renderOrder = -2;
      this.orbitRoot.add(line);

      this.orbits.set(def.key, {
        line, geo, segments, isPlanet,
        baseOpacity: isPlanet ? 0.42 : 0.22,
        lastBuiltJd: -Infinity,
        lastBlend: null,
        lastBuiltAt: 0,
      });
    }
  }

  /* ----------------------------------------------------- display mapping */

  /** Apply the view transform to every body, parents before their moons. */
  _computeDisplay(system) {
    for (const def of BODIES) {
      if (def.kind === 'moon') continue;
      this.view.mapHeliocentric(system.pos(def.key), this.display.get(def.key));
    }
    for (const def of BODIES) {
      if (def.kind !== 'moon') continue;
      const parent = this.bodies.get(def.parent);
      const parentDisp = this.view.radius(parent.rEq, parent.isStar);
      _rel.copy(system.pos(def.key)).sub(system.pos(def.parent));
      this.view.mapSatellite(_rel, parent.rEq, parentDisp, _rel);
      this.display.get(def.key).copy(this.display.get(def.parent)).add(_rel);
    }
  }

  /** Absolute displayed position of a body (do not mutate). */
  displayPos(key) {
    return this.display.get(key);
  }

  drawRadius(key) {
    return this.bodies.get(key).drawRadius;
  }

  _applyScale(entry, version) {
    const R = this.view.radius(entry.rEq, entry.isStar);
    const s = R / entry.rEq;
    entry.drawRadius = R;
    entry.scaleVersion = version;

    const setScale = (mesh, factor) => {
      const sx = entry.rEq * factor;
      const sy = entry.rPol * factor;
      mesh.scale.set(sx, sy, sx);
      const u = mesh.material.uniforms?.uInvScaleSq;
      if (u) u.value.set(1 / (sx * sx), 1 / (sy * sy), 1 / (sx * sx));
    };

    setScale(entry.mesh, s);
    if (entry.cloudMesh) setScale(entry.cloudMesh, s * (1 + entry.def.clouds.altitude));
    if (entry.atmoMesh) setScale(entry.atmoMesh, s * (1 + entry.def.atmosphere.thickness));
    if (entry.ringMesh) entry.ringMesh.scale.setScalar(s);
    // The corona is a fixed multiple of the Sun's drawn radius, so in schematic
    // mode — where the Sun balloons relative to the orbits around it — it has
    // to be reined in or it swallows the inner planets.
    if (entry.corona) {
      entry.corona.scale.setScalar(R * MathUtils.lerp(9, 2.4, this.view.blend));
    }
  }

  /* -------------------------------------------------------------- update */

  /**
   * @param {import('../ephem/system.js').SolarSystem} system
   * @param {Vector3} cameraAbs absolute camera position; becomes the origin
   */
  sync(system, cameraAbs, opts = {}) {
    this.origin.copy(cameraAbs);
    this._computeDisplay(system);

    const version = `${this.view.blend.toFixed(4)}|${this.view.sizeExaggeration.toFixed(4)}`;

    for (const [key, entry] of this.bodies) {
      entry.group.position.copy(this.display.get(key)).sub(this.origin);
      _m.copy(system.get(key).orient);
      entry.orient.quaternion.setFromRotationMatrix(_m);

      if (entry.scaleVersion !== version) this._applyScale(entry, version);
      if (entry.corona) entry.corona.lookAt(0, 0, 0); // the camera is the origin
    }

    // Cloud decks drift slowly eastward relative to the surface below them.
    const earth = this.bodies.get('earth');
    if (earth?.cloudMesh) earth.cloudMesh.rotation.y = (system.jd * 0.06) % (Math.PI * 2);

    this._syncOrbits(system, opts);
  }

  _syncOrbits(system, opts) {
    const show = opts.showOrbits !== false;
    this.orbitRoot.visible = show;
    if (!show) return;

    // Orbit paths are AU-scale lines; from a low orbit they sweep across the
    // whole view as meaningless streaks. Fade them out as you close in.
    const fade = MathUtils.clamp(
      MathUtils.inverseLerp(6, 45, opts.altitudeInRadii ?? Infinity), 0, 1,
    );

    for (const [key, orbit] of this.orbits) {
      const def = BY_KEY[key];
      orbit.line.material.opacity = orbit.baseOpacity * fade;
      orbit.line.visible = fade > 0.01;
      if (!orbit.line.visible) continue;

      const center = def.parent === 'sun'
        ? _v.set(0, 0, 0)
        : _v.copy(this.display.get(def.parent));
      orbit.line.position.copy(center).sub(this.origin);

      const blendChanged = orbit.lastBlend !== this.view.blend;
      let rebuild = orbit.lastBuiltJd === -Infinity || blendChanged;

      if (!rebuild && !orbit.isPlanet) {
        // Satellite paths precess fast enough to need redoing, but sampling one
        // costs a few hundred ephemeris evaluations — throttle on wall clock too.
        const now = performance.now();
        const period = SAT_PERIOD[key] ?? 27.32;
        rebuild = Math.abs(system.jd - orbit.lastBuiltJd) > period * 0.05
          && now - orbit.lastBuiltAt > 200;
        if (rebuild) orbit.lastBuiltAt = now;
      }

      if (rebuild) this._rebuildOrbit(key, system, system.jd);
    }
  }

  /**
   * Rebuild an orbit path. Vertices are stored relative to the parent body so
   * the buffer stays numerically small; the line object carries the offset.
   */
  _rebuildOrbit(key, system, jd) {
    const orbit = this.orbits.get(key);
    const def = BY_KEY[key];
    const arr = orbit.geo.attributes.position.array;
    const n = orbit.segments;
    const p = new Vector3();

    if (HELIOCENTRIC.has(def.ephem)) {
      const minor = def.ephem === 'minor';
      const ephemKey = def.ephem === 'earth' ? 'emb' : key;
      const periodDays = minor ? minorBodyPeriod(key) : (360 / RATES[ephemKey]) * 36525;
      const sample = minor ? minorBodyPosition : planetPosition;
      const tmp = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < n; i++) {
        sample(ephemKey, jd + (i / n) * periodDays, tmp);
        // ecliptic AU -> scene axes, scene units
        p.set(tmp.x, tmp.z, -tmp.y).multiplyScalar(AU_KM * KM);
        this.view.mapHeliocentric(p, p);
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
    } else {
      const parent = this.bodies.get(def.parent);
      const parentDisp = this.view.radius(parent.rEq, parent.isStar);
      const period = SAT_PERIOD[key] ?? 27.32;
      for (let i = 0; i < n; i++) {
        system.update(jd + (i / n) * period);
        p.copy(system.pos(key)).sub(system.pos(def.parent));
        this.view.mapSatellite(p, parent.rEq, parentDisp, p);
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
      system.update(jd); // restore the frame's state
    }

    orbit.geo.attributes.position.needsUpdate = true;
    orbit.geo.computeBoundingSphere();
    orbit.lastBuiltJd = jd;
    orbit.lastBlend = this.view.blend;
  }

  /* ------------------------------------------------------------ shaders */

  /** Occluder list for a body, in origin-relative displayed coordinates. */
  occluderData(key) {
    const self = this.display.get(key);
    const ranked = [];
    for (const k of occludersFor(key)) {
      const e = this.bodies.get(k);
      if (!e) continue;
      // Angular size from the shadowed body: anything that cannot subtend much
      // cannot cover much of the Sun either.
      const d = Math.max(_v.copy(this.display.get(k)).sub(self).length(), 1e-9);
      ranked.push({ k, e, score: e.drawRadius / d });
    }
    ranked.sort((a, b) => b.score - a.score);

    const out = [];
    for (const r of ranked) {
      out.push({
        pos: _occVec(out.length).copy(this.display.get(r.k)).sub(this.origin),
        radius: r.e.drawRadius,
      });
    }
    return out;
  }

  /** World-space spin axis of a body (its local +Y after orientation). */
  poleOf(key) {
    const e = this.bodies.get(key);
    if (!e) return null;
    return _poleVec.set(0, 1, 0).applyQuaternion(e.orient.quaternion);
  }

  ringShadowData() {
    const saturn = this.bodies.get('saturn');
    if (!saturn?.ringMesh) return null;
    const s = saturn.drawRadius / saturn.rEq;
    return {
      bodyKey: 'saturn',
      center: _ringCenter.copy(this.display.get('saturn')).sub(this.origin),
      normal: _ringNormal.set(0, 1, 0).applyQuaternion(saturn.orient.quaternion),
      inner: saturn.ringInner * s,
      outer: saturn.ringOuter * s,
      map: saturn.ringMesh.material.uniforms.uMap.value,
    };
  }

  setOrbitsVisible(v) {
    this.orbitRoot.visible = v;
  }

  /** Meshes eligible for click-to-focus picking. */
  pickables() {
    return [...this.bodies.values()].map((e) => e.mesh);
  }
}

/* Scratch vectors — occluder lists are rebuilt every frame for every material. */
const _occPool = [];
function _occVec(i) {
  while (_occPool.length <= i) _occPool.push(new Vector3());
  return _occPool[i];
}
const _poleVec = new Vector3();
const _ringCenter = new Vector3();
const _ringNormal = new Vector3();

/** Ephemeris types whose orbit is drawn about the Sun rather than a planet. */
const HELIOCENTRIC = new Set(['planet', 'earth', 'minor', 'pluto']);

const SAT_PERIOD = SATELLITE_PERIODS;

// Mean-longitude rates from the Standish table, deg/century.
const RATES = {
  pluto: 145.20780515,
  mercury: 149472.67411175,
  venus: 58517.81538729,
  emb: 35999.37244981,
  mars: 19140.30268499,
  jupiter: 3034.74612775,
  saturn: 1222.49362201,
  uranus: 428.48202785,
  neptune: 218.45945325,
};
