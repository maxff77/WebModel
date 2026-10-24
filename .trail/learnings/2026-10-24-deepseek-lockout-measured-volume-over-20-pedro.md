---
title: "DeepSeek lockout measured: volume over ~20-30 min, ~10 min ban, cooldown now per provider"
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 6, tokens: 55164 }
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
  - src/routes/anthropic-compat.ts
---

## Decided
- The "too frequent" cooldown in src/routes/anthropic-compat.ts is now per provider and carries over across requests (`cooldowns` map, doubling from 5 s, capped at `capMs` 10 min, reset by any non-rate-limit outcome). A request waits inside its 180 s budget and answers 429 without probing when the cooldown runs longer. Before, Claude Code re-sent each 429 at once and every request restarted at 5 s: 20 probes during one ~10 min lockout.
- 2026-10-24 lockout (lohari session, pacing 10/min + 6 s gap): first refusal 17:49:22Z after 154 calls in 35 min (122 main + 32 subagent), per-minute peak 11; last refusal 17:59:05Z, the probe at ~18:00:25Z went through. Lockout ~10-11 min.

## Tried and ruled out
- Lowering the per-minute cap 10 -> 8: only 3 of 32 minutes went above 8 (4 calls); it would not have prevented this refusal.
- A 60-min rolling quota: 154 calls in the last 60 min both at the refusal and at the unlock, so it does not explain the unlock. A 45-min window barely differs (154 vs 148). Fits: a 30-min window with a threshold between 80 and 139, a 20-min window between 44 and 81, or a fixed ~10 min penalty. One event; not pinned down.

## Watch out
- Subagent calls ask for `claude-sonnet-5-5`, so transcripts don't tag them `deepseek`; count them from `[registry] … using fallback` lines in bridge.log and merge with main-session calls.
- Transcript timestamps mark when a reply was recorded, not when the call started; per-minute counts can read one above the start cap.
- The earlier ~1 h lockout (~2026-10-22) was 6x longer than this one; unknown whether repeated lockouts escalate.
