---
title: "Ticket 4: doctor detects the Camoufox binary without blocking startup"
author: Pedro
date: 2026-10-21
branch: fix/claude-code-agent-tools
cost: { minutes: 6, tokens: 103662 }
touches:
  - src/cli.ts
  - src/doctor.ts
  - tests/unit/doctor.test.ts
---

## Decided
Ticket maxff77/WebModel#4 is "Doctor: detectar el binario de Camoufox"; the issue bodies in that tracker are shifted one behind their titles (issue #4's body is the failover ticket), so titles + docs/camoufox-engine-spec.md are the spec. `runDoctor()` now takes the resolved engine; the CLI loads config before the doctor so YAML/env/flag engine resolution stays single-source. The Camoufox binary is detected via a deep import of `camoufox-js/dist/pkgman.js` (`launchPath()` + `installedVerStr()`), which throws when missing instead of downloading. A missing binary is a `warn` (never `fail`), with `npx camoufox-js fetch` as the fix; the message says the first camoufox request auto-downloads it (~300 MB), because `ensureCamoufoxInstalled()` does. Node < 22 with the camoufox engine is also a warn. Chrome missing is non-fatal when engine=camoufox, which closes the gap ticket #3's review left. Doctor warnings now print at startup without `--verbose`, and `printDoctorResults` decides the summary from statuses instead of from the presence of a `fix` line.

## Tried and ruled out
Using the public `launchOptions()` for detection: rejected because it calls `ensureCamoufoxInstalled()`, which auto-downloads the ~300 MB browser. Re-deriving the install dir from `~/Library/Caches/camoufox` + `CAMOUFOX_INSTALL_DIR`: rejected, it duplicates the library's own resolution. Making a missing Camoufox binary fatal: rejected, the spec says the doctor must not fail bridge startup.

## Watch out
`pkgman.js` is not re-exported from camoufox-js's index; the deep import works because the package has no `exports` map, but it is version-sensitive. On this machine the binary is NOT installed (`launchPath()` throws "not installed at ~/Library/Caches/camoufox"), so the real-library path verified is the warn one; the installed branch is covered with injected tests. The e2e suite still fails on live logins/browser sessions, unrelated to this change.
