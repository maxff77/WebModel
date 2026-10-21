---
title: "Ticket 9: auth state per profile"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 86968 }
touches:
  - docs/camoufox-engine-spec.md
  - src/auth/store.ts
  - src/cli.ts
  - src/core/queue.ts
  - src/dashboard/app.js
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
  - src/server.ts
---

## Decided

- Ticket maxff77/WebModel#9 makes auth state per profile. `AuthStore` stores `profiles/<name>/auth.json`, takes an `activeProfile: () => string` callback (wired to `browserManager.getProfile().name`) and reloads its cache only when the active profile name changes.
- Legacy global `<stateDir>/auth.json` is renamed into `profiles/default/auth.json` on `AuthStore` construction, so upgrading does not force a re-login and matches #8's legacy-data migration into `default`.
- `setStatus(providerId, status, profile?)`: cli captures the profile name when login starts, so a mid-login profile switch cannot record the login against the wrong profile.
- Dashboard `activateProfile` calls `loadProviders()` because provider rows read the active profile's auth state.

## Tried and ruled out

- One AuthStore instance per profile injected into providers: rejected; providers are constructed once at startup and would keep reading a stale profile after a switch. A single store following the active profile is less wiring.
- Reading auth.json from disk on every getStatus: rejected; cache + reload on profile change is enough and avoids a file read per provider status call.
- A route-level test of `/webmodel/providers` per profile: skipped. The only providers that read AuthStore are real provider classes (and their files had unrelated uncommitted work); the accepted behavior lives at the store seam, and dashboard JS has no DOM test harness here.

## Watch out

- `AuthStore` migrates the legacy file even when the active profile is not `default`; intentional, since default is where #8 puts legacy browser data.
- `new AuthStore(stateDir)` defaults to the `default` profile. Any code where the profile can switch must pass the callback, or status will silently stay on default.
- `trail check` on this branch reports keyword conflicts from #8's engine/profile work (clause in browser manager/cli), not from ticket 9's auth change; explanation belongs in the commit message.
