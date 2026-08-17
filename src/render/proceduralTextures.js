/**
 * Equirectangular surface maps for the moons Solar System Scope does not
 * publish: Io, Europa, Ganymede, Callisto and Titan.
 *
 * These are plausible, not photographic — the point is that each body reads as
 * itself at a glance (Io's sulfur mottling, Europa's lineae, Callisto's
 * saturated cratering) rather than being a flat grey ball.
 *
 * Noise is sampled in 3D on the unit sphere so the map wraps seamlessly at the
 * date line and does not pinch at the poles.
 */

import { CanvasTexture, SRGBColorSpace, RepeatWrapping } from 'three';

const DEFAULT_W = 1024;

/** Map width by body; small moons get less, which keeps load time down. */
function sizeFor(width) {
  return { W: width, H: width / 2 };
}

/* ------------------------------------------------------------------- noise */

function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);

  let acc = 0;
  for (let dz = 0; dz < 2; dz++) {
    const wz = dz ? zf : 1 - zf;
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy ? yf : 1 - yf;
      for (let dx = 0; dx < 2; dx++) {
        const wx = dx ? xf : 1 - xf;
        acc += hash3(xi + dx, yi + dy, zi + dz) * wx * wy * wz;
      }
    }
  }
  return acc;
}

function fbm(x, y, z, octaves, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * f, y * f, z * f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise — produces filament- and crack-like features. */
function ridged(x, y, z, octaves, freq) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise3(x * f, y * f, z * f) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.55;
    f *= 2.1;
  }
  return sum / norm;
}

function mixRGB(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (t <= p1) return mixRGB(c0, c1, (t - p0) / Math.max(p1 - p0, 1e-6));
  }
  return stops[stops.length - 1][1];
}

/* ------------------------------------------------------------------ recipes */

const RECIPES = {
  io: (nx, ny, nz, lat) => {
    const base = fbm(nx * 3.1, ny * 3.1, nz * 3.1, 6);
    const patch = fbm(nx * 7.4 + 11, ny * 7.4, nz * 7.4, 4);
    // Volcanic dark spots, sparse and small.
    const spots = ridged(nx * 9 + 40, ny * 9, nz * 9, 3, 1.0);
    let t = base * 0.65 + patch * 0.35;
    // Poles are greyer, equator more sulfurous.
    t = t * (1 - 0.25 * Math.abs(lat) / (Math.PI / 2)) + 0.12;
    let c = ramp([
      [0.0, [92, 62, 30]],
      [0.35, [186, 140, 48]],
      [0.55, [232, 200, 92]],
      [0.75, [246, 232, 176]],
      [1.0, [252, 248, 230]],
    ], t);
    if (spots > 0.86) {
      const k = (spots - 0.86) / 0.14;
      c = mixRGB(c, [38, 26, 18], Math.min(1, k * 1.4));
    }
    return c;
  },

  europa: (nx, ny, nz) => {
    const base = fbm(nx * 4.2, ny * 4.2, nz * 4.2, 5);
    // Lineae: long ridged filaments, two overlapping families.
    const l1 = ridged(nx + 3, ny * 1.4 + 3, nz + 3, 4, 2.4);
    const l2 = ridged(nx * 1.7 - 8, ny - 8, nz * 1.2 - 8, 3, 3.9);
    const cracks = Math.max(l1, l2 * 0.85);
    let c = ramp([
      [0.0, [176, 168, 152]],
      [0.5, [222, 216, 204]],
      [1.0, [246, 244, 238]],
    ], base * 0.6 + 0.4);
    if (cracks > 0.62) {
      const k = Math.min(1, (cracks - 0.62) / 0.28);
      c = mixRGB(c, [138, 88, 62], k * 0.75);
    }
    return c;
  },

  ganymede: (nx, ny, nz) => {
    const dark = fbm(nx * 2.4, ny * 2.4, nz * 2.4, 5);
    const grooves = ridged(nx * 2.0 + 21, ny * 2.0, nz * 2.0, 4, 3.2);
    const fine = fbm(nx * 14, ny * 14, nz * 14, 3);
    // Ancient dark terrain vs younger bright grooved terrain.
    let t = dark < 0.47 ? 0.22 + fine * 0.18 : 0.55 + fine * 0.2;
    if (grooves > 0.66 && dark >= 0.47) t += 0.18;
    return ramp([
      [0.0, [54, 48, 44]],
      [0.35, [104, 96, 88]],
      [0.65, [152, 145, 136]],
      [1.0, [198, 192, 184]],
    ], t);
  },

  callisto: (nx, ny, nz) => {
    const base = fbm(nx * 3.6, ny * 3.6, nz * 3.6, 6);
    const fine = fbm(nx * 18, ny * 18, nz * 18, 3);
    const t = base * 0.55 + fine * 0.3;
    return ramp([
      [0.0, [34, 28, 24]],
      [0.4, [72, 62, 54]],
      [0.7, [110, 98, 88]],
      [1.0, [162, 152, 142]],
    ], t);
  },

  titan: (nx, ny, nz, lat) => {
    const haze = fbm(nx * 2.2, ny * 2.2, nz * 2.2, 5);
    const dunes = fbm(nx * 6 + 17, ny * 9, nz * 6, 4);
    const equator = Math.exp(-((lat / 0.42) ** 2)); // dune fields hug the equator
    let t = 0.55 + haze * 0.3;
    t -= equator * dunes * 0.32;
    return ramp([
      [0.0, [96, 54, 20]],
      [0.4, [168, 108, 40]],
      [0.7, [214, 158, 74]],
      [1.0, [238, 200, 132]],
    ], t);
  },
};


