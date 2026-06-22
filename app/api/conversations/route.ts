import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  const conversations = await query<{
    id: string;
    title: string | null;
    updated_at: string;
    message_count: string;
  }>(
    `SELECT c.id, c.title, c.updated_at,
            COUNT(m.id)::text AS message_count
     FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT 50`
  );
  return NextResponse.json(conversations);
}
