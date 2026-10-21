---
title: "Ticket 11 review pass: every post-send failure is possibly sent"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 21, tokens: 53176 }
touches:
  - docs/camoufox-engine-spec.md
  - src/browser/manager.ts
  - src/core/stream.ts
  - src/providers/_shared/sse-reader.ts
  - src/providers/chatgpt/index.ts
  - src/providers/claude/index.ts
  - src/providers/deepseek/index.ts
  - src/providers/doubao-web/index.ts
  - src/providers/gemini-web/index.ts
  - src/providers/glm-web/index.ts
---

## Decided
- `sent` is now `possiblySent` (absent = not sent) and the route's attempt result has a named type.
- Every web provider sets `possiblySent` from its final POST on: claude, kimi, qwen, doubao and glm flag before their last evaluate; chatgpt, gemini, grok, xiaomimo and perplexity go through `postAndRead`, and `readSSE` marks its own errors. A retry can no longer post the same prompt twice.
- Manager failover is one `failOver(summary)` that releases, switches and returns whether a fallback was used; the caller owns the sentence, so no identity check and no punctuation in the helper.
- A dead page keeps the profile down while the fallback has no session: the next requests keep asking for login instead of relaunching the profile that died.
- Composition test: a pre-send page crash through /v1/messages retries once on the fallback profile and succeeds.

## Tried and ruled out
- Making `possiblySent` required: 45 error yields across providers, no behaviour change; absent = not sent is one documented rule.
- Liveness ping on every cached page to catch a crash whose event arrives after the failed evaluate: one round trip per chat and false positives during navigation.

## Watch out
- The crash-event/evaluate race remains: the single retry can reuse a dead page, failing the request (never duplicating the prompt).
