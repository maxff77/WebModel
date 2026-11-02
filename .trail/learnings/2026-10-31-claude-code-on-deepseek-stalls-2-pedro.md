---
title: Claude Code on DeepSeek stalls 2-3 min when the Mac switches Wi-Fi networks; the bridge is not the cause
author: Pedro
date: 2026-10-31
branch: feat/deepseek-account-pool
cost: { minutes: 8, tokens: 51582 }
id: l-4853a2a6
scope: repo
status: active
replaces: l-f538754f
src: agent
---

## Decided
- 2026-10-31: both measured stalls started in the same second as a macOS Wi-Fi change. 07:16:11 local: link change, DHCP removed 192.168.68.100. 07:30:45: WiFiAgent asked to join another network and dropped 192.168.204.180. A third switch at 07:43:00 (to 10.203.206.x) hit no request in flight.
- Signature: the in-flight completion ends "Failed to fetch" with zero bytes. For 1-1.5 min after, every request fails "session create: Failed to fetch" in milliseconds on all accounts at once. Claude Code retries on backoff and recovers alone. The macOS DNS failures in those windows are a symptom of the switch, not the cause.
- No regression test: the bridge behaves correctly (a possibly-sent failure is not retried, Claude Code retries the 502). The fix is on the machine: stop the Mac auto-joining between networks.

## Tried and ruled out
- Gaps of 2-5 min in bridge.log with no [tools] line: these were the user typing; text replies write no [tools] line. Check the session transcript before calling a gap a stall.
- Prompt size, rate limits, the provider queue and DeepSeek blocking the IP.

## Watch out
- In zsh, `log` is a builtin: use /usr/bin/log or queries return nothing silently.
- The resolver IPs change with each network; a probe with fixed DNS servers reports false outages.

In the code:
- Correlate: bridge.log `err=...Failed to fetch` times vs `/usr/bin/log show --predicate 'process == "airportd" OR process == "configd"'` | grep -E "Will disassociate|DHCP en0: removing|LINK_CHANGED".
