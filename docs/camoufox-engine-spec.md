# Spec: Camoufox como segundo motor de navegador

Estado: publicado en https://github.com/maxff77/WebModel/issues/1 (label `ready-for-agent`).
Fecha: 2026-10-21.

## Problem Statement

El bridge depende de un único motor de navegador (Chrome vía Playwright). Eso tiene dos consecuencias para quien lo usa:

- La huella del navegador es siempre la misma y es la de Chrome controlado por Playwright. Cuando el sitio web (p. ej. DeepSeek) empieza a tratar esa huella como sospechosa, no hay forma de cambiar de perfil sin cambiar de herramienta.
- Si Chrome no arranca, se cuelga o pierde la pestaña, el bridge entero deja de servir peticiones hasta que alguien lo reinicia a mano.

## Solution

El bridge soporta dos motores intercambiables: Chrome (el actual) y Camoufox (Firefox con huella camuflada). El usuario elige cuál es el motor principal desde configuración, CLI o dashboard, sin reiniciar el proceso. Si el motor principal falla al arrancar, o su página muere, el bridge cambia automáticamente al otro motor para las siguientes peticiones. Cada motor mantiene su propio perfil y su propio login.

## User Stories

1. Como usuario del bridge, quiero elegir Camoufox como motor principal desde el fichero de configuración, para usar una huella de navegador distinta sin cambiar de herramienta.
2. Como usuario del bridge, quiero elegir el motor principal con un flag de CLI, para probar Camoufox sin editar configuración.
3. Como usuario del bridge, quiero ver y cambiar el motor activo desde el dashboard, para alternar sin reiniciar el proceso ni tocar ficheros.
4. Como usuario del bridge, quiero que el motor por defecto siga siendo Chrome, para que actualizar no me obligue a descargar 200 MB ni a repetir logins.
5. Como usuario del bridge, quiero que un fallo de arranque del motor principal caiga al otro motor, para que un cierre inesperado de Chrome no tire el bridge.
6. Como usuario del bridge, quiero que una página muerta (cerrada o crasheada) marque el motor como caído y use el otro en la siguiente petición, para recuperarme sin reiniciar.
7. Como usuario del bridge, quiero que el reintento automático solo ocurra cuando el mensaje aún no se ha enviado, para no duplicar mensajes ni arriesgar un baneo.
8. Como usuario del bridge, quiero un error claro cuando el motor de respaldo no tiene sesión iniciada, para saber que debo hacer login en ese motor.
9. Como usuario del bridge, quiero que el login de cada motor abra una ventana visible con su propio perfil, para poder iniciar sesión aunque el contexto principal sea headless.
10. Como usuario del bridge, quiero que cambiar de motor no cierre mi Chrome en modo attach, para no perder mis pestañas.
11. Como usuario del bridge, quiero que el doctor me diga si el binario de Camoufox falta, para entender por qué no arranca antes de leer un stack trace.
12. Como usuario del bridge, quiero un mensaje con el comando exacto de descarga cuando falte el binario, para resolverlo sin buscar documentación.
13. Como usuario del bridge, quiero que el motor elegido aplique a todos los providers, para no configurar cada uno.
14. Como usuario del bridge, quiero que las señales de detección (código 40003, reto de Cloudflare, baneo) no cambien de motor automáticamente, para no empeorar la situación con una sesión nueva desde la misma IP.
15. Como desarrollador del bridge, quiero dobles de los launchers en los tests unitarios, para cubrir selección de motor, failover y rutas de perfil sin abrir navegadores reales.

## Implementation Decisions

Módulos afectados: gestor de navegador, cargador de configuración, CLI, doctor, rutas de gestión y dashboard.

