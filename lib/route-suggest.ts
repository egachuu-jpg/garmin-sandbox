// Route suggestion engine. Generates candidate routes from OpenRouteService,
// scores them against the athlete's preferences and the wind forecast for the
// workout day, and returns the best few with human-readable explanations.
//
// Wind strategy (chosen by the athlete): the forecast is always shown, but only
// reshapes suggestions when sustained wind ≥ WINDY_THRESHOLD_MPH. When windy:
//  - out-and-backs are pointed INTO the wind (headwind out, tailwind home)
//  - foot profiles get ORS's `green` weighting maxed as a tree-shelter proxy
//  - candidates are ranked partly by late-route headwind exposure

import {
  destinationPoint,
  pathDistanceMeters,
  windExposure,
  type LngLat,
} from './geo';
import { orsDirections, orsRoundTrip, type OrsRoute, type RoutePrefs, type Sport } from './ors';
import { getWindForecast, WINDY_THRESHOLD_MPH, type WindForecast } from './wind';

export type RouteCandidate = {
  name: string;
  /** GeoJSON LineString ([lng,lat,ele] coords) ready for the map. */
  geojson: { type: 'LineString'; coordinates: LngLat[] };
  /** Editable control points ({lat,lng}) the manual editor re-snaps through. */
  waypoints: Array<{ lat: number; lng: number }>;
  distanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
  durationSeconds: number;
  /** Measured share (0..1) of the route on trail/track way types; null if unknown. */
  trailFraction: number | null;
  explanation: string;
  score: number;
};

export type SuggestResult = {
  wind: WindForecast | null;
  windy: boolean;
  candidates: RouteCandidate[];
};

export type SuggestParams = {
  sport: Sport;
  distanceMeters: number;
  /** Workout date (YYYY-MM-DD) — drives the wind forecast. */
  date: string;
  start: { lat: number; lng: number };
  prefs: RoutePrefs;
};

const MI = 1609.34;

// Straight-line → path-distance fudge for out-and-back targeting: real paths
// wander, so aim the crow-flies leg short of half the target distance.
const CROW_FACTOR = 0.75;

/** Evenly spaced (by distance) control points so a suggestion loads into the editor. */
function sampleWaypoints(coords: LngLat[], count = 8): Array<{ lat: number; lng: number }> {
  if (coords.length <= count) return coords.map(c => ({ lat: c[1], lng: c[0] }));
  const total = pathDistanceMeters(coords);
  const step = total / (count - 1);
  const out: Array<{ lat: number; lng: number }> = [{ lat: coords[0][1], lng: coords[0][0] }];
  let traveled = 0;
  let next = step;
  for (let i = 1; i < coords.length && out.length < count - 1; i++) {
    traveled += pathDistanceMeters([coords[i - 1], coords[i]]);
    if (traveled >= next) {
      out.push({ lat: coords[i][1], lng: coords[i][0] });
      next += step;
    }
  }
  const last = coords[coords.length - 1];
  out.push({ lat: last[1], lng: last[0] });
  return out;
}

function distanceScore(actual: number, target: number): number {
  return Math.max(0, 1 - Math.abs(actual - target) / (0.25 * target));
}

function climbScore(route: OrsRoute, pref: RoutePrefs['elevation']): number {
  if (pref === 'any') return 0.5;
  const perKm = route.ascentMeters / Math.max(0.1, route.distanceMeters / 1000);
  const hilliness = Math.min(1, perKm / 15); // ~15 m/km ≈ genuinely hilly
  return pref === 'hilly' ? hilliness : 1 - hilliness;
}

function fmt(route: OrsRoute): string {
  const mi = (route.distanceMeters / MI).toFixed(1);
  const ft = Math.round(route.ascentMeters * 3.281);
  return `${mi} mi · ${ft} ft of climb`;
}

function windSentence(
  wind: WindForecast | null,
  windy: boolean,
  route: OrsRoute,
  intoWind: boolean
): string {
  if (!wind) return 'No wind forecast available for that date yet.';
  const base = `Wind ${wind.speedMph} mph from the ${wind.directionLabel} (gusts ${wind.gustMph})`;
  if (!windy) return `${base} — light enough to ignore.`;
  if (intoWind) return `${base} — routed headwind-out so you get the tailwind home.`;
  const exp = windExposure(route.coordinates, wind.directionDeg);
  const lateShare = Math.round(exp.lateHeadwindFraction * 100);
  return lateShare <= 25
    ? `${base} — this loop keeps late-route headwind to ~${lateShare}% of the back half.`
    : `${base} — expect headwind on ~${lateShare}% of the back half.`;
}

type RawCandidate = { name: string; route: OrsRoute; intoWind: boolean };

async function generateLoops(
  params: SuggestParams,
  startLngLat: LngLat,
  preferShelter: boolean
): Promise<RawCandidate[]> {
  // ORS's loop generator can't be told "use trails" — it only nudges. So when
  // trails are requested, cast a wider net and let trail-share scoring pick.
  const seeds = params.prefs.surface === 'trails' ? [7, 23, 47, 71, 101, 131] : [7, 23, 47, 71];
  const results = await Promise.allSettled(
    seeds.map(seed =>
      orsRoundTrip(params.sport, startLngLat, params.distanceMeters, seed, params.prefs, preferShelter)
    )
  );
  return results
    .filter((r): r is PromiseFulfilledResult<OrsRoute> => r.status === 'fulfilled')
    .map((r, i) => ({ name: `Loop ${String.fromCharCode(65 + i)}`, route: r.value, intoWind: false }));
}

