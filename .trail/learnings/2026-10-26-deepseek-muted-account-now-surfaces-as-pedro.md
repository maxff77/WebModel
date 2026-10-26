---
title: "DeepSeek muted account now surfaces as account_muted (403, no retry)"
author: Pedro
date: 2026-10-26
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 115666 }
touches:
  - package-lock.json
  - package.json
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/dashboard/app.js
  - src/dashboard/index.html
  - src/doctor.ts
  - src/profiles/store.ts
  - src/providers/deepseek/index.ts
---

## Decided
- Supersedes the "biz_code 5 not recognized" watch-out of 2026-10-24. A non-SSE completion body with `"is_muted":1` now yields code `account_muted`, message "DeepSeek: account muted until <ISO mute_until>" (src/providers/deepseek/index.ts, non-stream branch). The Anthropic route answers 403 permission_error and does not run its one retry (src/routes/anthropic-compat.ts). Reason: a 502/429 makes Claude Code keep probing an account under a multi-day sanction.
- Tests: tests/unit/providers/deepseek-chat.test.ts (verbatim body from 2026-10-24), tests/unit/routes/anthropic-agent.test.ts.

## Tried and ruled out
- Mapping it to 429: Claude Code retries 429 and the cooldown logic would wait, but the mute lasts days.

## Watch out
- The OpenAI route (/v1/chat/completions) still answers a generic 502 provider_error for it.
- Detection only covers the completion step; a mute reported at chat_session/create would still show as "5: user is muted" from sessionCreateResult.
