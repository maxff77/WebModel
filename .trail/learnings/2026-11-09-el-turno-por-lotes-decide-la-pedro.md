---
title: "El turno por lotes decide la cuenta dueña al adquirir, no al empezar el escaneo"
author: Pedro
date: 2026-11-09
branch: feat/deepseek-turn-batch
cost: { minutes: 29, tokens: 218488 }
id: l-ee93ae0e
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - docs/agents/issue-tracker.md
  - docs/agents/triage-labels.md
  - docs/agents/domain.md
  - tests/unit/core/pool.test.ts
  - src/core/pool.ts
  - src/cli.ts
  - README.md
  - tests/unit/routes/anthropic-pool.test.ts
---

## Decided
En el turno por lotes, la cuenta dueña del lote se decide al adquirir la llamada, releyendo `cursor % n` justo antes de marcar la cuenta ocupada, y el cursor se deja normalizado. Así una llamada concurrente que movió el turno durante los `await` de `free()` no convierte una llamada al dueño en desborde.

## Tried and ruled out
Comparar el índice tomado contra el snapshot del inicio del escaneo: falla en dos casos reales. (1) El cursor puede valer `n` por cómo se guarda como `index + 1`; con el snapshot en `n`, el miembro del índice 0 nunca coincide y el turno se queda clavado en esa cuenta. (2) Dos llamadas concurrentes leen el mismo snapshot antes de los `await`; la segunda toma otra cuenta y, al no coincidir, no cuenta ni avanza, así que el siguiente turno repite cuenta y el reparto por lotes se desvía. Se descartó mover el cursor con cualquier adquisición: ese era el turno por petición anterior y rompe el lote.

## Watch out
Bajo concurrencia, si la cuenta dueña cambió a un índice que el escaneo aún no había comprobado, el relevo por cuenta fuera (`down.has(owner)`) no se detecta en esa llamada; la siguiente lo corrige. Es aceptable: el desborde es la excepción y el tráfico normal es serial. Si se quisiera exactitud total, habría que serializar la decisión del turno.

In the code: src/core/pool.ts (`next()`, `announceTurn`), `this.cursor % this.members.length`, `down: Set<number>`, `batchSize`; tests/unit/core/pool.test.ts, tests/unit/routes/anthropic-pool.test.ts; `npx vitest run tests/unit tests/integration`; WMB_DEEPSEEK_TURN_BATCH.
