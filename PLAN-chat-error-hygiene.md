# PLAN-chat-error-hygiene — friendly chat errors + stop leaking internals

**Leverage rank: 4 of 5.** Today a failed turn dumps `String(err)` straight into the
coach bubble and over the wire — stack traces, Anthropic error bodies, and potentially
connection-string fragments from `pg` errors reach the client verbatim (`/api/chat`
SSE `error` event, `/api/insight` 502 body, `/api/workouts` error field). Small,
contained change; covers two TODO items at once ("Friendlier chat errors" and "Don't
stream raw error internals").

## Goal

1. Server: never send raw error internals to the client. Log full details server-side,
   send a generic message.
2. Client: a failed turn renders a friendly bubble with a **Retry** button instead of
   raw error text; a mid-stream *connection* drop reconciles via the existing polling
   path instead of pretending the turn failed.

## Files to touch

| File | Change |
|---|---|
| `app/api/chat/route.ts` | generic SSE error message |
| `app/api/insight/route.ts` | generic 502 body |
| `app/api/workouts/route.ts` | generic error field |
| `components/chat/MessageBubble.tsx` | `Message.error` flag + Retry button rendering |
| `components/chat/ChatInterface.tsx` | error state, retry handler, connection-drop → poll |
| `TODO.md` | check off both items |

Explicitly **not** in scope: the `Error: ${String(err)}` strings inside tool_results in
`lib/agent.ts` — those are *for the model* (it needs the real error to adapt) and are
never rendered raw in the UI (tool chips show only status). Do not change them.

## Steps, in order

### 1. `app/api/chat/route.ts` — sanitize the SSE error event

The `catch` already logs the full error (`console.error('[chat] turn failed:', err)`).
Change only the `send`:

```ts
send({ type: 'error', message: 'The coach hit a problem finishing this reply.' });
```

Do not remove the `console.error` — Railway logs are now the only place the real error
lives, which is the point.

### 2. `app/api/insight/route.ts` — sanitize the 502

Replace the catch body:

```ts
} catch (err) {
  console.error('[insight] failed:', err);
  return NextResponse.json({ error: 'Insight generation failed' }, { status: 502 });
}
```

(Check how the client renders this: find the component that fetches `/api/insight` —
`components/home/ReadinessPanel.tsx` — and confirm it shows the error string or a
generic failure. If it renders `error` verbatim, the new constant string is already
friendly; no client change needed there.)

### 3. `app/api/workouts/route.ts` — same treatment

In its catch, add `console.error('[workouts] failed:', err);` and change
`error: String(err)` to `error: 'Failed to load scheduled workouts'`.

### 4. Client message model — `components/chat/MessageBubble.tsx`

Extend the type:

```ts
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  streaming?: boolean;
  error?: boolean;   // failed turn — render retry affordance
};
```

`MessageBubble` gets an optional prop `onRetry?: () => void`. When
`message.error && onRetry`, render below the bubble text (inside the assistant bubble
div, after the Markdown):

```tsx
<button
  onClick={onRetry}
  className="mt-2 min-h-[44px] px-4 rounded-xl border border-surface-border text-sm font-medium text-gray-200 active:bg-surface-border transition-colors"
>
  Try again
</button>
```

(≥44px tall — there's a standing TODO about undersized touch targets; don't add a new
violation.)

### 5. `components/chat/ChatInterface.tsx` — three changes

**(a) Track the last sent text** so retry can resend it:

```ts
const lastSentRef = useRef<string>('');
```

Set `lastSentRef.current = trimmed;` at the top of `sendMessage`.

**(b) Distinguish the two failure paths** in the stream handling:

- Server `error` **event** (the SSE `{type:'error'}` case): the server-side turn
  failed and was finalized. Replace the current handler's raw-text rendering with:

```ts
} else if (event.type === 'error') {
  setMessages(prev =>
    prev.map(m =>
      m.id === assistantMsgId
        ? { ...m, text: m.text || 'The coach hit a problem finishing this reply.', streaming: false, error: true }
        : m
    )
  );
}
```

  Note `m.text || ...`: if partial text already streamed in, keep it and just add the
  retry affordance — don't wipe words the user already read.

- **Connection error** (the outer `catch` when `!controller.signal.aborted`): the
  fetch died but **the server keeps running the turn to completion and persists it**
  (that is this app's documented design — see the comment at the top of
  `app/api/chat/route.ts`). So do what the Stop button does: mark the bubble
  non-streaming and `startPolling()`, which swaps in the completed reply when it
  lands. Replace the current `Connection error: ${String(err)}` branch with:

```ts
} else {
  setMessages(prev =>
    prev.map(m =>
      m.id === assistantMsgId
        ? { ...m, text: m.text || 'Connection dropped — catching up…', streaming: false }
        : m
    )
  );
  startPolling();
}
```

  No retry button on this path — retrying while the server is still finishing the turn
  would double-send the message. Polling is the correct reconciliation, and it already
  handles the "server actually died mid-turn" case too: `runCoachTurn`'s catch either
  finalizes the row (`completed = TRUE`) or deletes the empty placeholder; in the
  deletion case the last row stays the *user* message and polling would spin forever —
  see edge case 4 for the required poll timeout.

**(c) The retry handler** — add near `stopStreaming`:

```ts
const retryLast = useCallback(() => {
  const text = lastSentRef.current;
  if (!text || streaming) return;
  // Drop the failed assistant bubble AND the user bubble it answered, then
  // resend — sendMessage re-adds the user bubble, so the transcript shows the
  // exchange once. (The DB will hold a duplicate user row; that is acceptable
  // and matches the user manually retyping.)
  setMessages(prev => {
    const next = [...prev];
    // walk from the end: remove the last errored assistant msg and the user msg before it
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant' && next[i].error) {
        next.splice(i, 1);
        if (i - 1 >= 0 && next[i - 1].role === 'user' && next[i - 1].text === text) next.splice(i - 1, 1);
        break;
      }
    }
    return next;
  });
  // sendMessage reads state via closure; call it on the next tick so the splice lands first
  setTimeout(() => sendMessage(text), 0);
}, [streaming, sendMessage]);
```

Pass it down where messages render:

```tsx
{messages.map(msg => (
  <MessageBubble key={msg.id} message={msg} onRetry={msg.error ? retryLast : undefined} />
))}
```

### 6. `TODO.md`

Check off "Friendlier chat errors" and "Don't stream raw error internals to the client
in the chat SSE `error` event", each with a one-line note.

## Edge cases a weaker model would miss

1. **Two different failure modes need two different treatments.** A server `error`
   *event* means the turn is dead → Retry. A dropped *connection* means the turn is
   probably still running server-side → poll and reconcile (the server deliberately
   does not abort on disconnect). Collapsing both into "show retry" causes duplicate
   turns on flaky mobile networks — the exact environment this PWA targets.
2. **Keep partial streamed text.** On a server error after 500 words streamed, wiping
   `m.text` with an error string destroys content the user was reading. Only fill the
   text when it's empty.
3. **Retry double-send guard**: `retryLast` must no-op while `streaming` is true, and
   `sendMessage` already guards on `streaming` — but the `setTimeout(0)` matters
   because `sendMessage` checks `streaming` from the closure; calling it synchronously
   inside the same handler as a state update is fine today but fragile. Keep the
   deferral.
4. **Polling never terminates if the placeholder row was deleted.** When the first
   model call fails, `runCoachTurn` deletes the empty assistant row, so the last DB row
   is the user message and `startPolling`'s success condition (last row = completed
   assistant) never fires. Add a poll cap: count attempts in `startPolling`, and after
   ~15 polls (30 s) clear the interval and mark the pending/last assistant bubble as
   `error: true` (retry appears). This must be inside the existing `poll` closure —
   don't create a second interval mechanism.
