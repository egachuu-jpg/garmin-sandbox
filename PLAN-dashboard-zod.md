# PLAN-dashboard-zod — validate Garmin payloads with Zod in /api/dashboard

**Leverage rank: 5 of 5.** The dashboard has been "bitten twice" (TODO's words) by
Garmin payload shape drift — the sleep-score dash and the body-battery bug both came
from `pickNumber`/`searchKey` blind key-hunting finding the wrong number or nothing.
Zod is already a dependency (v3.24) but unused here. Explicit schemas turn silent
wrong-number bugs into logged, diagnosable parse failures — while still degrading to a
dash, never a 500.

## Goal

Replace the `pickNumber`/`searchKey` key-hunting in `app/api/dashboard/route.ts` with
explicit Zod schemas per tool payload, in a new `lib/garmin-schemas.ts`, preserving
every piece of the existing resilience behavior:

- a failed/weird payload → `null` metric (dash in the UI), **never** a thrown error;
- `debugNull`-style logging of the unusable payload survives;
- the cache-only-on-success guard survives;
- documented fallback key chains survive as schema unions.

## Files to touch

| File | Change |
|---|---|
| `lib/garmin-schemas.ts` | **new** — schemas + `parseToolResult` + per-metric extractors |
| `app/api/dashboard/route.ts` | delete `pickNumber`/`searchKey`/`parseToolResult`, use the new extractors |
| `tests/garmin-schemas.test.ts` | **new** (if PLAN-unit-tests landed; otherwise skip and note it) |
| `TODO.md` | check off the Zod item |

Do **not** touch `app/api/workouts/route.ts` in this plan (its `extractList` shape-
guessing is a candidate for the same treatment later — keep the diff reviewable).

## Current knowledge to encode (from the code comments — read `app/api/dashboard/route.ts` first)

| Metric | Tool | Known shape |
|---|---|---|
| readiness | `get_training_readiness` | **array**, first element is the morning assessment, `{ score: number }` |
| hrv | `get_hrv_data` | snake_case: `last_night_avg_hrv_ms`, `weekly_avg_hrv_ms`, `last_night_5min_high_hrv_ms` (older camelCase fallbacks: `lastNightAvg`, `weeklyAvg`, `lastNight5MinHigh`) |
| sleep | `get_sleep_summary` | flat `{ sleep_score: number }`; raw-payload fallbacks `overall`, `sleepScore`, `value` — these may be nested, see below |
| battery | `get_stats` | `{ body_battery_current: number }`; raw fallback `bodyBatteryMostRecentValue` |
| restingHr | `get_rhr_day` | `restingHeartRate` or `value` — possibly nested, possibly `{ value: n }` wrapped |

Important subtlety the table hides: the old `searchKey` searched **recursively at any
depth** and also unwrapped `{ value: number }` objects. The flat primary keys
(`sleep_score`, `body_battery_current`, `last_night_avg_hrv_ms`, `score`) are curated
by garmin_mcp at the top level — schemas can require them flat. But the *fallback*
keys existed precisely for uncurated raw payloads where nesting is real. The design
below keeps one bounded recursive fallback instead of pretending nesting away.

## Steps, in order

### 1. Create `lib/garmin-schemas.ts`

```ts
import { z } from 'zod';

// MCP tool results arrive as [{ type: 'text', text: '<json or error text>' }].
// (Moved verbatim from app/api/dashboard/route.ts — same behavior.)
export function parseToolResult(content: unknown): unknown {
  let text = '';
  if (Array.isArray(content)) {
    text = content
      .map(c => (c && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .join('\n');
  } else if (typeof content === 'string') {
    text = content;
  } else {
    return content ?? null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text; // Garmin auth/MFA errors arrive as plain text — surfaced by logging
  }
}

// A Garmin number can be bare or wrapped as { value: n }.
const garminNumber = z.union([z.number(), z.object({ value: z.number() }).transform(o => o.value)]);

// Bounded fallback for uncurated raw payloads: find `key` at any depth (the old
// searchKey contract). Used ONLY when the curated flat schema fails.
function deepFind(root: unknown, keys: string[]): number | null { /* move searchKey+pickNumber here, unchanged */ }

const readinessSchema = z
  .union([z.array(z.unknown()).nonempty().transform(a => a[0]), z.unknown()])
  .pipe(z.object({ score: garminNumber }).passthrough());

const hrvSchema = z
  .object({
    last_night_avg_hrv_ms: garminNumber.optional(),
    weekly_avg_hrv_ms: garminNumber.optional(),
    last_night_5min_high_hrv_ms: garminNumber.optional(),
  })
  .passthrough()
  .transform(o => o.last_night_avg_hrv_ms ?? o.weekly_avg_hrv_ms ?? o.last_night_5min_high_hrv_ms ?? null);

const sleepSchema = z.object({ sleep_score: garminNumber }).passthrough().transform(o => o.sleep_score);
const statsSchema = z.object({ body_battery_current: garminNumber }).passthrough().transform(o => o.body_battery_current);
const rhrSchema = z.object({ restingHeartRate: garminNumber }).passthrough().transform(o => o.restingHeartRate);

// One extractor per metric: curated schema first, deepFind fallback keys second,
// null + caller-side logging last. NEVER throws.
export function extractReadiness(payload: unknown): number | null { ... }
export function extractHrv(payload: unknown): number | null { ... }      // fallbacks: ['lastNightAvg','weeklyAvg','lastNight5MinHigh']
export function extractSleepScore(payload: unknown): number | null { ... } // fallbacks: ['sleep_score','overall','sleepScore','value']
export function extractBodyBattery(payload: unknown): number | null { ... } // fallbacks: ['body_battery_current','bodyBatteryMostRecentValue']
export function extractRestingHr(payload: unknown): number | null { ... }  // fallbacks: ['restingHeartRate','value']
```

Each extractor's body is the same three lines:

```ts
const parsed = schema.safeParse(payload);
if (parsed.success && parsed.data !== null) return parsed.data;
return deepFind(payload, FALLBACK_KEYS);
```

Rules:

- **`safeParse` everywhere. Zero `.parse()` calls in this file.** A throwing schema
  turns "dash on the dashboard" into "500 on the dashboard" — the exact regression
  this plan must not cause.
- `.passthrough()` on every object schema (this is Zod **v3** — `.passthrough()`, not
  v4's `.loose()`); Garmin payloads carry dozens of extra keys and strict schemas
  would fail on all of them.
- The HRV transform returns `null` (not `undefined`) when no key matched, and the
  extractor treats that as fall-through to `deepFind`.
- Copy the old `searchKey`'s cycle guard (`seen` Set) into `deepFind` — Garmin
  payloads have been observed deeply nested; don't re-introduce an infinite-loop risk
  by "simplifying" it away.

### 2. Rewire `app/api/dashboard/route.ts`

- Delete local `parseToolResult`, `pickNumber`, `searchKey`.
- Import `parseToolResult` and the five extractors from `@/lib/garmin-schemas`.
- The `data` assembly becomes:

```ts
readiness: debugNull('get_training_readiness', readiness, extractReadiness(val(readiness))),
hrv:        debugNull('get_hrv_data',           hrv,       extractHrv(val(hrv))),
sleepScore: debugNull('get_sleep_summary',      sleep,     extractSleepScore(val(sleep))),
bodyBattery: debugNull('get_stats',             stats,     extractBodyBattery(val(stats))),
restingHr:  debugNull('get_rhr_day',            rhr,       extractRestingHr(val(rhr))),
```

- Keep **unchanged**: the `TOOL_NAMES` rejected-promise logging loop, `debugNull`
  (payload-snippet logging on null), `firstOf` becomes redundant (the readiness schema
  handles the array) — delete it, the TTL cache, and the cache-only-when-
  `bodyBattery`-or-`readiness`-non-null guard.
- Delete the now-stale comments that describe key-hunting; keep (move) the valuable
  ones: why `get_sleep_summary` over `get_sleep_data`, why `get_stats` over
  `get_body_battery` — those explain **tool choice**, which is still true. Put them
  next to the `executeTool` calls where they already sit.

### 3. Tests (only if `PLAN-unit-tests` has landed)

`tests/garmin-schemas.test.ts`, pure fixtures:

- readiness: `[{ score: 67, otherJunk: {} }]` → 67; `{ score: 67 }` (non-array) → 67;
  `[]` → null; `'Garmin auth failed: MFA required'` (string payload) → null.
- hrv: `{ last_night_avg_hrv_ms: 52 }` → 52; only `weekly_avg_hrv_ms: 48` → 48;
  legacy `{ lastNightAvg: 51 }` (camelCase, via deepFind) → 51; `{}` → null.
- sleep: `{ sleep_score: 80 }` → 80; nested raw
  `{ dailySleepDTO: { sleepScores: { overall: { value: 80 } } } }` → 80 (this is the
  documented raw shape the fallback exists for — the `overall` key holding
  `{ value }`); `null` → null.
- battery: `{ body_battery_current: 41 }` → 41; `{ bodyBatteryMostRecentValue: 41 }`
  → 41.
- restingHr: `{ restingHeartRate: 44 }` → 44; `{ allMetrics: { restingHeartRate: { value: 44 } } }`
  → 44.
- `parseToolResult`: `[{ type: 'text', text: '{"a":1}' }]` → `{a:1}`; text that isn't
  JSON → the string itself; `undefined` → null.
- Every extractor with a totally alien payload (`{ foo: 'bar' }`, `42`, `'error'`,
  `[]`) → null, **no throw** (wrap in `expect(() => ...).not.toThrow()` plus value
  assertions).

If the tests plan hasn't landed yet, note that in the commit message and skip this
step — do not bootstrap a test runner inside this plan.

### 4. `TODO.md`

Check off the "Zod schemas for Garmin tool responses" item.

## Edge cases a weaker model would miss

1. **Fulfilled-but-error payloads**: Garmin auth/MFA failures arrive as *successful*
   tool calls whose text is an error sentence. `parseToolResult` returns that string;
   every schema must fail cleanly on a string and land on null → `debugNull` logs it.
   This is the primary production failure mode (see the code comments) — test it.
2. **`safeParse` vs `parse`**: one `.parse()` anywhere converts a Garmin hiccup into a
   dashboard 500. The route has no try/catch around the extraction section (it never
   needed one) — keep it that way by construction, don't add one.
3. **Numbers wrapped as `{ value: n }`** — the old `searchKey` unwrapped these; the
   `garminNumber` union preserves that. Forgetting it silently breaks restingHr.
4. **readiness is a list** — first element is the morning assessment. A schema that
   expects a bare object nulls out every real payload. Handle array-or-object.
5. **Zod v3 API** (check `package.json`: `zod ^3.24`): `.passthrough()` is correct;
   v4 idioms (`z.looseObject`, `.loose()`) don't exist here. Also `.pipe()` after
   `.transform()` behaves differently than before it — follow the snippet.
6. **`0` is a valid metric value.** Body battery can genuinely be low; use
   `?? null` / explicit `!== undefined` checks, never truthiness (`o.x || fallback`
   would treat 0 as missing). Audit every `??` vs `||` in the transforms.
7. **Cache guard must survive**: caching a payload where everything nulled out pins
   dashes for 10 minutes even after Garmin recovers. The existing
   `if (data.bodyBattery !== null || data.readiness !== null)` line stays exactly.
8. **Don't delete `debugNull`** — schemas make failures *cleaner*, not *visible*;
   Railway log visibility is the only production diagnostic this app has.

## Acceptance criteria

- [ ] `npx tsc --noEmit` and `npm run build` pass.
- [ ] `grep -n "searchKey\|pickNumber" app/api/dashboard/route.ts` → no matches; the
      logic lives in `lib/garmin-schemas.ts`.
- [ ] With real Garmin creds: `curl localhost:3000/api/dashboard` returns the same
      numbers as before the change (compare against a pre-change curl saved to a
      file — this is the no-regression check that matters most).
- [ ] With broken creds (or `PYTHON_BIN` unset): route still returns 200 with nulls,
      and the server log shows per-tool `failed:`/`returned no usable value` lines
      including a payload snippet.
- [ ] `npm test` green, including the string-payload and alien-payload no-throw cases
      (if the test runner exists).
- [ ] Second `curl` within 10 minutes returns `"cached": true` only when at least one
      of readiness/bodyBattery was non-null on the first (cache guard intact).
