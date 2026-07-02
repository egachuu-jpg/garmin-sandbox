// OpenRouteService client (server-side only — the API key must not reach the
// browser). Free tier: ~2000 directions requests/day, 40/min, which is plenty
// for a single-athlete app. Sign up at https://openrouteservice.org and set
// ORS_API_KEY.

import type { LngLat } from './geo';

export type Sport = 'running' | 'cycling';
export type SurfacePref = 'trails' | 'roads' | 'mixed';

export type RoutePrefs = {
  surface: SurfacePref;
  elevation: 'flat' | 'hilly' | 'any';
  shape: 'loop' | 'out_and_back';
  avoidBusyRoads: boolean;
};

export type OrsRoute = {
  /** GeoJSON LineString coordinates: [lng, lat, ele] */
  coordinates: LngLat[];
  distanceMeters: number;
  durationSeconds: number;
  ascentMeters: number;
  descentMeters: number;
  /**
   * Fraction (0..1) of the route on actual trails (OSM path/track way types),
   * or null when ORS didn't return way-type extras. ORS profiles only *nudge*
   * toward trails — this measured share is what lets the suggester select for
   * them for real.
   */
  trailFraction: number | null;
};

// ORS waytype extra codes: 4 = path, 5 = track — the "real trail" way types.
// (3 = street, 7 = footway/sidewalk, 6 = cycleway, etc. are deliberately out.)
const TRAIL_WAYTYPES = new Set([4, 5]);

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions';

// ORS routing profile for a sport + surface preference. foot-hiking and
// cycling-mountain bias toward paths/trails; cycling-regular is the quieter
// road-bike compromise vs cycling-road's fastest-line behavior.
export function orsProfile(sport: Sport, surface: SurfacePref, avoidBusyRoads: boolean): string {
  if (sport === 'running') return surface === 'trails' ? 'foot-hiking' : 'foot-walking';
  if (surface === 'trails') return 'cycling-mountain';
  return avoidBusyRoads ? 'cycling-regular' : 'cycling-road';
}

type OrsOptions = {
  round_trip?: { length: number; points: number; seed: number };
  profile_params?: { weightings: Record<string, number> };
};

// green/quiet weightings are only accepted on foot-* profiles. green prefers
// parks/forest (our tree-shelter proxy on windy days); quiet avoids noisy roads.
function buildOptions(
  profile: string,
  prefs: Pick<RoutePrefs, 'surface' | 'avoidBusyRoads'>,
  preferShelter: boolean
): OrsOptions {
  const opts: OrsOptions = {};
  if (profile.startsWith('foot-')) {
    const weightings: Record<string, number> = {};
    // Max the green weighting whenever trails are asked for — it's a soft
    // nudge at best, so there's no reason to hold back.
    if (prefs.surface === 'trails' || preferShelter) weightings.green = 1;
    if (prefs.avoidBusyRoads) weightings.quiet = 0.6;
    if (Object.keys(weightings).length > 0) opts.profile_params = { weightings };
  }
  return opts;
}

async function callOrs(profile: string, body: Record<string, unknown>): Promise<OrsRoute> {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error('ORS_API_KEY is not set — get a free key at openrouteservice.org');

  const res = await fetch(`${ORS_BASE}/${profile}/geojson`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ elevation: true, instructions: false, extra_info: ['waytype'], ...body }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof err.error === 'string' ? err.error : err.error?.message ?? detail;
    } catch {
      /* keep status code */
    }
    throw new Error(`OpenRouteService (${profile}): ${detail}`);
  }

  const json = (await res.json()) as {
    features?: Array<{
      geometry: { coordinates: LngLat[] };
      properties: {
        summary?: { distance?: number; duration?: number };
        ascent?: number;
        descent?: number;
        extras?: { waytypes?: { summary?: Array<{ value: number; distance: number; amount: number }> } };
      };
    }>;
  };
  const feature = json.features?.[0];
  if (!feature) throw new Error(`OpenRouteService (${profile}): empty response`);

  const waytypes = feature.properties.extras?.waytypes?.summary;
  const trailFraction = waytypes
    ? waytypes.filter(w => TRAIL_WAYTYPES.has(w.value)).reduce((sum, w) => sum + w.amount, 0) / 100
    : null;

  return {
    coordinates: feature.geometry.coordinates,
    distanceMeters: feature.properties.summary?.distance ?? 0,
    durationSeconds: feature.properties.summary?.duration ?? 0,
    ascentMeters: feature.properties.ascent ?? 0,
    descentMeters: feature.properties.descent ?? 0,
    trailFraction,
  };
}

/** Snap a sequence of waypoints to routable paths. */
export async function orsDirections(
  sport: Sport,
  waypoints: LngLat[],
  prefs: Pick<RoutePrefs, 'surface' | 'avoidBusyRoads'>,
  preferShelter = false
): Promise<OrsRoute> {
  const profile = orsProfile(sport, prefs.surface, prefs.avoidBusyRoads);
  return callOrs(profile, {
    coordinates: waypoints.map(w => [w[0], w[1]]),
    options: buildOptions(profile, prefs, preferShelter),
  });
}

/** Generate a loop of roughly `lengthMeters` starting/ending at `start`. Vary `seed` for different loops. */
export async function orsRoundTrip(
  sport: Sport,
  start: LngLat,
  lengthMeters: number,
  seed: number,
  prefs: Pick<RoutePrefs, 'surface' | 'avoidBusyRoads'>,
  preferShelter = false
): Promise<OrsRoute> {
  const profile = orsProfile(sport, prefs.surface, prefs.avoidBusyRoads);
  return callOrs(profile, {
    coordinates: [[start[0], start[1]]],
    options: {
      ...buildOptions(profile, prefs, preferShelter),
      round_trip: { length: Math.round(lengthMeters), points: 4, seed },
    },
  });
}