5. **The DB keeps a duplicate user row on retry** (the failed attempt already persisted
   the user message). This is accepted — do NOT try to dedupe server-side or add a
   delete endpoint; two identical user messages in replay are harmless.
6. **Do not touch the tool_result error strings in `lib/agent.ts`** — the model needs
   real errors. The leak being fixed is client-facing only.
7. **`normalizeToolCalls` infers `error` status from results starting with `'Error'`** —
   unrelated mechanism, same word. Don't confuse the two while editing.
8. **Reloaded failed turns won't show Retry** (the `error` flag lives only in client
   state; persisted rows don't carry it). That's accepted scope — a reloaded partial
   turn already renders as a normal partial message. Don't invent persistence for it.

## Acceptance criteria

- [ ] `npx tsc --noEmit` and `npm run build` pass.
- [ ] Simulate a server turn failure (e.g. temporarily set `ANTHROPIC_API_KEY` to
      garbage, restart dev, send a chat message): the bubble shows the friendly
      message + "Try again" button; the browser network tab shows the SSE `error`
      event contains **no** stack trace, key fragment, or SDK error body; the dev
      server console shows the full error.
- [ ] Restore the key, tap "Try again": the exchange completes; the transcript shows
      the user message once; no leftover errored bubble.
- [ ] Simulate a connection drop mid-stream (dev tools → network → offline once
      streaming starts): bubble stops streaming with "catching up…", and after going
      back online the polled final reply replaces it within a few seconds. No retry
      button on this path.
- [ ] With the server killed entirely mid-turn: polling gives up after ~30 s and the
      bubble flips to the error + Retry state (no infinite spinner).
- [ ] `curl -s localhost:3000/api/insight -X POST -d '{"metric":"hrv","dashboard":{}}'
      -H 'content-type: application/json'` with a broken key returns
      `{"error":"Insight generation failed"}` — nothing else.
- [ ] Grep check: `grep -rn "String(err)" app/ components/` returns no hit that flows
      into a client-visible payload (lib/agent.ts tool results are the only allowed
      remaining use).