async function generateOutAndBacks(
  params: SuggestParams,
  startLngLat: LngLat,
  wind: WindForecast | null,
  windy: boolean,
  preferShelter: boolean
): Promise<RawCandidate[]> {
  // Windy: aim the outbound leg into the wind (± a little variety). Calm:
  // spread — more directions when hunting trails, since trail corridors are
  // directional and most bearings will miss them.
  const bearings =
    windy && wind
      ? [wind.directionDeg, wind.directionDeg - 35, wind.directionDeg + 35]
      : params.prefs.surface === 'trails'
        ? [0, 60, 120, 180, 240, 300]
        : [0, 120, 240];

  const buildOne = async (bearing: number): Promise<OrsRoute> => {
    let crow = (params.distanceMeters / 2) * CROW_FACTOR;
    let out = await orsDirections(
      params.sport,
      [startLngLat, destinationPoint(startLngLat, bearing, crow)],
      params.prefs,
      preferShelter
    );
    // One correction pass if the snapped outbound is far off half the target.
    const half = params.distanceMeters / 2;
    if (Math.abs(out.distanceMeters - half) / half > 0.15 && out.distanceMeters > 0) {
      crow = crow * (half / out.distanceMeters);
      out = await orsDirections(
        params.sport,
        [startLngLat, destinationPoint(startLngLat, bearing, crow)],
        params.prefs,
        preferShelter
      );
    }
    // Mirror the outbound for the return leg (same paths, so same trail share).
    return {
      coordinates: [...out.coordinates, ...[...out.coordinates].reverse().slice(1)],
      distanceMeters: out.distanceMeters * 2,
      durationSeconds: out.durationSeconds * 2,
      ascentMeters: out.ascentMeters + out.descentMeters,
      descentMeters: out.ascentMeters + out.descentMeters,
      trailFraction: out.trailFraction,
    };
  };

  const results = await Promise.allSettled(bearings.map(buildOne));
  return results
    .filter((r): r is PromiseFulfilledResult<OrsRoute> => r.status === 'fulfilled')
    .map((r, i) => ({
      name: windy ? (i === 0 ? 'Into the wind' : `Into the wind ${i === 1 ? '(left)' : '(right)'}`) : `Out-and-back ${String.fromCharCode(65 + i)}`,
      route: r.value,
      intoWind: windy,
    }));
}

export async function suggestRoutes(params: SuggestParams): Promise<SuggestResult> {
  const wind = await getWindForecast(params.start.lat, params.start.lng, params.date);
  const windy = wind !== null && wind.speedMph >= WINDY_THRESHOLD_MPH;
  const preferShelter = windy; // tree-cover weighting only kicks in when it matters
  const startLngLat: LngLat = [params.start.lng, params.start.lat];

  const raw =
    params.prefs.shape === 'out_and_back'
      ? await generateOutAndBacks(params, startLngLat, wind, windy, preferShelter)
      : await generateLoops(params, startLngLat, preferShelter);

  if (raw.length === 0) {
    throw new Error('Route generation failed — OpenRouteService returned no usable routes for that start point.');
  }

  const wantTrails = params.prefs.surface === 'trails';

  const scored = raw.map(({ name, route, intoWind }) => {
    const windScore =
      !windy || !wind
        ? 0.5
        : intoWind
          ? 1 // headwind-out is exactly what we want on a windy day
          : 1 - windExposure(route.coordinates, wind.directionDeg).lateHeadwindFraction;

    // Measured trail share (path/track way types). ~60%+ trail is excellent in
    // most metros, so saturate the score there rather than demanding 100%.
    const trailScore = route.trailFraction == null ? 0.5 : Math.min(1, route.trailFraction / 0.625);

    const score = wantTrails
      ? 0.35 * distanceScore(route.distanceMeters, params.distanceMeters) +
        0.15 * climbScore(route, params.prefs.elevation) +
        0.2 * windScore +
        0.3 * trailScore
      : 0.5 * distanceScore(route.distanceMeters, params.distanceMeters) +
        0.25 * climbScore(route, params.prefs.elevation) +
        0.25 * windScore;

    const pct = route.trailFraction != null ? Math.round(route.trailFraction * 100) : null;
    const surfaceNote =
      wantTrails && pct != null
        ? pct >= 20
          ? `${pct}% on real trails/tracks`
          : `only ${pct}% on trails/tracks — little trail access within reach of this start`
        : wantTrails
          ? 'Biased toward trails and paths'
          : params.prefs.surface === 'roads'
            ? 'Road-first routing'
            : pct != null && pct >= 15
              ? `Mixed surfaces (${pct}% trails/tracks)`
              : 'Mixed surfaces';
    const shelterNote = preferShelter && params.sport === 'running' ? ', weighted toward parks/tree cover for shelter' : '';

    return {
      name,
      geojson: { type: 'LineString' as const, coordinates: route.coordinates },
      waypoints: sampleWaypoints(route.coordinates),
      distanceMeters: Math.round(route.distanceMeters),
      ascentMeters: Math.round(route.ascentMeters),
      descentMeters: Math.round(route.descentMeters),
      durationSeconds: Math.round(route.durationSeconds),
      trailFraction: route.trailFraction,
      explanation: `${fmt(route)}. ${surfaceNote}${shelterNote}. ${windSentence(wind, windy, route, intoWind)}`,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return { wind, windy, candidates: scored.slice(0, 3) };
}
