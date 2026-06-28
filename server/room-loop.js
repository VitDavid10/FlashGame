'use strict';
/**
 * Tick de UNA sala — extraído del bucle principal de index.js.
 *
 * Esta función contiene EXACTAMENTE la misma lógica que tenía el bucle interno
 * del `for (const room of rooms.values())` en index.js, sin cambios funcionales.
 * El objetivo es modularizar el contrato sala↔servidor antes de migrar a
 * `worker_threads` (Fase 5b multihilo): cuando este módulo se importe desde un
 * worker, el `ctx` será una pasarela de postMessage en vez de refs directas.
 *
 * Contrato:
 *   tickRoomOnce(room, now, ctx) → { stepMs, snapMs, sendMs }
 *
 * El `ctx` agrupa todas las dependencias del scope global del index.js:
 *   - módulos: warbank, dailyquests, proto
 *   - funciones puras: log, logAdmin, broadcast, restartRoom, startMatch,
 *     tickGradualBots, buildSnapshotFor, aoiBoxFor, pstatOf, statsOf,
 *     questsOf, addToPot, sendEcon, entryFeePill, flushPeakMass, minRealOf
 *   - estado mutable: resumeTokens (Map), flags ({stats, players, quests})
 *   - getters dinámicos: aoiEnabled, snapshotEvery, arcadeRestartMs
 *   - constantes: DEAD_REMOVE_MS, EMPTY_ROOM_TTL
 */
