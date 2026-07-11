# Lessons Learned

Non-obvious gotchas and decisions that shouldn't be re-litigated. One line each,
grouped by domain, deduped. No obvious advice — only hard-won constraints and real
decisions. Seeded from the Key Constraints already documented in CLAUDE.md.

## Anthropic / Agent Loop
- Model ID lives only in `lib/agent.ts` — never hardcode it elsewhere so a model retirement is a one-line change.
- Prompt caching (system prompt + tool list + last message block marked `cache_control: ephemeral`) is load-bearing: if `cache_read` stays 0 across loop rounds, caching is broken and the ~60-tool schema will hit ITPM rate limits every turn.
- The chat API deliberately does NOT abort the turn on client disconnect — per-round persistence + client polling depend on the turn finishing server-side.
- `raw_content` has two formats: older messages store `ContentBlock[]` (assistant only), newer store `MessageParam[]` (assistant + tool_result pairs). `buildAnthropicMessages()` handles both.

## MCP
- The Garmin MCP connection is a process-level singleton evicted on transport close, so a crashed subprocess reconnects on the next call instead of poisoning every request.
- To expose a new tool to the coach, add its base name (no prefix) to the `COACH_TOOLS` allowlist — the dashboard/workouts/gear routes bypass this filter by calling `executeTool()` with hardcoded names.

## Railway / Deploy
- `curl_cffi` needs `libstdc++.so.6` on `LD_LIBRARY_PATH` at runtime — `start.sh` resolves and exports it; without it the Python MCP subprocess crashes silently and all Garmin tools fail.
- Garmin OAuth tokens cache to a Railway volume (`GARMINTOKENS=/root/.garmin-mcp`); without the mount, tokens are lost on every redeploy and the first request needs an interactive MFA flow.

## Next.js
- `pg` and `@modelcontextprotocol/sdk` must stay server-side — `next.config.ts` marks them `serverExternalPackages` to keep Next from bundling them into the client.

## PWA / Service Worker
- Playwright's `setOffline` does not apply to fetches made inside a service worker — kill the server to test offline behavior.
- Never intercept non-GET or `text/event-stream` (the chat SSE turn), never cache redirects (login), and route offline navigation of uncached pages to `/` (Next hydrates against the address bar).
