import { NextResponse } from 'next/server';
import { executeTool } from '@/lib/mcp-client';
import { getPlanContext } from '@/lib/training';

// Garmin data changes slowly and the MCP round-trip is slow, so cache the
// dashboard server-side and refresh at most every 10 minutes.
const TTL = 10 * 60 * 1000;
let cache: { at: number; data: DashboardData } | null = null;

type DashboardData = {
  date: string;
  readiness: number | null;
  hrv: number | null;
  sleepScore: number | null;
  bodyBattery: number | null;
  restingHr: number | null;
  cached: boolean;
};

// executeTool returns the MCP content array: [{ type: 'text', text: '...' }].
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

// Garmin's JSON shapes vary and nest deeply, so search (in priority order) for
// the first occurrence of each candidate key holding a number (or { value }).
function pickNumber(obj: unknown, keys: string[]): number | null {
  for (const key of keys) {
    const found = searchKey(obj, key.toLowerCase());
    if (found !== null) return found;
  }
  return null;
}

function searchKey(root: unknown, key: string): number | null {
  const seen = new Set<unknown>();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (k.toLowerCase() === key) {
        if (typeof v === 'number') return v;
        if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number') {
          return (v as { value: number }).value;
        }
      }
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  const today = getPlanContext().startOfTodayUTC.toISOString().split('T')[0];

  const [readiness, hrv, sleep, stats, rhr] = await Promise.allSettled([
    executeTool('taxuspt__get_training_readiness', { date: today }),
    executeTool('taxuspt__get_hrv_data', { date: today }),
    executeTool('taxuspt__get_sleep_data', { date: today }),
    // get_body_battery's own curation logic reads bodyBatteryActivityEvent /
    // bodyBatteryDynamicFeedbackEvent off the reports/daily payload — fields
    // that endpoint doesn't have — so it can never surface a level. get_stats
    // pulls the same number correctly from the daily summary endpoint instead
    // (bodyBatteryMostRecentValue).
    executeTool('taxuspt__get_stats', { date: today }),
    executeTool('taxuspt__get_rhr_day', { date: today }),
  ]);

  const val = (r: PromiseSettledResult<unknown>) =>
    r.status === 'fulfilled' ? parseToolResult(r.value) : null;

  // get_training_readiness returns a list; take the first element (morning assessment).
  const firstOf = (v: unknown): unknown => (Array.isArray(v) && v.length > 0 ? v[0] : v);

  const data: DashboardData = {
    date: today,
    readiness: pickNumber(firstOf(val(readiness)), ['score']),
    // garmin_mcp returns snake_case keys (last_night_avg_hrv_ms, weekly_avg_hrv_ms)
    hrv: pickNumber(val(hrv), ['last_night_avg_hrv_ms', 'lastNightAvg', 'weekly_avg_hrv_ms', 'weeklyAvg', 'last_night_5min_high_hrv_ms', 'lastNight5MinHigh']),
    sleepScore: pickNumber(val(sleep), ['overallScore', 'overall', 'sleepScore', 'value']),
    // get_stats curates this as "body_battery_current" from Garmin's raw bodyBatteryMostRecentValue.
    bodyBattery: pickNumber(val(stats), ['body_battery_current', 'bodyBatteryMostRecentValue']),
    restingHr: pickNumber(val(rhr), ['restingHeartRate', 'value']),
    cached: false,
  };

  if (data.bodyBattery !== null || data.readiness !== null) {
    cache = { at: Date.now(), data };
  }
  return NextResponse.json(data);
}
