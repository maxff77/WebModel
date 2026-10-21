---
title: "DeepSeek ban analysis: measured volume, per-call reload bug, no spacing"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 241330 }
touches:
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/providers/deepseek-client.test.ts
---

## Decided
- Ban risk is volume + burst shape, not just speed. Measured from ~/.claude/projects transcripts: 18,261 DeepSeek model calls Oct 1-21 across 5 projects; peak 3,116/day, 620/hour. Each model call = 3 upstream HTTP (chat_session/create, create_pow_challenge, chat/completion) and a fresh chat_session that is never deleted.
- The per-call page reload is a bug: `let bearer = this.bearerToken` (src/providers/deepseek/index.ts:117) captures the token into a local, never into `this.bearerToken`; `setBearerToken()` is only called by tests. Normal bridge use therefore runs page.reload() (L146) before every model call. Fix: assign `this.bearerToken = bearer` after capture (1 line).
- Pacing proposal: cache bearer (free), 1s min-gap in ProviderQueue (+0.4s average per call measured), token bucket ~20/min (only hits bursts; median session 3-9/min). No session deletion (adds a request). Session reuse deferred (context duplication risk).
- Honest ceiling: no pacing keeps 3k calls/day looking human; if DeepSeek bans on volume/automation, only cutting volume or rotating accounts helps.

## Tried and ruled out
- Fixed inter-request gap as a fix for "Messages too frequent": already ruled out on 2026-10-18 (window/quota, not spacing). Keep the reactive cooldown for 429; use the gap only to reduce burst shape.
- Blaming retry storms: only 14 Claude Code api_error entries in 3 weeks (bridge hides most 429s by retrying), so retries are not the main driver.
- Counting 429s from transcripts: impossible past the bridge retry; the bridge has no persistent log. A counter would be needed.

## Watch out
- `openai-compat.ts` (/v1/chat/completions) calls provider.chat without ProviderQueue; if a client uses it, concurrency is unbounded. `core/router.ts` also bypasses but is not mounted.
- The 1s min-gap cost (0.4s/call avg, 45% of gaps <0.5s) was measured on this repo's 1,271 calls; remeasure across projects before tuning.
