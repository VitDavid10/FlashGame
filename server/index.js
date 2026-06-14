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
const { WebSocketServer } = require('ws');
const PillSim = require('../shared/sim.js');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const ADMIN_KEY = process.env.ADMIN_KEY || '1234';
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS, 10) || 5;    // reales para empezar (editable por sala desde el panel)
const TARGET_POP = parseInt(process.env.TARGET_POP, 10) || 10;     // población objetivo: reales + bots de relleno
const MATCH_MS = parseInt(process.env.MATCH_MS, 10) || (3 * 60 * 1000 + 50 * 1000);
const RESTART_MS = parseInt(process.env.RESTART_MS, 10) || 30000;
const TICK_MS = 25;            // 40 Hz de simulación
const SNAPSHOT_EVERY = 1;      // snapshot en cada tick → 40 Hz (más fluidez)
const EMPTY_ROOM_TTL = 60000;
const RESUME_GRACE_MS = 15000;
const DEAD_REMOVE_MS = 3000;   // tras morir, retirar al jugador de la sim
const LOG_FILE = path.join(__dirname, 'connections.log');
const STATS_FILE = path.join(__dirname, 'stats.json');
const RULES_FILE = path.join(__dirname, 'roomrules.json');

const PRICES = ['Free', '5$', '10$', '20$', '50$'];
const CATALOG_MODES = ['classic', 'arcade'];

const rooms = new Map();
const resumeTokens = new Map();   // token → { roomKey, playerId }

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args); }
function priceOf(roomName) { const m = String(roomName).match(/(\d+)\s*\$/); return m ? parseInt(m[1], 10) : 0; }

// --- Persistencia simple (historial, stats, reglas) ---
function loadJson(file, fallback) { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {} return fallback; }
let connLog = [];
try { if (fs.existsSync(LOG_FILE)) connLog = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) {}
function logConnection(entry) { connLog.push(entry); fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', () => {}); }

const PLAYERS_FILE = path.join(__dirname, 'players.json');
const roomStats = loadJson(STATS_FILE, {});     // roomKey → { entradas, muertes }
const roomRules = loadJson(RULES_FILE, {});     // roomKey → { speed, food, virus, botsEnabled, botCount }
const playerStats = loadJson(PLAYERS_FILE, {}); // nombre (minúsculas) → { name, partidas, kills, muertes, lastSeen, lastIp }
let statsDirty = false, rulesDirty = false, playersDirty = false;
function statsOf(key) { if (!roomStats[key]) roomStats[key] = { entradas: 0, muertes: 0 }; return roomStats[key]; }
function rulesOf(key) {
    if (!roomRules[key]) roomRules[key] = { speed: 1, food: 1, virus: 1, botsEnabled: false, botCount: 20 };
    const r = roomRules[key];
    if (r.minReal == null) r.minReal = MIN_PLAYERS;
    if (r.targetPop == null) r.targetPop = TARGET_POP;
    return r;
}
function minRealOf(key) { return Math.max(1, rulesOf(key).minReal); }
function targetPopOf(key) { return Math.max(0, rulesOf(key).targetPop); }
function pstatOf(name) {
    const k = String(name).toLowerCase();
    if (!playerStats[k]) playerStats[k] = { name: name, partidas: 0, kills: 0, muertes: 0, lastSeen: null, lastIp: null };
    return playerStats[k];
}
setInterval(() => {
    if (statsDirty) { statsDirty = false; fs.writeFile(STATS_FILE, JSON.stringify(roomStats, null, 1), () => {}); }
    if (rulesDirty) { rulesDirty = false; fs.writeFile(RULES_FILE, JSON.stringify(roomRules, null, 1), () => {}); }
    if (playersDirty) { playersDirty = false; fs.writeFile(PLAYERS_FILE, JSON.stringify(playerStats, null, 1), () => {}); }
    if (geoDirty) { geoDirty = false; fs.writeFile(GEO_FILE, JSON.stringify(geoCache, null, 1), () => {}); }
}, 5000);

function cleanIp(addr) { return String(addr || '?').replace(/^::ffff:/, '').replace(/^::1$/, 'localhost'); }

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
        enforceGod: true   // online: comandos de truco solo para jugadores con GOD (lo da el admin)
    });
    sim.populate();
    return sim;
}

