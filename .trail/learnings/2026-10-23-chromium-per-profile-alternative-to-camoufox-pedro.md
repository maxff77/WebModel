---
title: Chromium per-profile alternative to Camoufox for DeepSeek hCaptcha
author: Pedro
date: 2026-10-23
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 92152 }
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
- The first candidate is real Google Chrome with one `--user-data-dir` per account. The bridge spawns it with `--remote-debugging-port` and attaches with `chromium.connectOverCDP`. This adds no dependency and reuses the attach path (src/browser/manager.ts:180). Do not use Playwright `launchPersistentContext` (manager.ts:84): it adds `--enable-automation`.
- Order of fallbacks: (1) fresh real Chrome + CDP, (2) patchright if CDP is the signal, (3) a paid Chromium antidetect browser (Multilogin, GoLogin, AdsPower, Dolphin Anty, Octo, Kameleo), which gives a CDP endpoint from a local API. Option 3 is necessary only if the accounts must not be linkable by fingerprint.
- Ranked hypotheses: H1 hCaptcha rejects the Camoufox engine or fingerprint spoof (then a fresh Chrome with CDP gives pass:true). H2 it rejects any fresh profile (then it fails also with --no-cdp). H3 it detects CDP or Playwright (then it fails with CDP and passes with --no-cdp).

## Tried and ruled out
- No probe result yet. On 2026-10-23, a HITL probe was written and smoke-tested (6 s: Chrome 155 spawned with a fresh user-data-dir, CDP attach OK, clean exit). The user has not yet solved the captcha in it.

## Watch out
- Probe design: spawn Chrome directly (not with Playwright launch) on port 9333 with a mkdtemp profile. Listen to `context.on('response')` for `/checkcaptcha/`, and log only `pass`. Add a `--no-cdp` variant to separate H2 from H3.
- All per-profile Chrome instances on one Mac share the hardware fingerprint and the IP. That is acceptable only if account linking does not matter. The user has not answered this yet.
- Vendor prices and free tiers were not verified.
