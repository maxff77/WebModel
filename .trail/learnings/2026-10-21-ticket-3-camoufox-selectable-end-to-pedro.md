---
title: "Ticket 3: Camoufox selectable end to end"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 7, tokens: 140061 }
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
Ticket maxff77/WebModel#3 wires Camoufox as an end-to-end selectable engine. `browser.engine` ('chrome' default) comes from config, `--engine`, or `WMB_BROWSER_ENGINE`; resolution order matches the loader's existing pattern (config < CLI < env). The manager picks a profile dir per engine: Chrome keeps `browser.profileDir` untouched, Camoufox uses `<stateDir>/camoufox-profile` (CLI passes it explicitly; manager falls back to a sibling of profileDir for test doubles). `camoufox-js` is an optionalDependency (0.13.0) and is imported dynamically via `import('camoufox-js' as string)` so tsc never resolves it; `Camoufox({ user_data_dir, headless })` returns the persistent BrowserContext. Launch failures are wrapped with the exact fix command `npx camoufox-js fetch`. Attach + camoufox warns in the CLI and the manager normalizes mode to launch. `/webmodel/health` now exposes `browser.engine`. Tests at the existing launcher seam cover engine selection, per-engine profile paths, the headed login window using the camoufox profile, and the health field.

## Tried and ruled out
Regular `dependencies` for camoufox-js: rejected because npm install would then pull native deps (better-sqlite3, impit) for every Chrome user; optionalDependencies keeps the default install unchanged. Relying on camoufox-js's own missing-binary message: it says `camoufox fetch`, not `npx camoufox-js fetch`, so the launcher wraps it. Keeping the old unit test "rejects an engine with no launcher configured": obsolete once a default camoufox launcher exists, and it actually started a real 313 MB download before timing out; removed.

## Watch out
camoufox-js auto-installs its pinned browser (313 MB) at first launch when no supported build is cached; this machine had an older `jwriter20/152.0.4-beta.30` build that 0.13.0 did not accept. The acceptance criterion "DeepSeek chat works with a Camoufox-profile session" was NOT verified (needs the binary and a login). The doctor still treats a missing Chrome as fatal, so a Chrome-less Camoufox user cannot start until ticket #4. Fork issue bodies are shifted by one (ticket #3's criteria live in issue #2's body); titles and the parent spec are authoritative. `npm test` e2e files fail without real provider logins; unit+integration (254 tests) is the meaningful regression suite.
