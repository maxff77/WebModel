---
title: "A DeepSeek re-login in the bridge's open window was ignored; expired now means re-check the page"
author: Pedro
date: 2026-10-29
branch: feat/deepseek-account-pool
cost: { minutes: 5, tokens: 128307 }
id: l-3313bf37
scope: repo
status: active
src: agent
touches:
  - tests/unit/providers/deepseek-chat.test.ts
  - src/providers/deepseek/index.ts
  - src/browser/manager.ts
---

## Decided
- Cause (2026-10-29): after a 401 the provider saw /sign_in and wrote `expired` to the profile's auth.json. The route gate (`isAuthenticated()`) only accepted `active`, and only the dashboard Login flow writes `active`. A login typed into the bridge's own headed window (headless: false) never reached auth.json, so every request answered 401 `auth_required` without touching the browser, forever.
- Fix: DeepSeek's `isAuthenticated()` blocks only `none` (never logged in / explicit logout). `expired` lets the request reach chat(), which reloads the page; a captured bearer writes `active` back. Still on /sign_in → `expired` + 401 `auth_expired` as before.

## Tried and ruled out
- Stale cached bearer: no, the /sign_in branch only runs with bearerToken null.
- Fallback profile without a session: that surfaces as BrowserUnavailableError, not auth_required.

## Watch out
- While logged out, each request now costs one page reload plus a 10 s token wait before the 401. Claude Code does not retry auth errors, and the route skips its own retry for auth_expired.
- Other web providers still gate on `active` only; the same stuck state applies to them if they ever write `expired`.

In the code: src/providers/deepseek/index.ts isAuthenticated + bearer capture; regression test "a login in the open window lifts the expired mark" in tests/unit/providers/deepseek-chat.test.ts.
