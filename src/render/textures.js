/**
 * Texture loading.
 *
 * Colour maps are sRGB; normal and mask maps are raw data and must stay linear
 * or the lighting goes subtly wrong. The 8k variants are never fetched up
 * front — that would be ~47 MB before the first frame — and are pulled in on
 * demand by the high-res toggle.
 */

import {
  TextureLoader, Texture, SRGBColorSpace, LinearSRGBColorSpace,
  RepeatWrapping, ClampToEdgeWrapping,
} from 'three';
import { BODIES } from '../data/bodies.js';

// Resolved against Vite's base URL so the app works both at a domain root and
// at a project subpath such as /planetarium/ on GitHub Pages.
const BASE = `${import.meta.env.BASE_URL}textures/`; // Vite guarantees a trailing slash

/** Maps that must not be colour-converted. */
const DATA_MAPS = new Set(['earth_normal.jpg', 'earth_spec.jpg']);

export function collectTextureNames() {
  const names = new Set(['stars_2k.jpg']);
  for (const b of BODIES) {
    if (b.map) names.add(b.map);
    if (b.nightMap) names.add(b.nightMap);
    if (b.normalMap) names.add(b.normalMap);
    if (b.specularMap) names.add(b.specularMap);
    if (b.clouds) names.add(b.clouds.map);
    if (b.rings) names.add(b.rings.map);
  }
  return [...names];
}

function configure(tex, name, renderer) {
  if (DATA_MAPS.has(name)) {
    tex.colorSpace = LinearSRGBColorSpace;
  } else {
    tex.colorSpace = SRGBColorSpace;
  }
  // Equirectangular maps wrap in longitude and clamp in latitude; the ring
  // strip must clamp on both axes or its edges bleed.
  const isRing = name.includes('ring');
  tex.wrapS = isRing ? ClampToEdgeWrapping : RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = renderer ? Math.min(16, renderer.capabilities.getMaxAnisotropy()) : 8;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {(loaded:number, total:number, name:string)=>void} onProgress
 * @returns {Promise<Record<string, import('three').Texture>>}
 */
export function loadTextures(renderer, onProgress) {
  const loader = new TextureLoader();
  const names = collectTextureNames();
  const out = {};
  let done = 0;

  return Promise.all(names.map((name) => new Promise((resolve) => {
    loader.load(
      BASE + name,
      (tex) => {
        out[name] = configure(tex, name, renderer);
        onProgress?.(++done, names.length, name);
        resolve();
      },
      undefined,
      () => {
        // A missing texture should degrade the look, not break the app.
        console.warn(`texture failed to load: ${name}`);
        onProgress?.(++done, names.length, name);
        resolve();
      },
    );
  }))).then(() => out);
}

/** Fetch one high-resolution replacement map on demand. */
export function loadOne(renderer, name) {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(
      BASE + name,
      (tex) => resolve(configure(tex, name, renderer)),
      undefined,
      reject,
    );
  });
}

/**
 * Fetch a texture while reporting byte-level progress.
 *
 * TextureLoader goes through an <img> element, which gives no usable progress
 * events, so the high-res maps (5-15 MB each) would otherwise download in
 * complete silence. Streaming the response ourselves and decoding with
 * createImageBitmap lets the UI show what is actually happening — and decodes
 * off the main thread, so the frame loop keeps running.
 *
 * @param {(loaded:number, total:number)=>void} onBytes total is 0 when unknown
 */
export async function loadStreaming(renderer, name, onBytes) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${res.status} ${name}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();

  let blob;
  if (!reader) {
    blob = await res.blob(); // no streaming support; fall back silently
    onBytes?.(total, total);
  } else {
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onBytes?.(loaded, total);
    }
    blob = new Blob(chunks);
  }

  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const tex = new Texture(bitmap);
  tex.flipY = false; // already handled by imageOrientation
  return configure(tex, name, renderer);
}
