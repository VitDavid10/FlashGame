/*
 * Servidor autoritativo de PillWars (local).
 *
 * - Catálogo de salas: {classic, arcade} × {Free, 2$, 5$, 10$, 20$}.
 *   Las salas se materializan al entrar el primer jugador y aparecen como
 *   "offline" en el panel de admin mientras no haya nadie.
 * - Lobby: una sala no empieza hasta minReal jugadores reales (5 por defecto,
 *   editable por sala desde el panel). Mientras, el cliente juega práctica.
 * - Backfill: al empezar, la sala se rellena con bots hasta targetPop (10 por
 *   defecto); entra un real → sale un bot, y al revés. targetPop=0 lo desactiva.
 *   offline. El admin puede forzar el inicio.
 * - Online SIN bots por defecto: las reglas de cada sala las fija el admin
 *   (speed y food gain en vivo; virus density y bots al reiniciar) y se
 *   persisten en server/roomrules.json.
 * - Estadísticas por sala (entradas, muertes; dinero = entradas × precio)
 *   persistidas en server/stats.json.
 * - Los muertos se retiran de la sim (no ocupan hueco); su conexión queda de
 *   espectador. Reconexión con token (15 s de gracia). Quick join: room '*'.
 * - Arcade: al acabar la partida, cuenta atrás de reinicio (30 s) y nuevo lobby.
 * - Tick 40 Hz, snapshot 40 Hz (con ids para interpolar en cliente).
 * - Panel de administración en /admin (clave ADMIN_KEY, por defecto 1234).
 *
 * Uso: node server/index.js
 *   Variables: PORT, ADMIN_KEY, MIN_PLAYERS, MATCH_MS, RESTART_MS
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { fork } = require('child_process');
const { WebSocketServer } = require('ws');
const PillSim = require('../shared/sim.js');
const proto = require('../shared/proto.js');     // protocolo binario para snaps (opt-in)
const solana = require('./solana.js');     // verificación de depósitos $PILL
const warbank = require('./warbank.js');   // saldo WAR interno por wallet
const leaderboard = require('./leaderboard.js');   // ranking DIARIO por wallet (premios de tesorería)
const rewards = require('./rewards.js');           // rondas de premios: Merkle + publicación on-chain
const matches = require('./matches.js');           // recibos de partida anclados en la cadena
const reserves = require('./reserves.js');         // prueba publica de lo que se debe a los jugadores
const rake = require('./rake.js');                 // lo que se queda la casa, y a que bolsa va
// El leaderboard filtra por oponentes distintos, pero ese dato vive en los recibos.
// Se inyecta en vez de que un modulo importe al otro: asi ninguno de los dos depende
// del otro para funcionar, y en los tests se puede probar cada uno por su lado.
leaderboard.setProveedorOponentes(() => matches.oponentesDe());
const dailyquests = require('./dailyquests.js');   // retos diarios rotativos (usa skinpoints por dentro)
const skinshop = require('./skinshop.js');         // tienda de skins de pais (SP / $PILL + quema)
const { createGameHost } = require('./game-host.js');   // salas + matchmaking + tick (Fase 1 split Director/Host)
const { listCombos, buildShardMap, applyOverrides } = require('./cluster/shard-map.js');   // reparto combo→host (Fase 4 split multiproceso)
const { createIpc } = require('./cluster/ipc.js');             // request/response sobre fork (Fase 4)

// --- Rol del proceso (Fase 4 split multiproceso) ---
// 'mono'     : un solo proceso hace TODO (comportamiento clásico, por defecto).
// 'host'     : proceso hijo dueño de un subconjunto de combos (salas + WS de juego + tick).
// 'director' : proceso padre (HTTP/admin/warbank/matchmaking) que forkea los hosts.
// Sin la env PW_ROLE el server arranca en 'mono' → idéntico a antes del split.
const PW_ROLE = process.env.PW_ROLE || 'mono';
const PW_HOST_ID = parseInt(process.env.PW_HOST_ID, 10) || 0;
const PW_HOST_COUNT = parseInt(process.env.PW_HOST_COUNT, 10) || 1;

const PORT = parseInt(process.env.PORT, 10) || 8080;
const ADMIN_KEY = process.env.ADMIN_KEY || '1234';
// Path del panel/editor: el repo es PUBLICO en GitHub, así que un valor fijo
// aquí (aunque parezca random) se vería en el código fuente por cualquiera —
// esto NO es "la clave", es solo evitar que un escaneo automático o alguien
// tecleando /admin a lo tonto se tope con la pantalla de login. Lo que de
// verdad protege sigue siendo ADMIN_KEY. Por eso viven en variables de
// entorno (como ADMIN_KEY) y NO se commitean con el valor real — en
// deploy/pillwars.service solo hay un placeholder, igual que con ADMIN_KEY.
const ADMIN_PATH = process.env.ADMIN_PATH || '/admin';
const CARTELES_PATH = process.env.CARTELES_PATH || '/carteles-preview.html';
// Secreto del stress test: permite entrar GRATIS a salas de pago (jugadores
// marcados como tester, fuera de las stats). Sin definir = modo tester apagado.
// Nunca una constante en el código: eso sería una puerta trasera pública.
const STRESS_KEY = process.env.STRESS_KEY || '';
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS, 10) || 5;    // reales para empezar (editable por sala desde el panel)
// Población objetivo (reales + bots de relleno). 0 = SIN bots de relleno: online
// solo tiene jugadores reales. Editable por sala desde el panel si se quieren bots.
const TARGET_POP = process.env.TARGET_POP != null ? parseInt(process.env.TARGET_POP, 10) : 0;
const MATCH_MS = parseInt(process.env.MATCH_MS, 10) || (3 * 60 * 1000 + 50 * 1000);
/*
 * Duración de una partida de CLASSIC. Antes classic no acababa nunca.
 *
 * El motivo no es de diseño de juego, es económico: el precio de entrada se
 * congela cuando entra el primero a la sala, y sin final de partida esa sala
 * podía pasarse horas con el precio de por la mañana. Con el token moviéndose,
 * la barrera de entrada dejaba de ser la misma para todos.
 *
 * No vale con refrescar el precio a media partida: en classic te llevas el
 * carry del que matas, así que si el de al lado entró a otro precio, matarle
 * renta distinto que matarte a ti. El intercambio deja de ser simétrico. La
 * única forma de que todos jueguen al mismo precio es que la partida termine y
 * empiece de nuevo para todos a la vez.
 */
// Suelo de 10 s (no de minutos) para poder probar el final de partida sin
// esperar cuartos de hora. Nadie pondría 10 s en producción por accidente.
const CLASSIC_MATCH_MS = Math.max(10000, parseInt(process.env.CLASSIC_MATCH_MS, 10) || 15 * 60 * 1000);
const GLOBAL_FILE = path.join(__dirname, 'globalsettings.json');
let _glob = loadJson(GLOBAL_FILE, {});
let arcadeRestartMs = Math.max(1000, (_glob.arcadeRestartMs | 0) || 10000);
let arcadeLobbyMs  = Math.max(0,    (_glob.arcadeLobbyMs  | 0) || 20000);
// Volumen "por defecto" que el servidor manda al cliente (0..1). El cliente lo aplica
// como master (efectos -30%, música -15% de fábrica) y luego puede mutear/ajustar.
// Editable desde el panel admin.
const _clamp01 = v => Math.max(0, Math.min(1, v));
let sfxVol   = (typeof _glob.sfxVol   === 'number') ? _clamp01(_glob.sfxVol)   : 0.70;
let musicVol = (typeof _glob.musicVol === 'number') ? _clamp01(_glob.musicVol) : 0.85;
// Animaciones/efectos de los DEMÁS jugadores (global). false = todos los clientes
// dejan de dibujar FX de enemigos (alivia carga). La tuya siempre se dibuja.
let enemyFx  = (typeof _glob.enemyFx  === 'boolean') ? _glob.enemyFx : true;
// Zoom base GLOBAL del juego (todos los jugadores). Es el zoom al spawnear (r=INITIAL_RADIUS);
// el cliente lo aleja al crecer con su curva. Editable en vivo desde admin. Mayor = más cerca.
const _clampZoom = v => Math.max(0.3, Math.min(4, v));
let baseZoom = (typeof _glob.baseZoom === 'number') ? _clampZoom(_glob.baseZoom) : 1.4;
// Exponente de la curva de zoom (cuanto se aleja la camara al crecer, r^exp —
// menor = zoom-out mas lento). Editable en vivo desde admin junto al zoom
// base; el AOI (mas abajo) usa el MISMO valor para replicar la caja visible
// del cliente, así que un desajuste aquí abre pop-in o maphack parcial.
const _clampZoomExp = v => Math.max(0.05, Math.min(0.6, v));
let zoomExp = (typeof _glob.zoomExp === 'number') ? _clampZoomExp(_glob.zoomExp) : 0.22;
// Sombreado de la pildora grande (PIX_BAND_REF/PIX_BAND_SLOW en game/index.html
// y en el hero de la landing): hasta que ancho logico las bandas crecen a ritmo
// normal, y a que ritmo lo hacen por encima. Editable en vivo desde admin, igual
// que el zoom. Solo llega a la GAME (game/index.html); el hero de la landing es
// estatico y no tiene canal en vivo con el servidor, se queda con el default.
const _clampPillBandRef = v => Math.max(6, Math.min(64, v));
let pillBandRef = (typeof _glob.pillBandRef === 'number') ? _clampPillBandRef(_glob.pillBandRef) : 24;
const _clampPillBandSlow = v => Math.max(0.05, Math.min(1, v));
let pillBandSlow = (typeof _glob.pillBandSlow === 'number') ? _clampPillBandSlow(_glob.pillBandSlow) : 0.40;
// Decoracion cosmetica del fondo del menu (food/virus flotando + bob de la
// pildora/carteles + tamano de celda de la rejilla): editable en vivo desde
// admin, el cliente los lee de /api/rooms (mismo canal que sfxVol/baseZoom
// de arriba) porque el menu ya hace polling ahi para el ORACLE de salas.
const _clampN = (v, lo, hi, def) => (typeof v === 'number' && !isNaN(v)) ? Math.max(lo, Math.min(hi, v)) : def;
let menuDecoFoodDensity = _clampN(_glob.menuDecoFoodDensity, 0, 150, 16);
let menuDecoVirusCount = _clampN(_glob.menuDecoVirusCount, 1, 10, 3);
let menuDecoPillBobPx = _clampN(_glob.menuDecoPillBobPx, 0, 12, 3);
let menuDecoCartelBobPx = _clampN(_glob.menuDecoCartelBobPx, 0, 12, 3);
let menuDecoGridSize = _clampN(_glob.menuDecoGridSize, 8, 40, 24);
// Intensidad de los glows del menu, en % del valor de diseno (100 = tal cual,
// 0 = apagado). Dos por separado: el del selector manda en el titulo
// ARCADE/CLASSIC y su rotulo; el del blurb, en el subtitulo de dentro del menu.
let menuDecoSelectorGlowPct = _clampN(_glob.menuDecoSelectorGlowPct, 0, 300, 100);
let menuDecoBlurbGlowPct = _clampN(_glob.menuDecoBlurbGlowPct, 0, 300, 100);
let menuDecoVirusTP = (typeof _glob.menuDecoVirusTP === 'boolean') ? _glob.menuDecoVirusTP : false;
// Estilo del cartel del menú. 1 = placa pixel (marco dibujado a la escala del
// fondo, carteles quietos, PLAY/SETTINGS dibujados). 2 = la configuración
// ANTERIOR, guardada por si se quiere recuperar: piedra con el vídeo del fuego,
// balanceo y botones desde los PNG.
let menuCartelStyle = (_glob.menuCartelStyle === 2) ? 2 : 1;
let menuDecoDimPct = _clampN(_glob.menuDecoDimPct, 0, 80, 0);
// Layout del menú (posición/escala de cada elemento editable), GLOBAL: lo sube el
// cliente desde EDIT LAYOUT → "Guardar para todos", se difunde en /api/rooms.
let menuLayout = (_glob.menuLayout && typeof _glob.menuLayout === 'object') ? _glob.menuLayout : {};
// Ajuste del ROTULO del menu (alto de cada palabra, hueco entre las dos, cuanto
// sube/baja y el halo). Va APARTE de menuLayout porque el rotulo horneado no se
// coloca con translate/scale como el resto: se centra solo y su tamaño sale de
// las variables --titulo-*, asi que sus numeros no son {x,y,s} y no caben en el
// saneado de menuLayout. Antes solo vivia en el localStorage de cada uno: lo
// ajustabas y el resto del mundo seguia viendo el de fabrica.
let menuTitulo = (_glob.menuTitulo && typeof _glob.menuTitulo === 'object') ? _glob.menuTitulo : {};
// Lo mismo para el HERO de la landing (título, PLAY NOW, cartel del contrato y
// contrato): lo sube el botón EDIT de index.html. Va APARTE de menuLayout para
// que las dos herramientas no se pisen la una a la otra.
let landingLayout = (_glob.landingLayout && typeof _glob.landingLayout === 'object') ? _glob.landingLayout : {};
// Espaciado afinado de los carteles/pop-ups del juego (lo sube carteles-preview.html).
// Vive AQUI y no en game/carteles-layout.json porque ese fichero es del repo y
// deploy/update.sh hace `git reset --hard`: cada actualización del juego borraba
// lo editado en producción. globalsettings.json está en .gitignore, así que
// sobrevive. El JSON del repo se queda como valores de fábrica y esto se aplica
// encima (ver game/carteles-layout.js).
let cartelesLayout = (_glob.cartelesLayout && typeof _glob.cartelesLayout === 'object') ? _glob.cartelesLayout : {};
// Interruptor de los DOS editores de layout (botón EDIT de la landing y
// SETTINGS → EDIT LAYOUT del juego). Apagado = ni siquiera aparecen los botones:
// el diseño ya está fijado en el código de cada página. Se enciende desde el
// panel admin cuando haya que retocarlo.
let layoutEdit = (typeof _glob.layoutEdit === 'boolean') ? _glob.layoutEdit : false;
// Si el ranking cuenta a los testers/bots. Se guarda porque el ranking se
// RECALCULA SOLO al arrancar (ver computeRanking mas abajo) y hay que saber con
// que criterio hacerlo; si no, cada reinicio lo dejaba en el de por defecto.
let rankingIncludeTesters = (typeof _glob.rankingIncludeTesters === 'boolean') ? _glob.rankingIncludeTesters : false;
function saveGlobal() { fs.writeFile(GLOBAL_FILE, JSON.stringify({ arcadeRestartMs, arcadeLobbyMs, sfxVol, musicVol, enemyFx, baseZoom, zoomExp, pillBandRef, pillBandSlow, menuDecoFoodDensity, menuDecoVirusCount, menuDecoPillBobPx, menuDecoCartelBobPx, menuDecoGridSize, menuDecoVirusTP, menuDecoDimPct, menuDecoSelectorGlowPct, menuDecoBlurbGlowPct, menuCartelStyle, layoutEdit, rankingIncludeTesters, menuLayout, menuTitulo, landingLayout, cartelesLayout, pillPerDollar: _glob.pillPerDollar, pillUsd: _glob.pillUsd }), () => {}); }
const TICK_MS = 25;            // 40 Hz de simulación
const TICK_HZ = Math.round(1000 / TICK_MS);   // 40
// Frecuencia de snapshots (global, no por sala). Editable en vivo desde el panel.
// Menos Hz = menos tráfico y menos carga → más capacidad, a costa de algo de fluidez
// (el cliente interpola). Default por env SNAPSHOT_HZ (40 si no se define).
function hzToEvery(hz) { return Math.max(1, Math.min(TICK_HZ, Math.round(TICK_HZ / Math.max(1, hz)))); }
let SNAPSHOT_EVERY = hzToEvery(parseInt(process.env.SNAPSHOT_HZ, 10) || TICK_HZ);
const EMPTY_ROOM_TTL = 60000;
const RESUME_GRACE_MS = 30000;   // ventana para hacer REJOIN tras desconexión accidental
// Si una sala persistente se queda VACÍA en 'playing'/'ended', se resetea a 'waiting'
// tras este grace (mayor que la ventana de rejoin para no cortar reconexiones). Evita
// que una sala se cuelgue en plena partida cuando todos se van (no terminaba ni
// dejaba entrar).
const EMPTY_RESET_MS = 33000;
// Arcade en juego con MENOS de este nº de jugadores reales → la partida se acorta
// para terminar en 30s (se recicla la sala rápido en vez de seguir medio vacía).
const ARCADE_KEEP_MIN = 5;
const ARCADE_SHORTEN_MS = 30000;
const DEAD_REMOVE_MS = 3000;   // tras morir, retirar al jugador de la sim
// Rate-limit por conexión (anti-flood/DoS). Un cliente real manda ~30-40 msg/s
// (input 30 Hz + pings); dejamos margen de sobra. Por encima del umbral suave se
// descartan los mensajes; un flood evidente (umbral duro) cierra la conexión.
const MSG_RATE_SOFT = parseInt(process.env.MSG_RATE_SOFT, 10) || 100;   // msg/s: descarta el exceso
// Sube de 400 a 800: bajo microlag del servidor el cliente acumula inputs y los
// suelta en ráfaga al desatascarse el WAN; 400 nos hacía cerrar bots legítimos.
// Un flood real es 10x esto: 800 sigue siendo barrera anti-DDoS sin falsos positivos.
const MSG_RATE_HARD = parseInt(process.env.MSG_RATE_HARD, 10) || 800;
// Backpressure WebSocket: si un cliente lento ya tiene >N bytes sin enviar en su
// buffer, dejamos de mandarle snapshots hasta que se vacíe. Sin esto, los clientes
// con red mala arrastran al servidor entero (cola del event loop crece sin parar).
// 64KB ≈ 1-2 snapshots binarios típicos: estricto pero evita el pile-up que veíamos
// con 256KB (el cliente lento se llenaba rápido y nunca llegábamos a cortarlo).
const WS_BACKPRESSURE_MAX = parseInt(process.env.WS_BACKPRESSURE_MAX, 10) || (64 * 1024);
// Inmunidad al spawn (ms). Ahora el spawn ocurre cuando el cliente manda 'ready'
// (al terminar su carga), así que esto es PURA gracia de juego: el tiempo que tienes
// inmune nada más entrar para coger skill y posicionarte. No cubre carga ni
// matchmaking (eso ya pasó antes del spawn).
const SPAWN_IMMUNE_MS = 3000;
const LOG_FILE = path.join(__dirname, 'connections.log');
const STATS_FILE = path.join(__dirname, 'stats.json');
const RULES_FILE = path.join(__dirname, 'roomrules.json');

const PRICES = ['Free', '2$', '5$', '10$', '20$'];
const CATALOG_MODES = ['classic', 'arcade'];

// Reparto de combos entre hosts (Fase 4). En 'mono' este proceso es dueño de TODOS
// los combos; en 'host' solo de los que le asigna el shard-map (combo→hostId). El
// matchmaker del Director usará el mismo mapa para enrutar al cliente al host correcto.
// HOSTASSIGN_FILE: asignación manual opcional desde el panel (director → host N).
// La leen TODOS los procesos (director y cada host forkeado) al arrancar, así que
// cambiarla requiere reiniciar el servidor para que los hosts reforkeados la recojan.
const HOSTASSIGN_FILE = path.join(__dirname, 'hostassign.json');
function loadHostAssign() { return loadJson(HOSTASSIGN_FILE, null); }
const _hostAssignHostCount = PW_ROLE === 'mono' ? 1 : PW_HOST_COUNT;
const SHARD = applyOverrides(
    buildShardMap(CATALOG_MODES, PRICES, _hostAssignHostCount),
    loadHostAssign(),
    _hostAssignHostCount
);
const MY_HOST_ID = PW_ROLE === 'mono' ? 0 : PW_HOST_ID;
function ownsCombo(mode, price) {
    // El Director no posee NINGÚN combo: sus salas viven en los hosts forkeados.
    // Sin esto, /api/rooms (pickLayer) le hacía lazy-create de salas propias.
    if (PW_ROLE === 'director') return false;
    return SHARD.comboToHost.get(mode + '_' + price) === MY_HOST_ID;
}

// --- Rol 'director': forkea los N hosts (un binario, dos roles) ---
// Cada host es este MISMO index.js con PW_ROLE=host y su propio puerto de escucha
// (PORT+1+id). El canal IPC de fork() queda listo para el dinero (4a.4.3). Si un
// host muere, se reforkea tras 1s: sus combos quedan sin servicio ese intervalo
// (/match responde 503 → el cliente reintenta) en vez de colgar al Director.
const hostProcs = new Map();   // hostId → { id, port, child, ipc, alive }
let _roomsCache = null;        // cache 1s del /api/rooms agregado (rol director, 4b)
function hostPortOf(hostId) { return PORT + 1 + hostId; }
let _shuttingDown = false;
function spawnHost(hostId) {
    const port = hostPortOf(hostId);
    const child = fork(__filename, [], {
        env: Object.assign({}, process.env, {
            PW_ROLE: 'host',
            PW_HOST_ID: String(hostId),
            PW_HOST_COUNT: String(PW_HOST_COUNT),
            PORT: String(port),
        }),
    });
    const ipc = createIpc(child, { label: `director→host${hostId}` });
    const entry = { id: hostId, port, child, ipc, alive: true };
    hostProcs.set(hostId, entry);
    registerHostHandlers(entry);
    child.on('exit', (code, signal) => {
        entry.alive = false;
        ipc.failAll(`host ${hostId} murió (code=${code} signal=${signal})`);
        if (_shuttingDown) return;
        log(`Host ${hostId} (puerto ${port}) murió (code=${code}) — refork en 1s`);
        setTimeout(() => { if (!_shuttingDown && hostProcs.get(hostId) === entry) spawnHost(hostId); }, 1000);
    });
    log(`Host ${hostId} forkeado → puerto ${port} (combos: ${SHARD.hostToCombos.get(hostId).join(', ')})`);
    return entry;
}
function killHosts() {
    _shuttingDown = true;
    for (const h of hostProcs.values()) { try { h.child.kill(); } catch (e) {} }
}
// Fase 4b: el Director es la fuente de verdad de los "Ajustes" (volumen,
// animaciones, zoom, tiempos de arcade) — se guardan aquí y se empujan a TODOS
// los hosts por notify (fire-and-forget, no hace falta confirmación).
function pushSettingsToHosts() {
    const patch = { arcadeRestartMs, arcadeLobbyMs, sfxVol, musicVol, enemyFx, baseZoom, zoomExp, pillBandRef, pillBandSlow,
        menuDecoFoodDensity, menuDecoVirusCount, menuDecoPillBobPx, menuDecoCartelBobPx, menuDecoGridSize, menuDecoVirusTP, menuDecoDimPct, menuDecoSelectorGlowPct, menuDecoBlurbGlowPct, menuCartelStyle, layoutEdit };
    for (const h of hostProcs.values()) { if (h.alive) h.ipc.notify('settingsSync', patch); }
}
// "Rendimiento" SÍ admite override por host (comparar Hz/AOI entre los dos).
// hostIds opcional: si no se manda (o viene vacío), afecta a TODOS.
// Devuelve [{hostId, ok, reason?}].
async function pushPerfToHosts(hostIds, patch) {
    const ids = (Array.isArray(hostIds) && hostIds.length) ? hostIds : [...hostProcs.keys()];
    return Promise.all(ids.map(async (id) => {
        const h = hostProcs.get(id);
        if (!h || !h.alive) return { hostId: id, ok: false, reason: 'host no disponible' };
        try { const r = await h.ipc.request('perfSync', patch); return Object.assign({ hostId: id }, r); }
        catch (e) { return { hostId: id, ok: false, reason: String(e && e.message || e) }; }
    }));
}
// Tope de jugadores reales por sala, por modo. Se fija en el arranque para TODAS
// las salas del catálogo (enforceRoomCaps), así queda en código y llega al VPS por
// git (roomrules.json es gitignored y no se despliega). Editable en vivo desde el
// panel; se reaplica esta política en cada reinicio.
const ROOM_CAPS = { classic: 35, arcade: 25 };
// Layers por combo (mode × price). Cada combo tiene N instancias paralelas:
// el matchmaker (pickLayer) te mete en L1 hasta LLENARLA (clients.size >= maxPlayers),
// y solo entonces pasa a L2. NO hay umbral del 90%: es 100% estricto. Las layers
// SON INVISIBLES para el cliente: solo ve "Free", "5$", etc. — el server decide.
// MAX_LAYERS: tope duro de layers por combo. Siempre desbloqueadas las 4 — L1 se
// pre-crea al arrancar, L2+ se crean on-demand en pickLayer cuando la anterior se
// llena (ver game-host.js). No consumen nada mientras no exista demanda real.
const MAX_LAYERS = 4;
const LAYERS_PER_COMBO = MAX_LAYERS;
function comboKeyOf(mode, roomName) { return mode + '_' + roomName; }
function layerKeyOf(mode, roomName, layerIdx) { return mode + '_' + roomName + '_L' + layerIdx; }
// Habilitado por combo+layer (persistido en layerassign.json). Ausente = default:
// L1/L2 encendidas (comportamiento de siempre), L3/L4 apagadas hasta que se activen
// a mano — así "+ Add layer" no enciende de golpe 10 combos nuevos sin querer.
const LAYERASSIGN_FILE = path.join(__dirname, 'layerassign.json');
let layerEnabled = loadJson(LAYERASSIGN_FILE, {});
// Síncrono a propósito: el panel del Director relee este fichero en cada poll,
// así una lectura inmediata tras el cambio no ve estado viejo (evita parpadeo).
function saveLayerEnabled() { try { fs.writeFileSync(LAYERASSIGN_FILE, JSON.stringify(layerEnabled)); } catch (e) {} }
function isLayerEnabled(mode, price, layerIdx) {
    const lk = layerKeyOf(mode, price, layerIdx);
    return Object.prototype.hasOwnProperty.call(layerEnabled, lk) ? layerEnabled[lk] !== false : layerIdx <= 2;
}
function enabledLayerCount(mode, price) {
    let n = 0;
    for (let i = 1; i <= LAYERS_PER_COMBO; i++) if (isLayerEnabled(mode, price, i)) n++;
    return n;
}

const rooms = new Map();   // layerKey → room
// IPs echadas por admin: ip → timestamp expiración. Mientras esté >now, la IP
// no puede entrar a ninguna sala (ve kickedWait). Se limpia automáticamente al
// expirar en el chequeo de join (sin GC explícito, no crece sin control).
const kickedIps = new Map();
const KICKED_MS = 30000;
const resumeTokens = new Map();   // token → { roomKey: layerKey, playerId }

// %CPU del propio servidor, muestreado cada segundo (expuesto en admin/health).
let serverCpuPct = 0; let _cpuLast = process.cpuUsage(); let _cpuLastT = Date.now();
// Egress WS del proceso: cada socket suma sus bytes salientes en _netBytes (ver
// el wrap de ws.send en la conexión); aquí se muestrea a KB/s en ventanas de 1s.
// Alimenta la tarjeta de monitorización del panel Rendimiento (por HOST, no por sala).
let _netBytes = 0;
let netKBs = 0;
setInterval(() => {
    const u = process.cpuUsage(_cpuLast); const dt = Date.now() - _cpuLastT;
    _cpuLast = process.cpuUsage(); _cpuLastT = Date.now();
    serverCpuPct = dt > 0 ? Math.round((u.user + u.system) / 1000 / dt * 100) : 0;
    netKBs = Math.round(_netBytes / 1024);
    _netBytes = 0;
}, 1000);
const adminFails = new Map();     // ip → { c: intentos, until: timestamp bloqueo }
const specTokens = new Map();     // token → expira_en (timestamp ms)
// Comandos permitidos con token de espectador (los que usa la vista spectate del juego).
const SPEC_TOKEN_CMDS = new Set(['state', 'kick', 'power', 'restart', 'kickAll', 'shutdown']);
setInterval(() => {                // limpieza periódica de tokens caducados
    const now = Date.now();
    for (const [k, exp] of specTokens) if (exp <= now) specTokens.delete(k);
    for (const [ip, fb] of adminFails) if (fb.until && fb.until <= now) adminFails.delete(ip);
}, 60000);

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args); }
function priceOf(roomName) { const m = String(roomName).match(/(\d+)\s*\$/); return m ? parseInt(m[1], 10) : 0; }

// --- Persistencia simple (historial, stats, reglas) ---
function loadJson(file, fallback) { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {} return fallback; }
const CONNLOG_MAX_RAM = 2000;
let connLog = [];
try { if (fs.existsSync(LOG_FILE)) connLog = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).slice(-CONNLOG_MAX_RAM); } catch (e) {}
// porPaisMap: { countryCode → { code, name, ips: Set<ip> } } — se mantiene incremental en logConnection.
// Se popula desde connLog al arrancar (ya trimado) y desde geoOf (que usa el caché geo.json).
const porPaisMap = {};
function logConnection(entry) {
    connLog.push(entry);
    if (connLog.length > CONNLOG_MAX_RAM) connLog = connLog.slice(-CONNLOG_MAX_RAM);
    fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', () => {});
    const g = geoOf(entry.ip);
    if (!porPaisMap[g.code]) porPaisMap[g.code] = { code: g.code, name: g.name, ips: new Set() };
    porPaisMap[g.code].ips.add(entry.ip);
}

// Log de transacciones de dinero (entradas pagadas, cashouts, premios, depósitos,
// retiros). RAM (cap 500) + fichero, mismo patrón que adminLog. Vive donde vive el
// warbank (mono/director): los hosts no mueven dinero directamente.
const TXLOG_FILE = path.join(__dirname, 'transactions.log');
let txLog = [];
try { if (fs.existsSync(TXLOG_FILE)) txLog = fs.readFileSync(TXLOG_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).slice(-500); } catch (e) {}
/*
 * `sig` es la firma de Solana, ENTERA y en su propio campo.
 *
 * Antes iba recortada dentro del texto ("tx 5A6fb14s…"): servia para mirar pero no
 * para buscar. Si alguien reclama un pago, con ocho caracteres no se encuentra nada
 * — ni en el explorador ni aqui. Con la firma completa, una busqueda en el panel
 * responde "esto se pago, aqui esta la transaccion".
 */
function logTx(type, wallet, amount, detail, sig) {
    const entry = { fecha: new Date().toISOString(), type, wallet: wallet || '-', amount: amount | 0, detail: detail || '' };
    if (sig) entry.sig = sig;
    txLog.push(entry);
    if (txLog.length > 500) txLog = txLog.slice(-500);
    fs.appendFile(TXLOG_FILE, JSON.stringify(entry) + '\n', () => {});
}

