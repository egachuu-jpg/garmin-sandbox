import Anthropic from '@anthropic-ai/sdk';
import { getAllTools, executeTool } from '@/lib/mcp-client';
import { getCoachSystemPrompt, type MemoryNote } from '@/lib/coach-prompt';
import { query, queryOne } from '@/lib/db';
import { suggestRoutes } from '@/lib/route-suggest';
import { getPlanContext } from '@/lib/training';

// maxRetries lets the SDK back off and retry 429/overloaded responses (with
// Retry-After) instead of failing the report outright.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });

// Synthetic tool (not from an MCP) the coach calls to persist durable notes.
const REMEMBER_TOOL: Anthropic.Tool = {
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
};

// Synthetic tool: generate wind-aware route suggestions for a workout. Runs the
// same engine as the Routes tab and saves the best candidate so the athlete can
// view/edit it on the map.
const SUGGEST_ROUTE_TOOL: Anthropic.Tool = {
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
};

async function runSuggestRoute(input: {
  sport?: string;
  distance_miles?: number;
  date?: string;
  surface?: string;
  shape?: string;
  elevation?: string;
  avoid_busy_roads?: boolean;
}): Promise<string> {
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
}

async function loadMemories(): Promise<MemoryNote[]> {
  const rows = await query<{ category: string; note: string; created_at: string }>(
    `SELECT category, note, created_at FROM coach_memory ORDER BY created_at ASC LIMIT 200`
  );
  return rows.map(r => ({
    category: r.category,
    note: r.note,
    date: new Date(r.created_at).toISOString().split('T')[0],
  }));
}

async function saveMemory(category: string, note: string): Promise<void> {
  await query(`INSERT INTO coach_memory (category, note) VALUES ($1, $2)`, [category || 'note', note]);
}

type DBMessage = {
  role: 'user' | 'assistant';
  text: string;
  // For assistant rows, the full turn as Anthropic MessageParam[] (assistant
  // content + interleaved tool_result messages) so multi-step tool turns replay
  // correctly. `unknown` because legacy rows hold ContentBlock[] instead.
  raw_content: unknown;
  tool_calls: Array<{ id: string; name: string; result: string }> | null;
};

function isMessageParamList(raw: unknown): raw is Anthropic.MessageParam[] {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every(item => item !== null && typeof item === 'object' && 'role' in item)
  );
}

function isToolResultBlock(block: unknown): block is Anthropic.ToolResultBlockParam {
  return typeof block === 'object' && block !== null && (block as { type?: string }).type === 'tool_result';
}

// Defensive repair for history already persisted with a dangling tool_use (e.g.
// from a turn that hit max_tokens mid-batch before tool execution completed —
// see the loop fix below). Anthropic rejects a tool_use block that isn't
// immediately followed by its tool_result, so patch in placeholders rather
// than letting every future turn 400.
function repairToolPairing(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    result.push(msg);
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

    const toolUseIds = msg.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map(b => b.id);
    if (toolUseIds.length === 0) continue;

    const next = messages[i + 1];
    const nextResultBlocks =
      next && next.role === 'user' && Array.isArray(next.content)
        ? next.content.filter(isToolResultBlock)
        : [];
    const existingIds = new Set(nextResultBlocks.map(b => b.tool_use_id));
    const missing = toolUseIds.filter(id => !existingIds.has(id));
    if (missing.length === 0) continue;

    const placeholders = missing.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: 'Error: no result was recorded for this tool call (the turn was interrupted).',
    }));

    if (nextResultBlocks.length > 0) {
      (
        next!.content as Array<
          Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
        >
      ).unshift(...placeholders);
    } else {
      result.push({ role: 'user', content: placeholders });
    }
  }

  return result;
}

function buildAnthropicMessages(dbMessages: DBMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of dbMessages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.text });
      continue;
    }

    const raw = msg.raw_content;
    if (isMessageParamList(raw)) {
      // New format: replay the assistant turn verbatim (keeps tool_use/tool_result pairing).
      result.push(...raw);
    } else if (Array.isArray(raw) && raw.length > 0) {
      // Legacy format: content blocks only. Emit as assistant and drop the old
      // flattened tool_calls — their tool_use blocks weren't preserved, so
      // replaying tool_results would be invalid.
      result.push({ role: 'assistant', content: raw as Anthropic.ContentBlock[] });
    } else {
      result.push({ role: 'assistant', content: msg.text });
    }
  }

  return repairToolPairing(result);
}

