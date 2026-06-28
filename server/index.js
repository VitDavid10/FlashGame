/*
 * Servidor autoritativo de PillWars (local).
 *
 * - Catálogo de salas: {classic, arcade} × {Free, 5$, 10$, 20$, 50$}.
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
const { performance } = require('perf_hooks');
const { Worker } = require('worker_threads');
const { WebSocketServer } = require('ws');
const PillSim = require('../shared/sim.js');
const proto = require('../shared/proto.js');     // protocolo binario para snaps (opt-in)
const solana = require('./solana.js');     // verificación de depósitos $PILL
const warbank = require('./warbank.js');   // saldo WAR interno por wallet
const skinpoints = require('./skinpoints.js');     // puntos de skin por clientId
const dailyquests = require('./dailyquests.js');   // retos diarios rotativos
const { tickRoomOnce } = require('./room-loop.js');   // tick por sala (paso previo a worker_threads)

const PORT = parseInt(process.env.PORT, 10) || 8080;
const ADMIN_KEY = process.env.ADMIN_KEY || '1234';
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS, 10) || 5;    // reales para empezar (editable por sala desde el panel)
const TARGET_POP = parseInt(process.env.TARGET_POP, 10) || 10;     // población objetivo: reales + bots de relleno
const MATCH_MS = parseInt(process.env.MATCH_MS, 10) || (3 * 60 * 1000 + 50 * 1000);
const GLOBAL_FILE = path.join(__dirname, 'globalsettings.json');
let _glob = loadJson(GLOBAL_FILE, {});
let arcadeRestartMs = Math.max(1000, (_glob.arcadeRestartMs | 0) || 10000);
let arcadeLobbyMs  = Math.max(0,    (_glob.arcadeLobbyMs  | 0) || 20000);
function saveGlobal() { fs.writeFile(GLOBAL_FILE, JSON.stringify({ arcadeRestartMs, arcadeLobbyMs }), () => {}); }
const TICK_MS = 25;            // 40 Hz de simulación
const TICK_HZ = Math.round(1000 / TICK_MS);   // 40
// Frecuencia de snapshots (global, no por sala). Editable en vivo desde el panel.
// Menos Hz = menos tráfico y menos carga → más capacidad, a costa de algo de fluidez
// (el cliente interpola). Default por env SNAPSHOT_HZ (40 si no se define).
function hzToEvery(hz) { return Math.max(1, Math.min(TICK_HZ, Math.round(TICK_HZ / Math.max(1, hz)))); }
let SNAPSHOT_EVERY = hzToEvery(parseInt(process.env.SNAPSHOT_HZ, 10) || TICK_HZ);
const EMPTY_ROOM_TTL = 60000;
const RESUME_GRACE_MS = 30000;   // ventana para hacer REJOIN tras desconexión accidental
const DEAD_REMOVE_MS = 3000;   // tras morir, retirar al jugador de la sim
// Rate-limit por conexión (anti-flood/DoS). Un cliente real manda ~30-40 msg/s
// (input 30 Hz + pings); dejamos margen de sobra. Por encima del umbral suave se
// descartan los mensajes; un flood evidente (umbral duro) cierra la conexión.
const MSG_RATE_SOFT = parseInt(process.env.MSG_RATE_SOFT, 10) || 100;  // msg/s: descarta el exceso
const MSG_RATE_HARD = parseInt(process.env.MSG_RATE_HARD, 10) || 400;  // msg/s: flood → cerrar
const LOG_FILE = path.join(__dirname, 'connections.log');
const STATS_FILE = path.join(__dirname, 'stats.json');
const RULES_FILE = path.join(__dirname, 'roomrules.json');

const PRICES = ['Free', '5$', '10$', '20$', '50$'];
const CATALOG_MODES = ['classic', 'arcade'];
// Layers por combo (mode × price). Cada combo tiene N instancias paralelas:
// el matchmaker (pickLayer) te mete en L1 hasta LLENARLA (clients.size >= maxPlayers),
// y solo entonces pasa a L2. NO hay umbral del 90%: es 100% estricto. Las layers
// SON INVISIBLES para el cliente: solo ve "Free", "5$", etc. — el server decide.
// 2 layers × 2 modos × 5 precios = 20 salas pre-creadas al arrancar.
const LAYERS_PER_COMBO = parseInt(process.env.LAYERS_PER_COMBO, 10) || 2;
function comboKeyOf(mode, roomName) { return mode + '_' + roomName; }
function layerKeyOf(mode, roomName, layerIdx) { return mode + '_' + roomName + '_L' + layerIdx; }
// Estado on/off por layerIdx. Si layerOff[i] === true, las salas PREMIUM de esa
// layer no existen en rooms (sus sims borradas del Map → no consumen tick).
// Las salas FREE NUNCA se apagan: siempre tienen sus N layers activas porque
// son las que más gente atraen y deben mantener capacidad asegurada.
const layerOff = {};
function isLayerOffForPrice(price, layerIdx) {
    return !!layerOff[layerIdx] && priceOf(price) > 0;
}

const rooms = new Map();   // layerKey → room
const resumeTokens = new Map();   // token → { roomKey: layerKey, playerId }

// %CPU del propio servidor, muestreado cada segundo (expuesto en admin/health).
let serverCpuPct = 0; let _cpuLast = process.cpuUsage(); let _cpuLastT = Date.now();
// Diagnóstico main thread: ms de CPU/seg en handleWorkerMsg (send vs total).
// Si mainSendMs ≈ mainTotalMs y se acerca a ~900 → el cuello es el ws.send.
let _wmSendUs = 0, _wmTotalUs = 0;
let _wmRecvMs = 0, _wmRecvN = 0;   // delay cola+structured-clone worker→main
let mainSendMs = 0, mainTotalMs = 0, mainRecvDelay = 0;
setInterval(() => {
    const u = process.cpuUsage(_cpuLast); const dt = Date.now() - _cpuLastT;
    _cpuLast = process.cpuUsage(); _cpuLastT = Date.now();
    serverCpuPct = dt > 0 ? Math.round((u.user + u.system) / 1000 / dt * 100) : 0;
    mainSendMs = Math.round(_wmSendUs / 1000); mainTotalMs = Math.round(_wmTotalUs / 1000);
    mainRecvDelay = _wmRecvN ? +(_wmRecvMs / _wmRecvN).toFixed(1) : 0;
    _wmSendUs = 0; _wmTotalUs = 0; _wmRecvMs = 0; _wmRecvN = 0;
    // Solo loguea bajo carga (evita spam en producción).
    if (mainTotalMs > 300 || mainRecvDelay > 20) {
        log(`DIAG cpu=${serverCpuPct}% workerMsg=${mainTotalMs}ms/s send=${mainSendMs}ms/s recvDelay=${mainRecvDelay}ms lag.p95=${pStats(tickHist.lag, tickHist.n).p95}ms`);
    }
}, 1000);
const adminFails = new Map();     // ip → { c: intentos, until: timestamp bloqueo }
const specTokens = new Map();     // token → expira_en (timestamp ms)
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
let statsDirty = false, rulesDirty = false, playersDirty = false;
function statsOf(key) { if (!roomStats[key]) roomStats[key] = { entradas: 0, muertes: 0, entradasReal: 0, muertesReal: 0 }; const s = roomStats[key]; if (s.entradasReal == null) { s.entradasReal = 0; s.muertesReal = 0; } return s; }
function rulesOf(key) {
    if (!roomRules[key]) roomRules[key] = { speed: 1, food: 1, virus: 1, botsEnabled: false, botCount: 20 };
    const r = roomRules[key];
    if (r.minReal == null) r.minReal = MIN_PLAYERS;
    if (r.targetPop == null) r.targetPop = TARGET_POP;
    // Tope de jugadores REALES por sala (30 por defecto; editable por sala desde el panel).
    // 30 × 10 salas = 300 concurrentes, el techo cómodo del VPS antes de que suba la latencia.
    if (r.maxPlayers == null) r.maxPlayers = 30;
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
const PILL_PER_DOLLAR_BASE = parseInt(process.env.PILL_PER_DOLLAR, 10) || 10000;
let PILL_PER_DOLLAR = PILL_PER_DOLLAR_BASE;
const ORACLE_REFRESH_MS = 5 * 60 * 1000;
function tickOracle() {
    const drift = 1 + (Math.random() * 0.30 - 0.15);   // ±15%
    PILL_PER_DOLLAR = Math.max(1, Math.round(PILL_PER_DOLLAR_BASE * drift / 1000) * 1000);
    log(`Oráculo: $1 = ${PILL_PER_DOLLAR} PILL`);
}
setInterval(tickOracle, ORACLE_REFRESH_MS);
// Tarifa con un rate dado (el de la sala si está bloqueado, o el global del oráculo).
function entryFeePill(key, rate) { return priceOf(key) * (rate || PILL_PER_DOLLAR); }
// Rate "vigente" de una sala: si tiene gente jugando usa el bloqueado; si está vacía,
// el precio vivo del oráculo (lo que pagaría el próximo en entrar y fijar el precio).
function roomRate(room) { return (room && room.clients.size > 0 && room.pillRate) ? room.pillRate : PILL_PER_DOLLAR; }

// --- Economía B3 (custodiada): carry de classic + bote de arcade ---
// Exit fee de classic según killStreak al hacer cashout (20% sin kills, 10% con 1, 0% con 2+).
function classicExitFeePct(kills) { if (kills >= 2) return 0; if (kills >= 1) return 10; return 20; }
// Mueve `amount` PILL al "bote" interno de la sala (off-chain, en memoria).
function addToPot(room, amount) { if (amount > 0) room.pot = (room.pot || 0) + amount; }
// Notifica al cliente su carry actual y el bote de la sala (para el HUD del juego).
function sendEcon(cli, room) { if (cli && cli.ws && cli.ws.readyState === 1) try { cli.ws.send(JSON.stringify({ t: 'econ', carry: cli.carry | 0, pot: room.pot | 0 })); } catch (e) {} }
// Cashout en classic: paga al jugador su carry menos el exit fee. El fee se descarta
// (no hay pot en classic: el modelo es "pure skill, mata y huye o pierdes").
// Devuelve el neto pagado al WAR del jugador.
function classicCashout(room, cli, kills) {
    if (!cli || !cli.payWallet || cli.carry <= 0) return 0;
    const fee = Math.floor(cli.carry * classicExitFeePct(kills) / 100);
    const net = cli.carry - fee;
    if (net > 0) warbank.credit(cli.payWallet, net);
    log(`Cashout classic: ${cli.payWallet.slice(0, 6)}… +${net} PILL (carry ${cli.carry}, fee ${fee} descartado)`);
    try { cli.ws.send(JSON.stringify({ t: 'prize', reason: 'cashout', amount: net, carry: cli.carry, feePct: classicExitFeePct(kills), fee, kills })); } catch (e) {}
    if (cli.cid && kills >= 2) dailyquests.recordEvent(cli.cid, 'classic_safe_exit', 1);
    cli.carry = 0;
    return net;
}
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
function buildSim(mode, rules) {
    const baseSize = PillSim.WORLD_CONFIG[mode === 'classic' ? 'classic' : 'arcade'].size;
    const sim = new PillSim.Simulation({
        mode,
        mapSize: baseSize,
        worldSettings: { map: 1, food: rules.food || 1, virus: rules.virus || 1, speed: rules.speed || 1 },
        botConfig: { enabled: !!rules.botsEnabled, count: rules.botCount || 0, respawn: !!rules.botsEnabled },
        maxBotCells: mode === 'classic' ? 8 : 4,
        fx: { enabled: false, enemyFX: false },
        emitFoodEvents: true,
        enforceGod: true,            // online: comandos de truco solo para GOD
        realisticBotNames: true      // online: bots usan nombres tipo jugador real
    });
    sim.populate();
    return sim;
}

// Crea (o devuelve) una layer concreta. key = layerKey = "mode_roomName_LN".
// Las reglas/stats persisten por comboKey, no por layer.
// Multihilo: si USE_WORKERS está activo, cada sala corre su sim en un Worker.
const USE_WORKERS = process.env.WORKERS !== '0';
const WORKER_SCRIPT = path.join(__dirname, 'room-worker.js');

function getOrCreateRoom(key, mode, roomName) {
    if (!rooms.has(key)) {
        const ck = comboKeyOf(mode, roomName);
        const rules = rulesOf(ck); rulesDirty = true;
        const m = key.match(/_L(\d+)$/);
        const layerIdx = m ? parseInt(m[1], 10) : 1;
        const room = {
            key, comboKey: ck, layerIdx, mode, roomName,
            sim: USE_WORKERS ? null : buildSim(mode, rules),
            worker: null,
            clients: new Map(),
            state: 'waiting',
            tickCount: 0, lastTick: Date.now(), emptySince: 0,
            endsAt: null, restartAt: null, startAt: null,
            pendingRemovals: new Map(),
            deadRemovals: new Map(),
            spectators: new Set(),
            persistent: true,
            pot: 0,
        };
        rooms.set(key, room);
        if (USE_WORKERS) spawnWorker(room, rules);
        log(`Sala creada: ${key} (lobby, mínimo ${minRealOf(ck)} reales, población ${targetPopOf(ck)})${USE_WORKERS ? ' [worker]' : ''}`);
    }
    return rooms.get(key);
}

// --- Worker lifecycle ---
function spawnWorker(room, rules) {
    const w = new Worker(WORKER_SCRIPT);
    room.worker = w;
    // Offset de arranque: reparte los 20 workers uniformemente en la ventana de 25ms
    // para que el main reciba 1 tickResult cada ~1.25ms en vez de 20 de golpe.
    const workerIndex = rooms.size;  // rooms.set ya se hizo antes, rooms.size incluye esta sala
    const tickOffset = Math.round((workerIndex % 20) * (TICK_MS / 20));
    w.postMessage({
        type: 'init', mode: room.mode, rules,
        matchMs: MATCH_MS,
        aoiEnabled: AOI_ENABLED,
        snapshotEvery: SNAPSHOT_EVERY,
        tickOffset,
    });
    w.on('message', (msg) => handleWorkerMsg(room, msg));
    w.on('error', (err) => {
        log(`Worker ERROR en ${room.key}: ${err.message}`);
        // Fallback: recrear con worker
        room.worker = null;
        spawnWorker(room, rulesOf(room.comboKey));
    });
    w.on('exit', (code) => {
        if (code !== 0 && room.worker === w) {
            log(`Worker salió con code ${code} en ${room.key}, respawneando`);
            room.worker = null;
            spawnWorker(room, rulesOf(room.comboKey));
        }
    });
}

function handleWorkerMsg(room, msg) {
    switch (msg.type) {
        case 'ready':
            if (msg.foods) room._foods = msg.foods;
            if (msg.mapSize) room._mapSize = msg.mapSize;
            break;

        case 'tickResult': {
            room.tickCount++;
            if (msg.botCount != null) room._botCount = msg.botCount;
            if (msg.postedAt) { _wmRecvMs += Math.max(0, Date.now() - msg.postedAt); _wmRecvN++; }
            const _wmT0 = performance.now();
            const evJson = msg.eventsJson;
            // 1) Enviar snapshots a los clientes WS
            if (msg.snapshots) {
                for (const s of msg.snapshots) {
                    if (s.pid === '__spectators__') {
                        // Snapshot completo para espectadores
                        if (s.snapData) for (const sws of room.spectators) {
                            if (sws.readyState !== 1) { room.spectators.delete(sws); continue; }
                            if (evJson) sws.send(evJson);
                            sws.send(s.snapData);
                        }
                        if (room.spectators.size === 0) room.worker.postMessage({ type: 'setSpectators', on: false });
                        continue;
                    }
                    const cli = room.clients.get(s.pid);
                    if (!cli || cli.ws.readyState !== 1) continue;
                    if (evJson) cli.ws.send(evJson);
                    if (s.snapData) cli.ws.send(s.snapData);
                }
            }
            _wmSendUs += (performance.now() - _wmT0) * 1000;

            // 2) Procesar peaks
            if (msg.peaks) for (const pk of msg.peaks) {
                const cli = room.clients.get(pk.pid);
                if (cli) { cli._peakMass = pk.mass; }
            }

            // 3) Procesar eventos (warbank, stats, quests — TODO lo que toca estado global)
            if (msg.events) for (const ev of msg.events) {
                processWorkerEvent(room, ev, Date.now());
            }
            _wmTotalUs += (performance.now() - _wmT0) * 1000;
            break;
        }

        case 'matchEnd': {
            room.state = 'ended';
            room.restartAt = Date.now() + arcadeRestartMs;
            room.worker.postMessage({ type: 'setState', state: 'ended', restartAt: room.restartAt });
            // Q1/Q2/Q4 al final de arcade
            for (const [pid, cli] of room.clients) {
                if (!cli.cid) continue;
                const pRank = msg.ranking.find(r => r.id === pid);
                if (!pRank) continue;
                const q = questsOf(cli.cid);
                const peak = pRank.peakMass || 0;
                if (peak > (q.bestMass | 0)) { q.bestMass = peak; questsDirty = true; }
                if (pRank.alive && room.mode === 'arcade') {
                    if ((q.q1_games_finished | 0) < 2) { q.q1_games_finished = (q.q1_games_finished | 0) + 1; questsDirty = true; }
                    if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; questsDirty = true; }
                }
                q.updated = Date.now();
            }
            // Reparto del bote arcade
            if (room.mode !== 'classic' && (room.pot || 0) > 0) {
                for (const cli of room.clients.values()) { if (cli.carry > 0) { addToPot(room, cli.carry); cli.carry = 0; } }
                const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];
                const ranking = msg.ranking;
                const totalPot = room.pot;
                const top = [];
                for (let i = 0; i < Math.min(10, ranking.length); i++) {
                    const pj = ranking[i];
                    const cli = room.clients.get(pj.id);
                    const parte = Math.floor(totalPot * PESOS[i] / 100);
                    if (cli && cli.payWallet && parte > 0) warbank.credit(cli.payWallet, parte);
                    if (cli && cli.cid && (i + 1) <= 5) dailyquests.recordEvent(cli.cid, 'arcade_top5', 1);
                    top.push({ pos: i + 1, name: pj.name, mass: pj.peakMass | 0, pct: PESOS[i], amount: parte, mine: false, paid: !!(cli && cli.payWallet) });
                }
                const payoutMsg = { t: 'prize', reason: 'arcadeEnd', pot: totalPot, top };
                for (const [pid, cli] of room.clients) {
                    if (cli.ws.readyState !== 1) continue;
                    const idx = top.findIndex(t => ranking[t.pos - 1] && ranking[t.pos - 1].id === pid);
                    const myCopy = top.map((t, i) => Object.assign({}, t, { mine: i === idx }));
                    try { cli.ws.send(JSON.stringify(Object.assign({}, payoutMsg, { top: myCopy, myAmount: idx >= 0 ? top[idx].amount : 0 }))); } catch (e) {}
                }
                log(`Reparto arcade ${room.key}: bote ${totalPot}`);
                room.pot = 0;
            }
            broadcast(room, { t: 'matchEnd' });
            broadcast(room, { t: 'lobbyPreview', count: room.clients.size, needed: minRealOf(room.comboKey), roomName: room.roomName, mode: room.mode, restartIn: arcadeRestartMs });
            log(`Partida terminada en ${room.key}; reinicio en ${arcadeRestartMs / 1000}s`);
            break;
        }

        case 'matchStarted':
            room._foods = msg.foods || [];
            room._mapSize = msg.mapSize || 4000;
            break;

        case 'requestStart':
            startMatch(room);
            break;

        case 'requestRestart':
            restartRoom(room);
            break;
    }
}

function processWorkerEvent(room, ev, now) {
    if (ev.type === 'playerDied') {
        const dCli_ = room.clients.get(ev.playerId);
        if (dCli_) { dCli_._alive = false; dCli_._killStreak = 0; }
        const dTest_ = dCli_ && dCli_.isTester;
        const ds2_ = statsOf(room.comboKey); ds2_.muertes++; if (!dTest_) ds2_.muertesReal++; statsDirty = true;
        if (dCli_ && dCli_.name && !dTest_) { pstatOf(dCli_.name).muertes++; playersDirty = true; }
        // Peak mass flush
        if (dCli_) {
            const peak = dCli_._peakMass || 0;
            if (peak > 0 && dCli_.name && !dTest_) {
                const ps = pstatOf(dCli_.name);
                if (peak > (ps.bestMass | 0)) { ps.bestMass = peak; playersDirty = true; }
            }
        }
        if (room.mode !== 'classic') {
            const dCli = room.clients.get(ev.playerId);
            if (dCli && dCli.carry > 0) { addToPot(room, dCli.carry); dCli.carry = 0; }
            else addToPot(room, entryFeePill(room.comboKey, room.pillRate));
        }
        const cliD = room.clients.get(ev.playerId);
        if (cliD && cliD.cid) {
            const q = questsOf(cliD.cid);
            if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; q.updated = Date.now(); questsDirty = true; }
        }
        if (!room.deadRemovals.has(ev.playerId)) room.deadRemovals.set(ev.playerId, now + DEAD_REMOVE_MS);
    } else if (ev.type === 'botKilled') {
        const cliKiller_ = room.clients.get(ev.playerId);
        if (cliKiller_) cliKiller_._killStreak = ev.streak || 0;
        if (cliKiller_ && cliKiller_.name && !cliKiller_.isTester) { pstatOf(cliKiller_.name).kills++; playersDirty = true; }
        const cliK = room.clients.get(ev.playerId);
        if (cliK && cliK.cid) {
            const q = questsOf(cliK.cid);
            if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; q.updated = Date.now(); questsDirty = true; }
            dailyquests.recordEvent(cliK.cid, 'kill', 1);
            const peak = cliK._peakMass || 0;
            if (peak >= 50000 && !cliK._mass50) { cliK._mass50 = true; dailyquests.recordEvent(cliK.cid, 'mass_50k', 1); }
            if (peak >= 100000 && !cliK._mass100) { cliK._mass100 = true; dailyquests.recordEvent(cliK.cid, 'mass_100k', 1); }
        }
        if (cliK && room.mode === 'classic') {
            const victimCli = ev.victimId ? room.clients.get(ev.victimId) : null;
            let gain = 0;
            if (victimCli && victimCli.carry > 0) {
                gain = victimCli.carry; victimCli.carry = 0;
                sendEcon(victimCli, room);
            } else {
                gain = entryFeePill(room.comboKey, room.pillRate);
            }
            cliK.carry += gain;
            if (gain > 0) { try { cliK.ws.send(JSON.stringify({ t: 'killGain', amount: gain, victimWasBot: !(victimCli && victimCli.carry >= 0 && victimCli.payWallet) })); } catch (e) {} }
            sendEcon(cliK, room);
            if (ev.streak >= 5 && cliK.payWallet) {
                const win = cliK.carry;
                if (win > 0) warbank.credit(cliK.payWallet, win);
                log(`VICTORIA classic: ${cliK.payWallet.slice(0, 6)}… +${win} PILL (carry completo)`);
                try { cliK.ws.send(JSON.stringify({ t: 'prize', reason: 'victory', amount: win, carry: cliK.carry, pot: 0 })); } catch (e) {}
                cliK.carry = 0;
                sendEcon(cliK, room);
                if (cliK.cid) dailyquests.recordEvent(cliK.cid, 'classic_5kills', 1);
            }
        }
    } else if (ev.type === 'skillUsed') {
        const cli = room.clients.get(ev.playerId);
        if (cli && cli.cid && room.mode === 'arcade') {
            const uses = (cli._matchSkillUses || 0) + 1;
            cli._matchSkillUses = uses;
            const q = questsOf(cli.cid);
            if (uses > (q.q3_skills_in_arcade | 0)) {
                q.q3_skills_in_arcade = Math.min(8, uses);
                q.updated = Date.now(); questsDirty = true;
            }
            dailyquests.recordEvent(cli.cid, 'skill_used_arcade', 1);
        }
    }
}

// Matchmaker: elige la layer del combo donde meter a un nuevo jugador.
// Política: **L1 ESTRICTA**. Recorre las layers en orden (L1, L2, ...) y se
// queda con la PRIMERA que cumpla. L2 solo se usa cuando L1 está llena. Si L1
// se vacía después, los próximos vuelven a L1 (los de L2 siguen su partida).
//
// Filtros:
//  - no llena (clients.size < maxPlayers del combo)
//  - no a <30s del final de partida (te evita morir entrando)
//  - no desactivada manualmente desde admin
//  - state playing | waiting | ended (en ended ves la cuenta atrás del reinicio)
//
// Si ninguna cumple → null → cliente recibe noSlot y sigue en práctica offline.
function pickLayer(mode, roomName) {
    const ck = comboKeyOf(mode, roomName);
    const max = maxPlayersOf(ck);
    for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
        const r = rooms.get(layerKeyOf(mode, roomName, i));
        if (!r) continue;
        if (r.disabled) continue;
        if (r.clients.size >= max) continue;
        if (r.state === 'playing' && r.endsAt && (r.endsAt - Date.now()) < 30000) continue;
        return r;
    }
    return null;
}

// Pre-crea TODAS las salas en startup (20 = 2 layers × 2 modos × 5 precios).
function initLayers() {
    let n = 0;
    for (const mode of CATALOG_MODES) {
        for (const price of PRICES) {
            for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
                getOrCreateRoom(layerKeyOf(mode, price, i), mode, price);
                n++;
            }
        }
    }
    log(`Pre-creadas ${n} salas (${LAYERS_PER_COMBO} layers × ${CATALOG_MODES.length} modos × ${PRICES.length} precios)`);
}

function broadcast(room, objOrString) {
    const m = typeof objOrString === 'string' ? objOrString : JSON.stringify(objOrString);
    for (const cli of room.clients.values()) { if (cli.ws.readyState === 1) { try { cli.ws.send(m); } catch (e) {} } }
}

function sendWaiting(room) {
    broadcast(room, { t: 'waiting', count: room.clients.size, needed: minRealOf(room.comboKey), roomName: room.roomName, mode: room.mode });
}

// Cache del JSON de foods por sala. Serializar ~7800 foods (classic) en CADA
// join/reconnect satura el main: con el churn de reconexiones del stress test son
// decenas de joins/seg. Cacheamos el string 2s; el cliente se autocorrige con los
// eventos foodRespawn, así que un cache ligeramente viejo no se nota.
function foodsJsonOf(room) {
    const now = Date.now();
    if (room._foodsJson && now - (room._foodsJsonAt || 0) < 2000) return room._foodsJson;
    const foods = room.sim ? room.sim.foods : (room._foods || []);
    room._foodsJson = JSON.stringify(foods);
    room._foodsJsonAt = now;
    return room._foodsJson;
}
// Devuelve el welcome ya serializado como STRING, con el foods cacheado inyectado
// sin re-serializar. `extra` añade campos al head (ej. { useBin: true }).
function welcomeMsg(room, playerId, token, type, extra) {
    const baseSize = PillSim.WORLD_CONFIG[room.mode === 'classic' ? 'classic' : 'arcade'].size;
    const head = {
        t: type || 'welcome', id: playerId, token,
        mapSize: room.sim ? room.sim.mapSize : (room._mapSize || baseSize), mode: room.mode, roomName: room.roomName,
        state: room.state, count: room.clients.size, needed: minRealOf(room.comboKey),
        duration: MATCH_MS,
        tl: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : null,
        startIn: room.startAt ? Math.max(0, room.startAt - Date.now()) : null,
        restartEnMs: room.restartAt ? Math.max(0, room.restartAt - Date.now()) : null,
        simTime: room.sim ? Math.round(room.sim.now) : 0
    };
    if (extra) Object.assign(head, extra);
    return JSON.stringify(head).slice(0, -1) + ',"foods":' + foodsJsonOf(room) + '}';
}

// Backfill: ajusta el OBJETIVO de bots (no añade de golpe). La cola gradual
// los mete poco a poco, así parece que la sala se va llenando naturalmente.
function refillBots(room) {
    if (room.state !== 'playing') return;
    const target = targetPopOf(room.comboKey);
    if (target === 0) return;
    const deseados = Math.max(0, target - room.clients.size);
    if (room.worker) {
        room.worker.postMessage({ type: 'refillBots', target: deseados });
    } else {
        const sim = room.sim;
        sim.config.botConfig.count = deseados;
        sim.config.botConfig.enabled = deseados > 0;
        sim.config.botConfig.respawn = deseados > 0;
        room.botTargetCount = deseados;
    }
}

// Cola gradual de spawn/despawn: en cada llamada acerca el número de bots
// al objetivo en +1 (1 bot cada 1.5–2.5 s). Se llama desde el bucle principal.
function tickGradualBots(room, now) {
    if (room.state !== 'playing') return;
    const target = room.botTargetCount | 0;
    const sim = room.sim;
    const grupos = [...new Set(sim.enemies.map(e => e.id))];
    if (grupos.length === target) return;
    if ((room.lastBotStep || 0) + (1500 + Math.random() * 1000) > now) return;
    room.lastBotStep = now;
    if (grupos.length < target) {
        sim.spawnBot();
    } else if (grupos.length > target) {
        // retirar el grupo de menos masa: es el que menos se nota
        const masaDe = id => sim.enemies.filter(e => e.id === id).reduce((s, c) => s + c.mass, 0);
        const peor = grupos.slice().sort((a, b) => masaDe(a) - masaDe(b))[0];
        sim.enemies = sim.enemies.filter(e => e.id !== peor);
    }
}

// Arma (o cancela) la cuenta atrás de lobby. Se llama cuando cambia el nº de
// reales en una sala en espera. Al llegar al mínimo arranca un countdown de
// lobbyMs; si baja del mínimo lo cancela. Con lobbyMs=0 empieza al instante.
function armLobby(room) {
    if (room.state !== 'waiting') return;
    const min = minRealOf(room.comboKey);
    if (room.clients.size >= min) {
        if (room.startAt) return;   // ya hay cuenta atrás en marcha
        const lobbyMs = lobbyMsOf(room.comboKey);
        if (lobbyMs <= 0) { startMatch(room); return; }
        room.startAt = Date.now() + lobbyMs;
        if (room.worker) room.worker.postMessage({ type: 'setLobbyStart', startAt: room.startAt });
        broadcast(room, { t: 'lobbyCountdown', startIn: lobbyMs, count: room.clients.size, needed: min, roomName: room.roomName, mode: room.mode });
        log(`Lobby ${room.key}: ${room.clients.size}/${min} → cuenta atrás ${lobbyMs / 1000}s`);
    } else if (room.startAt) {
        room.startAt = null;
        if (room.worker) room.worker.postMessage({ type: 'cancelLobby' });
        sendWaiting(room);   // vuelve a "esperando X/min"
        log(`Lobby ${room.key}: cuenta atrás cancelada (${room.clients.size}/${min})`);
    }
}

function startMatch(room) {
    if (room.state !== 'waiting') return;
    room.state = 'playing';
    room.startAt = null;
    room.lastTick = Date.now();
    if (room.mode !== 'classic') room.endsAt = Date.now() + MATCH_MS;
    if (room.worker) {
        room.worker.postMessage({ type: 'startMatch' });
        for (const [pid, cli] of room.clients) {
            cli.paidFee = 0;
            cli._matchSkillUses = 0;
            cli._alive = true;
            cli._killStreak = 0;
            if (cli.ws.readyState === 1) cli.ws.send(welcomeMsg(room, pid, cli.token, 'matchStart'));
        }
        refillBots(room);
        log(`¡Partida INICIADA en ${room.key}: ${room.clients.size} reales [worker]`);
    } else {
        for (const [pid, cli] of room.clients) {
            if (!room.sim.players.has(pid)) room.sim.addPlayer(pid, cli.opts || {});
            room.sim.spawnPlayer(pid);
            cli.paidFee = 0;
            if (cli.ws.readyState === 1) cli.ws.send(welcomeMsg(room, pid, cli.token, 'matchStart'));
        }
        refillBots(room);
        log(`¡Partida INICIADA en ${room.key}: ${room.clients.size} reales + ${new Set(room.sim.enemies.map(e => e.id)).size} bots de relleno`);
    }
}

function restartRoom(room) {
    broadcast(room, { t: 'roomRestart' });
    room.state = 'waiting';
    room.endsAt = null; room.restartAt = null; room.startAt = null; room.ended = false;
    room.deadRemovals.clear(); room.pendingRemovals.clear();
    if (room.worker) {
        const rules = rulesOf(room.comboKey);
        room.worker.postMessage({
            type: 'restartSim', mode: room.mode, rules,
            matchMs: MATCH_MS, aoiEnabled: AOI_ENABLED, snapshotEvery: SNAPSHOT_EVERY,
        });
        for (const [pid, cli] of room.clients) {
            room.worker.postMessage({ type: 'addPlayer', pid, opts: cli.opts || {}, aspect: cli.aspect || 1, useBin: !!cli.useBin });
        }
    } else {
        room.sim = buildSim(room.mode, rulesOf(room.comboKey));
        for (const [pid, cli] of room.clients) { room.sim.addPlayer(pid, cli.opts || {}); }
    }
    sendWaiting(room);
    armLobby(room);
    log(`Sala reiniciada: ${room.key}`);
}

function shutdownRoom(room, motivo) {
    for (const cli of room.clients.values()) {
        try { cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {}
        try { cli.ws.close(); } catch (e) {}
    }
    if (room.worker) { try { room.worker.postMessage({ type: 'shutdown' }); } catch (e) {} room.worker = null; }
    rooms.delete(room.key);
    for (const [tok, info] of resumeTokens) { if (info.roomKey === room.key) resumeTokens.delete(tok); }
    log(`Sala apagada (${motivo}): ${room.key}`);
}

// Quick join: la sala del modo pedido con más gente; si no hay ninguna, Free
function resolveQuickJoin(mode) {
    let best = null;
    for (const room of rooms.values()) {
        if (room.mode !== mode || room.state === 'ended') continue;
        if (!best || room.clients.size > best.clients.size) best = room;
    }
    return best ? best.roomName : 'Free';
}

function round1(n) { return Math.round(n * 10) / 10; }

function cellData(c) {
    const o = { ci: c.ci, x: round1(c.x), y: round1(c.y), r: round1(c.r), cb: c.colorBot, ct: c.colorTop };
    if (c.skinUrl) o.sk = c.skinUrl;
    if (c.immuneTime > 0) o.im = Math.round(c.immuneTime);
    if (c.sprintTime > 0) o.sp = 1;
    if (c.magnetTime > 0) o.mg = 1;
    if (c.tpPhase) { o.tp = c.tpPhase; o.tt = Math.round(c.tpTimer); }
    return o;
}

// --- AOI (Area of Interest) ---
// Cada jugador recibe solo lo cercano a su centroide. Esto:
//  - corta tráfico ~5-10× en salas grandes (los bots/virus lejanos no se mandan)
//  - cierra el maphack (un cliente modificado no puede dibujar lo que no recibe)
//
// La caja es cuadrada centrada en el centroide ponderado por masa del jugador.
// El lado depende del tamaño del jugador (más grande → ve más, porque su zoom
// se aleja). Margen extra para que la interpolación no popee al entrar entidades.
// Las celdas propias del jugador SIEMPRE van enteras (tras un split sus celdas
// pueden estar fuera del centroide y aun así son suyas).
let AOI_ENABLED = process.env.AOI !== '0';   // ON por defecto; AOI=0 para apagar
const AOI_BASE = 1800;          // visión mínima en píxeles del mundo
const AOI_PER_R = 18;           // px de visión extra por cada px de radio máximo
const AOI_MARGIN = 1.30;        // margen para interpolación / pop-in
// Caja rectangular: si el cliente envió su aspect ratio (W/H), la caja se estira
// para cubrir el viewport real. Sin aspect → caja cuadrada (compat con clientes viejos).
// Clamp [0.5, 4.0]: protege de ratios absurdos (cliente trucado para ver más).
function aoiBoxFor(p, aspect) {
    if (!p || p.cells.length === 0) return null;
    let cx = 0, cy = 0, mtot = 0, maxR = 0;
    const cells = p.cells;
    for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const m = c.r * c.r;
        cx += c.x * m; cy += c.y * m; mtot += m;
        if (c.r > maxR) maxR = c.r;
    }
    cx /= mtot; cy /= mtot;
    const view = (AOI_BASE + maxR * AOI_PER_R) * AOI_MARGIN;
    let ar = aspect > 0 ? aspect : 1;
    if (ar > 4) ar = 4; else if (ar < 0.5) ar = 0.5;
    // halfX × halfY mantienen el ÁREA equivalente al cuadrado (sqrt del ratio).
    const sq = Math.sqrt(ar);
    return { cx, cy, halfX: view * sq, halfY: view / sq };
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
function buildSnapshotFor(room, viewerId, box) {
    const sim = room.sim;
    const players = [];
    for (const p of sim.players.values()) {
        const isMe = p.id === viewerId;
        const srcCells = p.cells;
        // Filtrar in-line sin closure ni .map() para evitar allocations.
        const outCells = [];
        if (box && !isMe) {
            for (let i = 0; i < srcCells.length; i++) {
                const c = srcCells[i];
                if (intersectsBox(box, c.x, c.y, c.r)) outCells.push(cellData(c));
            }
        } else {
            for (let i = 0; i < srcCells.length; i++) outCells.push(cellData(srcCells[i]));
        }
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
        players.push({
            id: p.id, name: p.name, ks: p.killStreak, alive: p.alive, gcd: Math.round(p.globalCD),
            slots: slotsOut, ss, cells: outCells
        });
    }
    const bots = [];
    const enemies = sim.enemies;
    for (let i = 0; i < enemies.length; i++) {
        const c = enemies[i];
        if (!box || intersectsBox(box, c.x, c.y, c.r)) {
            // En vez de Object.assign(cellData(c), {...}), construimos directo.
            const o = cellData(c);
            o.id = c.id; o.n = c.name;
            bots.push(o);
        }
    }
    const viruses = [];
    const vs = sim.viruses;
    for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!box || intersectsBox(box, v.x, v.y, v.r)) viruses.push({ ci: v.ci, x: round1(v.x), y: round1(v.y), r: round1(v.r), d: v.damaged ? 1 : 0, a: round1(v.animTime) });
    }
    const ejected = [];
    const em = sim.ejectedMasses;
    for (let i = 0; i < em.length; i++) {
        const m = em[i];
        if (!box || intersectsBox(box, m.x, m.y, m.r)) ejected.push({ ci: m.ci, x: round1(m.x), y: round1(m.y), r: m.r, c1: m.c1, c2: m.c2, a: round1(m.angle || 0) });
    }
    const projectiles = [];
    const pj = sim.projectiles;
    for (let i = 0; i < pj.length; i++) {
        const pr = pj[i];
        if (!box || intersectsBox(box, pr.x, pr.y, pr.r)) projectiles.push({ ci: pr.ci, x: round1(pr.x), y: round1(pr.y), r: pr.r });
    }
    return {
        t: 'snap',
        time: Math.round(sim.now),
        tl: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : null,
        pot: room.pot | 0,
        players, bots, viruses, ejected, projectiles
    };
}
// Snapshot completo (sin AOI). Wrapper para mantener compatibilidad.
function buildSnapshot(room) { return buildSnapshotFor(room, null, null); }

// --- Estado para el panel de admin: una entrada por layer, agrupable por combo ---
function buildAdminState() {
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
            vivos: room ? (room.worker ? [...room.clients.values()].filter(c => c._alive).length : [...room.clients.keys()].filter(pid => { const p = room.sim.players.get(pid); return p && p.alive; }).length) : 0,
            espectadores: room ? room.spectators.size : 0,
            maxReales: maxPlayersOf(comboKey),
            needed: minRealOf(comboKey),
            bots: room ? (room.worker ? (room._botCount || 0) : new Set(room.sim.enemies.map(e => e.id)).size) : 0,
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
                const p = room.worker ? null : room.sim.players.get(pid);
                let mass = room.worker ? (cli._peakMass || 0) : 0; if (p) p.cells.forEach(c => mass += c.mass);
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
            const ck = comboKeyOf(mode, price);
            for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
                if (isLayerOffForPrice(price, i)) continue;   // premium con layer apagada
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
    // Totales agregados: contar stats UNA vez por comboKey.
    let totEntradas = 0, totMuertes = 0, totDinero = 0, totEntradasReal = 0, totMuertesReal = 0, totDineroReal = 0;
    const seenCombo = new Set();
    for (const e of list) {
        if (seenCombo.has(e.comboKey)) continue;
        seenCombo.add(e.comboKey);
        totEntradas += e.stats.entradas; totMuertes += e.stats.muertes; totDinero += e.stats.dinero;
        totEntradasReal += e.stats.entradasReal; totMuertesReal += e.stats.muertesReal; totDineroReal += e.stats.dineroReal;
    }
    // Ranking: usa el cache calculado bajo demanda (botón "Actualizar ranking" en panel).
    // No se recalcula aquí — con 87k entradas bloquearía el main thread en cada poll.
    const ranking = _rankingCache;
    // Ranking de países: JUGADORES DISTINTOS (IPs únicas) por país, no entradas
    const paises = Object.values(porPaisMap)
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
        minPlayers: MIN_PLAYERS,
        snapshotHz: Math.round(TICK_HZ / SNAPSHOT_EVERY),
        aoiEnabled: AOI_ENABLED,
        layersPerCombo: LAYERS_PER_COMBO,
        layerOff: Object.assign({}, layerOff),   // { 2: true } si L2 está apagada
        arcadeRestartMs, arcadeLobbyMs,
        mainSendMs, mainTotalMs,
        serverCpu: serverCpuPct,
        totales: {
            entradas: totEntradas, muertes: totMuertes, dinero: totDinero,
            entradasReal: totEntradasReal, muertesReal: totMuertesReal, dineroReal: totDineroReal,
            salasOnline: [...rooms.values()].filter(r => r.clients.size > 0).length,
            jugadores: [...rooms.values()].reduce((s, r) => s + r.clients.size, 0),
            jugadoresReales: [...rooms.values()].reduce((s, r) => { for (const c of r.clients.values()) if (!c.isTester) s++; return s; }, 0),
            jugadoresUnicos: Object.keys(playerStats).length,
            jugadoresUnicosReal: Object.values(playerStats).filter(p => p.isReal).length,
        },
        rooms: list,
        ranking,
        rankingUpdatedAt: _rankingUpdatedAt,
        rankingStale: _rankingUpdatedAt === 0,
        paises,
        historial,
        adminLog: adminLog.slice(-60).reverse()
    };
}

// Guarda el peakMass del jugador en playerStats (ranking) y quests (clientId).
// Idempotente: solo sube el bestMass si supera el récord existente.
function flushPeakMass(room, pid, cli) {
    let peak;
    if (room.worker) {
        peak = (cli && cli._peakMass) ? Math.floor(cli._peakMass) : 0;
    } else {
        const pj = room.sim.players.get(pid); if (!pj) return;
        peak = pj.peakMass ? Math.floor(pj.peakMass) : 0;
    }
    if (peak <= 0) return;
    if (cli && cli.name && !cli.isTester) {
        const ps = pstatOf(cli.name);
        if (peak > (ps.bestMass | 0)) { ps.bestMass = peak; playersDirty = true; }
    }
    if (cli && cli.cid) {
        const q = questsOf(cli.cid);
        if (peak > (q.bestMass | 0)) { q.bestMass = peak; q.updated = Date.now(); questsDirty = true; }
    }
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
}
function isSolAddr(s) { return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }

const httpServer = http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
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
        // Cada combo (mode×price) tiene N layers. Devolvemos UN entry por combo
        // con la info AGREGADA (la layer que el matchmaker elegiría = más llena
        // que cumpla condiciones; si ninguna cumple, la primera) + la lista de
        // layers para el oracle multi-layer.
        const list = [];
        const now = Date.now();
        for (const mode of CATALOG_MODES) for (const price of PRICES) {
            const ck = mode + '_' + price;
            const layers = [];
            for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
                if (isLayerOffForPrice(price, i)) continue;
                const r = rooms.get(layerKeyOf(mode, price, i));
                if (!r) continue;
                layers.push({
                    layerIdx: i,
                    key: r.key,
                    players: r.clients.size,
                    state: r.state,
                    startIn: r.startAt ? Math.max(0, r.startAt - now) : null,
                    restartIn: (r.state === 'ended' && r.restartAt) ? Math.max(0, r.restartAt - now) : null,
                    endsIn: (r.state === 'playing' && r.endsAt) ? Math.max(0, r.endsAt - now) : null,
                    disabled: !!r.disabled,
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
                locked: !!(pick && pick.clients.size > 0),
                players,                                  // total del combo (todas las layers)
                needed: minRealOf(ck),
                cap: maxPlayersOf(ck) * LAYERS_PER_COMBO, // capacidad TOTAL del combo
                state: pick ? pick.state : 'offline',
                startIn: (pick && pick.startAt) ? Math.max(0, pick.startAt - now) : null,
                restartIn: (pick && pick.state === 'ended' && pick.restartAt) ? Math.max(0, pick.restartAt - now) : null,
                endsIn: (pick && pick.state === 'playing' && pick.endsAt) ? Math.max(0, pick.endsAt - now) : null,
                roomName: price,
                layers,
            });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ rooms: list, pillPerDollar: PILL_PER_DOLLAR, oracleEveryMs: 5 * 60 * 1000, layersPerCombo: LAYERS_PER_COMBO, layerOff: Object.assign({}, layerOff) }));
        return;
    }
    // --- Config de tarifas: el juego calcula la entrada = precio($) × pillPerDollar ---
    if (urlPath === '/api/fees') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ pillPerDollar: PILL_PER_DOLLAR }));
        return;
    }
    // --- Saldo WAR (PILL depositado en el juego) ---
    if (urlPath === '/api/warbalance') {
        const wallet = String(query.get('wallet') || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ pill: isSolAddr(wallet) ? warbank.getBalance(wallet) : 0 }));
        return;
    }
    // --- Acreditar un depósito: el cliente manda {wallet, sig}; verificamos on-chain y acreditamos ---
    if (urlPath === '/api/deposit' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, reason: 'json inválido' })); return; }
            const wallet = String(p.wallet || ''), sig = String(p.sig || '');
            if (!isSolAddr(wallet) || !sig) { res.end(JSON.stringify({ ok: false, reason: 'datos inválidos' })); return; }
            if (warbank.sigUsed(sig)) { res.end(JSON.stringify({ ok: false, reason: 'depósito ya acreditado' })); return; }
            const v = await solana.verifyDeposit({ sig, fromOwner: wallet, minPill: 1 });
            if (!v.ok) { res.end(JSON.stringify({ ok: false, reason: v.reason || 'no verificado' })); return; }
            const saldo = warbank.creditDeposit(wallet, v.amount, sig);
            logAdmin('-', 'Depósito $PILL', wallet.slice(0, 6) + '… +' + v.amount);
            log(`Depósito acreditado: ${wallet.slice(0, 6)}… +${v.amount} PILL → saldo ${saldo}`);
            res.end(JSON.stringify({ ok: true, credited: v.amount, warBalance: saldo }));
        });
        return;
    }
    // --- Retiro: descuenta del saldo WAR y envía PILL del treasury a la wallet ---
    if (urlPath === '/api/withdraw' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
        req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            let p; try { p = JSON.parse(body); } catch (e) { res.end(JSON.stringify({ ok: false, reason: 'json inválido' })); return; }
            const wallet = String(p.wallet || ''), amount = Math.floor(Number(p.amount) || 0);
            const ts = Number(p.ts) || 0, message = String(p.message || ''), signature = p.signature;
            if (!isSolAddr(wallet) || amount <= 0) { res.end(JSON.stringify({ ok: false, reason: 'datos inválidos' })); return; }
            // El jugador debe FIRMAR el retiro con su wallet (prueba que es el dueño).
            const expected = `PillWars withdraw ${amount} PILL @ ${ts}`;
            if (message !== expected) { res.end(JSON.stringify({ ok: false, reason: 'mensaje inválido' })); return; }
            if (Math.abs(Date.now() - ts) > 120000) { res.end(JSON.stringify({ ok: false, reason: 'firma caducada, reintenta' })); return; }
            const sigKey = 'wd_' + (Array.isArray(signature) ? signature.join('') : '');
            if (warbank.sigUsed(sigKey)) { res.end(JSON.stringify({ ok: false, reason: 'firma ya usada' })); return; }
            if (!solana.verifySignedMessage(wallet, message, signature)) { res.end(JSON.stringify({ ok: false, reason: 'firma no válida' })); return; }
            if (!solana.canWithdraw()) { res.end(JSON.stringify({ ok: false, reason: 'retiros no disponibles (servidor sin clave del treasury)' })); return; }
            if (warbank.getBalance(wallet) < amount) { res.end(JSON.stringify({ ok: false, reason: 'saldo WAR insuficiente' })); return; }
            warbank.creditDeposit(wallet, 0, sigKey);   // marca la firma como usada (anti-replay)
            // Descontamos ANTES de enviar (evita doble retiro); si falla on-chain, devolvemos.
            warbank.debit(wallet, amount);
            try {
                const sig = await solana.withdraw(wallet, amount);
                const saldo = warbank.getBalance(wallet);
                logAdmin('-', 'Retiro $PILL', wallet.slice(0, 6) + '… -' + amount);
                log(`Retiro: ${wallet.slice(0, 6)}… -${amount} PILL → saldo ${saldo} (tx ${sig.slice(0, 8)}…)`);
                res.end(JSON.stringify({ ok: true, withdrawn: amount, warBalance: saldo, sig }));
            } catch (e) {
                warbank.credit(wallet, amount);   // refund del saldo WAR si el envío falló
                log(`Retiro FALLÓ (${wallet.slice(0, 6)}…): ${e.message} — saldo devuelto`);
                res.end(JSON.stringify({ ok: false, reason: 'envío on-chain falló: ' + e.message }));
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
    if (urlPath === '/admin' || urlPath === '/admin.html') {
        try {
            const html = fs.readFileSync(path.join(__dirname, 'admin.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
            res.end(html);
        } catch (e) { res.writeHead(500); res.end('No se pudo cargar admin.html'); }
        return;
    }
    // Estáticos del juego servidos desde la raíz del repo (mismo origen que el WS):
    // así el espectador del panel y un único túnel sirven web + juego + websocket.
    let rel = urlPath.replace(/^\/+/, '') || 'index.html';
    let filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    // Nunca servir carpetas privadas (datos con IPs, código de servidor, repo, notas)
    const top = path.relative(ROOT, filePath).replace(/\\/g, '/').split('/')[0].toLowerCase();
    if (['server', '.git', 'node_modules', 'tasks', '.claude', 'memory'].includes(top)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.stat(filePath, (err, st) => {
        if (!err && st.isDirectory()) filePath = path.join(filePath, 'index.html');
        fs.readFile(filePath, (e2, data) => {
            if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
            res.end(data);
        });
    });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
    let room = null, playerId = null, spectatorRoom = null;
    let rlWindow = 0, rlCount = 0;   // rate-limit: ventana (segundo) y mensajes en ella
    // Detrás del túnel/proxy de Cloudflare la IP real viene en cabeceras.
    // Se anonimiza de inmediato (RGPD): nunca se almacena ni se muestra la IP exacta.
    const ip = anonIp(cleanIp(req.headers['cf-connecting-ip']
        || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket.remoteAddress));

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
            const validKey = (msg.key === ADMIN_KEY);
            const validTok = msg.key && specTokens.has(msg.key) && specTokens.get(msg.key) > Date.now();
            if (!validKey && !validTok) {
                fb.c++; if (fb.c >= 8) { fb.until = Date.now() + 10*60*1000; fb.c = 0; log(`[seguridad] IP ${ip} bloqueada 10 min por intentos fallidos de admin`); }
                adminFails.set(ip, fb);
                ws.send(JSON.stringify({ t: 'adminError' })); return;
            }
            adminFails.delete(ip);
            // Token temporal para el espectador-control (10 min, single-use)
            if (msg.cmd === 'getSpecToken') {
                const tok = require('crypto').randomBytes(24).toString('hex');
                specTokens.set(tok, Date.now() + 10*60*1000);
                ws.send(JSON.stringify({ t: 'specToken', token: tok }));
                return;
            }
            if (msg.cmd === 'state') {
                ws.send(JSON.stringify(buildAdminState()));
            } else if (msg.cmd === 'kick' && msg.playerId) {
                const found = findClient(msg.playerId);
                if (found) {
                    try { found.cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {}
                    try { found.cli.ws.close(); } catch (e) {}
                    found.room.pendingRemovals.set(msg.playerId, 0);
                    logAdmin(found.room.key, 'Echó a un jugador', found.cli.name || '(sin nombre)');
                    log(`ADMIN expulsó a ${found.cli.name} de ${found.room.key}`);
                }
            } else if (msg.cmd === 'power' && msg.playerId) {
                const found = findClient(msg.playerId);
                if (found) {
                    if (found.room.worker) {
                        found.room.worker.postMessage({ type: 'cmd', pid: msg.playerId, name: msg.name, args: Array.isArray(msg.args) ? msg.args.slice(0, 4) : [] });
                    } else {
                        found.room.sim.runCommand(msg.playerId, msg.name, Array.isArray(msg.args) ? msg.args.slice(0, 4) : [], true);
                    }
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
            } else if (msg.cmd === 'setGlobal') {
                if (typeof msg.arcadeRestartMs === 'number') arcadeRestartMs = Math.max(1000, Math.min(300000, msg.arcadeRestartMs | 0));
                if (typeof msg.arcadeLobbyMs === 'number')  arcadeLobbyMs  = Math.max(0,    Math.min(120000, msg.arcadeLobbyMs  | 0));
                saveGlobal();
                ws.send(JSON.stringify(buildAdminState()));
                log(`Global arcade: restart=${arcadeRestartMs / 1000}s lobby=${arcadeLobbyMs / 1000}s`);
            } else if (msg.cmd === 'snapshotHz' && typeof msg.hz === 'number') {
                const prev = Math.round(TICK_HZ / SNAPSHOT_EVERY);
                SNAPSHOT_EVERY = hzToEvery(msg.hz | 0);
                const now = Math.round(TICK_HZ / SNAPSHOT_EVERY);
                logAdmin('-', 'Cambió snapshots Hz', prev + ' → ' + now);
                log(`ADMIN snapshots: ${prev}Hz → ${now}Hz (cada ${SNAPSHOT_EVERY} ticks)`);
            } else if (msg.cmd === 'aoiToggle') {
                AOI_ENABLED = !AOI_ENABLED;
                logAdmin('-', 'AOI ' + (AOI_ENABLED ? 'ACTIVADO' : 'DESACTIVADO'), '');
                log(`ADMIN AOI: ${AOI_ENABLED ? 'ON' : 'OFF'}`);
            } else if (msg.cmd === 'setLayerActive' && typeof msg.layerIdx === 'number') {
                // Apaga/enciende TODAS las layers con ese idx (ej. todas las L2).
                // Apagar: borra las salas del Map → dejan de consumir tick/RAM.
                //         Solo permitido si TODAS están vacías (no se echa a nadie).
                // Encender: las recrea con getOrCreateRoom (vuelven al matchmaker).
                const idx = msg.layerIdx | 0;
                const active = !!msg.active;
                if (idx < 1 || idx > LAYERS_PER_COMBO) {
                    ws.send(JSON.stringify({ t: 'layerActionError', reason: 'idx inválido' }));
                } else if (!active) {
                    // Apagar: buscar todas las layers de ese idx
                    // Solo se apagan salas PREMIUM (priceOf > 0). Las Free se quedan.
                    const targets = [];
                    let blocked = null;
                    for (const r of rooms.values()) {
                        if (r.layerIdx !== idx) continue;
                        if (priceOf(r.roomName) === 0) continue;   // Free intocable
                        if (r.clients.size > 0) { blocked = r.key; break; }
                        targets.push(r);
                    }
                    if (blocked) {
                        ws.send(JSON.stringify({ t: 'layerActionError', reason: 'Hay jugadores en ' + blocked + '. Espera a que se vacíe.' }));
                    } else {
                        for (const r of targets) {
                            rooms.delete(r.key);
                            for (const [tok, info] of resumeTokens) { if (info.roomKey === r.key) resumeTokens.delete(tok); }
                        }
                        layerOff[idx] = true;
                        logAdmin('-', 'Apagó Layer ' + idx + ' premium', targets.length + ' salas');
                        log(`ADMIN apagó Layer ${idx} premium: ${targets.length} salas borradas (Free intocable)`);
                    }
                } else {
                    // Encender: recrear las layers PREMIUM de ese idx (Free ya existen)
                    let n = 0;
                    for (const mode of CATALOG_MODES) {
                        for (const price of PRICES) {
                            if (priceOf(price) === 0) continue;   // Free ya existen
                            getOrCreateRoom(layerKeyOf(mode, price, idx), mode, price);
                            n++;
                        }
                    }
                    layerOff[idx] = false;
                    logAdmin('-', 'Encendió Layer ' + idx + ' premium', n + ' salas');
                    log(`ADMIN encendió Layer ${idx} premium: ${n} salas recreadas`);
                }
            } else if (msg.cmd === 'forceStart' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala && sala.state === 'waiting') { startMatch(sala); logAdmin(msg.room, 'Forzó el inicio', ''); log(`ADMIN forzó inicio de ${msg.room}`); }
            } else if (msg.cmd === 'restart' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala) { restartRoom(sala); logAdmin(msg.room, 'Reinició la sala', ''); }
            } else if (msg.cmd === 'kickAll' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala) {
                    for (const cli of sala.clients.values()) { try { cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {} try { cli.ws.close(); } catch (e) {} }
                    logAdmin(msg.room, 'Echó a todos', '');
                    log(`ADMIN vació la sala ${msg.room}`);
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
                    getOrCreateRoom(lk, mode, price);
                    logAdmin(lk, 'Encendió sala', '');
                    log(`ADMIN encendió sala: ${lk}`);
                }
            } else if (msg.cmd === 'kickAllMode' && msg.mode) {
                let n = 0;
                for (const sala of rooms.values()) {
                    if (msg.mode !== 'all' && sala.mode !== msg.mode) continue;
                    for (const cli of sala.clients.values()) { try { cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {} try { cli.ws.close(); } catch (e) {} }
                    n += sala.clients.size;
                }
                logAdmin('-', `Echó a todos del modo ${msg.mode}`, `${n} jugadores`);
                log(`ADMIN kickAll modo=${msg.mode}: ${n} jugadores`);
            } else if (msg.cmd === 'restartMode' && msg.mode) {
                let n = 0;
                for (const sala of rooms.values()) {
                    if (msg.mode !== 'all' && sala.mode !== msg.mode) continue;
                    restartRoom(sala); n++;
                }
                logAdmin('-', `Reinició modo ${msg.mode}`, `${n} salas`);
                log(`ADMIN restartMode=${msg.mode}: ${n} salas`);
            } else if (msg.cmd === 'restartServer') {
                logAdmin('-', 'Reinició el servidor', '');
                log('ADMIN ordenó reinicio del proceso — saliendo en 500ms');
                ws.send(JSON.stringify({ t: 'serverRestarting' }));
                // Dar tiempo al admin a recibir el ack antes de salir.
                // pm2/forever/systemd relanzarán el proceso automáticamente.
                setTimeout(() => process.exit(0), 500);
            } else if (msg.cmd === 'updateRanking') {
                computeRanking(!!msg.includeTesters);
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
            const mode = ['classic', 'arcade', 'skills'].includes(msg.mode) ? msg.mode : 'classic';
            let roomName = typeof msg.room === 'string' ? msg.room.slice(0, 12) : 'Free';
            // Espectador: puede pedir una layer concreta (?layer=2 del panel admin);
            // si no, se le mete en L1 por defecto. Si la layer pedida no existe,
            // cae a L1; si tampoco, specEmpty.
            const layerIdx = Math.max(1, Math.min(LAYERS_PER_COMBO, parseInt(msg.layer, 10) || 1));
            const key = layerKeyOf(mode, roomName, layerIdx);
            const sala = rooms.get(key) || rooms.get(layerKeyOf(mode, roomName, 1));
            if (!sala) { ws.send(JSON.stringify({ t: 'specEmpty' })); return; }
            spectatorRoom = sala;
            sala.spectators.add(ws);
            if (sala.worker) sala.worker.postMessage({ type: 'setSpectators', on: true });
            // welcome sin id de jugador → el cliente entra como espectador puro
            ws.send(welcomeMsg(sala, null, null, 'specWelcome'));   // playerId=null → id:null en el head
            log(`Espectador conectado a ${key} (${sala.spectators.size} mirando)`);
            return;
        }

        if (msg.t === 'join' && !room) {
            // Reconexión con token
            if (msg.resume) {
                const tok = resumeTokens.get(msg.resume);
                const r = tok ? rooms.get(tok.roomKey) : null;
                if (tok && r && !r.worker && r.sim.players.has(tok.playerId) && !r.clients.has(tok.playerId)) {
                    room = r; playerId = tok.playerId;
                    room.pendingRemovals.delete(playerId);
                    const p = room.sim.players.get(playerId);
                    room.clients.set(playerId, { ws, ip, name: p.name, joinedAt: Date.now(), token: msg.resume, opts: { name: p.name, colorBot: p.colorBot, colorTop: p.colorTop, skinUrl: p.skinUrl } });
                    ws.send(welcomeMsg(room, playerId, msg.resume));
                    refillBots(room);
                    log(`Jugador '${p.name}' RECONECTADO a ${room.key}`);
                } else {
                    ws.send(JSON.stringify({ t: 'resumeFail' }));
                }
                return;
            }
            const mode = ['classic', 'arcade', 'skills'].includes(msg.mode) ? msg.mode : 'classic';
            let roomName = typeof msg.room === 'string' ? msg.room.slice(0, 12) : 'Free';
            if (roomName === '*') roomName = resolveQuickJoin(mode);
            // Matchmaker: elige la layer del combo (apilando). null = todas mal
            // (llenas, a punto de acabar o ended). En ese caso el cliente recibe
            // noSlot y sigue en práctica offline.
            room = pickLayer(mode, roomName);
            if (!room) {
                ws.send(JSON.stringify({ t: 'noSlot', roomName, mode }));
                log(`Sin sitio en ${comboKeyOf(mode, roomName)}: todas las layers llenas o a punto de acabar`);
                return;
            }
            const key = room.key;
            const ck = room.comboKey;
            // Precio BLOQUEADO por sala: si esta sala está vacía (este es el primer
            // jugador), fija el precio al del oráculo actual. Mientras haya gente, no
            // cambia → todos en la misma partida pagan los mismos PILL (reparto justo).
            if (room.clients.size === 0) room.pillRate = PILL_PER_DOLLAR;
            // Salas de pago: exigir FIRMA de la wallet + descontar del saldo WAR.
            // Excepción: bots del stress test pueden entrar gratis con el token de tester
            // (solo válido si se ejecutan en el mismo servidor: SOL_RPC=devnet).
            // Fee/firma de pago van por COMBO (mode_price), no por layer:
            // la firma del usuario es la misma para classic_5$ aunque le toque
            // L1 o L2 — el server las cobra al saldo igual.
            const fee = entryFeePill(ck, room.pillRate);
            let payWallet = null;
            const TESTER_OK = msg.tester === 'STRESS_TEST_DEVNET' && /devnet/i.test(solana.RPC || '');
            if (fee > 0 && !TESTER_OK) {
                const pay = msg.pay || {};
                const w = String(pay.wallet || ''), ts = Number(pay.ts) || 0;
                const expected = `PillWars enter ${ck} paying ${fee} PILL @ ${ts}`;
                const reject = (reason) => { ws.send(JSON.stringify({ t: 'payRequired', room: roomName, fee, reason, balance: isSolAddr(w) ? warbank.getBalance(w) : 0 })); room = null; };
                if (!isSolAddr(w) || pay.message !== expected || Math.abs(Date.now() - ts) > 120000) { reject('firma de pago inválida'); return; }
                const sigKey = 'enter_' + (Array.isArray(pay.signature) ? pay.signature.join('') : '');
                if (warbank.sigUsed(sigKey)) { reject('firma ya usada'); return; }
                if (!solana.verifySignedMessage(w, pay.message, pay.signature)) { reject('firma no válida'); return; }
                if (warbank.getBalance(w) < fee) { reject('saldo WAR insuficiente'); return; }
                warbank.debit(w, fee);
                warbank.creditDeposit(w, 0, sigKey);   // marca la firma como usada (anti-replay)
                payWallet = w;
                logAdmin(key, 'Entrada pagada', w.slice(0, 6) + '… -' + fee + ' PILL');
                log(`Entrada pagada: ${w.slice(0, 6)}… -${fee} PILL → ${key}`);
            }
            playerId = PillSim.uuid();
            const name = typeof msg.name === 'string' ? msg.name.slice(0, 16) : '';
            const opts = {
                name,
                colorBot: typeof msg.colorBot === 'string' ? msg.colorBot.slice(0, 9) : undefined,
                colorTop: typeof msg.colorTop === 'string' ? msg.colorTop.slice(0, 9) : undefined,
                skinUrl: typeof msg.skinUrl === 'string' ? msg.skinUrl.slice(0, 300) : null
            };
            if (room.worker) room.worker.postMessage({ type: 'addPlayer', pid: playerId, opts, aspect: (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1, useBin: msg.bin === 1 || msg.bin === true });
            else room.sim.addPlayer(playerId, opts);
            const _alive = true, _killStreak = 0;
            const token = PillSim.uuid() + PillSim.uuid();
            resumeTokens.set(token, { roomKey: key, playerId });
            // Guarda el clientId anónimo del navegador para que el servidor pueda
            // sumar las quests autoritativamente (sin depender de lo que mande el cliente).
            const cid = (typeof msg.cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(msg.cid)) ? msg.cid : null;
            // carry: dinero "retenido" del jugador en esta sala (se inicializa con su entrada y sube al matar).
            // Opt-in al protocolo binario para snapshots (msg.bin === 1).
            // Eco en welcome.useBin para que el cliente decodifique los frames.
            const useBin = msg.bin === 1 || msg.bin === true;
            const aspect = (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1;
            room.clients.set(playerId, { ws, ip, name, joinedAt: Date.now(), token, opts, cid, paidFee: fee || 0, payWallet, carry: fee || 0, isTester: TESTER_OK, useBin, aspect, _alive, _killStreak });
            sendEcon(room.clients.get(playerId), room);
            // Stats por COMBO (compartidas entre layers).
            const st_ = statsOf(ck); st_.entradas++; if (!TESTER_OK) st_.entradasReal++; statsDirty = true;
            if (name && !TESTER_OK) { const st = pstatOf(name); st.name = name; st.partidas++; st.lastSeen = new Date().toISOString(); st.lastIp = ip; st.isReal = true; playersDirty = true; }
            if (cid) dailyquests.recordEvent(cid, room.mode === 'classic' ? 'classic_match' : 'arcade_match', 1);
            if (!TESTER_OK) logConnection({ fecha: new Date().toISOString(), nombre: name || '(sin nombre)', ip, sala: key, id: playerId });
            if (room.state === 'playing') {
                if (room.worker) room.worker.postMessage({ type: 'spawnPlayer', pid: playerId });
                else room.sim.spawnPlayer(playerId);
                refillBots(room);
            }
            ws.send(welcomeMsg(room, playerId, token, undefined, useBin ? { useBin: true } : null));
            log(`Jugador '${name}' (${ip}) entró en ${key} [${room.state}] — ${room.clients.size}/${minRealOf(ck)}${useBin ? ' [bin]' : ''}`);
            if (room.state === 'waiting') {
                sendWaiting(room);
                armLobby(room);
            } else if (room.state === 'ended') {
                const restartIn = Math.max(0, room.restartAt - now);
                ws.send(JSON.stringify({ t: 'lobbyPreview', count: room.clients.size, needed: minRealOf(room.comboKey), roomName: room.roomName, mode: room.mode, restartIn }));
            }
            return;
        }
        if (!room || !playerId) return;

        if (msg.t === 'input') {
            const input = (typeof msg.tx === 'number' && typeof msg.ty === 'number') ? { tx: msg.tx, ty: msg.ty } : null;
            if (room.worker) room.worker.postMessage({ type: 'setInput', pid: playerId, input });
            else room.sim.setInput(playerId, input);
        } else if (msg.t === 'aspect') {
            const cli = room.clients.get(playerId);
            if (cli && typeof msg.r === 'number' && msg.r > 0) {
                cli.aspect = Math.max(0.5, Math.min(4, msg.r));
                if (room.worker) room.worker.postMessage({ type: 'setAspect', pid: playerId, aspect: cli.aspect });
            }
        } else if (msg.t === 'action') {
            if (msg.kind === 'split') {
                const a = { kind: 'split', tx: +msg.tx || 0, ty: +msg.ty || 0 };
                if (room.worker) room.worker.postMessage({ type: 'action', pid: playerId, action: a });
                else room.sim.queueAction(playerId, a);
            } else if (msg.kind === 'skill') {
                const a = { kind: 'skill', slot: msg.slot | 0, tx: +msg.tx || 0, ty: +msg.ty || 0 };
                if (room.worker) room.worker.postMessage({ type: 'action', pid: playerId, action: a });
                else room.sim.queueAction(playerId, a);
            }
        } else if (msg.t === 'pickSkill') {
            const id = msg.id | 0;
            if (id >= 1 && id <= 8) {
                if (room.worker) room.worker.postMessage({ type: 'grantSkill', pid: playerId, skillId: id });
                else room.sim.grantSkillToPlayer(playerId, id);
            }
        } else if (msg.t === 'reorder') {
            if (room.worker) room.worker.postMessage({ type: 'reorder', pid: playerId, from: msg.from | 0, to: msg.to | 0 });
            else {
                const p = room.sim.players.get(playerId);
                if (p) { const a = msg.from | 0, b = msg.to | 0; if (a >= 0 && a < p.skillSlots.length && b >= 0 && b < p.skillSlots.length && a !== b) { const t = p.skillSlots[a]; p.skillSlots[a] = p.skillSlots[b]; p.skillSlots[b] = t; } }
            }
        } else if (msg.t === 'cmd') {
            if (room.worker) room.worker.postMessage({ type: 'cmd', pid: playerId, name: msg.name, args: Array.isArray(msg.args) ? msg.args.slice(0, 4) : [] });
            else room.sim.runCommand(playerId, msg.name, Array.isArray(msg.args) ? msg.args.slice(0, 4) : []);
            log(`Comando de ${playerId}: /${msg.name} ${(msg.args || []).join(' ')}`);
        }
    });

    ws.on('close', () => {
        if (spectatorRoom) {
            spectatorRoom.spectators.delete(ws);
            if (spectatorRoom.worker && spectatorRoom.spectators.size === 0) spectatorRoom.worker.postMessage({ type: 'setSpectators', on: false });
        }
        if (room && playerId && room.clients.get(playerId) && room.clients.get(playerId).ws === ws) {
            const cli = room.clients.get(playerId);
            // FIX: si se desconecta SIN morir (cerró pestaña), guardar su mejor masa
            // y contarle la muerte. Antes solo se actualizaba en playerDied.
            if (room.worker) {
                room.worker.postMessage({ type: 'removePlayer', pid: playerId });
                // Con worker no tenemos acceso síncrono al estado alive/kills del jugador.
                // El peak mass se flushea cuando llega del worker (processWorkerEvent).
                // Para classic cashout, usamos un flag _alive que mantiene el main thread.
                if (cli._alive) {
                    flushPeakMass(room, playerId, cli);
                    if (cli.name && !cli.isTester) { pstatOf(cli.name).muertes++; playersDirty = true; }
                    const ds_ = statsOf(room.comboKey); ds_.muertes++; if (!cli.isTester) ds_.muertesReal++; statsDirty = true;
                    if (room.mode === 'classic' && cli.carry > 0 && room.state === 'playing') classicCashout(room, cli, cli._killStreak || 0);
                } else if (room.mode === 'classic' && cli.carry > 0 && room.state === 'playing') {
                    cli.carry = 0;
                }
            } else {
                const pj = room.sim.players.get(playerId);
                if (pj && pj.alive) {
                    flushPeakMass(room, playerId, cli);
                    if (pj.name && !cli.isTester) { pstatOf(pj.name).muertes++; playersDirty = true; }
                    const ds_ = statsOf(room.comboKey); ds_.muertes++; if (!cli.isTester) ds_.muertesReal++; statsDirty = true;
                    if (room.mode === 'classic' && cli.carry > 0 && room.state === 'playing') classicCashout(room, cli, pj.killStreak | 0);
                } else if (room.mode === 'classic' && cli.carry > 0 && room.state === 'playing') {
                    cli.carry = 0;
                }
            }
            // Reembolso de la entrada si la partida NO había empezado (paidFee>0 = no consumida).
            if (cli.paidFee > 0 && cli.payWallet && room.state === 'waiting') {
                warbank.credit(cli.payWallet, cli.paidFee);
                log(`Reembolso de entrada (sala no empezó): ${cli.payWallet.slice(0, 6)}… +${cli.paidFee} PILL`);
            }
            room.clients.delete(playerId);
            if (!room.pendingRemovals.has(playerId)) room.pendingRemovals.set(playerId, Date.now() + RESUME_GRACE_MS);
            log(`Jugador ${playerId} desconectado de ${room.key} — quedan ${room.clients.size}`);
            if (room.state === 'waiting') { sendWaiting(room); armLobby(room); }   // cancela la cuenta atrás si baja del mínimo
            refillBots(room);   // un bot cubre el hueco (y se retira si el jugador reconecta)
        }
    });
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
// Cuando este módulo viva en un worker_thread, este ctx será un proxy de
// postMessage en vez de refs directas.
const tickFlags = { stats: false, players: false, quests: false };
const tickCtx = {
    // módulos
    warbank, dailyquests, proto,
    // estado compartido (lectura/escritura)
    resumeTokens,
    flags: tickFlags,
    // funciones puras
    log, logAdmin, broadcast, restartRoom, startMatch, tickGradualBots,
    buildSnapshotFor, aoiBoxFor,
    pstatOf, statsOf, questsOf, addToPot, sendEcon, entryFeePill, flushPeakMass, minRealOf,
    deleteRoom: (key) => rooms.delete(key),
    // constantes
    DEAD_REMOVE_MS, EMPTY_ROOM_TTL,
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
    let stepMs = 0, snapMs = 0, sendMs = 0;
    const now = tickStartT;
    for (const room of rooms.values()) {
        if (room.worker) {
            // Procesar deadRemovals y pendingRemovals para rooms con worker
            for (const [pid, deadline] of room.deadRemovals) {
                if (now >= deadline) { room.deadRemovals.delete(pid); room.worker.postMessage({ type: 'removePlayer', pid }); }
            }
            for (const [pid, deadline] of room.pendingRemovals) {
                if (now >= deadline) { room.pendingRemovals.delete(pid); room.worker.postMessage({ type: 'removePlayer', pid }); resumeTokens.forEach((v, k) => { if (v.playerId === pid) resumeTokens.delete(k); }); }
            }
            continue;
        }
        const m = tickRoomOnce(room, now, tickCtx);
        stepMs += m.stepMs; snapMs += m.snapMs; sendMs += m.sendMs;
    }
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

initLayers();   // pre-crea las 20 salas (LAYERS_PER_COMBO × 2 modos × 5 precios)

httpServer.listen(PORT, () => {
    log(`Servidor PillWars escuchando en ws://localhost:${PORT}`);
    // Solo mostramos la clave si es la insegura por defecto (avisamos) — en producción NUNCA se loguea
    if (ADMIN_KEY === '1234') log(`⚠ [SEGURIDAD] ADMIN_KEY no definida — usando '1234' por defecto. Define ADMIN_KEY en producción.`);
    else log(`Panel de admin: http://localhost:${PORT}/admin  (clave definida en ADMIN_KEY, ${ADMIN_KEY.length} chars)`);
    log(`Lobby: mínimo ${MIN_PLAYERS} reales, población objetivo ${TARGET_POP} (editable por sala en el panel)`);
    log(`Privacidad: IPs anonimizadas, logs borrados a los ${LOG_RETENTION_DAYS} días`);
});
