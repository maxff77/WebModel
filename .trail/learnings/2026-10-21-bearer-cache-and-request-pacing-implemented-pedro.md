---
title: Bearer cache and request pacing implemented; ban remains policy enforcement
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 28895 }
touches:
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/queue.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - tests/unit/routes/anthropic-compat.test.ts
  - tests/unit/providers/deepseek-client.test.ts
---

## Decided
- DeepSeekProvider now caches the captured bearer (`this.bearerToken = bearer`) and forgets it only on 401/403 (`forgetExpiredBearer`). Before, every chat() call ran page.reload() to re-capture the token; the regression test in tests/unit/providers/deepseek-chat.test.ts fails with reloads=2 if the assignment is removed.
- ProviderQueue takes QueueOptions (minGapMs, maxPerWindow, windowMs) and paces per provider; abort skips the wait. Route passes hot-tunable `requestPacing`: WMB_MIN_GAP_MS (default 1000), WMB_MAX_RPM (default 20), 60s window.
- Tests hitting /v1/messages must zero requestPacing (done in anthropic-agent and anthropic-compat tests) or pay the 1s gap.
- 220 unit tests pass; red check proven before restoring the fix.

## Tried and ruled out
- Evasion measures (human-like jitter, per-account profile/IP isolation, fingerprint changes): not implemented. The suspension is policy enforcement (DeepSeek Terms §3.5(3) bans "robots, spiders, or other automatic setups"; §8.2 allows suspension/closure). Pacing reduces burst/volume, it does not make automated web use compliant.
- Fixed gap as a cure for "Messages too frequent": still a window/quota; keep the reactive cooldown. Pacing only shapes bursts.

## Watch out
- The bridge runs from dist and has no watch: `npm run build` then restart. Restarting kills the bridge serving the running Claude Code session, so restart from a shell when convenient.
- openai-compat (/v1/chat/completions) still bypasses ProviderQueue; if any client uses it, concurrency is unbounded.
- Expect bans to continue: the only compliant fix is the official API or less automation.
