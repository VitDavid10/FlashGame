'use strict';
/**
 * Tick de UNA sala — extraído del bucle principal de index.js.
 *
 * Esta función contiene EXACTAMENTE la misma lógica que tenía el bucle interno
 * del `for (const room of rooms.values())` en index.js, sin cambios funcionales.
 * Modulariza el contrato sala↔servidor: el `ctx` agrupa las dependencias para
 * que el tick no toque el scope global de index.js directamente.
 *
 * Contrato:
 *   tickRoomOnce(room, now, ctx) → { stepMs, snapMs, sendMs }
 *
 * El `ctx` agrupa todas las dependencias del scope global del index.js:
 *   - módulos: warbank, dailyquests, proto
 *   - funciones puras: log, logAdmin, broadcast, restartRoom, startMatch,
 *     tickGradualBots, buildSnapshotFor, aoiBoxFor, pstatOf, statsOf,
 *     questsOf, addToPot, sendEcon, entryFeePill, flushPeakMass, minRealOf,
 *     settleParked (liquida al desconectado cuya ventana de rejoin expiró)
 *   - estado mutable: resumeTokens (Map), flags ({stats, players, quests})
 *   - getters dinámicos: aoiEnabled, snapshotEvery, arcadeRestartMs
 *   - constantes: DEAD_REMOVE_MS, EMPTY_ROOM_TTL, WS_BACKPRESSURE_MAX
 */