function tickRoomOnce(room, now, ctx) {
    let stepMs = 0, snapMs = 0, sendMs = 0;
    // jugadores en gracia de reconexión que no volvieron
    for (const [pid, deadline] of room.pendingRemovals) {
        if (room.clients.has(pid)) { room.pendingRemovals.delete(pid); continue; }
        if (now >= deadline) {
            room.pendingRemovals.delete(pid);
            room.sim.removePlayer(pid);
            for (const [tok, info] of ctx.resumeTokens) { if (info.playerId === pid) ctx.resumeTokens.delete(tok); }
        }
    }
    // muertos: retirarlos de la sim (su conexión queda de espectador)
    for (const [pid, deadline] of room.deadRemovals) {
        if (now >= deadline) { room.deadRemovals.delete(pid); room.sim.removePlayer(pid); }
    }

    if (room.clients.size === 0) {
        // Layers persistentes (pre-creadas): nunca se cierran, solo
        // descansan en estado waiting. Las dinámicas (legacy) sí se cierran.
        if (room.persistent) return { stepMs, snapMs, sendMs };
        if (!room.emptySince) room.emptySince = now;
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

    // Backfill gradual de bots (se acerca al objetivo a razón de +1 cada ~2s)
    ctx.tickGradualBots(room, now);

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
            const q = ctx.questsOf(cli.cid);
            // Q4 masa: guardar el pico real, esté vivo o muerto al final
            const peak = pj.peakMass ? Math.floor(pj.peakMass) : 0;
            if (peak > (q.bestMass | 0)) { q.bestMass = peak; ctx.flags.quests = true; }
            // Q1, Q2: jugador VIVO al final de arcade → cuenta como "finish + online match"
            if (pj.alive && room.mode === 'arcade') {
                if ((q.q1_games_finished | 0) < 2) { q.q1_games_finished = (q.q1_games_finished | 0) + 1; ctx.flags.quests = true; }
                if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; ctx.flags.quests = true; }
            }
            q.updated = Date.now();
            // Reset por partida del contador interno de skills
            pj.matchSkillUses = 0;
        }
        // ARCADE: reparto del bote por TOP 10. Curva: 35/20/13/9/7/5/4/3/2.5/1.5 (=100%).
        // Los que sigan vivos al final también aportan su carry al bote (igualdad de trato).
        let payoutMsg = null;
        if (room.mode !== 'classic' && (room.pot || 0) > 0) {
            for (const cli of room.clients.values()) { if (cli.carry > 0) { ctx.addToPot(room, cli.carry); cli.carry = 0; } }
            const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];
            const ranking = [...room.sim.players.values()]
                .filter(p => (p.peakMass | 0) > 0 || p.alive)
                .sort((a, b) => (b.peakMass | 0) - (a.peakMass | 0));
            const totalPot = room.pot;
            const top = [];
            for (let i = 0; i < Math.min(10, ranking.length); i++) {
                const pj = ranking[i];
                const cli = room.clients.get(pj.id);
                const parte = Math.floor(totalPot * PESOS[i] / 100);
                if (cli && cli.payWallet && parte > 0) ctx.warbank.credit(cli.payWallet, parte);
                // Daily: terminar top 5 en arcade
                if (cli && cli.cid && (i + 1) <= 5) ctx.dailyquests.recordEvent(cli.cid, 'arcade_top5', 1);
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
            const dCli_ = room.clients.get(ev.playerId);
            const dTest_ = dCli_ && dCli_.isTester;
            const ds2_ = ctx.statsOf(room.comboKey); ds2_.muertes++; if (!dTest_) ds2_.muertesReal++; ctx.flags.stats = true;
            const pj = room.sim.players.get(ev.playerId);
            if (pj && pj.name && !dTest_) { ctx.pstatOf(pj.name).muertes++; ctx.flags.players = true; }
            ctx.flushPeakMass(room, ev.playerId, room.clients.get(ev.playerId));
            // ARCADE: cada muerte llena el bote (entrada del muerto va al bote).
            if (room.mode !== 'classic') {
                const dCli = room.clients.get(ev.playerId);
                if (dCli && dCli.carry > 0) { ctx.addToPot(room, dCli.carry); dCli.carry = 0; }
                else ctx.addToPot(room, ctx.entryFeePill(room.comboKey, room.pillRate));   // bot: su entrada al bote
            }
            // Q2 también cuenta al morir online (jugaste la partida hasta el final aunque te eliminaran)
            const cliD = room.clients.get(ev.playerId);
            if (cliD && cliD.cid) {
                const q = ctx.questsOf(cliD.cid);
                if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; q.updated = Date.now(); ctx.flags.quests = true; }
            }
            if (!room.deadRemovals.has(ev.playerId)) room.deadRemovals.set(ev.playerId, now + ctx.DEAD_REMOVE_MS);
        } else if (ev.type === 'botKilled') {
            const killer = room.sim.players.get(ev.playerId);
            const cliKiller_ = room.clients.get(ev.playerId);
            if (killer && killer.name && !(cliKiller_ && cliKiller_.isTester)) { ctx.pstatOf(killer.name).kills++; ctx.flags.players = true; }
            // Las kills contra bots cuentan para Q2 (los bots simulan jugadores reales)
            const cliK = room.clients.get(ev.playerId);
            if (cliK && cliK.cid) {
                const q = ctx.questsOf(cliK.cid);
                if ((q.q2_online_matches | 0) < 2) { q.q2_online_matches = (q.q2_online_matches | 0) + 1; q.updated = Date.now(); ctx.flags.quests = true; }
                // Daily: cada kill cuenta. Mass milestones se chequean al alcanzarlos.
                ctx.dailyquests.recordEvent(cliK.cid, 'kill', 1);
                const killer2 = room.sim.players.get(ev.playerId);
                if (killer2) {
                    const peak = killer2.peakMass | 0;
                    if (peak >= 50000 && !cliK._mass50) { cliK._mass50 = true; ctx.dailyquests.recordEvent(cliK.cid, 'mass_50k', 1); }
                    if (peak >= 100000 && !cliK._mass100) { cliK._mass100 = true; ctx.dailyquests.recordEvent(cliK.cid, 'mass_100k', 1); }
                }
            }
            // CLASSIC: el matador recibe carry de la víctima directamente (humano o bot virtual).
            // No hay "pot" en classic — todo es carry, más simple y coherente con "pure skill".
            if (cliK && room.mode === 'classic') {
                const victimCli = ev.victimId ? room.clients.get(ev.victimId) : null;
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
                    if (win > 0) ctx.warbank.credit(cliK.payWallet, win);
                    ctx.log(`VICTORIA classic: ${cliK.payWallet.slice(0, 6)}… +${win} PILL (carry completo)`);
                    try { cliK.ws.send(JSON.stringify({ t: 'prize', reason: 'victory', amount: win, carry: cliK.carry, pot: 0 })); } catch (e) {}
                    cliK.carry = 0;
                    ctx.sendEcon(cliK, room);
                    if (cliK.cid) ctx.dailyquests.recordEvent(cliK.cid, 'classic_5kills', 1);
                }
            }
        } else if (ev.type === 'skillUsed') {
            // BLINDAJE Q3: el servidor cuenta skills (no el cliente)
            const cli = room.clients.get(ev.playerId);
            if (cli && cli.cid && room.mode === 'arcade') {
                const pj2 = room.sim.players.get(ev.playerId);
                if (pj2) {
                    pj2.matchSkillUses = (pj2.matchSkillUses | 0) + 1;
                    const q = ctx.questsOf(cli.cid);
                    if (pj2.matchSkillUses > (q.q3_skills_in_arcade | 0)) {
                        q.q3_skills_in_arcade = Math.min(8, pj2.matchSkillUses);
                        q.updated = Date.now(); ctx.flags.quests = true;
                    }
                    ctx.dailyquests.recordEvent(cli.cid, 'skill_used_arcade', 1);
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
    let fullSnap = null, fullJson = null, fullBin = null;
    const ensureFullSnap = () => fullSnap || (fullSnap = ctx.buildSnapshotFor(room, null, null));
    const ensureFullJson = () => fullJson || (fullJson = JSON.stringify(ensureFullSnap()));
    const ensureFullBin  = () => fullBin  || (fullBin  = ctx.proto.encodeSnap(ensureFullSnap()));
    const _t2 = performance.now();
    snapMs += _t2 - _t1;
    if (eventsJson || doSnap) {
        const aoiOn = ctx.aoiEnabled;
        for (const [pid, cli] of room.clients) {
            if (cli.ws.readyState !== 1) continue;
            if (eventsJson) cli.ws.send(eventsJson);
            if (!doSnap) continue;
            if (!aoiOn) { cli.ws.send(cli.useBin ? ensureFullBin() : ensureFullJson()); continue; }
            const pj = room.sim.players.get(pid);
            if (!pj || !pj.alive || pj.cells.length === 0) { cli.ws.send(cli.useBin ? ensureFullBin() : ensureFullJson()); continue; }
            const box = ctx.aoiBoxFor(pj, cli.aspect);
            const snap = ctx.buildSnapshotFor(room, pid, box);
            cli.ws.send(cli.useBin ? ctx.proto.encodeSnap(snap) : JSON.stringify(snap));
        }
        if (room.spectators.size) {
            const specJson = doSnap ? ensureFullJson() : null;
            for (const sws of room.spectators) {
                if (sws.readyState !== 1) { room.spectators.delete(sws); continue; }
                if (eventsJson) sws.send(eventsJson);
                if (specJson) sws.send(specJson);
            }
        }
    }
    sendMs += performance.now() - _t2;
    return { stepMs, snapMs, sendMs };
}

module.exports = { tickRoomOnce };
