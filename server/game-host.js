/*
 * GameHost — gestión de salas y matchmaking (Fase 1 del split Director/Host).
 *
 * Aquí vive la lógica "por-sala" que en el futuro será dueña de sus propios
 * sockets y correrá en su propio proceso/core: crear salas, construir la sim,
 * pre-crear layers y elegir a qué layer entra un jugador (matchmaking).
 *
 * De momento corre en el MISMO proceso que el Director (index.js): no cambia el
 * comportamiento, solo aísla la lógica detrás de una interfaz con dependencias
 * inyectadas (mismo patrón que room-loop.js). El estado global (rooms, reglas,
 * warbank, stats…) sigue viviendo en index.js y se pasa como deps; la frontera
 * real Director↔Host (deltas por IPC) se introduce en un paso posterior.
 *
 * spawnWorker/handleWorkerMsg (sistema worker_threads, a deprecar) se quedan en
 * index.js y se inyectan como dependencia.
 */
'use strict';

const PillSim = require('../shared/sim.js');
const { tickRoomOnce } = require('./room-loop.js');   // tick por sala (simulación + snapshots)

// Crea una instancia de GameHost capturando las dependencias una sola vez.
// Devuelve la interfaz pública que index.js usa en lugar de las funciones
// locales que antes vivían inline.
function createGameHost(deps) {
    const {
        rooms,
        comboKeyOf, layerKeyOf, isLayerOffForPrice,
        rulesOf, minRealOf, targetPopOf, maxPlayersOf,
        log, spawnWorker,
        getUseWorkers, onRulesDirty,
        CATALOG_MODES, PRICES, LAYERS_PER_COMBO,
        resumeTokens,
        refillBots, SPAWN_IMMUNE_MS,
    } = deps;

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
    function getOrCreateRoom(key, mode, roomName) {
        if (!rooms.has(key)) {
            const uw = getUseWorkers();
            const ck = comboKeyOf(mode, roomName);
            const rules = rulesOf(ck); onRulesDirty();
            const m = key.match(/_L(\d+)$/);
            const layerIdx = m ? parseInt(m[1], 10) : 1;
            const room = {
                key, comboKey: ck, layerIdx, mode, roomName,
                sim: uw ? null : buildSim(mode, rules),
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
            if (uw) spawnWorker(room, rules);
            log(`Sala creada: ${key} (lobby, mínimo ${minRealOf(ck)} reales, población ${targetPopOf(ck)})${uw ? ' [worker]' : ''}`);
        }
        return rooms.get(key);
    }

    // Elige la layer a la que entra un jugador para (mode, roomName):
    //  - no llena (clients.size < maxPlayers del combo)
    //  - no a <30s del final de partida (te evita morir entrando)
    //  - no desactivada manualmente desde admin
    // Las L2+ se crean on-demand aquí cuando L1 se llena. Si ninguna cumple → null.
    // Slots ocupados por jugadores reales en la sala: los que están cargando (aún
    // sin spawnear) o vivos. Los muertos espectando NO ocupan. Se deriva de la sim
    // en vez de mantener un contador a mano → robusto al grace/resume (mientras la
    // célula sigue viva durante el rejoin de 30s, cuenta; al morir/expirar, no).
    // Worker (deprecado): sin sim en el main, cae al comportamiento antiguo.
    function liveInRoom(r) {
        if (r.worker) return r.clients.size;
        let n = 0;
        for (const [pid, cli] of r.clients) {
            const pj = r.sim.players.get(pid);
            if (!cli._spawned || (pj && pj.alive)) n++;
        }
        return n;
    }

    function pickLayer(mode, roomName) {
        const ck = comboKeyOf(mode, roomName);
        const max = maxPlayersOf(ck);
        for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
            const key = layerKeyOf(mode, roomName, i);
            let r = rooms.get(key);
            if (!r) {
                if (i === 1) continue;
                if (isLayerOffForPrice(roomName, i)) continue;
                r = getOrCreateRoom(key, mode, roomName);
                log(`Lazy: creada ${key} porque L${i - 1} está llena`);
            }
            if (r.disabled) continue;
            if (liveInRoom(r) >= max) continue;
            if (r.state === 'playing' && r.endsAt && (r.endsAt - Date.now()) < 30000) continue;
            return r;
        }
        return null;
    }

    // Pre-crea SOLO L1 en startup (2 modos × 5 precios). Las L2+ se crean en
    // pickLayer cuando L1 se llena.
    function initLayers() {
        let n = 0;
        for (const mode of CATALOG_MODES) {
            for (const price of PRICES) {
                getOrCreateRoom(layerKeyOf(mode, price, 1), mode, price);
                n++;
            }
        }
        log(`Pre-creadas ${n} salas L1. L2+ se crean on-demand cuando L1 se llene.`);
    }

    // Recorre todas las salas del host y las avanza un tick: las que corren en
    // este hilo se simulan con tickRoomOnce; las que corren en Worker solo
    // procesan sus removals pendientes (el propio worker las tickea). Devuelve el
    // coste agregado (step/snap/send) para que el Director lo mida en tickHist.
    function tickRooms(now, tickCtx) {
        let stepMs = 0, snapMs = 0, sendMs = 0;
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
        return { stepMs, snapMs, sendMs };
    }

    // Rutea un mensaje de juego (ready/input/aspect/action/pickSkill/reorder/cmd)
    // a la sim de la sala (o al worker si la sala corre en uno). Es puro Host: solo
    // toca sim/worker, ninguna delta económica cruza hacia el Director.
    // El Director sigue dueño de join/close (pago, stats) y llama aquí para el resto.
    function handleInput(room, playerId, msg) {
        if (msg.t === 'ready') {
            // El cliente terminó su pantalla de carga: lo spawneamos AHORA con inmunidad,
            // así empieza justo cuando entra de verdad (no expuesto mientras cargaba).
            const cli = room.clients.get(playerId);
            if (room.state === 'playing' && cli && !cli._spawned) {
                cli._spawned = true;
                if (room.worker) room.worker.postMessage({ type: 'spawnPlayer', pid: playerId, immuneMs: SPAWN_IMMUNE_MS });
                else { if (!room.sim.players.has(playerId)) room.sim.addPlayer(playerId, cli.opts || {}); room.sim.spawnPlayer(playerId, SPAWN_IMMUNE_MS); }
                refillBots(room);
            }
            return;
        }
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
    }

    return { buildSim, getOrCreateRoom, pickLayer, initLayers, tickRooms, handleInput };
}

module.exports = { createGameHost };
