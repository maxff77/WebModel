---
title: Numbered tool calls and results in the web-model transcript
author: Pedro
date: 2026-10-19
branch: fix/claude-code-agent-tools
cost: { minutes: 41, tokens: 47099 }
touches:
  - src/cli.ts
  - src/config/loader.ts
  - src/core/anthropic-formatter.ts
  - src/core/provider.ts
  - src/core/registry.ts
  - src/core/tool-protocol.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - tests/helpers/test-server.ts
  - tests/unit/core/tool-protocol.test.ts
---

## Decided
- History renders each tool_use as `<｜DSML｜invoke name="X" call="n">` (n = order in the conversation) and its result as `<tool_result call="n" name="X">`; the opaque `tool_use_id` is no longer shown to the model. Idea taken from Qwen2API (`[TOOL CALL #n]` / `[TOOL RESULT #n: Name]`), which needed it to tell apart repeated calls to the same tool.
- Numbering is done in one pass in `toChatInput` (src/routes/anthropic-compat.ts): calls always precede their results.
- `RE_INVOKE_OPEN` ignores extra attributes after `name="…"`, so a model copying `call="4"` into its own call still parses.

## Tried and ruled out
- Switching to Qwen2API's `[TOOL CALL]` + JSON format: JSON forces escaping file contents (Qwen2API ships repairs for raw newlines and broken quote parity), DeepSeek emits DSML natively, and Qwen2API's ~3k-line parser shows the same drift, not less. No A/B run yet.
- Reusing tool_use ids instead of ordinals: long random strings, cost tokens and invite invented ids.

## Watch out
- `blockToText` takes an optional CallIndex; never pass it straight to `.map` (the index argument would land in that slot).
