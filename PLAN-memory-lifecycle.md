# PLAN-memory-lifecycle — archive/update coach memory + management UI

**Leverage rank: 2 of 5.** Coach memory is injected into the system prompt on **every**
chat turn, and today it is append-only. Over a 17-week plan (currently ~Week 3), stale
and contradictory notes ("SI flare, drop intensity" from three weeks ago next to "SI
feels great") directly degrade every coaching answer. Fixing lifecycle now compounds:
the earlier it lands, the less junk accumulates.

## Goal

1. Add an `archived` flag to `coach_memory` (never hard-delete — it's the athlete's
   medical/coaching history).
2. Give the coach two new synthetic tools: `update_memory` (revise a note) and
   `forget` (archive a note), plus prompt guidance to use them.
3. Add a small "Memory" management UI as a fourth segment on the Training tab
   (view, archive, restore).

## Files to touch

| File | Change |
|---|---|
| `db/schema.sql` | idempotent `ALTER TABLE` for `archived`, `updated_at` |
| `lib/coach-tools.ts` | include `id` in `loadMemories` + filter archived; add `update_memory` and `forget` to `SYNTHETIC_TOOLS` |
| `lib/coach-prompt.ts` | `MemoryNote` gains `id`; render ids in memory lines; extend `MEMORY_GUIDANCE` |
| `app/api/memory/route.ts` | **new** — GET all notes (active + archived) |
| `app/api/memory/[id]/route.ts` | **new** — PATCH `{ archived }` |
| `components/training/MemoryList.tsx` | **new** — list + archive/restore UI |
| `components/training/TrainingTabs.tsx` | add `memory` tab |
| `app/(app)/training/page.tsx` | accept `?tab=memory` |
| `components/chat/MessageBubble.tsx` | add `TOOL_LABELS` entries for the two new tools |
| `CLAUDE.md`, `TODO.md` | document / check off |

## Steps, in order

### 1. Schema

Append to `db/schema.sql`, next to the existing `ALTER TABLE messages ...` precedent:

```sql
-- Memory lifecycle: notes are archived (never deleted) when stale or superseded.
ALTER TABLE coach_memory ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE coach_memory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
```

The migration runs automatically at boot via `start.sh` → `node db/migrate.js`, and
`npm run db:migrate` applies it locally. The whole schema file is re-run every boot, so
these must be `IF NOT EXISTS` — they are.

### 2. `loadMemories` returns ids and skips archived

In `lib/coach-tools.ts`, change `loadMemories()`:

```ts
export async function loadMemories(): Promise<MemoryNote[]> {
  const rows = await query<{ id: string; category: string; note: string; created_at: string }>(
    `SELECT id, category, note, created_at FROM coach_memory
     WHERE archived = FALSE ORDER BY created_at ASC LIMIT 200`
  );
  return rows.map(r => ({
    id: r.id,
    category: r.category,
    note: r.note,
    date: new Date(r.created_at).toISOString().split('T')[0],
  }));
}
```

In `lib/coach-prompt.ts`: `export type MemoryNote = { id: string; date: string; category: string; note: string };`
and in `renderMemory` render the id so the coach can reference it:

```ts
.map(m => `- [${m.date} · ${m.category} · id:${m.id}] ${m.note}`)
```

Full UUIDs in the prompt are fine: the system prompt carries a `cache_control`
breakpoint, so the extra tokens are cached across rounds. Do NOT invent short ids or
index numbers — indices shift as notes are added/archived and the model will archive
the wrong note.

### 3. New synthetic tools

In `lib/coach-tools.ts`, add above `SYNTHETIC_TOOLS`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateMemory: SyntheticTool = {
  definition: {
    name: 'update_memory',
    description:
      'Revise an existing coach-memory note when the situation has evolved (an injury healed, a preference changed, a decision was superseded). Pass the id shown in the Coach Memory list. Replaces the note text (and optionally category) in place.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The memory id from the Coach Memory list.' },
        note: { type: 'string', description: 'The full replacement text (not a diff).' },
        category: { type: 'string', enum: ['injury', 'subjective', 'preference', 'decision', 'note'] },
      },
      required: ['id', 'note'],
    },
  },
  async execute(input) {
    const { id, note, category } = input as { id?: string; note?: string; category?: string };
    if (!id || !UUID_RE.test(id)) return `Error: "${id}" is not a valid memory id. Use the exact id from the Coach Memory list.`;
    if (!note?.trim()) return 'Error: note text is required.';
    const row = await queryOne<{ id: string }>(
      `UPDATE coach_memory SET note = $2, category = COALESCE($3, category), updated_at = NOW()
       WHERE id = $1 AND archived = FALSE RETURNING id`,
      [id, note.trim(), category ?? null]
    );
    return row ? 'Memory updated.' : `Error: no active memory found with id ${id}.`;
  },
};

