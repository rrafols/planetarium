/**
 * Planetarium — entry point.
 *
 * Wires together the ephemeris, the scene, the camera rig, the clock and the
 * HUD, and owns the frame loop.
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Raycaster, Vector2, Vector3,
  ACESFilmicToneMapping, SRGBColorSpace, MathUtils,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { AU } from './core/constants.js';
import { BODIES } from './data/bodies.js';
import { SolarSystem } from './ephem/system.js';
import { rotationPeriodDays, axialTilt } from './ephem/rotation.js';
import { SATELLITE_PERIODS } from './ephem/satellites.js';
import { loadTextures, loadStreaming } from './render/textures.js';
import { SceneBuilder } from './render/scene.js';
import { Starfield } from './render/starfield.js';
import { AsteroidBelt, MeteorStreams } from './render/particleField.js';
import { CometVisuals } from './render/cometVisuals.js';
import { COMETS } from './ephem/comets.js';
import { updateFrameUniforms, setFallbackRingMap } from './render/bodyMaterial.js';
import { CameraRig } from './controls/cameraRig.js';
import { Clock } from './sim/clock.js';
import { solarEclipse, lunarEclipse, findEclipse } from './sim/eclipse.js';
import { Hud, NUMBER_KEYS } from './ui/hud.js';
import { Labels } from './ui/labels.js';
import { MobileLayout } from './ui/mobile.js';
import { TvControls, looksLikeTV } from './controls/tv.js';

/* ------------------------------------------------------------------ setup */

const canvas = document.getElementById('viewport');
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  // Scene coordinates span ten orders of magnitude; a linear depth buffer
  // z-fights hopelessly across that range.
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new Scene();
const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 1e-4, 1e10);

// EffectComposer allocates half-float targets by default, so materials can
// write linear HDR and OutputPass does tone mapping + sRGB once at the end.
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new Vector2(innerWidth, innerHeight),
  0.62, // strength
  0.55, // radius
  1.10, // threshold, in linear HDR — only the Sun clears it
);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

const system = new SolarSystem();
const clock = new Clock();
const rig = new CameraRig(camera, canvas);
const raycaster = new Raycaster();

let builder = null;
let starfield = null;
let belt = null;
let streams = null;
let cometFx = null;
let labels = null;
let hud = null;

/**
 * Particle budget for the belt. TV browsers and phones get a smaller field:
 * the cost is entirely vertex work, so it scales directly with the count.
 */
const quality = {
  beltCount: looksLikeTV() ? 9000
    : matchMedia('(pointer: coarse)').matches ? 14000
      : 40000,
  streamCount: looksLikeTV() ? 900
    : matchMedia('(pointer: coarse)').matches ? 1500
      : 3500,
};

const options = {
  orbits: true, labels: true, eclipse: true, bloom: true, stars: true, night: true,
  belt: true, streams: true, comets: true,
};

let exposure = 1;
let lastFrameTime = performance.now();
let hiresLoaded = false;
let schematicTarget = 0;
let lastFocusRadius = 0;
let lastFocusKey = null;
let tv = null;

/* ------------------------------------------------------------------- boot */

async function boot() {
  hud = new Hud(handlers);
  hud.setExaggeration(1);

  const textures = await loadTextures(renderer, (done, total, name) => {
    hud.setLoadProgress(done / total, `loading ${name}`);
  });

  hud.setLoadProgress(1, 'building system…');
  // Let the progress bar paint before the synchronous scene build.
  await new Promise((r) => setTimeout(r, 30));

  builder = new SceneBuilder(scene, textures);
  setFallbackRingMap(textures['saturn_ring.png']);
  starfield = new Starfield(scene, textures['stars_2k.jpg']);
  belt = new AsteroidBelt(scene, quality.beltCount);
  streams = new MeteorStreams(scene, quality.streamCount);
  cometFx = new CometVisuals(scene, Object.keys(COMETS));
  labels = new Labels(document.getElementById('label-layer'));
  labels.onSelect((key) => focusBody(key));

  system.update(clock.jd);
  builder._computeDisplay(system);
  focusBody('earth', false);

  // Open looking at a lit Earth: sit roughly sunward of it, swung off-axis so
  // the terminator is visible rather than staring at a flat full phase.
  const opening = new Vector3()
    .copy(builder.displayPos('sun'))
    .sub(builder.displayPos('earth'))
    .normalize()
    .applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(42));
  opening.y = 0.32;
  rig.setOrbitDirection(opening);

  hud.setFocus('earth');
  hud.setMode('orbit');
  hud.setSchematic(0);
  hud.buildRateLabels();

  tv = new TvControls({
    rig,
    hud,
    handlers,
    options,
    getState: () => ({
      clock,
      focusKey: rig.focusKey,
      schematicTarget,
      rateLabel: clock.paused ? 'paused' : clock.rateLabel,
    }),
  });
  if (looksLikeTV()) enableTvMode(true);

  new MobileLayout();

  bindGlobalInput();
  addEventListener('resize', onResize);
  onResize();

  hud.hideLoading();
  lastFrameTime = performance.now();
  renderer.setAnimationLoop(frame);
}

