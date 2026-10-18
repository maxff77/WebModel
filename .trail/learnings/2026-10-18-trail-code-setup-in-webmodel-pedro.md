---
title: Trail-code setup in WebModel
author: Pedro
date: 2026-10-18
branch: master
cost: { minutes: 2, tokens: 0 }
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
- Installed @trailhq/trail-code globally (0.23.0) and ran `trail init --agents claude` in this repo; graph built with 402 nodes / 1,041 edges.
- Left .trail/ uncommitted for now — needs one commit so teammates pick up learnings.

## Tried and ruled out
- Nothing ruled out this session.

## Watch out
- `npm install -g @trailhq/trail-code` emits peer-dependency warnings for tree-sitter / tree-sitter-swift; install still succeeds, warnings are harmless.
- `trail init` reported "couldn't read your past sessions this time"; learnings stay empty as a result. Re-run `trail init --agents claude` to retry the session read.
- The trail skill only loads in a NEW Claude Code session — restart is required after init.
