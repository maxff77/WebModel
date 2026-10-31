---
title: Apostate passes DeepSeek hCaptcha and finishes the login; its fingerprint mixes host values into some personas
author: Pedro
date: 2026-10-29
branch: feat/deepseek-account-pool
cost: { minutes: 8, tokens: 73249 }
id: l-6b8fea08
scope: repo
status: active
src: agent
---

## Decided
- On 2026-10-29, Apostate (npm `@heretic-tech/apostate@0.5.1`, GPL-3.0, Chromium 155.0.8059.31 macos-arm64) passed DeepSeek's MFA hCaptcha on the first attempt (`checkcaptcha` pass:true), and the login finished into a chat. Same probe as CloakBrowser: `launchProcess` with a fresh mkdtemp profile, `--remote-debugging-port=9333`, then Playwright `connectOverCDP`. Seed 23835, `fingerprintPlatform: 'macos'`, headed, same IP and account. n=1.
- Fingerprint measured with seeds 23835, 71044, 55555 (and 23835 again), headed, on https://example.com:
  - These vary per seed and are deterministic: the WebGL unmasked renderer (M4 Max, M4 Pro, M2), hardwareConcurrency (10, 10, 8) and screen (1512x982, 1512x982, 1470x956).
  - These are identical across seeds with the default (no noise): canvas `toDataURL`, canvas `getImageData`, `measureText`, WebGL readPixels and the OfflineAudioContext + DynamicsCompressor sum.
  - With `--fingerprint-noise`, canvas `toDataURL` and `getImageData` vary per seed and stay deterministic. `measureText`, audio and readPixels still do not vary.
  - navigator.webdriver is false. The UA is Chrome/155 "Intel Mac OS X 10_15_7".

## Tried and ruled out
- Canvas noise as a fix for identical canvases: with `--fingerprint-noise`, drawing the `toDataURL` image to a second canvas and reading `getImageData` back does not match the original `getImageData`. Without noise it matches. A page can detect the noise this way. Noise is off by default on purpose; the wrapper's comment says the switch turns on if present, whatever its value.

## Watch out
- Seeds 23835 and 71044 report 10 cores and deviceMemory 16. These are this Mac's real values (Apple M5, 10 cores, 16 GB). Combined with an "M4 Max" or "M4 Pro" GPU, they describe a Mac that does not exist (a real M4 Pro has 12/14 cores, a real M4 Max 14/16). It is an inference, not checked in the code, that Apostate passes host values through. Pin `--fingerprint-hardware-concurrency` or pick a coherent seed (55555 gives an M2 with 8 cores).
- deviceMemory is `undefined` on about:blank because it exists only in a secure context. Measure on an https page.
- Not tested: repeatability (n=1), the bridge's launch path (Patchright `launchPersistentContext`), FingerprintJS visitorId across seeds, fonts, WebRTC.
- The binary installs to ~/Library/Caches/apostate/<chromium>/<target>/. The wrapper depends on patchright. `npx apostate install` downloads it and checks a SHA-256 that is pinned in the package.

In the code: nothing in the repo yet. The probes were throwaway scripts (fp.mjs, hcaptcha.mjs) in the session scratchpad.
