---
title: DeepSeek THINK fragments leaked as text in Claude Code
author: Pedro
date: 2026-10-19
branch: fix/claude-code-agent-tools
cost: { minutes: 11, tokens: 537562 }
touches:
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - src/providers/deepseek/stream.ts
---

## Decided
- DeepSeek web (thinking_enabled) streams `fragments`: the snapshot opens `{"type":"THINK"}`, its content patches go to `response/fragments/-1/content`, then the answer arrives as `{"p":"response/fragments","o":"APPEND","v":[{"type":"RESPONSE","content":"<first chunk>"}]}`. The parser now tracks fragment types by index: THINK → `thinking_delta`, everything else → `text_delta`, and emits the appended fragment's initial content.
- Before this, every reasoning token was emitted as text and the RESPONSE fragment's first chunk was dropped (a probe answering "391" returned only the reasoning).
- Claude Code sends `thinking: {"type":"adaptive","display":"omitted"}` even for `deepseek-web/deepseek-v4`; the route treats adaptive as "want thinking". Bridge ignores `display`.

## Tried and ruled out
- "Claude Code doesn't ask for thinking": it does (captured with a fake endpoint).
- "Stale bridge": reproduced on a freshly started one.

## Watch out
- DeepSeek may skip THINK entirely even with thinking_enabled: a trivial question under Claude Code's ~570k-char prompt came back RESPONSE-only. Test with a question that needs reasoning.
- `normalizeDeepSeekSSE` (src/providers/deepseek/stream.ts) is test-only; the live parser is inline in `DeepSeekProvider.chat`. Seam for tests: tests/unit/providers/deepseek-chat.test.ts (fake `page.evaluate`).
