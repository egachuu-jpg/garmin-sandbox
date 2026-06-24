import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Singleton map — persists across requests within the same Node.js process
const clients = new Map<string, Client>();

const MCP_SERVERS = [
  {
    id: 'taxuspt',
    // Installed from git into a venv (see nixpacks.toml). PYTHON_BIN points at
    // that venv's interpreter in production; falls back to system python locally.
    // This is the only Garmin MCP: 110+ tools (health reads + workout writes).
    // The Node @nicolasvegam MCP was dropped — it uses garth OAuth1/OAuth2 tokens,
    // incompatible with this lib's DI-OAuth2 tokens, so it couldn't share auth.
    command: process.env.PYTHON_BIN || 'python',
    args: ['-m', 'garmin_mcp'],
  },
] as const;

async function getClient(server: (typeof MCP_SERVERS)[number]): Promise<Client | null> {
  if (clients.has(server.id)) return clients.get(server.id)!;

  try {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
      ),
      GARMIN_EMAIL: process.env.GARMIN_EMAIL!,
      GARMIN_PASSWORD: process.env.GARMIN_PASSWORD!,
    };

    const transport = new StdioClientTransport({
      command: server.command,
      args: [...server.args],
      env,
    });

    const client = new Client(
      { name: `coach-${server.id}`, version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    clients.set(server.id, client);
    console.log(`[MCP] Connected: ${server.id}`);
    return client;
  } catch (err) {
    console.error(`[MCP] Failed to connect to ${server.id}:`, err);
    return null;
  }
}

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: object;
};

// The Garmin MCP exposes ~110 tools. Sending all of them as tool schemas on
// every turn of the agentic loop is the main driver of input-token volume —
// enough that a single coaching turn can blow the Anthropic ITPM rate limit
// (429 rate_limit_error). This allowlist trims the coach to the subset that's
// actually useful for training analysis, workout creation, and logging how a
// session felt. Names are the MCP's base tool names (no `taxuspt__` prefix).
//
// Scope note: this filters ONLY the coach's tool list (getAllTools). The
// dashboard/gear/workouts routes call executeTool() directly with hardcoded
// names and are unaffected — they keep working even for tools omitted here.
// To give the coach a tool back, add its base name below.
const COACH_TOOLS = new Set<string>([
  // Activities — read + analysis
  'get_activities',
  'get_activities_by_date',
  'get_activity',
  'get_activity_splits',
  'get_activity_weather',
  'get_activity_hr_in_timezones',
  'get_activity_exercise_sets',
  'get_activity_gear',
  'get_activity_types',
  'get_training_effect',
  // Activity feedback — "how did it feel" logging
  'set_perceived_effort',
  'set_activity_feel',
  'set_activity_name',
  'set_activity_description',
  // Training metrics
  'get_training_readiness',
  'get_morning_training_readiness',
  'get_training_status',
  'get_hrv_data',
  'get_hrv_trend',
  'get_vo2max_trend',
  'get_training_load_trend',
  'get_endurance_score',
  'get_hill_score',
  'get_cycling_ftp',
  'get_lactate_threshold',
  'get_progress_summary_between_dates',
  'get_fitnessage_data',
  'get_race_predictions',
  'get_personal_record',
  // Recovery / wellness
  'get_sleep_data',
  'get_sleep_summary',
  'get_body_battery',
  'get_rhr_day',
  'get_heart_rates_summary',
  'get_stress_summary',
  'get_stats',
  'get_user_summary',
  'get_steps_data',
  'get_spo2_data',
  // Workouts — create / schedule / manage
  'get_workouts',
  'get_workout_by_id',
  'upload_workout',
  'delete_workout',
  'schedule_workout',
  'unschedule_workout',
  'get_scheduled_workouts',
  'get_training_plan_workouts',
  // Gear / profile / weight
  'get_gear',
  'get_user_profile',
  'get_unit_system',
  'get_daily_weigh_ins',
  'add_weigh_in',
]);

export async function getAllTools(): Promise<AnthropicTool[]> {
  const allTools: AnthropicTool[] = [];
  const seenBaseNames = new Set<string>();

  for (const server of MCP_SERVERS) {
    const client = await getClient(server);
    if (!client) continue;

    try {
      const { tools: mcpTools } = await client.listTools();
      for (const tool of mcpTools) {
        seenBaseNames.add(tool.name);
        allTools.push({
          name: `${server.id}__${tool.name}`,
          description: tool.description ?? '',
          input_schema: tool.inputSchema as object,
        });
      }
    } catch (err) {
      console.error(`[MCP] Failed to list tools for ${server.id}:`, err);
    }
  }

  if (COACH_TOOLS.size === 0) return allTools;

  const filtered = allTools.filter(t =>
    COACH_TOOLS.has(t.name.slice(t.name.indexOf('__') + 2))
  );

  // Typo guard: allowlist entries that don't match any live tool likely mean a
  // rename upstream or a typo here — surface them rather than silently dropping.
  const unknown = [...COACH_TOOLS].filter(n => !seenBaseNames.has(n));
  if (unknown.length) {
    console.warn(`[MCP] COACH_TOOLS not found in live tool set (renamed/typo?): ${unknown.join(', ')}`);
  }

  // Safety net: if the allowlist matched nothing (e.g. a wholesale upstream
  // rename), fall back to the full set so the coach stays functional — bloated
  // beats toolless.
  if (filtered.length === 0) {
    console.warn('[MCP] Tool allowlist matched 0 tools; sending full set as fallback.');
    return allTools;
  }

  console.log(`[MCP] Coach tools: ${filtered.length}/${allTools.length} sent (trimmed ${allTools.length - filtered.length}).`);
  return filtered;
}

export async function executeTool(
  fullName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const sep = fullName.indexOf('__');
  if (sep === -1) throw new Error(`Invalid tool name: ${fullName}`);

  const serverId = fullName.slice(0, sep);
  const toolName = fullName.slice(sep + 2);

  const server = MCP_SERVERS.find(s => s.id === serverId);
  if (!server) throw new Error(`Unknown MCP server: ${serverId}`);

  const client = await getClient(server);
  if (!client) throw new Error(`MCP server ${serverId} is not available`);

  const result = await client.callTool({ name: toolName, arguments: input });
  return result.content;
}
