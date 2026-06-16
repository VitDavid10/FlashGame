# PillWars — Roadmap multijugador

Documento vivo del estado del proyecto y las mejoras pendientes para escalar y
profesionalizar el multijugador. El orden de las fases pendientes es el
recomendado: de más rentable (poco esfuerzo, mucha ganancia) a más complejo.

---

## ✅ Fases ya hechas

### Fase 0 — Simulación compartida
- `shared/sim.js`: misma física en cliente y servidor.
- Base para que el servidor sea autoritativo (anti-trampas) y el cliente prediga/interpole.

### Fase 1 — Servidor autoritativo
- `server/index.js`: servidor WebSocket, **tick a 40 Hz** (uno cada 25 ms).
- Catálogo de salas: `{classic, arcade} × {Free, 5$, 10$, 20$, 50$}`.
- PvP real: el servidor calcula la física y manda snapshots.

### Fase 2 — Cliente online pulido
- **Interpolación** en el cliente (movimiento suave entre snapshots).
- **Reconexión con token** (15 s de gracia: si se cae la conexión, recuperas tu bola).
- Modo **arcade online** con cuenta atrás y reinicio de partida.

### Fase 3 — Panel de administración (`/admin`)
- Reglas por sala en vivo (velocidad, comida, virus, bots, mín. reales, población).
- Estadísticas (entradas, muertes, dinero), ranking de jugadores, países, historial.
- Protegido por `ADMIN_KEY` con rate-limit anti fuerza bruta.

### Fase 3.5 — Producción y control (sesiones recientes)
- **Despliegue en VPS** con `wss` + dominio **pillwars.fun** detrás de Cloudflare.
- **Lobby**: la sala no empieza hasta el mínimo de jugadores reales; se rellena con
  bots hasta "Población" (backfill dinámico: entra un real → sale un bot).
- **Tope de jugadores reales por sala** (editable por sala) + mensaje **"Sala llena"**.
  Los espectadores NO cuentan para el tope.
- **Frecuencia de snapshots (Hz) configurable** globalmente desde el panel
  (40/20/13/10 Hz — son los valores reales alcanzables con tick de 25 ms).
  También por variable de entorno `SNAPSHOT_HZ`.
- **Stress test lanzable desde el panel**: bots con movimiento tipo NPC, parámetros
  (nº bots, duración, ramp, inputs/Hz, salas afectadas), **respawn al morir**
  (escalonado, opcional) y **ping/pong real (RTT)** para medir latencia de verdad.
- Panel muestra **vivos / muertos / espectadores** por sala.

---

## ⏳ Fases pendientes (para ser más pro)

### Fase 4 — AOI + protocolo binario  ⭐ (la más rentable)
El cuello de botella actual es enviar snapshots a 40 Hz a todos los jugadores.
Un solo proceso aguanta cómodo ~300 jugadores (~30 ms de ping). Para subir ese
techo SIN partir el servidor:

- **AOI (Area of Interest)**: a cada jugador se le manda solo lo que tiene cerca
  (su zona de visión), no todas las entidades de la sala. Enorme ahorro en salas
  grandes y con mucha gente.
- **Protocolo binario** en vez de JSON: serializar posiciones en bytes en lugar de
  texto. Mucha menos CPU de serialización y mucho menos ancho de banda.

➡️ Con esto un solo proceso pasa de ~300 a bastante más, con poco riesgo arquitectónico.

### Fase 5 — Salas independientes (multiproceso)
Node.js usa un solo núcleo. Como las salas **no interactúan entre sí**, se pueden
repartir entre varios procesos (sharding) para aprovechar todos los núcleos del VPS.

- Lanzar N copias del servidor, cada una dueña de unas salas.
- **Capa de enrutado (gateway)** que mande cada jugador al proceso de su sala.
- Panel de admin que **agregue** la información de todos los procesos.
- Más complejidad de despliegue (varios servicios en vez de uno).

➡️ Solo merece la pena cuando se necesiten **miles de jugadores concurrentes** de forma habitual.

### Extras "nivel pro" (cuando toque)
- **Delta compression**: mandar solo lo que cambió entre snapshots, no el estado completo.
- **Predicción del propio jugador + reconciliación** con el servidor (movimiento
  instantáneo aunque haya ping).
- **Monitorización real** (Grafana/Prometheus) en lugar del stress test casero.
- **Redis** para estado/sesiones/matchmaking compartidos entre procesos.
- **Tests automatizados** y anti-cheat más robusto (rate-limit de inputs, validaciones).

---

## 🔒 Seguridad — estado actual

**Bien protegido (servidor autoritativo):**
- ✅ No se puede teletransportar, cambiar masa propia ni speedhack: el movimiento lo
  calcula el servidor a partir de los inputs.
- ✅ Comandos de truco (`/god /mass /speed /bots`) bloqueados online (solo admin con `fromAdmin`).
- ✅ Panel admin con `ADMIN_KEY` de 32 chars + rate-limit anti fuerza bruta.
- ✅ Espectador-control: solo token temporal `?t=` (caduca 10 min); la clave admin
  real NUNCA viaja por la URL (eliminado el fallback `?admin=`).
- ✅ Rate-limit por conexión en mensajes de juego (anti-flood/DoS): umbral suave
  descarta el exceso, umbral duro cierra la conexión (MSG_RATE_SOFT/HARD, env).
- ✅ IPs anonimizadas (RGPD); logs borrados a los 60 días.

**Vulnerabilidades que quedan:**
- ⚠️ **Maphack / visión total**: el servidor manda TODA la sala a cada jugador, así
  que un cliente modificado puede dibujar/zoom-out y ver a todos. → **lo arregla el AOI (Fase 4)**.
- ⚠️ **Bots / aimbot**: el servidor acepta inputs de cualquier WebSocket; no distingue
  humano de script. Mitigable con heurísticas anti-bot, no eliminable del todo.

## Notas de capacidad (medido)
- ~300 jugadores reales concurrentes → ~30 ms de ping, estable (zona cómoda del VPS 4 GB).
- A partir de ~370 la latencia empieza a dispararse (el tick no termina en 25 ms).
- Tope por defecto: **30 reales por sala × 10 salas = 300**, justo el techo cómodo.
- La fluidez la dan los **Hz**; el **ping** solo añade retraso (no causa tirones si es estable).
- Lo que satura es la **bajada** (snapshots), no la **subida** (inputs ~30 Hz del cliente real).
