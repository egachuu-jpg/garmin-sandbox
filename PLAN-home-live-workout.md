# PLAN-home-live-workout — show today's real Garmin workout on Home, make the card tappable

**Leverage rank: 3 of 5.** The Home screen is the daily entry point, and its "Today's
workout" card shows the *static transcribed plan* (`lib/plan-schedule.ts`) — but the
coach adapts workouts and pushes them to Garmin, so the card drifts from reality
exactly when coaching is working. This plan covers the top two TODO UX items in one
change: live workout with static fallback, plus tap-to-chat seeding.

## Goal

1. The Home "Today's workout" card shows today's **actual scheduled Garmin workout**
   (from `/api/workouts`), falling back to the static plan entry when Garmin has
   nothing scheduled for today or the fetch fails.
2. Tapping the card opens the chat seeded with "Walk me through today's workout" (the
   seed-prompt mechanism already exists on `/chat`).

## Files to touch

| File | Change |
|---|---|
| `components/home/TodayWorkoutCard.tsx` | **new** client component |
| `app/(app)/page.tsx` | replace the inline card with the component |
| `TODO.md` | check off both items |
| `CLAUDE.md` | one-line update in Pages & Navigation if desired (optional) |

Nothing server-side changes: `/api/workouts` already returns a 21-day window of
scheduled workouts starting today, cached 5 minutes, and already degrades to
`{ workouts: [], error }` with **HTTP 200** on Garmin failure.

## Contract of `/api/workouts` (read `app/api/workouts/route.ts` before coding)

```ts
// GET /api/workouts -> { workouts: Workout[]; cached?: boolean; error?: string }
type Workout = {
  date: string | null;        // 'YYYY-MM-DD'
  name: string | null;
  sport: string | null;       // e.g. 'running', 'cycling'
  completed: boolean;
  workoutType: string | null;
  isRestDay: boolean;
  isRaceDay: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
};
```

## Steps, in order

### 1. Create `components/home/TodayWorkoutCard.tsx`

A `'use client'` component. Props — all computed **server-side** and passed down
(critical: do not compute "today" in the browser, see edge cases):

```ts
type Props = {
  today: string;                     // 'YYYY-MM-DD' in America/Chicago, from getPlanContext()
  dayName: string;
  week: number;
  daysToRace: number;
  fallback: { title: string; detail: string };  // the static plan entry
};
```

State machine:

1. Render the **fallback (static plan) content immediately** — no skeleton, no blank
   card. The static plan is a legitimate answer, not a loading state.
2. On mount, `fetch('/api/workouts')`. In the response, find today's workout:

```ts
const todays = (data.workouts ?? []).filter(w => w.date === today);
const live = todays.find(w => !w.isRestDay) ?? null;
```

3. If `live` exists, swap the card body to the live workout and show a small source
   label ("Scheduled on Garmin"); otherwise keep the static content with the label
   ("From plan"). Any fetch error, non-OK status, or thrown JSON parse → keep static
   silently (`catch` and do nothing).

Rendering the live workout:

- Title: `live.name`, falling back to `live.workoutType ?? live.sport ?? 'Workout'`
  when `name` is null (Garmin fields are nullable — never render the string "null").
- Detail line, built from what exists:
  - distance: `` `${(live.distanceMeters / 1609.34).toFixed(1)} mi` `` when
    `distanceMeters` is a positive number;
  - duration: `` `${Math.round(live.durationSeconds / 60)} min` `` when positive;
  - join the pieces with `' · '`; if neither exists, show the sport or the static
    `fallback.detail` — never an empty line.
- If `live.completed`, prefix a `✓ ` and keep showing it (an afternoon glance should
  say "done", not re-prescribe).
- If `live.isRaceDay`, title becomes `🏁 Race Day` regardless of name.

Keep the existing card chrome from `app/(app)/page.tsx` exactly (copy the current
JSX): outer `bg-surface-card border border-surface-border rounded-2xl p-5`, the
`Today · {dayName} · Week {week}` kicker, and the `Week {week} of 17 · {daysToRace}
days to race` footer row. The card must look identical to today's card except for the
body text, the small source label, and a chevron.

### 2. Make it tappable

Wrap the whole card in a Next `<Link>`:

```tsx
import Link from 'next/link';
const seed = encodeURIComponent('Walk me through today\'s workout');
<Link href={`/chat?new=1&prompt=${seed}`} className="block active:opacity-80 transition-opacity">
  ...card...
</Link>
```

