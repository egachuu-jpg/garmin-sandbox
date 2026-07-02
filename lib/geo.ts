// Shared geo math for the route builder: distances, bearings, and wind-exposure
// scoring over a route geometry. Coordinates follow GeoJSON order: [lng, lat]
// (optionally with elevation as a third element).

const R_EARTH = 6_371_000; // meters
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;

export type LngLat = [number, number, ...number[]];

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from north (0..360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const dLng = rad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dLng);
  return deg(Math.atan2(y, x));
}

/** Point reached by traveling `distMeters` from `start` on `bearing` degrees. */
export function destinationPoint(start: LngLat, bearing: number, distMeters: number): LngLat {
  const δ = distMeters / R_EARTH;
  const θ = rad(bearing);
  const φ1 = rad(start[1]);
  const λ1 = rad(start[0]);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [deg(λ2) > 180 ? deg(λ2) - 360 : deg(λ2), (φ2 * 180) / Math.PI];
}

export function pathDistanceMeters(coords: LngLat[]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineMeters(coords[i - 1], coords[i]);
  return d;
}

export type WindExposure = {
  /** Fraction (0..1) of route distance spent in significant headwind (component > 0.5). */
  headwindFraction: number;
  /** Same, but only over the second half of the route — a late headwind is the one that hurts. */
  lateHeadwindFraction: number;
  /** Longest continuous headwind stretch in meters. */
  longestHeadwindMeters: number;
};

/**
 * Score a route's exposure to a forecast wind. `windFromDeg` is the
 * meteorological direction the wind blows FROM; a segment whose travel bearing
 * equals windFromDeg is a dead headwind (component +1), the reverse is a
 * tailwind (−1).
 */
export function windExposure(coords: LngLat[], windFromDeg: number): WindExposure {
  const total = pathDistanceMeters(coords);
  if (total === 0 || coords.length < 2) {
    return { headwindFraction: 0, lateHeadwindFraction: 0, longestHeadwindMeters: 0 };
  }

  let headwind = 0;
  let lateHeadwind = 0;
  let lateTotal = 0;
  let longest = 0;
  let run = 0;
  let traveled = 0;

  for (let i = 1; i < coords.length; i++) {
    const len = haversineMeters(coords[i - 1], coords[i]);
    if (len === 0) continue;
    const component = Math.cos(rad(bearingDeg(coords[i - 1], coords[i]) - windFromDeg));
    const isHeadwind = component > 0.5;
    const isLate = traveled + len / 2 > total / 2;

    if (isHeadwind) {
      headwind += len;
      run += len;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    if (isLate) {
      lateTotal += len;
      if (isHeadwind) lateHeadwind += len;
    }
    traveled += len;
  }

  return {
    headwindFraction: headwind / total,
    lateHeadwindFraction: lateTotal > 0 ? lateHeadwind / lateTotal : 0,
    longestHeadwindMeters: longest,
  };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassLabel(fromDeg: number): string {
  return COMPASS[Math.round((((fromDeg % 360) + 360) % 360) / 22.5) % 16];
}
