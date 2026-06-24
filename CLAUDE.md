# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**garmin-coach** is a mobile-first AI fitness coaching PWA built with Next.js 15 / React 19 / TypeScript. It connects Claude (claude-sonnet-4-6) to Garmin Connect data via a Python MCP server and persists conversations + coach memory in PostgreSQL. The app is deployed on Railway. There is one user (the athlete) and login is a simple shared passphrase cookie (`APP_PASSPHRASE`).

## Commands

```bash
# Install dependencies
npm install

# Local development (http://localhost:3000)
npm run dev

# Type-check only (no separate lint/test tooling exists)
npx tsc --noEmit

# Apply DB schema (idempotent — safe to re-run)
npm run db:migrate

# Production build
npm run build
npm start
```

**No test suite or ESLint config exists.** TypeScript strict mode (`tsconfig.json`) is the primary correctness check.

## Environment Variables

Copy `.env.example` to `.env` for local development:

| Variable | Purpose |
|---|---|
| `APP_PASSPHRASE` | Login password (session cookie value) |
| `DATABASE_URL` | PostgreSQL connection string |
| `GARMIN_EMAIL` / `GARMIN_PASSWORD` | Garmin Connect credentials |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `PYTHON_BIN` | Path to Python with `garmin_mcp` installed (defaults to `python`; Railway uses `/opt/venv/bin/python`) |
| `GARMINTOKENS` | Volume path for Garmin OAuth token cache (Railway only: `/root/.garmin-mcp`) |

## Architecture

### Request Flow

```
Browser → middleware.ts (session auth)
       → Next.js App Router pages (app/)
       → API routes (app/api/)
         ├── /api/chat      → Anthropic agentic loop (SSE stream)
         ├── /api/dashboard → Garmin readiness snapshot
         ├── /api/workouts  → Garmin scheduled workouts
         └── /api/gear      → Shoe mileage tracking (DB + Garmin)
       → lib/mcp-client.ts (singleton MCP client → Python garmin_mcp subprocess)
       → lib/db.ts          (PostgreSQL pool)
```

### Agentic Loop (`app/api/chat/route.ts`)

This is the core of the app. A single POST request starts an **infinite loop** that:
1. Calls `anthropic.messages.stream(...)` with the full history + tools
2. Streams text chunks and tool events to the client via SSE (`data: <json>\n\n`)
3. If `stop_reason === 'tool_use'`, executes all tool calls in parallel via `executeTool()`, appends `tool_result` messages, and loops again
4. Exits when Claude returns without tool calls, then persists the full turn to the DB

**Prompt caching** is applied to both the system prompt and the tool list (marked `cache_control: { type: 'ephemeral' }`). This is critical — the ~60-tool schema list is large enough to hit Anthropic ITPM rate limits on every turn if uncached.

### MCP Client (`lib/mcp-client.ts`)

The Garmin MCP is a Python subprocess (`python -m garmin_mcp`) launched via `StdioClientTransport`. The `Client` instance is a **process-level singleton** (stored in a `Map`) — it is not recreated per request.

Tool names follow the pattern `{serverId}__{toolName}` (e.g. `taxuspt__get_activities`). `executeTool()` splits on `__` to route to the right server.

**`COACH_TOOLS` allowlist**: The MCP exposes ~110 tools but the coach only receives ~60. This keeps the token count manageable. The dashboard/workouts/gear API routes call `executeTool()` directly with hardcoded tool names and bypass this filter. To expose a new tool to the coach, add its base name (no prefix) to the `COACH_TOOLS` set.

### Database Schema (`db/schema.sql`)

Five tables:
- **conversations** — chat sessions (UUID, title, timestamps)
- **messages** — individual turns; `raw_content` (JSONB) holds the full `MessageParam[]` array including interleaved `tool_result` messages so the conversation can be replayed to Anthropic without breaking tool-use pairing. `tool_calls` (JSONB) is a UI-facing summary only.
- **gear** — running shoes with `mileage_offset` and `alert_threshold_miles` (default 400)
- **activity_gear** — links Garmin activity IDs to gear rows
- **coach_memory** — durable subjective notes (injuries, preferences, decisions) the coach saves via the synthetic `remember` tool

### Coach System Prompt (`lib/coach-prompt.ts`)

The system prompt is assembled fresh on every request from three parts:
1. **Static athlete profile** — goal, zones, SI joint protocol, schedule
2. **Live training context** — today's date in `America/Chicago` + current week/day within the 17-week plan (Week 1 Day 1 = Monday, June 22, 2026; race = October 17, 2026)
3. **Coach memory** — all rows from `coach_memory`, prepended as known history

The training date math lives in `lib/training.ts` and always uses Chicago timezone.

### SSE Event Types

The chat API streams newline-delimited `data:` events. The client in `components/chat/ChatInterface.tsx` handles:
- `{ type: 'text', content }` — append to current assistant bubble
- `{ type: 'tool_start', name, id }` — show tool spinner
- `{ type: 'tool_done', name, id }` — mark tool complete
- `{ type: 'tool_error', name, id }` — mark tool failed
- `{ type: 'done' }` — finalize the turn
- `{ type: 'error', message }` — surface error in UI

### Auth

`middleware.ts` checks that the `session` cookie equals `APP_PASSPHRASE` for every route except `/login` and `/api/auth`. There is no user table or token expiry.

## Key Constraints

- **`pg` and `@modelcontextprotocol/sdk` must remain server-side only.** `next.config.ts` marks them as `serverExternalPackages` to prevent Next.js from bundling them into the client.
- **`curl_cffi` requires `libstdc++.so.6` on `LD_LIBRARY_PATH` at runtime.** `start.sh` resolves this path via `find` and exports it before starting Next. Without it, the Python MCP subprocess crashes silently and all Garmin tools fail.
- **Garmin OAuth tokens are cached to a Railway volume** (`GARMINTOKENS=/root/.garmin-mcp`). After a fresh deploy, the first request triggers an interactive MFA flow in the Railway shell (`railway run python -m garmin_mcp`). Without the volume mount, tokens are lost on each redeploy.
- **`raw_content` format changed**: older messages stored `ContentBlock[]` (assistant only); newer messages store `MessageParam[]` (assistant + tool_result pairs). `buildAnthropicMessages()` in the chat route handles both formats.

## Deployment (Railway)

Railway builds with Nixpacks (`nixpacks.toml`): installs Python 3.11 venv with `garmin_mcp` and `curl_cffi`, then runs the Node build. The start command is `start.sh` (not `npm start` directly) to set `LD_LIBRARY_PATH`. See `DEPLOY.md` for the full Railway setup walkthrough including the MFA token-capture step.
