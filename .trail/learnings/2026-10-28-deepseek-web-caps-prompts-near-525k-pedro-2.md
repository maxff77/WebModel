---
title: "DeepSeek web caps prompts near 525K tokens: 500K window, and a too-long prompt answers 400"
author: Pedro
date: 2026-10-28
branch: feat/deepseek-account-pool
cost: { minutes: 9, tokens: 72560 }
id: l-85789477
scope: repo
status: active
replaces: l-3af5c7b6
src: agent
touches:
  - src/providers/deepseek/index.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - src/routes/anthropic-compat.ts
---

## Decided
- Both DeepSeek V4 models report a 500K window to Claude Code. Claude Code uses `max_input_tokens` from /v1/models for its context bar and auto-compact.
- Why 500K and not 1M: V4 accepts 1M, but chat.deepseek.com refuses longer prompts. Measured 2026-10-28 through the bridge with code as filler, in estimateTokens units: 525K answered and found the codes hidden at the start and middle; 550K, 600K, 700K and 800K were refused.
- A refused prompt is an SSE hint with `finish_reason: "context_length_exceeded"`. The route now answers 400 invalid_request_error "prompt is too long: N tokens > M maximum", the same shape as the real API. Checked with Claude Code against a fake endpoint: a 400 is sent 1 time, and Claude Code shows "Prompt is too long · ~N tokens (limit M)". A 502 is sent 6 times in 40 s.

## Tried and ruled out
- An 800K window with compaction at 700K: the web refuses prompts from 550K.
- Matching the error text: it comes in the browser's language ("Se alcanzó el límite de longitud" one time, "Length limit reached" another time). Match on finish_reason.
- Filler of Spanish text with numbers: it has 1.33x more cl100k tokens than chars/4. Code has ~1.0x, the same as Claude Code transcripts.

## Watch out
- Keep auto-compact at or below 500K.
- Just after a login, the first calls fail with "Failed to fetch" or "Execution context was destroyed". Send a small control call before you blame the size.

In the code: src/providers/deepseek/index.ts `models()`; src/routes/anthropic-compat.ts `reply.code === 'context_length_exceeded'`; test in tests/unit/routes/anthropic-agent.test.ts.
