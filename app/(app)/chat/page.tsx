import { v4 as uuidv4 } from 'uuid';
import Link from 'next/link';
import { query } from '@/lib/db';
import { getPlanContext } from '@/lib/training';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { HistorySheet } from '@/components/chat/HistorySheet';

export const dynamic = 'force-dynamic';

type SearchParams = { id?: string; prompt?: string; new?: string };

type MsgRow = { id: string; role: string; text: string; tool_calls: unknown };

const loadMessages = (conversationId: string) =>
  query<MsgRow>(
    `SELECT id, role, text, tool_calls FROM messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { id, prompt, new: forceNew } = await searchParams;

  // Resolve which conversation to show:
  //  - explicit ?id=        → that conversation
  //  - ?new=1 (New chat / reports) → a fresh conversation
  //  - otherwise            → resume today's chat if one exists, else fresh
  let conversationId: string;
  let initialMessages: MsgRow[] = [];

  if (id) {
    conversationId = id;
    initialMessages = await loadMessages(id);
  } else if (forceNew) {
    conversationId = uuidv4();
  } else {
    const startOfToday = getPlanContext().startOfTodayUTC.toISOString();
    const [todays] = await query<{ id: string }>(
      `SELECT id FROM conversations
       WHERE updated_at >= $1 ORDER BY updated_at DESC LIMIT 1`,
      [startOfToday]
    );
    if (todays) {
      conversationId = todays.id;
      initialMessages = await loadMessages(todays.id);
    } else {
      conversationId = uuidv4();
    }
  }

  return (
    // h-dvh (not h-screen): mobile Safari's keyboard and URL bar don't shrink
    // 100vh, which left the input bar hidden behind the keyboard.
    <div className="flex flex-col h-dvh bg-surface">
      <div className="flex items-center justify-between px-4 safe-top pb-3 border-b border-surface-border">
        <h1 className="text-lg font-semibold">Coach</h1>
        <div className="flex items-center gap-5">
          <HistorySheet currentId={conversationId} />
          <Link href="/chat?new=1" className="text-sm text-primary font-medium">
            New chat
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-hidden pb-20">
        <ChatInterface
          conversationId={conversationId}
          initialMessages={initialMessages as Parameters<typeof ChatInterface>[0]['initialMessages']}
          seedPrompt={prompt}
        />
      </div>
    </div>
  );
}