const forget: SyntheticTool = {
  definition: {
    name: 'forget',
    description:
      'Archive a coach-memory note that is stale, resolved, or contradicted by newer information. The note is hidden from your memory list but never deleted. Pass the id shown in the Coach Memory list.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The memory id from the Coach Memory list.' },
      },
      required: ['id'],
    },
  },
  async execute(input) {
    const { id } = input as { id?: string };
    if (!id || !UUID_RE.test(id)) return `Error: "${id}" is not a valid memory id. Use the exact id from the Coach Memory list.`;
    const row = await queryOne<{ id: string }>(
      `UPDATE coach_memory SET archived = TRUE, updated_at = NOW()
       WHERE id = $1 AND archived = FALSE RETURNING id`,
      [id]
    );
    return row ? 'Memory archived.' : `Error: no active memory found with id ${id}.`;
  },
};

export const SYNTHETIC_TOOLS: SyntheticTool[] = [remember, suggestRoute, updateMemory, forget];
```

Why the regex gate matters: passing a non-UUID string to a `uuid` column makes Postgres
throw `invalid input syntax for type uuid`, which surfaces as a raw tool error instead
of a correctable message the model can act on. Return error **strings**, never throw —
the agent loop treats thrown errors as `tool_error` chips; returned strings let the
coach self-correct.

### 4. Prompt guidance

In `lib/coach-prompt.ts`, extend `MEMORY_GUIDANCE` (keep the existing text, append):

```
You also have `update_memory` and `forget` tools, keyed by the id shown on each memory
line. Actively curate: when a note is contradicted, superseded, or resolved (an injury
healed, a preference reversed, a temporary decision expired), update it or archive it
instead of stacking a new note on top. Prefer one accurate note over a contradictory
trail. When an injury resolves, update the note to say it resolved (with the date)
rather than forgetting it — resolved injuries are still coaching history. Use `forget`
for notes that carry no future value.
```

### 5. Memory API routes

`app/api/memory/route.ts` — follow the shape of `app/api/messages/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  const rows = await query(
    `SELECT id, category, note, archived, created_at, updated_at
     FROM coach_memory ORDER BY created_at DESC`
  );
  return NextResponse.json(rows);
}
```

`app/api/memory/[id]/route.ts` — note the Next 15 async-params pattern (copy it from
`app/api/messages/[id]/route.ts`, `params` is a `Promise` and must be awaited):

```ts
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { archived } = await req.json();
  if (typeof archived !== 'boolean') {
    return NextResponse.json({ error: 'archived (boolean) is required' }, { status: 400 });
  }
  const row = await queryOne(
    `UPDATE coach_memory SET archived = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id, archived]
  );
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

These routes are behind the session middleware automatically (everything except
`/login`, `/api/auth`, `/sw.js` is). No extra auth work.

### 6. UI — `components/training/MemoryList.tsx`

A `'use client'` component. Mirror the existing fetch/loading conventions in
`components/workouts/GearList.tsx` (read it first and copy its card/list styling
classes — `bg-surface-card border border-surface-border rounded-2xl` etc.).

Behavior:

- On mount, `fetch('/api/memory')`; keep rows in state.
- Two sections: **Active** (archived = false) and, below it, a collapsed
  "Archived (N)" section that expands on tap.
- Each row: category as a small colored chip (reuse the tool-chip styling pattern from
  `MessageBubble.tsx` if no better precedent), note text, `created_at` date
  (`YYYY-MM-DD` is fine), plus "edited <date>" when `updated_at` is set.
- Each active row has an **Archive** button; archived rows have **Restore**. Both
  `PATCH /api/memory/{id}` with `{ archived: true|false }`, optimistically update
  local state, and revert on non-OK response.
- No editing UI — text edits go through the coach (`update_memory`). Say so in a muted
  footer line: "To edit a note, ask the coach in chat."
- Empty state: "No memories yet — the coach saves durable notes here as you chat."
- Make the buttons real `<button>` elements ≥44px tall (the TODO has a standing
  touch-target complaint — don't add new violations).

### 7. Wire the tab

`components/training/TrainingTabs.tsx`:

- `export type TrainingTab = 'schedule' | 'plan' | 'gear' | 'memory';`
- Add `{ key: 'memory', label: 'Memory' }` to `TABS`.
- Extend the render ternary: `tab === 'memory' ? <MemoryList /> : ...`.

`app/(app)/training/page.tsx` — the tab param is validated inline; add the new value:

```ts
const initialTab =
  tab === 'plan' ? 'plan' : tab === 'gear' ? 'gear' : tab === 'memory' ? 'memory' : 'schedule';
```

### 8. Tool chips

In `components/chat/MessageBubble.tsx` `TOOL_LABELS`, add:

```ts
update_memory: 'Updating memory',
forget: 'Archiving memory',
```

### 9. Docs

- `CLAUDE.md`: in the Database Schema section note `archived` on `coach_memory`; in the
  synthetic-tools mention, list all four (`remember`, `suggest_route`, `update_memory`,
  `forget`); note the Memory segment on `/training`.
- `TODO.md`: check off the "Coach memory lifecycle" item.

## Edge cases a weaker model would miss

1. **Never DELETE.** Both the tool and the UI archive. Medical history (SI joint) must
   remain recoverable. The only destructive SQL verb in this whole plan is `UPDATE`.
2. **Ids must be real UUIDs rendered in the prompt** — not list indices. Indices
   silently re-point to different notes as the list changes between the model reading
   the prompt and calling the tool.
3. **Regex-validate before querying** — a malformed id crashes the query with a
   Postgres cast error instead of returning a model-correctable message.
4. **Return error strings from `execute`, don't throw** — thrown errors become opaque
   `tool_error` chips; returned strings teach the model to retry with the right id.
5. **`WHERE archived = FALSE` in the tools' UPDATEs** — otherwise `update_memory` can
   silently resurrect-and-edit an archived note the coach can't even see.
6. **Next 15 async `params`** in the `[id]` route — `{ params }: { params: Promise<...> }`
   then `await params`. Copying an older Next 14 signature type-errors the build.
7. **`renderMemory` still handles the empty list** — after filtering archived rows the
   list can become empty again; the existing "no saved notes" branch must remain.
8. **Don't cache `/api/memory`** in the service worker or server-side — it must reflect
   archives immediately. (The SW only snapshots `/api/dashboard`; just don't add more.)
9. The `LIMIT 200` in `loadMemories` stays — the prompt must not grow unboundedly.

## Acceptance criteria

- [ ] `npm run db:migrate` runs clean twice in a row (idempotent).
- [ ] `npx tsc --noEmit` and `npm run build` pass.
- [ ] In chat, telling the coach "my SI joint issue from last week is fully resolved,
      update your notes" results in an `update_memory` or `forget` tool chip, and the
      change is visible on Training → Memory.
- [ ] Asking the coach to remember something new still works (`remember` unbroken).
- [ ] Training → Memory lists active notes with category/date, Archive moves a note to
      the Archived section, Restore moves it back; hard-refresh shows the same state
      (server truth, not just optimistic state).
- [ ] An archived note no longer appears in the system prompt: archive a note, send a
      chat message, and confirm the coach no longer knows it (or inspect
      `getCoachSystemPrompt` output in a quick script).
- [ ] `curl -X PATCH .../api/memory/<id>` with `{"archived": 1}` (non-boolean) → 400;
      unknown id → 404.
- [ ] Direct DB check: `SELECT count(*) FROM coach_memory` never decreases during any
      of the above (nothing was deleted).
