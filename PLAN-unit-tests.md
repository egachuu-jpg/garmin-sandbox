# PLAN-unit-tests — Vitest coverage over the pure logic

**Leverage rank: 1 of 5 — do this first.** The git log shows repeated regressions in
exactly these helpers (tool pairing, elision, plan-week math, route sampling), there is
currently **zero** test tooling in the repo, and every other plan in this batch becomes
safer to execute once these tests exist. TypeScript strict mode is the only correctness
check today.

## Goal

Add vitest as the test runner and write unit tests for the pure, deterministic helpers:

- `repairToolPairing`, `buildAnthropicMessages`, `isMessageParamList` (`lib/agent.ts`)
- `getPlanContext` (`lib/training.ts`)
- `haversineMeters`, `bearingDeg`, `destinationPoint`, `pathDistanceMeters`,
  `windExposure`, `compassLabel` (`lib/geo.ts`)
- `sampleWaypoints`, `distanceScore`, `climbScore` (`lib/route-suggest.ts` — these must
  be **exported first**, see Step 2)

No integration tests, no mocking of Anthropic/Postgres/ORS. Pure functions only.

## Files to touch

| File | Change |
|---|---|
| `package.json` | add `vitest` devDependency + `"test": "vitest run"` script |
| `vitest.config.ts` | **new** — node environment, test env vars |
| `lib/route-suggest.ts` | add `export` to `sampleWaypoints`, `distanceScore`, `climbScore` (no other change) |
| `tests/agent.test.ts` | **new** |
| `tests/training.test.ts` | **new** |
| `tests/geo.test.ts` | **new** |
| `tests/route-suggest.test.ts` | **new** |
| `CLAUDE.md` | update the "No test suite" claims: mention `npm test` |
| `TODO.md` | check off the unit-tests item |

Do NOT touch `tsconfig.json`. Do NOT add a `tests/tsconfig.json`. Do NOT enable vitest
globals — always `import { describe, it, expect } from 'vitest'` in each test file, so
`npx tsc --noEmit` keeps passing without type config changes (the root tsconfig includes
`**/*.ts`, so test files are type-checked — that is intended).

## Steps, in order

### 1. Install and wire up vitest

```bash
npm install -D vitest
```

