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

Textures for Io, Europa, Ganymede, Callisto and Titan are **generated
procedurally at runtime** (see `src/render/proceduralTextures.js`) because
Solar System Scope does not publish maps for them; they are plausible
rather than photographic.
