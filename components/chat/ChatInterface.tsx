'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square } from 'lucide-react';
import { MessageBubble, type Message, type ToolCall } from './MessageBubble';

const PENDING_ID = '__pending_reply__';

type InitialMessage = {
  id: string;
  role: string;
  text: string;
  tool_calls: ToolCall[] | null;
};

type Props = {
  conversationId: string;
  initialMessages?: InitialMessage[];
  seedPrompt?: string;
};

const SUGGESTED_PROMPTS = [
  "How was my sleep and HRV this week?",
  "Am I on track for sub-4 at Mankato?",
  "Build tomorrow's interval workout",
  "How is my gear holding up?",
];

// The old Reports tab as one-tap prompts — same canned analyses, launched in
// place instead of teleporting into a separate conversation.
const REPORT_PROMPTS = [
  {
    emoji: '📊',
    title: 'Weekly Summary',
    prompt:
      'Generate a weekly training summary. Include total mileage, average pace, training load, sleep quality, and HRV trends for this week.',
  },
  {
    emoji: '🏁',
    title: 'Race Readiness',
    prompt:
      'Assess my current race readiness for the Mankato Marathon sub-4 goal. Check VO2max, recent long runs, training load, and project my likely finish time.',
  },
  {
    emoji: '💚',
    title: 'Recovery Patterns',
    prompt:
      'Analyze my recovery patterns over the past 30 days. Look at body battery trends, stress levels, HRV, and sleep quality. Identify any concerning patterns.',
  },
  {
    emoji: '👟',
    title: 'Gear Mileage',
    prompt:
      'Review my gear mileage. Check all tracked shoes and equipment, flag anything approaching replacement thresholds, and advise on rotation strategy given my SI joint condition.',
  },
];

export function ChatInterface({ conversationId, initialMessages = [], seedPrompt }: Props) {
  // If we mounted with the last message being a user message it means the user
  // navigated away while the coach was still responding. The server will finish
  // the agentic loop and save the reply to the DB regardless — we just need to
  // poll until it appears.
  const pendingOnMount =
    initialMessages.length > 0 &&
    initialMessages[initialMessages.length - 1].role === 'user';

  const [messages, setMessages] = useState<Message[]>(() => {
    const base: Message[] = initialMessages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      text: m.text,
      toolCalls: m.tool_calls ?? undefined,
    }));
    if (pendingOnMount) {
      base.push({ id: PENDING_ID, role: 'assistant', text: '', toolCalls: [], streaming: true });
    }
    return base;
  });
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(pendingOnMount);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seededRef = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Only autoscroll while the user is pinned to the bottom — scrolling up to
  // reread mid-stream must not get yanked back down by each token batch.
  const pinnedRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll until the server-saved reply appears in the DB. Used when the user
  // mounted mid-turn (navigated away and back) and after Stop — in both cases
  // the server finishes the agentic loop and persists the reply regardless.
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    const poll = async () => {
      try {
        const res = await fetch(`/api/messages/${conversationId}`);
        if (!res.ok) return;
        const rows: Array<{ id: string; role: string; text: string; tool_calls: unknown }> =
          await res.json();
        if (rows[rows.length - 1]?.role === 'assistant') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setMessages(
            rows.map(m => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              text: m.text,
              toolCalls: (m.tool_calls as ToolCall[] | null) ?? undefined,
            }))
          );
          setStreaming(false);
        }
      } catch {
        // transient error — keep polling
      }
    };

    pollingRef.current = setInterval(poll, 2000);
  }, [conversationId]);

  useEffect(() => {
    if (pendingOnMount) startPolling();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // pendingOnMount is stable (derived from stable initialMessages prop)
  }, [pendingOnMount, startPolling]);

  // Stop reading the stream. The server finishes the turn and saves it either
  // way, so reconcile via polling — the bubble fills in with the final reply.
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      // Stop any background polling for a previously abandoned reply
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }

      const trimmed = text.trim();
      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      setMessages(prev => [
        ...prev.filter(m => m.id !== PENDING_ID),
        { id: userMsgId, role: 'user', text: trimmed },
        { id: assistantMsgId, role: 'assistant', text: '', toolCalls: [], streaming: true },
      ]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setStreaming(true);
      pinnedRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, conversationId }),
          signal: controller.signal,
        });

        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));

              if (event.type === 'text') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMsgId ? { ...m, text: m.text + event.content } : m
                  )
                );
              } else if (event.type === 'tool_start') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          toolCalls: [
                            ...(m.toolCalls ?? []),
                            { id: event.id, name: event.name, status: 'pending' as const },
                          ],
                        }
                      : m
                  )
                );
              } else if (event.type === 'tool_done') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          toolCalls: m.toolCalls?.map(tc =>
                            tc.id === event.id ? { ...tc, status: 'done' as const } : tc
                          ),
                        }
                      : m
                  )
                );
              } else if (event.type === 'tool_error') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          toolCalls: m.toolCalls?.map(tc =>
                            tc.id === event.id ? { ...tc, status: 'error' as const } : tc
                          ),
                        }
                      : m
                  )
                );
              } else if (event.type === 'done') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMsgId ? { ...m, streaming: false } : m
                  )
                );
              } else if (event.type === 'error') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMsgId
                      ? { ...m, text: `Something went wrong: ${event.message}`, streaming: false }
                      : m
                  )
                );
              }
            } catch {
              // Malformed SSE line — skip
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // User hit Stop. Keep whatever streamed in; the server finishes and
          // saves the full reply, so poll until it lands and swap it in.
          setMessages(prev =>
            prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
          );
          startPolling();
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? { ...m, text: `Connection error: ${String(err)}`, streaming: false }
                : m
            )
          );
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [conversationId, streaming, startPolling]
  );

  // Auto-send seed prompt from Reports page
  useEffect(() => {
    if (seedPrompt && !seededRef.current && messages.length === 0) {
      seededRef.current = true;
      sendMessage(seedPrompt);
    }
  }, [seedPrompt, sendMessage, messages.length]);

  const isEmpty = messages.length === 0 && !seedPrompt;

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty && (
          <div className="pt-8">
            <p className="text-center text-muted text-sm mb-6">What's on your mind?</p>
            <div className="space-y-2">
              {SUGGESTED_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="w-full text-left px-4 py-3 rounded-xl bg-surface-card border border-surface-border text-sm text-gray-300 active:bg-surface-border transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <p className="text-center text-muted text-xs uppercase tracking-wide mt-8 mb-3">Reports</p>
            <div className="grid grid-cols-2 gap-2">
              {REPORT_PROMPTS.map(r => (
                <button
                  key={r.title}
                  onClick={() => sendMessage(r.prompt)}
                  className="flex items-center gap-2 px-3 py-3 rounded-xl bg-surface-card border border-surface-border text-sm text-gray-300 active:bg-surface-border transition-colors"
                >
                  <span>{r.emoji}</span>
                  <span className="text-left leading-tight">{r.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 pb-4 pt-3 border-t border-surface-border">
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask your coach…"
            rows={1}
            className="flex-1 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-primary leading-snug transition-colors"
          />
          {streaming ? (
            <button
              onClick={stopStreaming}
              className="w-11 h-11 rounded-full bg-surface-card border border-surface-border flex items-center justify-center active:scale-90 transition-transform flex-shrink-0"
              aria-label="Stop"
            >
              <Square size={14} className="text-red-400 fill-red-400" />
            </button>
          ) : (
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform flex-shrink-0"
              aria-label="Send"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
