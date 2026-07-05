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

Done (July 2026): Routes bottom-sheet layout (full-height map, drag-handle-only
sheet in `components/routes/BottomSheet.tsx`); offline PWA shell
(`public/sw.js` + `RegisterSW`) — network-first pages, cache-first hashed
assets, `/api/dashboard` snapshot stamped `x-sw-fetched-at` for the offline
banner, `/api/chat` never intercepted, `/sw.js` excluded from auth middleware
so the SW update cycle survives cookie expiry.

## Architecture / backend

Done (July 2026): agent loop extracted to `lib/agent.ts` with a synthetic-tool
registry (`lib/coach-tools.ts`); per-round turn persistence with a `completed`
column (run `npm run db:migrate` after deploying); 25-round loop cap;
tool-result elision beyond the last 3 turns + a cache breakpoint on the last
message; MCP client eviction on subprocess death. Note: `repairToolPairing()`
was kept deliberately — it's now the *designed* recovery path for replaying
turns that crashed between persisting a round and its tool results.

- [ ] **Unit tests over the pure logic** (vitest): `repairToolPairing`,
      `buildAnthropicMessages` (incl. elision), `getPlanContext`, route
      scoring, `sampleWaypoints` — the git log shows repeated regressions
      here. These helpers are now exported from `lib/agent.ts`.
- [ ] **One-time migration of legacy `raw_content` rows** to the
      `MessageParam[]` format, then delete the format-sniffing in
      `buildAnthropicMessages()`.
- [ ] **Coach memory lifecycle** — `archived` flag, a synthetic
      `update_memory`/`forget` tool, and a small management UI; append-only
      memory accumulates stale/contradictory notes over a 17-week plan.
- [ ] **Zod schemas for Garmin tool responses** in `/api/dashboard` instead
      of the `pickNumber`/`searchKey` key-hunting (already bitten twice).
- [ ] **Signed session cookie** — store an HMAC-signed expiring token
      instead of the raw passphrase; constant-time compare in `/api/auth`
      (use `crypto.timingSafeEqual`).
- [ ] **Move the athlete profile to the DB/config** — zones, goal, SI
      protocol are hardcoded in `lib/coach-prompt.ts` and *duplicated* in
      `app/api/insight/route.ts`; a pace tweak shouldn't be a deploy.
- [ ] **Centralize the model ID** — `lib/agent.ts` exports `COACH_MODEL`;
      point `app/api/insight/route.ts` at it (or an env var).
- [ ] **Don't stream raw error internals to the client** in the chat SSE
      `error` event.
