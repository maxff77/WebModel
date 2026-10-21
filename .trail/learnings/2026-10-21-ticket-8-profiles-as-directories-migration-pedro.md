---
title: "Ticket 8: profiles as directories, migration and attach release"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 16, tokens: 243839 }
touches:
  - docs/camoufox-engine-spec.md
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/core/queue.ts
  - src/dashboard/app.js
  - src/dashboard/index.html
  - src/dashboard/style.css
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
---

## Decided
- Ticket maxff77/WebModel#8 replaces the engine axis with profiles: `profiles/<name>/manifest.json` + `data/` (browser user-data dir) + `fingerprint.json` (Camoufox only). The filesystem is the source of truth; config stores only `browser.profile`.
- `default` migrates by moving the legacy dir: the configured engine's dir first (`browser.profileDir` or `camoufox-profile`), else the other engine's. The guard is the default manifest, so a failed move retries on the next start. Cookies move with it, so no re-login.
- Active profile resolves config < `--profile` < `WMB_PROFILE`. A dashboard switch calls `manager.activate` and then persists `browser.profile` into config.yml.
- Attach is legal only for the `default` (chrome) profile. The rule lives in `attachProfileError()` and is used by CLI startup and `manager.activate`. Release happens before the profile swap: launch closes the context; attach closes the CDP Browser, which playwright-core 1.59 maps to closing the transport (verified in its source), so the user's Chrome stays open.
- Camoufox profiles persist the generated fingerprint and the launcher now sends it back on launch. Before this, camoufox-js generated a new random fingerprint on every start.
- `browser.engine` survives only as the engine used to create a first-run `default`; the active profile's engine wins.
- tsup now externalizes `camoufox-js`; `npm run build` was already broken at HEAD because esbuild bundled its native optional deps.
## Tried and ruled out
- Duplicating `--state-dir`/`--config`/`--engine` on `profile` subcommands: commander treats root options as global and the subcommand's copy is shadowed, so it silently used `~/.webmodel`. Read `program.opts()` instead.
- Falling back to a copy when the legacy dir cannot be renamed: copying a locked Chrome profile is inconsistent; fail with "close Chrome and retry" instead.
- A fingerprint for chrome profiles: the Chrome launcher has no fingerprint hook and the generator needs the optional camoufox dep.
- Keeping `--chrome-profile`: removed; the profile dir is the source of truth. `browser.profileDir` is kept only as the legacy migration source.
## Watch out
- Any profile command run against a state dir in the old layout migrates (moves) it immediately. A smoke test migrated the real `~/.webmodel` profile this way. The tool has no undo, though the data is intact under `profiles/default/data`.
- The e2e suite still fails without real logins and the openclaw auth-profiles file; unit+integration (296 tests) is the regression suite.
- `writeActiveProfile` re-dumps config.yml, dropping comments (settings preserved), and refuses to touch a file it cannot parse.