- Configuración: nuevo campo `browser.engine` con valores `chrome` y `camoufox`. Default `chrome`. Override por variable de entorno `WMB_BROWSER_ENGINE` y por flag de CLI `--engine`.
- Perfiles: `browser.profileDir` sigue siendo el perfil de Chrome, sin cambios de ruta, para no romper la sesión existente. Camoufox usa un directorio hermano derivado (`camoufox-profile` dentro del state dir). No hay importación de cookies entre motores.
- Seam único: la clase gestora de navegador gana el concepto de motor activo, un método de activación (`activate(engine)`) y una única ruta de arranque privada que despacha al launcher del motor activo. No se introduce una interfaz/estrategia `BrowserEngine` ni una factory: el motor es una unión de literales (`'chrome' | 'camoufox'`) y los providers solo consumen `Page`.
- Camoufox se lanza con `camoufox-js` (`Camoufox({ user_data_dir })`), que devuelve un `BrowserContext` persistente compatible con lo que el gestor ya devuelve. Requiere Node ≥22 y el binario descargado con `npx camoufox-js fetch`.
- Headless: el contexto principal es headless en ambos motores. El flujo de login abre un contexto visible aparte con el mismo perfil del motor, igual que hoy hace Chrome.
- Modo attach es exclusivo de Chrome (Camoufox es Firefox y no soporta CDP). Si `engine=camoufox`, el modo attach se ignora con un warning y se arranca en modo launch.
- Failover: se activa si (a) el motor principal no arranca, o (b) su página se cierra o crashea. Una página muerta marca el motor como caído; la siguiente adquisición de página usa el otro motor. El reintento dentro de la misma petición solo se permite antes de enviar el mensaje; una vez enviado, la petición falla y el motor queda caído para las siguientes.
- Cambio de motor en caliente: escribir `browser.engine` en el fichero de configuración y liberar el motor actual. En attach, liberar significa desconectar sin cerrar el Chrome del usuario; en launch, cerrar el contexto.
- Doctor: comprueba la presencia del binario de Camoufox y la versión de Node, sin fallar el arranque del bridge.
- Rutas de gestión: el estado de salud incluye el motor activo; un nuevo endpoint permite leer y fijar el motor.
- Dashboard: muestra el motor activo y ofrece un selector que persiste la elección.

## Testing Decisions

- Un test bueno verifica comportamiento externo observable del gestor (qué motor se usa, qué perfil, qué ocurre en un fallo), no llamadas internas ni detalles de implementación.
- La única seam nueva es la inyección del launcher de cada motor (dos dobles) en el constructor del gestor. El resto reutiliza seams existentes: rutas de gestión y su estilo de test actual.
- Módulos testeados: gestor de navegador (unit), rutas de gestión (unit, mismo estilo que las rutas existentes).
- Casos: selección de motor por config/CLI/env, ruta de perfil por motor, arranque fallido del principal → motor alternativo, página crasheada → motor alternativo en la siguiente adquisición, reintento pre-envío una sola vez, cambio de motor en caliente, attach que no cierra Chrome.
- Prior art: tests unitarios de rutas y de doctor existentes; el e2e real de Camoufox se marca skip si falta el binario.

## Out of Scope

- Importar cookies entre Chrome y Firefox.
- Failover disparado por señales de detección (40003, Cloudflare, bans).
- Motor distinto por provider.
- Sidecar Python de Camoufox.
- Campo de configuración para headless.
- Distribución automática del binario de Camoufox vía postinstall.

## Further Notes

- Motivo principal del cambio: anti-detección (huella). La resiliencia es un beneficio secundario, no el objetivo.
- Riesgo a verificar durante implementación: el gestor llama hoy a `browser.close()` al apagar; en modo attach eso puede cerrar el Chrome del usuario. Hay que confirmar empíricamente qué llamada de Playwright desconecta sin cerrar.
- Riesgo a verificar: el login de Camoufox reutiliza el perfil persistente; confirmar que el `BrowserContext` visible y el headless comparten cookies sin bloqueo de perfil.
- `camoufox-js` arrastra diez dependencias (better-sqlite3, maxmind, impit, etc.) y su binario pesa ~200 MB.

## Addendum 2026-10-21: perfiles aislados por cuenta

El eje de identidad pasa de "motor" a "perfil". Un perfil empaqueta nombre, motor inmutable, directorio propio y huella persistida; `profiles/<slug>/` es la fuente de verdad y la configuración solo guarda el perfil activo. Un solo perfil activo a la vez. `default` migra desde `chrome-profile`/`camoufox-profile` sin re-login. Login y estado por `perfil:provider`. El failover solo existe si un perfil declara `fallbackProfile`; entonces una caída de arranque o de página cambia a ese perfil, con un único reintento antes de enviar. Regenerar huella es una acción explícita con warning. Attach queda limitado al perfil `default`.

Tickets: #8 (perfiles), #9 (login por perfil), #10 (fallback al arrancar), #11 (página muerta y reintento), #12 (regenerar huella). Sustituyen a #5, #6 y #7.
