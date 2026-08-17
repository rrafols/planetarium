# Planetarium

A real-time solar system in the browser, built with [three.js](https://threejs.org).

Positions come from real orbital theory rather than decorative circles, so the
planets are where they actually were (or will be) on any given date, and
eclipses happen on their real dates with correct geometry. Ask it for the next
solar eclipse from August 2026 and it takes you to **6 February 2027,
annular** — which is exactly right.

<!-- Add a screenshot here once you have one you like:
     ![Planetarium](docs/screenshot.png) -->

---

## Running it

```bash
npm install
npm run dev
```

Then open the URL Vite prints. `npm run build` produces a static `dist/` you can
host anywhere — it is entirely client-side, with no backend.

The repository ships the 2048×1024 texture set (~8 MB). The optional
8192×4096 maps (~49 MB) are not committed; fetch them with:

```bash
./scripts/fetch-textures.sh
```

Without them the app runs fine — the **High-res maps** toggle simply keeps the
2k maps and logs a warning.

---

## What is actually simulated

| Element | Source |
| --- | --- |
| Planet positions | JPL/Standish Keplerian elements with secular rates (1800–2050 set) |
| The Moon | Meeus *Astronomical Algorithms* ch. 47 — truncated ELP-2000/82, 60 + 60 periodic terms, ~10″ accuracy |
| Galilean moons | Meeus ch. 44, low-accuracy method |
| 15 other moons | Keplerian in the parent's equatorial plane; measured a, e, i and period, approximate epoch phase |
| Earth's rotation | Driven by UT1 via a Delta-T model, not TT — see below |
| Axial tilts & rotation | IAU/IAG Working Group rotational elements (Archinal et al. 2015) |
| Earth/Moon split | Both bodies orbit their common barycentre, not each other |
| Frame | J2000 mean ecliptic throughout; the lunar series is precessed back from equinox-of-date so it stays consistent |

**29 bodies**: the Sun, eight planets and twenty moons — our Moon, the four
Galileans, Phobos and Deimos, seven of Saturn's (Mimas, Enceladus, Tethys,
Dione, Rhea, Titan, Iapetus), the five major Uranian moons, and Triton, whose
157° inclination makes it orbit backwards.

Sidereal rotation periods, oblateness of the gas giants, retrograde spin of
Venus and Uranus, tidal locking of the moons, and the inclination of each moon
system to its planet's equator are all modelled. Because positions are *analytic
functions of Julian date* rather than an integration, there is no drift and no
stability limit: jumping a century costs exactly as much as advancing a second,
which is what lets the eclipse finder teleport across years.

### Eclipses

Shadow maps cannot do this. The Moon is 3,474 km across casting onto an Earth
384,400 km away; a cube shadow map covering the Sun-to-Neptune volume has texels
thousands of km wide, and a binary shadow test cannot produce a penumbra at all.

So the shader solves the geometry instead. From each fragment, the Sun is a disc
of known angular radius and each occluder is another disc; the fraction of the
Sun covered is the **overlap area of two circles**, which has a closed form. That
gives umbra, penumbra and annularity for free, exactly, at any zoom level, for a
few instructions per occluder.

The same idea drives the terminator: the Sun is integrated as a finite disc
rather than a point, so day fades into night across a band the width of the
Sun's apparent diameter instead of a hard line.

Consequences you can go and look at:

- Total, annular and partial solar eclipses, with a real penumbra
- The Moon reddening as it enters Earth's umbra (with the standard 1/50
  atmospheric enlargement applied to the shadow)
- Io, Europa, Ganymede and Callisto throwing shadow transits across Jupiter
- Saturn's rings shadowing the planet, and the planet shadowing the rings
- City lights coming up inside the umbra during a total solar eclipse

The **Eclipse finder** walks lunation by lunation — eclipses can only occur at
syzygy — locating each new or full moon and testing whether the shadow connects.

