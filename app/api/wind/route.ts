import { NextResponse } from 'next/server';
import { getWindForecast, WINDY_THRESHOLD_MPH } from '@/lib/wind';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get('lat'));
  const lng = Number(sp.get('lng'));
  const date = sp.get('date');

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !date) {
    return NextResponse.json({ error: 'lat, lng, date required' }, { status: 400 });
  }

  const wind = await getWindForecast(lat, lng, date);
  return NextResponse.json({ wind, windy: wind !== null && wind.speedMph >= WINDY_THRESHOLD_MPH });
}
