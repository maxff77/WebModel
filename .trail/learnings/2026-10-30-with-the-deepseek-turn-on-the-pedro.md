---
title: "With the DeepSeek turn on, the dashboard row shows the active profile's login, not the turn's"
author: Pedro
date: 2026-10-30
branch: feat/deepseek-account-pool
cost: { minutes: 4, tokens: 43150 }
id: l-6f93209e
scope: repo
status: active
src: agent
touches:
  - src/core/provider.ts
  - src/cli.ts
---

## Decided
- 2026-10-30. Cause: with the turn on, a fresh active profile (no auth.json) showed DeepSeek as logged in. The dashboard hid its Login button, so a new account could not be added. The pool's `isAuthenticated()` answers true when any account in the turn is logged in, and `providerStatus()` fed that answer to the dashboard row.
- Two questions, two methods:
  - `isAuthenticated()` answers "can it serve?" and stays "any account in the turn". The routes gate on it, and the turn must serve while the active profile is fresh.
  - `isLoggedInHere()` answers "is the active profile logged in?". The dashboard row and `/webmodel/providers` now use it. The pool answers it from the active-profile provider (`here`).

## Watch out
- `/webmodel/health` also goes through `providerStatus()`. With a fresh active profile it now reports deepseek false, even though the turn serves.
- Verified live 2026-10-30: with test7 active and the turn test2–test6, the row reads false and a call is served 200 by test2.

In the code: `BaseProvider.isLoggedInHere` in src/core/provider.ts; `ProviderPool` constructor `here` and its override in src/core/pool.ts; `new ProviderPool(members, singleDeepSeek)` in src/cli.ts; registry.ts `providerStatus()`. The regression test is in tests/unit/routes/anthropic-pool.test.ts.
