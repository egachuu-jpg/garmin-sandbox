'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { MessageBubble, type Message, type ToolCall } from './MessageBubble';

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

export function ChatInterface({ conversationId, initialMessages = [], seedPrompt }: Props) {
  const [messages, setMessages] = useState<Message[]>(
    initialMessages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      text: m.text,
      toolCalls: m.tool_calls ?? undefined,
    }))
  );
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const trimmed = text.trim();
      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      setMessages(prev => [
        ...prev,
        { id: userMsgId, role: 'user', text: trimmed },
        { id: assistantMsgId, role: 'assistant', text: '', toolCalls: [], streaming: true },
      ]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setStreaming(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, conversationId }),
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
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, text: `Connection error: ${String(err)}`, streaming: false }
              : m
          )
        );
      } finally {
        setStreaming(false);
      }
    },
    [conversationId, streaming]
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
            disabled={streaming}
            className="flex-1 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-primary disabled:opacity-50 leading-snug transition-colors"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            className="w-11 h-11 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform flex-shrink-0"
            aria-label="Send"
          >
            {streaming ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