function getOrCreateRoom(key, mode, roomName) {
    if (!rooms.has(key)) {
        const rules = rulesOf(key); rulesDirty = true;
        rooms.set(key, {
            key, mode, roomName,
            sim: buildSim(mode, rules),
            clients: new Map(),
            state: 'waiting',                 // waiting | playing | ended
            tickCount: 0, lastTick: Date.now(), emptySince: 0,
            endsAt: null, restartAt: null,
            pendingRemovals: new Map(),       // gracia de reconexión
            deadRemovals: new Map(),          // retirada de muertos
            spectators: new Set()             // ws que solo miran (panel de control)
        });
        log(`Sala creada: ${key} (lobby, mínimo ${minRealOf(key)} reales, población ${targetPopOf(key)})`);
    }
    return rooms.get(key);
}

function broadcast(room, objOrString) {
    const m = typeof objOrString === 'string' ? objOrString : JSON.stringify(objOrString);
    for (const cli of room.clients.values()) { if (cli.ws.readyState === 1) cli.ws.send(m); }
}

function sendWaiting(room) {
    broadcast(room, { t: 'waiting', count: room.clients.size, needed: minRealOf(room.key), roomName: room.roomName });
}

function welcomeMsg(room, playerId, token, type) {
    return {
        t: type || 'welcome', id: playerId, token,
        mapSize: room.sim.mapSize, mode: room.mode, roomName: room.roomName,
        state: room.state, count: room.clients.size, needed: minRealOf(room.key),
        duration: MATCH_MS,
        tl: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : null,
        restartEnMs: room.restartAt ? Math.max(0, room.restartAt - Date.now()) : null,
        simTime: Math.round(room.sim.now),
        foods: room.sim.foods
    };
}

// Backfill: mantiene la población en targetPop rellenando con bots.
// Con población 0 no se toca nada (gestión manual de bots desde reglas).
function refillBots(room) {
    if (room.state !== 'playing') return;
    const target = targetPopOf(room.key);
    if (target === 0) return;
    const sim = room.sim;
    const deseados = Math.max(0, target - room.clients.size);
    const grupos = [...new Set(sim.enemies.map(e => e.id))];
    sim.config.botConfig.count = deseados;
    sim.config.botConfig.enabled = deseados > 0;
    sim.config.botConfig.respawn = deseados > 0;
    if (grupos.length < deseados) {
        for (let i = grupos.length; i < deseados; i++) sim.spawnBot();
    } else if (grupos.length > deseados) {
        // retirar los grupos con menos masa: es lo que menos se nota en la partida
        const masaDe = id => sim.enemies.filter(e => e.id === id).reduce((s, c) => s + c.mass, 0);
        const quitar = new Set(grupos.sort((a, b) => masaDe(a) - masaDe(b)).slice(0, grupos.length - deseados));
        sim.enemies = sim.enemies.filter(e => !quitar.has(e.id));
    }
}

function startMatch(room) {
    if (room.state !== 'waiting') return;
    room.state = 'playing';
    room.lastTick = Date.now();
    if (room.mode !== 'classic') room.endsAt = Date.now() + MATCH_MS;
    for (const [pid, cli] of room.clients) {
        if (!room.sim.players.has(pid)) room.sim.addPlayer(pid, cli.opts || {});
        room.sim.spawnPlayer(pid);
        if (cli.ws.readyState === 1) cli.ws.send(JSON.stringify(welcomeMsg(room, pid, cli.token, 'matchStart')));
    }
    refillBots(room);
    log(`¡Partida INICIADA en ${room.key}: ${room.clients.size} reales + ${new Set(room.sim.enemies.map(e => e.id)).size} bots de relleno`);
}

function restartRoom(room) {
    // Aviso a los que estén jugando: pantalla de fin + TRY AGAIN en el cliente
    broadcast(room, { t: 'roomRestart' });
    room.sim = buildSim(room.mode, rulesOf(room.key));
    room.state = 'waiting';
    room.endsAt = null; room.restartAt = null; room.ended = false;
    room.deadRemovals.clear(); room.pendingRemovals.clear();
    // los clientes que sigan conectados vuelven al lobby
    for (const [pid, cli] of room.clients) { room.sim.addPlayer(pid, cli.opts || {}); }
    sendWaiting(room);
    if (room.clients.size >= minRealOf(room.key)) startMatch(room);
    log(`Sala reiniciada: ${room.key}`);
}

