---
title: DeepSeek web client identity headers captured and replicated
author: Pedro
date: 2026-10-20
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 45589 }
touches:
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/providers/deepseek-client.test.ts
---

## Decided
- DeepSeek's web client sends identity headers the bridge was omitting: x-client-platform: web, x-client-version: 2.5.0, x-client-locale: en_US, x-client-timezone-offset (seconds), x-client-bundle-id: com.deepseek.chat, x-device-id, x-device-model: "". Captured from a live Chrome session on 2026-10-20.
- The device id lives in localStorage under "deepseek-device-id:chat"; the bridge now reads it from the page instead of inventing one.
- Implemented in src/providers/deepseek/client.ts (deepseekClientHeaders) and merged into session create, pow challenge, and completion in src/providers/deepseek/index.ts.

## Tried and ruled out
- Hardcoding a fresh x-device-id: rejected, reuse the web client's own id.
- Reading x-client-version from the JS bundle: the resource grep found nothing; constants are the lazy path.

## Watch out
- Headers were captured on GET /api/v0 calls; completion is inferred to use the same request wrapper. Verify on a real completion after the suspension lifts.
- Account was suspended ~24h on 2026-10-20 after 434 completions in 2 days, peak 163 in one hour. Headers are necessary but probably not sufficient; volume/session creation is the stronger signal.
- The bridge has no watch; restart it before testing. Update x-client-version when the web client ships a new one.
