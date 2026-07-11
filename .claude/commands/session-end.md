Review this conversation from the beginning and perform a session wrap-up. Do the following in order:

1. **Write a session entry to `SESSION_LOG.md`**
   - Add a new `### YYYY-MM-DD` entry at the bottom (today's date)
   - Bullet-point, one line per meaningful thing done: files created/modified, features built, decisions made, things tested and confirmed working
   - Factual and scannable — not a narrative, not every tool call
   - If nothing substantive changed, write a short entry noting what was discussed and decided

2. **Extract new lessons to `docs/lessons-learned.md`**
   - Review everything that went wrong, required a fix, or revealed a non-obvious constraint this session
   - Also capture architectural decisions that shouldn't be re-litigated (with a one-line rationale)
   - Add each as a single line under the correct domain heading (Next.js, Anthropic/agent loop, MCP, Postgres, PWA/service worker, Railway/deploy). Add a heading if a new domain is needed.
   - Check for duplicates first. Skip obvious advice — only non-obvious gotchas and real decisions.

3. **Commit both files**
   - Stage only `SESSION_LOG.md` and `docs/lessons-learned.md`
   - Commit message: `docs: session wrap-up YYYY-MM-DD`
   - Push to the current branch

Keep the tone consistent with what's already there. Don't summarize what you did in this response — just do it and report what was added in a short bullet list.
