---
title: Los e2e del puente mandan tráfico real a los proveedores; el experimento solo permite el smoke
author: Pedro
date: 2026-11-09
branch: feat/deepseek-turn-batch
cost: { minutes: 1, tokens: 3881 }
id: l-d775ff81
scope: repo
status: active
src: agent
touches:
  - README.md
  - src/cli.ts
  - src/core/pool.ts
  - tests/unit/core/pool.test.ts
  - tests/e2e/real-providers.test.ts
  - tests/e2e/server-lifecycle.test.ts
---

## Decided
Para cerrar un cambio del turno de DeepSeek se corre solo la suite unit+integration. Los e2e del puente no son un safe default: con credenciales presentes hacen peticiones reales a DeepSeek/Claude y gastan cuentas. El experimento de lotes limita el tráfico sintético a las 5 peticiones del smoke.

## Tried and ruled out
Correr `npm test` completo para validar el cambio: descartado porque `tests/e2e/real-providers.test.ts` y `tests/e2e/server-lifecycle.test.ts` envían mensajes reales cuando `skipIfNotAuth` encuentra credenciales. Se usó `npx vitest run tests/unit tests/integration` (423 tests) y `tsc --noEmit`.

## Watch out
`skipIfNotAuth` no salta si hay perfil logueado, así que en esta máquina los e2e sí pegan a los proveedores. "Suite completa" en este repo no significa "sin efectos externos".

In the code: tests/e2e/real-providers.test.ts, tests/e2e/server-lifecycle.test.ts, `skipIfNotAuth`, `npm test` = `vitest run`, `npx vitest run tests/unit tests/integration`.