// Log de acciones de administración (god/masa/echar/reiniciar/...), por sala
const ADMINLOG_FILE = path.join(__dirname, 'adminlog.log');
let adminLog = [];
try { if (fs.existsSync(ADMINLOG_FILE)) adminLog = fs.readFileSync(ADMINLOG_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) {}
function logAdmin(sala, accion, objetivo) {
    const entry = { fecha: new Date().toISOString(), sala: sala || '-', accion, objetivo: objetivo || '' };
    adminLog.push(entry);
    if (adminLog.length > 1000) adminLog = adminLog.slice(-1000);
    fs.appendFile(ADMINLOG_FILE, JSON.stringify(entry) + '\n', () => {});
}

const PLAYERS_FILE = path.join(__dirname, 'players.json');
const roomStats = loadJson(STATS_FILE, {});     // roomKey → { entradas, muertes }
const roomRules = loadJson(RULES_FILE, {});     // roomKey → { speed, food, virus, botsEnabled, botCount }
const playerStats = loadJson(PLAYERS_FILE, {}); // nombre (minúsculas) → { name, partidas, kills, muertes, lastSeen, lastIp }
// Ranking cacheado: se calcula bajo demanda desde el panel (cmd updateRanking),
// no en cada poll de buildAdminState. Con 87k entradas, calcular en cada poll
// bloqueaba el main thread ~90ms — ahora es O(1) en cada poll.
let _rankingCache = [];
let _rankingUpdatedAt = 0;
let _rankingIncludesTesters = false;
function isBotIp(ip) { return ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || (!!ip && ip.startsWith('127.')); }
// Filtro e iteración en chunks de 1000 entries, cediendo el event loop entre cada trozo.
// El game tick (25ms) se cuela entre chunks — nunca se bloquea más de ~3ms de golpe.
function computeRanking(includeTesters) {
    _rankingIncludesTesters = includeTesters;
    const entries = Object.entries(playerStats);
    const filtered = [];
    let i = 0;
    function step() {
        const end = Math.min(i + 1000, entries.length);
        while (i < end) {
            const [key, p] = entries[i++];
            if (p.name && p.name.trim().length > 0 && (includeTesters || p.isReal === true)) filtered.push([key, p]);
        }
        if (i < entries.length) { setImmediate(step); return; }
        filtered.sort(([, a], [, b]) => (b.kills - a.kills) || (b.partidas - a.partidas));
        _rankingCache = filtered.slice(0, 500).map(([key, p]) => {
            const g = p.lastIp ? geoOf(p.lastIp) : { code: '??', name: 'Desconocido' };
            return Object.assign({}, p, { key, paisCode: g.code, paisName: g.name });
        });
        _rankingUpdatedAt = Date.now();
        log(`Ranking actualizado: ${_rankingCache.length} jugadores (${includeTesters ? 'con' : 'sin'} testers)`);
    }
    setImmediate(step);
}
// Se calcula SOLO al arrancar. El ranking vive en memoria (_rankingCache), asi
// que cada reinicio del proceso lo dejaba vacio y el Global Elite de la web
// aparecia en blanco hasta que alguien entraba al panel a pulsar "Actualizar
// ranking" — eso es lo que parecia que se reseteaba solo. Los datos nunca se
// pierden: viven en players.json, que si se guarda; lo unico que faltaba era
// rehacer el cache al arrancar. Con el mismo criterio de testers/bots que se
// eligio la ultima vez (rankingIncludeTesters, guardado en globalsettings).
// setImmediate para no retrasar el arranque: computeRanking ya va por chunks.
setImmediate(() => computeRanking(rankingIncludeTesters));
let statsDirty = false, rulesDirty = false, playersDirty = false;
function statsOf(key) { if (!roomStats[key]) roomStats[key] = { entradas: 0, muertes: 0, entradasReal: 0, muertesReal: 0 }; const s = roomStats[key]; if (s.entradasReal == null) { s.entradasReal = 0; s.muertesReal = 0; } return s; }
function rulesOf(key) {
    if (!roomRules[key]) roomRules[key] = { speed: 1, food: 1, virus: 1, botsEnabled: false, botCount: 20 };
    const r = roomRules[key];
    if (r.minReal == null) r.minReal = MIN_PLAYERS;
    if (r.targetPop == null) r.targetPop = TARGET_POP;
    // Tope de jugadores REALES por sala. Default por modo (ROOM_CAPS); enforceRoomCaps
    // lo reaplica en el arranque a todas las salas del catálogo.
    if (r.maxPlayers == null) r.maxPlayers = key.startsWith('classic') ? ROOM_CAPS.classic : ROOM_CAPS.arcade;
    // Cuenta atrás de lobby (ms) antes de empezar al alcanzar el mínimo de reales.
    // 0 = empezar al instante. Por defecto solo arcade espera 20s (es donde tiene
    // sentido: fin de partida → menú → cuenta atrás). Classic sigue al instante.
    return r;
}
function minRealOf(key) { return Math.max(1, rulesOf(key).minReal); }
function targetPopOf(key) { return Math.max(0, rulesOf(key).targetPop); }
function maxPlayersOf(key) { return Math.max(1, rulesOf(key).maxPlayers); }
function lobbyMsOf(key) { return /^arcade_/.test(key) ? arcadeLobbyMs : 0; }
// Tarifa de entrada en PILL = precio($) × PILL_PER_DOLLAR. (El precio real en $ vía
// oráculo es la Fase B4; por ahora una conversión fija.) Free = 0.
// Oráculo de precio: PILL por $1. Base fija, pero "deriva" cada 5 min ±15% para simular
// el precio vivo del token (en mainnet vendría de un feed real). El precio se BLOQUEA en
// la entrada (la firma incluye la tarifa exacta), así que cambiarlo NO afecta a quien ya
// está dentro: su carry está en PILL absolutos.
// Arranca con el ÚLTIMO precio bueno que se guardó (globalsettings.json), no con
// el de fábrica: así un reinicio con el feed caído no pone las salas a un precio
// inventado. Solo la primera vez de todas se usa PILL_PER_DOLLAR.
/*
 * PILL_PER_DOLLAR por entorno = PRECIO FIJO y oráculo APAGADO.
 *
 * Hacía falta por dos motivos. El primero, que sin esto los tests con dinero
 * eran imposibles: _smoke-e2e-pay fija el rate a 10.000 y firma un pago de
 * 50.000 PILL, pero el oráculo lo pisaba con el precio real de PUMP al
 * arrancar y la firma dejaba de cuadrar ("firma de pago inválida"). El segundo,
 * que si un día el feed hace algo raro, esto es el interruptor para clavar el
 * precio sin desplegar código.
 *
 * Sin esta variable manda el oráculo, arrancando con el último precio bueno
 * guardado (globalsettings.json) y no con el de fábrica: así un reinicio con el
 * feed caído no pone las salas a un precio inventado.
 */
const PILL_FIJO = parseInt(process.env.PILL_PER_DOLLAR, 10) || 0;
const PILL_PER_DOLLAR_BASE = PILL_FIJO || 10000;
let PILL_PER_DOLLAR = PILL_FIJO || ((_glob.pillPerDollar > 0) ? _glob.pillPerDollar : PILL_PER_DOLLAR_BASE);
// 1 min: una altcoin de 50k-1M de capitalización se mueve mucho más que SOL, y
// re-precificar cada 5 min dejaba las salas con un precio viejo. DexScreener
// aguanta este ritmo de sobra (ver abajo); CoinGecko no lo habría aguantado.
/*
 * 5s (antes 60). Cachear lento NO protege del pumpeo: no promedia nada, solo
 * mantiene viva una lectura — si esa lectura pilla un pico, el precio falso se
 * queda congelado el minuto entero y todas las salas que se abran mientras lo
 * cogen. Leyendo cada 5s, un precio manipulado dura lo que el atacante lo
 * sostenga y nada mas. (Lo que SI amortiguaria de verdad es promediar varias
 * lecturas, un TWAP, y eso es otra cosa.)
 * Suelta 12 peticiones por minuto a DexScreener, muy por debajo de su limite.
 */
const ORACLE_REFRESH_MS = Math.max(3000, parseInt(process.env.ORACLE_REFRESH_MS, 10) || 5 * 1000);
// Y el momento exacto de cada lectura se mueve +-40%: con un intervalo clavado
// se puede predecir el instante que hay que atacar, aunque la ventana sea corta.
function proximaLectura() { return Math.round(ORACLE_REFRESH_MS * (0.6 + Math.random() * 0.8)); }
/*
 * El oráculo sigue un precio REAL, sin nada aleatorio: el de PUMP (el token de
 * pump.fun), tratado como si fuera el de $PILL.
 *
 * FUENTE: DexScreener, por el mint del token. No CoinGecko, por dos razones que
 * importan justo para el caso real:
 *   1. CoinGecko NO lista tokens de 50k-1M de capitalización. El día que salga
 *      $PILL no estaría ahí, así que el ensayo no valdría de nada. DexScreener
 *      indexa cualquier par de un DEX en cuanto existe.
 *   2. Su API pública no está pensada para una llamada por minuto (~43.000 al
 *      mes); DexScreener permite 300 por minuto en este endpoint.
 * Es además la misma fuente que ya usa la landing para el precio del token.
 *
 * PUMP y no SOL porque $PILL se creará en pump.fun: mismo tipo de token y mismo
 * orden de magnitud (~$0.0045 ⇒ ~223 PILL por dólar, salas de 1.100 a 11.000
 * PILL). Con SOL el rate se iba a ~9 PILL/$, que no se parecía a nada real.
 *
 * El día que $PILL cotice es cambiar ORACLE_TOKEN por su mint y ya: el bloqueo
 * de precio por sala, el reparto por IPC, el redondeo de la tarifa y el aguante
 * ante un feed caído ya estarán rodados.
 *
 * ORACLE_DIVISOR queda por si hiciera falta reescalar (1 = precio tal cual).
 */
const ORACLE_TOKEN = process.env.ORACLE_TOKEN || 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
const ORACLE_DIVISOR = Number(process.env.ORACLE_DIVISOR) || 1;
const ORACLE_URL = process.env.ORACLE_URL
    || 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(ORACLE_TOKEN);
let _oracleUltimoOk = 0;   // cuándo se logró leer el precio por última vez
let _oraclePillUsd = (_glob.pillUsd > 0) ? _glob.pillUsd : 0;   // $ por 1 PILL (para la UI)
// Cuándo toca el PRÓXIMO refresco, en tiempo absoluto. Se manda al cliente para
// que su cuenta atrás sea la de verdad: antes el cliente se ponía 5:00 al cargar
// la página, así que un F5 la reiniciaba y podía decir "faltan 4:59" cuando el
// servidor iba a actualizar en 10 segundos. Absoluto y no "segundos que faltan"
// a propósito: /api/rooms va cacheado, y un timestamp aguanta la caché bien.
let _oracleNextAt = Date.now() + ORACLE_REFRESH_MS;

// Precio de referencia en $, o null si el feed no contesta. Nunca lanza: un
// oráculo que revienta no debe tumbar el tick del servidor.
async function precioReferencia() {
    try {
        const r = await fetch(ORACLE_URL, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const pares = Array.isArray(j && j.pairs) ? j.pairs : [];
        if (!pares.length) throw new Error('sin pares para ' + ORACLE_TOKEN);
        // Se coge el par con MÁS LIQUIDEZ, no el primero que devuelva la API.
        // Un token suele tener decenas de pares y los de poca liquidez son
        // precisamente los que se mueven con cuatro duros: tomar uno de esos
        // sería regalarle a cualquiera la posibilidad de mover el precio de las
        // salas. Es el riesgo de "oráculo manipulable" del BLOCKCHAIN-PLAN.
        let mejor = null;
        for (const p of pares) {
            const usd = Number(p && p.priceUsd), liq = Number(p && p.liquidity && p.liquidity.usd) || 0;
            if (!(usd > 0) || !isFinite(usd)) continue;
            if (!mejor || liq > mejor.liq) mejor = { usd, liq, dex: p.dexId, par: (p.baseToken && p.baseToken.symbol) + '/' + (p.quoteToken && p.quoteToken.symbol) };
        }
        if (!mejor) throw new Error('ningún par con precio válido');
        _oracleParInfo = `${mejor.par} en ${mejor.dex} (liquidez $${Math.round(mejor.liq).toLocaleString('es-ES')})`;
        return mejor.usd;
    } catch (e) { log(`Oráculo: no se pudo leer el precio (${e.message})`); return null; }
}
let _oracleParInfo = '';   // de qué par salió el último precio (para el log)

// PILL por $1, redondeado a 4 cifras significativas. NO a múltiplos de 1000
// como antes: con el precio de SOL/1000 el rate ronda las unidades, y redondear
// a millares lo dejaba en 0 (y de ahí al mínimo de 1, un precio inventado).
function redondeaRate(v) {
    if (!(v > 0) || !isFinite(v)) return null;
    const mag = Math.pow(10, Math.max(0, 3 - Math.floor(Math.log10(v))));
    return Math.max(1, Math.round(v * mag) / mag);
}

async function tickOracle() {
    const ref = await precioReferencia();
    if (ref == null) {
        // Sin precio nuevo se CONSERVA el último bueno. Volver al valor de
        // fábrica sería cambiar el precio de las salas por un fallo de red ajeno.
        const mins = _oracleUltimoOk ? Math.round((Date.now() - _oracleUltimoOk) / 60000) : -1;
        log(`Oráculo: mantengo $1 = ${PILL_PER_DOLLAR} PILL` + (mins >= 0 ? ` (último precio bueno hace ${mins} min)` : ' (AÚN SIN PRECIO REAL)'));
    } else {
        const precioPill = ref / ORACLE_DIVISOR;              // $ por PILL
        const rate = redondeaRate(1 / precioPill);            // PILL por $1
        if (rate) {
            PILL_PER_DOLLAR = rate;
            _oraclePillUsd = precioPill;
            _oracleUltimoOk = Date.now();
            // Se persiste para que un reinicio no vuelva al valor de fábrica: sin
            // esto, reiniciar con el feed caído dejaba las salas a un precio
            // inventado hasta que el feed volviera.
            if (_glob.pillPerDollar !== rate) {
                _glob.pillPerDollar = rate; _glob.pillUsd = precioPill; saveGlobal();
            }
            const div = ORACLE_DIVISOR !== 1 ? ` / ${ORACLE_DIVISOR}` : '';
            log(`Oráculo: 1 PILL = $${precioPill.toPrecision(4)}${div} ⇒ $1 = ${PILL_PER_DOLLAR} PILL  [${_oracleParInfo}]`);
        }
    }
    // Fase 4: los hosts cachean el rate (lo usan para bloquear el precio de sala
    // y calcular la tarifa); el oráculo SOLO se mueve aquí, en el Director.
    _oracleNextAt = Date.now() + ORACLE_REFRESH_MS;
    for (const h of hostProcs.values()) { if (h.alive) h.ipc.notify('oracleRate', { rate: PILL_PER_DOLLAR, nextAt: _oracleNextAt }); }
}
// En rol 'host' el oráculo NO se mueve por su cuenta: el rate llega por IPC
// (notify 'oracleRate') desde el Director. Dos relojes independientes harían
// que el fee firmado por el cliente no cuadrara con el del cobro.
if (PW_ROLE !== 'host' && !PILL_FIJO) {
    // Una lectura AL ARRANCAR: sin esto el servidor pasaba el primer minuto
    // con el valor de fábrica en vez de con el precio real.
    tickOracle().catch(() => {});
    // setTimeout encadenado y no setInterval: cada espera es distinta.
    (function otraVuelta() {
        setTimeout(() => { tickOracle().catch(() => {}); otraVuelta(); }, proximaLectura());
    })();
} else if (PILL_FIJO) {
    log(`Oráculo APAGADO por PILL_PER_DOLLAR=${PILL_FIJO}: precio fijo, no se consulta el feed.`);
}
// Quema del $PILL gastado en skins. Solo en el Director: los hosts no tocan
// economia, y dos procesos vaciando la misma cola quemarian dos veces.
if (PW_ROLE !== 'host') skinshop.arrancaQuemaPeriodica(solana, log, require('./treasury-client.js'), process.env.TREASURY_PROGRAM || '');
// Premios diarios de la tesorería: cierra el día, construye el árbol y publica la
// raíz. Solo en el Director, por lo mismo que la quema — dos procesos publicando la
// misma ronda serían dos transacciones, y la segunda fallaría con la época ya usada.
if (PW_ROLE !== 'host') rewards.arranca(solana, log);
// Anclaje de los recibos de partida. Solo el Director: dos procesos anclando el mismo
// lote lo escribirian dos veces en la cadena con hashes distintos.
if (PW_ROLE !== 'host') matches.arranca(solana, log);
// Prueba de pasivo: publica cada hora la lista de saldos y ancla su raiz. Es lo que
// impide que el servidor mienta sobre cuanto debe — ver server/reserves.js.
if (PW_ROLE !== 'host') reserves.arranca(() => warbank._balances, solana, log);
// Barrido del rake a sus dos bolsas. Solo el Director: dos procesos saldando la
// misma cola la barrerian dos veces.
/*
 * El barrido del rake a las bovedas queda apuntado con su firma. Es el dinero que
 * ENTRA: sin este registro, "la boveda tiene X" es un saldo del que no se sabe de
 * donde salio, y para justificar un ingreso habria que ir cruzando el explorador a
 * mano.
 */
if (PW_ROLE !== 'host') {
    rake.arranca(solana, require('./treasury-client.js'), process.env.TREASURY_PROGRAM || '', log,
        (destino, pill, sig) => logTx('vault', destino, pill, 'rake → ' + destino, sig));
}
// Tarifa con un rate dado (el de la sala si está bloqueado, o el global del oráculo).
// Math.round: la tarifa viaja DENTRO del mensaje que el jugador firma
// ("...paying 48 PILL @ ..."), y el servidor reconstruye esa misma cadena para
// validarla. Con el rate en millares daba igual, pero con un rate real y
// decimal (SOL/1000 ⇒ ~9.7) el producto sale en coma flotante
// (5 * 9.695 = 48.474999999999994) y basta el mínimo desajuste entre los dos
// lados para que la firma no cuadre y no se pueda entrar. En PILL enteros eso
// no puede pasar. El cliente redondea igual antes de firmar.
function entryFeePill(key, rate) { return Math.round(priceOf(key) * (rate || PILL_PER_DOLLAR)); }
// Rate "vigente" de una sala: si tiene gente jugando usa el bloqueado; si está vacía,
// el precio vivo del oráculo (lo que pagaría el próximo en entrar y fijar el precio).
function roomRate(room) { return (room && room.clients.size > 0 && room.pillRate) ? room.pillRate : PILL_PER_DOLLAR; }

// --- Economía B3 (custodiada): carry de classic + bote de arcade ---
// Exit fee de classic según killStreak al hacer cashout (50% sin kills, 20% con 1,
// 10% con 2+). Salir de vacío sale caro a propósito: el carry es la entrada de
// todos y largarse sin jugársela tiene que costar. Con 5 kills es VICTORY y no
// paga fee (ver room-loop). El cliente replica esta misma tabla en exitFeePct().
function classicExitFeePct(kills) { if (kills >= 2) return 10; if (kills >= 1) return 20; return 50; }

/*
 * Comisión de la casa sobre el bote de arcade, en %.
 *
 * Va a la TESORERÍA bloqueada, no al pozo del staking: lo que sale del bote de los
 * jugadores vuelve a los jugadores, solo que por la puerta de los premios diarios.
 * Los ingresos del juego (exit fees, tienda) son los que financian el staking.
 *
 * Hasta ahora los pesos del reparto sumaban 100 y no se quedaba nada; el único rake
 * de arcade era accidental — las partes de quien no tenía wallet, o los puestos
 * vacíos cuando había menos de diez jugadores.
 */
const ARCADE_RAKE_PCT = Math.max(0, Math.min(50, parseFloat(process.env.ARCADE_RAKE_PCT) || 5));
// Mueve `amount` PILL al "bote" interno de la sala (off-chain, en memoria).
function addToPot(room, amount) { if (amount > 0) room.pot = (room.pot || 0) + amount; }
// Notifica al cliente su carry actual y el bote de la sala (para el HUD del juego).
// `entry` = lo que pagó por entrar. El cliente lo necesita para el cartel GAME
// OVER de arcade ("YOU LOST <entrada>"): ahí no hay carry, lo que pierdes es la
// entrada que ya está en el bote.
// `rate` = PILL por $1 bloqueado en esta sala. El cliente lo necesita para pintar
// las cantidades en $ (el servidor sigue llevando toda la economía en PILL).
function sendEcon(cli, room) { if (cli && cli.ws && cli.ws.readyState === 1) try { cli.ws.send(JSON.stringify({ t: 'econ', carry: cli.carry | 0, pot: room.pot | 0, entry: cli.paidFee | 0, rate: roomRate(room) })); } catch (e) {} }
function pstatOf(name) {
    const k = String(name).toLowerCase();
    if (!playerStats[k]) playerStats[k] = { name: name, partidas: 0, kills: 0, muertes: 0, bestMass: 0, lastSeen: null, lastIp: null };
    if (playerStats[k].bestMass == null) playerStats[k].bestMass = 0;
    return playerStats[k];
}

// --- Quests + identidad anónima por clientId (UUID que el navegador guarda en localStorage) ---
const QUESTS_FILE = path.join(__dirname, 'quests.json');
const questsStore = loadJson(QUESTS_FILE, {});   // clientId → { v1: {...quests}, bestMass, updated }
let questsDirty = false;
function isValidClientId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id); }
function questsOf(clientId) {
    if (!questsStore[clientId]) questsStore[clientId] = {
        // Contadores por quest. quest 4 (mejor masa) se actualiza por separado.
        q1_games_finished: 0, q2_online_matches: 0, q3_skills_in_arcade: 0, q5_classic_survived: 0,
        bestMass: 0, updated: Date.now()
    };
    return questsStore[clientId];
}

// --- Faucet de testnet (devnet): claim diario de $PILL y SOL a la wallet ---
// Ambos son transferencias ON-CHAIN reales desde el treasury. Anti-abuso: 1 cada 24h
// por wallet Y por IP (el SOL sale de fondos reales del treasury). Persistimos el
// último claim por wallet/IP y kind en faucet.json.
const FAUCET_FILE = path.join(__dirname, 'faucet.json');
const faucet = loadJson(FAUCET_FILE, { wallets: {}, ips: {} });
let faucetDirty = false;
setInterval(() => { if (faucetDirty) { faucetDirty = false; fs.writeFile(FAUCET_FILE, JSON.stringify(faucet), () => {}); } }, 3000);
const CLAIM_PILL = 500000;         // $PILL por claim diario
const CLAIM_SOL = 0.005;           // SOL devnet por claim diario
const CLAIM_COOLDOWN_MS = 24 * 3600 * 1000;
// Devuelve ms que faltan para poder volver a reclamar `kind` (0 = disponible ya).
function claimCooldownLeft(wallet, ip, kind) {
    const now = Date.now();
    const last = Math.max(
        (faucet.wallets[wallet] && faucet.wallets[wallet][kind]) || 0,
        (faucet.ips[ip] && faucet.ips[ip][kind]) || 0
    );
    return Math.max(0, CLAIM_COOLDOWN_MS - (now - last));
}
function markClaim(wallet, ip, kind) {
    const now = Date.now();
    (faucet.wallets[wallet] || (faucet.wallets[wallet] = {}))[kind] = now;
    (faucet.ips[ip] || (faucet.ips[ip] = {}))[kind] = now;
    faucetDirty = true;
}

// Saves periódicos. JSON.stringify SIN pretty-print: el indent=1 multiplica tamaño
// y tiempo de serialización; estos archivos no se leen a mano en producción.
// Instrumentado: si un save bloquea >30ms se loguea — así diagnosticamos el lag.max.
function _t(label, fn) {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    if (dt > 30) console.log(`[slow-save] ${label}: ${dt.toFixed(1)}ms`);
}
setInterval(() => {
    if (statsDirty)   { statsDirty = false;   _t('stats',   () => fs.writeFile(STATS_FILE,   JSON.stringify(roomStats),  () => {})); }
    if (rulesDirty)   { rulesDirty = false;   _t('rules',   () => fs.writeFile(RULES_FILE,   JSON.stringify(roomRules),  () => {})); }
    // playerStats se guarda en su propio intervalo (2 min) y en shutdown — no aquí.
    if (geoDirty)     { geoDirty = false;     _t('geo',     () => fs.writeFile(GEO_FILE,     JSON.stringify(geoCache),    () => {})); }
    if (questsDirty) { questsDirty = false; _t('quests', () => fs.writeFile(QUESTS_FILE, JSON.stringify(questsStore), () => {})); }
}, 5000);

// playerStats: save en chunks de 1000 entries via setImmediate — el game tick
// nunca espera más de ~3ms entre trozos. Auto-save cada 2 min + shutdown.
function savePlayerStats(sync) {
    if (!playersDirty) return;
    playersDirty = false;
    if (sync) {
        // En shutdown el proceso va a salir — hacemos el save síncrono obligatoriamente.
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playerStats));
        return;
    }
    const entries = Object.entries(playerStats);
    const parts = [];
    let i = 0;
    function step() {
        const end = Math.min(i + 1000, entries.length);
        while (i < end) {
            const [k, v] = entries[i++];
            parts.push(JSON.stringify(k) + ':' + JSON.stringify(v));
        }
        if (i < entries.length) { setImmediate(step); return; }
        fs.writeFile(PLAYERS_FILE, '{' + parts.join(',') + '}', () => {});
    }
    setImmediate(step);
}
setInterval(savePlayerStats, 2 * 60 * 1000);
// Ranking automático cada 5 min (solo jugadores reales), también en chunks.
setInterval(() => computeRanking(false), 5 * 60 * 1000);
process.on('SIGTERM', () => { savePlayerStats(true); process.exit(0); });
process.on('SIGINT',  () => { savePlayerStats(true); process.exit(0); });
// BLINDAJE: un error puntual (p.ej. un ws.send sobre un socket roto durante un
// broadcast) NO debe tumbar el proceso entero — si lo hace, se caen TODAS las
// salas y todos los bots a la vez. Logueamos y seguimos.
process.on('uncaughtException', (e) => { try { log('uncaughtException: ' + (e && e.stack || e)); } catch (_) {} });
process.on('unhandledRejection', (e) => { try { log('unhandledRejection: ' + (e && e.stack || e)); } catch (_) {} });

function cleanIp(addr) { return String(addr || '?').replace(/^::ffff:/, '').replace(/^::1$/, 'localhost'); }
/*
 * IP real del cliente, a prueba de falsificación por cabecera.
 *
 * ANTES se leía `cf-connecting-ip` primero y, si no, el PRIMER valor de
 * x-forwarded-for. Las dos cosas las controla el cliente:
 *   - cf-connecting-ip la ponía Cloudflare, pero ya no usamos Cloudflare (se
 *     quitó al pasar a Caddy), así que hoy no la pone nadie de confianza.
 *   - x-forwarded-for es una LISTA y el proxy AÑADE al final; el principio es
 *     justo lo que el cliente haya inyectado.
 * Resultado: bastaba mandar `X-Forwarded-For: <lo que sea>` para saltarse el
 * rate-limit del RPC y, peor, el cooldown diario del faucet (farmeo infinito).
 *
 * Ahora se coge el ÚLTIMO salto de x-forwarded-for, que es el que añade nuestro
 * Caddy y el cliente no puede controlar. Con TRUST_PROXY=0 (servidor expuesto
 * directo, sin proxy delante) se ignora la cabecera entera.
 */
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
function clientIp(req) {
    if (TRUST_PROXY) {
        const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
        if (xff.length) return cleanIp(xff[xff.length - 1]);
    }
    return cleanIp(req.socket.remoteAddress);
}
// Anonimiza la IP (RGPD): IPv4 sin el último octeto, IPv6 solo el prefijo /48.
// Sigue valiendo para sacar el país y para distinguir redes, sin guardar la IP exacta.
function anonIp(ip) {
    if (!ip || ip === 'localhost' || ip === '?') return ip;
    if (ip.indexOf('.') >= 0) { const p = ip.split('.'); if (p.length === 4) { p[3] = '0'; return p.join('.'); } }
    else if (ip.indexOf(':') >= 0) { return ip.split(':').slice(0, 3).join(':') + '::'; }
    return ip;
}

// --- Retención de logs (RGPD): borrar conexiones y acciones de más de N días ---
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS, 10) || 60;
function purgeOldLogs() {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 86400000;
    const okFecha = e => { const t = new Date(e.fecha).getTime(); return isNaN(t) || t >= cutoff; };
    const c0 = connLog.length; connLog = connLog.filter(okFecha);
    if (connLog.length !== c0) fs.writeFile(LOG_FILE, connLog.map(e => JSON.stringify(e)).join('\n') + (connLog.length ? '\n' : ''), () => {});
    const a0 = adminLog.length; adminLog = adminLog.filter(okFecha);
    if (adminLog.length !== a0) fs.writeFile(ADMINLOG_FILE, adminLog.map(e => JSON.stringify(e)).join('\n') + (adminLog.length ? '\n' : ''), () => {});
}

// --- Geolocalización de IPs (caché persistente + ip-api.com) ---
const GEO_FILE = path.join(__dirname, 'geo.json');
const geoCache = loadJson(GEO_FILE, {});   // ip → { code, name }
let geoDirty = false;
const geoQueue = [];            // IPs pendientes de resolver, de una en una
const geoQueued = new Set();    // para no encolar la misma IP dos veces
const geoFailedAt = {};         // ip → timestamp del último fallo (enfriamiento)
const GEO_RETRY_MS = 10 * 60 * 1000;
function isPrivateIp(ip) {
    return ip === 'localhost' || ip === '?' || /^127\./.test(ip) || /^10\./.test(ip) ||
        /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^169\.254\./.test(ip) ||
        /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}
