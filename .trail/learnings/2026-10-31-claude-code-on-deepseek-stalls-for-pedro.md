---
title: "Claude Code on DeepSeek stalls for 2-3 min when the Mac's DNS fails, not from the bridge queue"
author: Pedro
date: 2026-10-31
branch: feat/deepseek-account-pool
cost: { minutes: 6, tokens: 71581 }
id: l-f538754f
scope: repo
status: active
replaces: l-77cd3011
src: agent
touches:
  - src/routes/anthropic-compat.ts
  - src/providers/deepseek/index.ts
---

## Decided
- 2026-10-31, measured with temporary per-stage timing: a stall is an episode. The completion waits 46-61 s with no headers and ends "Failed to fetch". Then every request fails "session create: Failed to fetch" in 3-5 ms on both accounts (separate browsers), Claude Code retries on backoff (1, 2, 4, 9, 20, 40 s), and it clears by itself 77-94 s later.
- Both episodes match macOS airportd "DNSFailureSymptom detected on en0" (SlowWiFiDnsFailure): 07:15-07:17 and 07:28-07:32 local. Both browsers failing in the same second points to a cause outside the browsers.
- Normal tool-call replies: p50 7 s, p90 33 s. Slow ones are DeepSeek holding headers 20-39 s on ~800k-char prompts.

## Tried and ruled out
- "No reply for 2-5 min" gaps in bridge.log: these were the user typing answers. Text-only replies write no [tools] line, so they looked like unclosed calls. Check the session transcript timeline before calling a gap a stall.
- Prompt size, rate limits and queue waits as the cause of the stalls.
- Switching to 1.1.1.1: unreachable from this network (dig @1.1.1.1 times out); the network forces its own resolvers.

## Watch out
- Not proven yet: during an episode, check whether shell DNS also fails and whether a TCP connect to the CloudFront IP works (DNS only, or the whole uplink).

In the code:
- Temporary [DEBUG-st41] lines in src/routes/anthropic-compat.ts and src/providers/deepseek/index.ts (uncommitted; remove with grep).
- Episode signature in bridge.log: `attempt ... err=DeepSeek session create failed: Failed to fetch` repeated at Claude Code's backoff times.
- macOS evidence: `log show --predicate 'process == "airportd"'` | grep "DNSFailureSymptom detected".
