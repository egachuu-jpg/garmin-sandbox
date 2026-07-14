import { NextResponse } from 'next/server';
import { executeTool } from '@/lib/mcp-client';
import { getPlanContext } from '@/lib/training';

// Diagnostic endpoint for the "sleep score shows a dash" problem. It returns
// exactly what Garmin sends so we can see whether the score is genuinely
// missing for a date or just nested somewhere our key-hunt doesn't reach.
//
// Behind the same passphrase auth as everything else (see middleware.ts).
// Usage:
//   GET /api/debug/sleep              → today's Chicago date
//   GET /api/debug/sleep?date=2026-07-06
//   GET /api/debug/sleep?full=1       → include the raw ~50KB get_sleep_data too

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
    return text; // Garmin auth/MFA errors arrive as plain text — surface them as-is.
  }
}

async function tryTool(name: string, input: Record<string, unknown>) {
  try {
    const raw = await executeTool(name, input);
    return { ok: true as const, payload: parseToolResult(raw) };
  } catch (err) {
    console.error(`[debug/sleep] ${name} failed:`, err);
    return { ok: false as const, error: 'Failed to load sleep data' };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? getPlanContext().startOfTodayUTC.toISOString().split('T')[0];
  const includeFull = url.searchParams.get('full') === '1';

  const summary = await tryTool('taxuspt__get_sleep_summary', { date });

  // Dig the score out of whatever shape came back, the same way /api/dashboard
  // does, so we can see the extracted value next to the raw payload.
  const sleepScores =
    summary.ok && summary.payload && typeof summary.payload === 'object'
      ? (summary.payload as Record<string, unknown>)
      : null;

  const body: Record<string, unknown> = {
    date,
    note: 'Behind passphrase auth. Add ?date=YYYY-MM-DD to probe another day, ?full=1 for the raw 50KB get_sleep_data.',
    get_sleep_summary: summary,
    extracted_sleep_score: sleepScores?.['sleep_score'] ?? null,
  };

  if (includeFull) {
    const fullData = await tryTool('taxuspt__get_sleep_data', { date });
    // The full payload is huge; surface just the score-bearing subtree plus a
    // top-level key list so the response stays readable.
    const dto =
      fullData.ok && fullData.payload && typeof fullData.payload === 'object'
        ? ((fullData.payload as Record<string, unknown>)['dailySleepDTO'] as Record<string, unknown> | undefined)
        : undefined;
    body['get_sleep_data'] = {
      ok: fullData.ok,
      error: fullData.ok ? undefined : fullData.error,
      dailySleepDTO_keys: dto ? Object.keys(dto) : null,
      sleepScores: dto?.['sleepScores'] ?? null,
    };
  }

  return NextResponse.json(body);
}
