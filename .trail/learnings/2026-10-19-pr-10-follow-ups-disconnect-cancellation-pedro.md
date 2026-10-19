---
title: "PR #10 follow-ups: disconnect cancellation, Hangul, DSML closer, and the wedged Chrome"
author: Pedro
date: 2026-10-19
branch: fix/claude-code-agent-tools
cost: { minutes: 30, tokens: 402966 }
touches:
  - src/core/provider.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - src/core/tool-protocol.ts
  - tests/unit/core/tool-protocol.test.ts
  - src/routes/anthropic-compat.ts
---

## Decided
- PR #10 now carries d4b703a (client-disconnect cancellation via c.req.raw.signal, abortable cooldown sleep, 499 without provider call), 8fa267f (CJK-aware estimateTokens + max_input_tokens/max_tokens in /v1/models), 2a26dee (a DSML block whose closer is broken but whose invokes all closed is complete, not malformed), da8044c (Hangul in the CJK regex: U+AC00-U+D7AF syllables, U+1100-U+11FF Jamo). Both CodeRabbit threads replied and resolved.
- Playwright connectOverCDP hung against the long-running user Chrome (CDP HTTP and raw WS replied; Browser.getVersion answered; a fresh Chrome 155 + Playwright 1.59.1 connected fine). Restarting that Chrome fixed it. Closing stale DeepSeek session tabs and duplicate tabs did not.
- Hangul/Kana/CJK all measured ~1.0 token/char with gpt-tokenizer o200k; the 0.6 CJK rate is a deliberate prior choice, so the fix only adds Hangul to the regex.

## Tried and ruled out
- Checking CDP liveness (/json/version, raw WebSocket, Browser.getVersion) to predict whether Playwright can attach: ruled out, all three passed while connectOverCDP timed out.
- osascript quit of Chrome hung (probably a confirmation dialog); SIGTERM to the main pid worked, tabs restore from the profile.

## Watch out
- The bridge runs from src with tsx and no watch; restart after edits. It listens on 127.0.0.1:3456 IPv4 while teamclaude listens on *:3456 IPv6; during bridge warmup a request can be answered by teamclaude. Wait for /webmodel/health before testing.
- DeepSeek's fetch is inside page.evaluate, so cancellation stops new prompts but cannot abort an in-flight tab request.
