---
title: "Review fixes: 40003 bearer invalidation and a shared provider queue"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 10, tokens: 35680 }
touches:
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
  - src/server.ts
  - tests/helpers/test-server.ts
  - tests/unit/core/queue.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
---

## Decided
- Bearer invalidation now matches the real auth failure: DeepSeek answers HTTP 200 {code:40003,msg:"INVALID_TOKEN"} as well as 401/403. `forgetExpiredBearer` matches `/(?:401|403|40003)|INVALID_TOKEN/`. Regression test fills two reloads: stale bearer -> 40003 -> next chat() reloads and succeeds. Proven red with the old regex.
- One ProviderQueue per app (created in createApp) is shared by /v1/messages and /v1/chat/completions; openai route now enqueues both streaming and non-streaming chat calls with the request signal.
- `requestPacing` moved from anthropic-compat to core/queue (envNumber helper included); `rateLimitPacing` renamed `rateLimitCooldown`; `maxPerWindow` uses undefined (not Infinity) as "no cap".
- Route tests disable pacing centrally in tests/helpers/test-server.ts instead of mutating the exported object per file.

## Tried and ruled out
- Leaving the bearer regex as 401/403 only: a stale token wedged DeepSeek until restart, since 40003 arrives with HTTP 200.
- Per-route queues: they would not share the provider lane, so the openai surface could still run concurrently with /v1/messages.
- Refactoring the pre-existing DeepSeek header key/value duplication in client.ts: left untouched; headers were verified against the live client on 2026-10-20 and the change is outside this diff's purpose.

## Watch out
- The bridge still runs from dist: build done, restart needed for the changes to apply. Restart kills the bridge serving the current session.
- The 1s min-gap still slows sub-second follow-ups by up to 1s (+0.4s average measured); the 20/min cap does not touch typical 3-9/min sessions.
- `maxPerWindow` counts model calls, not upstream HTTP (DeepSeek costs 3 per call).
