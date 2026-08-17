/**
 * Shared GLSL for physically-derived illumination.
 *
 * Shadow maps are useless for eclipses. The Moon is 3474 km across and casts a
 * shadow onto an Earth 384,400 km away; a 2048-texel cube map covering the
 * Sun-to-Neptune volume gives texels thousands of km wide, so the umbra would
 * be a few pixels of aliased mush — and that is before you notice that a
 * binary shadow map cannot produce a penumbra at all.
 *
 * Instead we solve the geometry directly. The Sun is a disc of known angular
 * radius as seen from each fragment; each occluder is another disc. The
 * fraction of the Sun covered is the overlap area of two circles, which has a
 * closed form. That yields umbra, penumbra and annularity for free, is exact
 * at every zoom level, and costs a handful of instructions per occluder.
 */

export const ECLIPSE_COMMON = /* glsl */ `
#ifndef PI
#define PI 3.141592653589793
#endif

uniform vec3  uSunPos;        // scene-space, already floating-origin relative
uniform float uSunRadius;
uniform vec3  uSunColor;
uniform float uSunIntensity;  // irradiance scale at 1 AU
uniform float uAU;

/**
 * (1 AU / true heliocentric distance)^2, supplied per body by the CPU.
 *
 * This cannot be derived from uSunPos: in schematic mode the drawn distances
 * are compressed, so deriving falloff from them would light Earth as though it
 * orbited at 0.16 AU — about 39x too bright, which floods the bloom pass.
 * Illumination stays tied to where the body really is.
 */
uniform float uIrradiance;

uniform int   uOccCount;
uniform vec3  uOccPos[MAX_OCC];
uniform float uOccRad[MAX_OCC];
uniform float uEclipseOn;

uniform float uHasRingShadow;
uniform vec3  uRingCenter;
uniform vec3  uRingNormal;
uniform float uRingInner;
uniform float uRingOuter;
uniform sampler2D uRingMap;

/** Area shared by two circles of radii r1, r2 whose centres are d apart. */
float circleOverlapArea(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  float rmin = min(r1, r2);
  if (d <= abs(r1 - r2)) return PI * rmin * rmin;

  float d2 = d * d;
  float a1 = r1 * r1;
  float a2 = r2 * r2;
  float c1 = clamp((d2 + a1 - a2) / (2.0 * d * r1), -1.0, 1.0);
  float c2 = clamp((d2 + a2 - a1) / (2.0 * d * r2), -1.0, 1.0);
  float t  = max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 * acos(c1) + a2 * acos(c2) - 0.5 * sqrt(t);
}

/**
 * Fraction of the Sun's disc still visible from the point p, in [0,1].
 * 1.0 = full Sun, 0.0 = total eclipse, in between = penumbra or annular.
 */
float sunVisibility(vec3 p, vec3 toSun, float sunDist, float sunAngRad) {
  if (uEclipseOn < 0.5) return 1.0;

  float covered = 0.0;
  for (int i = 0; i < MAX_OCC; i++) {
    if (i >= uOccCount) break;

    vec3 d = uOccPos[i] - p;
    float dist = length(d);
    // Ignore anything behind us or further away than the Sun itself.
    if (dist < 1e-6 || dist >= sunDist) continue;

    float occAng = asin(clamp(uOccRad[i] / dist, 0.0, 1.0));
    vec3 toOcc = d / dist;
    float sep = acos(clamp(dot(toOcc, toSun), -1.0, 1.0));

    // Cheap reject: no chance of overlap.
    if (sep >= sunAngRad + occAng) continue;

    covered += circleOverlapArea(sunAngRad, occAng, sep) / (PI * sunAngRad * sunAngRad);
  }
  return clamp(1.0 - covered, 0.0, 1.0);
}

/** Opacity of Saturn's rings along the ray from point p toward the Sun. */
float ringShadow(vec3 p, vec3 toSun) {
  if (uHasRingShadow < 0.5) return 1.0;

  float denom = dot(toSun, uRingNormal);
  if (abs(denom) < 1e-8) return 1.0;

  float t = dot(uRingCenter - p, uRingNormal) / denom;
  if (t <= 0.0) return 1.0; // ring plane is behind us

  vec3 hit = p + toSun * t;
  float r = length(hit - uRingCenter);
  if (r < uRingInner || r > uRingOuter) return 1.0;

  float u = (r - uRingInner) / (uRingOuter - uRingInner);
  vec4 texel = texture2D(uRingMap, vec2(u, 0.5));
  return 1.0 - clamp(texel.a, 0.0, 1.0) * 0.9;
}

/**
 * Diffuse response to a *disc* light of angular radius r rather than a point.
 *
 * With c = dot(N, L), the horizon cuts the solar disc into a circular segment.
 * A(x) is the visible area fraction and B(x) accounts for the shift of the
 * visible centroid above the horizon, giving the exact first-order irradiance:
 *   E = c * A + r * B
 * This is what makes the terminator a soft band the width of the Sun's
 * apparent diameter instead of a hard line.
 */
float discNdotL(float c, float r) {
  if (c >= r) return c;
  if (c <= -r) return 0.0;
  float x = c / r;
  float s = sqrt(max(0.0, 1.0 - x * x));
  float A = (acos(-x) + x * s) / PI;
  float B = (2.0 / (3.0 * PI)) * s * s * s;
  return c * A + r * B;
}

/**
 * Lommel-Seeliger scattering, blended with Lambert.
 * Airless regolith backscatters hard: this is why a full Moon looks like a
 * flat disc rather than a shaded ball.
 */
float lunarLambert(float mu0, float mu, float k) {
  float ls = 2.0 * mu0 / max(mu0 + mu, 1e-4);
  return mix(mu0, ls * mu0, k);
}
`;

/** GGX specular, used for Earth's oceans. */
export const SPECULAR_GLSL = /* glsl */ `
float d_ggx(float ndh, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

float v_smith(float ndv, float ndl, float rough) {
  float a = rough * rough;
  float lv = ndl * (ndv * (1.0 - a) + a);
  float ll = ndv * (ndl * (1.0 - a) + a);
  return 0.5 / max(lv + ll, 1e-6);
}
`;
