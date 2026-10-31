---
title: Tool-call formats DSML and line markers now run as an A/B per request
author: Pedro
date: 2026-10-30
branch: feat/deepseek-account-pool
cost: { minutes: 10, tokens: 296608 }
id: l-f5f9712e
scope: repo
status: active
replaces: l-ac545663
src: agent
touches:
  - src/core/tool-protocol.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/tool-protocol.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - vitest.config.ts
---

## Decided
- 2026-10-30: 731 DSML tool-call replies gave 3.6% errors (7 re-asked then ok, 3 still garbled, 12 partial, 4 truncated), above the 3% bar, so the line-marker format was built. `WMB_TOOL_FORMAT` = dsml | lines | ab (default ab: a coin flip per request; the history is re-rendered each request, so one session can switch).
- Lines format: `[[call NAME #n]]`, `[[param]]` alone on a line with the raw value below, one `[[end]]` per block. A param marker counts only for a schema param of that tool not given yet; types come from the schema; one newline before each marker is the separator. A DSML reply to a lines prompt still parses and logs `slip=1`.
- Change from the grilling: any `[[call NAME]]` line counts, not only request tools, so a hallucinated tool reaches Claude Code ("No such tool") instead of corrupting the previous value.
- DSML parser also takes a calls opener repeated between invokes, a doubled invoke closer, and `name"string"` params: replaying the 29 logged failure shapes, 8 now parse whole (1 before), partials 12 -> 5.
- Winner: >=200 tool-call replies per format in the `[tools]` lines (field 4 is the format), lower error rate wins, tie goes to lines. Then drop `ab` and the loser.

## Watch out
- On 2026-10-30 the working tree had the pacing removal in queue.ts but not its route/test half (the route imported the deleted `requestPacing`, so a restart would have crashed). No transcript shows who undid it; the route and test edits were re-applied verbatim from session 821580a7.
- Tests pin `WMB_TOOL_FORMAT=dsml` in vitest.config.ts.

In the code: src/core/tool-protocol.ts (parseLineCalls, parseReply, renderToolCalls/renderToolsPrompt format arg), src/routes/anthropic-compat.ts (toolFormat, per-request format, `[tools]` line), ChatRequest.toolFormat forwarded by every provider's buildWebPrompt call.
