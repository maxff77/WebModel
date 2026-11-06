---
title: "Apostate's readback noise is what makes profiles distinct devices, and it ships off"
author: Pedro
date: 2026-11-06
branch: fix/pow-asset-build
cost: { minutes: 8, tokens: 125447 }
id: l-fea5c1ee
scope: repo
status: active
src: agent
touches:
  - src/browser/manager.ts
  - tests/unit/browser/manager.test.ts
  - src/providers/deepseek/index.ts
  - src/profiles/store.ts
---

## Decided
- Apostate's `--fingerprint-noise` is now passed by the engine launcher. Measured 2026-11-06 on an Apple M5 host, headed and headless, seeds 27642 (a-campos42-c157df) and 91303 (ana2336-1d90a5):
  - Without noise, canvas2d (`50c129ee`), WebGL readPixels (`15330c3c`) and audio (`124.0434748024636`) are byte-identical to plain Google Chrome on the same Mac, and identical across every profile, while the declared WebGL renderer string differs per seed (M4 Pro, M1 Pro, M2 Pro).
  - With noise, canvas2d and WebGL readPixels are per seed and stable: same value on a double read in one page, across relaunches, and headed vs headless.
  - Noise does NOT cover audio: it stays the host's value. No switch in the binary covers it.
- Why it matters: a declared GPU that renders byte-identically to the host is a spoofing tell in itself, and the shared canvas/WebGL/audio collapses every profile into one device for any fingerprint SDK. DeepSeek posts an encrypted device profile to fp-it-acc.portal101.cn/deviceprofile/v4 on page load, and its Volcengine applog (gator.volces.com) carries os, resolution, timezone, browser version.
- Kept the per-profile seed: noise is derived from it, so existing profiles change canvas once and then stay stable.

## Tried and ruled out
- `navigator.userAgentData` and `navigator.deviceMemory` missing as a bot signal: false. Both are absent in plain Chrome too under an `about:blank` origin, because they are secure-context only. The probe has to run on an https page to read them.
- Reading the fingerprint with `page.evaluate` only: not enough. Main-world measurement is needed for anything that anti-detect tools patch at the JS level, and Patchright can evaluate in an isolated world. The probe computes in the main world and hands the result back through a DOM attribute, which both worlds share.

## Watch out
- All profiles still share one public IP; the launcher does not pass `proxy` yet. That is the strongest link between accounts and no fingerprint switch removes it.
- The same holds for fonts and for the host hardware behind the noise.
- Enabling noise changes the canvas hash of accounts that already exist. Re-login does not recover a closed session (see the re-login learning), so muted accounts stay muted; the switch protects what comes next.
- Not measured: whether the noise switch affects DeepSeek's hCaptcha pass rate. It passed one live completion on 2026-11-06, but no challenge was issued during it.

In the code: `apostateLaunchOptions` in src/browser/manager.ts, called by `launchApostateContext`. Regression test in tests/unit/browser/manager.test.ts. Probe scripts were scratch, in /tmp/wmb-fp-probe.
