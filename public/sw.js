/* Offline shell for the coach PWA.
 *
 * Design constraints (each one guards a real failure mode):
 *  - GET-only, same-origin-only, and never text/event-stream: the /api/chat
 *    SSE turn must NEVER be intercepted (a buffered/cached stream breaks the
 *    coach silently). /api/chat is a POST, but the Accept guard makes the
 *    invariant explicit.
 *  - Navigations are network-first: a deploy takes effect on the next online
 *    load — the SW can never pin the user to a stale build.
 *  - /_next/static/* is cache-first: filenames are content-hashed, so a
 *    cached entry can never be wrong, and offline HTML finds its chunks.
 *  - Responses that are redirects or non-200 are never cached: caching the
 *    login redirect would wedge the app into a bogus "shell" after cookie
 *    expiry.
 *  - Only /api/dashboard is cached (network-first, stamped with
 *    x-sw-fetched-at so the UI can say "data from 7:02 AM"). Every other
 *    /api route passes through untouched.
 */

const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;

self.addEventListener('install', () => {
  // Safe to activate immediately: nothing here couples to a specific build
  // (no precache manifest), and runtime caches are keyed by URL.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE, DATA_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
      // Best-effort pre-warm of the home shell (cacheable only if the session
      // cookie is valid — a login redirect is filtered out by cachePage).
      try {
        const res = await fetch('/');
        await cachePage(new Request('/'), res);
      } catch {
        /* offline at activate — fine */
      }
    })()
  );
});

function cacheable(res) {
  return res && res.ok && res.status === 200 && !res.redirected && res.type === 'basic';
}

async function cachePage(request, res) {
  if (!cacheable(res)) return;
  const url = new URL(request.url);
  if (url.pathname === '/login') return; // never treat login as the shell
  const cache = await caches.open(PAGE_CACHE);
  await cache.put(request, res.clone());
}

async function networkFirstPage(request) {
  try {
    const res = await fetch(request);
    await cachePage(request, res);
    return res;
  } catch {
    const cache = await caches.open(PAGE_CACHE);
    const hit =
      (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    // Uncached page. Do NOT serve cached '/' HTML under this URL — Next
    // hydrates against the address bar and would try to fetch this route's
    // RSC payload (offline → error page). Redirect home instead so the URL
    // and the served shell agree.
    const url = new URL(request.url);
    if (url.pathname !== '/' && (await cache.match('/'))) {
      return Response.redirect('/', 302);
    }
    return new Response(
      '<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#0f0f0f;color:#9ca3af;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Offline — reconnect and try again.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) await cache.put(request, res.clone());
  return res;
}

async function networkFirstDashboard(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    // no-store: the response has no Cache-Control, so without this the
    // browser's HTTP cache can "succeed" offline with an unstamped copy,
    // silently bypassing the snapshot (and its as-of banner).
    const res = await fetch(request, { cache: 'no-store' });
    if (cacheable(res)) {
      // Stamp the copy so the UI can render "data from <time>" when this
      // snapshot is later served offline.
      const body = await res.clone().arrayBuffer();
      const headers = new Headers(res.headers);
      headers.set('x-sw-fetched-at', new Date().toISOString());
      await cache.put(request, new Response(body, { status: 200, headers }));
    }
    return res;
  } catch {
    const hit = await cache.match(request);
    return (
      hit ||
      new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // map tiles, etc.
  if ((request.headers.get('accept') || '').includes('text/event-stream')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
  if (url.pathname === '/api/dashboard') {
    event.respondWith(networkFirstDashboard(request));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // network only — no exceptions
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  }
  // Everything else (manifest, icons, non-navigation GETs): default handling.
});
