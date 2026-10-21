---
title: "Ticket 2 prefactor: injectable browser launchers"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 3, tokens: 73133 }
touches:
  - src/browser/manager.ts
  - tests/unit/browser/manager.test.ts
---

## Decided
Ticket maxff77/WebModel#2 introduces a single seam in BrowserManager: an optional `launchers` map keyed by BrowserEngine ('chrome' | 'camoufox') in BrowserManagerOptions. Chrome is the only default wired today; Camoufox lands in #3. Both launch-mode paths (ensureBrowser and startLogin) call the launcher of the active engine through one private `launch(headless)`, so unit tests can supply doubles without opening a real browser. `activate(engine)` releases the current browser and switches the engine; `getEngine()` exposes it. In attach mode release disconnects via `browser.close()` without closing the user's Chrome. Chrome executable resolution and the "Chrome not found" error live in the default Chrome launcher.

## Tried and ruled out
Injecting a single `launcher` function instead of a keyed map: ruled out because the spec tests two engine doubles and #3 would have to reshape the seam.

## Watch out
Issue #2's GitHub body is misaligned: it carries #3's end-to-end acceptance criteria. Title + parent spec (docs/camoufox-engine-spec.md) are authoritative: #2 is the prefactor only. Login with missing Chrome now reports `Failed: Chrome not found...` instead of `Chrome not found.`; same failure path, different message.
