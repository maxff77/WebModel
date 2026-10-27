---
title: "DeepSeek login captcha loop in Camoufox: hCaptcha rejects server-side"
author: Pedro
date: 2026-10-23
branch: fix/claude-code-agent-tools
cost: { minutes: 18, tokens: 354189 }
touches:
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/dashboard/app.js
  - src/profiles/store.ts
  - src/routes/management.ts
  - tests/unit/browser/manager.test.ts
  - tests/unit/config/loader.test.ts
  - tests/unit/profiles/store.test.ts
  - tests/unit/routes/management.test.ts
---

## Decided
- DeepSeek login for an MFA account returns `biz_code 14 MFA_VERIFICATION_CODE_REQUIRED` from `/api/v0/users/login`, then shows hCaptcha (site key 352e5376-...). The "Please try again" loop is hCaptcha's server answering `checkcaptcha` with `{"pass":false}` to every attempt (4/4, human-solved, measured on 2026-10-23).
- Reproduced on a brand-new Camoufox profile with the bridge's exact launch options (`os: 'macos'`, `exclude_addons: ['UBO']`), same IP where the user's own Chrome passes. So it is not profile cookies, not a lost token, not a blocked request: hCaptcha scores the Camoufox session as a bot. No fix on our side; use Chrome (attach, the user's real browser) for DeepSeek.
- `navigator.webdriver` is false and no `__playwright*` globals leak in Camoufox 152.0.4-beta.30, so those known Camoufox detection vectors are not the cause.

## Tried and ruled out
- Excluding uBlock Origin: real anomaly (uBO aborts DeepSeek's device-fingerprint calls to gator.volces.com and fp-it-acc.portal101.cn; without it they return 200), but hCaptcha still answers pass:false. Kept the exclusion anyway.
- The `.diag-hcaptcha.mjs` style probes against accounts.hcaptcha.com/demo and fake-credential logins never trigger the captcha; it only appears after real credentials hit the MFA step.

## Watch out
- AWS WAF (`gokuProps`, token.awswaf.com) and Cloudflare Turnstile also load on sign_in; neither is the visible captcha. AWS WAF's silent challenge (`mp_verify`) passes in Camoufox.
- Not tested: whether a Playwright-launched Chrome profile (launch mode, needed for non-default profiles) passes this hCaptcha; only the user's own Chrome is known to pass.
- To re-measure, a HITL loop logging `checkcaptcha` responses works: the user solves, the script records `pass`. Never log the login request body (password) or the `E1_...` challenge key in the URL.
