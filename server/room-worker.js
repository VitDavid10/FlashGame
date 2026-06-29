'use strict';
/**
 * Worker thread de una sala PillWars.
 *
 * Ejecuta la simulación (PillSim) en su propio hilo. El main thread le envía
 * comandos (addPlayer, setInput, action, etc.) y recibe resultados (snapshots,
 * events, peak masses) via postMessage.
 *
 * Protocolo:
 *   main → worker: { type, ...payload }
 *   worker → main: { type, ...payload }
 */
const { parentPort, workerData } = require('worker_threads');
const { performance } = require('perf_hooks');
const PillSim = require('../shared/sim.js');
const proto = require('../shared/proto.js');

// --- Estado de la sala ---
let sim = null;
let mode = 'classic';
let state = 'waiting';     // waiting | playing | ended
let tickCount = 0;
let lastTick = Date.now();
let endsAt = null;
let restartAt = null;
let startAt = null;
let botTargetCount = 0;
let lastBotStep = 0;
let matchMs = 0;

// Clientes: solo la info necesaria para el worker (aspect, useBin, alive).
// El WS vive en el main — aquí solo tenemos los ids.
const clients = new Map();  // pid → { aspect, useBin }

// --- Funciones auxiliares ---
const round1 = v => Math.round(v * 10) / 10;
function cellData(c) {
    const o = { ci: c.ci, x: round1(c.x), y: round1(c.y), r: round1(c.r), cb: c.colorBot, ct: c.colorTop };
    if (c.skinUrl) o.sk = c.skinUrl;
    if (c.immuneTime > 0) o.im = Math.round(c.immuneTime);
    if (c.sprintTime > 0) o.sp = 1;
    if (c.magnetTime > 0) o.mg = 1;
    if (c.tpPhase) { o.tp = c.tpPhase; o.tt = Math.round(c.tpTimer); }
    return o;
}

// AOI rectangular (misma lógica que index.js)
const AOI_BASE = 1800;
const AOI_PER_R = 18;
const AOI_MARGIN = 1.30;
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
    const sq = Math.sqrt(ar);
    return { cx, cy, halfX: view * sq, halfY: view / sq };
}
function intersectsBox(box, x, y, r) {
    const dxLeft = box.cx - box.halfX - x;
    const dxRight = x - (box.cx + box.halfX);
    const dyTop = box.cy - box.halfY - y;
    const dyBot = y - (box.cy + box.halfY);
    const dx = dxLeft > dxRight ? (dxLeft > 0 ? dxLeft : 0) : (dxRight > 0 ? dxRight : 0);
    const dy = dyTop > dyBot ? (dyTop > 0 ? dyTop : 0) : (dyBot > 0 ? dyBot : 0);
    return (dx * dx + dy * dy) <= (r * r);
}

function buildSnapshotFor(viewerId, box) {
    const players = [];
    for (const p of sim.players.values()) {
        const isMe = p.id === viewerId;
        const srcCells = p.cells;
        const outCells = [];
        if (box && !isMe) {
            for (let i = 0; i < srcCells.length; i++) {
                const c = srcCells[i];
                if (intersectsBox(box, c.x, c.y, c.r)) outCells.push(cellData(c));
            }
        } else {
            for (let i = 0; i < srcCells.length; i++) outCells.push(cellData(srcCells[i]));
        }
        const srcSlots = p.skillSlots;
        const slotsOut = new Array(srcSlots.length);
        for (let i = 0; i < srcSlots.length; i++) {
            const s = srcSlots[i];
            slotsOut[i] = s ? { id: s.id, u: s.uses } : 0;
        }
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
        tl: endsAt ? Math.max(0, endsAt - Date.now()) : null,
        pot: 0,  // pot es del main thread
        alv: aliveCount | 0,
        players, bots, viruses, ejected, projectiles
    };
}