function geoOf(ip) {
    if (isPrivateIp(ip)) return { code: 'LOCAL', name: 'Red local' };
    if (geoCache[ip]) return geoCache[ip];
    // Resolución perezosa: se encola y la atiende el despachador de abajo
    const fallo = geoFailedAt[ip];
    if (!geoQueued.has(ip) && (!fallo || Date.now() - fallo > GEO_RETRY_MS)) {
        geoQueued.add(ip);
        geoQueue.push(ip);
    }
    return { code: '??', name: 'Desconocido' };
}
// Despachador: una consulta a ip-api cada 2 s como máximo (límite gratuito: 45/min)
setInterval(() => {
    const ip = geoQueue.shift();
    if (!ip) return;
    http.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode&lang=es`, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
            geoQueued.delete(ip);
            try {
                const j = JSON.parse(body);
                if (j.status === 'success') { geoCache[ip] = { code: j.countryCode, name: j.country }; geoDirty = true; return; }
            } catch (e) {}
            geoFailedAt[ip] = Date.now();
        });
    }).on('error', () => { geoQueued.delete(ip); geoFailedAt[ip] = Date.now(); });
}, 2000);

// Poblar porPaisMap desde el connLog ya cargado (trimado a CONNLOG_MAX_RAM entradas).
// geoOf usa el caché de geo.json así que la mayoría de IPs se resuelven al instante.
for (const c of connLog) {
    const g = geoOf(c.ip);
    if (!porPaisMap[g.code]) porPaisMap[g.code] = { code: g.code, name: g.name, ips: new Set() };
    porPaisMap[g.code].ips.add(c.ip);
}

// --- Salas ---
// buildSim, getOrCreateRoom, pickLayer e initLayers viven ahora en game-host.js
// (createGameHost). Se instancian como `gameHost` más abajo, con las deps de este
// módulo. El antiguo path de worker_threads (una sim por Worker) se eliminó: el
// paralelismo real viene del split multiproceso de la Fase 4 (Director + hosts).

// Interfaz `director`: lo que el GameHost necesita del Director (dinero + stats).
// El Host NO conoce warbank/pstatOf/statsOf; cuando un socket se va, calcula los
// datos autoritativos (wasAlive, kills, peak) desde SU sim y delega aquí toda la
// lógica económica. Desde 4a.4.3 los contratos son DATOS PLANOS (serializables):
// la misma llamada funciona local (mono) y por IPC (host→director). Esta lógica
// vive en `directorLocal`; en rol 'host' se sustituye por proxies IPC más abajo.
const directorLocal = {
    // Un jugador dejó la sala (cerró pestaña/socket). Aquí: peak mass, muertes
    // (pstat + combo), cashout classic y reembolso si la partida no había empezado.
    // Nota: el mensaje 'prize' del cashout ya no se envía — el socket acaba de
    // cerrarse (nunca llegaba: el send caía en el try/catch con el WS cerrado).
    onPlayerLeave(p) {
        if (p.wasAlive) {
            applyPeakMass(p.name, p.isTester, p.cid, p.peak);
            if (p.name && !p.isTester) { pstatOf(p.name).muertes++; playersDirty = true; }
            const ds_ = statsOf(p.comboKey); ds_.muertes++; if (!p.isTester) ds_.muertesReal++; statsDirty = true;
            // Cashout classic al salir vivo en plena partida: carry menos exit fee.
            // `enGracia`: se fue en plena partida con dinero encima. No se liquida
            // nada hasta que se cumpla el plazo de reconexion — si vuelve recupera su
            // posicion, y si no, va al pozo del staking (ver graceExpired).
            if (p.mode === 'classic' && p.carry > 0 && p.state === 'playing' && p.payWallet && !p.enGracia) {
                const fee = Math.floor(p.carry * classicExitFeePct(p.kills) / 100);
                const net = p.carry - fee;
                if (net > 0) { warbank.credit(p.payWallet, net); logTx('cashout', p.payWallet, net, p.comboKey); }
                // El exit fee es ingreso del juego → pozo del staking.
                if (fee > 0) rake.alStaking(fee, 'exit fee ' + p.comboKey);
                log(`Cashout classic: ${p.payWallet.slice(0, 6)}… +${net} PILL (carry ${p.carry}, fee ${fee} al staking)`);
                if (p.cid && p.kills >= 2) dailyquests.recordEvent(p.cid, 'classic_safe_exit', 1);
            }
        }
        // Reembolso de la entrada si la partida NO había empezado (paidFee>0 = no consumida).
        if (p.paidFee > 0 && p.payWallet && p.state === 'waiting') {
            warbank.credit(p.payWallet, p.paidFee);
            logTx('refund', p.payWallet, p.paidFee, p.comboKey + ' (match never started)');
            log(`Reembolso de entrada (sala no empezó): ${p.payWallet.slice(0, 6)}… +${p.paidFee} PILL`);
        }
    },

    // Devolución por partida ANULADA (el admin reinicia la sala en marcha): el
    // jugador recupera lo que llevaba encima (su carry, que arranca siendo su
    // entrada). Va por aquí y no por econ.credit para que quede en el log de
    // transacciones como 'refund'. Ver restartRoom() en game-host.js.
    refundEntry(p) {
        if (!p || !p.wallet || !(p.amount > 0)) return;
        warbank.credit(p.wallet, p.amount);
        logTx('refund', p.wallet, p.amount, (p.comboKey || '') + ' (room restarted)');
        log(`Reembolso por reinicio de sala: ${p.wallet.slice(0, 6)}… +${p.amount} PILL`);
    },

    // IP echada por admin en los últimos 30s → bloqueada para cualquier sala.
    // Devuelve {secondsLeft} si está bloqueada, o null.
    checkKick(ip) {
        const kickExp = kickedIps.get(ip);
        if (kickExp && kickExp > Date.now()) return { secondsLeft: Math.ceil((kickExp - Date.now()) / 1000) };
        return null;
    },

    // Precio BLOQUEADO por sala: si está vacía (primer jugador), fija el rate al del
    // oráculo actual; mientras haya gente, no cambia (todos pagan lo mismo).
    // El precio de una sala se congela cuando entra el PRIMERO y no se vuelve a
    // tocar hasta que la sala se vacia: asi todos los que estan dentro han pagado
    // lo mismo, aunque el oraculo se haya movido diez veces entre medias.
    //
    // _reserved cuenta a los que estan EN MITAD del cobro (hay un await entre
    // congelar el precio y registrarlos en clients). Sin mirarlo, dos jugadores
    // que entraran a la vez a una sala vacia veian los dos clients.size===0, y si
    // el oraculo cambiaba en ese hueco cada uno congelaba un precio distinto y
    // acababan pagando diferente en la MISMA sala. La ventana son milisegundos,
    // pero pasar el oraculo de 5 min a 1 min la hizo cinco veces mas probable.
    // El precio de una sala se congela cuando entra el PRIMERO y no se vuelve a
    // tocar hasta que la sala se vacía: así todos los de dentro han pagado lo
    // mismo, aunque el oráculo se haya movido entre medias. Refrescarlo con
    // gente dentro NO es una opción — en classic te llevas el carry del que
    // matas, así que si cada uno entró a un precio, matar a uno renta distinto
    // que a otro. Por eso classic tiene ahora final de partida
    // (CLASSIC_MATCH_MS): es lo que hace que todos vuelvan a empezar a la vez
    // al precio nuevo.
    //
    // _reserved cuenta a los que están EN MITAD del cobro (hay un await entre
    // congelar el precio y registrarlos en clients). Sin mirarlo, dos jugadores
    // que entraran a la vez a una sala vacía veían los dos clients.size===0, y
    // si el oráculo cambiaba en ese hueco cada uno congelaba un precio distinto.
    lockPriceIfEmpty(room) {
        if (room.clients.size === 0 && !(room._reserved > 0)) room.pillRate = PILL_PER_DOLLAR;
    },

    // Autoriza y COBRA la entrada. Salas gratis o testers pasan sin cobro. Salas de
    // pago exigen firma de wallet + saldo WAR. Si cobra, descuenta del saldo y marca
    // la firma (anti-replay). Devuelve {ok, payWallet, fee, tester} o
    // {ok:false, reason, balance} — el payRequired al cliente lo envía el CALLER
    // (game-host), que es quien tiene el ws. Frontera de deltas de la ENTRADA.
    // `fee` viene del Host (calculado con el rate BLOQUEADO de su sala); la firma
    // del cliente incluye ese fee exacto, así que un fee desalineado se rechaza.
    authorizeEntry({ comboKey, key, fee, pay, testerReq }) {
        // El modo tester (entrada GRATIS a salas de pago, para el stress test) va
        // contra un secreto de servidor, no contra una constante del código: antes
        // era la cadena fija 'STRESS_TEST_DEVNET', que cualquiera podía mandar en
        // su join y colarse gratis en cualquier sala de pago. Sin STRESS_KEY
        // definida no hay modo tester (y sigue exigiendo devnet, como antes).
        const tester = !!STRESS_KEY && testerReq === STRESS_KEY && /devnet/i.test(solana.RPC || '');
        if (fee > 0 && !tester) {
            pay = pay || {};
            const w = String(pay.wallet || ''), ts = Number(pay.ts) || 0;
            const expected = `PillWars enter ${comboKey} paying ${fee} PILL @ ${ts}`;
            const balance = isSolAddr(w) ? warbank.getBalance(w) : 0;
            if (!isSolAddr(w) || pay.message !== expected || Math.abs(Date.now() - ts) > 120000) return { ok: false, reason: 'invalid payment signature', balance };
            const sigKey = 'enter_' + (Array.isArray(pay.signature) ? pay.signature.join(',') : '');
            if (warbank.sigUsed(sigKey)) return { ok: false, reason: 'firma ya usada', balance };
            if (!solana.verifySignedMessage(w, pay.message, pay.signature)) return { ok: false, reason: 'invalid signature', balance };
            if (warbank.getBalance(w) < fee) return { ok: false, reason: 'saldo WAR insuficiente', balance };
            warbank.debit(w, fee);
            warbank.creditDeposit(w, 0, sigKey);   // marca la firma como usada (anti-replay)
            logTx('entry', w, -fee, key);
            logAdmin(key, 'Entrada pagada', w.slice(0, 6) + '… -' + fee + ' PILL');
            log(`Entrada pagada: ${w.slice(0, 6)}… -${fee} PILL → ${key}`);
            // La firma viaja de vuelta para guardarla en el recibo de la partida. Es
            // lo que hace que el recibo no sea "lo que dice el servidor": esta firma
            // la hizo la wallet del jugador y yo no la puedo fabricar, así que nadie
            // puede aparecer en una partida que no jugó. Ver server/matches.js.
            return {
                ok: true, payWallet: w, fee, tester,
                entry: { msg: pay.message, ts, sig: Array.isArray(pay.signature) ? pay.signature : null },
            };
        }
        return { ok: true, payWallet: null, fee, tester };
    },

    // Registra la entrada en las stats globales (combo + jugador + quests + log).
    recordEntry({ comboKey, key, mode, playerId, name, cid, ip, tester }) {
        const st_ = statsOf(comboKey); st_.entradas++; if (!tester) st_.entradasReal++; statsDirty = true;
        if (name && !tester) { const st = pstatOf(name); st.name = name; st.partidas++; st.lastSeen = new Date().toISOString(); st.lastIp = ip; st.isReal = true; playersDirty = true; }
        if (cid) dailyquests.recordEvent(cid, mode === 'classic' ? 'classic_match' : 'arcade_match', 1);
        recentJoins.set((name || '') + '|' + ip, { ts: Date.now(), tester: !!tester });
        if (!tester) logConnection({ fecha: new Date().toISOString(), nombre: name || '(sin nombre)', ip, sala: key, id: playerId });
    },
};

// econ — sink de eventos económicos/stats/quests que el TICK de sala emite hacia
// el Director (Fase 4/4a.3). El Host reporta HECHOS del juego; el Director aplica
// las consecuencias sobre el estado persistente (warbank, stats, quests). En
// mono-proceso estos métodos ejecutan la lógica directa (idéntica a la que había
// inline en room-loop.js); en rol 'host' se sustituyen por el proxy IPC de abajo.
// Lo LOCAL de la partida (carry, pot, sendEcon, entryFeePill) NO vive aquí: es del Host.
const econLocal = {
    // Único dinero persistente que cruza al Director: acredita saldo WAR.
    credit(wallet, amount) { if (wallet && amount > 0) { warbank.credit(wallet, amount); logTx('prize', wallet, amount, ''); } },
    // Muerte de un jugador: stats de la sala (combo) y del jugador.
    playerDeath(comboKey, tester, name) {
        const ds = statsOf(comboKey); ds.muertes++; if (!tester) ds.muertesReal++; statsDirty = true;
        if (name && !tester) { pstatOf(name).muertes++; playersDirty = true; }
    },
    // Kill de bot: suma al contador de kills del matador.
    botKill(name, tester, wallet) {
        if (name && !tester) { pstatOf(name).kills++; playersDirty = true; }
        if (!tester) leaderboard.recordKill(wallet, name);
    },
    // Vuelca el pico de masa a stats/quests (misma lógica que la función global).
    peakMassFlush(room, pid, cli) { flushPeakMass(room, pid, cli); },
    // Se acabo el plazo de reconexion y no volvio: lo que llevaba encima va al pozo
    // del staking. No al bote de la sala — ese es de los que siguen jugando, y
    // regalarles lo del que se cayo premiaria tener mala conexion enfrente.
    graceExpired(econ) {
        if (!econ || !(econ.carry > 0)) return;
        rake.alStaking(econ.carry, 'entrada perdida por desconexion ' + (econ.comboKey || ''));
        logTx('lost', econ.payWallet || '-', -econ.carry, 'no volvio a tiempo (' + (econ.comboKey || '') + ')');
        log(`No volvio a tiempo: ${(econ.payWallet || '?').slice(0, 6)}… pierde ${econ.carry} PILL → staking`);
    },
    // Todo lo que el juego recauda — exit fees, comision del bote de arcade, partes
    // del bote que nadie reclama — va al pozo del staking.
    rakeStaking(pill, motivo) { rake.alStaking(pill, motivo); },
    // Queda la via a la tesoreria, pero hoy no la usa nadie: la tesoreria solo se
    // llena con fund(), o sea con los tokens de la compra inicial.
    rakeTesoreria(pill, motivo) { rake.aTesoreria(pill, motivo); },
    // Recibo de la partida: se guarda y se ancla en la cadena por lotes. Es lo que
    // hace que el leaderboard no sea solo "lo que dice el servidor" — ver matches.js.
    matchEnded(datos) { try { matches.registra(datos); } catch (e) { log('Recibo de partida fallido: ' + e.message); } },
    // Retos diarios rotativos (fire-and-forget: telemetría, no dinero).
    dailyEvent(cid, type, n) { if (cid) dailyquests.recordEvent(cid, type, n); },
    // Quests semanales con CAP aplicado en el Director (el Host solo emite el hecho).
    questOnlineMatch(cid) { const q = questsOf(cid); if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; q.updated = Date.now(); questsDirty = true; } },
    questFinishArcade(cid) { const q = questsOf(cid); if ((q.q1_games_finished | 0) < 2) { q.q1_games_finished = (q.q1_games_finished | 0) + 1; q.updated = Date.now(); questsDirty = true; } },
    questBestMass(cid, peak) { const q = questsOf(cid); if (peak > (q.bestMass | 0)) { q.bestMass = peak; q.updated = Date.now(); questsDirty = true; } },
    questSkills(cid, matchSkillUses) { const q = questsOf(cid); if (matchSkillUses > (q.q3_skills_in_arcade | 0)) { q.q3_skills_in_arcade = Math.min(8, matchSkillUses); q.updated = Date.now(); questsDirty = true; } },
};

// --- Rol 'host': director/econ se convierten en proxies IPC hacia el padre ---
// El canal es el que fork() abre gratis: process.send/process.on('message').
// REGLA DE ORO (dinero): fail-closed. Si el IPC falla o hace timeout, la
// autorización devuelve ok:false y el jugador NO entra sin pagar. Los econ.*
// son hechos ya consumados del juego (telemetría/stats/premios ya decididos)
// y viajan como notify (fire-and-forget), tal y como fija el diseño de fase 4.
const hostIpc = PW_ROLE === 'host' ? createIpc(process, { label: `host${PW_HOST_ID}→director` }) : null;
if (hostIpc) {
    // Cache del oráculo: el Director lo manda al forkear y en cada tickOracle.
    hostIpc.handle('oracleRate', (d) => { if (d && d.rate > 0) { PILL_PER_DOLLAR = d.rate; if (d.nextAt > 0) _oracleNextAt = d.nextAt; log(`Oráculo (IPC): $1 = ${PILL_PER_DOLLAR} PILL`); } });
    // Fase 4b: el Director es la fuente de verdad de "Ajustes"/"Rendimiento" y
    // reenvía aquí los cambios hechos en /admin. Las acciones de alcance (kick/
    // restart por modo, anuncios) también llegan reenviadas — cada host las
    // aplica solo sobre SU `rooms` local (ya acotado a sus propias combos).
    hostIpc.handle('settingsSync', (p) => applySettingsPatch(p));
    hostIpc.handle('perfSync', (p) => applyPerfPatch(p));
    hostIpc.handle('adminAnnounce', (p) => {
        const n = applyAnnounce(String(p && p.text || '').slice(0, 140));
        logAdmin('-', 'Anuncio a todos (reenviado)', p && p.text || '');
        log(`ADMIN anuncio (reenviado) a ${n} jugadores: ${p && p.text}`);
    });
    hostIpc.handle('adminKickMode', (p) => {
        const n = applyKickAllMode(p && p.mode);
        logAdmin('-', `Echó a todos del modo ${p && p.mode} (reenviado)`, `${n} IPs bloqueadas 30s`);
        log(`ADMIN kickAll modo=${p && p.mode} (reenviado): ${n} IPs bloqueadas 30s`);
    });
    hostIpc.handle('adminRestartMode', (p) => {
        const n = applyRestartMode(p && p.mode);
        logAdmin('-', `Reinició modo ${p && p.mode} (reenviado)`, `${n} salas`);
        log(`ADMIN restartMode=${p && p.mode} (reenviado): ${n} salas`);
    });
    hostIpc.handle('getRoomsSummary', () => buildRoomsSummary());
    // Panel del Director controla las salas de este host: comandos por-sala
    // reenviados + lista rica de salas (mismas entradas que su propio /hN/admin).
    hostIpc.handle('adminRoomCmd', (p) => { applyRoomAdminCmd(p || {}); });
    hostIpc.handle('getAdminRooms', () => buildAdminRoomList());
    // Token de espectador emitido por ESTE host (specTokens es por proceso: uno
    // del Director no valdría al conectar el espectador al WS del host).
    hostIpc.handle('makeSpecToken', () => {
        const tok = require('crypto').randomBytes(24).toString('hex');
        specTokens.set(tok, Date.now() + 10 * 60 * 1000);
        return { token: tok };
    });
}
const directorProxy = hostIpc && {
    async checkKick(ip) {
        // Fail-closed: sin respuesta del Director no se entra (bloqueo corto y reintenta).
        try { return await hostIpc.request('checkKick', { ip }); }
        catch (e) { log(`IPC checkKick falló: ${e.message} — join bloqueado (fail-closed)`); return { secondsLeft: 3 }; }
    },
    // El precio se bloquea con el rate CACHEADO del oráculo del Director (síncrono).
    // El precio de una sala se congela cuando entra el PRIMERO y no se vuelve a
    // tocar hasta que la sala se vacia: asi todos los que estan dentro han pagado
    // lo mismo, aunque el oraculo se haya movido diez veces entre medias.
    //
    // _reserved cuenta a los que estan EN MITAD del cobro (hay un await entre
    // congelar el precio y registrarlos en clients). Sin mirarlo, dos jugadores
    // que entraran a la vez a una sala vacia veian los dos clients.size===0, y si
    // el oraculo cambiaba en ese hueco cada uno congelaba un precio distinto y
    // acababan pagando diferente en la MISMA sala. La ventana son milisegundos,
    // pero pasar el oraculo de 5 min a 1 min la hizo cinco veces mas probable.
    // El precio de una sala se congela cuando entra el PRIMERO y no se vuelve a
    // tocar hasta que la sala se vacía: así todos los de dentro han pagado lo
    // mismo, aunque el oráculo se haya movido entre medias. Refrescarlo con
    // gente dentro NO es una opción — en classic te llevas el carry del que
    // matas, así que si cada uno entró a un precio, matar a uno renta distinto
    // que a otro. Por eso classic tiene ahora final de partida
    // (CLASSIC_MATCH_MS): es lo que hace que todos vuelvan a empezar a la vez
    // al precio nuevo.
    //
    // _reserved cuenta a los que están EN MITAD del cobro (hay un await entre
    // congelar el precio y registrarlos en clients). Sin mirarlo, dos jugadores
    // que entraran a la vez a una sala vacía veían los dos clients.size===0, y
    // si el oráculo cambiaba en ese hueco cada uno congelaba un precio distinto.
    lockPriceIfEmpty(room) {
        if (room.clients.size === 0 && !(room._reserved > 0)) room.pillRate = PILL_PER_DOLLAR;
    },
    async authorizeEntry(payload) {
        try { return await hostIpc.request('authorizeEntry', payload); }
        catch (e) {
            log(`IPC authorizeEntry falló: ${e.message} — entrada RECHAZADA (fail-closed)`);
            return { ok: false, reason: 'pago no disponible, reintenta', balance: 0 };
        }
    },
    recordEntry(payload) { hostIpc.notify('recordEntry', payload); },
    onPlayerLeave(payload) { hostIpc.notify('onPlayerLeave', payload); },
    refundEntry(payload) { hostIpc.notify('refundEntry', payload); },
};
const econProxy = hostIpc && {
    credit(wallet, amount) { if (wallet && amount > 0) hostIpc.notify('econ.credit', { wallet, amount }); },
    playerDeath(comboKey, tester, name) { hostIpc.notify('econ.playerDeath', { comboKey, tester: !!tester, name: name || null }); },
    botKill(name, tester, wallet) { hostIpc.notify('econ.botKill', { name: name || null, tester: !!tester, wallet: wallet || null }); },
    // El peak se LEE aquí (la sim vive en el host) y viaja como dato plano.
    peakMassFlush(room, pid, cli) {
        const pj = room.sim.players.get(pid); if (!pj) return;
        const peak = pj.peakMass ? Math.floor(pj.peakMass) : 0;
        if (peak <= 0) return;
        hostIpc.notify('econ.peakMass', { name: cli && cli.name, isTester: !!(cli && cli.isTester), cid: (cli && cli.cid) || null, peak, wallet: (cli && cli.payWallet) || null });
    },
    matchEnded(datos) { hostIpc.notify('econ.matchEnded', datos); },
    graceExpired(econ) { hostIpc.notify('econ.graceExpired', econ); },
    rakeStaking(pill, motivo) { hostIpc.notify('econ.rakeStaking', { pill, motivo }); },
    rakeTesoreria(pill, motivo) { hostIpc.notify('econ.rakeTesoreria', { pill, motivo }); },
    dailyEvent(cid, type, n) { if (cid) hostIpc.notify('econ.dailyEvent', { cid, type, n }); },
    questOnlineMatch(cid) { hostIpc.notify('econ.questOnlineMatch', { cid }); },
    questFinishArcade(cid) { hostIpc.notify('econ.questFinishArcade', { cid }); },
    questBestMass(cid, peak) { hostIpc.notify('econ.questBestMass', { cid, peak }); },
    questSkills(cid, matchSkillUses) { hostIpc.notify('econ.questSkills', { cid, matchSkillUses }); },
};
// La frontera que ve el resto del código: local en mono/director, proxy en host.
const director = directorProxy || directorLocal;
const econ = econProxy || econLocal;

// Handlers IPC que el Director registra por cada host forkeado: responden las
// peticiones de dinero (request) y aplican los hechos (notify) ejecutando la
// MISMA lógica local (directorLocal/econLocal) que usa el modo mono. Ninguna
// validación de pago se relaja: la firma/saldo/anti-replay se comprueban aquí.
function registerHostHandlers(hostEntry) {
    const ipc = hostEntry.ipc;
    // request/response — el host espera el resultado (entrada de dinero)
    ipc.handle('checkKick', (p) => directorLocal.checkKick(p.ip));
    ipc.handle('authorizeEntry', (p) => directorLocal.authorizeEntry(p));
    // notify — hechos consumados (stats, premios ya decididos por la partida)
    ipc.handle('recordEntry', (p) => directorLocal.recordEntry(p));
    ipc.handle('onPlayerLeave', (p) => directorLocal.onPlayerLeave(p));
    ipc.handle('refundEntry', (p) => directorLocal.refundEntry(p));
    ipc.handle('econ.credit', (p) => econLocal.credit(p.wallet, p.amount));
    ipc.handle('econ.playerDeath', (p) => econLocal.playerDeath(p.comboKey, p.tester, p.name));
    ipc.handle('econ.botKill', (p) => econLocal.botKill(p.name, p.tester, p.wallet));
    ipc.handle('econ.peakMass', (p) => applyPeakMass(p.name, p.isTester, p.cid, p.peak, p.wallet));
    ipc.handle('econ.matchEnded', (p) => econLocal.matchEnded(p));
    ipc.handle('econ.graceExpired', (p) => econLocal.graceExpired(p));
    ipc.handle('econ.rakeStaking', (p) => econLocal.rakeStaking(p.pill, p.motivo));
    ipc.handle('econ.rakeTesoreria', (p) => econLocal.rakeTesoreria(p.pill, p.motivo));
    ipc.handle('econ.dailyEvent', (p) => econLocal.dailyEvent(p.cid, p.type, p.n));
    ipc.handle('econ.questOnlineMatch', (p) => econLocal.questOnlineMatch(p.cid));
    ipc.handle('econ.questFinishArcade', (p) => econLocal.questFinishArcade(p.cid));
    ipc.handle('econ.questBestMass', (p) => econLocal.questBestMass(p.cid, p.peak));
    ipc.handle('econ.questSkills', (p) => econLocal.questSkills(p.cid, p.matchSkillUses));
    // Rate actual del oráculo para el cache del host recién forkeado.
    ipc.notify('oracleRate', { rate: PILL_PER_DOLLAR, nextAt: _oracleNextAt });
    // Ajustes actuales (volumen/animaciones/zoom/tiempos) para el host recién forkeado.
    ipc.notify('settingsSync', { arcadeRestartMs, arcadeLobbyMs, sfxVol, musicVol, enemyFx, baseZoom, zoomExp, pillBandRef, pillBandSlow,
        menuDecoFoodDensity, menuDecoVirusCount, menuDecoPillBobPx, menuDecoCartelBobPx, menuDecoGridSize, menuDecoVirusTP, menuDecoDimPct, menuDecoSelectorGlowPct, menuDecoBlurbGlowPct, menuCartelStyle, layoutEdit });
}

// Instancia del GameHost: matchmaking y creación de salas viven en game-host.js.
// Se crea aquí, una vez definidas todas sus dependencias (rooms, reglas del
// catálogo…). Los nombres se desestructuran para que los call sites
// existentes (pickLayer/getOrCreateRoom/buildSim/initLayers) no cambien.
const gameHost = createGameHost({
    rooms,
    comboKeyOf, layerKeyOf, isLayerEnabled,
    rulesOf, minRealOf, targetPopOf, maxPlayersOf, lobbyMsOf,
    log,
    onRulesDirty: () => { rulesDirty = true; },
    CATALOG_MODES, PRICES, LAYERS_PER_COMBO, ownsCombo,
    MATCH_MS, CLASSIC_MATCH_MS,
    resumeTokens,
    SPAWN_IMMUNE_MS,
    director, RESUME_GRACE_MS, sendEcon, entryFeePill,
});
// El runtime de sala (broadcast/lobby/startMatch/…) vive ahora en el GameHost
// (Fase 4/4a.2). Se desestructura con los mismos nombres para que los call sites
// del Director (admin, tick loop) no cambien.
const {
    buildSim, getOrCreateRoom, pickLayer, initLayers,
    broadcast, sendWaiting, refillBots, tickGradualBots,
    armLobby, startMatch, restartRoom, shutdownRoom,
} = gameHost;

// --- Acciones de admin de ALCANCE GLOBAL, extraídas a funciones puras (sin ws) ---
// Las usa tanto el handler directo del comando admin (mono/host, conexión propia)
// como el handler IPC 'adminAnnounce'/'adminKickMode'/'adminRestartMode'/'perfSync'
// que cada host expone para que el Director reenvíe estas acciones (Fase 4b).
// Operan siempre sobre `rooms` (el Map LOCAL del proceso), así que en un host del
// split ya quedan automáticamente acotadas a sus propias combos.
function applyAnnounce(text) {
    let n = 0;
    for (const r of rooms.values()) { broadcast(r, { t: 'announce', text }); n += r.clients.size; }
    return n;
}
function applyKickAllMode(mode) {
    let n = 0;
    const until = Date.now() + KICKED_MS;
    for (const sala of rooms.values()) {
        if (mode !== 'all' && sala.mode !== mode) continue;
        for (const cli of sala.clients.values()) {
            if (cli.ip) kickedIps.set(cli.ip, until);
            try { cli.ws.send(JSON.stringify({ t: 'kicked', secondsLeft: 30 })); } catch (e) {}
            try { cli.ws.close(); } catch (e) {}
        }
        n += sala.clients.size;
    }
    return n;
}
function applyRestartMode(mode) {
    let n = 0;
    for (const sala of rooms.values()) {
        if (mode !== 'all' && sala.mode !== mode) continue;
        restartRoom(sala); n++;
    }
    return n;
}
// Comandos de admin de ámbito SALA/JUGADOR. Extraídos del switch del WS para poder
// ejecutarlos también reenviados por IPC (el panel del Director controla las salas
// de los hosts). Cada comando opera solo sobre `rooms`/clientes LOCALES: en el
// Director son no-op (salas vacías) y el reenvío a todos los hosts es seguro —
// el host que no tiene la sala/jugador simplemente no encuentra nada.
const ROOM_ADMIN_CMDS = new Set(['kick', 'power', 'rules', 'forceStart', 'restart', 'kickAll', 'shutdown', 'encender', 'setLayerEnabled']);
function applyRoomAdminCmd(msg) {
    if (msg.cmd === 'kick' && msg.playerId) {
        const found = findClient(msg.playerId);
        if (found) {
            // Bloqueo por IP 30s: sin esto el jugador echado reentraba al
            // instante (el kick solo cerraba el socket). Igual que kickAll.
            if (found.cli.ip) kickedIps.set(found.cli.ip, Date.now() + KICKED_MS);
            try { found.cli.ws.send(JSON.stringify({ t: 'kicked', secondsLeft: 30 })); } catch (e) {}
            try { found.cli.ws.close(); } catch (e) {}
            found.room.pendingRemovals.set(msg.playerId, 0);
            logAdmin(found.room.key, 'Echó a un jugador', found.cli.name || '(sin nombre)');
            log(`ADMIN expulsó a ${found.cli.name} de ${found.room.key} — IP bloqueada 30s`);
        }
    } else if (msg.cmd === 'power' && msg.playerId) {
        const found = findClient(msg.playerId);
        if (found) {
            found.room.sim.runCommand(msg.playerId, msg.name, Array.isArray(msg.args) ? msg.args.slice(0, 4) : [], true);
            const nm = found.cli.name || '(sin nombre)';
            if (msg.name === 'god') { logAdmin(found.room.key, 'Toggled GOD', nm); }
            else if (msg.name === 'mass') { logAdmin(found.room.key, 'Puso masa ' + (msg.args && msg.args[0] || ''), nm); }
            else logAdmin(found.room.key, 'Poder /' + msg.name, nm);
            log(`ADMIN poder /${msg.name} a ${found.cli.name}`);
        }
    } else if (msg.cmd === 'rules' && msg.room) {
        // Las reglas son por COMBO (afectan a todas sus layers). El panel
        // puede mandar layerKey o comboKey; resolvemos al combo.
        const sala0 = rooms.get(msg.room);
        const ck = sala0 ? sala0.comboKey : msg.room;
        const rules = rulesOf(ck); const r = msg.rules || {};
        if (typeof r.speed === 'number') rules.speed = Math.max(0.25, Math.min(5, r.speed));
        if (typeof r.food === 'number') rules.food = Math.max(0.25, Math.min(10, r.food));
        if (typeof r.virus === 'number') rules.virus = Math.max(0, Math.min(10, r.virus));
        if (typeof r.botsEnabled === 'boolean') rules.botsEnabled = r.botsEnabled;
        if (typeof r.botCount === 'number') rules.botCount = Math.max(0, Math.min(200, r.botCount | 0));
        if (typeof r.minReal === 'number') rules.minReal = Math.max(1, Math.min(50, r.minReal | 0));
        if (typeof r.targetPop === 'number') rules.targetPop = Math.max(0, Math.min(60, r.targetPop | 0));
        if (typeof r.maxPlayers === 'number') rules.maxPlayers = Math.max(1, Math.min(100, r.maxPlayers | 0));
        rulesDirty = true;
        // Aplicar en vivo a TODAS las layers del combo (speed/food/población).
        for (const sala of rooms.values()) {
            if (sala.comboKey !== ck) continue;
            sala.sim.config.worldSettings.speed = rules.speed;
            sala.sim.config.worldSettings.food = rules.food;
            if (sala.state === 'playing') refillBots(sala);
            if (sala.state === 'waiting') {
                sendWaiting(sala);
                armLobby(sala);
            }
        }
        logAdmin(msg.room, 'Cambió reglas', '');
        log(`ADMIN reglas en ${msg.room}: ${JSON.stringify(rules)}`);
    } else if (msg.cmd === 'forceStart' && msg.room) {
        const sala = rooms.get(msg.room);
        if (sala && sala.state === 'waiting') { startMatch(sala); logAdmin(msg.room, 'Forzó el inicio', ''); log(`ADMIN forzó inicio de ${msg.room}`); }
    } else if (msg.cmd === 'restart' && msg.room) {
        const sala = rooms.get(msg.room);
        if (sala) { restartRoom(sala); logAdmin(msg.room, 'Reinició la sala', ''); }
    } else if (msg.cmd === 'kickAll' && msg.room) {
        const sala = rooms.get(msg.room);
        if (sala) {
            const until = Date.now() + KICKED_MS;
            for (const cli of sala.clients.values()) {
                if (cli.ip) kickedIps.set(cli.ip, until);
                try { cli.ws.send(JSON.stringify({ t: 'kicked', secondsLeft: 30 })); } catch (e) {}
                try { cli.ws.close(); } catch (e) {}
            }
            logAdmin(msg.room, 'Echó a todos', sala.clients.size + ' IPs bloqueadas 30s');
            log(`ADMIN vació la sala ${msg.room} — ${sala.clients.size} IPs bloqueadas 30s`);
        }
    } else if (msg.cmd === 'shutdown' && msg.room) {
        const sala = rooms.get(msg.room);
        if (sala) { shutdownRoom(sala, 'admin'); logAdmin(msg.room, 'Apagó la sala', ''); }
    } else if (msg.cmd === 'encender' && msg.room) {
        // Recrea una sala persistente que fue apagada (shutdownRoom la borra del Map).
        const lk = msg.room;
        if (!rooms.has(lk)) {
            const parts = lk.split('_');
            const mode = parts[0]; const price = parts.slice(1, -1).join('_');
            // Reenviado a todos los hosts: solo el DUEÑO del combo puede crearla
            // (crearla en el host equivocado rompe el reparto del shard-map).
            if (PW_ROLE === 'host' && ownsCombo && !ownsCombo(mode, price)) return;
            getOrCreateRoom(lk, mode, price);
            logAdmin(lk, 'Encendió sala', '');
            log(`ADMIN encendió sala: ${lk}`);
        }
    } else if (msg.cmd === 'setLayerEnabled' && msg.mode && msg.price != null && msg.layerIdx) {
        if (applySetLayerEnabled(msg.mode, msg.price, msg.layerIdx | 0, !!msg.enabled)) {
            const lk = layerKeyOf(msg.mode, msg.price, msg.layerIdx | 0);
            logAdmin(lk, msg.enabled ? 'Encendió layer' : 'Apagó layer', '');
            log(`ADMIN ${msg.enabled ? 'encendió' : 'apagó'} layer: ${lk}`);
        }
    }
}
// Reenvío del Director a todos los hosts vivos (payload plano, sin la admin key).
function relayRoomCmdToHosts(msg) {
    const p = {
        cmd: msg.cmd, room: msg.room, playerId: msg.playerId, name: msg.name, args: msg.args, rules: msg.rules,
        mode: msg.mode, price: msg.price, layerIdx: msg.layerIdx, enabled: msg.enabled
    };
    for (const h of hostProcs.values()) if (h.alive) h.ipc.notify('adminRoomCmd', p);
}
// Apaga/enciende UNA layer de UN combo concreto. La L1 TAMBIEN se puede apagar:
// es la unica forma de desactivar un precio entero (p.ej. quitar las salas de
// 50$) — con todas sus layers apagadas el combo deja de listarse en /api/rooms
// y el matchmaker no lo elige, asi que desaparece de la pantalla de salas.
// Persistencia y creación de sala van por separado:
//  - Crear/destruir la sala: solo el proceso DUEÑO real del combo (mono, o el host
//    al que el shard-map le asigna ese combo).
//  - Persistir (layerassign.json): UN SOLO escritor, mono/director. Los hosts NO
//    escriben (sus vistas parciales se pisarían entre sí); leen el fichero al
//    arrancar y aplican en vivo lo que el Director les reenvía. Así también se
//    guarda la config de un combo SIN asignar (off), lista para cuando se asigne.
// Devuelve true en mono/director (el punto único donde loguear la acción admin;
// en el host la creación/borrado de sala ya la registra getOrCreateRoom/shutdownRoom).
function applySetLayerEnabled(mode, price, layerIdx, enabled) {
    if (!(layerIdx >= 1 && layerIdx <= LAYERS_PER_COMBO)) return false;
    const owner = !ownsCombo || ownsCombo(mode, price);
    const lk = layerKeyOf(mode, price, layerIdx);
    if (owner) {
        if (enabled) getOrCreateRoom(lk, mode, price);
        else { const r = rooms.get(lk); if (r) shutdownRoom(r, 'admin'); }
    }
    if (PW_ROLE !== 'host') {
        layerEnabled[lk] = enabled;
        saveLayerEnabled();
    }
    return PW_ROLE !== 'host';
}
// Aplica un parche de ajustes "Ajustes" (no de rendimiento) recibido por IPC del
// Director en un host. Mismos clamps que los cmd admin directos.
function applySettingsPatch(p) {
    if (!p) return;
    if (typeof p.arcadeRestartMs === 'number') arcadeRestartMs = Math.max(1000, Math.min(300000, p.arcadeRestartMs | 0));
    if (typeof p.arcadeLobbyMs === 'number')  arcadeLobbyMs  = Math.max(0,    Math.min(120000, p.arcadeLobbyMs  | 0));
    if (typeof p.sfxVol === 'number')   sfxVol   = _clamp01(p.sfxVol);
    if (typeof p.musicVol === 'number') musicVol = _clamp01(p.musicVol);
    if (typeof p.enemyFx === 'boolean') { enemyFx = p.enemyFx; for (const r of rooms.values()) broadcast(r, { t: 'enemyFx', on: enemyFx }); }
    if (typeof p.baseZoom === 'number') { baseZoom = _clampZoom(p.baseZoom); for (const r of rooms.values()) broadcast(r, { t: 'baseZoom', value: baseZoom }); }
    if (typeof p.zoomExp === 'number') { zoomExp = _clampZoomExp(p.zoomExp); for (const r of rooms.values()) broadcast(r, { t: 'zoomExp', value: zoomExp }); }
    if (typeof p.pillBandRef === 'number') { pillBandRef = _clampPillBandRef(p.pillBandRef); for (const r of rooms.values()) broadcast(r, { t: 'pillBandRef', value: pillBandRef }); }
    if (typeof p.pillBandSlow === 'number') { pillBandSlow = _clampPillBandSlow(p.pillBandSlow); for (const r of rooms.values()) broadcast(r, { t: 'pillBandSlow', value: pillBandSlow }); }
    if (typeof p.menuDecoFoodDensity === 'number') menuDecoFoodDensity = _clampN(p.menuDecoFoodDensity, 0, 150, menuDecoFoodDensity);
    if (typeof p.menuDecoVirusCount === 'number') menuDecoVirusCount = _clampN(p.menuDecoVirusCount, 1, 10, menuDecoVirusCount);
    if (typeof p.menuDecoPillBobPx === 'number') menuDecoPillBobPx = _clampN(p.menuDecoPillBobPx, 0, 12, menuDecoPillBobPx);
    if (typeof p.menuDecoCartelBobPx === 'number') menuDecoCartelBobPx = _clampN(p.menuDecoCartelBobPx, 0, 12, menuDecoCartelBobPx);
    if (typeof p.menuDecoGridSize === 'number') menuDecoGridSize = _clampN(p.menuDecoGridSize, 8, 40, menuDecoGridSize);
    if (typeof p.menuDecoVirusTP === 'boolean') menuDecoVirusTP = p.menuDecoVirusTP;
    if (p.menuCartelStyle === 1 || p.menuCartelStyle === 2) menuCartelStyle = p.menuCartelStyle;
    if (typeof p.menuDecoDimPct === 'number') menuDecoDimPct = _clampN(p.menuDecoDimPct, 0, 80, menuDecoDimPct);
    if (typeof p.layoutEdit === 'boolean') layoutEdit = p.layoutEdit;
}
// Aplica un parche de "Rendimiento" recibido por IPC (puede ir dirigido a un
// subconjunto de hosts — ver pushPerfToHosts).
function applyPerfPatch(p) {
    if (!p) return { ok: true };
    if (typeof p.snapshotHz === 'number') SNAPSHOT_EVERY = hzToEvery(p.snapshotHz | 0);
    if (typeof p.aoiEnabled === 'boolean') AOI_ENABLED = p.aoiEnabled;
    return { ok: true };
}
// Resumen ligero de este proceso para el fan-out que hace el Director (Fase 4b):
// alimenta las 2 tarjetas de host y el total agregado del panel /admin.
function buildRoomsSummary() {
    let salasOnline = 0, jugadores = 0, jugadoresReales = 0;
    const list = [];
    for (const r of rooms.values()) {
        if (r.clients.size > 0) salasOnline++;
        jugadores += r.clients.size;
        for (const cli of r.clients.values()) if (!cli.isTester) jugadoresReales++;
        list.push({
            key: r.key, comboKey: r.comboKey, mode: r.mode, roomName: r.roomName, layerIdx: r.layerIdx, state: r.state,
            conectados: r.clients.size, maxReales: maxPlayersOf(r.comboKey),
            // Para las barras del panel del Director: cuenta atrás de arcade y
            // pentakills de classic (acumulados desde el último restart de la sala,
            // los cuenta room-loop al llegar la racha a 5).
            tlMs: (r.state === 'playing' && r.endsAt) ? Math.max(0, r.endsAt - Date.now()) : null,
            restartEnMs: r.restartAt ? Math.max(0, r.restartAt - Date.now()) : null,
            startInMs: r.startAt ? Math.max(0, r.startAt - Date.now()) : null,
            pentakills: r.mode === 'classic' ? (r.pentas | 0) : 0
        });
    }
    return {
        hostId: PW_HOST_ID, salasOnline, jugadores, jugadoresReales, rooms: list, cpu: serverCpuPct,
        // Monitorización (panel Rendimiento): coste del tick, egress y RAM de ESTE
        // proceso. tick/lag salen del ring buffer tickHist (últimos ~6s a 40Hz).
        tick: pStats(tickHist.total, tickHist.n), lag: pStats(tickHist.lag, tickHist.n),
        netKBs, rssMB: Math.round(process.memoryUsage().rss / 1048576),
        perf: { snapshotHz: Math.round(TICK_HZ / SNAPSHOT_EVERY), aoiEnabled: AOI_ENABLED },
    };
}

function round1(n) { return Math.round(n * 10) / 10; }

function cellData(c) {
    const o = { ci: c.ci, x: round1(c.x), y: round1(c.y), r: round1(c.r), cb: c.colorBot, ct: c.colorTop };
    if (c.immuneTime > 0) o.im = Math.round(c.immuneTime);
    if (c.sprintTime > 0) o.sp = 1;
    if (c.magnetTime > 0) o.mg = 1;
    if (c.tpPhase) { o.tp = c.tpPhase; o.tt = Math.round(c.tpTimer); }
    return o;
}

// --- AOI (Area of Interest) ---
// Cada jugador recibe SOLO lo que su cámara puede mostrar. Esto:
//  - corta tráfico (lo que está fuera de pantalla no se manda)
//  - cierra el maphack (un cliente modificado no puede dibujar lo que no recibe)
//
// La caja REPLICA la cámara real del cliente (ZOOM_CONFIG en game/index.html):
//   effR  = max(10, Σradios / nCeldas^0.4)                  ← radio efectivo multi-celda
//   scale = clamp(baseZoom · (10/effR)^zoomExp, 0.05, 2.0)  ← zoom de la cámara
//   media pantalla visible en px de mundo = (altoPantalla/2) / scale
// La fórmula antigua ((1800 + r·18)·1.3) crecía LINEAL con el radio mientras la
// cámara real se aleja con potencia 0.3: divergen tanto que a radio ~90 la caja
// ya superaba el mapa arcade entero — el AOI degeneraba en "manda todo, pero
// serializado por jugador": todo el coste de CPU, cero ahorro de bytes, y el
// maphack medio abierto (recibías ~10-25× más mundo del visible). Medido con
// 500 bots: mismos bytes con y sin AOI, 41ms vs 11ms de tick.
//
// El zoom del cliente se suaviza (lerp de cámara): aquí se replica ese lerp en
// p._aoiScale y se usa el MENOR de (actual, objetivo) — así, al encogerte de
// golpe (te comen), la caja sigue cubriendo lo que la cámara aún enseña
// mientras se acerca, y no hay pop-in en los bordes durante la transición.
// Las celdas propias del jugador SIEMPRE van enteras (tras un split sus celdas
// pueden estar fuera del centro y aun así son suyas).
let AOI_ENABLED = process.env.AOI !== '0';   // ON por defecto; AOI=0 para apagar
const AOI_VIEW_HALF_H = 720;    // media ALTURA de pantalla de referencia (cubre hasta 1440px CSS de alto)
const AOI_MARGIN = 1.35;        // margen: interpolación + retardo del pan de cámara
// AOI_ZOOM_EXP ya no es constante: usa la variable `zoomExp` (arriba), = ZOOM_CONFIG.exponent del cliente.
const AOI_SCALE_MIN = 0.05, AOI_SCALE_MAX = 2.0;   // = ZOOM_CONFIG min/maxScale
const AOI_SCALE_LERP = 0.075;   // ≈ el lerp 0.05/frame del cliente (60fps), traducido a 40Hz
const AOI_FULL_FRAC = 0.9;      // caja ≥90% del mapa en ambos ejes → full compartido
// Caja rectangular con el aspect ratio (W/H) que el cliente manda en el join.
// Clamp [0.5, 4.0]: protege de ratios absurdos (cliente trucado para ver más).
// Devuelve null si la caja cubre (casi) todo el mapa: el caller sirve entonces
// el snapshot COMPLETO CACHEADO de la sala (una única serialización compartida)
// en vez de construir y serializar uno idéntico por jugador.
function aoiBoxFor(p, aspect, mapSize) {
    if (!p || p.cells.length === 0) return null;
    const cells = p.cells;
    let cx = 0, cy = 0, totR = 0;
    for (let i = 0; i < cells.length; i++) { cx += cells[i].x; cy += cells[i].y; totR += cells[i].r; }
    const n = cells.length;
    cx /= n; cy /= n;   // la cámara del cliente centra en la media SIMPLE de las celdas
    const effR = Math.max(10, totR / Math.pow(n, 0.4));
    let target = baseZoom * Math.pow(10 / effR, zoomExp);
    if (target < AOI_SCALE_MIN) target = AOI_SCALE_MIN; else if (target > AOI_SCALE_MAX) target = AOI_SCALE_MAX;
    // Réplica del suavizado de cámara (el cliente arranca la cámara en 0.8).
    if (p._aoiScale == null) p._aoiScale = 0.8;
    p._aoiScale += (target - p._aoiScale) * AOI_SCALE_LERP;
    const scaleSafe = Math.min(p._aoiScale, target);   // el más alejado = el que más mundo enseña
    const halfY = (AOI_VIEW_HALF_H / scaleSafe) * AOI_MARGIN;
    let ar = aspect > 0 ? aspect : 1;
    if (ar > 4) ar = 4; else if (ar < 0.5) ar = 0.5;
    const halfX = halfY * ar;
    if (mapSize && halfX >= mapSize * AOI_FULL_FRAC && halfY >= mapSize * AOI_FULL_FRAC) return null;
    return { cx, cy, halfX, halfY };
}
// ¿La circunferencia (x,y,r) intersecta la caja? (distancia al borde ≤ r).
function intersectsBox(box, x, y, r) {
    const dxLeft = box.cx - box.halfX - x;
    const dxRight = x - (box.cx + box.halfX);
    const dyTop = box.cy - box.halfY - y;
    const dyBot = y - (box.cy + box.halfY);
    const dx = dxLeft > dxRight ? (dxLeft > 0 ? dxLeft : 0) : (dxRight > 0 ? dxRight : 0);
    const dy = dyTop > dyBot ? (dyTop > 0 ? dyTop : 0) : (dyBot > 0 ? dyBot : 0);
    return (dx * dx + dy * dy) <= (r * r);
}

// Snapshot filtrado por AOI. Si box es null → snapshot completo (espectadores
// del panel de control, jugadores muertos, debug). Si viewerId está definido,
// sus celdas siempre se incluyen aunque estén fuera de la caja (split).
// Grids espaciales POR TICK para el snapshot AOI (mismo patrón que foodGrid en
// sim.js, pero reconstruidos cada tick en vez de persistentes: virus/masas
// eyectadas/proyectiles/bots se mueven SIEMPRE, así que no hay nada que mantener
// entre ticks — solo evitar que CADA jugador recorra el array entero de la sala.
// Antes: buildSnapshotFor(viewer) escaneaba TODAS las entidades de la sala, y eso
// se repetía una vez por jugador → coste = viewers × entidades. Ahora: 1 build
// barato (O(entidades), memoizado por tickCount, se comparte entre TODOS los
// viewers de este tick) + cada viewer solo consulta lo cercano a su caja.
// Se activa solo cuando hay `box` (AOI real, no el snapshot completo compartido,
// que ya no necesita filtrar nada).
const ENT_GRID_CELL = 500;
function buildRoomEntityGrids(room) {
    if (room._entGridTick === room.tickCount && room._entGrids) return room._entGrids;
    const sim = room.sim;
    const virusGrid = new PillSim.SpatialGrid(ENT_GRID_CELL);
    for (const v of sim.viruses) virusGrid.insert(v);
    const ejectedGrid = new PillSim.SpatialGrid(ENT_GRID_CELL);
    for (const m of sim.ejectedMasses) ejectedGrid.insert(m);
    const projGrid = new PillSim.SpatialGrid(ENT_GRID_CELL);
    for (const pr of sim.projectiles) projGrid.insert(pr);
    const enemyGrid = new PillSim.SpatialGrid(ENT_GRID_CELL);
    for (const e of sim.enemies) enemyGrid.insert(e);
    room._entGrids = { virusGrid, ejectedGrid, projGrid, enemyGrid };
    room._entGridTick = room.tickCount;
    return room._entGrids;
}

// Payloads memoizados POR TICK: el objeto serializable de una entidad es
// idéntico para todos los viewers del mismo tick (nada depende del viewer),
// así que se construye UNA vez y se comparte — encodeSnap/JSON.stringify solo
// leen. Sin esto, con AOI cada entidad visible se re-alocaba una vez por
// viewer (~25× allocations/tick por sala: presión de GC, no de red).
// Stamp con room.tickCount: monotónico y nunca se resetea (ver _entGrids).
function cellDataT(c, tick) {
    if (c._sdT === tick) return c._sd;
    c._sdT = tick;
    return (c._sd = cellData(c));
}
function botDataT(c, tick) {
    if (c._sdT === tick) return c._sd;
    const o = cellData(c);
    o.id = c.id; o.n = c.name;
    c._sdT = tick;
    return (c._sd = o);
}
function virusDataT(v, tick) {
    if (v._sdT === tick) return v._sd;
    v._sdT = tick;
    return (v._sd = { ci: v.ci, x: round1(v.x), y: round1(v.y), r: round1(v.r), d: v.damaged ? 1 : 0, a: round1(v.animTime) });
}
function ejectedDataT(m, tick) {
    if (m._sdT === tick) return m._sd;
    m._sdT = tick;
    return (m._sd = { ci: m.ci, x: round1(m.x), y: round1(m.y), r: m.r, c1: m.c1, c2: m.c2, a: round1(m.angle || 0) });
}
function projDataT(pr, tick) {
    if (pr._sdT === tick) return pr._sd;
    pr._sdT = tick;
    return (pr._sd = { ci: pr.ci, x: round1(pr.x), y: round1(pr.y), r: pr.r });
}

function buildSnapshotFor(room, viewerId, box) {
    const sim = room.sim;
    const tick = room.tickCount;
    const players = [];
    for (const p of sim.players.values()) {
        const isMe = p.id === viewerId;
        const srcCells = p.cells;
        // Filtrar in-line sin closure ni .map() para evitar allocations.
        const outCells = [];
        if (box && !isMe) {
            for (let i = 0; i < srcCells.length; i++) {
                const c = srcCells[i];
                if (intersectsBox(box, c.x, c.y, c.r)) outCells.push(cellDataT(c, tick));
            }
            // AOI: jugador sin NINGUNA celda visible → no mandar ni su metadata
            // (id/nombre/slots). El cliente solo usa las entradas ajenas para
            // pintar celdas, y muertes/kills viajan por eventos. Con 25 players
            // por sala la metadata era el grueso FIJO de cada frame AOI (~70B
            // × players × 40Hz × viewers), y además filtraba ids/nombres de
            // fuera de la vista (maphack parcial).
            if (outCells.length === 0) continue;
        } else {
            for (let i = 0; i < srcCells.length; i++) outCells.push(cellDataT(srcCells[i], tick));
        }
        // slots/ss memoizados por tick (idénticos para todos los viewers).
        if (p._metaT !== tick) {
            // slots: array preasignado (longitud constante por jugador), evita map().
            const srcSlots = p.skillSlots;
            const slotsOut = new Array(srcSlots.length);
            for (let i = 0; i < srcSlots.length; i++) {
                const s = srcSlots[i];
                slotsOut[i] = s ? { id: s.id, u: s.uses } : 0;
            }
            // skillState: solo claves con valor > 0 (objeto plano sin alloc extra).
            const ss = {};
            const st = p.skillState;
            for (let i = 1; i <= 8; i++) { if (st[i] > 0) ss[i] = Math.round(st[i]); }
            p._metaT = tick; p._metaSlots = slotsOut; p._metaSs = ss;
        }
        players.push({
            id: p.id, name: p.name, ks: p.killStreak, alive: p.alive, gcd: Math.round(p.globalCD),
            slots: p._metaSlots, ss: p._metaSs, cells: outCells
        });
    }
    // Con caja: consulta el grid del tick (solo lo cercano) en vez del array
    // entero de la sala. intersectsBox sigue haciendo el filtro EXACTO sobre los
    // candidatos del grid (el grid es cuadrado, la caja puede ser rectangular) —
    // mismo resultado que antes, mucho menos que recorrer.
    const grids = box ? buildRoomEntityGrids(room) : null;
    const qr = box ? Math.max(box.halfX, box.halfY) : 0;

    const bots = [];
    const enemies = grids ? grids.enemyGrid.query(box.cx, box.cy, qr) : sim.enemies;
    for (let i = 0; i < enemies.length; i++) {
        const c = enemies[i];
        if (!box || intersectsBox(box, c.x, c.y, c.r)) bots.push(botDataT(c, tick));
    }
    const viruses = [];
    const vs = grids ? grids.virusGrid.query(box.cx, box.cy, qr) : sim.viruses;
    for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!box || intersectsBox(box, v.x, v.y, v.r)) viruses.push(virusDataT(v, tick));
    }
    const ejected = [];
    const em = grids ? grids.ejectedGrid.query(box.cx, box.cy, qr) : sim.ejectedMasses;
    for (let i = 0; i < em.length; i++) {
        const m = em[i];
        if (!box || intersectsBox(box, m.x, m.y, m.r)) ejected.push(ejectedDataT(m, tick));
    }
    const projectiles = [];
    const pj = grids ? grids.projGrid.query(box.cx, box.cy, qr) : sim.projectiles;
    for (let i = 0; i < pj.length; i++) {
        const pr = pj[i];
        if (!box || intersectsBox(box, pr.x, pr.y, pr.r)) projectiles.push(projDataT(pr, tick));
    }
    return {
        t: 'snap',
        time: Math.round(sim.now),
        tl: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : null,
        pot: room.pot | 0,
        alv: room._aliveCount | 0,
        players, bots, viruses, ejected, projectiles
    };
}
// --- Dashboard: "activos última hora" + series temporales para las gráficas ---
// Activos = jugadores únicos (nombre|ip) vistos en connLog en los últimos 60 min
// (connLog ya excluye testers, así que es gente real). Series: una muestra por
// minuto con los totales acumulados y los conectados del momento; el panel dibuja
// la evolución con los deltas. Solo en RAM: se resetea al reiniciar el proceso.
// Joins recientes EN RAM, incluidos testers/bots de stress (a diferencia de
// connLog, que los excluye). El toggle "real only" del panel decide cuál mostrar.
const recentJoins = new Map();   // (nombre|ip) → { ts, tester }
function activosUltimaHora(includeTesters) {
    const desde = Date.now() - 3600000;
    const vistos = new Set();
    for (const [k, v] of recentJoins) {
        if (v.ts < desde) { recentJoins.delete(k); continue; }   // poda perezosa
        if (!includeTesters && v.tester) continue;
        vistos.add(k);
    }
    // Los que siguen conectados también cuentan aunque entraran hace >1h
    // (recentJoins solo registra el JOIN).
    for (const room of rooms.values()) for (const cli of room.clients.values()) {
        if (!includeTesters && cli.isTester) continue;
        vistos.add((cli.name || '') + '|' + cli.ip);
    }
    return vistos.size;
}
// Igual que activosUltimaHora pero a 24h, para el widget publico de la landing.
// recentJoins solo cubre ~1h (se poda a esa ventana), así que aquí se usa
// connLog en su lugar: ya viene filtrado a jugadores reales (logConnection
// solo se llama con `!tester`, ver recordEntry) y se persiste a disco con
// retención de LOG_RETENTION_DAYS (60 por defecto), de sobra para 24h.
function activePlayers24h() {
    const desde = Date.now() - 86400000;
    const vistos = new Set();
    for (let i = connLog.length - 1; i >= 0; i--) {
        const e = connLog[i];
        const t = new Date(e.fecha).getTime();
        if (isNaN(t) || t < desde) break; // connLog está en orden cronologico: en cuanto sale de ventana, para
        vistos.add((e.nombre || '') + '|' + e.ip);
    }
    // Los que siguen conectados ahora mismo también cuentan, aunque entraran
    // hace más de 24h (partida larga sin límite de tiempo en modo Classic).
    for (const room of rooms.values()) for (const cli of room.clients.values()) {
        if (cli.isTester) continue;
        vistos.add((cli.name || '') + '|' + cli.ip);
    }
    return vistos.size;
}
// Dinero real movido (entradas de jugadores reales × precio de la sala),
// SIN contar los bots de stress test. Misma formula que dineroReal en
// sampleAdminSeries — la fuente de verdad del panel admin — solo que aquí se
// calcula bajo demanda para el endpoint público en vez de muestrearse cada
// SAMPLE_MS. Es el total acumulado desde que existe roomStats (no resetea).
function totalRevenueReal() {
    let total = 0;
    for (const [ck, s] of Object.entries(roomStats)) total += (s.entradasReal || 0) * priceOf(ck);
    return total;
}
// Conectados AHORA por país (para el mapa del dashboard). Pocos clientes → barato.
function paisesConectados() {
    const porPais = {};
    for (const room of rooms.values()) for (const cli of room.clients.values()) {
        if (cli.isTester) continue;
        const g = geoOf(cli.ip);
        porPais[g.code] = (porPais[g.code] || 0) + 1;
    }
    return porPais;
}
const SAMPLE_MS = 15000;         // cadencia de la serie del dashboard (antes 60s: gráfica muy basta y tardaba minutos en verse)
const SERIES_MAX = 720;          // 3 h a 1 muestra/15s
const adminSeries = [];
function sampleAdminSeries() {
    let entradas = 0, muertes = 0, dinero = 0, entradasReal = 0, muertesReal = 0, dineroReal = 0;
    for (const [ck, s] of Object.entries(roomStats)) {
        const price = priceOf(ck);
        entradas += s.entradas || 0; muertes += s.muertes || 0; dinero += (s.entradas || 0) * price;
        entradasReal += s.entradasReal || 0; muertesReal += s.muertesReal || 0; dineroReal += (s.entradasReal || 0) * price;
    }
    adminSeries.push({
        ts: Date.now(),
        entradas, muertes, dinero, entradasReal, muertesReal, dineroReal,
        conectados: PW_ROLE === 'director' ? _dirAgg.conectados : [...rooms.values()].reduce((s, r) => s + r.clients.size, 0),
        salasOnline: PW_ROLE === 'director' ? _dirAgg.salasOnline : [...rooms.values()].filter(r => r.clients.size > 0).length,
        activos: activosUltimaHora(true),
        activosReal: activosUltimaHora(false),
        unicos: Object.keys(playerStats).length,
        unicosReal: Object.values(playerStats).filter(p => p.isReal).length
    });
    if (adminSeries.length > SERIES_MAX) adminSeries.shift();
}
// En rol director las salas viven en los hosts: antes de cada muestra se agregan
// conectados/salas por IPC (roomStats/activos/unicos ya viven aquí). En mono/host
// se muestrea directo de las salas locales.
let _dirAgg = { conectados: 0, salasOnline: 0 };
async function refreshDirAgg() {
    let jug = 0, salas = 0;
    await Promise.all([...hostProcs.values()].filter(h => h.alive).map(async (h) => {
        try { const s = await h.ipc.request('getRoomsSummary', {}); jug += s.jugadores || 0; salas += s.salasOnline || 0; } catch (e) {}
    }));
    _dirAgg = { conectados: jug, salasOnline: salas };
}
if (PW_ROLE === 'director') {
    const tick = () => refreshDirAgg().then(sampleAdminSeries);
    setTimeout(tick, 5000);   // primera muestra cuando los hosts ya han arrancado
    setInterval(tick, SAMPLE_MS);
} else {
    sampleAdminSeries(); setInterval(sampleAdminSeries, SAMPLE_MS);
}

// --- Estado para el panel de admin: una entrada por layer, agrupable por combo ---
// La lista de salas va aparte: en rol host también se sirve por IPC (getAdminRooms)
// para que el panel del Director muestre y controle las salas de cada host.
function buildAdminRoomList() {
    const now = Date.now();
    const list = [];
    const roomEntry = (key, comboKey, mode, roomName, layerIdx, room) => {
        const stats = statsOf(comboKey);
        const rules = rulesOf(comboKey);
        const price = priceOf(roomName);
        return {
            key, comboKey, mode, roomName, layerIdx, price,
            disabled: !!(room && room.disabled),
            state: room ? room.state : 'offline',
            conectados: room ? room.clients.size : 0,
            vivos: room ? [...room.clients.keys()].filter(pid => { const p = room.sim.players.get(pid); return p && p.alive; }).length : 0,
            espectadores: room ? room.spectators.size : 0,
            maxReales: maxPlayersOf(comboKey),
            needed: minRealOf(comboKey),
            bots: room ? new Set(room.sim.enemies.map(e => e.id)).size : 0,
            rules,
            // Las stats son del COMBO (compartidas por todas sus layers). Se
            // devuelven en cada layer por comodidad; al sumar totales hay que
            // contar UNA vez por comboKey (ver bucle de abajo).
            stats: { entradas: stats.entradas, muertes: stats.muertes, dinero: stats.entradas * price, entradasReal: stats.entradasReal || 0, muertesReal: stats.muertesReal || 0, dineroReal: (stats.entradasReal || 0) * price },
            tlMs: (room && room.endsAt) ? Math.max(0, room.endsAt - now) : null,
            startInMs: (room && room.startAt) ? Math.max(0, room.startAt - now) : null,
            restartEnMs: (room && room.restartAt) ? Math.max(0, room.restartAt - now) : null,
            players: room ? [...room.clients.keys()].map(pid => {
                const cli = room.clients.get(pid);
                const p = room.sim.players.get(pid);
                let mass = 0; if (p) p.cells.forEach(c => mass += c.mass);
                return {
                    id: pid, name: cli.name || (p ? p.name : '?'), ip: cli.ip,
                    mass: Math.floor(mass), kills: p ? p.killStreak : 0,
                    alive: p ? p.alive : false, god: p ? p.godMode : false,
                    conectadoSec: Math.floor((now - cli.joinedAt) / 1000)
                };
            }) : []
        };
    };
    const keysSeen = new Set();
    for (const mode of CATALOG_MODES) {
        for (const price of PRICES) {
            // Fase 4b: en rol host, el panel /admin de ESE proceso debe listar SOLO
            // sus propias combos. Sin este filtro, las combos del OTRO host salían
            // como entradas "offline" con botón "Encender" que crearía la sala en
            // el host equivocado (rompe el reparto del shard-map).
            // En rol director SÍ se listan todas (ownsCombo=false por diseño): sus
            // stats de combo alimentan el "Top rooms" del dashboard; la vista de
            // salas del director es hostCardsView, así que no hay botón Encender.
            if (PW_ROLE === 'host' && ownsCombo && !ownsCombo(mode, price)) continue;
            const ck = comboKeyOf(mode, price);
            for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
                if (!isLayerEnabled(mode, price, i)) continue;   // layer apagada para ESTE combo
                const lk = layerKeyOf(mode, price, i);
                keysSeen.add(lk);
                list.push(roomEntry(lk, ck, mode, price, i, rooms.get(lk) || null));
            }
        }
    }
    // Salas dinámicas fuera del catálogo (legacy: por si quedan en disco).
    for (const room of rooms.values()) {
        if (!keysSeen.has(room.key)) list.push(roomEntry(room.key, room.comboKey || room.key, room.mode, room.roomName, room.layerIdx || 1, room));
    }
    return list;
}
function buildAdminState() {
    const list = buildAdminRoomList();
    // Totales agregados: directamente desde roomStats (una entrada por combo).
    // Antes se sumaba iterando `list`, pero en rol director la lista de salas
    // propias está vacía y los totales salían a 0 aunque roomStats (que vive
    // aquí: los hechos llegan por econ IPC desde los hosts) tuviera los datos.
    let totEntradas = 0, totMuertes = 0, totDinero = 0, totEntradasReal = 0, totMuertesReal = 0, totDineroReal = 0;
    for (const [ck, s] of Object.entries(roomStats)) {
        const price = priceOf(ck);
        totEntradas += s.entradas || 0; totMuertes += s.muertes || 0; totDinero += (s.entradas || 0) * price;
        totEntradasReal += s.entradasReal || 0; totMuertesReal += s.muertesReal || 0; totDineroReal += (s.entradasReal || 0) * price;
    }
    // Ranking: usa el cache calculado bajo demanda (botón "Actualizar ranking" en panel).
    // No se recalcula aquí — con 87k entradas bloquearía el main thread en cada poll.
    const ranking = _rankingCache;
    // Ranking de países: JUGADORES DISTINTOS (IPs únicas) por país, no entradas
    const paises = Object.values(porPaisMap)
        .filter(p => p.code !== 'LOCAL')   // la red local no es un país: fuera del panel
        .map(p => ({ code: p.code, name: p.name, jugadores: p.ips.size }))
        .sort((a, b) => b.jugadores - a.jugadores);
    // Últimas conexiones: una sola entrada por IP (la más reciente)
    const vistas = new Set();
    const historial = [];
    for (let i = connLog.length - 1; i >= 0 && historial.length < 30; i--) {
        const c = connLog[i];
        if (vistas.has(c.ip)) continue;
        vistas.add(c.ip);
        historial.push(c);
    }
    return {
        t: 'adminState',
        role: PW_ROLE,
        minPlayers: MIN_PLAYERS,
        combos: listCombos(CATALOG_MODES, PRICES),
        snapshotHz: Math.round(TICK_HZ / SNAPSHOT_EVERY),
        aoiEnabled: AOI_ENABLED,
        layersPerCombo: LAYERS_PER_COMBO,
        maxLayers: MAX_LAYERS,
        layerEnabled: Object.assign({}, layerEnabled),
        arcadeRestartMs, arcadeLobbyMs,
        sfxVol, musicVol, enemyFx, baseZoom, zoomExp, pillBandRef, pillBandSlow,
        menuDecoFoodDensity, menuDecoVirusCount, menuDecoPillBobPx, menuDecoCartelBobPx, menuDecoGridSize, menuDecoVirusTP, menuDecoDimPct, menuDecoSelectorGlowPct, menuDecoBlurbGlowPct, menuCartelStyle,
        layoutEdit,
        serverCpu: serverCpuPct,
        // Monitorización del PROPIO proceso (la tarjeta del Director en el panel).
        tick: pStats(tickHist.total, tickHist.n), lag: pStats(tickHist.lag, tickHist.n),
        netKBs, rssMB: Math.round(process.memoryUsage().rss / 1048576),
        totales: {
            entradas: totEntradas, muertes: totMuertes, dinero: totDinero,
            entradasReal: totEntradasReal, muertesReal: totMuertesReal, dineroReal: totDineroReal,
            salasOnline: [...rooms.values()].filter(r => r.clients.size > 0).length,
            jugadores: [...rooms.values()].reduce((s, r) => s + r.clients.size, 0),
            jugadoresReales: [...rooms.values()].reduce((s, r) => { for (const c of r.clients.values()) if (!c.isTester) s++; return s; }, 0),
            jugadoresUnicos: Object.keys(playerStats).length,
            jugadoresUnicosReal: Object.values(playerStats).filter(p => p.isReal).length,
            activosHora: activosUltimaHora(true),
            activosHoraReal: activosUltimaHora(false),
        },
        series: adminSeries,
        paisesNow: paisesConectados(),
        rooms: list,
        ranking,
        rankingUpdatedAt: _rankingUpdatedAt,
        rankingStale: _rankingUpdatedAt === 0,
        paises,
        historial,
        adminLog: adminLog.slice(-60).reverse(),
        transacciones: txLog.slice(-200).reverse(),
        /* Tres listas y no una filtrada en el navegador: son tres preguntas
           distintas —cuanto ha entrado en las bovedas, quien ha metido, quien ha
           sacado— y mezcladas hay que ir buscando a ojo entre las entradas de
           partida, que son cien veces mas numerosas. */
        movimientos: {
            vault: txLog.filter(t => t.type === 'vault').slice(-100).reverse(),
            deposits: txLog.filter(t => t.type === 'deposit').slice(-100).reverse(),
            withdrawals: txLog.filter(t => t.type === 'withdraw').slice(-100).reverse(),
        },
        cluster: /devnet/i.test(solana.RPC) ? 'devnet' : (/testnet/i.test(solana.RPC) ? 'testnet' : null)
    };
}

// Fase 4b: agregado del estado para el panel /admin del Director. Las salas NO
// viven aquí (rooms=[] siempre en rol director) — se sustituyen por un fan-out
// IPC a cada host (getRoomsSummary) que alimenta las 2 tarjetas de host y los
// totales de "conectados ahora"/"salas con gente". Dinero/muertes/entradas/
// ranking/quests YA son correctos en buildAdminState() (viajan por econ IPC
// desde los hosts y se acumulan solo en el Director) — no hace falta agregarlos.
async function buildDirectorAdminState() {
    const base = buildAdminState();
    const summaries = await Promise.all([...hostProcs.values()].map(async (h) => {
        const empty = { hostId: h.id, port: h.port, alive: false, salasOnline: 0, jugadores: 0, jugadoresReales: 0, rooms: [], adminRooms: [], perf: null };
        if (!h.alive) return empty;
        try {
            const [s, adminRooms] = await Promise.all([h.ipc.request('getRoomsSummary', {}), h.ipc.request('getAdminRooms', {})]);
            // Las stats por combo viven AQUÍ (llegan por econ IPC): las del host van
            // a 0. Se machacan con las del Director para que las cartas las muestren.
            for (const e of adminRooms) {
                e.hostId = h.id;
                const st = statsOf(e.comboKey); const price = priceOf(e.roomName);
                e.stats = {
                    entradas: st.entradas, muertes: st.muertes, dinero: st.entradas * price,
                    entradasReal: st.entradasReal || 0, muertesReal: st.muertesReal || 0, dineroReal: (st.entradasReal || 0) * price
                };
            }
            return Object.assign({ port: h.port, alive: true, adminRooms }, s);
        } catch (e) { return empty; }
    }));
    let salasOnline = 0, jugadores = 0, jugadoresReales = 0;
    for (const s of summaries) { salasOnline += s.salasOnline; jugadores += s.jugadores; jugadoresReales += s.jugadoresReales; }
    base.hosts = summaries.sort((a, b) => a.hostId - b.hostId);
    base.totales.salasOnline = salasOnline;
    base.totales.jugadores = jugadores;
    base.totales.jugadoresReales = jugadoresReales;
    // Reparto de combos por host: lo que corre AHORA MISMO (SHARD, fijado al
    // arrancar) más lo guardado en hostassign.json (puede diferir si se editó
    // sin reiniciar todavía). El panel usa esto para el editor de asignación.
    base.hostAssign = {
        hostCount: PW_HOST_COUNT,
        combos: listCombos(CATALOG_MODES, PRICES),
        running: Object.fromEntries(SHARD.comboToHost),
        saved: loadHostAssign()
    };
    // El Director no aplica los cambios de layer (solo los hosts, dueños de sus
    // combos): se relee el fichero para reflejar lo que el host que sí posee el
    // combo acaba de guardar, en vez de la copia en memoria del propio Director.
    base.layerEnabled = loadJson(LAYERASSIGN_FILE, {});
    return base;
}

// Aplica un peakMass YA CALCULADO a playerStats (ranking) y quests (clientId).
// Datos planos: es lo que ejecuta el Director tanto en mono como al recibir el
// notify 'econ.peakMass' de un host. Idempotente: solo sube si supera el récord.
function applyPeakMass(name, isTester, cid, peak, wallet) {
    if (!(peak > 0)) return;
    if (name && !isTester) {
        const ps = pstatOf(name);
        if (peak > (ps.bestMass | 0)) { ps.bestMass = peak; playersDirty = true; }
    }
    if (cid) {
        const q = questsOf(cid);
        if (peak > (q.bestMass | 0)) { q.bestMass = peak; q.updated = Date.now(); questsDirty = true; }
    }
    // El pico del día también va al leaderboard diario: es el desempate cuando dos
    // jugadores acaban con las mismas kills.
    if (!isTester) leaderboard.recordPeak(wallet, peak, name);
}
// Lee el peakMass desde la sim local y lo aplica (path mono/director).
function flushPeakMass(room, pid, cli) {
    const pj = room.sim.players.get(pid); if (!pj) return;
    const peak = pj.peakMass ? Math.floor(pj.peakMass) : 0;
    applyPeakMass(cli && cli.name, !!(cli && cli.isTester), cli && cli.cid, peak, cli && cli.payWallet);
}

/* ===== ESTADO PÚBLICO DE LA TESORERÍA =====
 *
 * Lo que hace verificable el diseño de TESORERIA-PLAN.md. Tres datos y por qué:
 *
 *   custody vs treasury   son DOS direcciones distintas, no un apunte contable. El
 *                         saldo de custodia es dinero de los jugadores; el de
 *                         tesorería es del proyecto y está bloqueado.
 *   reservesRatio         custody / obligaciones (suma de saldos WAR). Si baja de 1,
 *                         hay menos on-chain de lo que se debe, y se ve al instante.
 *   upgradeAuthority      el dato que más pesa: mientras no sea null, la promesa del
 *                         bloqueo no vale nada — con la upgrade authority se despliega
 *                         otra versión del programa que vacíe los vaults.
 *
 * Se cachea 15 s: es público y sin auth, y sin caché cualquiera puede usarlo para
 * agotar la cuota del RPC a base de recargar.
 */
/* Retiros preparados a la espera de que el jugador firme.
 *
 * El saldo se descuenta al preparar (si no, podría pedir diez transacciones y
 * ejecutarlas todas). Si no completa la firma, hay que devolvérselo — pero no antes
 * de que su transacción deje de poder ejecutarse, o se le devuelve el saldo Y cobra.
 *
 * Ese momento es cuando caduca el blockhash: una transacción con un blockhash viejo
 * la rechaza la red entera. Se espera un margen generoso por encima para no jugar con
 * los bordes: el precio de esperar de más son unos minutos con el saldo retenido; el
 * de esperar de menos es dinero duplicado.
 */
const retirosPendientes = new Map();   // wallet -> { amount, creadoEn, lastValidBlockHeight }
// Configurable para poder probar el barrido sin esperar cinco minutos. En producción
// no se toca: bajarlo por debajo de la vida de un blockhash devolvería el saldo de un
// retiro que todavía puede ejecutarse, y el jugador cobraría dos veces.
const RETIRO_PENDIENTE_MS = (parseInt(process.env.WITHDRAW_PENDING_SECS, 10) || 300) * 1000;
setInterval(() => {
    const ahora = Date.now();
    for (const [wallet, p] of retirosPendientes) {
        if (ahora - p.creadoEn < RETIRO_PENDIENTE_MS) continue;
        retirosPendientes.delete(wallet);
        warbank.credit(wallet, p.amount);
        logTx('refund', wallet, p.amount, 'retiro no firmado a tiempo');
        log(`Retiro caducado sin firmar (${wallet.slice(0, 6)}…): ${p.amount} PILL devueltos al saldo`);
    }
    // Se revisa cada 10 s y no cada minuto: el retiro ya está descontado del saldo del
    // jugador, así que cada segundo de más es un segundo con su dinero retenido.
}, 10000).unref();

const TREASURY_PROGRAM = process.env.TREASURY_PROGRAM || '';
let _treasuryCache = null, _treasuryCacheAt = 0;
const TREASURY_CACHE_MS = 15000;

/*
 * Conexión al RPC, con TOPE DE ESPERA. Es la misma lección que ya está escrita en
 * solana.js: sin él, un devnet que no contesta deja la petición HTTP colgada hasta
 * que caduca el socket —minutos— y el jugador se queda mirando un botón muerto. Aquí
 * es peor todavía, porque estos endpoints los usa cualquiera sin autenticar: unas
 * cuantas peticiones a un RPC caído dejan sockets ocupados en el servidor del juego.
 */
const SOL_RPC_TIMEOUT_MS = 8000;
function _solConn() {
    const { Connection } = require('@solana/web3.js');
    if (!_solConn._c) {
        _solConn._c = new Connection(solana.RPC, {
            commitment: 'confirmed',
            fetch: (url, opts) => fetch(url, Object.assign({}, opts, { signal: AbortSignal.timeout(SOL_RPC_TIMEOUT_MS) })),
        });
    }
    return _solConn._c;
}

// Dueño de la upgrade authority de un programa, o null si es inmutable.
// El layout del loader v3: la cuenta del programa es [enum u32 = 2][programdata 32],
// y ProgramData es [enum u32 = 3][slot u64][Option<Pubkey>: 1 byte + 32].
async function upgradeAuthorityDe(conn, programId) {
    const { PublicKey } = require('@solana/web3.js');
    const info = await conn.getAccountInfo(new PublicKey(programId));
    if (!info || info.data.length < 36) return { conocido: false };
    const programData = new PublicKey(info.data.subarray(4, 36));
    const pd = await conn.getAccountInfo(programData);
    if (!pd || pd.data.length < 45) return { conocido: false };
    const tieneAutoridad = pd.data[12] === 1;
    return {
        conocido: true,
        inmutable: !tieneAutoridad,
        authority: tieneAutoridad ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : null,
    };
}

/* Estado del pool de staking, y la posición de una wallet si se pide.
 *
 * El rendimiento se calcula aquí y no on-chain: el contrato solo guarda la tasa por
 * segundo y hasta cuándo dura, que es lo que necesita para repartir. Anualizar eso es
 * cosa de quien lo mira, y conviene que se vea de dónde sale — con el pool casi vacío
 * el porcentaje se dispara y no significa nada.
 */
async function stakeState(wallet) {
    const dec = solana.DECIMALS;
    const aPill = (raw) => Number(BigInt(raw)) / 10 ** dec;

    /*
     * Da igual si el staking va por su propio contrato o por el de la tesorería:
     * server/staking.js decide cuál y los normaliza. Aquí solo se lee.
     */
    const st = require('./staking.js');
    if (!st.PROGRAMA) return { activo: false, aviso: 'staking is not deployed yet' };

    const p = st.pdas();
    const conn = _solConn();
    const claves = [p.config, p.stakeVault, p.rewardVault];
    if (wallet) claves.push(st.posicionPda(wallet));
    const cuentas = await conn.getMultipleAccountsInfo(claves);
    if (!cuentas[0]) return { activo: false, aviso: 'the program has not been initialized yet' };

    const cfg = st.decodeConfig(cuentas[0].data);
    // El saldo de una token account son 8 bytes en el offset 64.
    const saldo = (info) => (info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n);
    const ahora = Math.floor(Date.now() / 1000);
    const enMarcha = ahora < cfg.periodFinish;
    const porDia = enMarcha ? Number(cfg.rewardRate) * 86400 : 0;
    const stakeado = Number(cfg.totalStaked);

    const out = {
        activo: cfg.activo,
        programa: st.PROGRAMA,
        // "aparte" = contrato propio; "tesoreria" = el staking de dentro de
        // pill_treasury. Se dice para que el panel no tenga que adivinarlo.
        modo: st.MODO,
        stakeVault: p.stakeVault.toBase58(),
        rewardVault: p.rewardVault.toBase58(),
        totalStaked: aPill(cfg.totalStaked),
        pozo: aPill(saldo(cuentas[2])),
        repartiendoPorDia: aPill(porDia),
        hasta: cfg.periodFinish ? new Date(cfg.periodFinish * 1000).toISOString() : null,
        enMarcha,
        // Aproximación: lo que se reparte al día sobre lo que hay dentro, anualizado.
        // Con poco stakeado sale un número enorme que no se sostendría si entrara
        // gente, así que se da como lo que es y no como una promesa.
        apr: stakeado > 0 && enMarcha ? (porDia * 365) / stakeado : null,
        totales: { aportado: aPill(cfg.aportado), pagado: aPill(cfg.pagado) },
    };

    if (wallet) {
        const info = cuentas[3];
        if (!info) out.posicion = { wallet, stakeado: 0, pendiente: 0, saliendo: 0, saleEl: null, existe: false };
        else {
            const acc = st.decodeStakeAccount(info.data);
            // Lo pendiente guardado más lo devengado desde su última liquidación, que
            // es lo que el contrato le pagaría ahora mismo. El programa solo adelanta
            // el índice cuando alguien le llama, así que leer `pending` a secas
            // enseñaría un número viejo.
            const PRECISION = 1_000_000_000_000n;
            let acumulado = cfg.accRewardPerShare;
            if (stakeado > 0 && enMarcha) {
                const dt = BigInt(Math.max(0, Math.min(ahora, cfg.periodFinish) - cfg.lastUpdate));
                acumulado += (dt * cfg.rewardRate * PRECISION) / cfg.totalStaked;
            }
            const devengado = (acc.amount * (acumulado - acc.rewardPerSharePaid)) / PRECISION;
            out.posicion = {
                wallet, existe: true,
                stakeado: aPill(acc.amount),
                pendiente: aPill(acc.pending + devengado),
                // La salida pedida. Ya NO rinde ni cuenta para parteDelPool: sale de
                // total_staked en cuanto se pide, para no diluir a quien sigue dentro.
                saliendo: aPill(acc.unstaking),
                saleEl: acc.unstaking > 0n && acc.unstakeReadyAt
                    ? new Date(acc.unstakeReadyAt * 1000).toISOString()
                    : null,
                parteDelPool: stakeado > 0 ? Number(acc.amount) / stakeado : 0,
            };
        }
    }
    return out;
}

async function treasuryState() {
    if (_treasuryCache && Date.now() - _treasuryCacheAt < TREASURY_CACHE_MS) return _treasuryCache;

    const dec = solana.DECIMALS;
    const aPill = (raw) => Number(BigInt(raw)) / 10 ** dec;
    // Las obligaciones son off-chain y siempre se pueden calcular, haya cadena o no.
    const obligaciones = Object.values(warbank._balances || {}).reduce((s, v) => s + (v || 0), 0);

    const estado = {
        programa: TREASURY_PROGRAM || null,
        mint: solana.MINT || null,
        rpc: solana.RPC,
        obligaciones,
        // La suma de arriba la hago yo, así que sola no prueba nada. Lo que la hace
        // comprobable es el snapshot: la lista completa de saldos, con su raíz anclada
        // en la cadena. Si reportara menos pasivo tendría que quitarle saldo a alguien
        // concreto, y ese alguien lo ve en /api/reserves/proof.
        pasivo: (() => {
            const u = reserves.ultimo();
            if (!u) return null;
            return {
                snapshot: u.n, total: u.total, wallets: u.wallets, root: u.root,
                at: u.at, sig: u.sig,
                cuadraConLasObligaciones: u.total === obligaciones,
            };
        })(),
        premios: rewards.estado(),
        // Lo que la casa lleva apuntado y todavia no ha barrido a su bolsa. Publico
        // porque es dinero que salio del bote de los jugadores o de lo que gastaron.
        rake: rake.estado(),
        leaderboard: { hoy: leaderboard.estadoHoy().date, cadena: leaderboard.cadena(30).length, check: leaderboard.verificarCadena() },
        partidas: { lotes: matches.cadena(1).length ? matches.cadena(1)[0].n + 1 : 0, pendientes: matches.pendientes(), check: matches.verificar(20) },
        generadoEn: new Date().toISOString(),
    };

    // Sin programa desplegado el resto no existe todavía: se dice, no se inventa.
    if (!TREASURY_PROGRAM) {
        estado.aviso = 'todavía no hay programa de tesorería desplegado: custodia y tesorería siguen en la misma wallet';
        estado.treasuryOwnerLegacy = solana.TREASURY_OWNER || null;
        _treasuryCache = estado; _treasuryCacheAt = Date.now();
        return estado;
    }

    try {
        const conn = _solConn();
        const tc = require('./treasury-client.js');
        const p = tc.pdas(TREASURY_PROGRAM);
        const [cfgInfo, cusInfo, treInfo] = await conn.getMultipleAccountsInfo([p.config, p.custody, p.treasury]);
        // El saldo de una token account SPL vive en el u64 del offset 64.
        const saldo = (info) => (info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n);

        estado.custody = { address: p.custody.toBase58(), balance: aPill(saldo(cusInfo)) };
        estado.treasury = { address: p.treasury.toBase58(), balance: aPill(saldo(treInfo)) };
        estado.reservesRatio = obligaciones > 0 ? estado.custody.balance / obligaciones : null;
        estado.reservasCompletas = obligaciones === 0 || estado.custody.balance >= obligaciones;

        if (cfgInfo) {
            const cfg = tc.decodeConfig(cfgInfo.data);
            estado.config = {
                authority: cfg.authority,
                unlockTs: cfg.unlockTs,
                unlockDate: new Date(cfg.unlockTs * 1000).toISOString(),
                bloqueado: Date.now() / 1000 < cfg.unlockTs,
                diasParaDesbloqueo: Math.max(0, Math.ceil((cfg.unlockTs - Date.now() / 1000) / 86400)),
                finalized: cfg.finalized,
                epochSecs: cfg.epochSecs,
                challengeHoras: cfg.challengeSecs / 3600,
                rewardCapPerEpoch: aPill(cfg.rewardCapPerEpoch),
                rewardBpsPerEpoch: cfg.rewardBpsPerEpoch,
                sweepCapPerEpoch: aPill(cfg.sweepCapPerEpoch),
                reservado: aPill(cfg.reserved),
                totales: {
                    depositado: aPill(cfg.totalDeposited),
                    retirado: aPill(cfg.totalWithdrawn),
                    // Lo que ENTRO por fund(). Un contrato de vesting externo que
                    // libere hacia la boveda transfiere a secas, sin llamar a fund,
                    // asi que este contador se queda corto: el saldo de verdad es
                    // `treasury.saldo` de arriba, que se lee de la cuenta.
                    aportadoPorFund: aPill(cfg.totalFunded),
                    barrido: aPill(cfg.totalSwept),
                    premiado: aPill(cfg.totalRewarded),
                    caducado: aPill(cfg.totalExpired),
                    rondas: Number(cfg.roundsPublished),
                },
            };
        }
        estado.upgradeAuthority = await upgradeAuthorityDe(conn, TREASURY_PROGRAM);
        // El staking va aparte porque es otra fuente y otro destinatario: los
        // ingresos corrientes para quien inmoviliza, el principal para el top 10.
        try { estado.staking = await stakeState(null); } catch (e) { estado.staking = { activo: false, error: e.message }; }
    } catch (e) {
        estado.error = 'could not read the chain: ' + e.message;
    }

    _treasuryCache = estado; _treasuryCacheAt = Date.now();
    return estado;
}

function findClient(playerId) {
    for (const room of rooms.values()) {
        const cli = room.clients.get(playerId);
        if (cli) return { room, cli };
    }
    return null;
}

// --- HTTP: panel de admin + juego estático en el mismo puerto ---
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
// Headers básicos de seguridad (no son escudo total, pero cierran vectores comunes)
function applySecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Content-Security-Policy', CSP_JUEGO);
}
/*
 * CSP. El JS/CSS del juego y del panel va TODO inline, así que 'unsafe-inline'
 * es obligatorio y la CSP NO puede impedir que un XSS inyectado se ejecute. Lo
 * que sí acota es a DÓNDE puede hablar ese script: con connect-src cerrado a
 * una lista, un XSS no puede mandarse los datos a un servidor propio.
 *
 * La lista de hosts sale de lo que el cliente usa de verdad (grep de index.html
 * y game/index.html): analytics, el CDN de módulos, el RPC de Solana, el oráculo
 * de precio y el formulario de contacto. El RPC se añade desde la config (env
 * SOL_RPC / devnet-token.json) para que al pasar a mainnet no haya que tocar
 * esto y se rompan los depósitos sin avisar.
 */
const _rpcOrigin = (() => { try { return new URL(solana.RPC).origin; } catch (e) { return ''; } })();
const CSP_JUEGO = [
    "default-src 'self'",
    // esm.sh ya no aparece: la libreria de Solana la servimos nosotros desde
    // /vendor/solana.js, asi que 'self' la cubre (ver scripts/vendor-solana.js).
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Imágenes: la landing tira de varios CDN. https: en vez de lista cerrada
    // (romper la web por un logo no compensa), pero sin http: ni comodín total.
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    // GA4 no manda todo a www.google-analytics.com: usa endpoints REGIONALES
    // (region1.google-analytics.com y compañía) que cambian según el visitante,
    // así que aquí van por comodín o la analítica se cae en media Europa.
    ["connect-src 'self' ws: wss:",
        'https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com',
        'https://api.dexscreener.com https://api.web3forms.com',
        _rpcOrigin].filter(Boolean).join(' '),
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
].join('; ');
/*
 * CSP del panel de admin y del editor de carteles: mucho más cerrada. Ahí no
 * hay analytics, ni CDN, ni RPC — solo el WebSocket al propio servidor y las
 * fuentes de Google. Es la página que más daño haría comprometida (ve wallets,
 * IPs y puede echar jugadores), así que no hereda los permisos del juego.
 */
const CSP_ADMIN = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
].join('; ');
/*
 * Compara contra ADMIN_KEY en TIEMPO CONSTANTE.
 *
 * Un `===` normal corta en el primer carácter distinto, así que el tiempo de
 * respuesta filtra cuántos aciertas — se puede reconstruir la clave carácter a
 * carácter midiendo. Aquí no era muy explotable (hay bloqueo a los 8 intentos),
 * pero timingSafeEqual es gratis. Se hashean los dos lados antes de comparar
 * porque timingSafeEqual exige buffers del mismo largo: si no, la propia
 * excepción por longitudes distintas ya filtraría el tamaño de la clave.
 */
function adminKeyOk(k) {
    if (typeof k !== 'string' || !k) return false;
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(h(k), h(ADMIN_KEY));
}
function isSolAddr(s) { return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }
// Firmas de depósito en verificación RPC ahora mismo (ver /api/deposit).
const pendingDeposits = new Set();
// Rate-limit por IP de los endpoints que disparan llamadas al RPC de Solana
// (deposit/withdraw/claim): sin esto, un bucle de POSTs agota la cuota del RPC
// gratuito y tumba los depósitos para todo el mundo. 5 por minuto y por IP.
const rpcApiHits = new Map();   // ip → { c: peticiones, resetAt: timestamp }
function rpcRateLimited(req) {
    const ip = clientIp(req);
    const now = Date.now();
    let e = rpcApiHits.get(ip);
    if (!e || now >= e.resetAt) { e = { c: 0, resetAt: now + 60000 }; rpcApiHits.set(ip, e); }
    return ++e.c > 5;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of rpcApiHits) if (now >= e.resetAt) rpcApiHits.delete(k); }, 60000);

const httpServer = http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    // decodeURIComponent lanza URIError con escapes rotos (%zz): 400 en vez de
    // dejar la request colgada a merced del uncaughtException.
    let urlPath;
    try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('400 Bad Request'); return; }
    const query = new URLSearchParams((req.url || '').split('?')[1] || '');

    // --- Salud del servidor: heap, uptime y tamaños de estructuras (diagnóstico de leaks) ---
    if (urlPath === '/api/health') {
        const mem = process.memoryUsage();
        let simPlayers = 0, simEnemies = 0, simFoods = 0, simViruses = 0;
        for (const r of rooms.values()) {
            if (!r.sim) continue;
            simPlayers += r.sim.players.size;
            simEnemies += r.sim.enemies.length;
            if (r.sim.foods) simFoods += r.sim.foods.length;
            if (r.sim.viruses) simViruses += r.sim.viruses.length;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
            uptimeSec: Math.round(process.uptime()),
            heapMB: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
            rssMB: Math.round(mem.rss / 1024 / 1024),
            rooms: rooms.size,
            simPlayers, simEnemies, simFoods, simViruses,
            resumeTokens: resumeTokens.size,
            connLog: connLog.length,
            adminLog: adminLog.length,
            playerStats: Object.keys(playerStats).length,
            warSigs: Object.keys(warbank._sigs || {}).length,
            warBalances: Object.keys(warbank._balances || {}).length,
            // Diagnóstico de microparones. Tick nominal = TICK_MS (25ms a 40Hz).
            // lag.max alto = el event loop se atascó (GC u otro trabajo); total > TICK_MS = el tick no cabe en su ventana.
            tick: {
                samples: tickHist.n,
                tickMs: TICK_MS,
                lag:   pStats(tickHist.lag,   tickHist.n),
                step:  pStats(tickHist.step,  tickHist.n),
                snap:  pStats(tickHist.snap,  tickHist.n),
                send:  pStats(tickHist.send,  tickHist.n),
                total: pStats(tickHist.total, tickHist.n),
            },
        }));
        return;
    }
    // --- Matchmaking del split multiproceso (Fase 4): ¿qué host sirve este combo? ---
    // El cliente pregunta aquí ANTES de abrir el WS de juego. En 'director' se
    // devuelve el puerto del host hijo dueño del combo (503 si está caído → el
    // cliente reintenta; fail-closed, nunca se enruta a un host muerto). En 'mono'
    // este mismo proceso sirve todos los combos → devuelve su propio puerto.
    if (urlPath === '/match') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        const mode = String(query.get('mode') || '');
        const price = String(query.get('price') || '');
        const hostId = SHARD.comboToHost.get(mode + '_' + price);
        if (hostId == null) { res.end(JSON.stringify({ ok: false, reason: 'combo desconocido' })); return; }
        if (PW_ROLE === 'director') {
            const h = hostProcs.get(hostId);
            if (!h || !h.alive) { res.end(JSON.stringify({ ok: false, reason: 'host no disponible, reintenta' })); return; }
            // `path`: enrutado de producción (4b). Detrás del proxy (Caddy) cada host
            // se sirve por prefijo de path (wss://dominio/hN/); en local el cliente
            // usa el puerto directamente.
            res.end(JSON.stringify({ ok: true, host: 'localhost', port: h.port, hostId, path: '/h' + hostId }));
        } else if (hostId === MY_HOST_ID) {
            // mono (o host dueño del combo): el WS de juego vive en este puerto
            res.end(JSON.stringify({ ok: true, host: 'localhost', port: PORT, hostId }));
        } else {
            res.end(JSON.stringify({ ok: false, reason: 'combo de otro host, pregunta al director' }));
        }
        return;
    }
    // --- Stats públicas para la landing (widget ACTIVE PLAYERS / MONEY EARNED) ---
    // Solo dos números derivados, nada de wallets, IPs ni nombres de jugador.
    // En rol director las salas viven en los hosts (Fase 4b): fan-out HTTP
    // interno y SUMA simple, igual criterio que _dirAgg.conectados — no dedup
    // entre hosts (un jugador que entrara a dos price-tiers distintos el mismo
    // día contaría dos veces; caso raro, aceptable para un contador informativo).
    if (urlPath === '/api/publicstats') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        if (PW_ROLE === 'director') {
            let activePlayers = 0, revenue = 0;
            await Promise.all([...hostProcs.values()].map(async (h) => {
                if (!h.alive) return;
                try {
                    const r = await fetch(`http://localhost:${h.port}/api/publicstats`);
                    const j = await r.json();
                    activePlayers += j.activePlayers || 0; revenue += j.revenue || 0;
                } catch (e) { /* host caído: no suma, no rompe */ }
            }));
            res.end(JSON.stringify({ activePlayers, revenue }));
            return;
        }
        res.end(JSON.stringify({ activePlayers: activePlayers24h(), revenue: totalRevenueReal() }));
        return;
    }
    // --- Daily quests: 4 retos del día + progreso del clientId + saldo skin points ---
    if (urlPath === '/api/dailyquests') {
        const cid = String(req.headers['x-client-id'] || '').trim();
        const state = dailyquests.getState(isValidClientId(cid) ? cid : null);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(state));
        return;
    }
    // --- Estado público de salas (para el "ORACLE" del menú del juego) ---
    if (urlPath === '/api/rooms') {
        // Rol director (4b): las salas viven en los hosts → fan-out HTTP interno y
        // merge por combo según el shard-map. Cache 1s (el menú de cada cliente
        // hace polling; sin cache cada refresco serían N fetches a los hosts).
        if (PW_ROLE === 'director') {
            const nowD = Date.now();
            if (!_roomsCache || nowD - _roomsCache.at > 1000) {
                const perHost = new Map();
                await Promise.all([...hostProcs.values()].map(async (h) => {
                    if (!h.alive) return;
                    try {
                        const r = await fetch(`http://localhost:${h.port}/api/rooms`);
                        perHost.set(h.id, await r.json());
                    } catch (e) { /* host caído: sus combos salen 'offline' */ }
                }));
                const list = [];
                for (const mode of CATALOG_MODES) for (const price of PRICES) {
                    const ck = mode + '_' + price;
                    // Combo con TODAS sus layers apagadas: no existe para el
                    // jugador, así que no se lista (igual que una layer suelta).
                    if (enabledLayerCount(mode, price) === 0) continue;
                    const hj = perHost.get(SHARD.comboToHost.get(ck));
                    const entry = hj && hj.rooms && hj.rooms.find(r => r.key === ck);
                    list.push(entry || {
                        key: ck, mode, room: price, priceUsd: priceOf(price),
                        pillFee: entryFeePill(ck, null), locked: false, players: 0,
                        needed: minRealOf(ck), cap: maxPlayersOf(ck) * enabledLayerCount(mode, price),
                        state: 'offline', startIn: null, restartIn: null, endsIn: null,
                        roomName: price, layers: [],
                    });
                }
                _roomsCache = { at: nowD, body: JSON.stringify({ rooms: list, pillPerDollar: PILL_PER_DOLLAR, oracleEveryMs: ORACLE_REFRESH_MS, oracleNextAt: _oracleNextAt, pillUsd: _oraclePillUsd, layersPerCombo: LAYERS_PER_COMBO, sfxVol, musicVol, enemyFx, baseZoom, zoomExp, pillBandRef, pillBandSlow,
                    menuDecoFoodDensity, menuDecoVirusCount, menuDecoPillBobPx, menuDecoCartelBobPx, menuDecoGridSize, menuDecoVirusTP, menuDecoDimPct, menuDecoSelectorGlowPct, menuDecoBlurbGlowPct, menuCartelStyle, layoutEdit, menuLayout, menuTitulo }) };
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(_roomsCache.body);
            return;
        }
        // Cada combo (mode×price) tiene N layers. Devolvemos UN entry por combo
        // con la info AGREGADA (la layer que el matchmaker elegiría = más llena
        // que cumpla condiciones; si ninguna cumple, la primera) + la lista de
        // layers para el oracle multi-layer.
        const list = [];
        const now = Date.now();
        for (const mode of CATALOG_MODES) for (const price of PRICES) {
            const ck = mode + '_' + price;
            // Todas las layers apagadas = sala desactivada: fuera del listado.
            if (enabledLayerCount(mode, price) === 0) continue;
            const layers = [];
            for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
                if (!isLayerEnabled(mode, price, i)) continue;
                const r = rooms.get(layerKeyOf(mode, price, i));
                if (!r) continue;
                const durMs = r.mode === 'classic' ? CLASSIC_MATCH_MS : MATCH_MS;
                const endsIn = (r.state === 'playing' && r.endsAt) ? Math.max(0, r.endsAt - now) : null;
                layers.push({
                    layerIdx: i,
                    key: r.key,
                    players: r.clients.size,
                    state: r.state,
                    startIn: r.startAt ? Math.max(0, r.startAt - now) : null,
                    restartIn: (r.state === 'ended' && r.restartAt) ? Math.max(0, r.restartAt - now) : null,
                    endsIn,
                    disabled: !!r.disabled,
                    // Para el popup ROOM INFO: cada layer congela su propio precio
                    // al abrirse, así que el del combo (el de la layer que elegiría
                    // el matchmaker) no vale para enseñar las demás.
                    pillFee: entryFeePill(ck, roomRate(r)),
                    locked: r.clients.size > 0,
                    durationMs: durMs,
                    openMs: endsIn === null ? 0 : Math.max(0, durMs - endsIn),
                    // Tope de ESTA sala. El `cap` del combo es la suma de todas
                    // las layers, que no es el aforo de ninguna sala real: el
                    // popup ROOM INFO habla de una sola y ponia "0 / 50" cuando
                    // el limite de esa partida son 25.
                    maxPlayers: maxPlayersOf(ck),
                });
            }
            // Layer "representativa": la que el matchmaker elegiría. Si pickLayer
            // devuelve null (todas mal), cogemos la layer 1 para no dejar gris.
            const pick = pickLayer(mode, price) || rooms.get(layerKeyOf(mode, price, 1));
            const players = layers.reduce((s, l) => s + l.players, 0);
            list.push({
                key: ck, mode, room: price,
                priceUsd: priceOf(price),
                pillFee: entryFeePill(ck, roomRate(pick)),
                // Lo que costaría AHORA MISMO al precio vivo del oráculo. Cuando la
                // sala tiene gente, pillFee va congelado del momento en que entró el
                // primero y los dos números no coinciden: el cliente enseña esa
                // diferencia para que se vea que el precio de la sala no es el del
                // oráculo de ahora, sino el de cuando se abrió.
                pillFeeLive: entryFeePill(ck, null),
                locked: !!(pick && pick.clients.size > 0),
                players,                                  // total del combo (todas las layers)
                needed: minRealOf(ck),
                cap: maxPlayersOf(ck) * enabledLayerCount(mode, price), // capacidad TOTAL del combo
                state: pick ? pick.state : 'offline',
                startIn: (pick && pick.startAt) ? Math.max(0, pick.startAt - now) : null,
                restartIn: (pick && pick.state === 'ended' && pick.restartAt) ? Math.max(0, pick.restartAt - now) : null,
                endsIn: (pick && pick.state === 'playing' && pick.endsAt) ? Math.max(0, pick.endsAt - now) : null,
                roomName: price,
                layers,
                // Qué layer te tocaría al entrar ahora. El popup ROOM INFO la
                // marca en la lista: sin esto no hay forma de saber cuál de las
                // layers describen los campos de arriba.
                pickLayerIdx: pick ? (pick.layerIdx || 1) : null,
            });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ rooms: list, pillPerDollar: PILL_PER_DOLLAR, oracleEveryMs: ORACLE_REFRESH_MS, oracleNextAt: _oracleNextAt, pillUsd: _oraclePillUsd, layersPerCombo: LAYERS_PER_COMBO, sfxVol, musicVol, enemyFx, baseZoom, zoomExp, pillBandRef, pillBandSlow,
            menuDecoFoodDensity, menuDecoVirusCount, menuDecoPillBobPx, menuDecoCartelBobPx, menuDecoGridSize, menuDecoVirusTP, menuDecoDimPct, menuDecoSelectorGlowPct, menuDecoBlurbGlowPct, menuCartelStyle, layoutEdit, menuLayout, menuTitulo }));
        return;
    }
    // --- Layout del menú GLOBAL: el cliente lo sube desde EDIT LAYOUT → "Guardar
    // para todos". Se persiste y se difunde a todos por /api/rooms.
    // Protegido con ADMIN_KEY, igual que /api/landing-layout y /api/carteles-layout:
    // hasta ahora era el ÚNICO de los tres sin auth, o sea que cualquiera con un
    // curl podía dejarle el menú descolocado a todos los jugadores a la vez. ---
    if (urlPath === '/api/menu-layout') {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
            res.end(); return;
        }
        if (req.method === 'POST') {
            let body = ''; let abortado = false;
            req.on('data', c => { if (abortado) return; body += c; if (body.length > 65536) { abortado = true; res.writeHead(413); res.end('Payload too large'); req.destroy(); } });
            req.on('end', () => {
                if (abortado) return;
                let payload = {}; try { payload = JSON.parse(body || '{}'); } catch (e) {}
                if (!adminKeyOk(payload.key)) { res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, error: 'bad key' })); return; }
                const lay = payload && typeof payload.layout === 'object' && payload.layout ? payload.layout : null;
                if (!lay) { res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, error: 'bad layout' })); return; }
                // Sanea: solo claves con {x,y,s} numéricos (evita basura arbitraria).
                // `b` (intensidad del halo del título, ALT+rueda en EDIT LAYOUT) es
                // OPCIONAL: solo la traen los títulos, y si no viene no se escribe
                // para no llenar el layout de ceros.
                // f/w/h son igual de opcionales que `b` y se guardan con los MISMOS
                // topes que aplica el editor en el cliente: f = cuerpo de letra
                // (ALT+rueda / los botones TXT), w y h = ancho y alto de la barra
                // IN GAME (CTRL / CTRL+SHIFT+rueda). Antes se tiraban aquí: podías
                // ajustar la letra, ver el cambio, pulsar SAVE FOR ALL y al recargar
                // volvía al tamaño de fábrica — el ajuste no sobrevivía al servidor.
                const clean = {};
                const opc = (v, min, max) => (typeof v === 'number' && isFinite(v)) ? Math.max(min, Math.min(max, v)) : null;
                for (const k of Object.keys(lay).slice(0, 40)) {
                    const t = lay[k]; if (!t || typeof t !== 'object') continue;
                    const e = { x: +t.x || 0, y: +t.y || 0, s: (typeof t.s === 'number' && t.s > 0) ? Math.min(5, t.s) : 1 };
                    if (typeof t.b === 'number' && isFinite(t.b)) e.b = Math.max(0, Math.min(4, t.b));
                    const f = opc(t.f, 6, 48); if (f !== null) e.f = f;
                    const w = opc(t.w, 40, 900); if (w !== null) e.w = w;
                    const h = opc(t.h, 20, 400); if (h !== null) e.h = h;
                    // ff = fuente elegida para el mini-parrafo ROOM · PRICES
                    // (DEFAULT/PRESS START 2P/VT323, boton del editor).
                    if (['default', 'press', 'vt323'].includes(t.ff)) e.ff = t.ff;
                    clean[String(k).slice(0, 40)] = e;
                }
                menuLayout = clean;
                // Ajuste del rotulo, si viene. Mismo trato que el layout: solo
                // numeros y con topes, para que un payload raro no pueda dejar
                // el titulo a 4000px de alto ni fuera de pantalla. alto/altoPw/
                // altoWord aceptan null = "esa palabra sigue al alto comun".
                if (payload && typeof payload.titulo === 'object' && payload.titulo) {
                    const t = payload.titulo, tc = {};
                    const num = (v, min, max) => (typeof v === 'number' && isFinite(v)) ? Math.max(min, Math.min(max, v)) : null;
                    const alto = (k) => { if (t[k] === null) { tc[k] = null; return; } const v = num(t[k], 24, 400); if (v !== null) tc[k] = v; };
                    alto('alto'); alto('altoPw'); alto('altoWord');
                    const g = num(t.gap, 0, 400); if (g !== null) tc.gap = g;
                    const y = num(t.y, -600, 600); if (y !== null) tc.y = y;
                    const b = num(t.blur, 0, 80); if (b !== null) tc.blur = b;
                    menuTitulo = tc;
                }
                saveGlobal();
                if (PW_ROLE === 'director') _roomsCache = null;   // fuerza refresco del cache agregado
                log(`Menu layout GLOBAL actualizado (${Object.keys(clean).length} elementos, rotulo ${Object.keys(menuTitulo).length} ajustes)`);
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, count: Object.keys(clean).length }));
            });
            return;
        }
        res.writeHead(405, { 'Access-Control-Allow-Origin': '*' }); res.end(); return;
    }
    // --- Layout del HERO de la landing (index.html → botón EDIT). Mismo trato
    // que /api/menu-layout: sin auth, herramienta de diseño TEMPORAL. Aquí sí
    // hay GET porque la landing no consulta /api/rooms. ---
    if (urlPath === '/api/landing-layout') {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
            res.end(); return;
        }
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ layout: landingLayout, edit: layoutEdit })); return;
        }
        if (req.method === 'POST') {
            let body = ''; let abortado = false;
            req.on('data', c => { if (abortado) return; body += c; if (body.length > 65536) { abortado = true; res.writeHead(413); res.end('Payload too large'); req.destroy(); } });
            req.on('end', () => {
                if (abortado) return;
                let payload = {}; try { payload = JSON.parse(body || '{}'); } catch (e) {}
                const lay = payload && typeof payload.layout === 'object' && payload.layout ? payload.layout : null;
                if (!lay) { res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, error: 'bad layout' })); return; }
                const clean = {};
                // `zoom` es un numero suelto (el zoom del cuadro entero), no una
                // caja {x,y,s}: sin este caso aparte el saneado de abajo lo tiraba
                // y el zoom no llegaba a guardarse para todos.
                if (typeof lay.zoom === 'number' && lay.zoom > 0) clean.zoom = Math.min(1, Math.max(0.2, lay.zoom));
                // tagFont = fuente elegida para TODOS los .category-tag a la vez
                // (DEFAULT/PRESS START 2P/VT323, boton TAG FONT del editor). Igual
                // que zoom, es un valor suelto, no una caja {x,y,s}.
                if (['default', 'press', 'vt323'].includes(lay.tagFont)) clean.tagFont = lay.tagFont;
                // f = cuerpo de letra, b = halo del titulo, w/h = caja en px.
                // Mismo trato que en /api/menu-layout: sin esto se tiraban aqui
                // y los ajustes no sobrevivian a SAVE FOR ALL.
                const opc = (v, min, max) => (typeof v === 'number' && isFinite(v)) ? Math.max(min, Math.min(max, v)) : null;
                for (const k of Object.keys(lay).slice(0, 40)) {
                    if (k === 'zoom' || k === 'tagFont') continue;
                    const t = lay[k]; if (!t || typeof t !== 'object') continue;
                    const e = { x: +t.x || 0, y: +t.y || 0, s: (typeof t.s === 'number' && t.s > 0) ? Math.min(5, t.s) : 1 };
                    const f = opc(t.f, 6, 48); if (f !== null) e.f = f;
                    const b = opc(t.b, 0, 4);  if (b !== null) e.b = b;
                    const w = opc(t.w, 20, 900); if (w !== null) e.w = w;
                    const h = opc(t.h, 10, 400); if (h !== null) e.h = h;
                    clean[String(k).slice(0, 40)] = e;
                }
                landingLayout = clean; saveGlobal();
                log(`Landing layout GLOBAL actualizado (${Object.keys(clean).length} elementos)`);
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, count: Object.keys(clean).length }));
            });
            return;
        }
        res.writeHead(405, { 'Access-Control-Allow-Origin': '*' }); res.end(); return;
    }
    /* --- Espaciado de los carteles: lo escribe carteles-preview.html (editor de
     * diseño) y lo lee el juego al arrancar (GET). Se guarda en
     * globalsettings.json, NO en game/carteles-layout.json: ese es del repo y
     * deploy/update.sh hace `git reset --hard origin/main`, así que cada
     * actualización se llevaba por delante lo afinado en producción.
     * El POST va protegido con la misma ADMIN_KEY que /admin: el check de "solo
     * localhost" que había antes no servía detrás de Caddy (reverse_proxy
     * conecta a Node por loopback, así que TODO el tráfico externo llegaba
     * como 127.0.0.1 y el check pasaba siempre). El GET es público: es lo que
     * pinta el juego. --- */
    if (urlPath === '/api/carteles-layout') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(cartelesLayout));
            return;
        }
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        let body = '', abortado = false;
        req.on('data', c => { if (abortado) return; body += c; if (body.length > 65536) { abortado = true; res.writeHead(413); res.end('Payload too large'); req.destroy(); } });
        req.on('end', () => {
            if (abortado) return;
            let payload = {}; try { payload = JSON.parse(body || '{}'); } catch (e) {}
            if (!adminKeyOk(payload.key)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'bad key' })); return; }
            const lay = payload && typeof payload.layout === 'object' && payload.layout ? payload.layout : null;
            if (!lay) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'bad layout' })); return; }
            // Sanea: cada cartel es {pieza: {x, y, s}} y nada mas, para no
            // escribir basura arbitraria en un fichero que se commitea. Los
            // NOMBRES de pieza NO se listan aqui: los declara cada cartel en
            // CARTEL_SURFACES (game/carteles-layout.js) y el cliente es el
            // unico que los conoce — con una lista fija aqui, cada pieza nueva
            // (tryAgain/spectate/backToMenu...) se guardaba en silencio en la
            // nada. Se validan por forma: identificador corto, valores
            // numericos acotados y un tope de piezas por cartel.
            const esPieza = p => /^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(p);
            const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
            const clean = {};
            for (const k of Object.keys(lay).slice(0, 40)) {
                const src = lay[k]; if (!src || typeof src !== 'object') continue;
                const dst = {};
                for (const p of Object.keys(src).filter(esPieza).slice(0, 12)) {
                    // `variante` no es una pieza: es que marco lleva el cartel
                    // (hoy solo lo usa el de skins: '' gris / 'v2' verde). Va
                    // por lista cerrada — es lo unico que no es {x,y,s} y no
                    // debe poder colar una cadena cualquiera.
                    if (p === 'variante') {
                        const v = String(src[p] || '');
                        if (v === '' || v === 'v2') dst[p] = v;
                        continue;
                    }
                    const t = src[p]; if (!t || typeof t !== 'object') continue;
                    const x = Number(t.x), y = Number(t.y), s = Number(t.s);
                    dst[p] = {
                        x: isFinite(x) ? clamp(Math.round(x), -600, 600) : 0,
                        y: isFinite(y) ? clamp(Math.round(y), -600, 600) : 0,
                        s: isFinite(s) && s > 0 ? clamp(Math.round(s * 100) / 100, 0.2, 5) : 1,
                    };
                }
                if (Object.keys(dst).length) clean[String(k).slice(0, 40)] = dst;
            }
            cartelesLayout = clean; saveGlobal();
            log(`Carteles layout guardado en globalsettings.json (${Object.keys(clean).length} carteles)`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, count: Object.keys(clean).length }));
        });
        return;
    }
    // --- Config de tarifas: el juego calcula la entrada = precio($) × pillPerDollar ---
    if (urlPath === '/api/fees') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        // El destino del depósito viaja aquí porque el cliente lo necesita para saber
        // si construye la transferencia él mismo (modelo viejo, wallet) o se la pide
        // al servidor (modelo con contrato, PDA de custodia).
        res.end(JSON.stringify({
            pillPerDollar: PILL_PER_DOLLAR,
            treasuryProgram: process.env.TREASURY_PROGRAM || null,
            depositTo: solana.DEPOSIT_OWNER || null,
        }));
        return;
    }
    // --- Saldo WAR (PILL depositado en el juego) ---
    /* Saldo $PILL de una wallet EN LA CADENA (no el saldo in-game).
     *
     * Lo usa el boton MAX del panel de staking: se stakea desde la wallet, que es
     * otra bolsa distinta de la custodia. Solo lectura y con el mismo limite de
     * peticiones que el resto de lo que toca el RPC. */
    if (urlPath === '/api/walletbalance') {
        const wallet = String(query.get('wallet') || '');
        if (!isSolAddr(wallet)) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'invalid wallet' })); return;
        }
        if (rpcRateLimited(req)) {
            res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'too many requests' })); return;
        }
        solana.walletBalance(wallet).then(pill => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ wallet, pill }));
        }).catch(e => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: e.message }));
        });
        return;
    }

    if (urlPath === '/api/warbalance') {
        const wallet = String(query.get('wallet') || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ pill: isSolAddr(wallet) ? warbank.getBalance(wallet) : 0 }));
        return;
    }
    /* ===== TIENDA DE SKINS =====
     * Mismo modelo que las salas: el saldo $PILL es interno (warbank) y gastarlo
     * exige una FIRMA de la wallet con la cantidad exacta dentro del mensaje.
     * Sin eso bastaría con decir "soy esta wallet" en el body para vaciarle el
     * saldo a cualquiera — el endpoint no tiene sesión ni cookie que lo impida.
     * Los SP no llevan firma porque van por clientId y no valen dinero real.
     */
    if (urlPath === '/api/skins' && req.method === 'GET') {
        const cid = String(req.headers['x-client-id'] || '').trim();
        // El handler no tiene objeto URL: la ruta se saca con split('?'), asi que
        // la query se parsea aqui igual que en el resto del fichero.
        const w = String(new URLSearchParams((req.url || '').split('?')[1] || '').get('wallet') || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(Object.assign(
            skinshop.estado(isValidClientId(cid) ? cid : null, isSolAddr(w) ? w : null),
            { quema: skinshop.estadoQuema() })));
        return;
    }
    if ((urlPath === '/api/skins/buy' || urlPath === '/api/skins/equip' || urlPath === '/api/skins/convert') && req.method === 'POST') {
        const cid = String(req.headers['x-client-id'] || '').trim();
        let body = '';
        req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            if (!isValidClientId(cid)) { res.end(JSON.stringify({ ok: false, error: 'no session' })); return; }
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, error: 'invalid request' })); return; }
            const wallet = isSolAddr(String(p.wallet || '')) ? String(p.wallet) : null;

            // Comprueba la firma de un gasto en $PILL. `esperado` es el mensaje
            // EXACTO que el cliente tuvo que firmar: lleva dentro la cantidad, así
            // que una firma de 250 no sirve para gastar 25.000.
            const firmaVale = (esperado) => {
                const pay = p.pay || {};
                const ts = Number(pay.ts) || 0;
                if (!wallet || pay.message !== esperado || Math.abs(Date.now() - ts) > 120000) return 'invalid payment signature';
                const sigKey = 'skin_' + (Array.isArray(pay.signature) ? pay.signature.join(',') : '');
                if (warbank.sigUsed(sigKey)) return 'signature already used';
                if (!solana.verifySignedMessage(wallet, pay.message, pay.signature)) return 'signature not valid';
                warbank.creditDeposit(wallet, 0, sigKey);   // la marca como usada (anti-replay)
                return null;
            };

            let r;
            if (urlPath === '/api/skins/buy') {
                const code = String(p.code || '').toUpperCase();
                const moneda = p.moneda === 'pill' ? 'pill' : 'sp';
                if (moneda === 'pill') {
                    const ts = Number((p.pay || {}).ts) || 0;
                    const mal = firmaVale(`PillWars buy skin ${code} for ${skinshop.PRECIO_PILL} PILL @ ${ts}`);
                    if (mal) { res.end(JSON.stringify({ ok: false, error: mal })); return; }
                }
                r = skinshop.comprar({ cid, wallet, code, moneda, nonce: String(p.nonce || '') });
                if (r.ok && !r.repetida) {
                    logTx('skin', wallet || cid, moneda === 'pill' ? -skinshop.PRECIO_PILL : 0, 'skin ' + code + ' (' + moneda + ')');
                    log(`Skin ${code} comprada con ${moneda} por ${(wallet || cid).slice(0, 6)}…`);
                }
            } else if (urlPath === '/api/skins/equip') {
                r = skinshop.equipar({ cid, wallet, code: p.code === null ? null : String(p.code || '').toUpperCase() });
            } else {
                const pill = Math.floor(Number(p.pill) || 0);
                const ts = Number((p.pay || {}).ts) || 0;
                const mal = firmaVale(`PillWars convert ${pill} PILL to ${pill / skinshop.PILL_POR_SP} SP @ ${ts}`);
                if (mal) { res.end(JSON.stringify({ ok: false, error: mal })); return; }
                r = skinshop.convertir({ cid, wallet, pill, nonce: String(p.nonce || '') });
                if (r.ok && !r.repetida) log(`Cambio ${pill} $PILL -> ${pill / skinshop.PILL_POR_SP} SP por ${wallet.slice(0, 6)}…`);
            }
            res.end(JSON.stringify(r));
        });
        return;
    }

    /* Transacción de depósito, lista para firmar.
     *
     * Existe solo cuando hay contrato: sin él, el cliente construye una transferencia
     * SPL normal y no necesita al servidor para nada. Con contrato hay que llamar a
     * la instrucción `deposit`, que lleva discriminador y PDAs, y el bundle de Solana
     * que sirve la web no trae con qué construir instrucciones arbitrarias.
     *
     * Que la arme el servidor no le da poder sobre el dinero: la instrucción mueve
     * tokens del jugador al PDA de custodia y nada más — el mismo sitio al que iban
     * antes, pero sin llave privada detrás. Y la wallet la enseña antes de firmar.
     */
    if (urlPath === '/api/deposit-tx' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'demasiadas peticiones, espera un minuto' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            try {
                const p = JSON.parse(body || '{}');
                const wallet = String(p.wallet || '');
                const pill = Math.floor(Number(p.pill) || 0);
                if (!isSolAddr(wallet) || !(pill > 0)) { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
                if (!process.env.TREASURY_PROGRAM) { res.end(JSON.stringify({ ok: false, reason: 'sin contrato: usa la transferencia normal' })); return; }

                const tcl = require('./treasury-client.js');
                const { Transaction, PublicKey } = require('@solana/web3.js');
                const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
                const w = new PublicKey(wallet);
                const from = getAssociatedTokenAddressSync(new PublicKey(solana.MINT), w, true);
                const ix = tcl.deposit(process.env.TREASURY_PROGRAM, {
                    from, owner: wallet, amountRaw: solana.pillToRaw(pill),
                });
                const conn = _solConn();
                const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
                const tx = new Transaction({ feePayer: w, blockhash, lastValidBlockHeight }).add(ix);
                res.end(JSON.stringify({
                    ok: true,
                    tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
                    pill,
                }));
            } catch (e) { res.end(JSON.stringify({ ok: false, reason: e.message })); }
        });
        return;
    }

    // --- Acreditar un depósito: el cliente manda {wallet, sig}; verificamos on-chain y acreditamos ---
    if (urlPath === '/api/deposit' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'demasiadas peticiones, espera un minuto' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, reason: 'invalid json' })); return; }
            const wallet = String(p.wallet || ''), sig = String(p.sig || '');
            if (!isSolAddr(wallet) || !sig) { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
            // Anti doble-acreditación: la firma se reserva ANTES del await (la verificación
            // RPC tarda cientos de ms; dos requests simultáneas con la misma sig pasaban
            // ambas el sigUsed y se acreditaba dos veces). pendingDeposits cierra esa ventana.
            if (warbank.sigUsed(sig) || pendingDeposits.has(sig)) { res.end(JSON.stringify({ ok: false, reason: 'deposit already credited' })); return; }
            pendingDeposits.add(sig);
            let v;
            try {
                v = await solana.verifyDeposit({ sig, fromOwner: wallet, minPill: 1 });
            } finally { pendingDeposits.delete(sig); }
            if (!v.ok) { res.end(JSON.stringify({ ok: false, reason: v.reason || 'no verificado' })); return; }
            if (warbank.sigUsed(sig)) { res.end(JSON.stringify({ ok: false, reason: 'deposit already credited' })); return; }
            const saldo = warbank.creditDeposit(wallet, v.amount, sig);
            logTx('deposit', wallet, v.amount, 'on-chain', sig);
            logAdmin('-', 'Depósito $PILL', wallet.slice(0, 6) + '… +' + v.amount);
            log(`Depósito acreditado: ${wallet.slice(0, 6)}… +${v.amount} PILL → saldo ${saldo}`);
            res.end(JSON.stringify({ ok: true, credited: v.amount, warBalance: saldo }));
        });
        return;
    }
    // --- Retiro: descuenta del saldo WAR y envía PILL del treasury a la wallet ---
    if (urlPath === '/api/withdraw' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'demasiadas peticiones, espera un minuto' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, reason: 'invalid json' })); return; }
            const wallet = String(p.wallet || ''), amount = Math.floor(Number(p.amount) || 0);
            const ts = Number(p.ts) || 0, message = String(p.message || ''), signature = p.signature;
            if (!isSolAddr(wallet) || amount <= 0) { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
            // El jugador debe FIRMAR el retiro con su wallet (prueba que es el dueño).
            const expected = `PillWars withdraw ${amount} PILL @ ${ts}`;
            if (message !== expected) { res.end(JSON.stringify({ ok: false, reason: 'invalid message' })); return; }
            if (Math.abs(Date.now() - ts) > 120000) { res.end(JSON.stringify({ ok: false, reason: 'firma caducada, reintenta' })); return; }
            const sigKey = 'wd_' + (Array.isArray(signature) ? signature.join(',') : '');
            if (warbank.sigUsed(sigKey)) { res.end(JSON.stringify({ ok: false, reason: 'firma ya usada' })); return; }
            if (!solana.verifySignedMessage(wallet, message, signature)) { res.end(JSON.stringify({ ok: false, reason: 'invalid signature' })); return; }
            if (!solana.canWithdraw()) { res.end(JSON.stringify({ ok: false, reason: 'retiros no disponibles (servidor sin clave del treasury)' })); return; }
            if (warbank.getBalance(wallet) < amount) { res.end(JSON.stringify({ ok: false, reason: 'saldo WAR insuficiente' })); return; }
            warbank.creditDeposit(wallet, 0, sigKey);   // marca la firma como usada (anti-replay)
            // Descontamos ANTES de enviar (evita doble retiro); si falla on-chain, devolvemos.
            warbank.debit(wallet, amount);

            /* CON CONTRATO el retiro lo firma también el jugador, así que aquí solo se
             * prepara: se devuelve la transacción ya firmada por la autoridad y el
             * cliente la completa con su wallet en /api/withdraw/send.
             *
             * El saldo queda descontado desde ya y se anota como pendiente. Si el
             * jugador no termina, `barreRetirosPendientes` se lo devuelve en cuanto
             * caduca el blockhash — a partir de ahí esa transacción no puede
             * ejecutarse, así que devolver el saldo es seguro. */
            if (process.env.TREASURY_PROGRAM) {
                try {
                    const prep = await solana.prepararRetiro(wallet, amount);
                    retirosPendientes.set(wallet, { amount, creadoEn: Date.now(), lastValidBlockHeight: prep.lastValidBlockHeight });
                    log(`Retiro preparado: ${wallet.slice(0, 6)}… ${amount} PILL (falta la firma del jugador)`);
                    res.end(JSON.stringify({ ok: true, needsSignature: true, tx: prep.tx, amount, warBalance: warbank.getBalance(wallet) }));
                } catch (e) {
                    warbank.credit(wallet, amount);
                    log(`Retiro NO preparado (${wallet.slice(0, 6)}…): ${e.message} — saldo devuelto`);
                    res.end(JSON.stringify({ ok: false, reason: e.message }));
                }
                return;
            }

            try {
                const sig = await solana.withdraw(wallet, amount);
                const saldo = warbank.getBalance(wallet);
                logTx('withdraw', wallet, -amount, '', sig);
                logAdmin('-', 'Retiro $PILL', wallet.slice(0, 6) + '… -' + amount);
                log(`Retiro: ${wallet.slice(0, 6)}… -${amount} PILL → saldo ${saldo} (tx ${sig.slice(0, 8)}…)`);
                res.end(JSON.stringify({ ok: true, withdrawn: amount, warBalance: saldo, sig }));
            } catch (e) {
                warbank.credit(wallet, amount);   // refund del saldo WAR si el envío falló
                logTx('refund', wallet, amount, 'withdraw failed on-chain');
                log(`Retiro FALLÓ (${wallet.slice(0, 6)}…): ${e.message} — saldo devuelto`);
                res.end(JSON.stringify({ ok: false, reason: 'on-chain send failed: ' + e.message }));
            }
        });
        return;
    }

    /* Segundo paso del retiro con contrato: el jugador devuelve la transacción ya
     * firmada y el servidor la envía.
     *
     * Podría enviarla el propio cliente, pero entonces el servidor no sabría si salió,
     * y las dos opciones serían malas: dar el retiro por hecho sin que haya salido le
     * roba al jugador; no darlo por hecho habiéndose ejecutado le deja retirar dos
     * veces. Enviándola aquí, el servidor sabe el resultado con certeza. */
    if (urlPath === '/api/withdraw/send' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'too many requests' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 8000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, reason: 'invalid json' })); return; }
            const wallet = String(p.wallet || '');
            if (!isSolAddr(wallet) || typeof p.tx !== 'string') { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
            const pend = retirosPendientes.get(wallet);
            if (!pend) { res.end(JSON.stringify({ ok: false, reason: 'no pending withdrawal for that wallet' })); return; }
            try {
                const sig = await solana.enviarRetiro(p.tx);
                retirosPendientes.delete(wallet);   // el saldo ya se descontó al preparar
                const saldo = warbank.getBalance(wallet);
                logTx('withdraw', wallet, -pend.amount, '', sig);
                logAdmin('-', 'Retiro $PILL', wallet.slice(0, 6) + '… -' + pend.amount);
                log(`Retiro: ${wallet.slice(0, 6)}… -${pend.amount} PILL → saldo ${saldo} (tx ${sig.slice(0, 8)}…)`);
                res.end(JSON.stringify({ ok: true, withdrawn: pend.amount, warBalance: saldo, sig }));
            } catch (e) {
                // No se devuelve el saldo aquí: la transacción puede haber entrado y
                // estar solo tardando en confirmar. Lo devuelve el barrido cuando el
                // blockhash caduque, que es cuando ya es seguro.
                log(`Retiro no confirmado (${wallet.slice(0, 6)}…): ${e.message}`);
                res.end(JSON.stringify({ ok: false, reason: e.message }));
            }
        });
        return;
    }

    // --- Faucet de testnet: claim diario de $PILL o SOL (transfer on-chain real) ---
    if (urlPath === '/api/claim' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'demasiadas peticiones, espera un minuto' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, reason: 'invalid json' })); return; }
            const wallet = String(p.wallet || ''), kind = String(p.kind || '');
            if (!isSolAddr(wallet) || (kind !== 'pill' && kind !== 'sol')) { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
            if (!solana.canWithdraw()) { res.end(JSON.stringify({ ok: false, reason: 'faucet no disponible (servidor sin clave del treasury)' })); return; }
            const ip = anonIp(clientIp(req));
            const left = claimCooldownLeft(wallet, ip, kind);
            if (left > 0) { res.end(JSON.stringify({ ok: false, reason: 'ya reclamado hoy', nextInMs: left })); return; }
            // Marca ANTES de enviar (evita doble claim por requests solapadas); si falla, revierte.
            markClaim(wallet, ip, kind);
            try {
                const sig = (kind === 'pill')
                    ? await solana.withdraw(wallet, CLAIM_PILL)
                    : await solana.airdropSol(wallet, CLAIM_SOL);
                const amount = kind === 'pill' ? CLAIM_PILL : CLAIM_SOL;
                logAdmin('-', 'Faucet ' + kind, wallet.slice(0, 6) + '… +' + amount);
                log(`Faucet ${kind}: ${wallet.slice(0, 6)}… +${amount} (tx ${sig.slice(0, 8)}…)`);
                res.end(JSON.stringify({ ok: true, kind, amount, sig }));
            } catch (e) {
                // Revertir el cooldown: el claim no llegó, que pueda reintentar.
                if (faucet.wallets[wallet]) delete faucet.wallets[wallet][kind];
                if (faucet.ips[ip]) delete faucet.ips[ip][kind];
                faucetDirty = true;
                log(`Faucet ${kind} FALLÓ (${wallet.slice(0, 6)}…): ${e.message}`);
                res.end(JSON.stringify({ ok: false, reason: 'on-chain send failed: ' + e.message }));
            }
        });
        return;
    }

    // Endpoint público del ranking (para "Global Elite" en la web). Ordena por bestMass.
    if (urlPath === '/ranking.json' || urlPath === '/api/ranking') {
        // Sirve el cache — si está vacío (nunca actualizado) devuelve array vacío.
        // Actualizar desde el panel admin con cmd updateRanking.
        const top = _rankingCache.slice(0, 100).map(p => ({
            name: p.name, bestMass: p.bestMass | 0, kills: p.kills | 0,
            muertes: p.muertes | 0, partidas: p.partidas | 0,
            paisCode: p.paisCode, paisName: p.paisName
        }));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ranking: top, updated: _rankingUpdatedAt, stale: _rankingUpdatedAt === 0 }));
        return;
    }
    /* ===== TESORERÍA: LEADERBOARD DIARIO, PREMIOS Y TRANSPARENCIA =====
     *
     * Todo esto es público y sin autenticación a propósito. La promesa "no puedo
     * tocar la tesorería" no vale nada si los datos que la sostienen —quién ganó,
     * cuánto se repartió, cuánto hay en cada bolsa— solo los puedo ver yo. Un
     * endpoint que hay que pedir por privado no es una prueba, es una promesa.
     */

    // Leaderboard del día en curso (aún abierto, todavía sin hashear).
    if (urlPath === '/api/leaderboard') {
        const est = leaderboard.estadoHoy();
        // Y lo que se repartiria HOY con la gente que hay ahora mismo en la lista.
        // Es la pregunta que se hace cualquiera que la mire ("¿cuanto hay en juego?")
        // y la respuesta cambia sola con los cuatro frenos: el grifo del contrato, el
        // rake del dia, cuanta gente es elegible y los pesos de los puestos vacios.
        // Y los pagos ya hechos, con su firma. Es la otra mitad de la pregunta:
        // no solo "cuanto hay en juego" sino "¿de verdad paga?" — y esa se
        // responde ensenando transacciones, no promesas.
        let pagos = []; try { pagos = rewards.historialDePagos(14); } catch (e) {}
        rewards.proyeccionDeHoy(est).then(reparto => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(Object.assign({}, est, { reparto, pagos })));
        }).catch(() => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(est));
        });
        return;
    }

    /* Historial de una wallet: sus partidas ancladas, sus premios y sus firmas.
     *
     * Es lo que hay detras de cada nombre del top 10. Todo sale de los mismos
     * recibos que se anclan en la cadena por lotes, asi que cada linea se puede
     * seguir hasta una transaccion de Solana — el objetivo es que "ese jugador hizo
     * 40 kills" no haya que creerselo. */
    if (urlPath.startsWith('/api/player/')) {
        const wallet = urlPath.slice('/api/player/'.length);
        if (!isSolAddr(wallet)) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'invalid wallet' })); return;
        }
        let out;
        try { out = matches.historialDe(wallet, 40); } catch (e) { out = { error: e.message }; }
        // Sus premios del top 10, con la firma de la ronda en la que salieron.
        try { out.premios = rewards.premiosDe(wallet); } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(out));
        return;
    }
    /* Todo lo que hay en la cadena, digerido: que direcciones tiene el proyecto, que
     * hace cada una, cuanto guarda y quienes son los mayores holders.
     *
     * Existe porque abrir Solscan direccion por direccion no explica nada: sale una
     * lista de cuentas sin nombre y hay que acordarse de cual es cual. Y la pestaña
     * de holders de un token de devnet muchas veces ni se rellena. */
    if (urlPath === '/api/onchain') {
        require('./onchain.js').estado().then(o => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(o));
        }).catch(e => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: e.message }));
        });
        return;
    }

    // La cadena de hashes entera, y su verificación. Es lo que permite a cualquiera
    // comprobar que ningún día se reescribió después de cerrarse.
    if (urlPath === '/api/leaderboard/chain') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ chain: leaderboard.cadena(), check: leaderboard.verificarCadena() }));
        return;
    }
    // Un día cerrado: /api/leaderboard/2026-09-02
    if (urlPath.startsWith('/api/leaderboard/')) {
        const date = urlPath.slice('/api/leaderboard/'.length);
        const snap = /^\d{4}-\d{2}-\d{2}$/.test(date) ? leaderboard.diaCerrado(date) : null;
        res.writeHead(snap ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(snap || { error: 'no closed leaderboard for that date' }));
        return;
    }

    /* ===== STAKING =====
     *
     * El pool reparte los ingresos corrientes del juego —rake de partidas y tienda—
     * entre quien inmoviliza $PILL. Todo lo que hace falta para operarlo lo firma el
     * propio usuario: el servidor solo formatea la transacción, igual que en el claim.
     * Ni el principal ni las recompensas pasan por sus manos.
     */
    if (urlPath === '/api/stake' && req.method === 'GET') {
        const wallet = String(query.get('wallet') || '');
        stakeState(isSolAddr(wallet) ? wallet : null).then(st => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(st));
        }).catch(e => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: e.message }));
        });
        return;
    }
    /* Transacción de stake / unstake / cobro, lista para firmar.
     *
     * La firma es SIEMPRE del dueño y de nadie más: el contrato exige que el owner
     * firme y que el destino sea su propia cuenta asociada. Lo peor que puede hacer
     * un servidor comprometido aquí es devolver una transacción que falle. */
    if (urlPath === '/api/stake/tx' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'too many requests' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            try {
                const p = JSON.parse(body || '{}');
                const wallet = String(p.wallet || '');
                const accion = String(p.accion || '');
                const pill = Math.floor(Number(p.pill) || 0);
                if (!isSolAddr(wallet)) { res.end(JSON.stringify({ ok: false, reason: 'invalid wallet' })); return; }
                const st = require('./staking.js');
                if (!st.PROGRAMA) { res.end(JSON.stringify({ ok: false, reason: 'staking is not deployed yet' })); return; }

                const { Transaction, PublicKey } = require('@solana/web3.js');
                const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
                const w = new PublicKey(wallet);
                // Tres de las cinco acciones no llevan cantidad: retirar saca TODO lo
                // que ya cumplió la espera, y cobrar y componer, todo lo pendiente.
                if ((accion === 'stake' || accion === 'request_unstake') && !(pill > 0)) {
                    res.end(JSON.stringify({ ok: false, reason: 'invalid amount' })); return;
                }
                const ix = st.ix(accion, {
                    wallet,
                    amountRaw: solana.pillToRaw(pill),
                    from: getAssociatedTokenAddressSync(new PublicKey(solana.MINT), w, true),
                    mint: solana.MINT,
                });
                if (!ix) { res.end(JSON.stringify({ ok: false, reason: 'unknown action' })); return; }

                const conn = _solConn();
                const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
                const tx = new Transaction({ feePayer: w, blockhash, lastValidBlockHeight }).add(ix);
                res.end(JSON.stringify({
                    ok: true,
                    tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
                    accion, pill,
                }));
            } catch (e) { res.end(JSON.stringify({ ok: false, reason: e.message })); }
        });
        return;
    }

    /* ===== PRUEBA DE PASIVO =====
     *
     * Publicar cuánto hay en custodia es fácil; lo difícil es demostrar cuánto se
     * DEBE, porque ese número lo pone el servidor. Aquí va la lista completa de
     * saldos con su raíz anclada en la cadena: para reportar menos pasivo del que
     * hay tendría que quitarle saldo a alguien concreto, que lo va a ver.
     */
    if (urlPath === '/api/reserves') {
        const u = reserves.ultimo();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
            ultimo: u,
            snapshots: reserves.cadena(50),
            check: reserves.verificar(50),
            memoProgram: reserves.MEMO_PROGRAM,
        }));
        return;
    }
    // La fila de una wallet con su prueba: lo que mira un jugador para comprobar que
    // su saldo está bien contado en lo que publico.
    if (urlPath === '/api/reserves/proof') {
        const wallet = String(query.get('wallet') || '');
        const p = isSolAddr(wallet) ? reserves.pruebaDe(wallet) : null;
        res.writeHead(p ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(p || { error: 'no snapshot published yet' }));
        return;
    }
    if (urlPath.startsWith('/api/reserves/')) {
        const n = parseInt(urlPath.slice('/api/reserves/'.length), 10);
        const s = Number.isFinite(n) ? reserves.snapshot(n) : null;
        res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(s || { error: 'no snapshot with that number' }));
        return;
    }

    /* ===== RECIBOS DE PARTIDA =====
     *
     * Lo que permite clicar una kill del leaderboard y llegar a la partida donde se
     * hizo, con la hora que dice Solana y la firma con la que cada jugador pidió
     * entrar. Todo público: si hubiera que pedirlo, no sería una prueba.
     */
    if (urlPath === '/api/matches/chain') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
            memoProgram: matches.MEMO_PROGRAM,
            pendientes: matches.pendientes(),
            batches: matches.cadena(),
            check: matches.verificar(50),
        }));
        return;
    }
    // Con cuántas wallets distintas se ha cruzado cada una. Es lo que hace visible el
    // fraude que ninguna firma puede impedir: wallets que solo juegan entre ellas.
    if (urlPath === '/api/matches/opponents') {
        const dias = Math.max(1, Math.min(90, parseInt(query.get('dias'), 10) || 7));
        const mapa = matches.oponentesDe(Date.now() - dias * 86400e3);
        const filas = [...mapa].map(([wallet, v]) => ({ wallet, partidas: v.partidas, oponentes: v.oponentes }))
            .sort((a, b) => b.partidas - a.partidas).slice(0, 500);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ dias, minOponentes: leaderboard.MIN_OPONENTES, wallets: filas }));
        return;
    }
    if (urlPath.startsWith('/api/matches/batch/')) {
        const n = parseInt(urlPath.slice('/api/matches/batch/'.length), 10);
        const l = matches.lote(n);
        res.writeHead(l ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(l || { error: 'no batch with that number' }));
        return;
    }
    if (urlPath.startsWith('/api/matches/')) {
        const m = matches.partida(urlPath.slice('/api/matches/'.length));
        res.writeHead(m ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(m || { error: 'no hay recibo con ese id' }));
        return;
    }

    // Premios de una wallet, con la prueba de Merkle ya calculada: el jugador no
    // tiene que saber construir árboles, solo firmar.
    if (urlPath === '/api/rewards') {
        const wallet = String(query.get('wallet') || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        if (!isSolAddr(wallet)) { res.end(JSON.stringify({ pendientes: [], total: 0 })); return; }
        // Con contrato, los premios se cobran on-chain con su prueba de Merkle.
        // Sin contrato, el servidor paga cuando el jugador pulsa CLAIM — misma
        // pantalla, y solo se gasta gas por quien reclama de verdad.
        const out = rewards.premiosDe(wallet);
        if (!rewards.PROGRAM) {
            out.directos = rewards.premiosDirectosDe(wallet);
            out.modo = 'directo';
        } else out.modo = 'contrato';
        res.end(JSON.stringify(out));
        return;
    }

    /* CLAIM sin contrato: el jugador pulsa y el servidor le manda su premio.
     *
     * No pide firma del ganador a proposito, igual que el claim del contrato: el
     * destino no lo elige quien llama, sale de la lista ya anclada en la cadena.
     * Disparar el claim de otro solo consigue pagarle a el — y asi un ganador sin
     * SOL puede cobrar, porque el gas lo pone el servidor.
     *
     * Con el contrato desplegado este camino se cierra: alli se cobra con la prueba
     * de Merkle y el servidor no pinta nada. */
    if (urlPath === '/api/rewards/claim-direct' && req.method === 'POST') {
        if (rpcRateLimited(req)) {
            res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: false, reason: 'too many requests' })); return;
        }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 500) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            try {
                const p = JSON.parse(body || '{}');
                const wallet = String(p.wallet || '');
                const epoch = parseInt(p.epoch, 10);
                if (!isSolAddr(wallet)) { res.end(JSON.stringify({ ok: false, reason: 'invalid wallet' })); return; }
                if (!Number.isFinite(epoch)) { res.end(JSON.stringify({ ok: false, reason: 'invalid epoch' })); return; }
                if (rewards.PROGRAM) {
                    res.end(JSON.stringify({ ok: false, reason: 'a contract is deployed: claim on-chain instead' })); return;
                }
                const r = await rewards.pagarUno(epoch, wallet, solana, log);
                res.end(JSON.stringify(r.ok
                    ? { ok: true, pill: r.pill, sig: r.sig, anclaLeaderboard: r.anclaLeaderboard }
                    : { ok: false, reason: r.error, yaCobrado: !!r.yaCobrado }));
            } catch (e) { res.end(JSON.stringify({ ok: false, reason: e.message })); }
        });
        return;
    }
    /* Transacción de claim, lista para firmar.
     *
     * El servidor la construye, pero NO la firma ni puede desviarla: el destino de
     * los tokens es la ATA del ganador, derivada dentro del contrato a partir de la
     * hoja del Merkle. Lo peor que puede hacer un servidor comprometido aquí es
     * devolver una transacción que falle — la wallet la enseña antes de firmar.
     *
     * El feePayer es el jugador porque así no depende de nadie para cobrar. El
     * contrato permite que pague cualquiera (el `payer` del claim es un signer
     * suelto), así que si algún día se quiere reclamar automáticamente por los
     * ganadores, no hace falta tocar el programa.
     */
    if (urlPath === '/api/rewards/claim-tx' && req.method === 'POST') {
        // Pide un blockhash al RPC en cada llamada: sin tope, cualquiera agota la
        // cuota del nodo desde una pestana y deja sin cobrar a todo el mundo. Mismo
        // limitador que /api/deposit, que ya existia por esto exacto.
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'demasiadas peticiones, espera un minuto' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            try {
                const p = JSON.parse(body || '{}');
                const wallet = String(p.wallet || '');
                const epoch = parseInt(p.epoch, 10);
                if (!isSolAddr(wallet) || !Number.isFinite(epoch)) { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
                if (!process.env.TREASURY_PROGRAM) { res.end(JSON.stringify({ ok: false, reason: 'no treasury contract deployed yet' })); return; }

                const ronda = rewards.rondaPublica(epoch);
                const fila = ronda && ronda.entries.find(e => e.wallet === wallet);
                if (!fila) { res.end(JSON.stringify({ ok: false, reason: 'no hay premio para esa wallet en esa ronda' })); return; }

                const tcl = require('./treasury-client.js');
                const { Transaction, PublicKey } = require('@solana/web3.js');
                const ix = tcl.claim(process.env.TREASURY_PROGRAM, {
                    epoch, winner: wallet, amountRaw: BigInt(fila.amountRaw),
                    proof: fila.proof, mint: solana.MINT, payer: wallet,
                });
                const conn = _solConn();
                const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
                const tx = new Transaction({ feePayer: new PublicKey(wallet), blockhash, lastValidBlockHeight }).add(ix);
                res.end(JSON.stringify({
                    ok: true,
                    tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
                    amountRaw: fila.amountRaw, rank: fila.rank, epoch,
                }));
            } catch (e) {
                res.end(JSON.stringify({ ok: false, reason: e.message }));
            }
        });
        return;
    }
    /* Aviso de que un claim se confirmó, para que el botón desaparezca sin esperar al
     * siguiente refresco.
     *
     * NO SE CREE EL AVISO: lo comprueba. El recibo de un cobro es un PDA que solo el
     * contrato puede crear, así que el servidor lo lee y solo marca si existe de
     * verdad. Sin esa comprobación, cualquiera podría marcar los premios de todo el
     * mundo como cobrados y esconderles el botón CLAIM — el dinero seguiría siendo
     * suyo y reclamable on-chain, pero no lo verían, que a efectos prácticos es lo
     * mismo que quitárselo.
     *
     * Va con el mismo tope de peticiones que el resto: lee del RPC. */
    if (urlPath === '/api/rewards/claimed' && req.method === 'POST') {
        if (rpcRateLimited(req)) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ ok: false, reason: 'too many requests' })); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 500) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            try {
                const p = JSON.parse(body || '{}');
                const wallet = String(p.wallet || '');
                const epoch = parseInt(p.epoch, 10);
                if (!isSolAddr(wallet) || !Number.isFinite(epoch)) { res.end(JSON.stringify({ ok: false, reason: 'invalid data' })); return; }
                if (!process.env.TREASURY_PROGRAM) { res.end(JSON.stringify({ ok: false, reason: 'sin contrato' })); return; }

                const tcl = require('./treasury-client.js');
                const recibo = tcl.claimPda(process.env.TREASURY_PROGRAM, epoch, wallet);
                const info = await _solConn().getAccountInfo(recibo);
                if (!info) { res.end(JSON.stringify({ ok: false, reason: 'ese cobro no existe on-chain' })); return; }

                rewards.marcarCobrado(epoch, wallet, String(p.sig || '').slice(0, 128));
                res.end(JSON.stringify({ ok: true }));
            } catch (e) { res.end(JSON.stringify({ ok: false, reason: e.message })); }
        });
        return;
    }
    // La ronda completa de una época: la lista de ganadores con sus pruebas. Es el
    // fichero que hay que bajarse para auditar una raíz publicada on-chain.
    if (urlPath.startsWith('/api/rewards/')) {
        const epoch = parseInt(urlPath.slice('/api/rewards/'.length), 10);
        const ronda = Number.isFinite(epoch) ? rewards.rondaPublica(epoch) : null;
        res.writeHead(ronda ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(ronda || { error: 'no round for that epoch' }));
        return;
    }

    // Estado de la tesorería: las dos bolsas, las obligaciones y la prueba de
    // reservas. Ver treasuryState() para por qué cada campo está aquí.
    if (urlPath === '/api/treasury') {
        treasuryState().then(estado => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(estado));
        }).catch(e => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: e.message }));
        });
        return;
    }

    // Endpoint de quests: GET → lee el progreso del clientId; POST → suma eventos.
    if (urlPath === '/api/quests') {
        const cid = String(req.headers['x-client-id'] || '').trim();
        if (!isValidClientId(cid)) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Client-Id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
            res.end(JSON.stringify({ error: 'invalid clientId' }));
            return;
        }
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Client-Id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
            res.end(); return;
        }
        const q = questsOf(cid);
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ quests: q }));
            return;
        }
        if (req.method === 'POST') {
            let body = ''; let abortado = false;
            req.on('data', c => { if (abortado) return; body += c; if (body.length > 2048) { abortado = true; res.writeHead(413); res.end('Payload too large'); req.destroy(); } });
            req.on('end', () => {
                if (abortado) return;
                let ev = {}; try { ev = JSON.parse(body || '{}'); } catch (e) {}
                // BLINDAJE: las quests "verificables por la sim" (mass, skills, game_finished,
                // online_match) las cuenta el servidor cuando ve los eventos reales del juego.
                // El cliente solo puede reportar "classic_survived" (que requiere salir vivo
                // con BACK TO MENU, algo que el servidor no detecta por sí solo); todo lo
                // demás se ignora aunque venga en el POST.
                if (ev.classic_survived) q.q5_classic_survived = Math.min(2, (q.q5_classic_survived | 0) + 1);
                q.updated = Date.now(); questsDirty = true;
                const done = [
                    q.q1_games_finished >= 2,
                    q.q2_online_matches >= 2,
                    q.q3_skills_in_arcade >= 8,
                    q.bestMass >= 100000,
                    q.q5_classic_survived >= 2
                ].filter(Boolean).length;
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ quests: q, completed: done, unlocked: done >= 3 }));
            });
            return;
        }
        res.writeHead(405, { 'Allow': 'GET, POST, OPTIONS', 'Access-Control-Allow-Origin': '*' });
        res.end('Method Not Allowed'); return;
    }
    if (urlPath === ADMIN_PATH) {
        try {
            let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
            // El cliente (admin.html) necesita saber el path real para construir el
            // WS/APIs con el mismo prefijo /hN detrás del proxy (ver BASE_PATH ahi).
            // Se inyecta en vez de que el JS asuma "/admin": si mañana se cambia
            // ADMIN_PATH solo hay que tocar la env, no el HTML.
            html = html.replace('<head>', '<head><script>window.__ADMIN_PATH__=' + JSON.stringify(ADMIN_PATH) + ';</script>');
            // CSP cerrada (sin analytics/CDN/RPC): estas dos páginas no los usan
            // y son las que más daño harían comprometidas.
            res.setHeader('Content-Security-Policy', CSP_ADMIN);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(html);
        } catch (e) { res.writeHead(500); res.end('No se pudo cargar admin.html'); }
        return;
    }
    if (urlPath === CARTELES_PATH) {
        try {
            const html = fs.readFileSync(path.join(ROOT, 'carteles-preview.html'));
            res.setHeader('Content-Security-Policy', CSP_ADMIN);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(html);
        } catch (e) { res.writeHead(500); res.end('No se pudo cargar carteles-preview.html'); }
        return;
    }
    // Estáticos del juego servidos desde la raíz del repo (mismo origen que el WS):
    // así el espectador del panel y un único túnel sirven web + juego + websocket.
    let rel = urlPath.replace(/^\/+/, '') || 'index.html';
    let filePath = path.normalize(path.join(ROOT, rel));
    // Comparar con separador: sin él, un directorio hermano cuyo nombre empiece
    // igual que ROOT (p.ej. "FlashGame-main-backup") pasaría el guard.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    // Nunca servir carpetas privadas (datos con IPs, código de servidor, repo, notas).
    // deploy/scripts/tools/chatbot-backend/stress_bot/.codegraph no las necesita
    // el juego (nada del cliente les hace fetch) — eran descargables sin
    // querer: deploy/pillwars.service y deploy/Caddyfile enseñaban toda la
    // arquitectura (puertos, hosts, rutas de admin) a quien los pidiera. docs/
    // es lo mismo en dibujo: el mapa de arquitectura generado con Archify.
    const relLower = path.relative(ROOT, filePath).replace(/\\/g, '/').toLowerCase();
    const top = relLower.split('/')[0];
    if (['server', '.git', 'node_modules', 'tasks', '.claude', 'memory',
         'deploy', 'scripts', 'tools', 'chatbot-backend', 'stress_bot', '.codegraph',
         'docs'].includes(top)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    // Los .md de la raíz (ROADMAP, BLOCKCHAIN-PLAN, DESPLIEGUE-VPS...) son notas
    // internas, no páginas del juego: mismo motivo, tampoco hace falta servirlas.
    if (relLower.endsWith('.md')) { res.writeHead(403); res.end('Forbidden'); return; }
    // El editor de carteles solo se sirve por CARTELES_PATH (arriba): el nombre
    // literal se bloquea aqui para que ni conociendolo se pueda pedir directo.
    if (relLower === 'carteles-preview.html') { res.writeHead(404); res.end('Not Found'); return; }
    // 'no-cache' NO significa "no guardes": significa "pregunta antes de usarlo".
    // Lo que faltaba era el Last-Modified para poder contestar 304 y no reenviar
    // el fichero entero — sin él, cada F5 se volvía a bajar TODO el arte del
    // juego (~15 MB entre carteles e iconos de skill). El código (html/js) sigue
    // revalidando igual, así que un cambio se ve al instante como siempre.
    const no404 = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); };
    let yaDir = false;
    const servir = () => fs.stat(filePath, (err, st) => {
        if (err) return no404();
        if (st.isDirectory()) {
            if (yaDir) return no404();
            yaDir = true; filePath = path.join(filePath, 'index.html'); return servir();
        }
        const lastMod = st.mtime.toUTCString();
        const desde = Date.parse(req.headers['if-modified-since'] || '');
        // mtime a segundos: If-Modified-Since no tiene milisegundos.
        if (!isNaN(desde) && desde >= Math.floor(st.mtimeMs / 1000) * 1000) {
            res.writeHead(304, { 'Cache-Control': 'no-cache', 'Last-Modified': lastMod });
            res.end(); return;
        }
        fs.readFile(filePath, (e2, data) => {
            if (e2) return no404();
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': lastMod });
            res.end(data);
        });
    });
    servir();
});