**Does the shadow land in the right place?** Its *size* is exact, being pure
geometry from the true radii and distances. Its *position on the map* is good to
a few tens of km, limited by the ~10″ truncation of the lunar series. Getting
that far requires driving Earth's spin from UT1 rather than TT: the IAU
rotational elements are tabulated against TDB, and using them directly leaves
the geography rotated by Delta-T — currently ~69 s, or 0.29° of longitude, about
32 km at the equator, which is a serious fraction of a 100-270 km umbra. See
`src/core/deltat.js`.

---

## Scale: realistic vs schematic

The solar system is mostly empty. At true scale Earth is about 1/12,000 of the
way across its own orbit, so any view wide enough to show the system shows
nothing but dots.

**Realistic** is the default and everything is honest: distances, radii and
eclipse geometry are all exact.

**Schematic** is an orrery. Directions are never touched — only distances from
centre and body radii, both by power laws (`R' ∝ √R`, `d' ∝ d⁰·⁴⁵`). Square-root
laws are what keep Mercury and Jupiter on the same screen; a linear multiplier
big enough to make Mercury visible turns Jupiter into a wall.

Because directions are preserved, **conjunctions, oppositions, retrograde loops,
transits and every body's phase remain correct for the real date**. Sizes and
distances are not, and shadows become self-consistent rather than true. The
slider blends continuously between the two, and the transition is animated so
the relationship between the scales is legible.

There is also an independent **Extra planet size** multiplier for nudging bodies
up without touching distances.

---

## Controls

### Mouse and keyboard

| Input | Action |
| --- | --- |
| Drag | Orbit, or look around in free-fly |
| Wheel | Zoom, exponentially — one notch feels the same 10 km above the Moon or 40 AU out |
| Click a body | Focus it |
| `0`–`9` | Jump to Sun, planets, Moon |
| `W A S D` / `Q E` | Fly horizontally / down and up |
| `Shift` / `Ctrl` | Boost / crawl |
| `Space` | Pause |
| `,` `.` | Previous / next speed step |
| `F` | Free-fly mode |
| `N` | Jump to now |
| `H` | Hide the interface |
| `T` | Toggle TV mode |

In free-fly, speed scales with the distance to the nearest surface, so you crawl
near a planet and cross the solar system when nothing is close.

Time runs at one of six fixed rates — **real-time** (the default), 1 min/s,
30 min/s, 1 h/s, 8 h/s, 24 h/s — rather than on a continuous slider, because
those are the rates that are actually useful and a log slider is hard to land
on any of them.

### Smart TV

TV mode is detected automatically from the user agent (Tizen, webOS, and
others) and can be forced with `?tv=1` or toggled with `T`. It switches to a
ten-foot UI and maps everything onto a remote:

| Button | Action |
| --- | --- |
| D-pad | Orbit the camera (hold to keep moving) |
| CH +/− | Zoom in / out |
| OK | Open the menu |
| Back | Close the menu |
| ▶/⏸ | Pause or resume |
| ⏪ ⏩ | Slower / faster |
| 🔴 Red | Orbit paths |
| 🟢 Green | Labels |
| 🟡 Yellow | Realistic ↔ schematic |
| 🔵 Blue | Next solar eclipse |
| `0`–`9` | Jump to a body |

Everything without a hardware button lives in the menu, which is a single
vertical list driven by up/down, left/right and OK — the only interaction model
that behaves consistently across TV firmwares. TV mode also drops the render
resolution and disables bloom, since TV browser GPUs are roughly a decade behind
desktop.

Targets the Samsung Tizen browser (Q60). The key mapping covers Tizen and webOS
codes plus desktop equivalents, and the whole scheme is exercisable in a normal
browser with the `T` toggle — but it has not been run on the TV itself, so the
remote mapping is the part most likely to need adjusting. Panels are inset from
the screen edges because TVs still overscan.

---

## How it is put together