function tickGradualBots(now) {
    if (state !== 'playing') return;
    const target = botTargetCount | 0;
    const grupos = [...new Set(sim.enemies.map(e => e.id))];
    if (grupos.length === target) return;
    if ((lastBotStep || 0) + (1500 + Math.random() * 1000) > now) return;
    lastBotStep = now;
    if (grupos.length < target) {
        sim.spawnBot();
    } else if (grupos.length > target) {
        const masaDe = id => sim.enemies.filter(e => e.id === id).reduce((s, c) => s + c.mass, 0);
        const peor = grupos.slice().sort((a, b) => masaDe(a) - masaDe(b))[0];
        sim.enemies = sim.enemies.filter(e => e.id !== peor);
    }
}

// --- Configuración dinámica (recibida del main) ---
let aoiEnabled = true;
let snapshotEvery = 1;
let aliveCount = 0;   // ALIVE global autoritativo (grupos enemigos + jugadores vivos)
let wantSpectatorSnap = false;   // el main lo activa solo si hay espectadores

// --- Tick loop ---
let tickInterval = null;
const TICK_MS = 25;

function tick() {
    const now = Date.now();

    if (state === 'waiting') {
        if (startAt && now >= startAt) {
            // El main thread maneja startMatch — no lo hacemos aquí, solo avisamos.
            parentPort.postMessage({ type: 'requestStart' });
        }
        return;
    }
    if (state === 'ended') {
        if (restartAt && now >= restartAt) {
            parentPort.postMessage({ type: 'requestRestart' });
        }
        return;
    }
    if (state !== 'playing') return;

    tickGradualBots(now);

    // Fin de partida
    if (endsAt && now >= endsAt) {
        state = 'ended';
        // Recopilar ranking para reparto del bote (main lo procesa)
        const ranking = [...sim.players.values()]
            .filter(p => (p.peakMass | 0) > 0 || p.alive)
            .sort((a, b) => (b.peakMass | 0) - (a.peakMass | 0))
            .map(p => ({ id: p.id, name: p.name, peakMass: p.peakMass | 0, alive: p.alive }));
        parentPort.postMessage({ type: 'matchEnd', ranking });
        return;
    }

    const delta = now - lastTick;
    lastTick = now;
    const _t0 = performance.now();
    sim.step(delta);
    const stepMs = performance.now() - _t0;
    tickCount++;

    // Picos de masa
    const peaks = [];
    for (const p of sim.players.values()) {
        if (!p.alive || !p.cells.length) continue;
        let m = 0; for (const c of p.cells) m += c.mass;
        if (m > (p.peakMass | 0)) { p.peakMass = m; peaks.push({ pid: p.id, mass: m }); }
    }

    // Eventos (kills, deaths, skills)
    const events = sim.drainEvents();

    // Snapshots per-player (AOI)
    const _t1 = performance.now();
    const doSnap = (tickCount % snapshotEvery === 0);
    if (doSnap) {
        let ap = 0; for (const p of sim.players.values()) if (p.alive) ap++;
        aliveCount = new Set(sim.enemies.map(e => e.id)).size + ap;
    }
    const snapshots = [];
    const eventsJson = events.length ? JSON.stringify({ t: 'events', events }) : null;

    if (eventsJson || doSnap) {
        // Full snapshot (para espectadores y muertos)
        let fullSnap = null, fullJson = null, fullBin = null;
        const ensureFullSnap = () => fullSnap || (fullSnap = buildSnapshotFor(null, null));
        const ensureFullJson = () => fullJson || (fullJson = JSON.stringify(ensureFullSnap()));
        const ensureFullBin  = () => fullBin  || (fullBin  = proto.encodeSnap(ensureFullSnap()));

        for (const [pid, cli] of clients) {
            const entry = { pid };   // eventsJson va una sola vez top-level, no duplicado por entry
            if (!doSnap) { snapshots.push(entry); continue; }

            const pj = sim.players.get(pid);
            if (!aoiEnabled || !pj || !pj.alive || pj.cells.length === 0) {
                entry.snapData = cli.useBin ? ensureFullBin() : ensureFullJson();
                entry.isBin = cli.useBin;
            } else {
                const box = aoiBoxFor(pj, cli.aspect);
                const snap = buildSnapshotFor(pid, box);
                entry.snapData = cli.useBin ? proto.encodeSnap(snap) : JSON.stringify(snap);
                entry.isBin = cli.useBin;
            }
            snapshots.push(entry);
        }
        // Full para espectadores (solo si los hay: el full snap es caro de generar)
        if (doSnap && wantSpectatorSnap) {
            snapshots.push({ pid: '__spectators__', snapData: ensureFullJson(), isBin: false });
        }
    }

    const snapMs = performance.now() - _t1;

    // Transferir los ArrayBuffers para evitar copias. Usamos un Set porque el
    // full snap binario se cachea y se comparte entre varios muertos: transferir
    // el mismo buffer dos veces lanza DataCloneError y crashea el worker.
    const transferSet = new Set();
    for (const s of snapshots) {
        if (s.snapData instanceof ArrayBuffer) transferSet.add(s.snapData);
        else if (s.snapData && s.snapData.buffer instanceof ArrayBuffer) transferSet.add(s.snapData.buffer);
    }
    const transferable = [...transferSet];

    parentPort.postMessage({
        type: 'tickResult',
        events,
        eventsJson,
        snapshots,
        peaks,
        stepMs,
        snapMs,
        postedAt: Date.now(),
        botCount: new Set(sim.enemies.map(e => e.id)).size,
    }, transferable);
}

