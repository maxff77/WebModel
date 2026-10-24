---
title: "DeepSeek 'could not extract bearer token' = the web session is logged out"
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 14, tokens: 67848 }
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
- "could not extract bearer token" means the DeepSeek frontend is logged out: after the reload the page sits on `https://chat.deepseek.com/sign_in`, every `/api/v0/` request (telemetry, client/settings) goes without `Authorization`, and localStorage `userToken` is `{"value": null, "__version": …}`. The remedy is a re-login on the profile (dashboard → DeepSeek → Login, then close the window).
- The bridge never clears `userToken`; `/webmodel/auth/logout` only clears the AuthStore status. The null comes from DeepSeek's frontend, which writes it when it drops the session.

## Tried and ruled out
- Lost state from killing the browser with SIGKILL: ruled out as the direct cause. A rolled-back localStorage would keep the old token or have no key, not `value: null`. Two clean SIGINT restarts reproduced the same state.
- Why DeepSeek dropped the session (2026-10-24, between the last good call ~18:01Z and the first page load after restart ~18:23Z): not found. It came ~10 min after a "too frequent" lockout.

## Watch out
- `/webmodel/health` still reports deepseek-web `authenticated: true` while the page is on /sign_in: the AuthStore status only reflects the last login, not the live session.
- The route answers 502 `api_error`, so Claude Code calls it "temporary" and retries 10 times, and each retry reloads the sign-in page twice (10 s timeout each).
- A replay curl to `/v1/messages` is safe for this bug: it fails before the completion POST, so no DeepSeek message is spent.
