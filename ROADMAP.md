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

### Fase 4 — AOI + protocolo binario ✅ (HECHA)
- **AOI (Area of Interest)** activo por defecto: el server filtra el snapshot por
  jugador (caja cuadrada centrada en su centroide, lado dependiente del tamaño
  del jugador + 30% margen). Tus propias celdas SIEMPRE se incluyen (split).
  Espectadores y muertos reciben snapshot completo. Toggle en `/admin` y env
  `AOI=0` para desactivar.
- **Protocolo binario** (`shared/proto.js`) opt-in con `?bin=1` en la URL del
  juego. Frame ~17 B por celda (i16 x/y, u16 r×10, 6 B colores RGB, flags).
  Strings UTF-8 con prefijo u16. Sólo SNAP es binario; events/welcome/etc. siguen JSON.
- **Medido en local** (classic Free, 1 jugador + 25 bots):
  - Sin AOI + JSON ……… **11935 B/snap** (referencia)
  - AOI + JSON ………… 2629 B/snap (−78%)
  - AOI + BIN ………… **910 B/snap (−92%)**
- Maphack cerrado: un cliente modificado no puede dibujar lo que el server ya no manda.

### Fase 5a — Sharding lógico + matchmaker ✅ (HECHA)
- **20 salas pre-creadas** al arrancar: 2 layers × 2 modos × 5 precios. No se crean
  más bajo demanda. Configurable con env `LAYERS_PER_COMBO`.
- **Matchmaker que APILA**: al hacer join, server elige la layer del combo más
  llena que cumpla (no llena, no a <30s del final, no `ended`). Si ninguna cumple
  → `noSlot` y el cliente vuelve al menú.
- **UX cliente "BUSCANDO SALA..."**: en vez de entrar al instante al recibir
  `welcome`, el cliente queda 3 s con banner animado + 0.6 s "ROOM FOUND" sobre la
  práctica offline. Da sensación de matchmaking.
- **Layers invisibles para el cliente**: solo ve "Free", "5$", etc. El panel admin
  sí las ve con sufijo `L1`/`L2`.
- **Stress test medido (local, 1 proceso)** con 600 bots y AOI+binario:
  - Pico ramp: ~515 simultáneos.
  - Tras absorber el ramp: **p50 0.2 ms · p95 1 ms · max 6.7 ms** (tick nominal 25 ms).
  - Lag del event loop: p95 14-16 ms.
  - Conclusión: 1 proceso aguanta 600 conexiones cómodo con AOI+binario.

## ⏳ Fases pendientes (para ser más pro)

### Fase 5b — Multiproceso real (solo si hace falta)
1 proceso aguanta 600 jugadores cómodos. Cuando el VPS empiece a saturar (~1500+),
repartir las salas entre procesos vía `cluster` + gateway. NO urgente.

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
- ✅ ~~**Maphack / visión total**~~ — cerrado por AOI: cada cliente solo recibe
  entidades en su zona de visión (Fase 4).
- ⚠️ **Bots / aimbot**: el servidor acepta inputs de cualquier WebSocket; no distingue
  humano de script. Mitigable con heurísticas anti-bot, no eliminable del todo.

## Notas de capacidad (medido)
- ~300 jugadores reales concurrentes → ~30 ms de ping, estable (zona cómoda del VPS 4 GB).
- A partir de ~370 la latencia empieza a dispararse (el tick no termina en 25 ms).
- Tope por defecto: **30 reales por sala × 10 salas = 300**, justo el techo cómodo.
- La fluidez la dan los **Hz**; el **ping** solo añade retraso (no causa tirones si es estable).
- Lo que satura es la **bajada** (snapshots), no la **subida** (inputs ~30 Hz del cliente real).