**`new=1` is required, not optional.** Read `app/(app)/chat/page.tsx` +
`components/chat/ChatInterface.tsx` to see why: without `new=1` the chat page resumes
*today's existing conversation*, and `ChatInterface` only auto-sends `seedPrompt` when
`messages.length === 0` — so on any day the athlete already chatted, the tap would
silently do nothing. `new=1` forces a fresh conversation where the seed always fires.

Add a `ChevronRight` (lucide, size 18, `text-muted`) on the kicker row so the card
reads as tappable — match the pattern of the Coach callout link below it.

### 3. Slim down `app/(app)/page.tsx`

Replace the inline "Today's workout" `<div>` with:

```tsx
const { todayLabel, dayName, week: currentWeek, daysToRace, startOfTodayUTC } = getPlanContext();
const workout = getDayWorkout(currentWeek, dayName);
const today = startOfTodayUTC.toISOString().split('T')[0];
...
<TodayWorkoutCard
  today={today}
  dayName={dayName}
  week={currentWeek}
  daysToRace={daysToRace}
  fallback={workout}
/>
```

Keep `export const dynamic = 'force-dynamic'` — the page is date-sensitive.

### 4. Update TODO.md

Check off "Make the home 'Today's workout' card tappable" and "Show today's *actual*
scheduled Garmin workout on Home" with brief notes.

## Edge cases a weaker model would miss

1. **Timezone: never compute "today" in the client.** `new Date()` in the browser uses
   the device timezone, and the service worker even serves this page offline where
   clock drift is real. The server computes `today` via `getPlanContext()`
   (America/Chicago) and passes it as a prop; the client only string-compares
   `w.date === today`.
2. **`/api/workouts` failures are HTTP 200** with `{ workouts: [], error }` — checking
   `res.ok` alone is not enough to detect a Garmin failure, and it doesn't matter:
   empty list → static fallback. But a *non*-OK response (e.g. middleware redirect to
   `/login` after cookie expiry returns HTML) means `res.json()` throws — wrap the
   whole fetch-and-parse in try/catch and fall back silently.
3. **Rest days are real entries.** Garmin returns scheduled rest days
   (`isRestDay: true`). Filter them out before picking `live`, otherwise the card
   shows "Rest" on a day the static plan (correctly) also says rest — fine — but worse,
   a rest-day entry can coexist with a real workout on the same date; the real workout
   must win. Hence `filter(date).find(!isRestDay)`.
4. **Multiple workouts today** (e.g. run + strength): `find` picks the first non-rest
   one after the API's date sort — acceptable; do not try to render a list in this
   card.
5. **Nullable everything**: `name`, `sport`, `distanceMeters`, `durationSeconds` can
   each be null independently. Build the detail string defensively; test with a
   workout that has only a duration.
6. **No hydration mismatch**: the component must render the fallback on first paint
   (server HTML and client first render identical) and only swap after the fetch
   resolves in `useEffect`. Do not fetch during render or read `Date` during render.
7. **Nested interactive elements**: the card becomes a `<Link>` — do not put any
   `<button>` inside it (the RouteBuilder already has this bug per TODO; don't add
   another instance).
8. **The seed prompt is single-shot**, guarded by `seededRef` — but only within one
   mount. That's fine here; don't try to "fix" anything in ChatInterface.
9. **Offline PWA**: `/api/workouts` is *not* snapshotted by the service worker (only
   `/api/dashboard` is). Offline, the fetch rejects → static card. That's correct;
   don't add SW caching for it in this plan.

## Acceptance criteria

- [ ] `npx tsc --noEmit` and `npm run build` pass.
- [ ] With Garmin reachable and a workout scheduled today: Home shows that workout's
      name (+ distance/duration when present) and a "Scheduled on Garmin" label.
      Verify against Training → Schedule showing the same workout for today.
- [ ] With nothing scheduled today (or `GARMIN_EMAIL` unset locally): Home shows
      exactly the same static workout it shows on `main` today, with a "From plan"
      label. No spinner, no blank flash — static content on first paint.
- [ ] Kill the dev server's Garmin path (unset `PYTHON_BIN`/break creds): card still
      renders static, no console error dialog, no unhandled rejection in the browser
      console.
- [ ] Tapping the card lands on `/chat`, a **new** conversation, with "Walk me through
      today's workout" already sent and the coach responding. Works even when a chat
      conversation already exists today (this is the `new=1` regression to check).
- [ ] The card's visual chrome (kicker, footer, spacing) is unchanged vs. `main`
      except for the added chevron + source label.
- [ ] First paint (view-source / disable JS): static workout is present in the HTML —
      i.e., the fallback renders server-side, the live swap is progressive
      enhancement.
