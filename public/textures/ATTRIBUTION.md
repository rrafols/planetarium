# Texture credits

Planet, moon, Sun, ring and Milky Way maps in this directory come from
**Solar System Scope** (https://www.solarsystemscope.com/textures/),
released under **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

They are derived from public-domain NASA elevation and imagery data
(Messenger, Magellan, Blue Marble/VIIRS, MOLA, Cassini, Voyager, Hubble)
plus the NASA/ESO Milky Way panorama.

- `*.jpg` / `*.png` in this folder: 2048x1024 versions (default load)
- `hi/*.jpg`: 8192x4096 versions, lazy-loaded by the "High-res textures" toggle
- `earth_normal.jpg`, `earth_spec.jpg`: converted from the original TIFF
  normal / specular maps with `sips`

`ceres.jpg` is Solar System Scope's *fictional* (artistic) Ceres map — no
photographic global map is published in this set — so treat its surface detail
as illustrative.

Textures for the remaining moons, plus Pluto and Charon, are **generated
procedurally at runtime** (see `src/render/proceduralTextures.js`) because
Solar System Scope does not publish maps for them; they are plausible
rather than photographic.

## Lunar relief

`moon_normal.png` is a tangent-space normal map derived from the **LOLA**
(Lunar Orbiter Laser Altimeter) global elevation model distributed by NASA's
Scientific Visualization Studio as part of the CGI Moon Kit — public domain.

It is generated, not hand-authored: `scripts/make-normal-map.mjs` reads the
32-bit float DEM (values in kilometres, spanning -8.98 to +10.69 km) and
differentiates it, scaling the longitudinal gradient by cos(latitude) so slopes
do not blow up toward the poles.

To regenerate at a different resolution:

    curl -L -o ldem_16.tif \
      https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif
    node scripts/make-normal-map.mjs ldem_16.tif public/textures/moon_normal.png 2048

It is stored as PNG rather than JPEG deliberately. JPEG chroma subsampling
mangles the R and G channels, which are exactly the ones carrying slope: at
4096 wide it introduced ~1.9 degrees of mean normal error with worst-case
blocks near 25 degrees, and raising quality from 92 to 97 changed nothing
because the loss is structural, not quantisation. Lossless at half the width
costs the same 3.6 MB.