/* ------------------------------------------------------------------ input */

function bindGlobalInput() {
  let downAt = null;

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    // Treat it as a click only if the pointer barely moved — otherwise this
    // was a camera drag that happened to end over a planet.
    if (moved > 5 || held > 600) return;
    pickAt(e.clientX, e.clientY);
  });

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        handlers.onTogglePlay();
        break;
      case 'Comma': handlers.onNudgeRate(-1); break;
      case 'Period': handlers.onNudgeRate(1); break;
      case 'KeyN': handlers.onNow(); break;
      case 'KeyF': handlers.onMode(rig.mode === 'fly' ? 'orbit' : 'fly'); break;
      case 'KeyH': document.body.classList.toggle('ui-hidden'); break;
      case 'KeyT': enableTvMode(!tv.enabled); break;
      case 'Escape': handlers.onMode('orbit'); break;
      default: {
        const match = Object.entries(NUMBER_KEYS)
          .find(([, k]) => e.code === `Digit${k}`);
        if (match) focusBody(match[0]);
      }
    }
  });
}

const _ndc = new Vector2();

function pickAt(clientX, clientY) {
  _ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  const hits = raycaster.intersectObjects(builder.pickables(), false);
  if (hits.length) {
    const key = hits[0].object.userData.bodyKey;
    if (key) focusBody(key);
  }
}

/* --------------------------------------------------------------- handlers */

const _framing = new Vector3();
const _UP = new Vector3(0, 1, 0);

function focusBody(key, animate = true) {
  const entry = builder.bodies.get(key);
  if (!entry) return;

  /*
   * Approach a newly-focused body from its daylit side.
   *
   * The rig otherwise keeps whatever orbital angle it was already at, which is
   * as likely as not to be the unlit hemisphere. On a bright planet that still
   * leaves a readable crescent; on something as dark as a comet nucleus
   * (albedo ~0.04) the result is a body that renders as nothing at all. Offset
   * off the Sun-body axis so the terminator stays in view rather than
   * presenting a flat full phase.
   */
  if (key !== rig.focusKey && key !== 'sun') {
    _framing.copy(builder.displayPos('sun')).sub(builder.displayPos(key));
    if (_framing.lengthSq() > 1e-12) {
      _framing.normalize().applyAxisAngle(_UP, MathUtils.degToRad(38));
      _framing.y = 0.3;
      rig.setOrbitDirection(_framing);
    }
  }

  // After the angle, so focus() owns the fly-to transition.
  rig.focus(key, builder.displayPos(key), entry.drawRadius, animate);
  hud.setFocus(key);
  hud.setMode(rig.mode);
}

