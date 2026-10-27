---
title: CloakBrowser wired in as a third browser engine
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 45636 }
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
- `cloakbrowser` is a third `BrowserEngine`. Its launcher (`launchCloakBrowserContext`, src/browser/manager.ts) calls the wrapper's `launchPersistentContext({ userDataDir, headless, launchOptions: { timeout } })`. It is an optionalDependency (no install scripts, no native deps; the ~140 MB binary downloads to ~/.cloakbrowser on first launch). It is external in tsup.
- `effectiveMode` now returns attach only for `chrome`. Every other engine launches.
- The wrapper writes `<profileDir>/.cloakbrowser-seed` on the first launch. Thus each profile keeps a stable fingerprint without bridge code.
- Verified 2026-10-24: a real headless launch through BrowserManager gives mode=launch, navigator.webdriver=false, and a UA without "HeadlessChrome" (Chrome/145). The seed file is created.

## Tried and ruled out
- No custom code to remove `--no-sandbox`. The wrapper adds it by default. Playwright adds it as well for every Chromium launch unless `chromiumSandbox: true` (playwright-core chromium.js:295). Thus the Chrome launch mode already runs without the sandbox.
- No doctor check for the CloakBrowser binary (skipped). The launcher error tells the user to run `npx cloakbrowser install`.

## Watch out
- The hCaptcha pass:true was measured with a direct spawn of the binary plus connectOverCDP. It was NOT measured through the wrapper's Playwright launchPersistentContext, which the bridge uses. Do the DeepSeek login again through the bridge before you trust this.
- `trail check` flags manager.ts:18-26, package.json:54 and others. These are keyword false positives about camoufox-era decisions.
