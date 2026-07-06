// The coach's agentic loop, extracted from the chat API route so the SSE
// plumbing and the agent logic evolve separately (and so the pure helpers
// here are unit-testable).
//
// Durability model: the assistant turn is persisted round by round. A
// placeholder assistant row (completed = FALSE) is inserted before the first
// model call and UPDATEd after every stream round and every batch of tool
// results, then flipped to completed = TRUE at the end. A crash mid-turn
// therefore leaves a visible partial turn — including any tool_use blocks
// whose side effects (scheduled workouts, saved memories) already committed —
// instead of an invisible gap. repairToolPairing() is the designed recovery
// path for replaying such interrupted turns: it patches placeholder
// tool_results for any dangling tool_use so the Anthropic API accepts the
// history.

import Anthropic from '@anthropic-ai/sdk';
import { getAllTools, executeTool } from './mcp-client';
import { getCoachSystemPrompt } from './coach-prompt';
import { query, queryOne } from './db';
import { SYNTHETIC_TOOLS, loadMemories } from './coach-tools';

export const COACH_MODEL = 'claude-sonnet-4-6';

// Hard cap on model rounds per turn. A normal report turn uses well under 10;
// the cap exists so a pathological loop can't burn API budget indefinitely.
const MAX_ROUNDS = 25;

// maxRetries lets the SDK back off and retry 429/overloaded responses (with
// Retry-After) instead of failing the report outright.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string; id: string }
  | { type: 'tool_done'; name: string; id: string }
  | { type: 'tool_error'; name: string; id: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type SendEvent = (event: AgentEvent) => void;

// ---------------------------------------------------------------------------
// History replay

export type DBMessage = {
  role: 'user' | 'assistant';
  text: string;
  // For assistant rows, the full turn as Anthropic MessageParam[] (assistant
  // content + interleaved tool_result messages) so multi-step tool turns replay
  // correctly. `unknown` because legacy rows hold ContentBlock[] instead.
  raw_content: unknown;
  tool_calls: Array<{ id: string; name: string; result: string }> | null;
};

export function isMessageParamList(raw: unknown): raw is Anthropic.MessageParam[] {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every(item => item !== null && typeof item === 'object' && 'role' in item)
  );
}

function isToolResultBlock(block: unknown): block is Anthropic.ToolResultBlockParam {
  return typeof block === 'object' && block !== null && (block as { type?: string }).type === 'tool_result';
}

// Replay repair for history persisted with a dangling tool_use — a turn that
// crashed (or hit max_tokens) between persisting the assistant round and its
// tool results. Anthropic rejects a tool_use block that isn't immediately
// followed by its tool_result, so patch in placeholders rather than letting
// every future turn 400.
export function repairToolPairing(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
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

// --- Tool-result elision -----------------------------------------------------
//
// Old turns' tool_result payloads (raw Garmin JSON) dominate replay size but
// carry almost no value — durable facts live in coach memory, and metrics can
// be re-fetched. Keep the blocks (pairing must stay valid) but replace their
// content beyond the most recent KEEP_TOOL_RESULT_TURNS assistant turns.
//
// Cache stability: whether a turn is elided depends only on how many turns
// follow it in *persisted history*, which changes exactly once per new turn —
// so the replayed prefix is deterministic within a turn's loop rounds and
// diverges at a single point between turns (one incremental cache re-write,
// not a full miss).

const KEEP_TOOL_RESULT_TURNS = 3;
const ELIDED_NOTE =
  '[tool output elided to save space — from an earlier turn; re-run the tool if you need this data]';

function elideToolResults(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map(msg => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    let touched = false;
    const content = msg.content.map(block => {
      if (isToolResultBlock(block) && block.content !== ELIDED_NOTE) {
        touched = true;
        return { ...block, content: ELIDED_NOTE };
      }
      return block;
    });
    return touched ? { ...msg, content } : msg;
  });
}

export function buildAnthropicMessages(dbMessages: DBMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  const assistantCount = dbMessages.filter(m => m.role === 'assistant').length;
  let assistantIndex = 0;

  for (const msg of dbMessages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.text });
      continue;
    }

    const elide = assistantIndex < assistantCount - KEEP_TOOL_RESULT_TURNS;
    assistantIndex++;

    const raw = msg.raw_content;
    if (isMessageParamList(raw)) {
      // New format: replay the assistant turn verbatim (keeps tool_use/tool_result pairing).
      result.push(...(elide ? elideToolResults(raw) : raw));
    } else if (Array.isArray(raw) && raw.length > 0) {
      // Legacy format: content blocks only. Emit as assistant and drop the old
      // flattened tool_calls — their tool_use blocks weren't preserved, so
      // replaying tool_results would be invalid.
      result.push({ role: 'assistant', content: raw as Anthropic.ContentBlock[] });
    } else if (msg.text) {
      result.push({ role: 'assistant', content: msg.text });
    }
    // else: an empty interrupted placeholder row (crashed before any content
    // was persisted) — nothing to replay, skip it.
  }

  return repairToolPairing(result);
}

// Clone the message list with a cache breakpoint on the final content block,
// so the whole conversation prefix is cached between loop rounds (and between
// turns that land within the cache TTL). Without this every round re-sends
// the full history at the uncached input rate.
type BlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam;

function withMessageCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];

  const blocks: BlockParam[] =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  if (blocks.length === 0) return messages;

  // cache_control is accepted by the API but missing from this SDK version's
  // block param types, so assert the shape (same approach as system/tools).
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: { type: 'ephemeral' },
  } as unknown as BlockParam;

  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

