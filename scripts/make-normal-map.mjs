/**
 * Convert a LOLA lunar elevation model (32-bit float GeoTIFF, metres) into a
 * tangent-space normal map.
 *
 * The source is equirectangular, so the ground distance spanned by one pixel of
 * longitude shrinks as cos(latitude). Ignoring that would make slopes blow up
 * toward the poles and leave the map visibly smeared there, so the horizontal
 * gradient is scaled per row.
 *
 * Tangent-space convention matches the renderer's analytic frame:
 *   +X = east (increasing u), +Y = north (increasing v), +Z = up.
 */

import { readFileSync, writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { readIFD } from './read-tiff.mjs';

const MOON_RADIUS_M = 1737400;
/** LOLA ships these DEMs in kilometres, not metres. */
const DEM_UNITS_TO_M = 1000;

/* ------------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePNG(path, width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * 3);
    raw[o] = 0; // filter: none
    rgb.copy(raw, o + 1, y * width * 3, (y + 1) * width * 3);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 8 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ------------------------------------------------------------------ main */

const [src, dst, outWStr] = process.argv.slice(2);
const buf = readFileSync(src);
const ifd = readIFD(buf);
const { width: W, height: H } = ifd;
if (ifd.compression !== 1 || ifd.bitsPerSample !== 32 || ifd.sampleFormat !== 3) {
  throw new Error('expected uncompressed 32-bit float TIFF');
}

// Strips are one row each in these files, but do not assume it.
const rowsPerStrip = ifd.rowsPerStrip || H;
const height = new Float32Array(W * H);
for (let s = 0; s < ifd.stripOffsets.length; s++) {
  const off = ifd.stripOffsets[s];
  const rows = Math.min(rowsPerStrip, H - s * rowsPerStrip);
  for (let i = 0; i < rows * W; i++) {
    height[s * rowsPerStrip * W + i] = buf.readFloatLE(off + i * 4) * DEM_UNITS_TO_M;
  }
}

let lo = Infinity;
let hi = -Infinity;
for (let i = 0; i < height.length; i++) {
  const v = height[i];
  if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
}
console.log(`source ${W}x${H}, elevation ${(lo / 1000).toFixed(2)} .. ${(hi / 1000).toFixed(2)} km`);

const outW = outWStr ? +outWStr : W;
const outH = outW / 2;
const step = W / outW;

const dLat = (Math.PI * MOON_RADIUS_M) / H;   // metres per pixel row
const rgb = Buffer.alloc(outW * outH * 3);

// Sample the source with a box average when downscaling, so the gradient is
// taken from a properly band-limited surface rather than from aliased points.
const sample = (x, y) => {
  const x0 = Math.floor(x * step);
  const y0 = Math.min(H - 1, Math.max(0, Math.floor(y * step)));
  const n = Math.max(1, Math.round(step));
  let sum = 0;
  let count = 0;
  for (let j = 0; j < n; j++) {
    const yy = Math.min(H - 1, y0 + j);
    for (let i = 0; i < n; i++) {
      const xx = (x0 + i) % W;
      const v = height[yy * W + xx];
      if (Number.isFinite(v)) { sum += v; count++; }
    }
  }
  return count ? sum / count : 0;
};

for (let y = 0; y < outH; y++) {
  // Row centre latitude: +90 at the top row, -90 at the bottom.
  const lat = (0.5 - (y + 0.5) / outH) * Math.PI;
  // Guard the poles: cos(lat) -> 0 sends the longitudinal gradient to infinity.
  const cosLat = Math.max(Math.cos(lat), 0.02);
  const dLon = (2 * Math.PI * MOON_RADIUS_M * cosLat) / outW;

  for (let x = 0; x < outW; x++) {
    const xl = (x - 1 + outW) % outW;
    const xr = (x + 1) % outW;
    const yu = Math.max(0, y - 1);
    const yd = Math.min(outH - 1, y + 1);

    // Central differences, in metres of rise per metre of run.
    const dhdx = (sample(xr, y) - sample(xl, y)) / (2 * dLon);
    // +v is north, and y increases southward, so negate.
    const dhdy = -(sample(x, yd) - sample(x, yu)) / (2 * dLat);

    let nx = -dhdx;
    let ny = -dhdy;
    let nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;

    // Fade to flat across the polar caps, where the projection degenerates and
    // the source data is least reliable.
    const polar = Math.min(1, (Math.abs(lat) - 1.3963) / 0.1745); // 80 deg -> 90
    if (polar > 0) {
      const k = 1 - polar;
      nx *= k; ny *= k;
      const l2 = Math.hypot(nx, ny, 1);
      nx /= l2; ny /= l2; nz = 1 / l2;
    }

    const o = (y * outW + x) * 3;
    rgb[o] = Math.round((nx * 0.5 + 0.5) * 255);
    rgb[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    rgb[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
  }
}

// Sanity statistics: a plausible planetary normal map is mostly near-flat
// with a tail of real slope, and must average to roughly straight up.
let sr = 0, sg = 0, sb = 0, steep = 0;
for (let i = 0; i < rgb.length; i += 3) {
  sr += rgb[i]; sg += rgb[i + 1]; sb += rgb[i + 2];
  const nx = (rgb[i] / 255) * 2 - 1;
  const ny = (rgb[i + 1] / 255) * 2 - 1;
  if (Math.hypot(nx, ny) > 0.17) steep++; // >~10 degrees
}
const n = rgb.length / 3;
console.log(`mean RGB ${(sr/n).toFixed(1)} ${(sg/n).toFixed(1)} ${(sb/n).toFixed(1)}  (flat = 127.5 127.5 255)`);
console.log(`pixels steeper than 10 deg: ${(100*steep/n).toFixed(1)}%`);

writePNG(dst, outW, outH, rgb);
console.log(`wrote ${dst} at ${outW}x${outH}`);
