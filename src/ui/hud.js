/**
 * DOM wiring for the HUD. Holds no simulation state — main.js pushes values in
 * and gets user intent back through the callbacks passed to the constructor.
 */

import { BODIES, BY_KEY } from '../data/bodies.js';
import {
  formatDate, formatTime, formatDistance, formatPeriod, RATE_STEPS,
} from '../sim/clock.js';

const NUMBER_KEYS = {
  sun: '0', mercury: '1', venus: '2', earth: '3', mars: '4',
  jupiter: '5', saturn: '6', uranus: '7', neptune: '8', moon: '9',
};

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      date: $('ui-date'), time: $('ui-time'), jd: $('ui-jd'), rate: $('ui-rate'),
      target: $('ui-target'), kind: $('ui-target-kind'),
      radius: $('ui-radius'), sundist: $('ui-sundist'), camdist: $('ui-camdist'),
      rot: $('ui-rot'), orb: $('ui-orb'), tilt: $('ui-tilt'),
      exag: $('ui-exag'), exagWarn: $('exag-warn'),
      schematicSlider: $('schematic-slider'),
      scaleReal: $('scale-real'), scaleSchematic: $('scale-schematic'),
      banner: $('eclipse-banner'), ebTitle: $('eb-title'), ebSub: $('eb-sub'),
      efind: $('efind-status'),
      play: $('btn-play'), rev: $('btn-rev'),
      rateSlider: $('rate-slider'),
      modeOrbit: $('mode-orbit'), modeFly: $('mode-fly'),
      loading: $('loading'), loadFill: $('load-fill'), loadNote: $('load-note'),
      hiresStatus: $('hires-status'), hiresFill: $('hires-fill'), hiresNote: $('hires-note'),
    };

    this._buildBodyList();
    this._wireTime();
    this._wireSettings();
    this._wireEclipse();
    this._wireCollapse();
  }

  /* ------------------------------------------------------------ building */

  _buildBodyList() {
    const list = $('body-list');
    this.bodyButtons = new Map();

    for (const def of BODIES) {
      const btn = document.createElement('button');
      btn.className = `body-btn${def.kind === 'moon' ? ' is-moon' : ''}`;
      btn.dataset.key = def.key;

      const dot = document.createElement('i');
      dot.style.color = `#${def.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('span');
      name.textContent = def.name;
      btn.append(dot, name);

      if (NUMBER_KEYS[def.key]) {
        const kbd = document.createElement('kbd');
        kbd.textContent = NUMBER_KEYS[def.key];
        btn.appendChild(kbd);
      }

      btn.addEventListener('click', () => this.h.onFocus(def.key));
      list.appendChild(btn);
      this.bodyButtons.set(def.key, btn);
    }
  }

  _wireTime() {
    $('btn-play').addEventListener('click', () => this.h.onTogglePlay());
    $('btn-faster').addEventListener('click', () => this.h.onNudgeRate(1));
    $('btn-slower').addEventListener('click', () => this.h.onNudgeRate(-1));
    $('btn-rev').addEventListener('click', () => this.h.onReverse());
    $('btn-now').addEventListener('click', () => this.h.onNow());
    this.el.rateSlider.addEventListener('input', (e) => this.h.onRateSlider(+e.target.value));
  }

  _wireSettings() {
    const opts = {
      'opt-orbits': 'orbits',
      'opt-labels': 'labels',
      'opt-eclipse': 'eclipse',
      'opt-bloom': 'bloom',
      'opt-stars': 'stars',
      'opt-belt': 'belt',
      'opt-streams': 'streams',
      'opt-comets': 'comets',
      'opt-night': 'night',
      'opt-hires': 'hires',
    };
    for (const [id, name] of Object.entries(opts)) {
      $(id).addEventListener('change', (e) => this.h.onOption(name, e.target.checked));
    }

    $('exag-slider').addEventListener('input', (e) => {
      // 0 -> 1x (true scale), 100 -> 1000x, logarithmic in between.
      const t = +e.target.value / 100;
      const factor = 10 ** (t * 3);
      this.h.onExaggeration(factor);
      this.setExaggeration(factor);
    });

    this.el.schematicSlider.addEventListener('input', (e) => {
      this.h.onSchematic(+e.target.value / 100);
      this.setSchematic(+e.target.value / 100, false);
    });
    $('scale-real').addEventListener('click', () => {
      this.h.onSchematic(0);
      this.setSchematic(0);
    });
    $('scale-schematic').addEventListener('click', () => {
      this.h.onSchematic(1);
      this.setSchematic(1);
    });

    this.el.modeOrbit.addEventListener('click', () => this.h.onMode('orbit'));
    this.el.modeFly.addEventListener('click', () => this.h.onMode('fly'));
  }

  _wireEclipse() {
    $('find-solar').addEventListener('click', () => this.h.onFindEclipse('solar', 1));
    $('find-lunar').addEventListener('click', () => this.h.onFindEclipse('lunar', 1));
    $('find-solar-prev').addEventListener('click', () => this.h.onFindEclipse('solar', -1));
    $('find-lunar-prev').addEventListener('click', () => this.h.onFindEclipse('lunar', -1));
  }

  _wireCollapse() {
    for (const [hdr, body] of [['settings-hdr', 'settings-body'], ['help-hdr', 'help-body']]) {
      const h = $(hdr);
      const b = $(body);
      h.addEventListener('click', () => {
        const hidden = b.style.display === 'none';
        b.style.display = hidden ? '' : 'none';
        h.classList.toggle('collapsed', !hidden);
      });
    }
  }

  /* ------------------------------------------------------------ updating */

  updateClock(clock) {
    const d = clock.toDate();
    this.el.date.textContent = formatDate(d);
    this.el.time.textContent = formatTime(d);
    this.el.jd.textContent = clock.jd.toFixed(4);
    this.el.rate.textContent = clock.paused
      ? 'paused'
      : `${clock.direction < 0 ? '−' : ''}${clock.rateLabel}`;
    this.el.play.textContent = clock.paused ? '▶' : '❚❚';
    this.el.rev.classList.toggle('reversed', clock.direction < 0);
    if (+this.el.rateSlider.value !== clock.stepIndex) {
      this.el.rateSlider.value = clock.stepIndex;
    }
    this.rateLabelEls?.forEach((el, i) => el.classList.toggle('on', i === clock.stepIndex));
  }

  /** Print every rate step under the slider, highlighting the active one. */
  buildRateLabels() {
    const row = document.getElementById('rate-labels');
    if (!row) return;
    row.innerHTML = '';
    this.rateLabelEls = RATE_STEPS.map((step, i) => {
      const el = document.createElement('span');
      el.textContent = step.label;
      el.className = 'rate-tick';
      el.addEventListener('click', () => this.h.onRateSlider(i));
      row.appendChild(el);
      return el;
    });
  }

  setFocus(key) {
    for (const [k, btn] of this.bodyButtons) btn.classList.toggle('active', k === key);
    const def = BY_KEY[key];
    this.el.target.textContent = def.name;
    this.el.kind.textContent = def.kind;
  }

  updateInfo({ key, sunDistance, cameraDistance, rotationPeriod, orbitalPeriod, tilt }) {
    const def = BY_KEY[key];
    this.el.radius.textContent = `${def.radius.toLocaleString()} km`;
    this.el.sundist.textContent = key === 'sun' ? '—' : formatDistance(sunDistance);
    this.el.camdist.textContent = formatDistance(cameraDistance);
    this.el.rot.textContent = formatPeriod(rotationPeriod);
    this.el.orb.textContent = orbitalPeriod ? formatPeriod(orbitalPeriod) : '—';
    this.el.tilt.textContent = tilt == null ? '—' : `${tilt.toFixed(2)}°`;
  }

  setExaggeration(factor) {
    this.el.exag.textContent = factor < 10 ? factor.toFixed(1) : Math.round(factor);
    this.exagFactor = factor;
    this._refreshScaleNote();
  }

  setSchematic(amount, syncSlider = true) {
    this.schematicAmount = amount;
    if (syncSlider) this.el.schematicSlider.value = Math.round(amount * 100);
    this.el.scaleReal.classList.toggle('on', amount < 0.001);
    this.el.scaleSchematic.classList.toggle('on', amount >= 0.001);
    this._refreshScaleNote();
  }

  _refreshScaleNote() {
    const exag = this.exagFactor ?? 1;
    const schem = this.schematicAmount ?? 0;
    const trueScale = exag < 1.02 && schem < 0.001;
    this.el.exagWarn.textContent = trueScale
      ? 'True scale — distances, sizes and eclipse geometry all exact.'
      : 'Orbital directions stay exact, so dates and alignments are still real; '
        + 'sizes and distances are not, and shadows are self-consistent rather than true.';
    this.el.exagWarn.classList.toggle('alert', !trueScale);
  }

  setMode(mode) {
    this.el.modeOrbit.classList.toggle('on', mode === 'orbit');
    this.el.modeFly.classList.toggle('on', mode === 'fly');
  }

  /** @param {null | {kind:'solar'|'lunar', title:string, sub:string}} state */
  setEclipseBanner(state) {
    if (!state) {
      this.el.banner.classList.add('hidden');
      return;
    }
    this.el.banner.classList.remove('hidden');
    this.el.banner.classList.toggle('lunar', state.kind === 'lunar');
    this.el.ebTitle.textContent = state.title;
    this.el.ebSub.textContent = state.sub;
  }

  setFindStatus(text) {
    this.el.efind.textContent = text;
  }

  /** Progress line for the on-demand 8k map download. */
  setHiresProgress(note, frac, done = false) {
    this.el.hiresStatus.classList.remove('hidden');
    this.el.hiresFill.style.width = `${Math.round(Math.min(frac, 1) * 100)}%`;
    this.el.hiresNote.textContent = note;
    this.el.hiresNote.classList.toggle('alert', /failed/.test(note));
    if (done) setTimeout(() => this.el.hiresStatus.classList.add('hidden'), 4000);
  }

  setLoadProgress(frac, note) {
    this.el.loadFill.style.width = `${Math.round(frac * 100)}%`;
    if (note) this.el.loadNote.textContent = note;
  }

  hideLoading() {
    this.el.loading.classList.add('done');
    setTimeout(() => { this.el.loading.style.display = 'none'; }, 600);
  }
}

export { NUMBER_KEYS };
