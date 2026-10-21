---
title: "Ticket 11: dead-page fallback and the pre-send retry boundary"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 6, tokens: 119284 }
touches:
  - docs/camoufox-engine-spec.md
  - src/browser/manager.ts
  - src/core/stream.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/browser/manager.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
---

## Decided
- A page that emits `close` or `crash` sets a `_dead` flag on BrowserManager. The next `ensureBrowser()` releases the browser and switches to `profile.fallbackProfile` (or relaunches the same profile when none is declared) before launching. A fallback with no session fails with BrowserUnavailableError naming it and asking for login.
- Retry stays in the anthropic route (one `run()` retry). It is skipped when the provider reports `sent: true`. DeepSeek flips `sent` immediately before the `/api/v0/chat/completion` POST, and every error after that (fetch failure, outer catch) carries it. Providers that never set it keep the old retry behaviour.
- `startLogin` now closes through `release()`: the `releasing` guard stops the intentional context close from marking the profile dead.
- Page liveness is event-driven (`page.on('close'/'crash')`) rather than a per-acquisition ping; a crashed renderer does not report `isClosed()`.

## Tried and ruled out
- Retrying inside DeepSeekProvider: duplicates the route's retry and would bypass the provider queue lane; the route owns both.
- Reusing `activate(fallback)` in the dead-page path: same reason as launch fallback (attachProfileError rejects non-default profiles).
- Guarding the page listeners with a WeakMap of handlers: the `releasing` flag is one line and covers every release path.

## Watch out
- Only deepseek-web sets `sent`; other web providers still retry after their POST. Pre-existing and outside #11.
- A closed tab in attach mode counts as a dead page, so with a declared fallback the default profile can fail over because the user closed the manager's tab.
- `trail check` on this branch reports conflicts from earlier tickets' content (manager declarations, docs, package-lock), not from this change.
