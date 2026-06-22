import { v4 as uuidv4 } from 'uuid';
import Link from 'next/link';
import { query } from '@/lib/db';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { BottomNav } from '@/components/nav/BottomNav';

type SearchParams = { id?: string; prompt?: string };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { id, prompt } = await searchParams;
  const conversationId = id ?? uuidv4();

  const initialMessages = id
    ? await query<{
        id: string;
        role: string;
        text: string;
        tool_calls: unknown;
      }>(
        `SELECT id, role, text, tool_calls FROM messages
         WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [id]
      )
    : [];

  return (
    <div className="flex flex-col h-screen bg-surface">
      <div className="flex items-center justify-between px-4 safe-top pb-3 border-b border-surface-border">
        <h1 className="text-lg font-semibold">Coach</h1>
        <Link href="/chat" className="text-sm text-primary font-medium">
          New chat
        </Link>
      </div>

      <div className="flex-1 overflow-hidden pb-20">
        <ChatInterface
          conversationId={conversationId}
          initialMessages={initialMessages as Parameters<typeof ChatInterface>[0]['initialMessages']}
          seedPrompt={prompt}
        />
      </div>

      <BottomNav />
    </div>
  );
}
