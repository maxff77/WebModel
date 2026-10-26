---
title: DeepSeek account mute (biz_code 5) after lockouts; multi-account experiment blocked
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 32585 }
touches:
  - package-lock.json
  - package.json
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/dashboard/app.js
  - src/dashboard/index.html
  - src/doctor.ts
  - src/profiles/store.ts
  - src/routes/management.ts
---

## Decided
- 2026-10-24 20:02Z: profile `cloak` answers {"biz_code":5,"biz_msg":"user is muted","biz_data":{"is_muted":1,"mute_until":1793126295.46}} = muted until 2026-10-27 18:38Z (~3 days). If the mute is 72 h, it began ~2026-10-24 18:38Z, ~40 min after the 17:49-17:59Z "too frequent" lockout (assumed, not verified). DeepSeek sanctions seen so far: "too frequent" ~10 min, one ~1 h lockout, now a multi-day mute. Treat it as escalating.
- Multi-account experiment (burst one account until "too frequent", then call another) was not run: no second live account. The burst step is now judged too risky: it can earn a multi-day mute.
- Lower-risk test: while `cloak` is muted, send 1 call from another logged-in account. If it answers, the sanction is per account, not per IP.

## Tried and ruled out
- Two bridges on the same profile: the second Chromium prints "Abriendo en una sesión existente del navegador" (user-data-dir already in use) and launchPersistentContext fails with "Target page, context or browser has been closed". One profile = one bridge.
- Trusting `--profile` on a running bridge: the dashboard switch changes the live profile; check `/webmodel/health` `browser.profile`. The 3456 bridge started with `--profile cloak` was on `clock1`.

## Watch out
- The provider does not recognize biz_code 5; it surfaces as "completion was not a stream: ..." (src/providers/deepseek/index.ts envelope parsing, ~L36-47). The route may treat it as a generic error.
- On 2026-10-24 `clock1` was logged out (page on /sign_in) while its auth.json said active.
