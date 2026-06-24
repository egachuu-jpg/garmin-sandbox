import Anthropic from '@anthropic-ai/sdk';
import { getAllTools, executeTool } from '@/lib/mcp-client';
import { getCoachSystemPrompt } from '@/lib/coach-prompt';
import { query } from '@/lib/db';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type DBMessage = {
  role: 'user' | 'assistant';
  text: string;
  raw_content: Anthropic.ContentBlock[] | null;
  tool_calls: Array<{ id: string; name: string; result: string }> | null;
};

function buildAnthropicMessages(dbMessages: DBMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of dbMessages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.text });
    } else {
      const content: Anthropic.ContentBlock[] =
        msg.raw_content ?? [{ type: 'text', text: msg.text }];
      result.push({ role: 'assistant', content });

      if (msg.tool_calls?.length) {
        result.push({
          role: 'user',
          content: msg.tool_calls.map(tc => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: tc.result,
          })),
        });
      }
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

        const tools = await getAllTools();
        const systemPrompt = getCoachSystemPrompt();
        let currentMessages = buildAnthropicMessages(history);

        let assistantText = '';
        let finalRawContent: Anthropic.ContentBlock[] = [];
        const allToolCalls: Array<{ id: string; name: string; result: string }> = [];

        // Agentic loop — handles multi-step tool use
        while (true) {
          const claudeStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: systemPrompt,
            messages: currentMessages,
            tools: tools as Anthropic.Tool[],
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
          finalRawContent = roundContent;

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: roundContent },
          ];

          if (finalMsg.stop_reason !== 'tool_use') break;

          // Execute all tool calls in parallel
          const toolUseBlocks = roundContent.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          );

          const toolResults = await Promise.all(
            toolUseBlocks.map(async block => {
              let result: string;
              try {
                const raw = await executeTool(
                  block.name,
                  block.input as Record<string, unknown>
                );
                result = JSON.stringify(raw);
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

          currentMessages = [
            ...currentMessages,
            { role: 'user' as const, content: toolResults },
          ];
        }

        // Persist assistant message
        await query(
          `INSERT INTO messages (conversation_id, role, text, raw_content, tool_calls)
           VALUES ($1, 'assistant', $2, $3, $4)`,
          [
            conversationId,
            assistantText,
            JSON.stringify(finalRawContent),
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
