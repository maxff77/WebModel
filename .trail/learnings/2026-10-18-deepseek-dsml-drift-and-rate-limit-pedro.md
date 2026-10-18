---
title: DeepSeek DSML drift and rate-limit pacing for Claude Code subagents
author: Pedro
date: 2026-10-18
branch: fix/claude-code-agent-tools
cost: { minutes: 25, tokens: 732040 }
touches:
  - src/core/tool-protocol.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/tool-protocol.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - src/core/anthropic-formatter.ts
  - src/core/provider.ts
  - src/providers/chatgpt/index.ts
  - src/providers/claude/index.ts
  - src/providers/deepseek/index.ts
  - src/providers/doubao-web/index.ts
---

## Decided
- DeepSeek garbles the first tag after `<｜DSML｜function_calls>` in ~1.2% of tool-call replies (4 of 336 on 2026-10-18): repeated calls opener; invoke written as a parameter (`parameter name="invoke" string="true">Bash</…parameter>`); `parameter name="invoke name="Bash">`; doubled `parameter name="parameter name="command"`; or no invoke at all. The parser accepts the first four; anything else that isn't followed by a closer is `malformed`.
- The Anthropic route asks once more on a malformed block (each DeepSeek chat() opens a fresh chat session, so the garbled reply is not in context). Still malformed: drop the block and answer `max_tokens`, so Claude Code resumes instead of ending the turn (that end_turn was the "session stops, I have to say continue" symptom).
- "Messages too frequent": retry inside the queued task with an exponential cooldown (5 s doubling; give up after 180 s and return 429). Waiting inside the lane holds back every other queued request (parallel subagents) instead of each agent retrying on its own into the limit.

## Tried and ruled out
- Inferring the tool name from parameter keys when the invoke is missing: skipped, the re-ask covers it.
- A fixed minimum gap between messages: a real burst of 8 parallel requests got 7 through in ~17 s, then the 8th was refused even 10 s after the previous attempt, so the limit looks like a window/quota rather than spacing. The reactive cooldown passed 8/8 (waits 5+10+20 s).

## Watch out
- The bridge keeps no persistent log (`logging.file` is never written; `/webmodel/logs` answers "Metrics not available"). Diagnose from Claude Code transcripts in ~/.claude/projects/<project>/<session>.jsonl: `type: system, subtype: api_error` entries are 429 retries; assistant text containing `<｜DSML` is a leaked call. Retries now print `[deepseek-web] rate limited…` / `garbled tool-call block…` on the bridge's stdout.
- `npx vitest run` also runs tests/e2e, which hit real services and fail without them (14 fail on HEAD too); use `npx vitest run tests/unit`.