/* --------------------------------------------- generic small-body recipes */

/**
 * Most mid-size icy and rocky moons differ mainly in albedo, contrast and how
 * heavily cratered they are, so one parameterised recipe covers them and the
 * genuinely distinctive ones get their own entry below.
 */
function generic({ stops, freq = 3.2, bias = 0.1, gain = 0.55, ridge = 0 }) {
  return (nx, ny, nz) => {
    const base = fbm(nx * freq, ny * freq, nz * freq, 5);
    const fine = fbm(nx * 15, ny * 15, nz * 15, 3);
    let t = base * gain + fine * 0.28 + bias;
    if (ridge) {
      const r = ridged(nx * 2.4 + 5, ny * 2.4, nz * 2.4, 3, 2.6);
      if (r > 0.66) t += (r - 0.66) * ridge;
    }
    return ramp(stops, t);
  };
}

const GREY_ICE = [[0, [96, 96, 100]], [0.4, [150, 150, 154]],
  [0.7, [196, 196, 199]], [1, [232, 233, 236]]];
const DARK_ROCK = [[0, [38, 34, 30]], [0.45, [78, 72, 65]],
  [0.75, [116, 108, 98]], [1, [152, 143, 132]]];

Object.assign(RECIPES, {
  phobos: generic({ stops: DARK_ROCK, freq: 4.5, bias: 0.02 }),
  deimos: generic({ stops: DARK_ROCK, freq: 5.0, bias: 0.12 }),

  mimas: generic({ stops: GREY_ICE, freq: 3.6, bias: 0.22 }),
  tethys: generic({ stops: GREY_ICE, freq: 3.0, bias: 0.3, ridge: 0.5 }),
  dione: generic({ stops: GREY_ICE, freq: 3.0, bias: 0.26, ridge: 0.7 }),
  rhea: generic({ stops: GREY_ICE, freq: 3.4, bias: 0.24 }),

  miranda: generic({ stops: GREY_ICE, freq: 4.2, bias: 0.14, ridge: 1.1 }),
  ariel: generic({ stops: GREY_ICE, freq: 3.0, bias: 0.24, ridge: 0.9 }),
  umbriel: generic({ stops: [[0, [52, 52, 56]], [0.5, [88, 88, 92]],
    [1, [124, 124, 128]]], freq: 3.4, bias: 0.2 }),
  titania: generic({ stops: [[0, [86, 78, 72]], [0.45, [140, 130, 122]],
    [1, [196, 186, 176]]], freq: 3.2, bias: 0.2, ridge: 0.8 }),
  oberon: generic({ stops: [[0, [76, 68, 62]], [0.45, [128, 118, 108]],
    [1, [180, 168, 156]]], freq: 3.4, bias: 0.18 }),

  /** Enceladus: near-perfect albedo, with the south-polar tiger stripes. */
  enceladus: (nx, ny, nz, lat) => {
    const base = fbm(nx * 3.4, ny * 3.4, nz * 3.4, 5);
    let c = ramp([[0, [206, 212, 218]], [0.5, [234, 238, 242]],
      [1, [252, 253, 255]]], base * 0.4 + 0.55);
    // Fractures are confined to the south polar terrain.
    const south = Math.exp(-(((lat + 1.15) / 0.42) ** 2));
    if (south > 0.05) {
      const stripes = ridged(nx * 5 + 30, ny * 2.2, nz * 5, 2, 3.4);
      if (stripes > 0.72) c = mixRGB(c, [128, 150, 170], south * (stripes - 0.72) * 3.2);
    }
    return c;
  },

  /**
   * Iapetus: the two-tone moon. Its leading hemisphere is coated in dark
   * material and the trailing side is bright ice — a nearly 10:1 albedo split
   * that is the single most recognisable thing about it. Tidal locking puts the
   * prime meridian at Saturn, so the leading side is centred 90 degrees away.
   */
  iapetus: (nx, ny, nz) => {
    const base = fbm(nx * 3.6, ny * 3.6, nz * 3.6, 5);
    const bright = ramp([[0, [140, 136, 128]], [0.5, [196, 192, 184]],
      [1, [234, 232, 226]]], base * 0.6 + 0.3);
    const dark = ramp([[0, [26, 20, 15]], [0.5, [58, 44, 32]],
      [1, [92, 74, 56]]], base * 0.6 + 0.2);
    // ny is the leading-hemisphere axis; the boundary is famously sharp.
    const blend = smooth(Math.min(1, Math.max(0, (ny + 0.25) / 0.5)));
    return mixRGB(bright, dark, blend);
  },

  /** Triton: pinkish nitrogen frost over cantaloupe terrain, bright south cap. */
  triton: (nx, ny, nz, lat) => {
    const cells = ridged(nx * 5.5, ny * 5.5, nz * 5.5, 3, 1.6);
    const base = fbm(nx * 2.6, ny * 2.6, nz * 2.6, 4);
    let t = base * 0.5 + cells * 0.32 + 0.2;
    // Southern polar cap of fresh nitrogen ice.
    const cap = Math.exp(-(((lat + 1.2) / 0.75) ** 2));
    t += cap * 0.3;
    return ramp([[0, [150, 118, 104]], [0.45, [198, 168, 152]],
      [0.75, [226, 206, 192]], [1, [244, 236, 230]]], t);
  },
});

