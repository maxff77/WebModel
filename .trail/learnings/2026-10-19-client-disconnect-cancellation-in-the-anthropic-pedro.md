---
title: "Client-disconnect cancellation in the Anthropic route (PR #10)"
author: Pedro
date: 2026-10-19
branch: fix/claude-code-agent-tools
cost: { minutes: 13, tokens: 3604773 }
touches:
  - tests/unit/routes/anthropic-agent.test.ts
  - src/routes/anthropic-compat.ts
---

## Decided
- `src/routes/anthropic-compat.ts` reads `c.req.raw.signal` and checks it before each `attempt()`, before the transient retry and before the garbled-reply re-ask; the rate-limit cooldown uses `sleep(wait, undefined, { signal })` inside try/catch so an abort releases the provider lane. An aborted request answers 499 without calling the provider.
- `signal` is now passed to `provider.chat`, but no provider uses it yet.
- Fix applied on branch `pr10-fix` (worktree /tmp/wmb-pr10) tracking `fork/claude-code-agent-backend`, together with `5c4e423` applied via `git am --exclude='.trail/*'` (upstream repo has no `.trail/`).

## Tried and ruled out
- Cancelling DeepSeek's in-flight request: its fetch runs inside `page.evaluate`; there is no Node-side abort handle. Out of scope.

## Watch out
- Tests: `app.request(path, { signal })` with an already-aborted or later-aborted AbortController reproduces a disconnect in Hono's test client; no real socket needed.
- Without the try/catch, an aborted `sleep` throws out of `queue.enqueue` and Hono returns 500.
