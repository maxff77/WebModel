---
title: Chromium antidetect browsers that run on macOS arm64 (survey)
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 102637 }
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
- Surveyed on 2026-10-24. These are the Chromium antidetect browsers (engine-level spoof like Camoufox) that run on this Mac (arm64, macOS 26):
  - CloakBrowser: npm `cloakbrowser`, MIT wrapper. The free binary needs no key and is Chromium 145 for macOS. Chromium 155 needs a GitHub-key free tier (1 session) or Pro. Use `--fingerprint=<seed>` per profile. `--remote-debugging-port` works, so connectOverCDP fits the attach path.
  - fingerprint-chromium (adryfish): it is ungoogled-chromium with `--fingerprint=<seed>`. The official macOS DMG goes up to 148. An arm64 fork exists (pocchian, Chromium 152, ad-hoc signed).
  - Donut Browser: a Homebrew cask with the Wayfern Chromium fork, a REST API and an MCP server. It is a profile-manager app.
- The HITL probe in the scratchpad (hcaptcha-chrome-probe.mjs) accepts the env vars CHROME_BIN and CHROME_ARGS. Thus one loop compares real Chrome with each antidetect binary.

## Tried and ruled out
- camoucrome (lang315): no macOS build, Windows/Linux only, 0 stars.
- clearcote-browser: no tagged release, and the latest build has private patches.

## Watch out
- All "undetected" claims come from the projects themselves. awesomeantidetect.com tested none of them. CloakBrowser's star count is flagged as likely inflated.
- An old free binary (Chromium 145, while stable is 155) can be a detection signal by itself.
- The binaries are ad-hoc signed and Gatekeeper blocks them (`xattr -cr` is necessary). Get the user's consent before you download or run them.
- Camoufox failed hCaptcha because it spoofs the fingerprint. A spoofed Chromium can fail for the same reason. Test the genuine fresh-Chrome profile first, because it costs nothing.
