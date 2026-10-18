---
title: "Bridge logs after the DSML/rate-limit fix: post-fix traffic and garble shapes"
author: Pedro
date: 2026-10-18
branch: fix/claude-code-agent-tools
cost: { minutes: 16, tokens: 221660 }
touches:
  - src/core/tool-protocol.ts
  - src/routes/anthropic-compat.ts
  - tests/unit/core/tool-protocol.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
---

## Decided
- Bridge stdout warnings now carry an ISO timestamp; garbled-block warnings also carry the parsed call count and `dsmlShape(reply)` (DSML tags plus text lengths, no content), and a second "still garbled" line when the re-ask fails too.
## Tried and ruled out
- Reproducing garbles with synthetic load (3 parallel `claude -p` sessions, 62 tool turns writing small files): 0/62 garbled, 1 rate-limit wait. It does not reproduce real-project rates; read shapes from real sessions instead.
## Watch out
- Claude Code transcript timestamps are UTC; this machine runs CST (UTC-6). Compare them with the bridge start time (`ps -o lstart`) in one zone, or pre-restart replies get counted as post-fix (a "post-fix leak" was really from before the restart).
- Real traffic after the fix (101 replies): 0 DSML leaks, 0 user nudges, 0 API errors, but 17 garbled re-asks (17%) against 1.2% zero-call garbles before. Composition unknown: re-asking blocks that already parsed complete calls may be pure waste. Read the logged shapes before changing the re-ask policy.
- Bridge stdout is its only log: start it with output redirected to a file.
