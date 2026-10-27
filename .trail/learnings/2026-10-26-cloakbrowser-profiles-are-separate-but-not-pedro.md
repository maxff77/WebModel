---
title: CloakBrowser profiles are separate but not distinct devices
author: Pedro
date: 2026-10-26
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 20253 }
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
- Measured 2026-10-26 with FingerprintJS OSS v4 on seed-only copies of cuenta_nueva1 (seed 23835) and cuenta_nueva2 (seed 71044), with the free CloakBrowser 145 binary, headed, on an Apple M5 host. Results:
  - The visitorIds differ, and each is stable across relaunch.
  - Only webGlBasics and the GPU renderer differ: "Apple M2" and "Apple M2 Pro". The real GPU is M5.
  - These are IDENTICAL in both accounts: canvas, audio, fonts, fontPreferences, math, screen (1440x900, spoofed; the real logical screen is 1440x932), hardwareConcurrency (8, spoofed; the real value is 10), deviceMemory, timezone, language, UA and client hints, and the public IP.
- Conclusion: storage and cookies are separate per profile. But a fingerprinting system that uses IP, canvas, audio or fonts would link the two accounts as one machine.

## Tried and ruled out
- That the seed varies canvas and audio on the free macOS build: false. FingerprintJS canvas and audio are byte-identical across the seeds.

## Watch out
- Seed 71044 reports an "M2 Pro" with 8 cores. A real M2 Pro has 10 or 12 cores, so this is a possible inconsistency signal.
- The free binary accepts these flags: --fingerprint-hardware-concurrency, -device-memory, -gpu-renderer/-gpu-vendor, -screen-width/-height, -timezone, -location, -platform-version, -brand, -fonts-dir (found with `strings` on the framework). It has no canvas or audio flag.
- The biggest link is the shared IP. The wrapper supports `proxy` and `geoip`, but the bridge does not pass them yet.
- The probe script (scratchpad fp-compare.mts) never opens the real profile directories. It copies only `.cloakbrowser-seed`.
