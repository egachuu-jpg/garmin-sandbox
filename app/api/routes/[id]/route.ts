import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const b = await req.json();

  // Update whatever fields were sent (rename and/or re-drawn geometry).
  if (typeof b?.name === 'string' && b.name.trim()) {
    await query(`UPDATE routes SET name = $1, updated_at = NOW() WHERE id = $2`, [b.name.trim(), id]);
  }
  if (b?.geojson?.coordinates && typeof b?.distanceMeters === 'number') {
    await query(
      `UPDATE routes SET geojson = $1, waypoints = $2, distance_meters = $3, ascent_meters = $4, updated_at = NOW()
       WHERE id = $5`,
      [
        JSON.stringify(b.geojson),
        b.waypoints ? JSON.stringify(b.waypoints) : null,
        b.distanceMeters,
        typeof b.ascentMeters === 'number' ? b.ascentMeters : null,
        id,
      ]
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await query(`DELETE FROM routes WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
