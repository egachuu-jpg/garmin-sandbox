import { NextResponse } from 'next/server';
import { suggestRoutes, type SuggestParams } from '@/lib/route-suggest';

// Route generation takes several ORS round trips; allow time for them.
export const maxDuration = 60;

export async function POST(req: Request) {
  const b = await req.json();

  if (
    (b?.sport !== 'running' && b?.sport !== 'cycling') ||
    typeof b?.distanceMeters !== 'number' || b.distanceMeters < 400 ||
    typeof b?.date !== 'string' ||
    typeof b?.start?.lat !== 'number' || typeof b?.start?.lng !== 'number'
  ) {
    return NextResponse.json({ error: 'sport, distanceMeters, date, start{lat,lng} required' }, { status: 400 });
  }

  const params: SuggestParams = {
    sport: b.sport,
    distanceMeters: b.distanceMeters,
    date: b.date,
    start: { lat: b.start.lat, lng: b.start.lng },
    prefs: {
      surface: ['trails', 'roads', 'mixed'].includes(b?.prefs?.surface) ? b.prefs.surface : 'mixed',
      elevation: ['flat', 'hilly', 'any'].includes(b?.prefs?.elevation) ? b.prefs.elevation : 'any',
      shape: b?.prefs?.shape === 'out_and_back' ? 'out_and_back' : 'loop',
      avoidBusyRoads: b?.prefs?.avoidBusyRoads === true,
    },
  };

  try {
    const result = await suggestRoutes(params);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
