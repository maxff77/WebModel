---
title: DeepSeek chat_session/create moved the id into chat_session
author: Pedro
date: 2026-10-20
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 229384 }
touches:
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
---

## Decided
- 502 "DeepSeek session create failed: no session id" was a response-shape change, not auth: create now returns {code:0, data:{biz_code:0, biz_data:{chat_session:{id}, ttl_seconds}}}.
- DeepSeek answers HTTP 200 on failure too: {code:40003, msg:"INVALID_TOKEN", data:null}. Provider now parses both via sessionCreateResult and surfaces the envelope error instead of "no session id".
- Live probe: Playwright connectOverCDP to the bridge's Chrome (:9222), evaluate the same fetch in the chat.deepseek.com page. Auth token is localStorage userToken (64 chars, Bearer).

## Tried and ruled out
- Cookie-only fetch: rejected, 40003 INVALID_TOKEN (cookies no longer authenticate the API).
- settingsJwt as bearer: rejected, 40003. userToken is the right one.
- Auth store saying deepseek-web authenticated: just stale state, says nothing about the token.

## Watch out
- create_pow_challenge has the same HTTP 200 envelope; if it fails the provider still says "no challenge" without code/msg.
- Bridge has no watch: restart after provider edits (npm run dev). Loop: curl POST /v1/messages {model:"deepseek-v4"}.
