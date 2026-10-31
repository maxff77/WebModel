---
title: "Lines format: markers with no call opener are re-asked, not passed on as prose"
author: Pedro
date: 2026-10-31
branch: feat/deepseek-account-pool
cost: { minutes: 7, tokens: 232473 }
id: l-f7e03bcc
scope: repo
status: active
src: agent
touches:
  - src/core/tool-protocol.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/tool-protocol.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
---

## Decided
- 2026-10-31: a subagent received `[[Bash]]`, the command, then `[[end]]` three times as plain text. The model had dropped `call` and the param marker. The lines parser found no `[[call NAME]]` line, so it returned the whole reply as prose with end_turn.
- Now a line that is exactly `[[end]]` or `[[ToolName]]`, outside code fences and outside inline code, flags the reply as malformed when no `[[call]]` opener is found. The route asks once more, like a garbled DSML block. The prose before the first stray marker is kept.

## Tried and ruled out
- Recovering the call by putting the value into the tool's only required param (`command` for Bash): that is a guess. The DSML path already ruled out guessing parts of a call.

## Watch out
- Before this fix, the leak left no `[tools]` line, because a reply with calls=0 that is neither truncated nor malformed is not logged. So the A/B counts up to 2026-10-31T03:48Z undercount lines failures by every such leak. One was found in the Prueba-cc transcripts.

In the code: `parseLineCalls` in src/core/tool-protocol.ts (the `start < 0` branch). Test: "markers without a [[call]] opener…" in tests/unit/core/tool-protocol.test.ts.
