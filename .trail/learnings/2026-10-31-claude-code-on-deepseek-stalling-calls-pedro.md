---
title: "Claude Code on DeepSeek stalling: calls of 2-5 min with no reply, measured passively while the cause is open"
author: Pedro
date: 2026-10-31
branch: feat/deepseek-account-pool
cost: { minutes: 9, tokens: 149574 }
id: l-77cd3011
scope: repo
status: active
src: agent
touches:
  - src/routes/anthropic-compat.ts
  - src/providers/deepseek/index.ts
---

## Decided
- 2026-10-31: Pedro's "the repo is slow / gets stuck doing nothing" is a Claude Code session on DeepSeek through the bridge (confirmed by Pedro), not git (git status 23 ms).
- In bridge.log of the run from 2026-10-31 03:48Z: tool-call replies take p50 8 s, p90 34 s, max 112 s; Claude Code's own time between a reply and the next request is p50 0.4 s. The stall is 15 calls with no closing [tools] line, p50 179 s (124-320 s); 03:55-04:19Z had 8 of them in a row, alternating accounts 1a/2a: 24 min with no progress.
- Measure passively: temporary per-stage timing in the route and the DeepSeek provider, plus a script that goes red on any request over 90 s. Pedro approved restarting the bridge for it.

## Tried and ruled out
- Prompt size as the cause: duration does not grow with history (125-150k history: p50 5.5 s).
- Rate limits, queue budget waits, hcaptcha: none in that run; those lines are all from earlier runs.
- An active curl probe loop: spends real DeepSeek messages, and the log already shows hcaptcha challenges and muted accounts from volume.

## Watch out
- bridge.log alone cannot tell a long text/thinking reply from an error plus retry or a hung stream: a reply without tool calls writes no [tools] line, and [pool] is written after the queue wait.
- Nothing times out a call: not the provider queue, not the in-page completion fetch, and the client's abort signal never reaches that fetch. One slow call holds every request behind it.
- The DeepSeek response is read whole inside page.evaluate, so stream timing must be measured in the page and returned.

In the code:
- Instrumentation tagged [DEBUG-st41] (uncommitted, remove with grep): src/routes/anthropic-compat.ts (in / granted / attempt / out / client aborted), src/providers/deepseek/index.ts (page, bearer, session, pow, completion {headers, first, last, maxGap, bytes, chunks}).
- Loop: stalls.mjs <bridge.log> <fromLine> <limitSec>, exit 1 over the limit; kept in the session scratchpad, not the repo.
- The bridge was restarted as `npm run dev -- --no-open >> bridge.log 2>&1`, without WMB_FALLBACK_MODEL, same as the run before it.
