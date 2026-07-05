'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History, X, MessageCircle } from 'lucide-react';

type Conversation = {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: string;
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Header button + bottom sheet for browsing past conversations. Fetched on
// open (not mount) so the chat page doesn't pay for it until it's wanted.
export function HistorySheet({ currentId }: { currentId: string }) {
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState(false);

  const openSheet = async () => {
    setOpen(true);
    setError(false);
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) throw new Error('bad status');
      setConversations(await res.json());
    } catch {
      setError(true);
    }
  };

  return (
    <>
      <button
        onClick={openSheet}
        aria-label="Chat history"
        className="p-2 -m-2 text-muted active:text-primary transition-colors"
      >
        <History size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md bg-surface-card border-t border-surface-border rounded-t-2xl p-4 pb-8 max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Past conversations</p>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-2 -m-2 text-muted">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2">
              {error ? (
                <p className="text-sm text-red-400 py-4 text-center">Couldn&apos;t load history</p>
              ) : conversations === null ? (
                <div className="space-y-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-14 rounded-xl bg-surface-border animate-pulse" />
                  ))}
                </div>
              ) : conversations.length === 0 ? (
                <p className="text-sm text-muted py-4 text-center">No conversations yet</p>
              ) : (
                conversations.map(c => (
                  <Link
                    key={c.id}
                    href={`/chat?id=${c.id}`}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-colors ${
                      c.id === currentId ? 'border-primary bg-primary/10' : 'border-surface-border'
                    }`}
                  >
                    <MessageCircle size={16} className="text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{c.title || 'Untitled chat'}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {fmtWhen(c.updated_at)} · {c.message_count} message{c.message_count === '1' ? '' : 's'}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
