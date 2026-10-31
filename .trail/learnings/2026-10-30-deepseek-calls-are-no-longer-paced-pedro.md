---
title: "DeepSeek calls are no longer paced; only DeepSeek's own refusals slow the bridge"
author: Pedro
date: 2026-10-30
branch: feat/deepseek-account-pool
cost: { minutes: 2, tokens: 74152 }
id: l-9921d9b7
scope: repo
status: active
src: agent
touches:
  - src/core/queue.ts
  - src/routes/anthropic-compat.ts
  - src/providers/deepseek/index.ts
---

## Decided
- 2026-10-29, at Pedro's request: removed the proactive pacing (6 s minimum gap, 10 starts/min, 60 per 30 min). It slowed every session and did not prevent lockouts: the 2026-10-24 lockout happened with pacing on.
- Kept the detection: DeepSeek's "Messages too frequent" hint (`upstream_rate_limit`) still triggers the per-provider cooldown in the Anthropic route (5 s doubling, up to 180 s held per request, then 429 without probing); a muted account (`account_muted`) still answers 403 with its end date. Both act only after DeepSeek refuses, so they cost nothing while the account is fine.
- The queue still runs one call at a time per provider: web providers share one browser tab.

## Tried and ruled out
- Fixed spacing and per-window caps (see the 2026-10-18 and 2026-10-24 learnings): measured lockouts look like a volume/penalty rule, and the caps only delayed reaching it.

## Watch out
- Without pacing, bursts of parallel subagents reach "too frequent" sooner; the reactive cooldown is what holds them back now. If lockouts become frequent or longer, look at volume per 20-30 min, not spacing.

In the code: src/core/queue.ts (ProviderQueue is serialization only; `requestPacing`, `WMB_MIN_GAP_MS`, `WMB_MAX_RPM`, `WMB_MAX_PER_30MIN` are gone), src/routes/anthropic-compat.ts (`rateLimitCooldown`, `paced()`), src/providers/deepseek/index.ts (hint and muted detection).
