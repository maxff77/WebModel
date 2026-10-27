---
title: CloakBrowser engine works end to end through the bridge
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 1, tokens: 9156 }
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
- Verified 2026-10-24: a `cloak` profile (engine cloakbrowser) logged in to DeepSeek through the bridge login flow, which uses the wrapper's Playwright launchPersistentContext in headed mode. Then the headless launch served both API routes: `/v1/chat/completions` (deepseek-web/deepseek-v4, about 3.7 s) and streaming `/v1/messages`, which ended with `end_turn`. The open question in "CloakBrowser wired in as a third browser engine" is closed: the integrated launch path works, not only a direct spawn.

## Tried and ruled out
- Not observed: whether the hCaptcha showed during this login. The login only reached `success`, which means the page left /sign_in.

## Watch out
- In launch mode, the login is complete only when the user closes the login window. Until then, `/webmodel/auth/login-status` stays `waiting_for_user` and health shows the provider as not authenticated.
- `--profile cloak` applies only to that run. ~/.webmodel/config.yml still has `browser.profile: prueba_3`.
