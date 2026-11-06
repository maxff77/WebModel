---
title: Para medir captchas hay que reiniciar el bridge con la salida a un archivo
author: Pedro
date: 2026-11-06
branch: fix/pow-asset-build
cost: { minutes: 3, tokens: 26238 }
id: l-324a0fef
scope: repo
status: active
src: agent
touches:
  - README.md
  - src/core/pool.ts
  - src/providers/deepseek/challenge.ts
  - src/providers/deepseek/index.ts
  - src/providers/deepseek/pacing.ts
  - tests/unit/core/pool.test.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - tests/unit/providers/deepseek-pacing.test.ts
  - vitest.config.ts
  - src/cli.ts
---

## Decided
El bridge no tiene watch: corre el código que había al arrancar, así que cualquier cambio en src exige matar el proceso y relanzarlo. Como escribe a la terminal del que lo lanzó, para medir sin pantalla hay que relanzarlo con la salida redirigida:
`nohup npx tsx src/cli.ts >> ~/.webmodel/bridge-$(date +%F).log 2>&1 &`
Con eso `grep -c CHALLENGE_REQUIRED ~/.webmodel/bridge-*.log` da la línea base de captchas, que antes no existía.

## Tried and ruled out
Contar captchas por el journal de rechazos: no sirve, `challenge_required` no estaba en el conjunto hasta este cambio y el journal arranca vacío de captchas.

## Watch out
Una cuenta con `auth.json` en `active` puede estar deslogueada en el sitio: el health dice `authenticated: true` porque lee el archivo, pero el turno la descubre al llamarla, la marca fuera 300 s y hace failover perdiendo ~14 s en el primer intento. Si el turno va lento de forma intermitente, mirar `[pool] <cuenta> out: logged out` en el log antes que el pacing.

In the code: src/cli.ts, ~/.webmodel/config.yml, ~/.webmodel/bridge-<fecha>.log, [pool] ... out: logged out
