import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export type RouteRow = {
  id: string;
  name: string;
  sport: 'running' | 'cycling';
  workout_date: string | null;
  distance_meters: number;
  ascent_meters: number | null;
  geojson: { type: 'LineString'; coordinates: number[][] };
  waypoints: Array<{ lat: number; lng: number }> | null;
  prefs: Record<string, unknown> | null;
  wind: Record<string, unknown> | null;
  source: 'suggested' | 'manual';
  created_at: string;
};

export async function GET() {
  const routes = await query<RouteRow>(
    `SELECT id, name, sport, workout_date::text, distance_meters::float, ascent_meters::float,
            geojson, waypoints, prefs, wind, source, created_at
     FROM routes ORDER BY created_at DESC LIMIT 50`
  );
  return NextResponse.json({ routes });
}

export async function POST(req: Request) {
  const b = await req.json();
  const coords = b?.geojson?.coordinates;
  if (
    typeof b?.name !== 'string' || !b.name.trim() ||
    (b?.sport !== 'running' && b?.sport !== 'cycling') ||
    typeof b?.distanceMeters !== 'number' ||
    !Array.isArray(coords) || coords.length < 2
  ) {
    return NextResponse.json({ error: 'name, sport, distanceMeters, geojson required' }, { status: 400 });
  }

  const route = await queryOne<{ id: string }>(
    `INSERT INTO routes (name, sport, workout_date, distance_meters, ascent_meters, geojson, waypoints, prefs, wind, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      b.name.trim(),
      b.sport,
      typeof b.workoutDate === 'string' ? b.workoutDate : null,
      b.distanceMeters,
      typeof b.ascentMeters === 'number' ? b.ascentMeters : null,
      JSON.stringify(b.geojson),
      b.waypoints ? JSON.stringify(b.waypoints) : null,
      b.prefs ? JSON.stringify(b.prefs) : null,
      b.wind ? JSON.stringify(b.wind) : null,
      b.source === 'suggested' ? 'suggested' : 'manual',
    ]
  );
  return NextResponse.json({ id: route?.id });
}
