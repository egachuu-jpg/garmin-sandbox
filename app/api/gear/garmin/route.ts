import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { executeTool } from '@/lib/mcp-client';

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

// Map Garmin's gear type label to our app's type enum.
function mapType(garminType: string): string {
  const t = garminType.toLowerCase();
  if (t.includes('bike') || t.includes('cycl')) return 'road_bike';
  if (t.includes('trail')) return 'trail_shoe';
  if (t.includes('shoe')) return 'running_shoe';
  return 'running_shoe';
}

// Lists the athlete's active Garmin gear so the UI can pick one to link.
export async function GET() {
  const linkedRows = await query<{ garmin_gear_uuid: string | null }>(
    `SELECT garmin_gear_uuid FROM gear WHERE garmin_gear_uuid IS NOT NULL AND retired = FALSE`
  );
  const linked = new Set(linkedRows.map(r => r.garmin_gear_uuid));

  try {
    const parsed = parseToolResult(await executeTool('taxuspt__get_gear', { include_stats: true }));
    const list =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { gear?: unknown }).gear)
        ? (parsed as { gear: Record<string, unknown>[] }).gear
        : [];

    const gear = list
      .filter(g => (typeof g.status === 'string' ? g.status : 'active') === 'active')
      .map(g => {
        const uuid = typeof g.uuid === 'string' ? g.uuid : '';
        const stats = g.stats as { total_distance_km?: unknown } | undefined;
        const km = stats && typeof stats.total_distance_km === 'number' ? stats.total_distance_km : 0;
        const garminType = typeof g.type === 'string' ? g.type : '';
        return {
          uuid,
          name: (typeof g.name === 'string' && g.name) || (typeof g.full_name === 'string' && g.full_name) || 'Unnamed gear',
          type: mapType(garminType),
          garminType,
          miles: Math.round(km * KM_TO_MI),
          linked: linked.has(uuid),
        };
      })
      .filter(g => g.uuid);

    return NextResponse.json({ gear });
  } catch (err) {
    return NextResponse.json({ gear: [], error: String(err) }, { status: 200 });
  }
}
