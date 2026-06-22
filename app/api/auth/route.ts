import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { passphrase } = await req.json();

  if (!passphrase || passphrase !== process.env.APP_PASSPHRASE) {
    return NextResponse.json({ error: 'Invalid passphrase' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', passphrase, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('session');
  return res;
}
