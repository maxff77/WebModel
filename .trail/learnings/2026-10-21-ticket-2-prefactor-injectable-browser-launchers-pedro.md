---
title: "Ticket 2 prefactor: injectable browser launchers"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 73133 }
touches:
  - src/browser/manager.ts
  - src/core/queue.ts
  - src/providers/deepseek/client.ts
  - src/providers/deepseek/index.ts
  - src/routes/anthropic-compat.ts
  - src/routes/openai-compat.ts
  - src/server.ts
  - tests/helpers/test-server.ts
  - tests/unit/core/queue.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
---

## Decided
Ticket maxff77/WebModel#2 introduces a single seam in BrowserManager: an optional `launchers` map keyed by BrowserEngine ('chrome' | 'camoufox') in BrowserManagerOptions. Chrome is the only default wired today; Camoufox lands in #3. Both launch-mode paths (ensureBrowser and startLogin) now call the injected chrome launcher, so unit tests can supply a double without opening a real browser. Chrome executable resolution and the "Chrome not found" error moved into the default launcher.

## Tried and ruled out
Injecting a single `launcher` function instead of a keyed map: ruled out because the spec tests two engine doubles and #3 would have to reshape the seam.

## Watch out
Issue #2's GitHub body is misaligned: it carries #3's end-to-end acceptance criteria. Title + parent spec (docs/camoufox-engine-spec.md) are authoritative: #2 is the prefactor only. Login with missing Chrome now reports `Failed: Chrome not found...` instead of `Chrome not found.`; same failure path, different message.
