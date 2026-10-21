---
title: "Token estimate accuracy: measured +8% over, not the cause of a fast-filling window"
author: Pedro
date: 2026-10-20
branch: fix/claude-code-agent-tools
cost: { minutes: 6, tokens: 257950 }
touches:
  - tests/unit/routes/probe-usage.test.ts
---

## Decided
- Measured estimateTokens on a REAL Claude Code request captured by pointing nested `claude -p` at a fake Anthropic server: full prompt 31,043 est vs 28,778 gpt-tokenizer (ratio 1.079). Breakdown: system 1.205, rendered tool schemas 1.105, conversation 1.000.
- On real session transcripts (tool results, code, JSON) the ratio is 0.91–1.06 — the estimate UNDER-counts as the transcript grows. Net: no meaningful over-estimate; not the cause of a fast-filling context meter.
- Falsified the message_delta double-count theory with an A/B SSE: Claude Code records input_tokens 50000 from message_start whether or not message_delta repeats it. It merges, does not add.
- Why the bridge window fills fast is real content, not counting: a fresh request is ~29k real tokens (12 tool schemas ~10.3k, Claude Code system ~5.7k, SessionStart hook injections ~12.7k), i.e. ~23% of a 128k model before the first word, and every turn re-sends the whole transcript.

## Tried and ruled out
- "chars/4 is over-counting Latin/JSON, that is why the bar runs hot": measured on the real payload, only +8% overall.
- "message_delta repeating input_tokens doubles the recorded usage": false, verified via transcript .jsonl.

## Watch out
- Driving nested `claude -p` against a fake server: pass --model claude-sonnet-4-5-20250929, list it in /v1/models, and match routes on pathname (Claude Code calls /v1/messages?beta=true). Otherwise "unrecognized_model" and zero requests.
- Cheapest way to get the exact messages/tools the Anthropic route builds: a throwaway vitest using createTestContext + a CapturingProvider, then compare estimateTokens(buildWebPrompt(...)) against gpt-tokenizer.
- Ground truth was gpt-tokenizer (cl100k), not DeepSeek's tokenizer; ±5% possible. And whether Claude Code consumes max_input_tokens for a custom model id is still unverified.
