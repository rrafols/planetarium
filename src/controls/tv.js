/**
 * Smart TV / D-pad control scheme.
 *
 * A TV browser has no pointer, no scroll wheel and no keyboard — just a remote
 * with a direction pad, OK, Back, four colour buttons, transport keys and a
 * channel rocker. So rather than faking a cursor, this remaps the whole app
 * onto that vocabulary:
 *
 *   D-pad        orbit the camera            (hold to keep moving)
 *   Ch +/-       zoom in / out
 *   OK           open the menu
 *   Back         close the menu
 *   Play/Pause   pause or resume time
 *   ⏪ / ⏩       slower / faster
 *   Red          orbit paths        Green   labels
 *   Yellow       realistic <-> schematic     Blue   next solar eclipse
 *   0-9          jump to a body
 *
 * Anything not on a hardware button lives in the menu, which is a single
 * vertical list driven by up/down (move), left/right (adjust) and OK (activate)
 * — the only interaction model that is reliable across TV firmwares.
 *
 * TV browsers report keys through `keyCode` with vendor-specific values, and
 * several of them never populate `key`, so the mapping is keyCode-first.
 */

import { MathUtils } from 'three';
import { BODIES } from '../data/bodies.js';

const KEY = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
  OK: 13,
  BACK: [10009, 461, 27], // Tizen, webOS, Escape
  PLAY: [415, 10252, 179],
  PAUSE: [19, 10252],
  STOP: 413,
  FF: [417, 228],
  RW: [412, 227],
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
  CH_UP: [427, 33, 187, 107], // ChannelUp, PageUp, '=', numpad '+'
  CH_DOWN: [428, 34, 189, 109],
};

const is = (code, spec) => (Array.isArray(spec) ? spec.includes(code) : code === spec);

/** Heuristic detection of a TV browser. */
export function looksLikeTV() {
  const q = new URLSearchParams(location.search);
  if (q.has('tv')) return q.get('tv') !== '0';
  const ua = navigator.userAgent;
  return /tizen|smart-?tv|smarttv|web0s|webos|netcast|hbbtv|viera|bravia|aquos|philipstv|googletv|crkey|appletv/i
    .test(ua);
}

export class TvControls {
  /**
   * @param {object} deps
   * @param {import('./cameraRig.js').CameraRig} deps.rig
   * @param {object} deps.handlers   the same handler bag main.js gives the HUD
   * @param {object} deps.options    live view-option flags
   * @param {() => object} deps.getState  { clock, view, focusKey }
   */
  constructor(deps) {
    this.deps = deps;
    this.enabled = false;
    this.menuOpen = false;
    this.held = new Set();
    this.index = 0;

    this.root = null;
    this.rows = [];

    addEventListener('keydown', (e) => this._onKeyDown(e), true);
    addEventListener('keyup', (e) => this.held.delete(e.keyCode), true);
    addEventListener('blur', () => this.held.clear());
  }

  /* --------------------------------------------------------------- toggle */

  setEnabled(on) {
    this.enabled = on;
    document.body.classList.toggle('tv', on);
    if (!on) {
      this.closeMenu();
      this.held.clear();
    } else {
      this._ensureDom();
    }
  }

  /* ---------------------------------------------------------------- input */