// maxPayload: el rate-limit por conexión (MSG_RATE_*) se evalúa en el evento
// 'message', o sea DESPUÉS de que el frame entero esté en memoria. Con el
// default de `ws` (100 MiB) unas pocas conexiones mandando frames gigantes
// tumbaban el proceso por RAM antes de que el contador llegara a mirarlos.
// 64 KB sobra de largo: el mensaje más grande que manda el cliente real es un
// join con nombre y colores (unos cientos de bytes).
const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
    // Contador de egress (panel Rendimiento): se envuelve el send UNA vez por
    // socket y cuenta TODO lo que sale (snaps, events, welcome, lb, admin...).
    // Un solo punto de medida en vez de tocar cada send del room-loop.
    const _rawSend = ws.send;
    ws.send = function (data, opts, cb) {
        _netBytes += typeof data === 'string' ? Buffer.byteLength(data) : ((data && data.length) || 0);
        return _rawSend.call(this, data, opts, cb);
    };
    let room = null, playerId = null, spectatorRoom = null;
    let joinPending = false;   // join en vuelo (authorizeEntry es async): bloquea joins dobles
    let rlWindow = 0, rlCount = 0;   // rate-limit: ventana (segundo) y mensajes en ella
    // Detrás del proxy (Caddy) la IP real la añade él al final de x-forwarded-for
    // (ver clientIp: el principio de esa lista lo controla el cliente).
    // Se anonimiza de inmediato (RGPD): nunca se almacena ni se muestra la IP exacta.
    const ip = anonIp(clientIp(req));

    ws.on('message', raw => {
        // Rate-limit por conexión: contador por segundo (antes de parsear, para no
        // gastar CPU en un flood). Exceso suave → descartar; flood duro → cerrar.
        const rlSec = (Date.now() / 1000) | 0;
        if (rlSec !== rlWindow) { rlWindow = rlSec; rlCount = 0; }
        if (++rlCount > MSG_RATE_HARD) {
            log(`[seguridad] Conexión ${ip} cerrada por flood (>${MSG_RATE_HARD} msg/s)`);
            try { ws.close(); } catch (e) {}
            return;
        }
        if (rlCount > MSG_RATE_SOFT) return;   // descarta el exceso sin procesar

        let msg; try { msg = JSON.parse(raw); } catch (e) { return; }

        // Ping/pong: latencia real (RTT). Responde al instante, sin tocar la sala.
        if (msg.t === 'ping') { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', ts: msg.ts })); return; }

        // --- Administración ---
        if (msg.t === 'admin') {
            // Rate-limit por IP: 8 intentos fallidos / 60s → bloqueo 10 min
            const fb = adminFails.get(ip) || { c: 0, until: 0 };
            if (fb.until > Date.now()) { ws.send(JSON.stringify({ t: 'adminError' })); return; }
            const validKey = adminKeyOk(msg.key);
            const validTok = msg.key && specTokens.has(msg.key) && specTokens.get(msg.key) > Date.now();
            if (!validKey && !validTok) {
                fb.c++; if (fb.c >= 8) { fb.until = Date.now() + 10*60*1000; fb.c = 0; log(`[seguridad] IP ${ip} bloqueada 10 min por intentos fallidos de admin`); }
                adminFails.set(ip, fb);
                ws.send(JSON.stringify({ t: 'adminError' })); return;
            }
            adminFails.delete(ip);
            // El token de espectador-control (viaja en la URL ?t=) solo autoriza los
            // comandos que usa esa vista, TODOS de ámbito sala. Nunca comandos globales
            // (restartServer, resets, config, getSpecToken...): para eso hace falta la
            // ADMIN_KEY real. Sin esto, un token filtrado (historial/logs) daba admin total.
            if (!validKey && !SPEC_TOKEN_CMDS.has(msg.cmd)) { ws.send(JSON.stringify({ t: 'adminError' })); return; }
            // Token temporal para el espectador-control (10 min, single-use)
            if (msg.cmd === 'getSpecToken') {
                // Con hostId (panel del Director espiando una sala de un host): el
                // token debe emitirlo ESE host — el espectador conecta a su WS y los
                // specTokens son por proceso. Se devuelve también el puerto para que
                // el panel construya la URL en local (en prod usa el path /hN).
                if (PW_ROLE === 'director' && typeof msg.hostId === 'number' && hostProcs.has(msg.hostId)) {
                    const h = hostProcs.get(msg.hostId);
                    if (h && h.alive) {
                        h.ipc.request('makeSpecToken', {})
                            .then(r => { if (r && r.token && ws.readyState === 1) ws.send(JSON.stringify({ t: 'specToken', token: r.token, hostId: msg.hostId, port: h.port })); })
                            .catch(() => {});
                    }
                    return;
                }
                const tok = require('crypto').randomBytes(24).toString('hex');
                specTokens.set(tok, Date.now() + 10*60*1000);
                ws.send(JSON.stringify({ t: 'specToken', token: tok }));
                return;
            }
            if (msg.cmd === 'state') {
                if (PW_ROLE === 'director') buildDirectorAdminState().then(state => ws.send(JSON.stringify(state)));
                else ws.send(JSON.stringify(buildAdminState()));
            } else if (ROOM_ADMIN_CMDS.has(msg.cmd)) {
                // Ámbito sala/jugador: local (en director es no-op, las salas viven
                // en los hosts) + reenvío IPC a todos los hosts. El dueño actúa.
                applyRoomAdminCmd(msg);
                if (PW_ROLE === 'director') relayRoomCmdToHosts(msg);
            } else if (msg.cmd === 'setGlobal') {
                if (typeof msg.arcadeRestartMs === 'number') arcadeRestartMs = Math.max(1000, Math.min(300000, msg.arcadeRestartMs | 0));
                if (typeof msg.arcadeLobbyMs === 'number')  arcadeLobbyMs  = Math.max(0,    Math.min(120000, msg.arcadeLobbyMs  | 0));
                saveGlobal();
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global arcade: restart=${arcadeRestartMs / 1000}s lobby=${arcadeLobbyMs / 1000}s`);
            } else if (msg.cmd === 'setVolumes') {
                if (typeof msg.sfxVol === 'number')   sfxVol   = _clamp01(msg.sfxVol);
                if (typeof msg.musicVol === 'number') musicVol = _clamp01(msg.musicVol);
                saveGlobal();
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global volumen: efectos=${Math.round(sfxVol * 100)}% música=${Math.round(musicVol * 100)}%`);
            } else if (msg.cmd === 'setEnemyFx') {
                enemyFx = !!msg.on;
                saveGlobal();
                // Avisar en vivo a todos los jugadores online (de ESTE proceso).
                for (const r of rooms.values()) broadcast(r, { t: 'enemyFx', on: enemyFx });
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global animaciones de enemigos: ${enemyFx ? 'ON' : 'OFF'}`);
            } else if (msg.cmd === 'setBaseZoom') {
                if (typeof msg.value === 'number') baseZoom = _clampZoom(msg.value);
                saveGlobal();
                // Aplicar en vivo a todos los jugadores online (y espectadores) de ESTE proceso.
                for (const r of rooms.values()) broadcast(r, { t: 'baseZoom', value: baseZoom });
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global zoom base: ${baseZoom}`);
            } else if (msg.cmd === 'setZoomExp') {
                if (typeof msg.value === 'number') zoomExp = _clampZoomExp(msg.value);
                saveGlobal();
                // Aplicar en vivo a todos los jugadores online (y espectadores) de ESTE proceso.
                // El AOI (aoiBoxFor) lee `zoomExp` directamente, así que la caja que se
                // sirve a cada cliente se actualiza sola en el siguiente tick — no hace
                // falta reenviar nada aparte del zoomExp al cliente.
                for (const r of rooms.values()) broadcast(r, { t: 'zoomExp', value: zoomExp });
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global zoom exponent: ${zoomExp}`);
            } else if (msg.cmd === 'setPillBandRef') {
                if (typeof msg.value === 'number') pillBandRef = _clampPillBandRef(msg.value);
                saveGlobal();
                for (const r of rooms.values()) broadcast(r, { t: 'pillBandRef', value: pillBandRef });
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global pill band ref: ${pillBandRef}`);
            } else if (msg.cmd === 'setPillBandSlow') {
                if (typeof msg.value === 'number') pillBandSlow = _clampPillBandSlow(msg.value);
                saveGlobal();
                for (const r of rooms.values()) broadcast(r, { t: 'pillBandSlow', value: pillBandSlow });
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global pill band slow: ${pillBandSlow}`);
            } else if (msg.cmd === 'setMenuDeco') {
                // Decoracion cosmetica del fondo del menu (food/virus, bob de
                // pildora/carteles, tamano de rejilla) — misma mecanica que
                // setVolumes/setBaseZoom, pero sin broadcast a salas en curso
                // (solo lo lee el menu, vía /api/rooms, antes de entrar a jugar).
                if (typeof msg.foodDensity === 'number') menuDecoFoodDensity = _clampN(msg.foodDensity, 0, 150, menuDecoFoodDensity);
                if (typeof msg.virusCount === 'number') menuDecoVirusCount = _clampN(msg.virusCount, 1, 10, menuDecoVirusCount);
                if (typeof msg.pillBobPx === 'number') menuDecoPillBobPx = _clampN(msg.pillBobPx, 0, 12, menuDecoPillBobPx);
                if (typeof msg.cartelBobPx === 'number') menuDecoCartelBobPx = _clampN(msg.cartelBobPx, 0, 12, menuDecoCartelBobPx);
                if (typeof msg.gridSize === 'number') menuDecoGridSize = _clampN(msg.gridSize, 8, 40, menuDecoGridSize);
                if (typeof msg.selectorGlowPct === 'number') menuDecoSelectorGlowPct = _clampN(msg.selectorGlowPct, 0, 300, menuDecoSelectorGlowPct);
                if (typeof msg.blurbGlowPct === 'number') menuDecoBlurbGlowPct = _clampN(msg.blurbGlowPct, 0, 300, menuDecoBlurbGlowPct);
                if (typeof msg.virusTP === 'boolean') menuDecoVirusTP = msg.virusTP;
                if (msg.cartelStyle === 1 || msg.cartelStyle === 2) menuCartelStyle = msg.cartelStyle;
                if (typeof msg.dimPct === 'number') menuDecoDimPct = _clampN(msg.dimPct, 0, 80, menuDecoDimPct);
                // Interruptor de los editores de layout (landing + menu del juego).
                if (typeof msg.layoutEdit === 'boolean') layoutEdit = msg.layoutEdit;
                saveGlobal();
                if (PW_ROLE === 'director') pushSettingsToHosts();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global menu visuals: food=${menuDecoFoodDensity} virus=${menuDecoVirusCount} pillBob=${menuDecoPillBobPx}px cartelBob=${menuDecoCartelBobPx}px grid=${menuDecoGridSize}px virusTP=${menuDecoVirusTP} dim=${menuDecoDimPct}% selGlow=${menuDecoSelectorGlowPct}% blurbGlow=${menuDecoBlurbGlowPct}% layoutEdit=${layoutEdit}`);
            } else if (msg.cmd === 'announce') {
                const text = (typeof msg.text === 'string') ? msg.text.slice(0, 140) : '';
                if (text) {
                    const n = applyAnnounce(text);
                    if (PW_ROLE === 'director') for (const h of hostProcs.values()) if (h.alive) h.ipc.notify('adminAnnounce', { text });
                    logAdmin('-', 'Anuncio a todos', text);
                    log(`ADMIN anuncio a ${n} jugadores: ${text}`);
                }
                ws.send(JSON.stringify(buildAdminState()));
            /* ===== TESORERÍA =====
             * Los dos únicos comandos que hacen falta desde el panel. El resto de la
             * operación (init, extend-lock, tighten, finalize) vive en
             * scripts/treasury.js y NO se expone aquí a propósito: son irreversibles
             * y piden escribir a mano lo que va a pasar. Un botón en un panel web,
             * detrás de una sola clave, es demasiado fácil de pulsar sin querer para
             * algo que no tiene deshacer.
             */
            } else if (msg.cmd === 'closeDay') {
                const snap = leaderboard.cerrarAhora();
                logAdmin('-', 'Cerró el leaderboard del día', snap ? snap.date : '(nada)');
                log(`ADMIN cerró el leaderboard del ${snap ? snap.date : '?'}: hash ${snap ? snap.hash.slice(0, 12) : '-'}…`);
                ws.send(JSON.stringify({ t: 'treasuryCmd', ok: !!snap, date: snap && snap.date, hash: snap && snap.hash }));
            } else if (msg.cmd === 'rewardsTick') {
                rewards.tick(solana, log).then(hecho => {
                    logAdmin('-', 'Forzó el ciclo de premios', JSON.stringify(hecho));
                    ws.send(JSON.stringify({ t: 'treasuryCmd', ok: true, hecho }));
                }).catch(e => {
                    log('ADMIN ciclo de premios falló: ' + e.message);
                    ws.send(JSON.stringify({ t: 'treasuryCmd', ok: false, error: e.message }));
                });
            } else if (msg.cmd === 'snapshotHz' && typeof msg.hz === 'number') {
                const hz = msg.hz | 0;
                if (PW_ROLE === 'director') {
                    logAdmin('-', 'Cambió snapshots Hz (hosts)', String(hz));
                    log(`ADMIN snapshots (reenviado a hosts): ${hz}Hz`);
                    pushPerfToHosts(msg.hostIds, { snapshotHz: hz }).then(async () => ws.send(JSON.stringify(await buildDirectorAdminState())));
                } else {
                    const prev = Math.round(TICK_HZ / SNAPSHOT_EVERY);
                    SNAPSHOT_EVERY = hzToEvery(hz);
                    const now = Math.round(TICK_HZ / SNAPSHOT_EVERY);
                    logAdmin('-', 'Cambió snapshots Hz', prev + ' → ' + now);
                    log(`ADMIN snapshots: ${prev}Hz → ${now}Hz (cada ${SNAPSHOT_EVERY} ticks)`);
                }
            } else if (msg.cmd === 'aoiToggle') {
                if (PW_ROLE === 'director') {
                    // En director cada host puede tener un estado distinto (override por
                    // host de "Rendimiento"): el panel manda el estado FINAL deseado, no
                    // un flip ambiguo (msg.on) + a qué hosts aplica (msg.hostIds).
                    const on = !!msg.on;
                    logAdmin('-', 'AOI (hosts) ' + (on ? 'ACTIVADO' : 'DESACTIVADO'), '');
                    log(`ADMIN AOI (reenviado a hosts): ${on ? 'ON' : 'OFF'}`);
                    pushPerfToHosts(msg.hostIds, { aoiEnabled: on }).then(async () => ws.send(JSON.stringify(await buildDirectorAdminState())));
                } else {
                    AOI_ENABLED = !AOI_ENABLED;
                    logAdmin('-', 'AOI ' + (AOI_ENABLED ? 'ACTIVADO' : 'DESACTIVADO'), '');
                    log(`ADMIN AOI: ${AOI_ENABLED ? 'ON' : 'OFF'}`);
                }
            } else if (msg.cmd === 'kickAllMode' && msg.mode) {
                const n = applyKickAllMode(msg.mode);
                if (PW_ROLE === 'director') for (const h of hostProcs.values()) if (h.alive) h.ipc.notify('adminKickMode', { mode: msg.mode });
                logAdmin('-', `Echó a todos del modo ${msg.mode}`, `${n} IPs bloqueadas 30s`);
                log(`ADMIN kickAll modo=${msg.mode}: ${n} IPs bloqueadas 30s`);
            } else if (msg.cmd === 'restartMode' && msg.mode) {
                const n = applyRestartMode(msg.mode);
                if (PW_ROLE === 'director') for (const h of hostProcs.values()) if (h.alive) h.ipc.notify('adminRestartMode', { mode: msg.mode });
                logAdmin('-', `Reinició modo ${msg.mode}`, `${n} salas`);
                log(`ADMIN restartMode=${msg.mode}: ${n} salas`);
            } else if (msg.cmd === 'setHostAssign' && msg.assign && typeof msg.assign === 'object') {
                // Asignación manual combo→host (panel Settings, solo Director/mono).
                // Reemplaza hostassign.json entero: el cliente manda el estado completo
                // de las 10 combos. Requiere "Restart Server" para que los hosts
                // reforkeados (y este mismo proceso) recalculen SHARD con el nuevo mapa.
                if (PW_ROLE !== 'host') {
                    const hostCount = PW_ROLE === 'mono' ? 1 : PW_HOST_COUNT;
                    const validCombos = new Set(listCombos(CATALOG_MODES, PRICES));
                    const clean = {};
                    for (const [combo, hostId] of Object.entries(msg.assign)) {
                        if (!validCombos.has(combo)) continue;
                        if (hostId === null) { clean[combo] = null; continue; }   // Off explícito: se guarda, no se omite
                        const h = parseInt(hostId, 10);
                        if (Number.isInteger(h) && h >= 0 && h < hostCount) clean[combo] = h;
                    }
                    const activos = Object.values(clean).filter(v => v !== null).length;
                    // Síncrono: el panel relee este fichero en el siguiente poll (evita
                    // que un chip recién arrastrado "vuelva" por una lectura vieja).
                    try { fs.writeFileSync(HOSTASSIGN_FILE, JSON.stringify(clean, null, 2)); } catch (e) {}
                    logAdmin('-', 'Cambió la asignación de salas por host', activos + '/' + validCombos.size + ' combos activos');
                    log('ADMIN guardó hostassign.json — hace falta reiniciar el servidor para aplicarlo');
                    ws.send(JSON.stringify({ t: 'hostAssignSaved' }));
                }
            } else if (msg.cmd === 'restartServer') {
                // Solo el Director (o mono) puede autoreiniciarse desde aquí: un host del
                // split corta partidas en curso de sus 5 combos sin previo aviso al panel
                // del propio host — esa acción no está en el panel de host (se quitó el
                // botón), y aquí lo bloqueamos también por si llega el cmd de otra forma.
                if (PW_ROLE !== 'host') {
                    logAdmin('-', 'Reinició el servidor', '');
                    log('ADMIN ordenó reinicio del proceso — saliendo en 500ms');
                    ws.send(JSON.stringify({ t: 'serverRestarting' }));
                    // Dar tiempo al admin a recibir el ack antes de salir.
                    // pm2/forever/systemd relanzarán el proceso automáticamente.
                    setTimeout(() => process.exit(0), 500);
                }
            } else if (msg.cmd === 'updateRanking') {
                rankingIncludeTesters = !!msg.includeTesters; saveGlobal();
                computeRanking(rankingIncludeTesters);
                playersDirty = true;   // aprovechar para forzar save tras recalcular
                logAdmin('-', 'Actualizó el ranking', msg.includeTesters ? 'con testers' : 'sin testers');
            } else if (msg.cmd === 'deleteRanking' && msg.playerKey) {
                const key = String(msg.playerKey).toLowerCase();
                if (playerStats[key]) {
                    const nombre = playerStats[key].name || msg.playerKey;
                    delete playerStats[key]; playersDirty = true;
                    logAdmin('-', 'Borró del ranking', nombre);
                    log(`ADMIN borró del ranking: ${nombre}`);
                    if (_rankingUpdatedAt > 0) computeRanking(_rankingIncludesTesters);
                }
            } else if (msg.cmd === 'deleteRankingMany' && Array.isArray(msg.keys)) {
                let borrados = 0;
                for (const raw of msg.keys.slice(0, 500)) {
                    const key = String(raw).toLowerCase();
                    if (playerStats[key]) { delete playerStats[key]; borrados++; }
                }
                if (borrados) {
                    playersDirty = true;
                    logAdmin('-', 'Borró del ranking (lote)', borrados + ' jugadores');
                    log(`ADMIN borró ${borrados} jugadores del ranking`);
                    if (_rankingUpdatedAt > 0) computeRanking(_rankingIncludesTesters);
                }
            } else if (msg.cmd === 'resetQuests') {
                const cuantos = Object.keys(questsStore).length;
                for (const k of Object.keys(questsStore)) delete questsStore[k];
                questsDirty = true;
                logAdmin('-', 'Reseteó las quests de todos', cuantos + ' jugadores');
                log(`ADMIN reseteó quests (${cuantos} jugadores)`);
            } else if (msg.cmd === 'resetStats') {
                const scope = msg.scope || 'counters';
                for (const k of Object.keys(roomStats)) { roomStats[k] = { entradas: 0, muertes: 0, entradasReal: 0, muertesReal: 0 }; }
                statsDirty = true;
                connLog.length = 0;
                if (scope === 'all') {
                    for (const k of Object.keys(playerStats)) delete playerStats[k];
                    playersDirty = true;
                    logAdmin('-', 'Reset TOTAL (stats + ranking + log)', '');
                    log('ADMIN reset total de stats, ranking y log');
                } else {
                    logAdmin('-', 'Reset contadores (entradas/muertes/log)', '');
                    log('ADMIN reset contadores de stats y log');
                }
            }
            return;
        }

        // --- Espectador puro (panel de control): mira la sala sin jugar ---
        if (msg.t === 'spectate' && !room && !spectatorRoom) {
            spectatorRoom = gameHost.handleSpectate(ws, msg);
            return;
        }

        if (msg.t === 'join' && !room) {
            // El GameHost orquesta matchmaking + sim + welcome; el cobro/stats los hace
            // vía director.*. Desde 4a.4.3 handleJoin es ASYNC (authorizeEntry puede ir
            // por IPC): hay que esperar la promesa, y mientras está en vuelo se ignoran
            // joins repetidos (un doble join podría intentar cobrar dos veces; además
            // el anti-replay de la firma pararía el segundo cobro en el Director).
            if (joinPending) return;
            joinPending = true;
            Promise.resolve(gameHost.handleJoin(ws, ip, msg))
                .then(res => { if (res) { room = res.room; playerId = res.playerId; } })
                .catch(e => { log('handleJoin error: ' + (e && e.stack || e)); })
                .finally(() => { joinPending = false; });
            return;
        }
        if (!room || !playerId) return;

        // Mensajes de juego (ready/input/aspect/action/pickSkill/reorder/cmd): los
        // rutea el GameHost a su sim. join/close (pago, stats) siguen aquí.
        gameHost.handleInput(room, playerId, msg);
    });

    ws.on('close', () => gameHost.handleClose(ws, room, playerId, spectatorRoom));
    ws.on('error', () => {});
});

