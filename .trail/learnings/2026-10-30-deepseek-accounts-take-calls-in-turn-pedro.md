---
title: "DeepSeek accounts take calls in turn again, chosen from the dashboard"
author: Pedro
date: 2026-10-30
branch: feat/deepseek-account-pool
cost: { minutes: 1, tokens: 0 }
id: l-ad495f2e
scope: repo
status: active
replaces: l-e4b8ba
src: agent
touches:
  - src/cli.ts
  - src/routes/management.ts
  - src/config/loader.ts
  - src/dashboard/app.js
---

## Decided
- 2026-10-29, at Pedro's request: the account turn (`ProviderPool`) is back. Pedro's argument: one account gets blocked anyway, so using several costs nothing.
- The 2026-10-26 evidence behind the revert was weaker than the revert said. bridge.log (13:55–17:38Z) shows 132 calls alternating between the two accounts, with zero "too frequent" and zero mute logged. The block was reported by Pedro afterwards and never appears in the log.
- The turn is now picked from the dashboard: a "DeepSeek turn" checkbox on each profile row. The change applies at once, with no restart, and is saved to `deepseek.profiles` in config.yml. With no profile ticked, DeepSeek uses the active profile only.
- A "too frequent" or muted answer moves the call to the next account at once, and each account has its own cooldown. Claude Code gets the 429 only when every account is cooling.

## Tried and ruled out
- A proxy or a distinct fingerprint per account, so DeepSeek cannot link the accounts: declined as evading DeepSeek's anti-abuse controls. All accounts share this Mac's IP and fingerprint (see the CloakBrowser fingerprint learning).

## Watch out
- Accepted risk: DeepSeek may sanction every account in the turn together.
- A chrome profile in attach mode (`default`) needs Chrome listening on CDP 9222. Without it, that account's calls fail. On 2026-10-29 only `test1` had a live DeepSeek session; `1`, `3` and `n2` were expired.
- Changing the turn builds a new pool, so its in-memory mute and cooldown state starts over. A browser that leaves the turn closes on `idleShutdown`, not at once.
- The failover on a real "too frequent" has not been seen live yet. tests/unit/routes/anthropic-pool.test.ts covers it.

In the code: `setDeepSeekPool` in src/cli.ts (step 4a); `POST /webmodel/profiles/deepseek-pool` in src/routes/management.ts; `writeDeepSeekProfiles` and `editConfig` in src/config/loader.ts; `setDeepSeekPool` in src/dashboard/app.js.
