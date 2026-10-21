---
title: "Ticket 12 review fixes: launch safety and one warning source"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 1, tokens: 13830 }
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
- Supersedes one point in the earlier "Ticket 12: regenerar la huella de un perfil" note: `BrowserManager.launch()` catches a throwing `resolveProfile` and keeps the cached profile. Otherwise a broken manifest would be read as a launch failure and could fail over to another account silently.
- `ProfileStore.regenerateFingerprint()` uses `get()` instead of `resolve()`, so a dangling fallback does not block fingerprint rotation. Truly unknown profiles still throw the shared `unknownProfile()` error.
- A generator returning `undefined` throws a clear error instead of crashing `writeFileSync` with a raw TypeError.
- The warning copy lives once in `FINGERPRINT_COOKIE_WARNING`. `GET /webmodel/profiles` returns it and the dashboard confirm dialog uses it; `POST /webmodel/profiles/fingerprint` returns it too.

## Watch out
- `GET /webmodel/profiles` now includes a `warning` field; tests that assert its exact JSON shape must include it.
