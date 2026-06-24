import Anthropic from '@anthropic-ai/sdk';
import { getAllTools, executeTool } from '@/lib/mcp-client';
import { getCoachSystemPrompt, type MemoryNote } from '@/lib/coach-prompt';
import { query } from '@/lib/db';

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

  return result;
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
        const tools = [...(mcpTools as Anthropic.Tool[]), REMEMBER_TOOL];
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
            max_tokens: 4096,
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

          const assistantMsg = { role: 'assistant' as const, content: roundContent };
          currentMessages = [...currentMessages, assistantMsg];
          turnMessages.push(assistantMsg);

          if (finalMsg.stop_reason !== 'tool_use') break;

          // Execute all tool calls in parallel
          const toolUseBlocks = roundContent.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          );

          const toolResults = await Promise.all(
            toolUseBlocks.map(async block => {
              let result: string;
              try {
                if (block.name === 'remember') {
                  const input = block.input as { category?: string; note?: string };
                  await saveMemory(input.category ?? 'note', input.note ?? '');
                  result = 'Saved to coach memory.';
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
