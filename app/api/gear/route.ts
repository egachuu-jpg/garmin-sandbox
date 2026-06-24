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

const KM_TO_MI = 0.621371;

function parseToolResult(content: unknown): unknown {
  let text = '';
  if (Array.isArray(content)) {
    text = content
      .map(c => (c && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .join('\n');
  } else if (typeof content === 'string') {
    text = content;
  } else {
    return content ?? null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function GET() {
  const gearItems = await query<GearRow>(
    `SELECT * FROM gear WHERE retired = FALSE ORDER BY created_at DESC`
  );

  // One call returns all Garmin gear with stats; map uuid -> miles (km source).
  const milesByUuid = new Map<string, number>();
  try {
    const parsed = parseToolResult(await executeTool('taxuspt__get_gear', { include_stats: true }));
    const list =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { gear?: unknown }).gear)
        ? ((parsed as { gear: Record<string, unknown>[] }).gear)
        : [];
    for (const g of list) {
      const uuid = typeof g.uuid === 'string' ? g.uuid : null;
      const stats = g.stats as { total_distance_km?: unknown } | undefined;
      const km = stats && typeof stats.total_distance_km === 'number' ? stats.total_distance_km : 0;
      if (uuid) milesByUuid.set(uuid, km * KM_TO_MI);
    }
  } catch {
    // Garmin unavailable — fall back to manual offsets only.
  }

  const enriched = gearItems.map(gear => {
    const garminMiles = gear.garmin_gear_uuid ? milesByUuid.get(gear.garmin_gear_uuid) ?? 0 : 0;
    const totalMiles = garminMiles + Number(gear.mileage_offset);
    return {
      ...gear,
      total_miles: Math.round(totalMiles),
      alert_pct: Math.min(100, Math.round((totalMiles / gear.alert_threshold_miles) * 100)),
    };
  });

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
