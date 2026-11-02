---
title: Closed DeepSeek accounts sit out the turn for 5 minutes instead of being probed on every call
author: Pedro
date: 2026-11-02
branch: feat/deepseek-account-pool
cost: { minutes: 5, tokens: 66776 }
id: l-e6ff4188
scope: repo
status: active
src: agent
touches:
  - src/core/pool.ts
  - tests/unit/routes/anthropic-pool.test.ts
---

## Decided
- 2026-11-02, asked why Claude Code shows so many "API Error": the final errors since 2026-10-29 (Claude Code transcripts, `isApiErrorMessage`) were 9× 401 (DeepSeek closed the sessions: "Please run /login"), 5× network/DNS (`Failed to fetch`, ENOTFOUND), 2× 429 "Mensajes muy frecuentes" plus 10 retries, and 1× page closed. Most are not bridge bugs.
- The code bug found next to them was slowness, not errors. DeepSeek's `isAuthenticated()` lets `expired` through (2026-10-29, so a re-login typed into the window is seen). The turn therefore probed every closed account on every call, at ~10 s each (reload plus bearer wait). bridge.log: 73 calls hit closed accounts, 38 of them paid ~60 s for six dead ones.
- Fix: a closed account sits out for 5 min (`LOGGED_OUT_RECHECK_MS`), then gets one more probe, so a re-login in its window is still seen. It comes back at once when `isLoggedInHere()` reads `active` (a dashboard login).

## Watch out
- Since the 2026-10-31 restart, the bridge writes to a terminal, not to bridge.log, so recent bridge-side errors are not on disk. Claude Code transcripts keep only the final error and some retries.
- With every account closed, the turn now answers 401 at once instead of after ~10 s per account.

In the code: `next()` and `markOut()` in src/core/pool.ts. Test: "an account whose session closed sits out" in tests/unit/routes/anthropic-pool.test.ts.
