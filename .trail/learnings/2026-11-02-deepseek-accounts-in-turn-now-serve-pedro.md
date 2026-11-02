---
title: "DeepSeek accounts in turn now serve one call each at the same time, not one call across all"
author: Pedro
date: 2026-11-02
branch: feat/deepseek-account-pool
cost: { minutes: 3, tokens: 88786 }
id: l-0c4310ce
scope: repo
status: active
src: agent
touches:
  - src/core/pool.ts
  - src/core/queue.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
  - tests/unit/routes/anthropic-pool.test.ts
---

## Decided
- 2026-11-02, at Pedro's request ("one call per account"): the account turn (`ProviderPool`) runs one call in flight per account, so N accounts serve N calls at once. An extra call waits for the first account to free up. Before, the route queue used the provider id (`deepseek-web`) as its key, so the whole turn shared one lane and B sat idle while A answered.
- The route queue lets the pool through (`ProviderQueue.run` checks `instanceof ProviderPool`). Each account takes `busy` inside the pool. A single provider (no turn, Qwen, etc.) still runs one call at a time: they share one tab, and DeepSeek's `chat()` reloads the page to read the bearer, which would cut an in-flight call on the same tab.

## Tried and ruled out
- The first attempt still served one call at a time. `next()` read `this.cursor` on every loop step. A concurrent call moved the cursor during the `await isAuthenticated()`, so the second call checked A twice and never reached B. It now reads the cursor once per scan, and checks `busy` after the await.

## Watch out
- More calls at the same moment from one IP: the sanction risk accepted for the turn (see the 2026-10-30 turn learning) grows with parallel subagents.
- Not seen live yet: the unit test uses fake accounts. Restart the bridge to pick it up.

In the code: `ProviderPool.next` / `chat` (busy + `freed` waiters) in src/core/pool.ts; `ProviderQueue.run` in src/core/queue.ts; the call sites in src/routes/anthropic-compat.ts and src/routes/openai-compat.ts. Test: "calls run at once, one per account" in tests/unit/routes/anthropic-pool.test.ts.
