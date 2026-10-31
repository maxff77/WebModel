---
title: "DeepSeek calls are not paced; a \"too frequent\" refusal is a 429 at once carrying DeepSeek's message"
author: Pedro
date: 2026-10-30
branch: feat/deepseek-account-pool
cost: { minutes: 9, tokens: 64475 }
id: l-f8c87137
scope: repo
status: active
replaces: l-9921d9b7
src: agent
touches:
  - tests/unit/routes/anthropic-agent.test.ts
  - src/routes/anthropic-compat.ts
  - src/core/queue.ts
  - src/providers/deepseek/index.ts
---

## Decided
- 2026-10-29, at Pedro's request: removed the proactive pacing (6 s minimum gap, 10 starts/min, 60 per 30 min). It slowed every session and did not prevent lockouts (the 2026-10-24 lockout happened with pacing on).
- DeepSeek's "Messages too frequent" hint (localized: "Mensajes muy frecuentes. Intenta de nuevo más tarde.", code `upstream_rate_limit`) is answered with a 429 rate_limit_error at once, carrying DeepSeek's own text. The per-provider cooldown (5 s doubling, cap 10 min) stays: during it, requests get the same 429 and message without asking DeepSeek again.
- Cause of "Claude Code just sits on API error" (2026-10-29): the route held each request up to 180 s inside the cooldown, and Claude Code retries a 429 ~10 times, so the reason showed after ~30 min. Measured with a mock that always answers 429: Claude Code 2.1.314 made 11 attempts in 184 s, then printed `API Error: Request rejected (429) · <message from the body>`. In the live session the retries went from ~3 min apart to Claude Code's own backoff (~20-35 s), each answered in 2-4 s.
- A muted account still answers 403 with its end date, not retried.

## Tried and ruled out
- Holding requests inside the lane until the cooldown ends: it is what hid the reason; Claude Code's own retries already wait.
- Fixed spacing and per-window caps: measured lockouts look like a volume/penalty rule (see the 2026-10-18 and 2026-10-24 learnings).

## Watch out
- Claude Code's retries now usually arrive after the cooldown has run out, so each retry probes DeepSeek once (~10 per turn); unknown whether probes extend a lockout. The 2026-10-29 lockout started 02:48Z, 8 min after pacing was removed, and was still on at 03:01Z.
- The queue still runs one call at a time per provider (shared browser tab).

In the code: src/routes/anthropic-compat.ts (`paced()`, `rateLimitCooldown`, `cooldowns` keeps the last message), src/core/queue.ts (serialization only), src/providers/deepseek/index.ts (hint and muted detection), tests/unit/routes/anthropic-agent.test.ts (the 429-at-once and cooldown-doubling tests).