Add to `package.json` scripts: `"test": "vitest run"`.

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // lib/agent.ts constructs an Anthropic client at module load, and the SDK
    // THROWS at construction when no API key is present. A dummy key keeps the
    // import side-effect-free for tests (nothing in these tests calls the API).
    env: { ANTHROPIC_API_KEY: 'test-key-not-used' },
  },
});
```

**Critical trap:** if you skip the `env` block, `tests/agent.test.ts` fails at *import
time* with "The ANTHROPIC_API_KEY environment variable is missing", not at test time.
`lib/db.ts` and `lib/mcp-client.ts` are lazy (no connection/spawn at import) — no
mocking needed for them.

Use **relative imports** in tests (`../lib/agent`), not the `@/` alias — the alias lives
in tsconfig `paths` and vitest does not read it without extra resolve config. Keep it
simple.

### 2. Export the route-suggest helpers

In `lib/route-suggest.ts`, change these three declarations to `export function ...`:
`sampleWaypoints` (line ~56), `distanceScore` (line ~75), `climbScore` (line ~79).
Nothing else changes.

### 3. `tests/agent.test.ts`

Import `{ repairToolPairing, buildAnthropicMessages, isMessageParamList, type DBMessage }`
from `../lib/agent`.

Build content blocks with small helpers, e.g.:

```ts
const toolUse = (id: string) => ({ type: 'tool_use' as const, id, name: 'get_stats', input: {} });
const toolResult = (id: string) => ({ type: 'tool_result' as const, tool_use_id: id, content: 'ok' });
```

**`repairToolPairing` cases:**

1. *No tool use* → messages pass through unchanged.
2. *Properly paired* (assistant with `tool_use` id `t1`, next user message with
   `tool_result` for `t1`) → unchanged, no placeholder inserted.
3. *Dangling at end of history* (assistant with `tool_use t1`, no following message) →
   a new `{ role: 'user' }` message is appended containing exactly one `tool_result`
   with `tool_use_id: 't1'` and content mentioning "interrupted".
4. *Partially paired* (assistant uses `t1` and `t2`; next user message has a result for
   `t2` only) → the placeholder for `t1` is **unshifted into the existing user
   message's content**, so that message ends with results for both `t1` and `t2`, and
   no extra message is appended.
5. *Assistant with string content* (plain text turn) → untouched.

**Known behavior a naive test will trip over:** in case 4, `repairToolPairing`
**mutates the input** `next.content` array in place (`unshift`). Do not assert the
input array is unchanged; assert on the returned array. (Do not "fix" the mutation in
this plan — behavior-preserving tests only.)

**`buildAnthropicMessages` cases** (input is `DBMessage[]`; `raw_content` drives
everything for assistant rows):

1. *User row* → `{ role: 'user', content: msg.text }`.
2. *New-format assistant row* — `raw_content` is a `MessageParam[]` like
   `[{ role: 'assistant', content: [toolUse('t1')] }, { role: 'user', content: [toolResult('t1')] }]`
   → both messages are spliced into the output verbatim.
3. *Legacy assistant row* — `raw_content` is a bare `ContentBlock[]` like
   `[{ type: 'text', text: 'hi' }]` (no `role` key on the items) → emitted as one
   `{ role: 'assistant', content: <those blocks> }`. Verify `isMessageParamList`
   returns `false` for this shape and `true` for shape 2.
4. *Empty placeholder row* — `raw_content: []`, `text: ''` → produces **nothing** in
   the output (a crashed-before-content turn is skipped).
5. *Fallback text row* — `raw_content: null`, `text: 'hello'` → `{ role: 'assistant', content: 'hello' }`.
6. **Elision**: build 5 assistant turns each in new format with one tool_use/tool_result
   pair (distinct ids), interleaved with user rows. `KEEP_TOOL_RESULT_TURNS` is 3, so
   the tool_result content of the **first 2** assistant turns must be replaced with the
   elision note (a string starting with `[tool output elided`), while the **last 3**
   keep their original content. The `tool_result` *blocks* themselves must still exist
   in all 5 (pairing preserved — count them). Also verify the tool_use blocks are never
   touched.
7. *Elision + legacy rows*: legacy rows count toward the assistant-turn total but have
   no tool_results to elide — mixing 2 legacy + 3 new-format rows must not throw.

### 4. `tests/training.test.ts`

`getPlanContext(now?: Date)` takes an explicit `now` — never rely on the real clock.
It computes the date in `America/Chicago` regardless of the machine TZ (verify by not
setting `process.env.TZ`). Plan start: Monday 2026-06-22; race: 2026-10-17. Chicago is
UTC−5 (CDT) all summer.

| `now` (UTC instant) | Expected |
|---|---|
| `2026-06-22T05:00:00Z` (= Jun 22 00:00 CDT) | `daysSinceStart: 0`, `week: 1`, `dayOfWeek: 1`, `dayName: 'Monday'` |
| `2026-06-23T02:00:00Z` (= Jun 22 **9pm** CDT) | still `daysSinceStart: 0`, week 1 day 1 — the whole point of the Chicago anchoring |
| `2026-06-28T12:00:00Z` (Sunday Jun 28) | `daysSinceStart: 6`, `week: 1`, `dayOfWeek: 7` |
| `2026-06-29T12:00:00Z` (Monday Jun 29) | `daysSinceStart: 7`, `week: 2`, `dayOfWeek: 1` |
| `2026-06-20T12:00:00Z` (before plan) | `daysSinceStart: -2`, `week` clamped to `1`, `daysToRace: 119` |
| `2026-10-17T12:00:00Z` (race day) | `daysToRace: 0`, `week: 17` |
| `2026-11-01T12:00:00Z` (after race) | `daysToRace` negative, `week` clamped to `17` |

Also assert `startOfTodayUTC.toISOString()` starts with the expected `YYYY-MM-DD` for
the 9pm-CDT case (`2026-06-22`).

### 5. `tests/geo.test.ts`

Coordinates are `[lng, lat]` tuples (`LngLat`). Use loose tolerances
(`toBeCloseTo(..., digits)` or manual `Math.abs(...) < eps`) — these are spherical
approximations, not exact.

- `haversineMeters([0,0],[1,0])` ≈ 111,195 m (1° of longitude at the equator);
  within ±1,000 m.
- `bearingDeg([0,0],[1,0])` ≈ 90 (due east); `bearingDeg([0,0],[0,1])` ≈ 0 (due
  north). Accept ±1°.
- `destinationPoint([0,0], 90, 111_195)` lands near `[1, 0]`: lng ≈ 1 ±0.02, lat ≈ 0.
- Round-trip: `haversineMeters(start, destinationPoint(start, 37, 5000))` ≈ 5000 ±50.
- `pathDistanceMeters` of `[[0,0],[1,0],[1,1]]` equals
  `haversineMeters([0,0],[1,0]) + haversineMeters([1,0],[1,1])` exactly.
- `compassLabel(0)` = `'N'`, `compassLabel(90)` = `'E'`, `compassLabel(225)` = `'SW'`
  (check the actual label set in `lib/geo.ts` first — if it uses 16-point labels,
  adjust expectations to match the implementation, do not change the implementation).
- `windExposure`: read the JSDoc/type in `lib/geo.ts:50-65` first. Sanity cases: a due-east
  path (`[[0,0],[1,0]]` densified into ~10 collinear points) with wind FROM 90° (east)
  is all headwind → `lateHeadwindFraction` close to 1; with wind FROM 270° (west) it's
  all tailwind → close to 0. If the observed convention differs, match the
  implementation and say so in a test comment.

### 6. `tests/route-suggest.test.ts`

- `distanceScore(target, target)` = 1; `distanceScore(1.25 * t, t)` = 0 (25% off →
  floor); `distanceScore(1.125 * t, t)` = 0.5; never negative for wild inputs.
- `climbScore` with pref `'any'` = 0.5 regardless of route. With pref `'flat'`: a route
  of 10 km / 0 m ascent → 1; 10 km / 150 m+ ascent (≥15 m/km) → 0. Pref `'hilly'`
  mirrors it. Build minimal `OrsRoute` objects:
  `{ coordinates: [], distanceMeters: 10000, ascentMeters: X, descentMeters: 0, durationSeconds: 0 }`.
- `sampleWaypoints`:
  - fewer coords than `count` → returns every coord mapped to `{lat, lng}` (order
    preserved, lat/lng swapped correctly from `[lng, lat]` input — assert this
    explicitly, it's the classic bug).
  - a long straight line of 100 points → returns exactly 8 points; first equals the
    first coord, last equals the last coord.
  - exactly 2 coords → 2 points back.

### 7. Run everything

```bash
npm test            # all green
npx tsc --noEmit    # still passes (test files are type-checked too)
npm run build       # unaffected — vitest.config.ts and tests/ are not app code
```

### 8. Update docs

- `CLAUDE.md`: replace the two "No test suite or ESLint config exists" claims with a
  note that `npm test` runs vitest over `tests/` (pure-logic units only).
- `TODO.md`: mark the "Unit tests over the pure logic" item `[x]` with a one-line note.

## Edge cases a weaker model would miss

1. **The Anthropic constructor throws at import** without an API key — the vitest `env`
   block is load-bearing, not decorative.
2. **`repairToolPairing` mutates its input** in the partial-pairing branch. Write
   assertions against the return value only.
3. **Elision counts assistant DB rows, not Anthropic messages** — one DB assistant row
   can expand into several `MessageParam`s. Get the fixture counting right: 5 assistant
   *rows* → first 2 elided.
4. **`LngLat` is `[lng, lat]`**, but `sampleWaypoints` returns `{lat, lng}` objects.
   Swapped-axis fixtures produce tests that pass for the wrong reason; use asymmetric
   coordinates (e.g. lng 10, lat 50) so a swap fails loudly.
5. **Do not use `new Date('2026-06-22')` and local-time methods** in training fixtures —
   always full ISO instants with `Z`, and let `getPlanContext` do the TZ work.
6. **Don't add `"types": ["vitest/globals"]`** or `globals: true` — explicit imports
   keep tsconfig untouched.
7. `getDayWorkout`/`WORKOUTS_BY_WEEK` are data, not logic — don't test the plan tables.

## Acceptance criteria

- [ ] `npm test` exits 0 and reports tests across 4 files covering all functions listed
      in the Goal (at minimum: 5 repairToolPairing cases, 7 buildAnthropicMessages
      cases incl. both elision cases, 7 getPlanContext date rows, geo + route-suggest
      cases as specified).
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `lib/route-suggest.ts` diff shows only three added `export` keywords.
- [ ] No changes to `tsconfig.json`; no `.only`/`.skip` left in tests; no mocking
      libraries added.
- [ ] Deliberately breaking `KEEP_TOOL_RESULT_TURNS` to `1` makes an elision test fail
      (spot-check the tests actually bite, then revert).
