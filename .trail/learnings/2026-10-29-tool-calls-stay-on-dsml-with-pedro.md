---
title: Tool calls stay on DSML with wider tolerances; the line-marker format waits for 200 measured replies
author: Pedro
date: 2026-10-29
branch: feat/deepseek-account-pool
cost: { minutes: 4, tokens: 202109 }
id: l-ac545663
scope: repo
status: active
replaces: l-eed20876
src: agent
touches:
  - src/core/tool-protocol.ts
  - tests/unit/core/tool-protocol.test.ts
  - src/routes/anthropic-compat.ts
---

## Decided
- Goal: reliable, cheap tool calls. Detectability by DeepSeek is not a criterion (sanctions track volume, not syntax).
- Parser tolerates singular `function_call`, `</invoke name="X">` as an opener, `parameter name="invoke" name="X">`, and closers without the DSML prefix. Re-ask only when a garbled block has 0 calls. Tool names match the request case-insensitively. A `[tools]` line per tool-call reply logs outcome, reask, catalog/history token estimates.
- First 62 replies (2026-10-29): 60 ok, 1 partial, 1 "truncated" that was really prefix-less closers (now parsed), 0 re-asks. Catalog ~19.5K est. tokens (~34% of prompt), not the old ~700 KB.
- Line-marker format (`[[call X #n]]`/`[[param]]`/`[[end]]`, A/B per request) is designed but not built: build it only if errors stay above ~3% at 200 replies, or for the history token saving.

## Tried and ruled out
- A rare format to avoid bans; JSON calls (escaping); re-asking blocks that already had complete calls (each re-ask re-sends the whole prompt).

## Watch out
- Remaining loss: an invoke whose opener is missing (params after `</invoke>`); its tool name is gone, not guessed.

In the code: src/core/tool-protocol.ts (CALLS, INVOKE_CLOSE, RE_INVOKE_OPEN), src/routes/anthropic-compat.ts (re-ask condition, `[tools]` line, toolNames).
