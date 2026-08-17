/**
 * Physical catalogue. Radii are IAU/NASA fact-sheet values in km; `polar` is
 * given only where the flattening is visible at these scales (the gas giants
 * are noticeably oblate, the terrestrials are not).
 *
 * `ephem` selects how the position is produced each frame:
 *   'sun'        fixed at the origin (we ignore the Sun's barycentric wobble)
 *   'planet'     Standish Keplerian elements
 *   'earth'      EMB minus the Moon's barycentre offset
 *   'moon'       EMB plus the Moon's barycentre offset
 *   'galilean'   Meeus ch. 44
 *   'kepler'     Keplerian in the parent's equatorial plane (approximate phase)
 *
 * `tidal: true` marks a synchronous rotator with no IAU rotation entry; its
 * orientation is derived so the same hemisphere always faces its planet.
 */

export const BODIES = [
  {
    key: 'sun', name: 'Sun', kind: 'star', ephem: 'sun', parent: null,
    radius: 696000, color: 0xffd27a,
    map: 'sun.jpg',
    emissive: true,
    description: 'G2V main-sequence star. Everything here orbits it.',
  },
  {
    key: 'mercury', name: 'Mercury', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 2439.7, color: 0xa8a29a,
    map: 'mercury.jpg', bumpScale: 0.012, roughness: 0.95,
  },
  {
    key: 'venus', name: 'Venus', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 6051.8, color: 0xe8c88a,
    map: 'venus_atmosphere.jpg', roughness: 0.7,
    atmosphere: { color: 0xffe6b0, thickness: 0.020, strength: 1.5 },
  },
  {
    key: 'earth', name: 'Earth', kind: 'planet', ephem: 'earth', parent: 'sun',
    radius: 6378.137, polar: 6356.752, color: 0x4f80c0,
    map: 'earth_day.jpg',
    nightMap: 'earth_night.jpg',
    normalMap: 'earth_normal.jpg', normalScale: 0.55,
    specularMap: 'earth_spec.jpg', // white = ocean in this map
    clouds: { map: 'earth_clouds.jpg', altitude: 0.0025, speed: 0.6 },
    atmosphere: { color: 0x6ba7ff, thickness: 0.025, strength: 2.2 },
    hires: { map: 'hi/earth_day.jpg', nightMap: 'hi/earth_night.jpg', clouds: 'hi/earth_clouds.jpg' },
    roughness: 0.85,
  },
  {
    key: 'moon', name: 'Moon', kind: 'moon', ephem: 'moon', parent: 'earth',
    radius: 1737.4, color: 0xbdb9b2,
    map: 'moon.jpg', bumpScale: 0.02, roughness: 1.0,
    hires: { map: 'hi/moon.jpg' },
  },
  {
    key: 'mars', name: 'Mars', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 3396.2, polar: 3376.2, color: 0xc1613a,
    map: 'mars.jpg', bumpScale: 0.015, roughness: 0.95,
    atmosphere: { color: 0xd8a07a, thickness: 0.012, strength: 0.7 },
    hires: { map: 'hi/mars.jpg' },
  },
  {
    key: 'phobos', name: 'Phobos', kind: 'moon', ephem: 'kepler', parent: 'mars',
    radius: 11.267, color: 0x8a7f74, procedural: 'phobos', roughness: 1.0, tidal: true,
  },
  {
    key: 'deimos', name: 'Deimos', kind: 'moon', ephem: 'kepler', parent: 'mars',
    radius: 6.2, color: 0x9a8e82, procedural: 'deimos', roughness: 1.0, tidal: true,
  },
  {
    key: 'jupiter', name: 'Jupiter', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 71492, polar: 66854, color: 0xd8b48a,
    map: 'jupiter.jpg', roughness: 0.75,
    atmosphere: { color: 0xf0d8b8, thickness: 0.012, strength: 1.0 },
    hires: { map: 'hi/jupiter.jpg' },
  },
  {
    key: 'io', name: 'Io', kind: 'moon', ephem: 'galilean', parent: 'jupiter',
    radius: 1821.6, color: 0xe8d070, procedural: 'io', roughness: 0.95,
  },
  {
    key: 'europa', name: 'Europa', kind: 'moon', ephem: 'galilean', parent: 'jupiter',
    radius: 1560.8, color: 0xd8cbb0, procedural: 'europa', roughness: 0.6,
  },
  {
    key: 'ganymede', name: 'Ganymede', kind: 'moon', ephem: 'galilean', parent: 'jupiter',
    radius: 2634.1, color: 0x9a8f80, procedural: 'ganymede', roughness: 0.95,
  },
  {
    key: 'callisto', name: 'Callisto', kind: 'moon', ephem: 'galilean', parent: 'jupiter',
    radius: 2410.3, color: 0x6e6155, procedural: 'callisto', roughness: 1.0,
  },
  {
    key: 'saturn', name: 'Saturn', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 60268, polar: 54364, color: 0xe0c896,
    map: 'saturn.jpg', roughness: 0.8,
    atmosphere: { color: 0xf2e0b8, thickness: 0.012, strength: 0.9 },
    // C ring inner edge to just past the F ring
    rings: { map: 'saturn_ring.png', inner: 74500, outer: 140220 },
  },
  {
    key: 'mimas', name: 'Mimas', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 198.2, color: 0xc9c6c0, procedural: 'mimas', roughness: 1.0, tidal: true,
  },
  {
    key: 'enceladus', name: 'Enceladus', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 252.1, color: 0xf2f4f5, procedural: 'enceladus', roughness: 0.55, tidal: true,
  },
  {
    key: 'tethys', name: 'Tethys', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 531.1, color: 0xd8d6d0, procedural: 'tethys', roughness: 0.9, tidal: true,
  },
  {
    key: 'dione', name: 'Dione', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 561.4, color: 0xd0cec8, procedural: 'dione', roughness: 0.9, tidal: true,
  },
  {
    key: 'rhea', name: 'Rhea', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 763.8, color: 0xcbc8c2, procedural: 'rhea', roughness: 0.95, tidal: true,
  },
  {
    key: 'titan', name: 'Titan', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 2574.7, color: 0xd89b46, procedural: 'titan', roughness: 0.9, tidal: true,
    atmosphere: { color: 0xe8a860, thickness: 0.08, strength: 1.6 },
  },
  {
    key: 'iapetus', name: 'Iapetus', kind: 'moon', ephem: 'kepler', parent: 'saturn',
    radius: 734.5, color: 0x9a8b74, procedural: 'iapetus', roughness: 0.95, tidal: true,
  },
  {
    key: 'uranus', name: 'Uranus', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 25559, polar: 24973, color: 0x9fd8e0,
    map: 'uranus.jpg', roughness: 0.7,
    atmosphere: { color: 0xa8e4ec, thickness: 0.02, strength: 1.2 },
  },
  {
    key: 'miranda', name: 'Miranda', kind: 'moon', ephem: 'kepler', parent: 'uranus',
    radius: 235.8, color: 0xb8b8ba, procedural: 'miranda', roughness: 1.0, tidal: true,
  },
  {
    key: 'ariel', name: 'Ariel', kind: 'moon', ephem: 'kepler', parent: 'uranus',
    radius: 578.9, color: 0xc6c6c6, procedural: 'ariel', roughness: 0.9, tidal: true,
  },
  {
    key: 'umbriel', name: 'Umbriel', kind: 'moon', ephem: 'kepler', parent: 'uranus',
    radius: 584.7, color: 0x7d7d80, procedural: 'umbriel', roughness: 1.0, tidal: true,
  },
  {
    key: 'titania', name: 'Titania', kind: 'moon', ephem: 'kepler', parent: 'uranus',
    radius: 788.4, color: 0xbdb4ac, procedural: 'titania', roughness: 0.95, tidal: true,
  },
  {
    key: 'oberon', name: 'Oberon', kind: 'moon', ephem: 'kepler', parent: 'uranus',
    radius: 761.4, color: 0xb0a498, procedural: 'oberon', roughness: 0.95, tidal: true,
  },
  {
    key: 'neptune', name: 'Neptune', kind: 'planet', ephem: 'planet', parent: 'sun',
    radius: 24764, polar: 24341, color: 0x4a6fd0,
    map: 'neptune.jpg', roughness: 0.7,
    atmosphere: { color: 0x6f92e8, thickness: 0.02, strength: 1.3 },
  },
  {
    key: 'triton', name: 'Triton', kind: 'moon', ephem: 'kepler', parent: 'neptune',
    radius: 1353.4, color: 0xd6c3b4, procedural: 'triton', roughness: 0.7, tidal: true,
    atmosphere: { color: 0xbcd4e8, thickness: 0.012, strength: 0.35 },
  },
];

export const BY_KEY = Object.fromEntries(BODIES.map((b) => [b.key, b]));

/**
 * Bodies that can plausibly cast an eclipse shadow on a given body.
 *
 * A planet is only ever shadowed by its own moons. A moon is shadowed by its
 * planet (lunar eclipses, and the reason Jupiter's moons wink out) and by its
 * sibling moons (mutual events). Other *planets* are never occluders: they
 * subtend arcseconds and are never between anything and the Sun in a way that
 * matters.
 */
export function occludersFor(key) {
  const body = BY_KEY[key];
  if (!body || body.kind === 'star') return [];

  const out = [];
  if (body.kind === 'moon' && body.parent) out.push(body.parent);

  for (const b of BODIES) {
    if (b.key === key || b.kind === 'star') continue;
    if (b.parent === key) out.push(b.key); // this body's own moons
    else if (body.kind === 'moon' && b.parent === body.parent) out.push(b.key); // siblings
  }
  return out;
}
