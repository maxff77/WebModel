---
title: "Diagnosing 'API error' in Claude Code that uses web-model-bridge"
author: Pedro
date: 2026-10-20
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 216076 }
touches:
  - src/cli.ts
---

## Decided
- First check for "API error" in Claude Code wired to this bridge: `curl -s http://127.0.0.1:3456/webmodel/health`. It gives uptime (when bridge last restarted), browser status, and which providers are authenticated.
- Then replay the client's request shape against the bridge: `POST /v1/messages` with `stream:true` plus a `tools` array. A 200 with `message_start`/`tool_use` events proves the bridge and upstream provider work; the failure is then client-side, config-side, or transient.
- Session env: inspect a running `claude` process with `ps eww -p <pid> | tr ' ' '\n' | grep ^ANTHROPIC_` (redact values) to see BASE_URL and model mapping.

## Tried and ruled out
- Ruled out a systemic outage: at the time of debugging, `/webmodel/health` was healthy, browser running, deepseek-web/qwen-web/gemini-web authenticated, and both non-stream and streaming+tool-use requests returned 200. So the user's error was transient or request-specific, not a dead bridge.
- Ruled out an empty-provider issue for the user's session: it was mapped to `deepseek-web/deepseek-v4`, which works.
- Did not need a code change.

## Watch out
- `claude-web` was not authenticated on this machine. Model ids `claude-sonnet-4-6` and `claude-haiku-4-5` are real ids of the claude-web provider, so they fuzzy-match and return 401 "not authenticated" instead of using `providers.fallbackModel`. The fallback only catches ids no provider has (e.g. `claude-sonnet-5-5`).
- `/webmodel/metrics` and `/webmodel/logs` return 503 "Metrics not available": metrics are not wired in `src/cli.ts`, and `~/.webmodel/logs/bridge.log` is not created. Do not rely on them for diagnosis.
- Bridge has no file watch; a restart is required after code edits. `/webmodel/health` `uptime` tells when it was last restarted.
- To pin a user's "API error", the exact error text is required: it distinguishes bridge-restart window, 401 unauthenticated provider, and upstream rate limit.
