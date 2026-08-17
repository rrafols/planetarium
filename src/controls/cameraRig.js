/**
 * Camera rig with two modes.
 *
 *  ORBIT — the default. The camera sits on a sphere around the focus body and
 *    follows it. Drag orbits, wheel dollies. Zoom is exponential in distance so
 *    that one wheel notch feels the same whether you are 10 km above the Moon
 *    or 40 AU out.
 *
 *  FLY — WASD/QE with mouse look. Translation speed is derived from the
 *    distance to the nearest surface, so you crawl near a planet and cross the
 *    solar system when nothing is close.
 *
 * The rig owns an *absolute* camera position (float64). The renderer pins the
 * actual three.js camera at the scene origin and shifts the world instead; see
 * render/scene.js.
 */

import { Vector3, Euler, Matrix4, MathUtils } from 'three';

const UP = new Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;

const _v = new Vector3();
const _v2 = new Vector3();

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.mode = 'orbit';
    this.focusKey = 'earth';

    /** Absolute position in scene units. */
    this.position = new Vector3(0, 30000, 260000);

    // Orbit state
    this.theta = Math.PI * 0.25; // azimuth
    this.phi = Math.PI * 0.42; // polar from +Y
    this.distance = 60000;
    this.targetTheta = this.theta;
    this.targetPhi = this.phi;
    this.targetDistance = this.distance;

    // Fly state
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new Vector3();
    this.flySpeedScale = 1;

    // Fly-to transition
    this.transition = null;

    this.keys = new Set();
    this.dragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.pointers = new Map();
    this.pinchDist = 0;

    this.minDistanceFactor = 1.02;
    this.focusRadius = 6.371;
    this.nearestSurface = 1e6;

    this._bind();
  }

  /* --------------------------------------------------------------- input */

  _bind() {
    const dom = this.dom;

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dragMoved = 0;
      } else if (this.pointers.size === 2) {
        this.pinchDist = this._pinch();
      }
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2) {
        const d = this._pinch();
        if (this.pinchDist > 0) this._zoom((this.pinchDist - d) * 0.01);
        this.pinchDist = d;
        return;
      }
      if (!this.dragging) return;

      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.dragMoved += Math.abs(dx) + Math.abs(dy);

      const rate = 0.005;
      if (this.mode === 'orbit') {
        this.targetTheta -= dx * rate;
        this.targetPhi = MathUtils.clamp(this.targetPhi - dy * rate, 0.02, Math.PI - 0.02);
        this.transition = null;
      } else {
        this.yaw -= dx * rate;
        this.pitch = MathUtils.clamp(this.pitch - dy * rate, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      }
    });

    const release = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 0) this.dragging = false;
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const notches = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (this.mode === 'orbit') {
        this._zoom(notches * 0.0016);
      } else {
        this.flySpeedScale = MathUtils.clamp(
          this.flySpeedScale * Math.exp(-notches * 0.0016), 0.01, 100,
        );
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _pinch() {
    const pts = [...this.pointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  _zoom(amount) {
    this.targetDistance *= Math.exp(amount);
    this.transition = null;
    this._clampDistance();
  }

  _clampDistance() {
    const min = this.focusRadius * this.minDistanceFactor;
    this.targetDistance = MathUtils.clamp(this.targetDistance, min, 4e7);
  }

  /* --------------------------------------------------------------- focus */

  /**
   * @param {string} key
   * @param {Vector3} bodyAbsPos
   * @param {number} bodyRadius  drawn radius in scene units
   * @param {boolean} animate
   */
  focus(key, bodyAbsPos, bodyRadius, animate = true) {
    const wasFocus = this.focusKey;
    this.focusKey = key;
    this.focusRadius = bodyRadius;

    // Frame the body so it fills a comfortable share of the vertical FOV.
    const fov = MathUtils.degToRad(this.camera.fov);
    const framed = (bodyRadius / Math.tan(fov / 2)) * 3.0;

    if (this.mode === 'fly') this.mode = 'orbit';

    if (!animate || wasFocus === key) {
      this.targetDistance = framed;
      this._clampDistance();
      if (!animate) this.distance = this.targetDistance;
      return;
    }

    // Keep the current viewing angle, ease the position across.
    this.targetDistance = framed;
    this._clampDistance();
    this.transition = {
      from: this.position.clone(),
      t: 0,
      duration: 1.4,
    };
  }

  /** Point the orbit camera along a given direction from the focus body. */
  setOrbitDirection(dir) {
    _v.copy(dir).normalize();
    this.theta = Math.atan2(_v.x, _v.z);
    this.phi = Math.acos(MathUtils.clamp(_v.y, -1, 1));
    this.targetTheta = this.theta;
    this.targetPhi = this.phi;
    this.transition = null;
  }

  /** Switch between orbit and fly, carrying the current view across. */
  setMode(mode, focusAbsPos) {
    if (mode === this.mode) return;
    if (mode === 'fly') {
      // Derive yaw/pitch from where we are already looking.
      _v.copy(focusAbsPos).sub(this.position).normalize();
      this.yaw = Math.atan2(-_v.x, -_v.z);
      this.pitch = Math.asin(MathUtils.clamp(_v.y, -1, 1));
      this.velocity.set(0, 0, 0);
    } else {
      _v.copy(this.position).sub(focusAbsPos);
      this.distance = Math.max(_v.length(), this.focusRadius * this.minDistanceFactor);
      this.targetDistance = this.distance;
      this.theta = Math.atan2(_v.x, _v.z);
      this.phi = Math.acos(MathUtils.clamp(_v.y / this.distance, -1, 1));
      this.targetTheta = this.theta;
      this.targetPhi = this.phi;
    }
    this.transition = null;
    this.mode = mode;
  }

  /* -------------------------------------------------------------- update */

  /**
   * @param {number} dt seconds
   * @param {Vector3} focusAbsPos current absolute position of the focus body
   * @param {number} focusRadius
   * @param {(p:Vector3)=>number} nearestSurfaceDistance
   */
  update(dt, focusAbsPos, focusRadius, nearestSurfaceDistance) {
    this.focusRadius = focusRadius;
    this._clampDistance();

    if (this.mode === 'orbit') {
      this._updateOrbit(dt, focusAbsPos);
    } else {
      this._updateFly(dt, nearestSurfaceDistance);
    }

    this.nearestSurface = nearestSurfaceDistance(this.position);

    // The three.js camera never leaves the origin; only its rotation is real.
    this.camera.position.set(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  _updateOrbit(dt, focusAbsPos) {
    const k = 1 - Math.exp(-dt * 9);
    this.theta += shortestAngle(this.theta, this.targetTheta) * k;
    this.phi += (this.targetPhi - this.phi) * k;
    // Distance eases in log space so it does not crawl across large ranges.
    this.distance = Math.exp(
      Math.log(this.distance) + (Math.log(this.targetDistance) - Math.log(this.distance)) * k,
    );

    const sp = Math.sin(this.phi);
    _v.set(
      sp * Math.sin(this.theta),
      Math.cos(this.phi),
      sp * Math.cos(this.theta),
    ).multiplyScalar(this.distance);

    const desired = _v2.copy(focusAbsPos).add(_v);

    if (this.transition) {
      this.transition.t += dt / this.transition.duration;
      if (this.transition.t >= 1) {
        this.transition = null;
        this.position.copy(desired);
      } else {
        const e = easeInOutCubic(this.transition.t);
        this.position.copy(this.transition.from).lerp(desired, e);
      }
    } else {
      this.position.copy(desired);
    }

    // Look at the focus from wherever we actually are.
    _v.copy(focusAbsPos).sub(this.position);
    this._lookAlong(_v);
  }

  _updateFly(dt, nearestSurfaceDistance) {
    const e = new Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);

    const surf = nearestSurfaceDistance(this.position);
    let speed = MathUtils.clamp(surf * 0.55, 1e-4, 3e6) * this.flySpeedScale;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) speed *= 9;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) speed *= 0.08;

    const fwd = _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = _v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    const accel = new Vector3();
    if (this.keys.has('KeyW')) accel.add(fwd);
    if (this.keys.has('KeyS')) accel.sub(fwd);
    if (this.keys.has('KeyD')) accel.add(right);
    if (this.keys.has('KeyA')) accel.sub(right);
    if (this.keys.has('KeyE')) accel.add(UP);
    if (this.keys.has('KeyQ')) accel.sub(UP);

    if (accel.lengthSq() > 0) accel.normalize().multiplyScalar(speed);

    // Critically-damped-ish approach to the commanded velocity.
    const damp = 1 - Math.exp(-dt * 7);
    this.velocity.lerp(accel, damp);
    this.position.addScaledVector(this.velocity, dt);
  }

  _lookAlong(dir) {
    _v2.copy(dir).normalize();
    // Guard the degenerate case of looking straight up or down the world axis.
    const up = Math.abs(_v2.y) > 0.9995 ? new Vector3(0, 0, 1) : UP;
    const m = _lookMatrix(_v2, up);
    this.camera.quaternion.setFromRotationMatrix(m);
  }

  /** Distance from the camera to the focus body's surface, in scene units. */
  altitudeAbove(focusAbsPos, radius) {
    return this.position.distanceTo(focusAbsPos) - radius;
  }
}

/* ---------------------------------------------------------------- helpers */

const _mat = new Matrix4();
const _zAxis = new Vector3();
const _xAxis = new Vector3();
const _yAxis = new Vector3();

function _lookMatrix(forward, up) {
  _zAxis.copy(forward).multiplyScalar(-1).normalize(); // camera looks down -Z
  _xAxis.crossVectors(up, _zAxis);
  if (_xAxis.lengthSq() < 1e-12) {
    _xAxis.set(1, 0, 0);
  }
  _xAxis.normalize();
  _yAxis.crossVectors(_zAxis, _xAxis);
  return _mat.makeBasis(_xAxis, _yAxis, _zAxis);
}

function shortestAngle(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
