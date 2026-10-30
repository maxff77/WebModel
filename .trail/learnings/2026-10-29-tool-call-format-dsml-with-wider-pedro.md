---
title: "Tool-call format: DSML with wider tolerances now, A/B a line-marker format next; re-ask only when no call parsed"
author: Pedro
date: 2026-10-29
branch: feat/deepseek-account-pool
cost: { minutes: 26, tokens: 210327 }
id: l-eed20876
scope: repo
status: active
src: agent
touches:
  - src/core/tool-protocol.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/tool-protocol.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - tests/unit/doctor.test.ts
---

## Decided
- Grilling with Pedro 2026-10-28. Goal is reliability and efficiency of tool calls. Detectability by DeepSeek is not a criterion: the measured sanctions follow volume and bursts, not the call syntax.
- Phase 1 (done, uncommitted): the parser accepts singular `function_call`, a closer slash on an invoke opener (`</｜DSML｜invoke name="X">`) and `parameter name="invoke" name="X">`. The route asks again only when a garbled block has 0 calls; complete calls run and the rest is dropped. Tool names match the request's tools case-insensitively; unknown names pass through. One `[tools]` line per tool-call reply: format, outcome (ok/partial/garbled/truncated), calls, reask, catalog and history token estimates, shape when not ok.
- Phase 2 (agreed, not built): `toolFormat: dsml | lines | ab`. Lines format: `[[call X #n]]`, `[[param]]`, `[[end]]` required, each marker on its own line; a param marker counts only for a param of the current tool not yet seen in that call; types from the tool schema; strip exactly one trailing newline per value; DSML parser stays as fallback (logged as a slip). A/B random per request (valid because the history is re-rendered per request). Winner after >=200 tool-call replies each: lower error rate (re-asked, lost call or truncated); tie goes to lines. Then drop `ab`.

## Tried and ruled out
- A rare format chosen to avoid bans: no evidence links bans to the format.
- JSON calls: still ruled out (escaping of file contents).
- Re-asking blocks that already had complete calls: 4 of 9 garbles had calls; each re-ask re-sends the whole prompt.

## Watch out
- Replay of the 9 garbled shapes in bridge.log (2026-10-24..27, «1» as newline, «N» as N chars): before 0 complete, now 5 complete, 1 partial, 1 still re-asked (`function_call name="Bash"` with no param openers), 2 parse clean from the shape, so their real cause is not visible in the shape.
- tests/unit/doctor.test.ts can time out at 5 s in the full unit run; it passes alone with and without these changes.

In the code: src/core/tool-protocol.ts (CALLS, RE_INVOKE_OPEN), src/routes/anthropic-compat.ts (re-ask condition, `[tools]` line, toolNames).