// === Métricas del tick loop (para diagnosticar microparones/lag-tick) ===
// Ring buffer de las últimas N muestras. Se expone en /api/health.
// - lag: cuánto se desvió el setInterval del intervalo nominal (drift, ms)
// - step: tiempo en sim.step() sumado entre todas las salas
// - snap: tiempo en buildSnapshot + JSON.stringify del snapshot
// - send: tiempo enviando a clientes y espectadores
// - total: tiempo total del callback del setInterval
const TICK_HIST_LEN = 240;   // ~6s a 40Hz
const tickHist = {
    lag:   new Float32Array(TICK_HIST_LEN),
    step:  new Float32Array(TICK_HIST_LEN),
    snap:  new Float32Array(TICK_HIST_LEN),
    send:  new Float32Array(TICK_HIST_LEN),
    total: new Float32Array(TICK_HIST_LEN),
    i: 0, n: 0
};
let _lastTickT = 0;
function pStats(arr, n) {
    if (!n) return { p50: 0, p95: 0, max: 0 };
    const tmp = new Array(n); for (let i = 0; i < n; i++) tmp[i] = arr[i];
    tmp.sort((a, b) => a - b);
    const r1 = v => Math.round(v * 10) / 10;
    return { p50: r1(tmp[Math.floor(n * 0.5)]), p95: r1(tmp[Math.floor(n * 0.95)]), max: r1(tmp[n - 1]) };
}

