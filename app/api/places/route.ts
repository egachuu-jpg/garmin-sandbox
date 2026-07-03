import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export type SavedPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  is_default: boolean;
};

export async function GET() {
  const places = await query<SavedPlace>(
    `SELECT id, name, lat, lng, is_default FROM saved_places ORDER BY is_default DESC, created_at ASC`
  );
  return NextResponse.json({ places });
}

export async function POST(req: Request) {
  const { name, lat, lng, isDefault } = await req.json();
  if (typeof name !== 'string' || !name.trim() || typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'name, lat, lng required' }, { status: 400 });
  }

  // First place saved becomes the default automatically.
  const count = await queryOne<{ n: string }>(`SELECT COUNT(*) AS n FROM saved_places`);
  const makeDefault = isDefault === true || count?.n === '0';
  if (makeDefault) await query(`UPDATE saved_places SET is_default = FALSE`);

  const place = await queryOne<SavedPlace>(
    `INSERT INTO saved_places (name, lat, lng, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, lat, lng, is_default`,
    [name.trim(), lat, lng, makeDefault]
  );
  return NextResponse.json({ place });
}

export async function PUT(req: Request) {
  // Update a place: rename and/or make it the default start point.
  const { id, name, makeDefault } = await req.json();
  if (typeof id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (typeof name === 'string' && name.trim()) {
    await query(`UPDATE saved_places SET name = $1 WHERE id = $2`, [name.trim(), id]);
  }
  if (makeDefault === true) {
    await query(`UPDATE saved_places SET is_default = FALSE`);
    await query(`UPDATE saved_places SET is_default = TRUE WHERE id = $1`, [id]);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await query(`DELETE FROM saved_places WHERE id = $1`, [id]);
  // Keep exactly one default if any places remain.
  await query(
    `UPDATE saved_places SET is_default = TRUE
     WHERE id = (SELECT id FROM saved_places ORDER BY created_at ASC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM saved_places WHERE is_default)`
  );
  return NextResponse.json({ ok: true });
}
