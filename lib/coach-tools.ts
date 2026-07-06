// Synthetic coach tools — tools that don't come from an MCP server but are
// implemented directly against the app's own DB/services. Adding one means
// adding an entry to SYNTHETIC_TOOLS; the agent loop picks it up from there.

import type Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from './db';
import { suggestRoutes } from './route-suggest';
import { getPlanContext } from './training';
import type { MemoryNote } from './coach-prompt';

export type SyntheticTool = {
  definition: Anthropic.Tool;
  execute: (input: Record<string, unknown>) => Promise<string>;
};

// ---------------------------------------------------------------------------
// remember — persist durable subjective notes to coach memory

export async function loadMemories(): Promise<MemoryNote[]> {
  const rows = await query<{ category: string; note: string; created_at: string }>(
    `SELECT category, note, created_at FROM coach_memory ORDER BY created_at ASC LIMIT 200`
  );
  return rows.map(r => ({
    category: r.category,
    note: r.note,
    date: new Date(r.created_at).toISOString().split('T')[0],
  }));
}

const remember: SyntheticTool = {
  definition: {
    name: 'remember',
    description:
      'Save a durable, subjective fact about the athlete to long-term coach memory so you can recall it weeks later (injuries/symptoms, how a session felt, preferences, coaching decisions). Do NOT use for objective metrics you can re-fetch from Garmin.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['injury', 'subjective', 'preference', 'decision', 'note'],
          description: 'The kind of note.',
        },
        note: { type: 'string', description: 'One or two sentences. Be specific.' },
      },
      required: ['note'],
    },
  },
  async execute(input) {
    const { category, note } = input as { category?: string; note?: string };
    await query(`INSERT INTO coach_memory (category, note) VALUES ($1, $2)`, [
      category || 'note',
      note ?? '',
    ]);
    return 'Saved to coach memory.';
  },
};

// ---------------------------------------------------------------------------
// suggest_route — wind-aware route suggestions from the default saved place

const suggestRoute: SyntheticTool = {
  definition: {
    name: 'suggest_route',
    description:
      'Suggest a run or ride route starting from the athlete\'s saved home base, sized to a target distance and shaped by the wind forecast for the workout date (headwind-out / sheltered routing on windy days). Saves the best route so the athlete can view and edit it on the Routes tab. Use when the athlete asks where to run/ride a workout.',
    input_schema: {
      type: 'object',
      properties: {
        sport: { type: 'string', enum: ['running', 'cycling'] },
        distance_miles: { type: 'number', description: 'Target route distance in miles.' },
        date: { type: 'string', description: 'Workout date, YYYY-MM-DD. Defaults to today.' },
        surface: { type: 'string', enum: ['trails', 'roads', 'mixed'], description: 'Surface preference. Default mixed.' },
        shape: { type: 'string', enum: ['loop', 'out_and_back'], description: 'Default loop; out_and_back is best on windy days.' },
        elevation: { type: 'string', enum: ['flat', 'hilly', 'any'], description: 'Terrain preference. Default any.' },
        avoid_busy_roads: { type: 'boolean' },
      },
      required: ['sport', 'distance_miles'],
    },
  },
  async execute(rawInput) {
    const input = rawInput as {
      sport?: string;
      distance_miles?: number;
      date?: string;
      surface?: string;
      shape?: string;
      elevation?: string;
      avoid_busy_roads?: boolean;
    };

    const place = await queryOne<{ name: string; lat: number; lng: number }>(
      `SELECT name, lat, lng FROM saved_places ORDER BY is_default DESC, created_at ASC LIMIT 1`
    );
    if (!place) {
      return 'No saved start point exists yet. Ask the athlete to open the Routes tab and save a home-base place first — route suggestions start from it.';
    }

    const sport = input.sport === 'cycling' ? 'cycling' : 'running';
    const date = input.date ?? getPlanContext().startOfTodayUTC.toISOString().split('T')[0];
    const prefs = {
      surface: (['trails', 'roads', 'mixed'].includes(input.surface ?? '') ? input.surface : 'mixed') as 'trails' | 'roads' | 'mixed',
      elevation: (['flat', 'hilly', 'any'].includes(input.elevation ?? '') ? input.elevation : 'any') as 'flat' | 'hilly' | 'any',
      shape: (input.shape === 'out_and_back' ? 'out_and_back' : 'loop') as 'loop' | 'out_and_back',
      avoidBusyRoads: input.avoid_busy_roads !== false,
    };

    const result = await suggestRoutes({
      sport,
      distanceMeters: (input.distance_miles ?? 5) * 1609.34,
      date,
      start: { lat: place.lat, lng: place.lng },
      prefs,
    });

    const best = result.candidates[0];
    const saved = await queryOne<{ id: string }>(
      `INSERT INTO routes (name, sport, workout_date, distance_meters, ascent_meters, geojson, waypoints, prefs, wind, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'suggested')
       RETURNING id`,
      [
        `${best.name} — ${date}`,
        sport,
        date,
        best.distanceMeters,
        best.ascentMeters,
        JSON.stringify(best.geojson),
        JSON.stringify(best.waypoints),
        JSON.stringify(prefs),
        result.wind ? JSON.stringify(result.wind) : null,
      ]
    );

    return JSON.stringify({
      start: place.name,
      wind: result.wind,
      windy: result.windy,
      candidates: result.candidates.map(c => ({
        name: c.name,
        distance_miles: +(c.distanceMeters / 1609.34).toFixed(1),
        climb_feet: Math.round(c.ascentMeters * 3.281),
        explanation: c.explanation,
      })),
      saved_route: { id: saved?.id, name: `${best.name} — ${date}` },
      note: 'The best candidate was saved — the athlete can view and edit it on the Routes tab (Saved).',
    });
  },
};

export const SYNTHETIC_TOOLS: SyntheticTool[] = [remember, suggestRoute];