// ---------------------------------------------------------------------------
// The agentic loop

export async function runCoachTurn(
  conversationId: string,
  userText: string,
  send: SendEvent
): Promise<void> {
  // Upsert conversation + save the user message before anything can fail, so
  // even a total API outage leaves the question in the log.
  await query(
    `INSERT INTO conversations (id, title, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [conversationId, userText.slice(0, 60)]
  );
  await query(
    `INSERT INTO messages (conversation_id, role, text, raw_content)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, userText, JSON.stringify([{ type: 'text', text: userText }])]
  );

  const history = await query<DBMessage>(
    `SELECT role, text, raw_content, tool_calls FROM messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );

  const [mcpTools, memories] = await Promise.all([getAllTools(), loadMemories()]);
  const syntheticByName = new Map(SYNTHETIC_TOOLS.map(t => [t.definition.name, t]));
  const tools = [...(mcpTools as Anthropic.Tool[]), ...SYNTHETIC_TOOLS.map(t => t.definition)];
  const systemPrompt = getCoachSystemPrompt(memories);
  let currentMessages = buildAnthropicMessages(history);

  // Prompt caching: system prompt and the (large, constant) tool definitions
  // are identical across every round, so cache them; a third breakpoint on the
  // last message caches the conversation itself between rounds. If cache_read
  // stays 0 across rounds in the usage log, caching is broken (silent cost).
  const cachedSystem = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ] as unknown as Anthropic.TextBlockParam[];
  const cachedTools = tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t
  );

  // Placeholder assistant row — flipped to completed once the turn finishes.
  const assistantRow = await queryOne<{ id: string }>(
    `INSERT INTO messages (conversation_id, role, text, raw_content, tool_calls, completed)
     VALUES ($1, 'assistant', '', '[]'::jsonb, '[]'::jsonb, FALSE)
     RETURNING id`,
    [conversationId]
  );
  const assistantRowId = assistantRow!.id;

  let assistantText = '';
  const allToolCalls: Array<{ id: string; name: string; result: string }> = [];
  // The full assistant turn (assistant content + interleaved tool_result
  // messages) — persisted after every round so a crash can't hide side effects.
  const turnMessages: Anthropic.MessageParam[] = [];

  const persistTurn = (completed: boolean) =>
    query(
      `UPDATE messages SET text = $2, raw_content = $3, tool_calls = $4, completed = $5
       WHERE id = $1`,
      [assistantRowId, assistantText, JSON.stringify(turnMessages), JSON.stringify(allToolCalls), completed]
    );

  try {
    for (let round = 1; ; round++) {
      const claudeStream = anthropic.messages.stream({
        model: COACH_MODEL,
        max_tokens: 8192,
        system: cachedSystem,
        messages: withMessageCacheBreakpoint(currentMessages),
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

      // Per-round token usage. `input` is the uncached prompt; cache_read is
      // served at ~0.1x; cache_creation is the ~1.25x write. cache_* fields
      // are returned by the API but absent from this SDK version's Usage
      // type, so widen the shape to read them.
      const u = finalMsg.usage as typeof finalMsg.usage & {
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      };
      console.log(
        `[chat] round=${round} usage tools=${tools.length} input=${u.input_tokens} ` +
        `cache_read=${u.cache_read_input_tokens ?? 0} ` +
        `cache_write=${u.cache_creation_input_tokens ?? 0} output=${u.output_tokens}`
      );

      const assistantMsg = { role: 'assistant' as const, content: roundContent };
      currentMessages = [...currentMessages, assistantMsg];
      turnMessages.push(assistantMsg);
      // Persist the round before tool execution so a crash mid-execution still
      // records which tools were attempted (their side effects may have
      // committed). Replay heals the dangling tool_use via repairToolPairing.
      await persistTurn(false);

      // Execute any tool calls Claude produced this round, even if the turn
      // didn't end with stop_reason 'tool_use' (e.g. it hit max_tokens
      // mid-batch) — a tool_use without a paired tool_result corrupts the
      // conversation for every future turn.
      const toolUseBlocks = roundContent.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length > 0) {
        const toolResults = await Promise.all(
          toolUseBlocks.map(async block => {
            let result: string;
            try {
              const synthetic = syntheticByName.get(block.name);
              if (synthetic) {
                result = await synthetic.execute(block.input as Record<string, unknown>);
              } else {
                const raw = await executeTool(block.name, block.input as Record<string, unknown>);
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
        await persistTurn(false);
      }

      if (finalMsg.stop_reason !== 'tool_use') break;

      if (round >= MAX_ROUNDS) {
        console.warn(`[chat] round cap (${MAX_ROUNDS}) hit — ending turn early.`);
        // UI-only note; not persisted as assistant content (it isn't the
        // model's text). The persisted turn is valid — results are recorded.
        send({
          type: 'text',
          content: '\n\n_(Stopped: this turn hit the tool-call limit. Ask me to continue if needed.)_',
        });
        break;
      }
    }

    await persistTurn(true);
    send({ type: 'done' });
  } catch (err) {
    if (turnMessages.length === 0) {
      // Nothing happened yet (e.g. the first model call failed) — remove the
      // empty placeholder rather than leaving a blank bubble in history.
      await query(`DELETE FROM messages WHERE id = $1`, [assistantRowId]).catch(() => {});
    } else {
      // Keep whatever was persisted; mark complete so clients stop polling.
      await persistTurn(true).catch(() => {});
    }
    throw err;
  }
}
