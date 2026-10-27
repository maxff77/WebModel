---
title: CloakBrowser passes DeepSeek hCaptcha where Camoufox fails
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 14164 }
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
- On 2026-10-24, the free CloakBrowser binary (Chromium 145.0.7632.109, npm `cloakbrowser@0.6.4`, flags `--fingerprint=48213 --fingerprint-platform=macos`) got hCaptcha `checkcaptcha` `pass:true` on the first attempt. It was a fresh profile, Playwright `connectOverCDP` was attached, on the same IP and account where Camoufox got 0/4.
- This rules out "any fresh profile fails" and "CDP attach is detected" as the cause. The Camoufox failure is specific to Camoufox (Firefox engine or its spoof).

## Tried and ruled out
- Not yet tested: whether the login finishes after the captcha (the probe kills the browser on the first pass), repeatability (n=1), and the bridge's headless launch mode.

## Watch out
- The wrapper defaults are `--no-sandbox --fingerprint=<random 10000-99999> --fingerprint-platform=macos` (dist/config.js getDefaultStealthArgs). The test omitted `--no-sandbox`.
- The wrapper's persistent context saves a seed per profile in `<userDataDir>/.cloakbrowser-seed`. Use this for one fingerprint per account.
- The binary installs to ~/.cloakbrowser/ and not to node_modules. The free tier's concurrency limits were not verified.
