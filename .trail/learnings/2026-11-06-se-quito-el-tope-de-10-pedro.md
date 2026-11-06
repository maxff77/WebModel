---
title: Se quitó el tope de 10 por hora; el único freno que queda es el gap de 6 s
author: Pedro
date: 2026-11-06
branch: fix/pow-asset-build
cost: { minutes: 5, tokens: 40602 }
id: l-c4cf8290
scope: repo
status: active
src: agent
touches:
  - src/core/pool.ts
  - src/cli.ts
  - tests/unit/core/pool.test.ts
---

## Decided
- The per-account hourly cap is gone from the pool: no `maxPerHour` constructor argument, no `overLimit()`, no `hourly_limit` error, no `WMB_ACCOUNT_MAX_PER_HOUR` (2026-11-06). The reason: the turn now runs a single account, so a 10/h cap left that account unusable at request 11 with nowhere to rotate.
- `Member.recent` and `record()` stay. They are not only cap state: `markOut()` prints "logged out after N req/1h (M/10m)" from them, which is how the bans were diagnosed. Only the cap arithmetic was removed.
- `hourly_limit` was never mapped in a route; it only surfaced as a generic 502. Nothing else needed changing.

## Tried and ruled out
- Setting the default to 0 and keeping the knob: rejected. With one account the cap has no use, and keeping a dead switch invites someone to turn it back on.

## Watch out
- With one account in the turn, that account absorbs all traffic. The only remaining brake is the pacer: `WMB_MIN_GAP_MS` 6 s with 0.25 jitter, challenge backoff 60 s, rate-limit backoff 30 s doubling to 600 s.
- Measured 2026-11-06 with the turn on a single account: 10 requests in ~56 s all served, the 11th came back `upstream_rate_limit` ("too frequent") and cooled 5 s, and the next call after the cooldown served. No hourly lockout.
- The earlier measurement (accounts that served ~45/h were challenged after ~2 minutes) is the reason a cap existed. Removing it means a single account can now run at the pacer's ceiling; if accounts start getting challenged, that measurement is the first place to look.

In the code: `src/core/pool.ts` (constructor, `free`, `record`, `allDown`), `src/cli.ts` (pool construction). Tests: `tests/unit/core/pool.test.ts`.