export async function POST(req: Request) {
  const { text, conversationId } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Upsert conversation
        await query(
          `INSERT INTO conversations (id, title, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
          [conversationId, (text as string).slice(0, 60)]
        );

        // Save user message
        await query(
          `INSERT INTO messages (conversation_id, role, text, raw_content)
           VALUES ($1, 'user', $2, $3)`,
          [conversationId, text, JSON.stringify([{ type: 'text', text }])]
        );

        // Load history
        const history = await query<DBMessage>(
          `SELECT role, text, raw_content, tool_calls FROM messages
           WHERE conversation_id = $1 ORDER BY created_at ASC`,
          [conversationId]
        );

        const [mcpTools, memories] = await Promise.all([getAllTools(), loadMemories()]);
        const tools = [...(mcpTools as Anthropic.Tool[]), REMEMBER_TOOL, SUGGEST_ROUTE_TOOL];
        const systemPrompt = getCoachSystemPrompt(memories);
        let currentMessages = buildAnthropicMessages(history);

        // Prompt caching: the system prompt and the (large, constant) tool
        // definitions are identical across every turn of the agentic loop, so
        // cache them. This is the main fix for report 429s — subsequent turns
        // read the ~110 tool schemas from cache instead of re-sending them.
        // cache_control is accepted by the API but isn't in this SDK version's
        // TextBlockParam type, so assert the shape.
        const cachedSystem = [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ] as unknown as Anthropic.TextBlockParam[];
        const cachedTools = tools.map((t, i) =>
          i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t
        );

        let assistantText = '';
        const allToolCalls: Array<{ id: string; name: string; result: string }> = [];
        // The full assistant turn (assistant content + interleaved tool_result
        // messages), persisted so it can be replayed without breaking tool pairing.
        const turnMessages: Anthropic.MessageParam[] = [];

        // Agentic loop — handles multi-step tool use
        while (true) {
          const claudeStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 8192,
            system: cachedSystem,
            messages: currentMessages,
            tools: cachedTools,
          });

          const roundContent: Anthropic.ContentBlock[] = [];
          let currentBlock: (Anthropic.TextBlock | Anthropic.ToolUseBlock) | null = null;
          let inputBuffer = '';

          for await (const event of claudeStream) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') {
                currentBlock = { type: 'text', text: '' };
              } else if (event.content_block.type === 'tool_use') {
                currentBlock = {
                  type: 'tool_use',
                  id: event.content_block.id,
                  name: event.content_block.name,
                  input: {},
                };
                inputBuffer = '';
                send({ type: 'tool_start', name: event.content_block.name, id: event.content_block.id });
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta' && currentBlock?.type === 'text') {
                (currentBlock as Anthropic.TextBlock).text += event.delta.text;
                assistantText += event.delta.text;
                send({ type: 'text', content: event.delta.text });
              } else if (event.delta.type === 'input_json_delta') {
                inputBuffer += event.delta.partial_json;
              }
            } else if (event.type === 'content_block_stop' && currentBlock) {
              if (currentBlock.type === 'tool_use') {
                try {
                  (currentBlock as Anthropic.ToolUseBlock).input = JSON.parse(inputBuffer);
                } catch {
                  (currentBlock as Anthropic.ToolUseBlock).input = {};
                }
              }
              roundContent.push(currentBlock as Anthropic.ContentBlock);
              currentBlock = null;
            }
          }

          const finalMsg = await claudeStream.finalMessage();

          // Per-turn token usage. `input` is the uncached prompt; cache_read is
          // served at ~0.1x; cache_creation is the ~1.25x write. If cache_read
          // stays 0 across turns, the prompt cache isn't being hit (silent cost).
          // cache_* fields are returned by the API but absent from this SDK
          // version's Usage type, so widen the shape to read them.
          const u = finalMsg.usage as typeof finalMsg.usage & {
            cache_read_input_tokens?: number | null;
            cache_creation_input_tokens?: number | null;
          };
          console.log(
            `[chat] usage tools=${tools.length} input=${u.input_tokens} ` +
            `cache_read=${u.cache_read_input_tokens ?? 0} ` +
            `cache_write=${u.cache_creation_input_tokens ?? 0} output=${u.output_tokens}`
          );

          const assistantMsg = { role: 'assistant' as const, content: roundContent };
          currentMessages = [...currentMessages, assistantMsg];
          turnMessages.push(assistantMsg);

          // Execute any tool calls Claude produced this round, even if the
          // turn didn't end with stop_reason 'tool_use' (e.g. it hit
          // max_tokens mid-batch while emitting several tool_use blocks).
          // Leaving a tool_use block without a paired tool_result corrupts
          // the conversation for every future turn (the Anthropic API
          // rejects it), so resolve whatever was parsed before deciding
          // whether to continue the loop.
          const toolUseBlocks = roundContent.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          );

          if (toolUseBlocks.length > 0) {
            const toolResults = await Promise.all(
              toolUseBlocks.map(async block => {
                let result: string;
                try {
                  if (block.name === 'remember') {
                    const input = block.input as { category?: string; note?: string };
                    await saveMemory(input.category ?? 'note', input.note ?? '');
                    result = 'Saved to coach memory.';
                  } else if (block.name === 'suggest_route') {
                    result = await runSuggestRoute(block.input as Parameters<typeof runSuggestRoute>[0]);
                  } else {
                    const raw = await executeTool(
                      block.name,
                      block.input as Record<string, unknown>
                    );
                    result = JSON.stringify(raw);
                  }
                  send({ type: 'tool_done', name: block.name, id: block.id });
                } catch (err) {
                  result = `Error: ${String(err)}`;
                  send({ type: 'tool_error', name: block.name, id: block.id });
                }

                allToolCalls.push({ id: block.id, name: block.name, result });
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: result,
                };
              })
            );

            const toolResultMsg = { role: 'user' as const, content: toolResults };
            currentMessages = [...currentMessages, toolResultMsg];
            turnMessages.push(toolResultMsg);
          }

          if (finalMsg.stop_reason !== 'tool_use') break;
        }

        // Persist the assistant turn. raw_content holds the full turn (assistant
        // content + tool_result messages) so it replays with valid tool pairing;
        // text + tool_calls drive the UI on reload.
        await query(
          `INSERT INTO messages (conversation_id, role, text, raw_content, tool_calls)
           VALUES ($1, 'assistant', $2, $3, $4)`,
          [
            conversationId,
            assistantText,
            JSON.stringify(turnMessages),
            JSON.stringify(allToolCalls),
          ]
        );

        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