function tickRoomOnce(room, now, ctx) {
    let stepMs = 0, snapMs = 0, sendMs = 0;
    // jugadores en gracia de reconexión que no volvieron
    for (const [pid, deadline] of room.pendingRemovals) {
        if (room.clients.has(pid)) { room.pendingRemovals.delete(pid); continue; }
        if (now >= deadline) {
            room.pendingRemovals.delete(pid);
            // No volvió: ahora sí se ha ido de verdad. Se liquida ANTES de borrarlo de
            // la sim, que es de donde salen wasAlive/kills/peak.
            if (ctx.settleParked) ctx.settleParked(room, pid);
            room.sim.removePlayer(pid);
            if (room._pidx) room._pidx.delete(pid);   // libera el índice v4 (delta)
            for (const [tok, info] of ctx.resumeTokens) { if (info.playerId === pid) ctx.resumeTokens.delete(tok); }
        }
    }
    // muertos: retirarlos de la sim (su conexión queda de espectador)
    for (const [pid, deadline] of room.deadRemovals) {
        if (now >= deadline) { room.deadRemovals.delete(pid); room.sim.removePlayer(pid); if (room._pidx) room._pidx.delete(pid); }
    }

    if (room.clients.size === 0) {
        if (!room.emptySince) room.emptySince = now;
        // Layers persistentes (pre-creadas): nunca se cierran, descansan en 'waiting'.
        // PERO si se vaciaron en plena partida quedaban colgadas en 'playing' (este
        // return saltaba el procesado de endsAt/restart) → no terminaban ni dejaban
        // entrar. Las reseteamos a 'waiting' tras un grace (respeta el rejoin).
        if (room.persistent) {
            if (room.state !== 'waiting' && (now - room.emptySince) > ctx.EMPTY_RESET_MS) {
                ctx.restartRoom(room);
                ctx.log(`Sala vacía reseteada a lobby: ${room.key} (estaba colgada en ${room.state})`);
            }
            return { stepMs, snapMs, sendMs };
        }
        if (now - room.emptySince > ctx.EMPTY_ROOM_TTL) {
            ctx.deleteRoom(room.key);
            for (const [tok, info] of ctx.resumeTokens) { if (info.roomKey === room.key) ctx.resumeTokens.delete(tok); }
            ctx.log(`Sala cerrada (vacía): ${room.key}`);
        }
        return { stepMs, snapMs, sendMs };
    }
    room.emptySince = 0;

    // reinicio programado tras el fin de una partida arcade
    if (room.state === 'ended') {
        if (room.restartAt && now >= room.restartAt) ctx.restartRoom(room);
        return { stepMs, snapMs, sendMs };
    }
    // cuenta atrás de lobby: al llegar a 0 empieza la partida
    if (room.state === 'waiting') {
        if (room.startAt && now >= room.startAt) ctx.startMatch(room);
        return { stepMs, snapMs, sendMs };
    }
    if (room.state !== 'playing') return { stepMs, snapMs, sendMs };

    // Un jugador desconectado en ventana de rejoin sigue teniendo célula viva y dinero
    // encima: está en room.parked, no en room.clients. Para todo lo ECONÓMICO cuenta
    // como uno más (si le comen, su carry pasa al matador; si mata, lo cobra), o ese
    // dinero se destruiría en vez de cambiar de manos. Los payloads aparcados no tienen
    // ws — los cli.ws.send que los tocan ya van dentro de try/catch.
    const cliOf = (id) => room.clients.get(id) || (room.parked ? room.parked.get(id) : null) || null;

    // Backfill gradual de bots (se acerca al objetivo a razón de +1 cada ~2s)
    ctx.tickGradualBots(room, now);

    // Arcade con MENOS de ARCADE_KEEP_MIN jugadores reales: acortar la partida para
    // terminar en 30s (reciclar la sala). El top timer (tl del snapshot) se actualiza
    // solo. Avisamos una vez con 'roomShorten' para el cartel del cliente.
    if (room.mode !== 'classic' && !room._shortened && room.clients.size < ctx.ARCADE_KEEP_MIN
        && room.endsAt && (room.endsAt - now) > ctx.ARCADE_SHORTEN_MS) {
        room._shortened = true;
        room.endsAt = now + ctx.ARCADE_SHORTEN_MS;
        ctx.broadcast(room, { t: 'roomShorten', in: ctx.ARCADE_SHORTEN_MS, count: room.clients.size, min: ctx.ARCADE_KEEP_MIN });
        ctx.log(`Arcade ${room.key}: ${room.clients.size}<${ctx.ARCADE_KEEP_MIN} jugadores → fin acelerado a ${ctx.ARCADE_SHORTEN_MS / 1000}s`);
    }

    // fin de partida (arcade/skills)
    if (room.endsAt && now >= room.endsAt) {
        room.state = 'ended';
        room.restartAt = now + ctx.arcadeRestartMs;
        // BLINDAJE matchEnd: para cada cliente con cid, actualiza Q1, Q2, Q4 (mass).
        // Q3 (skills) ya se actualizó incrementalmente en cada skillUsed.
        for (const [pid, cli] of room.clients) {
            if (!cli.cid) continue;
            const pj = room.sim.players.get(pid);
            if (!pj) continue;
            // Q4 masa: guardar el pico real, esté vivo o muerto al final
            const peak = pj.peakMass ? Math.floor(pj.peakMass) : 0;
            ctx.econ.questBestMass(cli.cid, peak);
            // Q1, Q2: jugador VIVO al final de arcade → cuenta como "finish + online match"
            if (pj.alive && room.mode === 'arcade') {
                ctx.econ.questFinishArcade(cli.cid);
                ctx.econ.questOnlineMatch(cli.cid);
            }
            // Reset por partida del contador interno de skills
            pj.matchSkillUses = 0;
        }
        // ARCADE: reparto del bote por TOP 10. Curva: 35/20/13/9/7/5/4/3/2.5/1.5 (=100%).
        // Los que sigan vivos al final también aportan su carry al bote (igualdad de trato).
        let payoutMsg = null;
        if (room.mode !== 'classic') {
            for (const cli of room.clients.values()) { if (cli.carry > 0) { ctx.addToPot(room, cli.carry); cli.carry = 0; } }
            // Los desconectados en gracia aportan igual: su entrada ya estaba en juego y
            // si no, se quemaría al liquidarlos (el cashout del carry es solo de classic).
            if (room.parked) for (const pk of room.parked.values()) { if (pk.carry > 0) { ctx.addToPot(room, pk.carry); pk.carry = 0; } }
        }
        if (room.mode !== 'classic' && (room.pot || 0) > 0) {
            const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];
            const ranking = [...room.sim.players.values()]
                .filter(p => (p.peakMass | 0) > 0 || p.alive)
                .sort((a, b) => (b.peakMass | 0) - (a.peakMass | 0));
            const totalPot = room.pot;
            const top = [];
            for (let i = 0; i < Math.min(10, ranking.length); i++) {
                const pj = ranking[i];
                // cliOf: un aparcado que quedó en el TOP cobra su parte — su carry entró
                // al bote como el de todos. El mensaje 'prize' no le llega (no tiene ws),
                // pero el PILL sí: el bucle de envío de abajo va sobre room.clients.
                const cli = cliOf(pj.id);
                const parte = Math.floor(totalPot * PESOS[i] / 100);
                if (cli && cli.payWallet && parte > 0) ctx.econ.credit(cli.payWallet, parte);
                // Daily: terminar top 5 en arcade
                if (cli && cli.cid && (i + 1) <= 5) ctx.econ.dailyEvent(cli.cid, 'arcade_top5', 1);
                top.push({ pos: i + 1, name: pj.name, mass: pj.peakMass | 0, pct: PESOS[i], amount: parte, mine: false, paid: !!(cli && cli.payWallet) });
            }
            payoutMsg = { t: 'prize', reason: 'arcadeEnd', pot: totalPot, top };
            // Enviar a cada cliente con su #pos marcada como "mine"
            for (const [pid, cli] of room.clients) {
                if (cli.ws.readyState !== 1) continue;
                const idx = top.findIndex(t => ranking[t.pos - 1] && ranking[t.pos - 1].id === pid);
                const myCopy = top.map((t, i) => Object.assign({}, t, { mine: i === idx }));
                try { cli.ws.send(JSON.stringify(Object.assign({}, payoutMsg, { top: myCopy, myAmount: idx >= 0 ? top[idx].amount : 0 }))); } catch (e) {}
            }
            ctx.log(`Reparto arcade ${room.key}: bote ${totalPot} → ${top.filter(t => t.paid).map(t => `#${t.pos}=${t.amount}`).join(' ') || '(sin ganadores con wallet)'}`);
            room.pot = 0;
        }
        ctx.broadcast(room, { t: 'matchEnd' });
        ctx.broadcast(room, { t: 'lobbyPreview', count: room.clients.size, needed: ctx.minRealOf(room.comboKey), roomName: room.roomName, mode: room.mode, restartIn: ctx.arcadeRestartMs });
        ctx.log(`Partida terminada en ${room.key}; reinicio en ${ctx.arcadeRestartMs / 1000}s`);
        return { stepMs, snapMs, sendMs };
    }

    const delta = now - room.lastTick; room.lastTick = now;
    const _t0 = performance.now();
    room.sim.step(delta);
    stepMs += performance.now() - _t0;
    room.tickCount++;

    // Récord de masa por jugador (pico) — barato: solo lectura, 40Hz
    for (const p of room.sim.players.values()) {
        if (!p.alive || !p.cells.length) continue;
        let m = 0; for (const c of p.cells) m += c.mass;
        if (m > (p.peakMass | 0)) p.peakMass = m;
    }

    const events = room.sim.drainEvents();
    for (const ev of events) {
        if (ev.type === 'playerDied') {
            const dCli_ = cliOf(ev.playerId);
            const dTest_ = dCli_ && dCli_.isTester;
            const pj = room.sim.players.get(ev.playerId);
            ctx.econ.playerDeath(room.comboKey, dTest_, pj && pj.name);
            ctx.econ.peakMassFlush(room, ev.playerId, dCli_);
            // ARCADE: cada muerte llena el bote (entrada del muerto va al bote).
            if (room.mode !== 'classic') {
                if (dCli_ && dCli_.carry > 0) { ctx.addToPot(room, dCli_.carry); dCli_.carry = 0; }
                else ctx.addToPot(room, ctx.entryFeePill(room.comboKey, room.pillRate));   // bot: su entrada al bote
            }
            // Q2 también cuenta al morir online (jugaste la partida hasta el final aunque te eliminaran)
            if (dCli_ && dCli_.cid) ctx.econ.questOnlineMatch(dCli_.cid);
            if (!room.deadRemovals.has(ev.playerId)) room.deadRemovals.set(ev.playerId, now + ctx.DEAD_REMOVE_MS);
        } else if (ev.type === 'botKilled') {
            const killer = room.sim.players.get(ev.playerId);
            const cliK = cliOf(ev.playerId);
            ctx.econ.botKill(killer && killer.name, cliK && cliK.isTester);
            // Pentakills acumulados de la sala (panel admin): se cuenta el momento
            // exacto de llegar a 5 (=== y no >=, para no recontar en la kill 6, 7...).
            if (room.mode === 'classic' && ev.streak === 5) room.pentas = (room.pentas | 0) + 1;
            // Las kills contra bots cuentan para Q2 (los bots simulan jugadores reales)
            if (cliK && cliK.cid) {
                ctx.econ.questOnlineMatch(cliK.cid);
                // Daily: cada kill cuenta. Mass milestones se chequean al alcanzarlos.
                ctx.econ.dailyEvent(cliK.cid, 'kill', 1);
                const killer2 = room.sim.players.get(ev.playerId);
                if (killer2) {
                    const peak = killer2.peakMass | 0;
                    if (peak >= 50000 && !cliK._mass50) { cliK._mass50 = true; ctx.econ.dailyEvent(cliK.cid, 'mass_50k', 1); }
                    if (peak >= 100000 && !cliK._mass100) { cliK._mass100 = true; ctx.econ.dailyEvent(cliK.cid, 'mass_100k', 1); }
                }
            }
            // CLASSIC: el matador recibe carry de la víctima directamente (humano o bot virtual).
            // No hay "pot" en classic — todo es carry, más simple y coherente con "pure skill".
            if (cliK && room.mode === 'classic') {
                const victimCli = ev.victimId ? cliOf(ev.victimId) : null;
                let gain = 0;
                if (victimCli && victimCli.carry > 0) {
                    gain = victimCli.carry; victimCli.carry = 0;
                    ctx.sendEcon(victimCli, room);
                } else {
                    // víctima bot: aporta una entrada virtual directa al carry del matador
                    gain = ctx.entryFeePill(room.comboKey, room.pillRate);
                }
                cliK.carry += gain;
                // Notificar el +X PILL al cliente para que muestre el floating naranja
                if (gain > 0) { try { cliK.ws.send(JSON.stringify({ t: 'killGain', amount: gain, victimWasBot: !(victimCli && victimCli.carry >= 0 && victimCli.payWallet) })); } catch (e) {} }
                ctx.sendEcon(cliK, room);
                // VICTORIA en classic (5 kills): cashout automático sin fee, se lleva todo su carry.
                if (ev.streak >= 5 && cliK.payWallet) {
                    const win = cliK.carry;
                    if (win > 0) ctx.econ.credit(cliK.payWallet, win);
                    ctx.log(`VICTORIA classic: ${cliK.payWallet.slice(0, 6)}… +${win} PILL (carry completo)`);
                    try { cliK.ws.send(JSON.stringify({ t: 'prize', reason: 'victory', amount: win, carry: cliK.carry, pot: 0 })); } catch (e) {}
                    cliK.carry = 0;
                    ctx.sendEcon(cliK, room);
                    if (cliK.cid) ctx.econ.dailyEvent(cliK.cid, 'classic_5kills', 1);
                }
            }
        } else if (ev.type === 'skillUsed') {
            // BLINDAJE Q3: el servidor cuenta skills (no el cliente)
            const cli = room.clients.get(ev.playerId);
            if (cli && cli.cid && room.mode === 'arcade') {
                const pj2 = room.sim.players.get(ev.playerId);
                if (pj2) {
                    pj2.matchSkillUses = (pj2.matchSkillUses | 0) + 1;
                    ctx.econ.questSkills(cli.cid, pj2.matchSkillUses);
                    ctx.econ.dailyEvent(cli.cid, 'skill_used_arcade', 1);
                }
            }
        }
    }
    const _t1 = performance.now();
    // Eventos: broadcast simple (mismos para todos, siempre JSON).
    const eventsJson = events.length ? JSON.stringify({ t: 'events', events }) : null;
    // Snapshots: por AOI por jugador (si ctx.aoiEnabled). Espectadores reciben
    // snapshot completo (son pocos, panel-control). Jugadores muertos
    // también reciben full (modo espectador local). Si cli.useBin, el snap
    // se serializa con el protocolo binario (proto.encodeSnap).
    const doSnap = (room.tickCount % ctx.snapshotEvery === 0);
    // ALIVE global autoritativo: grupos enemigos únicos + jugadores vivos. Se
    // calcula una vez por tick (no por viewer) para que el contador sea idéntico
    // jugando, espectando y en el panel, sin depender del AOI de cada cliente.
    if (doSnap) {
        let ap = 0; for (const p of room.sim.players.values()) if (p.alive) ap++;
        room._aliveCount = new Set(room.sim.enemies.map(e => e.id)).size + ap;
    }
    // Los eventos viajan FUSIONADOS dentro del snap de este mismo tick (campo `ev`,
    // tanto en JSON como en el frame binario — ver shared/proto.js) cuando ese
    // cliente recibe snapshot este tick. Solo se manda eventsJson SUELTO cuando el
    // cliente no recibe snapshot ahora (doSnap=false, o backpressure): sin esto, un
    // kill se retrasaría hasta el siguiente snapshot en vez de perderse un send.
    // En la config de producción (SNAPSHOT_HZ=40=cada tick) doSnap es true siempre,
    // así que en la práctica esto SIEMPRE fusiona: la mitad de los sends por tick.
    let fullSnap = null, fullJson = null, fullBin = null;
    const ensureFullSnap = () => { if (!fullSnap) { fullSnap = ctx.buildSnapshotFor(room, null, null); if (events.length) fullSnap.ev = events; } return fullSnap; };
    const ensureFullJson = () => fullJson || (fullJson = JSON.stringify(ensureFullSnap()));
    const ensureFullBin  = () => fullBin  || (fullBin  = ctx.proto.encodeSnap(ensureFullSnap()));
    // Eventos pre-stringificados UNA vez por tick para los snaps AOI binarios:
    // son idénticos para todos los viewers; sin esto encodeSnap re-stringificaba
    // el mismo array una vez por viewer.
    const evStr = events.length ? JSON.stringify(events) : '';
    const _t2 = performance.now();
    snapMs += _t2 - _t1;
    if (eventsJson || doSnap) {
        const aoiOn = ctx.aoiEnabled;
        for (const [pid, cli] of room.clients) {
            if (cli.ws.readyState !== 1) continue;
            // Backpressure: si el cliente ya acumula >N bytes sin enviar, saltamos SU
            // snapshot (el siguiente lo pondrá al día); sus eventos van sueltos (son
            // pequeños e importantes: kills, muertes). Sin este corte, un cliente con
            // red mala acumula snapshots sin límite en RAM del proceso y lo arrastra.
            const canSnap = doSnap && cli.ws.bufferedAmount < ctx.WS_BACKPRESSURE_MAX;
            if (!canSnap) { if (eventsJson) cli.ws.send(eventsJson); continue; }
            if (!aoiOn) { cli.ws.send(cli.useBin ? ensureFullBin() : ensureFullJson()); continue; }
            const pj = room.sim.players.get(pid);
            if (!pj || !pj.alive || pj.cells.length === 0) { cli.ws.send(cli.useBin ? ensureFullBin() : ensureFullJson()); continue; }
            // box null = la caja cubriría (casi) todo el mapa → snapshot completo
            // CACHEADO (una serialización para todos) en vez de uno idéntico por
            // jugador. Es lo que hace barato el caso "jugador enorme" o "zoom
            // global muy alejado" sin apagar el AOI para el resto.
            const box = ctx.aoiBoxFor(pj, cli.aspect, room.sim.mapSize);
            if (!box) { cli.ws.send(cli.useBin ? ensureFullBin() : ensureFullJson()); continue; }
            const snap = ctx.buildSnapshotFor(room, pid, box);
            // Binario: pasar el string ya hecho (snap.evs); JSON: el array (snap.ev).
            if (events.length) { if (cli.useBin) snap.evs = evStr; else snap.ev = events; }
            if (cli.binV === 2) {
                // v4 delta: id/nombre viajan UNA vez por cliente; después solo un
                // índice u16 de sala. Asignación perezosa aquí (cubre join, restart
                // y respawn sin depender del camino de entrada). Al reciclarse un
                // índice (wrap del contador u16) se borra de los _seenP de todos:
                // el próximo frame que lo incluya volverá a llevar el id completo.
                let px = room._pidx || (room._pidx = new Map());
                for (let i = 0; i < snap.players.length; i++) {
                    const p = snap.players[i];
                    if (!px.has(p.id)) {
                        const n = room._pidxNext = ((room._pidxNext | 0) + 1) & 0xffff;
                        for (const [, c] of room.clients) if (c._seenP) c._seenP.delete(n);
                        px.set(p.id, n);
                    }
                }
                cli.ws.send(ctx.proto.encodeSnapV4(snap, { myId: pid, seen: cli._seenP || (cli._seenP = new Set()), idx: px }));
            } else {
                cli.ws.send(cli.useBin ? ctx.proto.encodeSnap(snap) : JSON.stringify(snap));
            }
        }
        if (room.spectators.size) {
            for (const sws of room.spectators) {
                if (sws.readyState !== 1) { room.spectators.delete(sws); continue; }
                const canSnap = doSnap && sws.bufferedAmount < ctx.WS_BACKPRESSURE_MAX;
                if (!canSnap) { if (eventsJson) sws.send(eventsJson); continue; }
                sws.send(ensureFullJson());
            }
        }
    }
    // Leaderboard de la sala ENTERA (~2 Hz). Con AOI el cliente solo ve su zona, así
    // que NO puede rankear la sala completa: lo calcula el server (todos los jugadores
    // vivos + grupos de bots, por masa actual) y lo manda a todos. El cliente marca su
    // propia fila por id. Es barato: una pasada sobre células cada 20 ticks.
    if (room.tickCount % 20 === 0) {
        const board = [];
        for (const p of room.sim.players.values()) {
            if (!p.alive || !p.cells.length) continue;
            let m = 0; for (const c of p.cells) m += c.mass;
            board.push({ id: p.id, n: p.name, m: Math.round(m) });
        }
        const botMap = new Map();   // id → { n, m }
        for (const e of room.sim.enemies) {
            const g = botMap.get(e.id);
            if (g) g.m += e.mass; else botMap.set(e.id, { n: e.name, m: e.mass });
        }
        for (const [id, g] of botMap) board.push({ id, n: g.n, m: Math.round(g.m) });
        board.sort((a, b) => b.m - a.m);
        const lbJson = JSON.stringify({ t: 'lb', top: board.slice(0, 10) });
        for (const [, cli] of room.clients) { if (cli.ws.readyState === 1 && cli.ws.bufferedAmount < ctx.WS_BACKPRESSURE_MAX) try { cli.ws.send(lbJson); } catch (e) {} }
        for (const sws of room.spectators) { if (sws.readyState === 1 && sws.bufferedAmount < ctx.WS_BACKPRESSURE_MAX) try { sws.send(lbJson); } catch (e) {} }
    }
    sendMs += performance.now() - _t2;
    return { stepMs, snapMs, sendMs };
}

module.exports = { tickRoomOnce };