const handlers = {
  onFocus: (key) => focusBody(key),

  onTogglePlay: () => {
    clock.paused = !clock.paused;
    hud.updateClock(clock);
  },

  onNudgeRate: (dir) => {
    clock.nudgeStep(dir);
    clock.paused = false;
    hud.updateClock(clock);
  },

  onRateSlider: (v) => {
    clock.setStep(v);
    clock.paused = false;
    hud.updateClock(clock);
  },

  onReverse: () => {
    clock.direction *= -1;
    hud.updateClock(clock);
  },

  onNow: () => {
    clock.now();
    hud.updateClock(clock);
  },

  onMode: (mode) => {
    rig.setMode(mode, builder.displayPos(rig.focusKey));
    hud.setMode(rig.mode);
  },

  onExaggeration: (factor) => {
    builder.view.sizeExaggeration = factor;
    // Keep the camera outside the newly-inflated body.
    rig.focusRadius = builder.view.radius(
      builder.bodies.get(rig.focusKey).rEq,
      rig.focusKey === 'sun',
    );
  },

  /**
   * Schematic mode is animated rather than snapped: watching the orbits draw
   * in makes the relationship between the two scales legible in a way that an
   * instant swap does not.
   */
  onSchematic: (amount) => {
    schematicTarget = amount;
  },

  onOption: (name, value) => {
    options[name] = value;
    if (name === 'orbits') builder.setOrbitsVisible(value);
    if (name === 'labels') labels.setVisible(value);
    if (name === 'stars') starfield.setVisible(value);
    if (name === 'belt') belt.setVisible(value);
    if (name === 'streams') streams.setVisible(value);
    if (name === 'comets') cometFx.setVisible(value);
    if (name === 'bloom') bloomPass.enabled = value;
    if (name === 'night') {
      const m = builder.bodies.get('earth').material;
      if (m.uniforms.uNightStrength) m.uniforms.uNightStrength.value = value ? 1.4 : 0;
    }
    if (name === 'hires' && value) ensureHiRes();
  },

  onFindEclipse: (kind, direction) => {
    hud.setFindStatus('searching…');
    // Defer so the status text paints before the (synchronous) search.
    setTimeout(() => {
      const found = findEclipse(kind, clock.jd, direction);
      if (!found) {
        hud.setFindStatus(`No ${kind} eclipse found within 60 lunations.`);
        return;
      }
      clock.jd = found.jd;
      clock.paused = false;
      // Eclipses play out over a few hours; pick a rate that shows one in
      // roughly half a minute.
      clock.rate = kind === 'solar' ? 400 : 900;
      system.update(clock.jd);

      const info = found.info;
      const label = kind === 'solar'
        ? `${info.type} solar eclipse, magnitude ${info.magnitude.toFixed(2)}`
        : `${info.type} lunar eclipse, umbral magnitude ${info.umbralMagnitude.toFixed(2)}`;
      hud.setFindStatus(`Jumped to ${label}.`);
      hud.updateClock(clock);

      // Put the camera somewhere the event is actually visible.
      focusBody(kind === 'solar' ? 'earth' : 'moon');
    }, 16);
  },
};

/* --------------------------------------------------------------- hi-res */

const MB = (bytes) => (bytes / 1048576).toFixed(1);

async function ensureHiRes() {
  if (hiresLoaded) return;
  hiresLoaded = true;

  // Build the job list first so the UI can report "3 of 7" from the start.
  const jobs = [];
  for (const def of BODIES) {
    if (!def.hires) continue;
    for (const [slot, file] of Object.entries(def.hires)) {
      jobs.push({ file, apply: (tex) => applyHiRes(def.key, slot, tex) });
    }
  }
  jobs.push({ file: 'hi/stars.jpg', apply: (tex) => starfield.setTexture(tex) });

  let bytesDone = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const short = job.file.replace('hi/', '');
    let lastLoaded = 0;
    try {
      const tex = await loadStreaming(renderer, job.file, (loaded, total) => {
        lastLoaded = loaded;
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        hud.setHiresProgress(
          `${i + 1}/${jobs.length} ${short} — ${MB(bytesDone + loaded)} MB${total ? ` (${pct}%)` : ''}`,
          (i + (total ? loaded / total : 0)) / jobs.length,
        );
      });
      bytesDone += lastLoaded;
      job.apply(tex);
    } catch (err) {
      console.warn(`high-res map unavailable: ${job.file}`, err);
      hud.setHiresProgress(`${short} failed — keeping 2k map`, (i + 1) / jobs.length);
    }
  }
  hud.setHiresProgress('High-res maps loaded (8192 × 4096)', 1, true);
}

function applyHiRes(key, slot, tex) {
  const entry = builder.bodies.get(key);
  if (!entry) return;
  if (slot === 'map') entry.material.uniforms.uMap.value = tex;
  if (slot === 'nightMap') entry.material.uniforms.uNightMap.value = tex;
  if (slot === 'clouds' && entry.cloudMaterial) entry.cloudMaterial.uniforms.uMap.value = tex;
}

/**
 * TV mode also drops the render resolution: TV browser GPUs are roughly a
 * decade behind desktop, and a 4K panel would otherwise ask for 8.3M pixels.
 */
function enableTvMode(on) {
  tv.setEnabled(on);
  renderer.setPixelRatio(on ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 2));
  bloomPass.enabled = on ? false : options.bloom;
  onResize();
}

