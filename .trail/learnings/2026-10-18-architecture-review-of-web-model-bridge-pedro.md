---
title: Architecture review of web-model-bridge provider layer
author: Pedro
date: 2026-10-18
branch: fix/claude-code-agent-tools
cost: { minutes: 8, tokens: 0 }
touches:
  - src/core/anthropic-formatter.ts
  - src/core/provider.ts
  - src/core/tool-protocol.ts
  - src/providers/chatgpt/index.ts
  - src/providers/claude/index.ts
  - src/providers/deepseek/index.ts
  - src/providers/doubao-web/index.ts
  - src/providers/gemini-web/index.ts
  - src/providers/glm-web/index.ts
  - src/providers/grok-web/index.ts
---

## Decided
- Scoped the review to the last 20 commits' hot spots: the 11 provider adapters, core/, and the two compat routes.
- Candidates ranked: (1) collapse 4 shallow adapters into one config-driven adapter, (2) split buildWebPrompt's two modes, (3) unify the tool-protocol encode/decode seam, (4) Router has no production caller, (5) page-fetch bootstrap duplication in claude/deepseek.
- Q2 answer preference: config lives in each provider's index.ts, keeping PROVIDER_MAP/NEEDS_GET_PAGE in cli.ts untouched.

## Tried and ruled out
- Not diffing gemini/xiaomimo: line count + grep shape match is weaker evidence than the grok vs perplexity diff (only lines 12-13 and 38 differ). Still needs a real diff before collapsing.
- Fixing/verifying the /api/chat/completions endpoints during the collapse: out of scope, separate task.

## Watch out
- 4 adapters (gemini-web, grok-web, perplexity-web, xiaomimo-web) are identical modulo a base-URL constant and model list; they may be aspirational stubs, not working providers. Preserve behaviour, don't "fix" silently.
- Router (src/core/router.ts) is only constructed in tests/unit/core/router.test.ts; retry logic actually shipped lives inline in anthropic-compat.ts, none in openai-compat.ts.
- No GLOSSARY.md and no docs/adr/ in the repo yet.
