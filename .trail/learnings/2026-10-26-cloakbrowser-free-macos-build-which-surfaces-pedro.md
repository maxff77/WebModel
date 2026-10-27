---
title: "CloakBrowser free macOS build: which surfaces the seed actually varies"
author: Pedro
date: 2026-10-26
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 13674 }
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
  - src/providers/deepseek/index.ts
---

## Decided
- Measured 2026-10-26 on the free CloakBrowser 145 for macOS, headed, with seeds 23835, 71044 and 55555, using raw APIs:
  - These VARY per seed and are deterministic: canvas `getImageData` pixels, `measureText` widths (sub-pixel), and the WebGL unmasked renderer (M2 or M2 Pro).
  - These are IDENTICAL across seeds: canvas `toDataURL`, WebGL readPixels of a cleared buffer, and the OfflineAudioContext + DynamicsCompressor sum.
  - The same seed gives the same values across calls and relaunches.
- FingerprintJS hashes `toDataURL`, so it sees the same canvas for every seed. The "the seed does not change the canvas" result is thus specific to `toDataURL`.
- The README says hardwareConcurrency=8, deviceMemory=8 and screen 1440x900 are the "auto-generated" macOS values for every seed. They are crowd-blending defaults, not per-seed values, unlike Camoufox's per-launch BrowserForge profile.

## Tried and ruled out
- `--fingerprint-noise`: this flag does not exist in the free 145 binary (`strings` finds no match). The README lists it for newer builds.

## Watch out
- `toDataURL` and `getImageData` disagree for the same canvas. A page that compares them can detect the tampering. This is an inference that was not tested against a real detector.
- The README does not say if the free build has the full canvas/audio noise. The Pro build (Chromium 155, 87 patches) is untested. Its "free with a GitHub key" tier allows only 1 concurrent session.
