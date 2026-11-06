---
title: "Cap live DeepSeek browsers, not tabs; prefetch only the browser"
author: Pedro
date: 2026-11-06
branch: fix/pow-asset-build
cost: { minutes: 1, tokens: 783 }
id: l-a4676153
scope: repo
status: active
src: agent
touches:
  - src/cli.ts
  - src/config/loader.ts
  - src/browser/manager.ts
  - src/core/pool.ts
---

## Decided
- Cap live DeepSeek browsers at ~3 instead of capping tabs: each pool account is its own browser process with its own profile dir, so the browser is the unit that costs RAM. Never close one while a chat is streaming.
- Prefetch only the next account's browser (launch and load chat.deepseek.com), never the completion request. That hides the launch cost without spending quota.

## Tried and ruled out
- Sending the next completion request early to "have it ready": impossible. The bridge does not know the next prompt until the client sends it; it can only predict the next account from the rotation cursor.
- Treating the problem as too many tabs: one browser can serve many tabs, but here each account is a separate browser process.

## Watch out
- idleShutdown defaults to 300s, so the number of live browsers is the number of accounts touched in the last 5 minutes. With 30-50 accounts under continuous rotation they can all stay open, which does not fit in 16 GB.
- Any cap must be soft under concurrent requests: busy browsers may exceed it, only idle LRU ones close.
- A failed prefetch must not mark the account out by itself; the request path already handles refusals.

In the code:
- src/cli.ts:328-345 — browserFor() creates one BrowserManager per account, cached in poolBrowsers.
- src/config/loader.ts:60 — idleShutdown: 300.
- src/browser/manager.ts:636-655 — release() closes browser and context.
- src/core/pool.ts:134-159 — next() is serial per account but allows concurrent requests on different accounts.
