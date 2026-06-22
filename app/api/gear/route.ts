import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { executeTool } from '@/lib/mcp-client';

type GearRow = {
  id: string;
  garmin_gear_uuid: string | null;
  name: string;
  type: string;
  mileage_offset: number;
  alert_threshold_miles: number;
  notes: string | null;
  retired: boolean;
};

export async function GET() {
  const gearItems = await query<GearRow>(
    `SELECT * FROM gear WHERE retired = FALSE ORDER BY created_at DESC`
  );

  const enriched = await Promise.all(
    gearItems.map(async gear => {
      let garminMiles = 0;
      if (gear.garmin_gear_uuid) {
        try {
          const stats = (await executeTool('nicolas__get_gear_stats', {
            gearUuid: gear.garmin_gear_uuid,
          })) as { totalDistance?: number } | null;
          garminMiles = stats?.totalDistance ?? 0;
        } catch {
          // Garmin unavailable — fall back to offset only
        }
      }
      const totalMiles = Number(garminMiles) + Number(gear.mileage_offset);
      return {
        ...gear,
        total_miles: Math.round(totalMiles),
        alert_pct: Math.min(100, Math.round((totalMiles / gear.alert_threshold_miles) * 100)),
      };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, type, garmin_gear_uuid, mileage_offset, alert_threshold_miles, notes } = body;

  const [gear] = await query(
    `INSERT INTO gear (name, type, garmin_gear_uuid, mileage_offset, alert_threshold_miles, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      name,
      type ?? 'running_shoe',
      garmin_gear_uuid ?? null,
      mileage_offset ?? 0,
      alert_threshold_miles ?? 400,
      notes ?? null,
    ]
  );

  return NextResponse.json(gear, { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, ...fields } = body;

  const allowed = ['name', 'notes', 'alert_threshold_miles', 'mileage_offset', 'retired'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = updates.map(([, v]) => v);

  const [gear] = await query(
    `UPDATE gear SET ${setClauses}${fields.retired ? ', retired_at = NOW()' : ''} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );

  return NextResponse.json(gear);
}
