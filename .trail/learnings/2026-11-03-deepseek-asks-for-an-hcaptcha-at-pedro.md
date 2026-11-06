---
title: "DeepSeek asks for an hCaptcha at completion when its risk engine says so, and the bridge never answered it"
author: Pedro
date: 2026-11-03
branch: fix/pow-asset-build
cost: { minutes: 19, tokens: 178152 }
id: l-f3192aa5
scope: repo
status: active
src: agent
touches:
  - src/providers/deepseek/challenge.ts
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - src/providers/deepseek/client.ts
  - src/browser/manager.ts
---

## Decided
- On 2026-11-03 the bridge's completion POST came back as HTTP 200 `{"code":40303,"msg":"CHALLENGE_REQUIRED","data":{"provider":"hcaptcha","challenge_id","extras":{"rqdata"}}}` and surfaced to Claude Code as 502 "completion was not a stream". It is intermittent: the same bridge and accounts completed fine minutes later.
- The web client's own protocol, read from chat.deepseek.com's main bundle: render an invisible hCaptcha with sitekey 352e5376-f2cc-43fe-a744-e51640449610 and the challenge's rqdata, then replay the identical completion POST with `x-ds-challenge-response` = base64(JSON {provider,challenge_id,hcaptcha_token}). The provider now does this on 40303.

## Tried and ruled out
- Blaming the engine (the first guess: it fails because Puppeteer/Chromium opens the page): ruled out. Copies of both logged-in profiles on fresh Apostate launches completed normally, including 30 back-to-back calls, thinking mode and a 900K-character prompt, and the live bridge succeeded minutes after failing.

## Watch out
- Patchright, Apostate's driver, runs page.evaluate in an isolated world: window.customElements is null there and globals written by the page's main world are invisible. hCaptcha only initializes in the main world, so the solve script goes in through addScriptTag and publishes its result into a DOM div that page.evaluate polls. Any in-page library needing main-world globals hits the same wall.
- Producing a token is verified live (about 4500 chars in ~10 s in Apostate). Not verified: that DeepSeek accepts it, because no live 40303 could be reproduced on demand.

In the code: src/providers/deepseek/challenge.ts (hcaptchaChallenge, solveHcaptcha), src/providers/deepseek/index.ts sendCompletion, tests/unit/providers/deepseek-chat.test.ts.
