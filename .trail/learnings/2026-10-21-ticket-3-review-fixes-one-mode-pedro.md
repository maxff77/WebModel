---
title: "Ticket 3 review fixes: one mode rule, derived Camoufox profile"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 1, tokens: 17285 }
touches:
  - package-lock.json
  - package.json
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/management.ts
---

## Decided
After the two-axis review, ticket #3 simplified to one owner per rule. The `camoufoxProfileDir` option is gone: the manager always derives Camoufox's profile as a sibling of `browser.profileDir`, so `WMB_STATE_DIR` moves both engines together. `effectiveMode(engine, mode)` in manager.ts is the single attach→launch rule, used by the CLI, the constructor, and `activate()` (which recomputes mode when the engine switches). Invalid `--engine`/`WMB_BROWSER_ENGINE` values are ignored; an invalid YAML engine falls back to chrome. The Camoufox launcher forwards `startupTimeout` (camoufox-js spreads unknown launch options into launchPersistentContext) and includes the import error in its message. The unreachable "No launcher configured" branch was deleted now that both engines have defaults.

## Tried and ruled out
Explicit `camoufoxProfileDir`: removed; it duplicated the derivation and diverged from Chrome's path under WMB_STATE_DIR. Hard-erroring on an invalid engine: rejected because the existing loader contract (and its test "handles invalid YAML gracefully") is silent fallback, even though the older design doc's test table mentions invalid-config errors. Keeping the mode coercion in both CLI and manager: replaced by `effectiveMode`.

## Watch out
The doctor still runs before `loadConfig` and treats missing Chrome as fatal, so a Chrome-less machine cannot start with `--engine camoufox` until ticket #4; this is a known gap in #3's "end to end" promise. The missing-binary hint has no unit test (manual verification with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` prints `npx camoufox-js fetch`). `import('camoufox-js' as string)` bypasses upstream types on purpose so the optional dependency never has to resolve at typecheck time.
