---
title: "DeepSeek context window reported to Claude Code raised to 256K, not 1M"
author: Pedro
date: 2026-10-28
branch: feat/deepseek-account-pool
cost: { minutes: 2, tokens: 91840 }
id: l-442a2982
scope: repo
status: active
src: agent
touches:
  - src/providers/deepseek/index.ts
  - src/core/openai-formatter.ts
---

## Decided
- The bridge tells Claude Code 256K for both DeepSeek V4 models (was 128K). Claude Code sizes its context bar and auto-compact from `max_input_tokens` in /v1/models: the user saw exactly the 128K the bridge reported.
- 256K, not 500K or 1M: DeepSeek says V4 takes 1M on all official services, but MRCR 8-needle recall stays above 0.82 only through 256K and falls to 0.59 at 1M (Hugging Face V4 blog). The bridge also re-sends the whole transcript as one web prompt each turn, so a larger window means larger, slower uploads.

## Tried and ruled out
- Measuring the real web limit with a needle prompt (~250K tokens, one code at the start, one in the middle): not run, the account was muted until 2026-10-30. The largest prompt known to work is still ~725k chars (~180K tokens, 2026-10-18).

## Watch out
- Above ~180K tokens through chat.deepseek.com is unverified. If long sessions fail near the limit, run the needle test before you raise or lower the number.

In the code: src/providers/deepseek/index.ts `models()`; src/core/openai-formatter.ts maps contextWindow to max_input_tokens. Restart the bridge after a change (no watch).
