---
title: "Token usage in the Anthropic route: script-aware estimate + context window on /v1/models"
author: Pedro
date: 2026-10-19
branch: fix/claude-code-agent-tools
cost: { minutes: 12, tokens: 10217132 }
touches:
  - package-lock.json
  - package.json
  - src/core/openai-formatter.ts
  - src/core/provider.ts
  - tests/unit/routes/anthropic-agent.test.ts
---

## Decided
- estimateTokens (src/core/provider.ts) is now script-aware: Latin at chars/4, CJK (U+3000–U+9FFF, U+F900–U+FAFF, U+FF00–U+FFEF) at 0.6 tok/char. Chinese replies were reported at half their real cost.
- /v1/models now emits max_input_tokens and max_tokens from ModelInfo (contextWindow/maxOutput) in formatModelsResponse (src/core/openai-formatter.ts). Claude Code reads these to size its context bar and auto-compact; without them it falls back to its own default for a custom model id (e.g. deepseek-web/deepseek-v4 has 128000 real).
- Usage tests assert against gpt-tokenizer (added as devDependency) as ground truth, not against the bridge's own heuristic, so they measure the right TEXT instead of mirroring the implementation.

## Tried and ruled out
- "chars/4 under-counts Latin/JSON, that's why the number reads low": FALSIFIED by measuring with gpt-tokenizer. chars/4 OVER-counts English ~16% (22 vs 19), JSON/tool-schema ~19-26% (44 vs 35), and a synthetic 1.1MB Claude-Code-shaped tool prompt ~19% (284523 vs 239000). Only CJK was under-counted, exactly 2x. Do not "fix" Latin by raising the divisor.
- "parseToolCalls strips DSML tool-call arguments out of usage": false. usage counts raw reply.text, so tool arguments were already counted. Regression test kept anyway.

## Watch out
- Still unexplained: "a veces el número demasiado bajo" for Latin text. message_delta currently sends input_tokens; the real Anthropic API sends only cumulative output_tokens there. Unverified whether Claude Code double-counts or ignores it — left untouched because no failing loop covers it. Next probe: capture one real SSE exchange from a live Claude Code session and compare what Claude Code stores in its transcript .jsonl against buildWebPrompt length.
- The context-bar fix is only proven at the payload shape level (unit test on /v1/models). Whether Claude Code actually consumes max_input_tokens for a custom model id is unverified — needs a restart of the bridge and a live session.
- The bridge (npm run dev) has no watch: restart after edits.
- 15 e2e failures (real provider auth in tests/e2e/*) are pre-existing; confirmed identical with git stash baseline.
