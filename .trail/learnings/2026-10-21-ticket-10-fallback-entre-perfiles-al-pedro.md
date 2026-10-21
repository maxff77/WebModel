---
title: "Ticket 10: fallback entre perfiles al arrancar"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 33399 }
touches:
  - docs/camoufox-engine-spec.md
  - src/auth/store.ts
  - src/browser/manager.ts
  - src/cli.ts
  - src/core/queue.ts
  - src/profiles/store.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
---

## Decided
- Ticket maxff77/WebModel#10 adds optional `fallbackProfile` to `profiles/<name>/manifest.json`. `ProfileStore.resolve` rejects a self-fallback (code `invalid`) and a fallback that does not exist (code `not_found`, message includes the `profile create` command). Users declare it by editing the manifest; there is no CLI command.
- Failover lives in `BrowserManager.ensureBrowser`, launch mode only: a failed launch resolves the fallback through the injected `resolveProfile` callback, checks the new `AuthStore.hasSession(profile)` (any provider `active` on that profile), then swaps `_profile`, recomputes `_mode` and relaunches exactly once. The switch persists for later requests; config.yml keeps the original active profile, so this is failover, not activation.
- `ActiveProfile` now includes `fallbackProfile`. cli wires `resolveProfile: (n) => profiles.resolve(n)` and `hasSession: (n) => authStore.hasSession(n)`.

## Tried and ruled out
- Per-provider session check on the fallback: the browser seam (`browserFetch`) carries no provider id, so checking the requested provider's login on the fallback would mean threading it through 11 providers. Any-active-session was enough for the ticket.
- Attach-mode fallback: a CDP connect failure is profile-independent, and retrying with another profile in attach mode would hit the same endpoint. The ticket's tests use launcher doubles (launch mode).
- Persisting the fallback as the active profile: not asked. The dashboard reports `browserManager.getProfile().name`, which already shows the fallback while the process runs.

## Watch out
- `AuthStore.hasSession` reads that profile's auth.json from disk (only on a launch failure) and counts only `active`, not `expired`.
- The no-session fallback error is a `BrowserUnavailableError` (503 mapping) naming both profiles; streaming routes surface only its message as a stream error event.
- `trail check` reports 20 keyword false positives from the pre-existing engine/profile work in the working tree, not from this change (same situation as the ticket 9 learning); explain in the commit message.
