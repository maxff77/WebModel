---
title: "DeepSeek accounts in turn reverted: accounts still blocked"
author: Pedro
date: 2026-10-27
branch: feat/deepseek-account-pool
cost: { minutes: 18, tokens: 220467 }
touches:
  - src/auth/store.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/core/pool.ts
  - src/core/stream.ts
  - src/providers/deepseek/index.ts
  - tests/unit/auth/store.test.ts
  - tests/unit/config/loader.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/routes/anthropic-pool.test.ts
---

## Decided
- Reverted the ProviderPool (#13, c803bf9). DeepSeek takes calls on one account again, the active profile. `deepseek.profiles` is gone from config.
- Kept 4d4edac: a muted account (biz_code 5) still answers 403 with no retry. It never depended on the pool.

## Tried and ruled out
- Two of the user's own DeepSeek accounts (cuenta_nueva1, cuenta_nueva2, cloakbrowser) in strict turn from this Mac, one call in flight, global pacing kept (10/min, 6 s gap, 60 per 30 min). bridge.log on 2026-10-26 shows the alternation worked and no refusal was logged by the pool. The user reports DeepSeek blocked the accounts anyway. Spreading the volume over accounts does not avoid the sanctions.

## Watch out
- Inferred, not verified: DeepSeek likely links the accounts by IP or machine, so per-account volume is not what it limits. Do not retry the pool without a different IP per account, and get the user's consent before trying that.
- The two pool learnings (2026-10-24 multi-account, 2026-10-26 ProviderPool spec) describe code that no longer exists.
