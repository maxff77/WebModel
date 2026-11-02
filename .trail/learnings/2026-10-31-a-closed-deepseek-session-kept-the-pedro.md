---
title: "A closed DeepSeek session kept the dashboard row logged in, hiding Login: three stacked causes"
author: Pedro
date: 2026-10-31
branch: feat/deepseek-account-pool
cost: { minutes: 4, tokens: 95511 }
id: l-1a9594f2
scope: repo
status: active
src: agent
touches:
  - src/providers/deepseek/index.ts
  - src/core/pool.ts
  - src/auth/store.ts
  - tests/unit/routes/anthropic-pool.test.ts
---

## Decided
- Symptom (2026-10-31): DeepSeek dropped the session on the active profile (1a). The account wrote `expired` to its auth.json, but `/webmodel/providers` kept `authenticated: true`. The dashboard shows Login only when that is false, so the user could not log in again.
- Three causes, all needed for the fix:
  1. DeepSeek's `isAuthenticated()` counts `expired` as logged in (the 2026-10-29 decision, so the route lets chat() re-check the page). The row inherited it. DeepSeek now overrides `isLoggedInHere()` with `status === 'active'`; the route gate stays lenient.
  2. `ProviderPool.isLoggedInHere()` called `here.isAuthenticated()`, so any override on the provider was skipped. It now calls `here.isLoggedInHere()`.
  3. The row reads the main AuthStore, but the pool member writes through its own AuthStore instance. The main store's cache only reloaded on a profile switch, so it kept `active`. A module-level write counter makes every store reload after any store writes. `AuthStore.reload()` and cli's `poolAuth` map existed only to patch this one direction (a dashboard login reaching the member), so they were deleted.

## Tried and ruled out
- Fixing only cause 1: the regression test stayed red (stale cache, then the pool's delegation).

## Watch out
- The bridge only learns that a session closed when a call reaches the page (chat() sees /sign_in). A profile whose session closed with no call since still shows logged in. Nothing polls the page.
- After a login typed into the bridge's own window (not through the dashboard), the row shows Login until the next call captures a bearer and writes `active`.

In the code: src/providers/deepseek/index.ts `isLoggedInHere`, src/core/pool.ts `isLoggedInHere`, src/auth/store.ts `writes` counter in `sync()`/`save()`. Regression test "an account that marks itself expired shows Login on the active profile" in tests/unit/routes/anthropic-pool.test.ts.
