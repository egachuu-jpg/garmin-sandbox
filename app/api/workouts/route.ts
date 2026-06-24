import { NextResponse } from 'next/server';
import { executeTool } from '@/lib/mcp-client';
import { getPlanContext } from '@/lib/training';

// Upcoming scheduled workouts change rarely; cache briefly to avoid slow loads.
const TTL = 5 * 60 * 1000;
const WINDOW_DAYS = 21;
let cache: { at: number; data: Workout[] } | null = null;

type Workout = {
  date: string | null;
  name: string | null;
  sport: string | null;
  completed: boolean;
  workoutType: string | null;
  isRestDay: boolean;
  isRaceDay: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

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

// The tool returns either an array of summaries or an object wrapping one.
function extractList(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every(x => x && typeof x === 'object')) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return [];
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ workouts: cache.data, cached: true });
  }

  const { startOfTodayUTC } = getPlanContext();
  const start = startOfTodayUTC.toISOString().split('T')[0];
  const end = new Date(startOfTodayUTC.getTime() + WINDOW_DAYS * 86_400_000)
    .toISOString()
    .split('T')[0];

  try {
    const raw = await executeTool('taxuspt__get_scheduled_workouts', {
      start_date: start,
      end_date: end,
    });

    const workouts: Workout[] = extractList(parseToolResult(raw))
      .map(w => ({
        date: str(w.date),
        name: str(w.name),
        sport: str(w.sport),
        completed: w.completed === true,
        workoutType: str(w.workout_type),
        isRestDay: w.is_rest_day === true,
        isRaceDay: w.is_race_day === true,
        distanceMeters: num(w.estimated_distance_meters),
        durationSeconds: num(w.estimated_duration_seconds),
      }))
      .filter(w => w.date)
      .sort((a, b) => (a.date! < b.date! ? -1 : 1));

    cache = { at: Date.now(), data: workouts };
    return NextResponse.json({ workouts, cached: false });
  } catch (err) {
    return NextResponse.json({ workouts: [], error: String(err) }, { status: 200 });
  }
}