/* ---------------------------------------------------------------- helpers */

const _tmp = new Vector3();

/** Distance from a point to the nearest body surface, in displayed scene units. */
function nearestSurfaceDistance(p) {
  let best = Infinity;
  for (const entry of builder.bodies.values()) {
    const d = _tmp.copy(builder.displayPos(entry.key)).sub(p).length() - entry.drawRadius;
    if (d < best) best = d;
  }
  return Math.max(best, 1e-4);
}

function occluderProvider(key) {
  return builder.occluderData(key);
}

function poleProvider(key) {
  return builder.poleOf(key);
}

/**
 * Sunlight falloff, from where a body *really* is rather than where it is
 * drawn. In schematic mode the drawn orbits are compressed, and deriving
 * irradiance from them would over-light the inner planets by ~40x.
 */
function irradianceFor(key) {
  const d = system.sunDistance(key);
  return (AU * AU) / Math.max(d * d, 1e-6);
}

/**
 * Auto-exposure. Sunlight falls off as 1/r^2, so Neptune receives 1/900 of
 * Earth's illumination — physically correct and visually useless. We open the
 * "aperture" to compensate, exactly as a camera would, and dim the sky by the
 * same factor so the starfield stays a fixed reference brightness.
 */
function updateExposure(dt) {
  // Distance from the Sun of whatever we are looking at. The Sun itself sits at
  // the origin, so its own heliocentric distance is zero and would peg the
  // exposure wide open; there, the camera's distance is the meaningful one.
  const focusPos = system.pos(rig.focusKey);
  const lit = rig.focusKey === 'sun' ? rig.position.length() : focusPos.length();
  const dAU = Math.max(lit, AU * 0.2) / AU;
  // Full inverse-square compensation. The ceiling has to reach the outer
  // system: Pluto at 35 AU needs ~1200, and clamping at 60 left everything out
  // there ~20x underexposed — enough that a cometary nucleus, whose albedo is
  // genuinely about 0.04, fell to literal black.
  //
  // Raising it is safe for bloom: UnrealBloomPass runs on the linear HDR buffer
  // *before* OutputPass applies exposure, so the threshold is unaffected.
  const target = MathUtils.clamp(dAU * dAU, 0.15, 1600);
  const k = 1 - Math.exp(-dt * 1.6);
  exposure = Math.exp(Math.log(exposure) + (Math.log(target) - Math.log(exposure)) * k);
  renderer.toneMappingExposure = exposure;
  starfield.setBrightness(MathUtils.clamp(1.7 / exposure, 0.0005, 1.6));
}

let eclipseCheckAccum = 0;

function updateEclipseBanner(dt) {
  eclipseCheckAccum += dt;
  if (eclipseCheckAccum < 0.25) return;
  eclipseCheckAccum = 0;

  const solar = solarEclipse(system);
  if (solar.active) {
    hud.setEclipseBanner({
      kind: 'solar',
      title: `${solar.type.toUpperCase()} SOLAR ECLIPSE`,
      sub: `${(solar.obscuration * 100).toFixed(1)}% of the Sun covered at greatest eclipse`,
    });
    return;
  }

  const lunar = lunarEclipse(system);
  if (lunar.active) {
    const mag = lunar.type === 'penumbral' ? lunar.penumbralMagnitude : lunar.umbralMagnitude;
    hud.setEclipseBanner({
      kind: 'lunar',
      title: `${lunar.type.toUpperCase()} LUNAR ECLIPSE`,
      sub: `magnitude ${mag.toFixed(2)} — the Moon is inside Earth's shadow`,
    });
    return;
  }

  hud.setEclipseBanner(null);
}

let infoAccum = 0;

function updateInfoPanel(dt) {
  infoAccum += dt;
  if (infoAccum < 0.12) return;
  infoAccum = 0;

  const key = rig.focusKey;
  const entry = builder.bodies.get(key);
  hud.updateInfo({
    key,
    sunDistance: system.sunDistance(key),
    cameraDistance: rig.position.distanceTo(builder.displayPos(key)),
    rotationPeriod: rotationPeriodDays(key),
    orbitalPeriod: system.orbitalPeriod(key) ?? SATELLITE_PERIODS[key] ?? null,
    tilt: key === 'sun' ? null : axialTilt(key, system.jd),
  });
  hud.updateClock(clock);
}

function onResize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
}

