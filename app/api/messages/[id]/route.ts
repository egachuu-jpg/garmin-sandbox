import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const messages = await query<{
    id: string;
    role: string;
    text: string;
    tool_calls: unknown;
    completed: boolean;
    created_at: string;
  }>(
    `SELECT id, role, text, tool_calls, completed, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  return NextResponse.json(messages);
}
