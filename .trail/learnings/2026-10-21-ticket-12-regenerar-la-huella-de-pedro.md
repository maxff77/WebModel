---
title: "Ticket 12: regenerar la huella de un perfil"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 4, tokens: 41301 }
touches:
  - docs/camoufox-engine-spec.md
  - src/browser/manager.ts
  - src/cli.ts
  - src/dashboard/app.js
  - src/profiles/store.ts
  - src/routes/management.ts
  - tests/unit/browser/manager.test.ts
  - tests/unit/profiles/store.test.ts
  - tests/unit/routes/management.test.ts
---

## Decided
- `ProfileStore.regenerateFingerprint(name)` rewrites `profiles/<name>/fingerprint.json` and touches nothing under `data/`, so cookies and login survive. Only camoufox profiles qualify; chrome has no persisted fingerprint.
- CLI: `web-model-bridge profile regenerate <name>`. Dashboard: "New fingerprint" button (camoufox rows) -> `POST /webmodel/profiles/fingerprint` with `{ name }`. Both print/show the same warning: keeping existing cookies with a new fingerprint is more suspicious than a clean profile.
- The warning is unconditional: no cookie detection. It is valid whether or not cookies exist, and a wrong `cookies.sqlite` assumption would silently hide it.
- `BrowserManager.launch()` re-resolves the active profile by name so a regenerated fingerprint applies on the next launch in the same process, not only after a bridge restart. The `persisted.name === this._profile.name` guard keeps failover and its mocks intact.

## Watch out
- A running browser context keeps the fingerprint it launched with; regeneration only affects the next `launch()`. Do not expect the current context to change.
- `resolveProfile` in the manager can throw (ProfileStore.resolve validates fallbacks); launch now calls it, so a manifest broken while the bridge runs fails at the next launch instead of silently reusing the cached profile.
