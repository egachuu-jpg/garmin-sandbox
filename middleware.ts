import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const session = req.cookies.get('session')?.value;
  if (session !== process.env.APP_PASSPHRASE) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // sw.js must stay reachable without a session: the browser refetches it on
  // its own schedule to check for updates, and a login redirect there would
  // silently break the service worker update cycle after cookie expiry.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon|sw.js).*)'],
};