// --- Inicialización ---
function initSim(cfg) {
    mode = cfg.mode;
    matchMs = cfg.matchMs || 0;
    aoiEnabled = cfg.aoiEnabled !== false;
    snapshotEvery = cfg.snapshotEvery || 1;

    const baseSize = PillSim.WORLD_CONFIG[mode === 'classic' ? 'classic' : 'arcade'].size;
    sim = new PillSim.Simulation({
        mode,
        mapSize: baseSize,
        worldSettings: { map: 1, food: cfg.rules.food || 1, virus: cfg.rules.virus || 1, speed: cfg.rules.speed || 1 },
        botConfig: { enabled: !!cfg.rules.botsEnabled, count: cfg.rules.botCount || 0, respawn: !!cfg.rules.botsEnabled },
        maxBotCells: mode === 'classic' ? 8 : 4,
        fx: { enabled: false, enemyFX: false },
        emitFoodEvents: true,
        enforceGod: true,
        realisticBotNames: true
    });
    sim.populate();
    state = 'waiting';
    tickCount = 0;
    lastTick = Date.now();
    endsAt = null;
    restartAt = null;
    startAt = null;
    botTargetCount = 0;
    lastBotStep = 0;
    clients.clear();
}

// --- Mensajes del main thread ---
parentPort.on('message', (msg) => {
    switch (msg.type) {
        case 'init':
            initSim(msg);
            // Delay de arranque para repartir los ticks uniformemente en la ventana
            // de 25ms y evitar que los 20 workers bombardeen el main al mismo tiempo.
            if (!tickInterval) {
                const delay = (msg.tickOffset || 0);
                if (delay > 0) setTimeout(() => { if (!tickInterval) tickInterval = setInterval(tick, TICK_MS); }, delay);
                else tickInterval = setInterval(tick, TICK_MS);
            }
            parentPort.postMessage({ type: 'ready', foods: sim.foods, mapSize: sim.config.mapSize });
            break;

        case 'addPlayer':
            sim.addPlayer(msg.pid, msg.opts || {});
            clients.set(msg.pid, { aspect: msg.aspect || 1, useBin: !!msg.useBin });
            break;

        case 'removePlayer':
            sim.removePlayer(msg.pid);
            clients.delete(msg.pid);
            break;

        case 'spawnPlayer':
            sim.spawnPlayer(msg.pid, msg.immuneMs | 0);
            break;

        case 'setSpectators':
            wantSpectatorSnap = !!msg.on;
            break;

        case 'setInput':
            sim.setInput(msg.pid, msg.input);
            break;

        case 'action':
            sim.queueAction(msg.pid, msg.action);
            break;

        case 'grantSkill':
            sim.grantSkillToPlayer(msg.pid, msg.skillId);
            break;

        case 'reorder': {
            const p = sim.players.get(msg.pid);
            if (p) {
                const a = msg.from | 0, b = msg.to | 0;
                if (a >= 0 && a < p.skillSlots.length && b >= 0 && b < p.skillSlots.length && a !== b) {
                    const t = p.skillSlots[a]; p.skillSlots[a] = p.skillSlots[b]; p.skillSlots[b] = t;
                }
            }
            break;
        }

        case 'cmd':
            sim.runCommand(msg.pid, msg.name, msg.args || []);
            break;

        case 'setAspect': {
            const cli = clients.get(msg.pid);
            if (cli) cli.aspect = msg.aspect;
            break;
        }

        case 'startMatch':
            state = 'playing';
            startAt = null;
            lastTick = Date.now();
            if (mode !== 'classic') endsAt = Date.now() + matchMs;
            for (const pid of clients.keys()) {
                if (!sim.players.has(pid)) sim.addPlayer(pid, {});
                sim.spawnPlayer(pid, msg.immuneMs | 0);
            }
            parentPort.postMessage({ type: 'matchStarted', foods: sim.foods, mapSize: sim.config.mapSize });
            break;

        case 'restartSim':
            initSim(msg);
            parentPort.postMessage({ type: 'ready', foods: sim.foods, mapSize: sim.config.mapSize });
            break;

        case 'setLobbyStart':
            startAt = msg.startAt;
            break;

        case 'cancelLobby':
            startAt = null;
            break;

        case 'setState':
            state = msg.state;
            if (msg.restartAt) restartAt = msg.restartAt;
            if (msg.endsAt) endsAt = msg.endsAt;
            break;

        case 'setConfig':
            if (msg.aoiEnabled != null) aoiEnabled = msg.aoiEnabled;
            if (msg.snapshotEvery != null) snapshotEvery = msg.snapshotEvery;
            if (msg.matchMs != null) matchMs = msg.matchMs;
            break;

        case 'refillBots':
            botTargetCount = msg.target;
            sim.config.botConfig.count = msg.target;
            sim.config.botConfig.enabled = msg.target > 0;
            sim.config.botConfig.respawn = msg.target > 0;
            break;

        case 'setRules':
            if (msg.rules.speed != null) sim.config.worldSettings.speed = msg.rules.speed;
            if (msg.rules.food != null) sim.config.worldSettings.food = msg.rules.food;
            if (msg.rules.virus != null) sim.config.worldSettings.virus = msg.rules.virus;
            break;

        case 'setGod': {
            const p2 = sim.players.get(msg.pid);
            if (p2) p2.god = !!msg.god;
            break;
        }

        case 'setMass': {
            const p3 = sim.players.get(msg.pid);
            if (p3 && p3.cells.length) p3.cells[0].mass = msg.mass;
            break;
        }

        case 'getWelcomeData': {
            parentPort.postMessage({
                type: 'welcomeData',
                reqId: msg.reqId,
                data: {
                    state,
                    simTime: Math.round(sim.now),
                    foods: sim.foods,
                    mapSize: sim.config.mapSize,
                    tl: endsAt ? Math.max(0, endsAt - Date.now()) : null,
                    startIn: startAt ? Math.max(0, startAt - Date.now()) : null,
                    restartIn: restartAt ? Math.max(0, restartAt - Date.now()) : null,
                }
            });
            break;
        }

        case 'clientLeft':
            clients.delete(msg.pid);
            break;

        case 'shutdown':
            if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
            process.exit(0);
            break;
    }
});
