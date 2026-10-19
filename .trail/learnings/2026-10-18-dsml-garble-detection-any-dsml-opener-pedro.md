---
title: "DSML garble detection: any DSML opener starts a block"
author: Pedro
date: 2026-10-18
branch: fix/claude-code-agent-tools
cost: { minutes: 5, tokens: 488903 }
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
- `RE_BLOCK_START` in src/core/tool-protocol.ts matches any `<｜DSML｜\w` opener outside code, not only `function_calls>` / `invoke `. Unknown garbles then reach `scanBlock`, get `malformed: true`, and the route's existing single retry fires.
- Trigger: DeepSeek fused the opener with a parameter, `<｜DSML｜function_calls｜parameter name="command" ...>`, losing the invoke and tool name. Old detector returned -1, so the block went to Claude Code as prose and the turn ended with no retry.

## Tried and ruled out
- Recovering the call: the tool name is gone; guessing it from parameter names (command → Bash) was not done.
- Stale bridge: PID started 13:47, after a0a0cf3 (13:38), so the retry code was loaded; detection was the gap.

## Watch out
- Prose with a bare `<｜DSML｜…` tag outside backticks is now treated as a block (malformed or truncated → retry / max_tokens).
- Bridge has no watch; restart the 127.0.0.1:3456 listener (not teamclaude) after editing.
