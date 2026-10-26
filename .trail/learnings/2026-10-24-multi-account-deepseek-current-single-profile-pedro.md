---
title: "Multi-account DeepSeek: current single-profile limits and the bearer-cache bug on profile switch"
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 2, tokens: 73374 }
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
- Nothing built yet. Idea under discussion (2026-10-24): spread DeepSeek calls over several of the user's own accounts (one profile each) to lower per-account volume. Proposed first step: zero-code experiment to confirm DeepSeek limits per account, not per IP/device.
- Facts that shape the design: one process = one BrowserManager = one active profile (src/cli.ts:267). ProviderQueue and the "too frequent" cooldown key by providerId, not by profile/account (src/core/queue.ts, src/routes/anthropic-compat.ts). Each DeepSeek call creates a fresh chat_session with parent_message_id null, so per-call routing across accounts needs no stickiness.
- Profiles with deepseek-web "active" in auth.json on 2026-10-24: cloak, clock1 (cloakbrowser), cuenta2 (camoufox), default (chrome). Candidate pool: cloak + clock1.

## Tried and ruled out
- Testing a second account by switching the active profile in the dashboard: invalid, see bearer bug below. Restart the bridge with --profile, or run two bridges with --port/--profile side by side.

## Watch out
- DeepSeekProvider caches bearerToken and clientHeaders on the instance (src/providers/deepseek/index.ts:60-61); BrowserManager.activate() (src/browser/manager.ts:575) does not clear them. After a profile switch the old account's bearer is still sent. Only a 401/403/40003 clears it.
- auth.json "active" does not prove a live session.
- Unverified: whether two bridge processes can share ~/.webmodel safely, and whether DeepSeek links accounts from the same IP.