// Contexto del tick: refs + getters dinámicos para los valores que cambian en
// runtime (AOI_ENABLED, SNAPSHOT_EVERY, arcadeRestartMs). `flags` es el puente
// para que el tick señale al main que toca persistir stats/players/quests.
const tickFlags = { stats: false, players: false, quests: false };
const tickCtx = {
    // módulos
    proto,
    // Frontera económica: el tick emite hechos a econ.* (dinero/stats/quests van al
    // Director). En el split multiproceso, econ se sustituye por un proxy IPC.
    econ,
    // estado compartido (lectura/escritura)
    resumeTokens,
    flags: tickFlags,
    // funciones puras
    log, logAdmin, broadcast, restartRoom, startMatch, tickGradualBots,
    buildSnapshotFor, aoiBoxFor,
    addToPot, sendEcon, entryFeePill, minRealOf, classicExitFeePct, ARCADE_RAKE_PCT,
    deleteRoom: (key) => rooms.delete(key),
    // constantes
    DEAD_REMOVE_MS, EMPTY_ROOM_TTL, EMPTY_RESET_MS, ARCADE_KEEP_MIN, ARCADE_SHORTEN_MS,
    WS_BACKPRESSURE_MAX,
    // dinámicos (getters porque cambian en runtime desde admin)
    get aoiEnabled() { return AOI_ENABLED; },
    get snapshotEvery() { return SNAPSHOT_EVERY; },
    get arcadeRestartMs() { return arcadeRestartMs; },
};

