---
title: "Camoufox as a second browser engine: what the code allows"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 1, tokens: 205494 }
touches:
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
  - src/server.ts
  - tests/helpers/test-server.ts
  - tests/unit/core/queue.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/routes/anthropic-agent.test.ts
---

## Decided
- Nothing implemented yet. Grilling round 1 sent to Pedro; awaiting answers on driver (anti-detection vs resilience), fallback granularity, single-active-engine vs two running, scope, and camoufox-js vs Python sidecar.

## Tried and ruled out
- Python sidecar (pip camoufox + Playwright server) as the integration path: ruled out. camoufox-js 0.13.0 exposes launchOptions() for playwright-core's firefox, so the same Page type works with no IPC and no second runtime.
- connectOverCDP for Camoufox: impossible, it is Firefox. Attach mode stays Chrome-only; Camoufox can only do launch mode.
- Per-request failover to the other engine on any error: rejected. Retrying after DeepSeek already received the message duplicates it and raises ban risk. App-level errors (40003, 5xx, auth) are not engine failures.

## Watch out
- Cookies live in the browser profile, not in AuthStore (it only stores a status). Two engines means two profile dirs and two separate logins per provider.
- Only src/browser/manager.ts touches Playwright. Providers import just `type Page`, so engine choice is one seam, not 8 providers.
- camoufox-js needs Node >=22 (repo declares >=20; machine runs v24) and downloads its own Firefox build via `npx camoufox-js fetch` (~200MB). It pulls better-sqlite3, maxmind, impit and 7 other deps.
