---
title: DeepSeek pacing already exists; real post-pacing rates and the OpenAI-route gap
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 85396 }
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
- Proactive pacing already exists: `requestPacing` in src/core/queue.ts (1 s min gap, 20 starts/min per provider, env `WMB_MIN_GAP_MS` / `WMB_MAX_RPM`), one queue shared by the OpenAI and Anthropic routes (src/server.ts). The reactive "too frequent" cooldown (5→80 s, ~155 s total, then 429) lives only in the Anthropic route.
- Real traffic after pacing landed (2026-10-21 16:41 CST onward, from Claude Code transcripts): 361 DeepSeek calls over 51 active minutes, typical 6-7/min, the 20/min cap hit once, 0 429s reached Claude Code.
- To lower ban risk without code: restart the bridge with e.g. `WMB_MAX_RPM=8 WMB_MIN_GAP_MS=4000`. 8 is a conservative guess, not a measured threshold.

## Tried and ruled out
- Finding a logged "Messages too frequent" after pacing: none in the current bridge log, none in scratchpad logs, none in transcripts. Earlier bridge stdout went to a terminal and is lost.
- Reproducing the limit on purpose: skipped, it risks the DeepSeek account (the very thing the user wants to avoid).

## Watch out
- The OpenAI route (`/v1/chat/completions`) has no rate-limit cooldown: a "too frequent" comes back as an immediate 502 `provider_error` and prints nothing on stdout. Add the same cooldown/429/log as the Anthropic route if a client uses it.
- Measuring rates from transcripts: dedupe by `message.id` of assistant entries with model `deepseek*`, and count across all sessions and subagents together (the limit is per account). Pre-pacing minutes show 90-125/min, probably inflated by non-unique ids; don't trust those.
