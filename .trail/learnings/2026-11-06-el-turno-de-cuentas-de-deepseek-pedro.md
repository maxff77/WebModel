---
title: "El turno de cuentas de DeepSeek reparte desgaste, no sube velocidad"
author: Pedro
date: 2026-11-06
branch: fix/pow-asset-build
cost: { minutes: 48, tokens: 2926649 }
id: l-555586c7
scope: repo
status: active
src: agent
touches:
  - tests/unit/providers/deepseek-pacing.test.ts
  - src/providers/deepseek/pacing.ts
  - tests/unit/core/pool.test.ts
  - src/core/pool.ts
  - src/providers/deepseek/index.ts
  - tests/unit/providers/deepseek-chat.test.ts
  - vitest.config.ts
  - README.md
---

## Decided
El gate de ritmo de DeepSeek es uno solo por proceso, no por cuenta: añadir 2-3 cuentas al turno reparte las llamadas entre ellas (y da failover), pero NO sube el throughput, porque lo que DeepSeek puntúa es la IP. Queda escrito en el README para que nadie lo lea al revés.
El gap pasa a tener banda de ±25 % alrededor de la media: un intervalo de exactamente 6000 ms para siempre es una firma de temporizador, y la banda no cuesta latencia media.
El backoff por rate limit escala 30 s → duplicando → tope 10 min; el de captcha es fijo en 60 s porque el captcha es la IP marcada, no un problema de volumen.
El rate limit ahora también frena el gate global, no solo la cuenta que lo recibió: antes las otras cuentas seguían disparando cada 6 s mientras DeepSeek ya decía "too frequent".
`challenge_required` entra en los rechazos del pool para que la llamada pase a otra cuenta, pero NO marca la cuenta fuera: el challenge es de la IP, no de la cuenta.

## Tried and ruled out
Decaer la escalera por tiempo transcurrido: el paso 2 ya dura 120 s, así que el siguiente rechazo siempre reseteaba a 30 s y el tope de 10 min era inalcanzable. Se cambió a `ok()` explícito, que la llama el provider cuando un completion llega a FINISHED.
Meter los WMB_* del pacer en config/loader.ts: no existe en el provider y habría que tocar cli.ts y el constructor; `WMB_TOOL_FORMAT` ya se lee a nivel de módulo, así que hay precedente del patrón contrario.

## Watch out
No hay línea base de captchas: `challenge_required` no estaba en el journal de rechazos y los avisos van a la terminal. Para afirmar que esto baja los captchas hay que capturar la salida del bridge a un log y contar CHALLENGE_REQUIRED por hora antes y después.

In the code: src/providers/deepseek/pacing.ts, src/providers/deepseek/index.ts, src/core/pool.ts, WMB_MIN_GAP_MS, WMB_GAP_JITTER, WMB_CHALLENGE_BACKOFF_MS, WMB_RATE_LIMIT_BACKOFF_MS
