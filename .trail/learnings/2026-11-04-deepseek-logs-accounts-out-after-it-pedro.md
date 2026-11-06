---
title: DeepSeek logs accounts out after it demands an hCaptcha the bridge cannot pass
author: Pedro
date: 2026-11-04
branch: fix/pow-asset-build
cost: { minutes: 5, tokens: 128421 }
id: l-3969030b
scope: repo
status: active
src: agent
touches:
  - src/core/queue.ts
  - src/core/pool.ts
  - src/providers/deepseek/index.ts
  - src/browser/manager.ts
---

## Decided
- Diagnosis 2026-11-04: the accounts are not muted, they are logged out. 59 of 63 pool refusals since Nov 3 are auth_expired (page on /sign_in); only 4 are upstream_rate_limit.
- Chain: DeepSeek answers a completion with 40303 CHALLENGE_REQUIRED; the bridge answers with its hCaptcha token, DeepSeek rejects it with 40304 CHALLENGE_FAILED (or the solve times out at 90 s); minutes later the session sits on /sign_in.
- Trigger visible in the logs: bursts to several accounts from one IP. With pacing (6 s gap, 10/min, 60/30 min) the 2026-10-26 log shows 1 account at a time and at most 2 calls/10 s, and those accounts lived >25 h. After pacing was removed (2026-10-29) the 2026-10-30 log reaches 12 calls/10 s and 6 accounts inside the same 2 s, and six sessions closed together in the next minute.
- Lifetime now: profiles created Nov 4 16:53-17:16 were logged out at 17:33-17:37 after 33-40 min and 45-62 calls. Paced era: >25 h and ~150 calls.

## Tried and ruled out
- Profiles sharing one account: the DeepSeek ds_session_id hashes differ per profile.
- Average request volume: median 5 calls/min in both eras. What changed is bursts and simultaneous accounts, not the mean.
- Rate-limit cooldown as the death path: only 4 of 63 refusals are upstream_rate_limit; the sanction arrives as a session close.

## Watch out
- The hCaptcha answer is not accepted: on Nov 4 the log has 26 challenges, 13x 40304 and 8 timeouts. Answering is not recovery until a challenge passes.
- On Oct 30 the kill landed during a 40-min idle gap after a burst, so it is a delayed batch sanction, not an immediate rate limit.
- Not proven: a global DeepSeek tightening, or the Apostate GeoIP/timezone mismatch, could contribute. Bursts are the lever the bridge owns.
- Cheapest experiment: restore the old pacing constants from commit 9be4e9f and measure account lifetime; next, a pool-wide backoff when any account gets 40303.

In the code: src/core/queue.ts (pacing removed in 67314ae), src/core/pool.ts, src/providers/deepseek/index.ts, src/providers/deepseek/challenge.ts; logs /private/tmp/webmodel-bridge.log and ~/.webmodel/refusals.jsonl.
