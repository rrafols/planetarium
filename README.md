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

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
Enable it once under **Settings → Pages → Source → GitHub Actions**; the site
then appears at `https://<user>.github.io/planetarium/`.

The workflow also downloads the high-res maps so the deployed site has them even
though they are not committed, and the build uses a relative base, so it works
from a project subpath as well as a domain root.

**It also works unbuilt.** `import 'three'` is a bare module specifier that no
browser can resolve, which is why serving a repository like this one raw
normally fails with *"Failed to resolve module specifier"*. `index.html` carries
an import map pointing three at a CDN, so the source runs as-is from any static
host — including a branch-based Pages deployment. That path costs a CDN
round-trip and ships ~50 unbundled modules, so the Actions build remains the
better option; the build strips the import map, leaving production with no
external references at all.

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
| Pluto | Standish's 3000 BC - 3000 AD element set, the only one covering it |
| Ceres | fixed osculating elements at J2000 |
| Comets | published osculating elements about a stated perihelion passage |
| 15 other moons | Keplerian in the parent's equatorial plane; measured a, e, i and period, approximate epoch phase |
| Earth's rotation | Driven by UT1 via a Delta-T model, not TT — see below |
| Axial tilts & rotation | IAU/IAG Working Group rotational elements (Archinal et al. 2015) |
| Earth/Moon split | Both bodies orbit their common barycentre, not each other |
| Frame | J2000 mean ecliptic throughout; the lunar series is precessed back from equinox-of-date so it stays consistent |

**38 bodies**: the Sun, eight planets, Pluto and Ceres, twenty-one moons, and
six comets — our Moon, the four
Galileans, Phobos and Deimos, seven of Saturn's (Mimas, Enceladus, Tethys,
Dione, Rhea, Titan, Iapetus), the five major Uranian moons, Triton — whose 157°
inclination makes it orbit backwards — and Charon.

Pluto and Charon are a genuine binary: Charon holds about an eighth of the
system mass, so the barycentre sits ~2100 km *above* Pluto's surface and the
pair visibly circle a point in empty space rather than Charon circling Pluto.

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

### The asteroid belt

40,000 particles, each carrying its own orbital elements and propagated in the
vertex shader — one draw call, no per-frame CPU work. Semi-major axes are
rejection-sampled against the **Kirkwood gaps**, the resonances with Jupiter at
2.50 (3:1), 2.82 (5:2), 2.95 (7:3) and 3.27 AU (2:1) where repeated tugs pump
eccentricity until an asteroid is thrown out. Eccentricities and inclinations
follow Rayleigh distributions, so the belt comes out as a gapped *torus* rather
than the flat uniform ring it is usually drawn as.

### Comets and meteor showers

Six comets, chosen for what they demonstrate rather than for fame alone:

| Comet | Period | Why |
| --- | --- | --- |
| 1P/Halley | 75.3 yr | The famous one, and **retrograde** (i = 162°) |
| 2P/Encke | 3.3 yr | Shortest known period — you can watch it go round |
| 109P/Swift-Tuttle | 133 yr | Parent of the **Perseids** |
| 55P/Tempel-Tuttle | 33.2 yr | Parent of the **Leonids**, also retrograde |
| 67P/Churyumov-Gerasimenko | 6.4 yr | Rosetta's target |
| C/1995 O1 (Hale-Bopp) | ~2550 yr | Near-polar orbit, i = 89.4° |

Comets are given by perihelion distance and time of perihelion rather than by
semi-major axis and mean longitude, because that is how they are catalogued —
and because for a near-parabolic orbit like Hale-Bopp's, `a` is enormous and
poorly constrained while `q` is measured precisely.

The coma and tail are a *response to sunlight*, not fixed features. Each
nucleus is inert beyond about 3.2 AU and switches on as it falls inward, so
both grow steeply toward perihelion and vanish again on the way out. The tail
points **away from the Sun**, not backwards along the track, so on the outbound
leg a comet travels tail-first — the detail most depictions get wrong. There
are two: a straight blue ion tail lying anti-sunward, and a broader, warmer
dust tail that lags toward the direction of travel, because heavier grains keep
more of the comet's orbital momentum.

**Meteor showers are not comets.** A shower is what happens when Earth crosses
the debris a comet has strung along its orbit, which is why it recurs on the
same calendar date every year. Each stream here is generated from its parent's
elements with the debris spread right around the orbit and slightly dispersed —
so you can watch Earth plough through the Perseids in mid-August.

| Shower | Parent | Peak |
| --- | --- | --- |
| Perseids | 109P/Swift-Tuttle | ~12 Aug |
| Leonids | 55P/Tempel-Tuttle | ~17 Nov |
| Orionids | 1P/Halley | ~21 Oct |
| Taurids | 2P/Encke | ~5 Nov |

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

Time runs at one of seven fixed rates — **real-time** (the default), 1 min/s,
30 min/s, 1 h/s, 8 h/s, 24 h/s, 1 week/s — rather than on a continuous slider,
because those are the rates that are actually useful and a log slider is hard to
land on any of them.

### Phones and tablets

Below ~820 px (or on any coarse-pointer device under 1180 px) the corner panels
*move* into a slide-in drawer — one DOM move, so every control keeps the
listeners it already had. Only the clock, the eclipse banner and the transport
bar stay on screen. Two buttons sit top-right: **☰** opens the drawer, **◉**
hides the interface entirely for an unobstructed view, and stays tappable so you
can bring it back. The switch is reversible, so rotating a tablet restores the
desktop layout.

### Smart TV

TV mode is detected automatically from the user agent (Tizen, webOS, and
others). **To try it in a normal desktop browser, add `?tv=1` to the URL or
press `T`** — the full ten-foot UI, menu and remote key mapping are all
exercisable with a keyboard, since the arrow keys, Enter and Escape are the same
codes a remote sends. It maps everything onto a remote:

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
- Comet elements are single-epoch two-body fits. Real comets are perturbed by
  the giant planets and pushed around by outgassing near perihelion (Encke is
  the classic case). Orbit shape, orientation, period and the reference
  perihelion date are sound; position many revolutions away is indicative.
- Ceres' mean anomaly at epoch is approximate, as with the Keplerian moons.
- The belt and the meteoroid streams are statistical populations, not
  catalogues of real numbered objects.
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
