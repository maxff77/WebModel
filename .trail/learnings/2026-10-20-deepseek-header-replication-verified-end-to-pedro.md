---
title: DeepSeek header replication verified end-to-end after bridge restart
author: Pedro
date: 2026-10-20
branch: fix/claude-code-agent-tools
cost: { minutes: 11, tokens: 70487 }
touches:
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/providers/deepseek-client.test.ts
---

## Decided
- After rebuilding and restarting the bridge, a deepseek-web/deepseek-v4 completion returned HTTP 200 with content "Hi".
- CDP capture on the live Chrome showed /api/v0/chat_session/create, /api/v0/chat/create_pow_challenge and /api/v0/chat/completion all carrying the web client identity headers: x-client-platform: web, x-client-version: 2.5.0, x-client-locale: en_US, x-client-timezone-offset: -21600, x-client-bundle-id: com.deepseek.chat, x-device-id (same UUID as the web client), x-device-model: "", plus Authorization and x-ds-pow-response.
- The provider captures these headers from the real client's first /api/v0 request during bearer extraction and caches them; fallback is localStorage.get('deepseek-device-id:chat') plus constants.

## Tried and ruled out
- Launch mode/headless: not needed; attach mode to the real Chrome worked.
- Account suspension blocking the bridge: at test time the API answered 200, so the notice did not block this request (UI state may differ).

## Watch out
- Qwen now fails with "Qwen chat create failed: no chat id" after the restart. Separate provider drift, not caused by the DeepSeek header change.
- The bridge has no watch; it was restarted manually (new listener on 127.0.0.1:3456, started with --no-open).
- Rate risk is still unknown: one 200 does not prove 163 completions/hour is safe. Keep volume low.
