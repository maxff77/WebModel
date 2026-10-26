---
title: "DeepSeek accounts in turn (ProviderPool, spec #13) and how it is wired"
author: Pedro
date: 2026-10-26
branch: feat/deepseek-account-pool
cost: { minutes: 8, tokens: 100450 }
touches:
  - package-lock.json
  - package.json
  - src/auth/store.ts
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/core/stream.ts
  - src/dashboard/app.js
  - src/dashboard/index.html
  - src/doctor.ts
---

## Decided
- Spec maxff77/WebModel#13 implemented on branch feat/deepseek-account-pool (uncommitted as of 2026-10-26). `ProviderPool` (src/core/pool.ts) wraps N providers under one id, strict turn, failover only on refusals (account_muted, auth_expired, upstream_rate_limit) before any content. All down: cooling → upstream_rate_limit, else logged out → auth_expired, else account_muted with the earliest `until`.
- Config `deepseek.profiles: [a, b]` (loader throws on non-list/duplicates; cli prints it and exits). cli builds one DeepSeekProvider per profile with `new AuthStore(stateDir, () => name)` and a page source that uses the main BrowserManager when it is on that profile, else a dedicated BrowserManager created on first call. Dashboard activate shuts the dedicated one first; login success calls `AuthStore.reload()` on the member's store.
- StreamEvent error gained `until?: number` (epoch ms) so the pool knows when a mute ends.
- Live check 2026-10-26 on port 3457 with cuenta_nueva1 + cuenta_nueva2: calls went A, B, A; activating cuenta_nueva1 in the dashboard while the pool held its browser did not collide; SIGINT closed every pool browser.

## Tried and ruled out
- Parsing the mute end date from the error message: replaced by the `until` field.
- Logged-out state kept inside the pool: not needed, it reads each member's own auth store, so a dashboard login brings the account back.

## Watch out
- The queue still keys by provider id, so total pacing (10/min, 6 s, 60/30 min) covers all accounts together; per-account volume is 1/N.
- Pool state (muted/cooling) is in memory: a restart spends one call on a muted account before marking it again.
- The main AuthStore's cache for the active profile can go stale when a member marks it expired; health uses the pool, so only dashboard rows may lag.
- Spec deviation: pool `login()` delegates to the first member, not the active one (the CLI drives login on the main browser anyway).
