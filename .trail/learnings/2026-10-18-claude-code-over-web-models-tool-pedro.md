---
title: "Claude Code over web models: tool calling via DSML text protocol"
author: Pedro
date: 2026-10-18
branch: fix/claude-code-agent-tools
cost: { minutes: 52, tokens: 2244874 }
touches:
  - src/core/anthropic-formatter.ts
  - src/core/provider.ts
  - src/providers/chatgpt/index.ts
  - src/providers/claude/index.ts
  - src/providers/deepseek/index.ts
  - src/providers/doubao-web/index.ts
  - src/providers/gemini-web/index.ts
  - src/providers/glm-web/index.ts
  - src/providers/grok-web/index.ts
  - src/providers/kimi-web/index.ts
---

## Decided
- Anthropic route always passes `tools` (maybe []) → `buildWebPrompt` renders the full transcript (system header, tools, ordered history incl. tool_use/tool_result). Without tools (OpenAI/OpenClaw path) the legacy last-message behavior is kept.
- Tool calls use DeepSeek's DSML tags; `src/core/tool-protocol.ts` is an anchored scanner: first block only, ignores DSML in ``` fences / inline code, a parameter closer only ends a value when DSML structure follows, duplicate keys first-wins.
- Provider failures become real API errors (429 `rate_limit_error` for DeepSeek "Messages too frequent", else 502) so Claude Code retries; a reply cut inside a tool call becomes `stop_reason: max_tokens`, which makes Claude Code ask to continue in smaller pieces. Requests are serialized per provider (one shared browser tab).

## Tried and ruled out
- Compacting the 287-tool / ~700 KB prompt: DeepSeek web accepted a 725k-char prompt and still read its start (6 s), so no compaction.

## Watch out
- The dev bridge (`npm run dev`, no watch) on 127.0.0.1:3456 must be restarted after edits; teamclaude also listens on *:3456 (real Anthropic proxy) — don't kill it.
- DeepSeek emits tag variants (`<｜｜DSML｜｜ calls>`, mixed closers, broken `<｜DSML｜file_path" string="true">`) and rate-limits in-band via `event: hint` SSE.
- Claude Code 2.1.x sends `role: "system"` messages mid-conversation (hooks, MCP instructions); keep them in place.
- Nested `claude -p` e2e runs inherit the user's permission mode: pass `--permission-mode default`.