setInterval(() => {
    const tickStart = performance.now();
    const tickStartT = Date.now();
    const lag = _lastTickT ? Math.max(0, (tickStartT - _lastTickT) - TICK_MS) : 0;
    _lastTickT = tickStartT;
    const now = tickStartT;
    // El bucle de salas (simulación + removals) vive en el GameHost.
    // El Director solo mide el coste agregado en tickHist y propaga dirty flags.
    const { stepMs, snapMs, sendMs } = gameHost.tickRooms(now, tickCtx);
    // Propagar dirty flags al estado global (los saves periódicos los recogen).
    if (tickFlags.stats)   { statsDirty   = true; tickFlags.stats = false; }
    if (tickFlags.players) { playersDirty = true; tickFlags.players = false; }
    if (tickFlags.quests)  { questsDirty  = true; tickFlags.quests = false; }
    const total = performance.now() - tickStart;
    const i = tickHist.i;
    tickHist.lag[i]   = lag;
    tickHist.step[i]  = stepMs;
    tickHist.snap[i]  = snapMs;
    tickHist.send[i]  = sendMs;
    tickHist.total[i] = total;
    tickHist.i = (i + 1) % TICK_HIST_LEN;
    if (tickHist.n < TICK_HIST_LEN) tickHist.n++;
}, TICK_MS);

