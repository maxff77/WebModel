---
title: DeepSeek pacing defaults lowered to 10/min with a 6 s gap
author: Pedro
date: 2026-10-24
branch: fix/claude-code-agent-tools
cost: { minutes: 1, tokens: 14057 }
touches:
  - package-lock.json
  - package.json
  - src/browser/manager.ts
  - src/cli.ts
  - src/config/loader.ts
  - src/core/queue.ts
  - src/dashboard/app.js
  - src/dashboard/index.html
  - src/doctor.ts
  - src/profiles/store.ts
---

## Decided
- `requestPacing` defaults in src/core/queue.ts are now 10 starts/min and a 6 s minimum gap between starts (were 20/min and 1 s). Reason: the user hit "Messages too frequent" around 2026-10-22 and the DeepSeek account stayed locked for about 1 hour. Fewer messages, spaced like a person, to lower ban risk.
- The gap is 6 s, not only a lower cap: with a 1 s gap, 10/min still allows a ~10 s burst, and 7 messages in ~17 s already got refused on 2026-10-18.
- The bridge log now goes to `bridge.log` at the repo root, appended (`*.log` is gitignored). Scratchpad logs under /private/tmp got deleted, which lost the evidence for the lockout.

## Tried and ruled out
- A live probe to measure the new spacing: skipped, it spends real DeepSeek messages.

## Watch out
- A 1 h lockout points to a longer window (hourly quota or penalty). 10/min sustained is still 600/h; if it happens again, `grep "rate limited" bridge.log` gives the times to work from.
- Override without a rebuild: `WMB_MAX_RPM`, `WMB_MIN_GAP_MS`. Tests zero both in tests/helpers/test-server.ts, so no test depends on the defaults.
