import { NextResponse } from 'next/server';
import { orsDirections } from '@/lib/ors';
import type { LngLat } from '@/lib/geo';

// Manual-editor snap: waypoints in, routed geometry + stats out. Proxied
// server-side so the ORS key never reaches the browser.
export async function POST(req: Request) {
  const b = await req.json();
  const waypoints = b?.waypoints as Array<{ lat: number; lng: number }> | undefined;

  if (
    (b?.sport !== 'running' && b?.sport !== 'cycling') ||
    !Array.isArray(waypoints) || waypoints.length < 2 ||
    !waypoints.every(w => typeof w?.lat === 'number' && typeof w?.lng === 'number')
  ) {
    return NextResponse.json({ error: 'sport and ≥2 waypoints{lat,lng} required' }, { status: 400 });
  }

  try {
    const route = await orsDirections(
      b.sport,
      waypoints.map(w => [w.lng, w.lat] as LngLat),
      {
        surface: ['trails', 'roads', 'mixed'].includes(b?.surface) ? b.surface : 'mixed',
        avoidBusyRoads: b?.avoidBusyRoads === true,
      }
    );
    return NextResponse.json({
      geojson: { type: 'LineString', coordinates: route.coordinates },
      distanceMeters: Math.round(route.distanceMeters),
      ascentMeters: Math.round(route.ascentMeters),
      descentMeters: Math.round(route.descentMeters),
    });
  } catch (err) {
    console.error('[routes/directions] failed:', err);
    return NextResponse.json({ error: 'Failed to get directions' }, { status: 502 });
  }
}
