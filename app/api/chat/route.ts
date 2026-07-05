import { runCoachTurn, type AgentEvent } from '@/lib/agent';

// SSE wrapper around the agentic loop (lib/agent.ts). Deliberately does NOT
// abort the turn when the client disconnects (Stop button, navigation, flaky
// mobile network): the loop runs to completion and persists per round, and
// the client reconciles by polling /api/messages for the completed row. The
// round cap in lib/agent.ts bounds runaway cost instead.
export async function POST(req: Request) {
  const { text, conversationId } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = false;

      const send = (event: AgentEvent) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected mid-stream — keep the turn running, stop sending.
          clientGone = true;
        }
      };

      try {
        await runCoachTurn(conversationId, text, send);
      } catch (err) {
        console.error('[chat] turn failed:', err);
        send({ type: 'error', message: String(err) });
      } finally {
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // already closed by cancel()
          }
        }
      }
    },
    cancel() {
      // Reader went away; runCoachTurn keeps going (see note above).
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