function shutdownRoom(room, motivo) {
    for (const cli of room.clients.values()) {
        try { cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {}
        try { cli.ws.close(); } catch (e) {}
    }
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

function buildSnapshot(room) {
    const sim = room.sim;
    const ssOf = p => { const out = {}; for (let i = 1; i <= 8; i++) { if (p.skillState[i] > 0) out[i] = Math.round(p.skillState[i]); } return out; };
    return {
        t: 'snap',
        time: Math.round(sim.now),
        tl: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : null,
        players: [...sim.players.values()].map(p => ({
            id: p.id, name: p.name, ks: p.killStreak, alive: p.alive, gcd: Math.round(p.globalCD),
            slots: p.skillSlots.map(s => s ? { id: s.id, u: s.uses } : 0),
            ss: ssOf(p),
            cells: p.cells.map(cellData)
        })),
        bots: sim.enemies.map(c => Object.assign(cellData(c), { id: c.id, n: c.name })),
        viruses: sim.viruses.map(v => ({ ci: v.ci, x: round1(v.x), y: round1(v.y), r: round1(v.r), d: v.damaged ? 1 : 0, a: round1(v.animTime) })),
        ejected: sim.ejectedMasses.map(m => ({ ci: m.ci, x: round1(m.x), y: round1(m.y), r: m.r, c1: m.c1, c2: m.c2, a: round1(m.angle || 0) })),
        projectiles: sim.projectiles.map(p => ({ ci: p.ci, x: round1(p.x), y: round1(p.y), r: p.r }))
    };
}

// --- Estado para el panel de admin: catálogo completo + salas dinámicas ---
function buildAdminState() {
    const now = Date.now();
    const list = [];
    const keysSeen = new Set();
    const roomEntry = (key, mode, roomName, room) => {
        const stats = statsOf(key);
        const rules = rulesOf(key);
        const price = priceOf(roomName);
        const entry = {
            key, mode, roomName, price,
            state: room ? room.state : 'offline',
            conectados: room ? room.clients.size : 0,
            needed: minRealOf(key),
            bots: room ? new Set(room.sim.enemies.map(e => e.id)).size : 0,
            rules,
            stats: { entradas: stats.entradas, muertes: stats.muertes, dinero: stats.entradas * price },
            tlMs: (room && room.endsAt) ? Math.max(0, room.endsAt - now) : null,
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
        return entry;
    };
    for (const mode of CATALOG_MODES) {
        for (const price of PRICES) {
            const key = mode + '_' + price;
            keysSeen.add(key);
            list.push(roomEntry(key, mode, price, rooms.get(key) || null));
        }
    }
    for (const room of rooms.values()) {
        if (!keysSeen.has(room.key)) list.push(roomEntry(room.key, room.mode, room.roomName, room));
    }
    let totEntradas = 0, totMuertes = 0, totDinero = 0;
    for (const e of list) { totEntradas += e.stats.entradas; totMuertes += e.stats.muertes; totDinero += e.stats.dinero; }
    // Ranking de jugadores con nombre (los anónimos quedan fuera)
    const ranking = Object.values(playerStats)
        .filter(p => p.name && p.name.trim().length > 0)
        .sort((a, b) => (b.kills - a.kills) || (b.partidas - a.partidas))
        .slice(0, 15);
    // Ranking de países según la IP de cada conexión del historial
    const porPais = {};
    for (const c of connLog) {
        const g = geoOf(c.ip);
        if (!porPais[g.code]) porPais[g.code] = { code: g.code, name: g.name, entradas: 0, dinero: 0 };
        porPais[g.code].entradas++;
        porPais[g.code].dinero += priceOf(c.sala);
    }
    const paises = Object.values(porPais).sort((a, b) => (b.dinero - a.dinero) || (b.entradas - a.entradas));
    return {
        t: 'adminState',
        minPlayers: MIN_PLAYERS,
        totales: { entradas: totEntradas, muertes: totMuertes, dinero: totDinero, salasOnline: [...rooms.values()].filter(r => r.clients.size > 0).length, jugadores: [...rooms.values()].reduce((s, r) => s + r.clients.size, 0), jugadoresUnicos: Object.keys(playerStats).length },
        rooms: list,
        ranking,
        paises,
        historial: connLog.slice(-30).reverse()
    };
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
const httpServer = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/admin' || urlPath === '/admin.html') {
        try {
            const html = fs.readFileSync(path.join(__dirname, 'admin.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
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
    // Detrás del túnel/proxy de Cloudflare la IP real viene en cabeceras
    const ip = cleanIp(req.headers['cf-connecting-ip']
        || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket.remoteAddress);

    ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch (e) { return; }

        // --- Administración ---
        if (msg.t === 'admin') {
            if (msg.key !== ADMIN_KEY) { ws.send(JSON.stringify({ t: 'adminError' })); return; }
            if (msg.cmd === 'state') {
                ws.send(JSON.stringify(buildAdminState()));
            } else if (msg.cmd === 'kick' && msg.playerId) {
                const found = findClient(msg.playerId);
                if (found) {
                    try { found.cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {}
                    try { found.cli.ws.close(); } catch (e) {}
                    found.room.pendingRemovals.set(msg.playerId, 0);
                    log(`ADMIN expulsó a ${found.cli.name} de ${found.room.key}`);
                }
            } else if (msg.cmd === 'power' && msg.playerId) {
                const found = findClient(msg.playerId);
                if (found) { found.room.sim.runCommand(msg.playerId, msg.name, Array.isArray(msg.args) ? msg.args.slice(0, 4) : [], true); log(`ADMIN poder /${msg.name} a ${found.cli.name}`); }
            } else if (msg.cmd === 'rules' && msg.room) {
                const rules = rulesOf(msg.room); const r = msg.rules || {};
                if (typeof r.speed === 'number') rules.speed = Math.max(0.25, Math.min(5, r.speed));
                if (typeof r.food === 'number') rules.food = Math.max(0.25, Math.min(10, r.food));
                if (typeof r.virus === 'number') rules.virus = Math.max(0, Math.min(10, r.virus));
                if (typeof r.botsEnabled === 'boolean') rules.botsEnabled = r.botsEnabled;
                if (typeof r.botCount === 'number') rules.botCount = Math.max(0, Math.min(200, r.botCount | 0));
                if (typeof r.minReal === 'number') rules.minReal = Math.max(1, Math.min(50, r.minReal | 0));
                if (typeof r.targetPop === 'number') rules.targetPop = Math.max(0, Math.min(60, r.targetPop | 0));
                rulesDirty = true;
                const sala = rooms.get(msg.room);
                if (sala) { // speed, food y población se aplican en vivo; virus y bots manuales al reiniciar
                    sala.sim.config.worldSettings.speed = rules.speed;
                    sala.sim.config.worldSettings.food = rules.food;
                    if (sala.state === 'playing') refillBots(sala);
                    if (sala.state === 'waiting') {
                        sendWaiting(sala);
                        if (sala.clients.size >= minRealOf(msg.room)) startMatch(sala);
                    }
                }
                log(`ADMIN reglas en ${msg.room}: ${JSON.stringify(rules)}`);
            } else if (msg.cmd === 'forceStart' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala && sala.state === 'waiting') { startMatch(sala); log(`ADMIN forzó inicio de ${msg.room}`); }
            } else if (msg.cmd === 'restart' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala) restartRoom(sala);
            } else if (msg.cmd === 'kickAll' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala) {
                    for (const cli of sala.clients.values()) { try { cli.ws.send(JSON.stringify({ t: 'kicked' })); } catch (e) {} try { cli.ws.close(); } catch (e) {} }
                    log(`ADMIN vació la sala ${msg.room}`);
                }
            } else if (msg.cmd === 'shutdown' && msg.room) {
                const sala = rooms.get(msg.room);
                if (sala) shutdownRoom(sala, 'admin');
            }
            return;
        }

        // --- Espectador puro (panel de control): mira la sala sin jugar ---
        if (msg.t === 'spectate' && !room && !spectatorRoom) {
            const mode = ['classic', 'arcade', 'skills'].includes(msg.mode) ? msg.mode : 'classic';
            let roomName = typeof msg.room === 'string' ? msg.room.slice(0, 12) : 'Free';
            const key = mode + '_' + roomName;
            const sala = rooms.get(key);
            if (!sala) { ws.send(JSON.stringify({ t: 'specEmpty' })); return; }
            spectatorRoom = sala;
            sala.spectators.add(ws);
            // welcome sin id de jugador → el cliente entra como espectador puro
            ws.send(JSON.stringify(Object.assign(welcomeMsg(sala, null, null, 'specWelcome'), { id: null })));
            log(`Espectador conectado a ${key} (${sala.spectators.size} mirando)`);
            return;
        }

        if (msg.t === 'join' && !room) {
            // Reconexión con token
            if (msg.resume) {
                const tok = resumeTokens.get(msg.resume);
                const r = tok ? rooms.get(tok.roomKey) : null;
                if (tok && r && r.sim.players.has(tok.playerId) && !r.clients.has(tok.playerId)) {
                    room = r; playerId = tok.playerId;
                    room.pendingRemovals.delete(playerId);
                    const p = room.sim.players.get(playerId);
                    room.clients.set(playerId, { ws, ip, name: p.name, joinedAt: Date.now(), token: msg.resume, opts: { name: p.name, colorBot: p.colorBot, colorTop: p.colorTop, skinUrl: p.skinUrl } });
                    ws.send(JSON.stringify(welcomeMsg(room, playerId, msg.resume)));
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
            const key = mode + '_' + roomName;
            room = getOrCreateRoom(key, mode, roomName);
            playerId = PillSim.uuid();
            const name = typeof msg.name === 'string' ? msg.name.slice(0, 16) : '';
            const opts = {
                name,
                colorBot: typeof msg.colorBot === 'string' ? msg.colorBot.slice(0, 9) : undefined,
                colorTop: typeof msg.colorTop === 'string' ? msg.colorTop.slice(0, 9) : undefined,
                skinUrl: typeof msg.skinUrl === 'string' ? msg.skinUrl.slice(0, 300) : null
            };
            room.sim.addPlayer(playerId, opts);
            const token = PillSim.uuid() + PillSim.uuid();
            resumeTokens.set(token, { roomKey: key, playerId });
            room.clients.set(playerId, { ws, ip, name, joinedAt: Date.now(), token, opts });
            statsOf(key).entradas++; statsDirty = true;
            if (name) { const st = pstatOf(name); st.name = name; st.partidas++; st.lastSeen = new Date().toISOString(); st.lastIp = ip; playersDirty = true; }
            logConnection({ fecha: new Date().toISOString(), nombre: name || '(sin nombre)', ip, sala: key, id: playerId });
            if (room.state === 'playing') { room.sim.spawnPlayer(playerId); refillBots(room); }
            ws.send(JSON.stringify(welcomeMsg(room, playerId, token)));
            log(`Jugador '${name}' (${ip}) entró en ${key} [${room.state}] — ${room.clients.size}/${minRealOf(key)}`);
            if (room.state === 'waiting') {
                sendWaiting(room);
                if (room.clients.size >= minRealOf(key)) startMatch(room);
            }
            return;
        }
        if (!room || !playerId) return;

        if (msg.t === 'input') {
            room.sim.setInput(playerId, (typeof msg.tx === 'number' && typeof msg.ty === 'number') ? { tx: msg.tx, ty: msg.ty } : null);
        } else if (msg.t === 'action') {
            if (msg.kind === 'split') room.sim.queueAction(playerId, { kind: 'split', tx: +msg.tx || 0, ty: +msg.ty || 0 });
            else if (msg.kind === 'skill') room.sim.queueAction(playerId, { kind: 'skill', slot: msg.slot | 0, tx: +msg.tx || 0, ty: +msg.ty || 0 });
        } else if (msg.t === 'pickSkill') {
            const id = msg.id | 0;
            if (id >= 1 && id <= 8) room.sim.grantSkillToPlayer(playerId, id);
        } else if (msg.t === 'reorder') {
            const p = room.sim.players.get(playerId);
            if (p) { const a = msg.from | 0, b = msg.to | 0; if (a >= 0 && a < p.skillSlots.length && b >= 0 && b < p.skillSlots.length && a !== b) { const t = p.skillSlots[a]; p.skillSlots[a] = p.skillSlots[b]; p.skillSlots[b] = t; } }
        } else if (msg.t === 'cmd') {
            room.sim.runCommand(playerId, msg.name, Array.isArray(msg.args) ? msg.args.slice(0, 4) : []);
            log(`Comando de ${playerId}: /${msg.name} ${(msg.args || []).join(' ')}`);
        }
    });

    ws.on('close', () => {
        if (spectatorRoom) { spectatorRoom.spectators.delete(ws); }
        if (room && playerId && room.clients.get(playerId) && room.clients.get(playerId).ws === ws) {
            room.clients.delete(playerId);
            if (!room.pendingRemovals.has(playerId)) room.pendingRemovals.set(playerId, Date.now() + RESUME_GRACE_MS);
            log(`Jugador ${playerId} desconectado de ${room.key} — quedan ${room.clients.size}`);
            if (room.state === 'waiting') sendWaiting(room);
            refillBots(room);   // un bot cubre el hueco (y se retira si el jugador reconecta)
        }
    });
    ws.on('error', () => {});
});

setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
        // jugadores en gracia de reconexión que no volvieron
        for (const [pid, deadline] of room.pendingRemovals) {
            if (room.clients.has(pid)) { room.pendingRemovals.delete(pid); continue; }
            if (now >= deadline) {
                room.pendingRemovals.delete(pid);
                room.sim.removePlayer(pid);
                for (const [tok, info] of resumeTokens) { if (info.playerId === pid) resumeTokens.delete(tok); }
            }
        }
        // muertos: retirarlos de la sim (su conexión queda de espectador)
        for (const [pid, deadline] of room.deadRemovals) {
            if (now >= deadline) { room.deadRemovals.delete(pid); room.sim.removePlayer(pid); }
        }

        if (room.clients.size === 0) {
            if (!room.emptySince) room.emptySince = now;
            if (now - room.emptySince > EMPTY_ROOM_TTL) {
                rooms.delete(room.key);
                for (const [tok, info] of resumeTokens) { if (info.roomKey === room.key) resumeTokens.delete(tok); }
                log(`Sala cerrada (vacía): ${room.key}`);
            }
            continue;
        }
        room.emptySince = 0;

        // reinicio programado tras el fin de una partida arcade
        if (room.state === 'ended') {
            if (room.restartAt && now >= room.restartAt) restartRoom(room);
            continue;
        }
        if (room.state !== 'playing') continue;

        // fin de partida (arcade/skills)
        if (room.endsAt && now >= room.endsAt) {
            room.state = 'ended';
            room.restartAt = now + RESTART_MS;
            broadcast(room, { t: 'matchEnd' });
            log(`Partida terminada en ${room.key}; reinicio en ${RESTART_MS / 1000}s`);
            continue;
        }

        const delta = now - room.lastTick; room.lastTick = now;
        room.sim.step(delta);
        room.tickCount++;

        const events = room.sim.drainEvents();
        for (const ev of events) {
            if (ev.type === 'playerDied') {
                statsOf(room.key).muertes++; statsDirty = true;
                const pj = room.sim.players.get(ev.playerId);
                if (pj && pj.name) { pstatOf(pj.name).muertes++; playersDirty = true; }
                if (!room.deadRemovals.has(ev.playerId)) room.deadRemovals.set(ev.playerId, now + DEAD_REMOVE_MS);
            } else if (ev.type === 'botKilled') {
                const killer = room.sim.players.get(ev.playerId);
                if (killer && killer.name) { pstatOf(killer.name).kills++; playersDirty = true; }
            }
        }
        const out = [];
        if (events.length) out.push(JSON.stringify({ t: 'events', events }));
        if (room.tickCount % SNAPSHOT_EVERY === 0) out.push(JSON.stringify(buildSnapshot(room)));
        if (out.length) {
            for (const cli of room.clients.values()) {
                if (cli.ws.readyState === 1) { for (const m of out) cli.ws.send(m); }
            }
            if (room.spectators.size) {
                for (const sws of room.spectators) {
                    if (sws.readyState === 1) { for (const m of out) sws.send(m); }
                    else room.spectators.delete(sws);
                }
            }
        }
    }
}, TICK_MS);

httpServer.listen(PORT, () => {
    log(`Servidor PillWars escuchando en ws://localhost:${PORT}`);
    log(`Panel de admin: http://localhost:${PORT}/admin  (clave: ${ADMIN_KEY})`);
    log(`Lobby: mínimo ${MIN_PLAYERS} reales, población objetivo ${TARGET_POP} (editable por sala en el panel)`);
});
