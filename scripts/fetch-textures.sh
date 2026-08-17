#!/usr/bin/env bash
# Download the optional 8192x4096 texture set into public/textures/hi/.
#
# These are not committed because they total ~49 MB. The app runs without them;
# the "High-res maps" toggle just keeps the 2k maps.
#
# Source: Solar System Scope (https://www.solarsystemscope.com/textures/), CC BY 4.0.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/public/textures/hi"
BASE="https://www.solarsystemscope.com/textures/download"
REF="https://www.solarsystemscope.com/textures/"
mkdir -p "$DIR"

fetch() { # remote-name local-name
  if [ -s "$DIR/$2" ]; then
    printf '  %-16s already present\n' "$2"
    return
  fi
  printf '  %-16s ' "$2"
  curl -fsSL --retry 3 -A "Mozilla/5.0" -H "Referer: $REF" \
    -o "$DIR/$2" "$BASE/$1"
  printf 'ok (%s)\n' "$(du -h "$DIR/$2" | cut -f1)"
}

echo "Fetching 8k textures into $DIR"
fetch 8k_earth_daymap.jpg   earth_day.jpg
fetch 8k_earth_nightmap.jpg earth_night.jpg
fetch 8k_earth_clouds.jpg   earth_clouds.jpg
fetch 8k_moon.jpg           moon.jpg
fetch 8k_jupiter.jpg        jupiter.jpg
fetch 8k_mars.jpg           mars.jpg
fetch 8k_stars_milky_way.jpg stars.jpg
echo "Done."
