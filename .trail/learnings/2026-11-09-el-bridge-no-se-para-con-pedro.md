---
title: "El bridge no se para con SIGTERM; usar SIGINT o kill -9, y mirar el puerto con -sTCP:LISTEN"
author: Pedro
date: 2026-11-09
branch: feat/deepseek-turn-batch
cost: { minutes: 4, tokens: 36269 }
id: l-6e0dd1ec
scope: repo
status: active
src: agent
touches:
  - src/cli.ts
  - src/core/pool.ts
  - src/providers/deepseek/index.ts
  - README.md
  - tests/unit/core/pool.test.ts
---

## Decided
Para reiniciar el bridge se usa `kill -INT <pid>` o `kill -9`; no `kill` a secas. El CLI solo registra handler de SIGINT. Para comprobar el listener, `lsof -nP -iTCP:3456 -sTCP:LISTEN`; sin `-sTCP:LISTEN` aparece también un helper de Chrome que tiene una conexión al puerto y se confunde con el servidor.

## Tried and ruled out
`kill 34906 34909` (SIGTERM) sobre el bridge arrancado con nohup: los dos procesos siguieron en estado S y el puerto siguió escuchando; hubo que `kill -9`. El primer bridge, arrancado desde una terminal, sí murió tras SIGTERM; no es una parada fiable. El SIGKILL deja vivo el Chrome CDP de 9222 y el siguiente bridge lo reutiliza, así que no hace falta matarlo.

## Watch out
`nohup ./node_modules/.bin/tsx src/cli.ts >> log 2>&1 & disown` deja PPID 1 y sobrevive a la sesión. La línea de arranque no lleva timestamp: poner un marcador `=== restart ... ===` antes de reiniciar para separar corridas. No hay watch: el código nuevo solo entra al reiniciar.

In the code: src/cli.ts:500 (único process.on('SIGINT', ...)); `kill -9 34906 34909`; `lsof -nP -iTCP:3456 -sTCP:LISTEN`; `nohup ./node_modules/.bin/tsx src/cli.ts >> ~/.webmodel/bridge-2026-11-09.log 2>&1 & disown`; CDP 127.0.0.1:9222.