purgeOldLogs();                              // limpia logs viejos al arrancar
setInterval(purgeOldLogs, 24 * 3600 * 1000); // y una vez al día

// Política por modo: fija maxPlayers (classic 35, arcade 25) y población=0 (SIN
// bots de relleno) en TODAS las salas del catálogo al arrancar. Sobrescribe lo
// persistido para que la política viva en código y se despliegue por git
// (roomrules.json es gitignored, no llega al VPS). Editable en vivo desde el panel;
// se reaplica en cada reinicio.
function enforceRoomCaps() {
    let n = 0;
    for (const mode of CATALOG_MODES) {
        const cap = ROOM_CAPS[mode] || 25;
        for (const price of PRICES) {
            const ck = comboKeyOf(mode, price);
            const r = rulesOf(ck);
            if (r.maxPlayers !== cap) { r.maxPlayers = cap; rulesDirty = true; n++; }
            if (r.targetPop !== 0) { r.targetPop = 0; rulesDirty = true; n++; }
            if (r.botsEnabled !== false) { r.botsEnabled = false; rulesDirty = true; n++; }
            if (r.botCount !== 0) { r.botCount = 0; rulesDirty = true; n++; }
        }
    }
    if (n) log(`Política por modo aplicada: classic ${ROOM_CAPS.classic}, arcade ${ROOM_CAPS.arcade}, población 0 (${n} ajustes)`);
}
enforceRoomCaps();

if (PW_ROLE === 'director') {
    // El Director NO corre salas propias: forkea los N hosts (cada uno pre-crea
    // sus combos del shard-map) y se queda con HTTP/admin/dinero + /match.
    // Su tick de salas corre sobre un Map vacío (inofensivo).
    for (let i = 0; i < PW_HOST_COUNT; i++) spawnHost(i);
    process.on('exit', killHosts);
} else {
    initLayers();   // pre-crea las salas L1 de los combos propios (10 en mono)
}

httpServer.listen(PORT, () => {
    log(`Servidor PillWars [${PW_ROLE}${PW_ROLE === 'host' ? ' ' + PW_HOST_ID + '/' + PW_HOST_COUNT : ''}] escuchando en ws://localhost:${PORT}`);
    // Solo mostramos la clave si es la insegura por defecto (avisamos) — en producción NUNCA se loguea
    if (ADMIN_KEY === '1234') log(`⚠ [SEGURIDAD] ADMIN_KEY no definida — usando '1234' por defecto. Define ADMIN_KEY en producción.`);
    else log(`Panel de admin: http://localhost:${PORT}${ADMIN_PATH}  (clave definida en ADMIN_KEY, ${ADMIN_KEY.length} chars)`);
    // Aviso si el bundle de Solana (vendor/solana.js) se quedó atrás respecto a
    // la librería instalada: es el único mantenimiento que trae haber dejado de
    // cargarla desde esm.sh, y así no depende de acordarse — sale en el log al
    // reiniciar tras cada deploy. Se arregla con `npm run vendor:solana`.
    try {
        const desfase = require('../scripts/vendor-check.js').comprobar();
        if (desfase) log(`⚠ [VENDOR] vendor/solana.js desfasado (${desfase}). Regenera con: npm run vendor:solana`);
    } catch (e) {}
    if (ADMIN_PATH === '/admin') log(`⚠ [SEGURIDAD] ADMIN_PATH no definida — usando '/admin' por defecto. Define ADMIN_PATH en producción para que no sea adivinable.`);
    if (CARTELES_PATH === '/carteles-preview.html') log(`⚠ [SEGURIDAD] CARTELES_PATH no definida — usando '/carteles-preview.html' por defecto. Define CARTELES_PATH en producción.`);
    log(`Lobby: mínimo ${MIN_PLAYERS} reales, población objetivo ${TARGET_POP} (editable por sala en el panel)`);
    log(`Privacidad: IPs anonimizadas, logs borrados a los ${LOG_RETENTION_DAYS} días`);
});