  _onKeyDown(e) {
    if (!this.enabled) return;
    if (e.target instanceof HTMLInputElement) return;

    const c = e.keyCode;
    const H = this.deps.handlers;

    // Back closes the menu; otherwise let it bubble so the TV can exit the app.
    if (is(c, KEY.BACK)) {
      if (this.menuOpen) {
        this.closeMenu();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (this.menuOpen) {
      this._menuKey(c, e);
      return;
    }

    let handled = true;
    switch (true) {
      case c === KEY.OK: this.openMenu(); break;
      case c === KEY.UP: case c === KEY.DOWN:
      case c === KEY.LEFT: case c === KEY.RIGHT:
        this.held.add(c);
        break;
      case is(c, KEY.CH_UP): this._zoom(-1); break;
      case is(c, KEY.CH_DOWN): this._zoom(1); break;
      case is(c, KEY.PLAY): case is(c, KEY.PAUSE): H.onTogglePlay(); break;
      case is(c, KEY.FF): H.onNudgeRate(1); break;
      case is(c, KEY.RW): H.onNudgeRate(-1); break;
      case c === KEY.STOP: H.onNow(); break;
      case c === KEY.RED: this._toggleOption('orbits'); break;
      case c === KEY.GREEN: this._toggleOption('labels'); break;
      case c === KEY.YELLOW: this._toggleSchematic(); break;
      case c === KEY.BLUE: H.onFindEclipse('solar', 1); break;
      case c >= 48 && c <= 57: this._focusByDigit(c - 48); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  _zoom(dir) {
    const rig = this.deps.rig;
    rig.targetDistance *= Math.exp(dir * 0.28);
    rig.transition = null;
    rig._clampDistance();
  }

  _toggleOption(name) {
    const next = !this.deps.options[name];
    this.deps.handlers.onOption(name, next);
    const box = document.getElementById(`opt-${name}`);
    if (box) box.checked = next;
    this.toast(`${name}: ${next ? 'on' : 'off'}`);
  }

  _toggleSchematic() {
    const s = this.deps.getState();
    const next = s.schematicTarget > 0.5 ? 0 : 1;
    this.deps.handlers.onSchematic(next);
    this.deps.hud.setSchematic(next);
    this.toast(next ? 'Schematic scale' : 'Realistic scale');
  }

  _focusByDigit(d) {
    const order = ['sun', 'mercury', 'venus', 'earth', 'mars',
      'jupiter', 'saturn', 'uranus', 'neptune', 'moon'];
    if (order[d]) this.deps.handlers.onFocus(order[d]);
  }

  /** Continuous camera motion while a direction is held. */
  update(dt) {
    if (!this.enabled || this.menuOpen || this.held.size === 0) return;
    const rig = this.deps.rig;
    const rate = 1.15 * dt;
    if (this.held.has(KEY.LEFT)) rig.targetTheta += rate;
    if (this.held.has(KEY.RIGHT)) rig.targetTheta -= rate;
    if (this.held.has(KEY.UP)) rig.targetPhi = MathUtils.clamp(rig.targetPhi - rate, 0.02, Math.PI - 0.02);
    if (this.held.has(KEY.DOWN)) rig.targetPhi = MathUtils.clamp(rig.targetPhi + rate, 0.02, Math.PI - 0.02);
    rig.transition = null;
  }

  /* ----------------------------------------------------------------- menu */

  _ensureDom() {
    if (this.root) return;

    this.root = document.createElement('div');
    this.root.id = 'tv-menu';
    this.root.className = 'hidden';
    this.root.innerHTML = '<div class="tv-menu-inner"><div class="tv-menu-title">Planetarium</div>'
      + '<div class="tv-menu-list"></div>'
      + '<div class="tv-menu-foot">▲▼ move · ◀▶ change · OK select · BACK close</div></div>';
    document.body.appendChild(this.root);
    this.list = this.root.querySelector('.tv-menu-list');

    this.hint = document.createElement('div');
    this.hint.id = 'tv-hint';
    this.hint.innerHTML = `
      <span><i style="background:#e2564a"></i>Orbits</span>
      <span><i style="background:#4bbf6a"></i>Labels</span>
      <span><i style="background:#e0c44a"></i>Scale</span>
      <span><i style="background:#4a8fe0"></i>Next eclipse</span>
      <span class="tv-hint-sep">OK menu · ▲▼◀▶ look · CH± zoom</span>`;
    document.body.appendChild(this.hint);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'tv-toast';
    this.toastEl.className = 'hidden';
    document.body.appendChild(this.toastEl);

    this._buildRows();
  }

  _buildRows() {
    const H = this.deps.handlers;
    const O = this.deps.options;
    const rows = [];

    rows.push({ header: 'Go to' });
    for (const def of BODIES) {
      rows.push({
        label: def.name,
        indent: def.kind === 'moon',
        type: 'action',
        run: () => { H.onFocus(def.key); this.closeMenu(); },
      });
    }

    rows.push({ header: 'Time' });
    rows.push({
      label: 'Pause / resume',
      type: 'action',
      value: () => (this.deps.getState().clock.paused ? 'paused' : 'running'),
      run: () => H.onTogglePlay(),
    });
    rows.push({
      label: 'Speed',
      type: 'adjust',
      value: () => this.deps.getState().rateLabel,
      left: () => H.onNudgeRate(-1),
      right: () => H.onNudgeRate(1),
      run: () => H.onNudgeRate(1),
    });
    rows.push({ label: 'Reverse direction', type: 'action', run: () => H.onReverse() });
    rows.push({ label: 'Jump to now', type: 'action', run: () => { H.onNow(); this.closeMenu(); } });

    rows.push({ header: 'Eclipses' });
    rows.push({ label: 'Next solar eclipse', type: 'action', run: () => { H.onFindEclipse('solar', 1); this.closeMenu(); } });
    rows.push({ label: 'Next lunar eclipse', type: 'action', run: () => { H.onFindEclipse('lunar', 1); this.closeMenu(); } });
    rows.push({ label: 'Previous solar eclipse', type: 'action', run: () => { H.onFindEclipse('solar', -1); this.closeMenu(); } });
    rows.push({ label: 'Previous lunar eclipse', type: 'action', run: () => { H.onFindEclipse('lunar', -1); this.closeMenu(); } });

    rows.push({ header: 'Scale' });
    rows.push({
      label: 'Model',
      type: 'adjust',
      value: () => (this.deps.getState().schematicTarget > 0.5 ? 'schematic' : 'realistic'),
      left: () => this._setSchematic(0),
      right: () => this._setSchematic(1),
      run: () => this._toggleSchematic(),
    });

    rows.push({ header: 'View' });
    for (const [key, label] of [
      ['orbits', 'Orbit paths'], ['labels', 'Labels'], ['eclipse', 'Eclipse shadows'],
      ['bloom', 'Sun bloom'], ['stars', 'Milky Way'], ['night', 'Earth city lights'],
    ]) {
      rows.push({
        label,
        type: 'toggle',
        value: () => (O[key] ? 'on' : 'off'),
        run: () => this._toggleOption(key),
        left: () => this._toggleOption(key),
        right: () => this._toggleOption(key),
      });
    }

    this.rows = rows;
    this.list.innerHTML = '';
    this.rowEls = rows.map((r) => {
      const el = document.createElement('div');
      if (r.header) {
        el.className = 'tv-row tv-header';
        el.textContent = r.header;
      } else {
        el.className = `tv-row${r.indent ? ' tv-indent' : ''}`;
        el.innerHTML = '<span class="tv-label"></span><span class="tv-value"></span>';
        el.querySelector('.tv-label').textContent = r.label;
      }
      this.list.appendChild(el);
      return el;
    });

    // Start on the first selectable row.
    this.index = rows.findIndex((r) => !r.header);
  }

  _setSchematic(v) {
    this.deps.handlers.onSchematic(v);
    this.deps.hud.setSchematic(v);
  }

  openMenu() {
    this._ensureDom();
    this.menuOpen = true;
    this.held.clear();
    this.root.classList.remove('hidden');
    this._render();
  }

  closeMenu() {
    this.menuOpen = false;
    if (this.root) this.root.classList.add('hidden');
  }

  _menuKey(c, e) {
    e.preventDefault();
    e.stopPropagation();
    const row = this.rows[this.index];

    if (c === KEY.UP) this._move(-1);
    else if (c === KEY.DOWN) this._move(1);
    else if (c === KEY.LEFT) row?.left?.();
    else if (c === KEY.RIGHT) row?.right?.();
    else if (c === KEY.OK) row?.run?.();
    else if (c >= 48 && c <= 57) { this._focusByDigit(c - 48); this.closeMenu(); return; }
    this._render();
  }

  _move(dir) {
    let i = this.index;
    for (let n = 0; n < this.rows.length; n++) {
      i = (i + dir + this.rows.length) % this.rows.length;
      if (!this.rows[i].header) break;
    }
    this.index = i;
    this.rowEls[i]?.scrollIntoView({ block: 'nearest' });
  }

  _render() {
    if (!this.menuOpen) return;
    const focusKey = this.deps.getState().focusKey;
    this.rows.forEach((r, i) => {
      const el = this.rowEls[i];
      if (r.header) return;
      el.classList.toggle('sel', i === this.index);
      const v = el.querySelector('.tv-value');
      if (r.value) v.textContent = r.value();
      else if (r.type === 'action' && this.rows[i].label) {
        const def = BODIES.find((b) => b.name === r.label);
        v.textContent = def && def.key === focusKey ? '● here' : '';
      }
    });
  }

  toast(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), 1800);
  }

  /** Refresh live values while the menu is open. */
  tick() {
    if (this.menuOpen) this._render();
  }
}
