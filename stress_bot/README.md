# PillWars Stress Bot

Panel local de stress test. Corre **en tu PC** y ataca al servidor del VPS sin compartir CPU con él.

## Uso

1. Doble click en `start.bat` (Windows). La primera vez instala `ws` con npm; luego solo arranca.
2. Se abre el navegador en `http://localhost:7777`.
3. En "Server URL" pones la dirección del servidor (ej: `wss://pillwars.fun` o `ws://localhost:8080` para el de tu PC).
4. Configura el test (bots, duración, salas...) y dale a **ARRANCAR**.

## Requisitos

- Node.js instalado: https://nodejs.org/

## Por qué local

Antes el stress test corría dentro del propio VPS, lo que falseaba la medición: el generador competía por CPU con el servidor y "ahogaba" la carga. Corriéndolo desde tu PC el servidor solo ve tráfico real.

## Ficheros

- `server.js` — mini HTTP/SSE en localhost:7777, gestiona spawn/stop de los tests.
- `index.html` — panel del navegador.
- `stress-npc.js` — bots con movimiento NPC (joins, inputs, splits, skills, muertes y reconexiones).
- `stress-ddos.js` — flood con canario para medir rate-limit y latencia bajo ataque.
- `botnames.js` — generador de nombres realistas para bots.
- `start.bat` — ejecutable de Windows.
