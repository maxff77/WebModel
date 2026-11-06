---
title: "A pre-warm must not touch the active profile's browser, and closing waits for it"
author: Pedro
date: 2026-11-06
branch: fix/pow-asset-build
cost: { minutes: 12, tokens: 117010 }
id: l-e7270fdc
scope: repo
status: active
src: agent
touches:
  - src/browser/live.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/core/pool.ts
  - src/routes/management.ts
  - src/server.ts
  - tests/helpers/test-server.ts
  - tests/unit/browser/live.test.ts
  - tests/unit/core/pool.test.ts
  - tests/unit/routes/management.test.ts
---

## Decided
- A DeepSeek account is warmed only when it is not the active profile's account: the active profile is served by the main browser manager, so warming it would create a second manager on the same profile dir (launch mode) or a duplicate CDP connection (attach mode).
- The live-browser LRU treats a warm in flight as a use: it never evicts a browser being warmed, and closing an account waits for its warm to finish before shutting down. Without the wait, the warm relaunches the browser right after the close, untracked.

## Tried and ruled out
- Counting the active-profile browser toward the cap: rejected; evicting it would close the browser the dashboard and other providers use.

## Watch out
- Only status `running` counts as live; `idle` is the transient state immediately before shutdown.
- `closeAll()` must also await every in-flight warm first, for the same relaunch reason.

In the code:
- src/cli.ts, onAcquire: `next.name !== browserManager.getProfile().name` gates the prefetch.
- src/browser/live.ts: `lruIdle` skips `this.warming.has(name)`; `close` and `closeAll` await in-flight warms before `shutdown()`.
- tests/unit/browser/live.test.ts: "does not evict a browser that is being warmed", "waits for a warm in flight before closing".
