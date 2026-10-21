---
title: "Ticket 10 review fixes: failover always launches, profile fallback command"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 18949 }
touches:
  - docs/camoufox-engine-spec.md
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
  - src/server.ts
  - tests/helpers/test-server.ts
  - tests/unit/core/queue.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
---

## Decided
- Review fix: `launchFallback` sets `_mode = 'launch'` unconditionally. Before, a chrome fallback under `--browser-mode attach` was labelled attach while actually launched: `shutdown()` skipped closing it (leak) and `startLogin` took the user's-Chrome branch. Failover is another identity, so attach semantics never apply.
- Review fix: declaring a fallback is now an operation — `ProfileStore.setFallback(name, fallback)` plus `profile fallback <name> <fallback>`. Hand-editing the manifest still works, and `resolve` re-validates on every read.

## Tried and ruled out
- Reusing `manager.activate(fallback)` inside `launchFallback`: rejected. `activate` applies `attachProfileError` against the requested mode and would refuse a chrome non-default fallback that failover can legitimately launch.
- Per-provider session check and attach-mode fallback: still out; see the ticket 10 learning.

## Watch out
- If the fallback's own launch fails, the switch stays: later requests retry the fallback directly, unlike the no-session path which leaves the original profile active.
- The ticket 10 learning predates these fixes and says there is no CLI command; this note supersedes that part.
