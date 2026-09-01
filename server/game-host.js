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
 */
'use strict';

const crypto = require('crypto');
const PillSim = require('../shared/sim.js');
const { tickRoomOnce } = require('./room-loop.js');   // tick por sala (simulación + snapshots)

/*
 * Token de reconexión: 32 bytes de crypto, NO PillSim.uuid().
 *
 * uuid() es Math.random(), que en V8 es xorshift128+ — predecible: con unas
 * pocas salidas se reconstruye el estado interno y se calculan las siguientes.
 * Y esas salidas son públicas: los playerId salen del MISMO generador y viajan
 * a todos los clientes dentro de cada snapshot. Con el token siendo dos uuid(),
 * cualquiera en la sala podía recuperar el estado del PRNG y predecir el token
 * del siguiente que entrase — y ese token es la única credencial para robarle
 * la sesión (su célula viva y, en classic, el dinero que lleve encima).
 * Mismo criterio que los specTokens del panel, que ya usaban randomBytes.
 */
function nuevoResumeToken() { return crypto.randomBytes(32).toString('hex'); }

// Crea una instancia de GameHost capturando las dependencias una sola vez.
// Devuelve la interfaz pública que index.js usa en lugar de las funciones
// locales que antes vivían inline.
function createGameHost(deps) {
    const {
        rooms,
        comboKeyOf, layerKeyOf, isLayerEnabled,
        rulesOf, minRealOf, targetPopOf, maxPlayersOf, lobbyMsOf,
        log, onRulesDirty,
        CATALOG_MODES, PRICES, LAYERS_PER_COMBO, ownsCombo,
        MATCH_MS, CLASSIC_MATCH_MS,
        resumeTokens,
        SPAWN_IMMUNE_MS,
        director, RESUME_GRACE_MS, sendEcon, entryFeePill,
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
            const ck = comboKeyOf(mode, roomName);
            const rules = rulesOf(ck); onRulesDirty();
            const m = key.match(/_L(\d+)$/);
            const layerIdx = m ? parseInt(m[1], 10) : 1;
            const room = {
                key, comboKey: ck, layerIdx, mode, roomName,
                sim: buildSim(mode, rules),
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
            log(`Sala creada: ${key} (lobby, mínimo ${minRealOf(ck)} reales, población ${targetPopOf(ck)})`);
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
    function liveInRoom(r) {
        let n = 0;
        for (const [pid, cli] of r.clients) {
            const pj = r.sim.players.get(pid);
            if (!cli._spawned || (pj && pj.alive)) n++;
        }
        return n;
    }

    function pickLayer(mode, roomName) {
        // Fase 4: este proceso solo materializa salas de SUS combos. Sin el guard,
        // el lazy-create de L2+ creaba salas de combos ajenos (p.ej. en el Director,
        // cuyo rooms está vacío, /api/rooms interpretaba "L1 llena" y creaba L2).
        if (ownsCombo && !ownsCombo(mode, roomName)) return null;
        const ck = comboKeyOf(mode, roomName);
        const max = maxPlayersOf(ck);
        for (let i = 1; i <= LAYERS_PER_COMBO; i++) {
            // La layer apagada NO entra al matchmaking aunque su sala siga viva
            // (el admin puede apagarla con gente dentro: se vacía al terminar).
            if (!isLayerEnabled(mode, roomName, i)) continue;
            const key = layerKeyOf(mode, roomName, i);
            let r = rooms.get(key);
            if (!r) {
                if (i === 1) continue;
                r = getOrCreateRoom(key, mode, roomName);
                log(`Lazy: creada ${key} porque L${i - 1} está llena`);
            }
            if (r.disabled) continue;
            // _reserved: joins con el cobro IPC en vuelo (async). Cuentan como slot
            // ocupado para que dos joins simultáneos no desborden el cap de la sala.
            if (liveInRoom(r) + (r._reserved || 0) >= max) continue;
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
                // Fase 4: en modo host cada proceso pre-crea SOLO los combos que le
                // asigna el shard-map. En mono, ownsCombo es siempre true → las 10.
                if (ownsCombo && !ownsCombo(mode, price)) continue;
                // Precio desactivado desde el panel (L1 apagada): no se pre-crea,
                // o al reiniciar el servidor volverían a salir las salas apagadas.
                if (!isLayerEnabled(mode, price, 1)) continue;
                getOrCreateRoom(layerKeyOf(mode, price, 1), mode, price);
                n++;
            }
        }
        log(`Pre-creadas ${n} salas L1. L2+ se crean on-demand cuando L1 se llene.`);
    }

    // Recorre todas las salas del host y las avanza un tick con tickRoomOnce.
    // Devuelve el coste agregado (step/snap/send) para el tickHist del Director.
    function tickRooms(now, tickCtx) {
        let stepMs = 0, snapMs = 0, sendMs = 0;
        for (const room of rooms.values()) {
            const m = tickRoomOnce(room, now, tickCtx);
            stepMs += m.stepMs; snapMs += m.snapMs; sendMs += m.sendMs;
        }
        return { stepMs, snapMs, sendMs };
    }

    // Rutea un mensaje de juego (ready/input/aspect/action/pickSkill/reorder/cmd)
    // a la sim de la sala. Es puro Host: solo toca la sim, ninguna delta económica
    // cruza hacia el Director.
    // El Director sigue dueño de join/close (pago, stats) y llama aquí para el resto.
    function handleInput(room, playerId, msg) {
        if (msg.t === 'ready') {
            // El cliente terminó su pantalla de carga: lo spawneamos AHORA con inmunidad,
            // así empieza justo cuando entra de verdad (no expuesto mientras cargaba).
            const cli = room.clients.get(playerId);
            if (room.state === 'playing' && cli && !cli._spawned) {
                cli._spawned = true;
                if (!room.sim.players.has(playerId)) room.sim.addPlayer(playerId, cli.opts || {});
                room.sim.spawnPlayer(playerId, SPAWN_IMMUNE_MS);
                refillBots(room);
            }
            return;
        }
        if (msg.t === 'input') {
            const input = (typeof msg.tx === 'number' && typeof msg.ty === 'number') ? { tx: msg.tx, ty: msg.ty } : null;
            room.sim.setInput(playerId, input);
        } else if (msg.t === 'aspect') {
            const cli = room.clients.get(playerId);
            if (cli && typeof msg.r === 'number' && msg.r > 0) {
                cli.aspect = Math.max(0.5, Math.min(4, msg.r));
            }
        } else if (msg.t === 'action') {
            if (msg.kind === 'split') {
                room.sim.queueAction(playerId, { kind: 'split', tx: +msg.tx || 0, ty: +msg.ty || 0 });
            } else if (msg.kind === 'skill') {
                room.sim.queueAction(playerId, { kind: 'skill', slot: msg.slot | 0, tx: +msg.tx || 0, ty: +msg.ty || 0 });
            }
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
    }

    // Entrada como ESPECTADOR (mira una sala sin jugar). Es del Host: usa sus sockets
    // y su sim (snapshot completo, sin AOI). Devuelve la sala observada o null.
    function handleSpectate(ws, msg) {
        const mode = ['classic', 'arcade'].includes(msg.mode) ? msg.mode : 'classic';
        let roomName = typeof msg.room === 'string' ? msg.room.slice(0, 12) : 'Free';
        // Puede pedir una layer concreta (?layer=2 del panel admin); si no existe, cae a L1.
        const layerIdx = Math.max(1, Math.min(LAYERS_PER_COMBO, parseInt(msg.layer, 10) || 1));
        const key = layerKeyOf(mode, roomName, layerIdx);
        const sala = rooms.get(key) || rooms.get(layerKeyOf(mode, roomName, 1));
        if (!sala) { ws.send(JSON.stringify({ t: 'specEmpty' })); return null; }
        sala.spectators.add(ws);
        // welcome sin id de jugador → el cliente entra como espectador puro
        ws.send(welcomeMsg(sala, null, null, 'specWelcome'));
        log(`Espectador conectado a ${key} (${sala.spectators.size} mirando)`);
        return sala;
    }

    // Entrada de un jugador (join/resume). Es del Host porque en el split real el WS
    // lo posee el Host. Orquesta: matchmaking (pickLayer) + sim (addPlayer) + welcome/
    // lobby, y delega en el Director todo lo económico/stats (kick, precio, cobro,
    // registro) vía director.*. ASYNC desde 4a.4.3: checkKick/authorizeEntry pueden
    // ser peticiones IPC al Director. Devuelve {room, playerId} para que el caller
    // actualice su estado de conexión, o null si no entró (rechazo/noSlot/pago).
    async function handleJoin(ws, ip, msg) {
        // Reconexión con token: recupera la célula viva del jugador si sigue en la sim.
        if (msg.resume) {
            const tok = resumeTokens.get(msg.resume);
            const r = tok ? rooms.get(tok.roomKey) : null;
            if (tok && r && r.sim.players.has(tok.playerId) && !r.clients.has(tok.playerId)) {
                const playerId = tok.playerId;
                r.pendingRemovals.delete(playerId);
                const p = r.sim.players.get(playerId);
                // Mismo opt-in binario que un join normal: sin esto, un jugador que
                // se reconecta (wifi/móvil inestable — el caso típico de resume)
                // se quedaba en JSON sin AOI-binario ni delta v4 el resto de la
                // sesión, aunque su cliente siguiera pidiendo bin:2.
                const binV = msg.bin === true ? 1 : Math.max(0, Math.min(2, msg.bin | 0));
                const useBin = binV >= 1;
                const aspect = (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1;
                r.clients.set(playerId, { ws, ip, name: p.name, joinedAt: Date.now(), token: msg.resume, opts: { name: p.name, colorBot: p.colorBot, colorTop: p.colorTop }, useBin, binV, aspect });
                ws.send(welcomeMsg(r, playerId, msg.resume, undefined, useBin ? { useBin: true, binV } : null));
                refillBots(r);
                log(`Jugador '${p.name}' RECONECTADO a ${r.key}${useBin ? ' [bin' + binV + ']' : ''}`);
                return { room: r, playerId };
            }
            ws.send(JSON.stringify({ t: 'resumeFail' }));
            return null;
        }
        const mode = ['classic', 'arcade'].includes(msg.mode) ? msg.mode : 'classic';
        let roomName = typeof msg.room === 'string' ? msg.room.slice(0, 12) : 'Free';
        if (roomName === '*') roomName = resolveQuickJoin(mode);
        const kick = await director.checkKick(ip);
        if (kick) { ws.send(JSON.stringify({ t: 'kickedWait', secondsLeft: kick.secondsLeft })); return null; }
        const room = pickLayer(mode, roomName);
        if (!room) {
            ws.send(JSON.stringify({ t: 'noSlot', roomName, mode }));
            log(`Sin sitio en ${comboKeyOf(mode, roomName)}: todas las layers llenas o a punto de acabar`);
            return null;
        }
        const key = room.key;
        const ck = room.comboKey;
        director.lockPriceIfEmpty(room);
        const fee0 = entryFeePill(ck, room.pillRate);
        // Cobro/autorización (Director). Reserva el slot mientras el cobro (posible
        // IPC) está en vuelo, para que otro join simultáneo no pise el cap de la sala.
        let auth;
        room._reserved = (room._reserved || 0) + 1;
        try {
            auth = await director.authorizeEntry({ comboKey: ck, key, fee: fee0, pay: msg.pay, testerReq: msg.tester });
        } finally {
            room._reserved--;
        }
        if (!auth.ok) {
            ws.send(JSON.stringify({ t: 'payRequired', room: room.roomName, fee: fee0, reason: auth.reason || 'pago rechazado', balance: auth.balance | 0 }));
            return null;
        }
        const { payWallet, fee, tester } = auth;
        // El socket murió mientras el cobro estaba en vuelo: no hay a quién meter en
        // la sala. Se devuelve la entrada por el mismo camino que "la sala no empezó".
        if (ws.readyState !== 1) {
            if (fee > 0 && payWallet) {
                director.onPlayerLeave({ mode: room.mode, comboKey: ck, state: 'waiting', name: '', isTester: !!tester, carry: 0, payWallet, paidFee: fee, cid: null, peak: 0, wasAlive: false, kills: 0 });
                log(`Join abortado (socket cerrado durante el cobro): reembolso ${fee} PILL a ${payWallet.slice(0, 6)}…`);
            }
            return null;
        }
        const playerId = PillSim.uuid();
        const name = typeof msg.name === 'string' ? msg.name.slice(0, 16) : '';
        // skinUrl eliminado del online: era una URL arbitraria que los navegadores del
        // resto de jugadores descargaban (fuga de IP a un servidor ajeno) y hasta 300 B
        // por celda en cada snapshot. La skin local del modo offline no pasa por aquí.
        const opts = {
            name,
            colorBot: typeof msg.colorBot === 'string' ? msg.colorBot.slice(0, 9) : undefined,
            colorTop: typeof msg.colorTop === 'string' ? msg.colorTop.slice(0, 9) : undefined
        };
        room.sim.addPlayer(playerId, opts);
        const token = nuevoResumeToken();
        resumeTokens.set(token, { roomKey: key, playerId });
        const cid = (typeof msg.cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(msg.cid)) ? msg.cid : null;
        // Opt-in al protocolo binario para snapshots: bin:1 = v3, bin:2 = v4
        // (delta de identidades por conexión); eco en welcome (useBin/binV).
        const binV = msg.bin === true ? 1 : Math.max(0, Math.min(2, msg.bin | 0));
        const useBin = binV >= 1;
        const aspect = (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1;
        room.clients.set(playerId, { ws, ip, name, joinedAt: Date.now(), token, opts, cid, paidFee: fee || 0, payWallet, carry: fee || 0, isTester: tester, useBin, binV, aspect, _spawned: false });
        sendEcon(room.clients.get(playerId), room);
        director.recordEntry({ comboKey: ck, key, mode: room.mode, playerId, name, cid, ip, tester });
        if (room.state === 'playing') {
            // Tarde-join: NO spawneamos aquí. El cliente verá su pantalla de carga y
            // mandará 'ready'; ahí lo spawneamos con inmunidad (empieza al entrar).
            refillBots(room);
        }
        ws.send(welcomeMsg(room, playerId, token, undefined, useBin ? { useBin: true, binV } : null));
        log(`Jugador '${name}' (${ip}) entró en ${key} [${room.state}] — ${room.clients.size}/${minRealOf(ck)}${useBin ? ' [bin' + binV + ']' : ''}`);
        if (room.state === 'waiting') {
            sendWaiting(room);
            armLobby(room);
        } else if (room.state === 'ended') {
            const restartIn = Math.max(0, room.restartAt - Date.now());
            ws.send(JSON.stringify({ t: 'lobbyPreview', count: room.clients.size, needed: minRealOf(room.comboKey), roomName: room.roomName, mode: room.mode, restartIn }));
        }
        return { room, playerId };
    }

    // Cierre de un socket. Es del Host porque en el split real el 'close' del WS
    // ocurre en el proceso dueño del socket. El Host limpia espectador/sim/lobby y
    // calcula los datos autoritativos (wasAlive, kills) desde SU sim; toda la lógica
    // económica/stats la delega a director.onPlayerLeave (frontera de deltas).
    function handleClose(ws, room, playerId, spectatorRoom) {
        if (spectatorRoom) {
            spectatorRoom.spectators.delete(ws);
        }
        if (room && playerId && room.clients.get(playerId) && room.clients.get(playerId).ws === ws) {
            const cli = room.clients.get(playerId);
            // wasAlive/kills/peak desde la fuente autoritativa: la sim.
            const pj = room.sim.players.get(playerId);
            const wasAlive = !!(pj && pj.alive);
            const kills = pj ? (pj.killStreak | 0) : 0;
            const peak = (pj && pj.peakMass) ? Math.floor(pj.peakMass) : 0;
            // Frontera de deltas de la SALIDA: datos planos → misma llamada local o IPC.
            director.onPlayerLeave({
                mode: room.mode, comboKey: room.comboKey, state: room.state,
                name: cli.name || '', isTester: !!cli.isTester, carry: cli.carry | 0,
                payWallet: cli.payWallet || null, paidFee: cli.paidFee | 0,
                cid: cli.cid || null, peak, wasAlive, kills,
            });
            room.clients.delete(playerId);
            if (!room.pendingRemovals.has(playerId)) room.pendingRemovals.set(playerId, Date.now() + RESUME_GRACE_MS);
            log(`Jugador ${playerId} desconectado de ${room.key} — quedan ${room.clients.size}`);
            if (room.state === 'waiting') { sendWaiting(room); armLobby(room); }   // cancela la cuenta atrás si baja del mínimo
            refillBots(room);   // un bot cubre el hueco (y se retira si el jugador reconecta)
        }
    }

    // ===================================================================
    // Runtime de sala (movido desde index.js en Fase 4 / 4a.2). Es lógica de
    // Host puro: broadcast, lobby, arranque/reinicio de partida, bots de relleno.
    // NO toca dinero/stats (eso sigue en el Director vía director.* y tickCtx).
    // ===================================================================

    function broadcast(room, objOrString) {
        const m = typeof objOrString === 'string' ? objOrString : JSON.stringify(objOrString);
        for (const cli of room.clients.values()) { if (cli.ws.readyState === 1) { try { cli.ws.send(m); } catch (e) {} } }
    }

    function sendWaiting(room) {
        // startIn: ms que faltan para empezar si el lobby ya está armado (null si no).
        // El cliente lo usa para la cuenta atrás (se re-sincroniza en cada waiting).
        const startIn = room.startAt ? Math.max(0, room.startAt - Date.now()) : null;
        broadcast(room, { t: 'waiting', count: room.clients.size, needed: minRealOf(room.comboKey), roomName: room.roomName, mode: room.mode, startIn });
    }

    // Cache del JSON de foods por sala. Serializar ~7800 foods (classic) en CADA
    // join/reconnect satura el main: con el churn de reconexiones del stress test son
    // decenas de joins/seg. Cacheamos el string 2s; el cliente se autocorrige con los
    // eventos foodRespawn, así que un cache ligeramente viejo no se nota.
    function foodsJsonOf(room) {
        const now = Date.now();
        if (room._foodsJson && now - (room._foodsJsonAt || 0) < 2000) return room._foodsJson;
        const foods = room.sim.foods;
        // Solo lo que el cliente usa (x/y/r/c1), redondeado. El objeto entero del
        // pool (doubles de 17 dígitos + spikes[4] + c2/angle/eaten) pesaba ~220B
        // por food → ~1.7MB de welcome POR JOIN en classic (7.8k foods); esto ~45B.
        // Los spikes (ángulos cosméticos aleatorios) los genera el cliente.
        const parts = new Array(foods.length);
        for (let i = 0; i < foods.length; i++) {
            const f = foods[i];
            parts[i] = '{"x":' + (Math.round(f.x * 10) / 10) + ',"y":' + (Math.round(f.y * 10) / 10) + ',"r":' + (Math.round(f.r * 10) / 10) + ',"c1":"' + f.c1 + '"}';
        }
        room._foodsJson = '[' + parts.join(',') + ']';
        room._foodsJsonAt = now;
        return room._foodsJson;
    }
    // Devuelve el welcome ya serializado como STRING, con el foods cacheado inyectado
    // sin re-serializar. `extra` añade campos al head (ej. { useBin: true }).
    function welcomeMsg(room, playerId, token, type, extra) {
        const head = {
            t: type || 'welcome', id: playerId, token,
            mapSize: room.sim.mapSize, mode: room.mode, roomName: room.roomName,
            state: room.state, count: room.clients.size, needed: minRealOf(room.comboKey),
            // Duracion de ESTE modo: el cliente pinta el reloj con ella, y classic
            // dura mas que arcade. Mandando siempre MATCH_MS el contador de classic
            // habria arrancado en 3:50 y se habria quedado clavado en 0:00 el resto.
            duration: room.mode === 'classic' ? CLASSIC_MATCH_MS : MATCH_MS,
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
        const sim = room.sim;
        sim.config.botConfig.count = deseados;
        sim.config.botConfig.enabled = deseados > 0;
        sim.config.botConfig.respawn = deseados > 0;
        room.botTargetCount = deseados;
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
            // Jitter 0-1500ms para que varias salas que se llenan a la vez NO arranquen
            // en el mismo tick. Sin esto, llegabas a 150 spawns simultáneos cuando 5 salas
            // pasaban a 'playing' en el mismo segundo. El tick loop dispara startMatch
            // cuando llega startAt.
            const jitter = Math.floor(Math.random() * 1500);
            const total = Math.max(0, lobbyMs) + jitter;
            room.startAt = Date.now() + total;
            if (lobbyMs > 0) {
                broadcast(room, { t: 'lobbyCountdown', startIn: lobbyMs, count: room.clients.size, needed: min, roomName: room.roomName, mode: room.mode });
                log(`Lobby ${room.key}: ${room.clients.size}/${min} → cuenta atrás ${lobbyMs / 1000}s (+${jitter}ms jitter)`);
            }
        } else if (room.startAt) {
            room.startAt = null;
            sendWaiting(room);   // vuelve a "esperando X/min"
            log(`Lobby ${room.key}: cuenta atrás cancelada (${room.clients.size}/${min})`);
        }
    }

    function startMatch(room) {
        if (room.state !== 'waiting') return;
        room.state = 'playing';
        room.startAt = null;
        room.lastTick = Date.now();
        // Classic tambien tiene final de partida (mas largo). No es un cambio de
        // diseño porque si: es lo unico que hace que todos jueguen al mismo
        // precio de entrada, porque el precio se congela por sala y refrescarlo
        // con gente dentro descuadra el intercambio de carry al matar.
        room.endsAt = Date.now() + (room.mode === 'classic' ? CLASSIC_MATCH_MS : MATCH_MS);
        // NO spawneamos aquí: cada jugador se spawnea cuando su cliente manda 'ready'
        // (al terminar su pantalla de carga). Así la inmunidad empieza justo cuando entra
        // de verdad, dure lo que dure su carga, y no está expuesto mientras carga.
        for (const [pid, cli] of room.clients) {
            if (!room.sim.players.has(pid)) room.sim.addPlayer(pid, cli.opts || {});
            cli.paidFee = 0;
            cli._spawned = false;
            if (cli.ws.readyState === 1) cli.ws.send(welcomeMsg(room, pid, cli.token, 'matchStart'));
        }
        refillBots(room);
        log(`¡Partida INICIADA en ${room.key}: ${room.clients.size} reales (spawn al ready)`);
    }

    function restartRoom(room) {
        // Vaciar la sala al reiniciar: cerrar todas las conexiones tras el broadcast.
        // Antes se mantenían los jugadores entre partidas, lo que dejaba a los mismos
        // 30 dentro tras cada arcade → otros que esperaban fuera no tenían chance. Ahora
        // todos salen y el lobby se llena desde 0. El cliente ve roomRestart + close y
        // muestra TRY AGAIN; el stress-bot reentra solo tras su delay aleatorio.
        // La partida queda ANULADA, asi que se devuelve a cada jugador lo que
        // llevaba encima: su carry, que empieza siendo su entrada y en classic
        // crece con lo que le quita a los que mata. Se pone a 0 ANTES de cerrar
        // el socket para que onPlayerLeave no lo pague otra vez como cashout —
        // seria pagar dos veces lo mismo. El que ya estaba muerto lleva 0 (su
        // carry se lo quedo quien lo mato, o se fue al bote en arcade).
        const closed = room.clients.size;
        for (const cli of room.clients.values()) {
            const devuelto = cli.carry | 0;
            cli.carry = 0; cli.paidFee = 0;
            if (devuelto > 0 && cli.payWallet) director.refundEntry({ wallet: cli.payWallet, amount: devuelto, comboKey: room.comboKey });
            // Cada uno recibe SU cantidad: el cartel ROOM RESTARTED la enseña.
            try { if (cli.ws.readyState === 1) cli.ws.send(JSON.stringify({ t: 'roomRestart', refunded: devuelto })); } catch (e) {}
        }
        for (const cli of room.clients.values()) {
            try { cli.ws.close(); } catch (e) {}
        }
        // room.clients se vacía vía ws.on('close'); no esperamos a eso para pasar a waiting
        room.state = 'waiting';
        room.endsAt = null; room.restartAt = null; room.startAt = null; room.ended = false; room._shortened = false; room.pentas = 0;
        room.deadRemovals.clear(); room.pendingRemovals.clear();
        room.sim = buildSim(room.mode, rulesOf(room.comboKey));
        sendWaiting(room);
        log(`Sala reiniciada: ${room.key} (${closed} expulsados, lobby empieza desde 0)`);
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

    return {
        buildSim, getOrCreateRoom, pickLayer, initLayers, tickRooms,
        handleInput, handleClose, handleJoin, handleSpectate,
        broadcast, sendWaiting, welcomeMsg, refillBots, tickGradualBots,
        armLobby, startMatch, restartRoom, shutdownRoom, resolveQuickJoin,
    };
}

module.exports = { createGameHost };
