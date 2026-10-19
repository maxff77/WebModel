---
title: Fallback for unknown model ids (Claude Code subagents send claude-sonnet-5-5)
author: Pedro
date: 2026-10-18
branch: fix/claude-code-agent-tools
cost: { minutes: 8, tokens: 131914 }
touches:
  - src/cli.ts
  - src/config/loader.ts
  - src/core/registry.ts
  - tests/helpers/test-server.ts
  - tests/unit/routes/anthropic-agent.test.ts
  - src/core/tool-protocol.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/tool-protocol.test.ts
  - src/core/router.ts
---

## Decided
- Ids no provider has (Claude Code subagents ask for `claude-sonnet-5-5`; 35 `Invalid model` errors in transcripts, all that id) are served by `providers.fallbackModel` (config.yml or env `WMB_FALLBACK_MODEL`). Null, the default, keeps the 400 `invalid_model`, so setups that don't set it are not silently rerouted.
- Applied in `ProviderRegistry.resolve`, after the existing `provider/model` and bare-id lookups, so the Anthropic and OpenAI routes both get it. Every fallback logs a `[registry]` warn line with the requested id.
- `providers.defaultModel` was never read anywhere; renamed it to `fallbackModel` instead of adding a second key.

## Tried and ruled out
- Wiring `src/core/router.ts` `Router`: it has no production caller (tests only), and its fallbacks are provider failover after `resolve` succeeds; `resolve` throws first for unknown ids.

## Watch out
- `provider/model` with a registered provider never reaches the fallback: the model part is not validated, the provider receives it as-is.
- Fallback requests share the fallback provider's lane (`ProviderQueue`), so subagents queue behind the main session.
- Bridge has no watch mode: a config.yml change needs a restart.
