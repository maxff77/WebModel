---
title: "Anti-detection in the web-model bridge: real Chrome attach vs Camoufox"
author: Pedro
date: 2026-10-20
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 49104 }
touches:
  - src/browser/manager.ts
  - src/providers/deepseek/index.ts
---

## Decided
- First anti-detection lever is not Camoufox. Attach mode already drives the user's real Chrome over CDP (src/browser/manager.ts:52), so the fingerprint is genuine. Camoufox gives a spoofed Firefox fingerprint but needs a new profile and login, and does not address IP, account trust, rate limits, or API-layer headers.
- Keep attach mode + headful for DeepSeek. Launch mode is headless (manager.ts:82) and Playwright passes --enable-automation by default (playwright-core/lib/server/chromium/chromiumSwitches.js:92), so navigator.webdriver is true; that mode is a detection magnet.
- Next probe before any anti-detect browser: capture a real POST /api/v0/chat/completion (headers included) from the live Chrome and diff it against the bridge request (src/providers/deepseek/index.ts:206-213, which sends only Content-Type, Authorization, x-ds-pow-response).

## Tried and ruled out
- "Switch to Camoufox to fix detection": ruled out as first move. A JS client exists (camoufox-js, Apify), but it changes the engine to Firefox and cannot reuse the existing Chrome cookies/login.
- Assuming the missing web-app headers are the cause: unverified. The user has not provided the exact blocking symptom yet.

## Watch out
- Without the exact symptom (status/body/endpoint: 403 or Cloudflare challenge, logout, captcha, 429, account ban) there is no red-capable loop. Do not propose stealth fixes from speculation.
- Camoufox is still Playwright + Firefox; anti-bot signatures for both exist. It improves fingerprint consistency, it is not invisibility.
