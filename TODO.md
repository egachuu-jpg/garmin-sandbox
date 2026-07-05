# TODO

Backlog from the project + UX review (July 2026). Items are roughly ordered by
value within each section. The five items already done: 4-tab nav with shared
layout, chat QoL bundle (stop button, live input, pinned autoscroll, h-dvh,
history sheet), readiness/sleep/battery color coding, Routes form collapse +
delete confirmation, Plan week math unified on `getPlanContext()`.

## UX / UI

- [ ] **Make the home "Today's workout" card tappable** — open chat seeded
      with "walk me through today's workout" (the seed-prompt mechanism
      already exists).
- [ ] **Show today's *actual* scheduled Garmin workout on Home** instead of
      the static transcribed plan (`lib/plan-schedule.ts`); fall back to the
      static plan when nothing is scheduled. The coach adapts workouts, so
      the static plan drifts from reality.
- [ ] **Add resting HR to the home stat chips** (fetched by `/api/dashboard`
      and known to `/api/insight`, but never displayed) — or stop fetching it.
- [ ] **Anchor the insight panel under the tapped tile** (or scroll it into
      view) — it currently always expands below all three chips.
- [ ] **Chat: day dividers + timestamps** — messages need `created_at`
      exposed via the messages API and rendered as date separators.
- [ ] **Sync `TOOL_LABELS` in `components/chat/MessageBubble.tsx` with the
      real tool names** in `COACH_TOOLS` (most entries are stale —
      `get_hrv` vs `get_hrv_data` etc. — so chips fall back to raw names).
- [ ] **Friendlier chat errors** — raw error strings currently render inside
      the coach bubble; show a generic message + retry button, log details.
- [ ] **Scheduled workouts: highlight today + group by week** — the list is
      flat with no "today" anchor.
- [ ] **Make Plan week rows tappable** — seed chat with "What's Week N look
      like?" (only the current week has a Details link today).
- [ ] **Routes: bottom-sheet layout** — full-height map with controls in a
      draggable sheet (the standard map UX); the collapse-after-generate is
      a stopgap.
- [ ] **Fix nested interactive elements in RouteBuilder** — candidate/saved
      cards are `<button>`s containing `role="button"` spans.
- [ ] **Bump under-sized touch targets to ~44px** — preference `Chip`s
      (~30px), 15px refresh icons, text-only Close/Retry buttons.
- [ ] **Drop `userScalable: false, maximumScale: 1`** from
      `app/layout.tsx` viewport — blocks pinch-zoom (accessibility).
- [ ] **Define semantic text tokens** (`text-body` / `text-secondary` /
      `text-faint`) in the Tailwind config and sweep the ad-hoc mix of
      `text-gray-100/200/300/400` / `text-muted`; check `text-muted` contrast
      at `text-xs` sizes.
- [ ] **Standardize loading states on skeletons** — `GearList` still uses
      plain "Loading gear…" text.
- [ ] **Unify icon language** — lucide for functional icons; emoji only as
      decoration (login, race day).
- [ ] **Offline PWA shell** — add a service worker that caches the app shell
      and the last dashboard snapshot ("as of 7:02 AM") so launching without
      signal doesn't show a browser error page.

## Architecture / backend

- [ ] **Persist the agentic turn per-round** in `app/api/chat/route.ts` —
      insert the assistant row up front and append after each tool round, so
      a mid-turn crash can't leave invisible side effects (workout scheduled,
      memory saved) with no chat record. Then delete `repairToolPairing()`.
- [ ] **Cap the agentic loop** (e.g. 25 rounds) and honor `req.signal`.
- [ ] **Elide old tool_result bodies on replay** — keep the blocks for
      pairing validity but replace content beyond the last N turns with a
      placeholder; unbounded conversations currently replay every raw Garmin
      payload forever.
- [ ] **Unit tests over the pure logic** (vitest): `repairToolPairing`,
      `buildAnthropicMessages`, `getPlanContext`, route scoring,
      `sampleWaypoints` — the git log shows repeated regressions here.
- [ ] **One-time migration of legacy `raw_content` rows** to the
      `MessageParam[]` format, then delete the format-sniffing in
      `buildAnthropicMessages()`.
- [ ] **Coach memory lifecycle** — `archived` flag, a synthetic
      `update_memory`/`forget` tool, and a small management UI; append-only
      memory accumulates stale/contradictory notes over a 17-week plan.
- [ ] **Zod schemas for Garmin tool responses** in `/api/dashboard` instead
      of the `pickNumber`/`searchKey` key-hunting (already bitten twice).
- [ ] **Signed session cookie** — store an HMAC-signed expiring token
      instead of the raw passphrase; constant-time compare in `/api/auth`.
- [ ] **MCP client recovery** — evict the cached `Client` from the map in
      `lib/mcp-client.ts` when the Python subprocess dies (transport
      close/error handler) so the next call reconnects.
- [ ] **Move the athlete profile to the DB/config** — zones, goal, SI
      protocol are hardcoded in `lib/coach-prompt.ts` and *duplicated* in
      `app/api/insight/route.ts`; a pace tweak shouldn't be a deploy.
- [ ] **Extract the agent loop** from `app/api/chat/route.ts` into
      `lib/agent.ts`; make synthetic tools a registry (`{schema, execute}`).
- [ ] **Centralize the model ID** (`claude-sonnet-4-6` is hardcoded in two
      files).
- [ ] **Don't stream raw error internals to the client** in the chat SSE
      `error` event.