```
src/
  core/constants.js        units, frames, JD helpers
  core/deltat.js           TT - UT1, so Earth's geography lines up
  ephem/
    planets.js             Standish Keplerian elements
    moon.js                truncated ELP-2000/82
    satellites.js          Galilean moons + Keplerian moons
    rotation.js            IAU pole and prime-meridian elements
    system.js              per-frame state in scene axes
  view/transform.js        realistic <-> schematic mapping
  render/
    shaders/eclipse.glsl.js  circle-overlap occlusion, disc-light diffuse
    bodyMaterial.js        surface / cloud / atmosphere / ring / Sun materials
    scene.js               scene graph, floating origin, orbit paths
    starfield.js           Milky Way, rotated from galactic coordinates
    proceduralTextures.js  maps for moons with no published imagery
  controls/
    cameraRig.js           orbit + free-fly
    tv.js                  D-pad scheme and menu
  sim/
    clock.js               simulation time
    eclipse.js             detection and search
  ui/                      HUD, labels, styles
```

Two implementation details worth knowing if you read the code:

**Floating origin.** Scene coordinates span 1e−3 to 4.5e6 units (1 unit =
1000 km). float32 has ~7 significant digits, so a vertex at Neptune's distance
resolves to about half a unit and a shader differencing two such positions loses
everything. The camera is therefore pinned at the origin and the whole system is
shifted by −cameraPosition each frame, in float64 on the CPU. Only small numbers
reach the GPU.

**Logarithmic depth.** The same range destroys the depth buffer. The renderer
runs with `logarithmicDepthBuffer`, which three.js implements *inside the
material* — so the hand-written shaders here include three.js's `logdepthbuf_*`
chunks. Omitting them lets a sphere z-fight against its own far side, and you
see the back of the planet through the front.

Lighting is a hand-written PBR-ish path rather than `MeshStandardMaterial`:
there is exactly one light in the scene, and the direct-lighting term needs to
be fully under our control for the finite solar disc, analytic occlusion, ring
shadows and the non-Lambertian regolith of airless bodies (Lommel–Seeliger, which
is why a full Moon looks like a flat disc rather than a shaded ball). Materials
write linear HDR; tone mapping and sRGB happen once, in `OutputPass`.

---

## Accuracy caveats

- Planet positions use the 1800–2050 element set. Outside that window accuracy
  degrades gradually.
- The fifteen Keplerian moons have correct orbit sizes, planes, speeds and
  periods, but their *phase* along the orbit at the epoch is approximate. The
  Galileans and our Moon come from real theories and are properly phased.
- Delta-T is not predictable far from the present; values outside roughly
  1900-2150 are extrapolations.
- Perturbation-level effects (nutation, planetary perturbations on the Moon
  beyond the truncated series, light-time) are not modelled.
- In schematic mode, only orbital *directions* remain physical.

---

## Credits

Planet, moon, Sun, ring and Milky Way maps are from
[Solar System Scope](https://www.solarsystemscope.com/textures/), licensed
**CC BY 4.0**, derived from public-domain NASA imagery and elevation data
(Messenger, Magellan, Blue Marble/VIIRS, MOLA, Cassini, Voyager, Hubble) plus the
NASA/ESO Milky Way panorama. See `public/textures/ATTRIBUTION.md`.

Maps for the twenty moons Solar System Scope does not publish are generated
procedurally at runtime and are plausible rather than photographic, though the
distinctive ones are modelled deliberately: Io's sulfur mottling, Europa's
lineae, Callisto's saturated cratering, Enceladus' south-polar tiger stripes,
Iapetus' two-tone hemispheres and Triton's cantaloupe terrain and polar cap.

Algorithms from Jean Meeus, *Astronomical Algorithms* (2nd ed.); E. M. Standish,
*Keplerian Elements for Approximate Positions of the Major Planets* (JPL SSD);
and the IAU/IAG Working Group reports on cartographic coordinates and rotational
elements.
