---
title: "DeepSeek web caps prompts near 525K tokens, so Claude Code gets a 500K window, not 1M"
author: Pedro
date: 2026-10-28
branch: feat/deepseek-account-pool
cost: { minutes: 8, tokens: 57843 }
id: l-3af5c7b6
scope: repo
status: active
replaces: l-442a2982
src: agent
touches:
  - src/providers/deepseek/index.ts
  - src/core/openai-formatter.ts
---

## Decided
- The bridge tells Claude Code 500K for both DeepSeek V4 models. Claude Code sizes its context bar and auto-compact from `max_input_tokens` in /v1/models; the user saw exactly the 128K the bridge reported before.
- The ceiling is chat.deepseek.com, not the model. V4 takes 1M on paper, but the web refuses bigger prompts with "Se alcanzó el límite de longitud. Inicie un nuevo chat." Measured 2026-10-28 through the bridge with node_modules JS as filler, in the bridge's own units (estimateTokens, chars/4): 500K and 525K answered and found both needles (start and middle) in ~5 s; 550K, 600K, 700K and 800K refused.

## Tried and ruled out
- 800K window with compaction at 700K (the user's ask): the web refuses at 550K, so Claude Code would fail before it compacts.
- Spanish text with many numbers as filler: it has 1.33x more real tokens (cl100k) than chars/4 says, so its sizes do not match what Claude Code sends. Code and JSON measure ~1.0x. Use code as filler.
- That the cap is ~1M real tokens: code at ~606K cl100k tokens was refused, while text at ~650K cl100k tokens (1.95M chars) answered. The cap is closer to a character or byte count (~2.1–2.2M chars) than to cl100k tokens. Not pinned down.

## Watch out
- A request over the cap comes back as a 502 api_error, so Claude Code retries it. Keep auto-compact at or below the 500K window.
- Right after a login the page is still navigating: the first calls fail with "Failed to fetch" or "Execution context was destroyed". A small control call tells this apart from a size error.

In the code: src/providers/deepseek/index.ts `models()`; src/core/openai-formatter.ts maps contextWindow to max_input_tokens. Restart the bridge after a change (no watch). In zsh, pass PIDs to kill one per argument; a newline-joined $PIDS fails and the new bridge binds 3457.