/** Impact craters, drawn after the base map. */
const CRATER_COUNTS = {
  callisto: 900, ganymede: 320, io: 0, europa: 40, titan: 0,
  phobos: 260, deimos: 140,
  mimas: 420, enceladus: 60, tethys: 380, dione: 340, rhea: 520, iapetus: 460,
  miranda: 300, ariel: 220, umbriel: 500, titania: 300, oberon: 420,
  triton: 40,
};

function drawCraters(ctx, kind, seed, W, H) {
  const count = CRATER_COUNTS[kind] ?? 0;
  if (!count) return;

  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    // Uniform on the sphere, then projected — otherwise craters bunch at the poles.
    const lat = Math.asin(rnd() * 2 - 1);
    const lon = rnd() * Math.PI * 2;
    const x = (lon / (Math.PI * 2)) * W;
    const y = (0.5 - lat / Math.PI) * H;

    const big = rnd() < 0.06;
    const r = (big ? 6 + rnd() * 22 : 1.5 + rnd() * 5);
    const stretch = 1 / Math.max(Math.cos(lat), 0.12);
    const bright = kind === 'callisto' ? 210 : 190;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.min(stretch, 9), 1);

    // Bright ejecta rim
    const g = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, `rgba(${bright},${bright - 8},${bright - 18},0.30)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Shadowed floor
    const f = ctx.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r * 0.7);
    f.addColorStop(0, 'rgba(20,16,14,0.30)');
    f.addColorStop(1, 'rgba(20,16,14,0)');
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const cache = new Map();

/** Build (and memoise) the equirectangular map for a procedural moon. */
export function proceduralTexture(kind, width = DEFAULT_W) {
  const cacheKey = `${kind}@${width}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const recipe = RECIPES[kind];
  if (!recipe) throw new Error(`no procedural recipe for "${kind}"`);

  const { W, H } = sizeFor(width);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let j = 0; j < H; j++) {
    const lat = (0.5 - j / H) * Math.PI; // +pi/2 .. -pi/2
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const nx = cl * Math.cos(lon);
      const ny = cl * Math.sin(lon);
      const nz = sl;

      const c = recipe(nx, ny, nz, lat);
      const o = (j * W + i) * 4;
      data[o] = Math.max(0, Math.min(255, c[0] | 0));
      data[o + 1] = Math.max(0, Math.min(255, c[1] | 0));
      data[o + 2] = Math.max(0, Math.min(255, c[2] | 0));
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  drawCraters(ctx, kind, 0x9e3779b9, W, H);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(cacheKey, tex);
  return tex;
}