/* ------------------------------------------------------------------ frame */

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  clock.advance(dt);
  system.update(clock.jd);

  // Ease between the realistic and schematic mappings.
  const view = builder.view;
  if (Math.abs(view.blend - schematicTarget) > 1e-4) {
    const k = 1 - Math.exp(-dt * 3.2);
    view.blend += (schematicTarget - view.blend) * k;
  } else {
    view.blend = schematicTarget;
  }

  // In schematic mode the Sun is drawn enormous relative to the orbits around
  // it, so the same bloom that reads as a pinpoint star at true scale turns
  // the inner system into a white smear. Back it off as the blend rises.
  bloomPass.strength = MathUtils.lerp(0.62, 0.16, view.blend);
  bloomPass.radius = MathUtils.lerp(0.55, 0.35, view.blend);
  bloomPass.threshold = MathUtils.lerp(1.10, 2.20, view.blend);

  // The displayed positions depend on the blend, so map them before the camera
  // reads the focus target.
  builder._computeDisplay(system);
  const focusEntry = builder.bodies.get(rig.focusKey);
  const focusRadius = view.radius(focusEntry.rEq, focusEntry.isStar);

  // When the *model* rescales, hold the framing steady instead of leaving the
  // camera buried inside a body that just grew forty times larger. Changing
  // which body we orbit is not a rescale — focus() has already framed that one.
  if (rig.focusKey === lastFocusKey && lastFocusRadius > 0
      && Math.abs(focusRadius - lastFocusRadius) > 1e-9) {
    const ratio = focusRadius / lastFocusRadius;
    rig.distance *= ratio;
    rig.targetDistance *= ratio;
  }
  lastFocusRadius = focusRadius;
  lastFocusKey = rig.focusKey;

  rig.update(dt, builder.displayPos(rig.focusKey), focusRadius, nearestSurfaceDistance);

  const altitudeInRadii = rig.position.distanceTo(builder.displayPos(rig.focusKey)) / focusRadius;
  builder.sync(system, rig.position, {
    showOrbits: options.orbits,
    altitudeInRadii,
  });

  updateFrameUniforms({
    sunPos: _sunRel.copy(builder.displayPos('sun')).sub(builder.origin),
    sunRadius: builder.drawRadius('sun'),
    eclipsesOn: options.eclipse,
    occludersFor: occluderProvider,
    poleFor: poleProvider,
    irradianceFor,
    ringShadow: builder.ringShadowData(),
  });

  tv.update(dt);
  tv.tick();

  updateExposure(dt);
  belt.update(clock.jd, builder.origin, view.blend, exposure);
  streams.update(clock.jd, builder.origin, view.blend, exposure);
  cometFx.update({
    displayPos: (k) => builder.displayPos(k).clone().sub(builder.origin),
    sunPos: _sunRel,
    trueDistanceAU: (k) => system.sunDistance(k) / AU,
    cameraQuaternion: camera.quaternion,
    exposure,
    // How much the view transform has compressed this comet's orbit; the coma
    // and tail follow the same compression so they stay proportionate.
    lengthScale: (k) => {
      const trueR = system.sunDistance(k);
      return trueR > 1e-6 ? builder.displayPos(k).length() / trueR : 1;
    },
  });
  updateEclipseBanner(dt);
  updateInfoPanel(dt);

  labels.update(camera, builder, rig.focusKey, { width: innerWidth, height: innerHeight });

  composer.render();
}

const _sunRel = new Vector3();

/* -------------------------------------------------------------------- go */

boot().catch((err) => {
  console.error(err);
  const note = document.getElementById('load-note');
  if (note) {
    note.textContent = `failed to start: ${err.message}`;
    note.style.color = '#ff7a5e';
  }
});

// Exposed for the high-res toggle, which is wired up lazily.
/**
 * Debug/automation handle.
 *
 * Used by the headless checks to drive the app without going through the UI —
 * jump the clock, focus a body, and read back internals such as the current
 * exposure or a comet's tail geometry. Not part of any public interface.
 */
window.__planetarium = {
  // state
  system,
  rig,
  builder: () => builder,
  scene: () => scene,
  camera: () => camera,
  cometFx: () => cometFx,
  exposure: () => exposure,
  // actions
  focus: (key) => focusBody(key, false),
  setJD: (jd) => { clock.jd = jd; system.update(jd); },
  ensureHiRes,
  // re-exported so test code can build vectors in the page context
  THREE: { Vector3 },
};
