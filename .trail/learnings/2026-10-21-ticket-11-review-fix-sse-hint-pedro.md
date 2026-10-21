---
title: "Ticket 11 review fix: SSE hint errors are post-send"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 1, tokens: 10111 }
touches:
  - docs/camoufox-engine-spec.md
  - src/browser/manager.ts
  - src/providers/deepseek/index.ts
  - tests/unit/browser/manager.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - src/core/stream.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/routes/anthropic-agent.test.ts
---

## Decided
- DeepSeek's SSE `event: hint` errors arrive after the completion POST, so they now carry `sent: true`. A non-rate-limit refusal (e.g. `content_filter`) is answered with 502 instead of being retried and re-posting the prompt. Rate-limit hints carry it too; the paced cooldown still retries them because it excludes that code explicitly.
- A page's close/crash handler only marks the profile down while its context is the manager's current one. A late close from a disposed context no longer arms `_dead` against the freshly launched browser.

## Watch out
- Other web providers still do not set `sent`; unchanged scope from ticket 11.
- The retry still depends on Playwright delivering `crash` before the failed `evaluate` rejection propagates; a real crash that rejects first would reuse the dead page. Not verified with a real crash.
