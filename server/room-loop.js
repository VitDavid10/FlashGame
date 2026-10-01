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
 *     questsOf, addToPot, sendEcon, flushPeakMass, minRealOf
 *   - estado mutable: resumeTokens (Map), flags ({stats, players, quests})
 *   - getters dinámicos: aoiEnabled, snapshotEvery, arcadeRestartMs
 *   - constantes: DEAD_REMOVE_MS, EMPTY_ROOM_TTL, WS_BACKPRESSURE_MAX
 */
function tickRoomOnce(room, now, ctx) {
    let stepMs = 0, snapMs = 0, sendMs = 0;
    // jugadores en gracia de reconexión que no volvieron
    for (const [pid, info] of room.pendingRemovals) {
        // El valor lleva la posición económica desde que la desconexión dejó de
        // liquidarse al instante. Se acepta el formato viejo (solo el deadline) por si
        // queda alguno en vuelo tras un reinicio a mitad de partida.
        const deadline = typeof info === 'number' ? info : info.deadline;
        if (room.clients.has(pid)) { room.pendingRemovals.delete(pid); continue; }
        if (now >= deadline) {
            room.pendingRemovals.delete(pid);
            // No volvió: lo que llevaba encima se pierde y va a la tesorería. No al
            // bote de la sala — el bote es de los que siguen jugando, y regalarles lo
            // de quien se cayó premiaría tener mala conexión enfrente.
            if (info && info.econ) ctx.econ.graceExpired(info.econ);
            room.sim.removePlayer(pid);
            if (room._pidx) room._pidx.delete(pid);   // libera el índice v4 (delta)
            for (const [tok, i2] of ctx.resumeTokens) { if (i2.playerId === pid) ctx.resumeTokens.delete(tok); }
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
        /*
         * +5-10s al azar (idea de David). El precio de la sala se congela en el
         * instante en que entra el primero tras quedar vacia, asi que si el
         * reinicio fuera un tiempo fijo se sabria con precision de segundos
         * CUANDO se va a congelar — que es justo lo que necesita quien quiera
         * mover el precio del token en ese momento. Con el reinicio impredecible
         * hay que sostener la manipulacion durante toda la ventana en vez de
         * clavarla en un instante, que sale bastante mas caro.
         */
        room.restartAt = now + ctx.arcadeRestartMs + 5000 + Math.floor(Math.random() * 5000);
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
        // El bote se pone a 0 al repartirlo; se guarda antes para el recibo.
        let potFinal = 0;
        if (room.mode !== 'classic') {
            for (const cli of room.clients.values()) { if (cli.carry > 0) { ctx.addToPot(room, cli.carry); cli.carry = 0; } }
        } else {
            /*
             * CLASSIC: al acabar el tiempo, el que sigue VIVO cobra su carry como
             * si hubiera hecho cashout — misma comisión por kills que si se
             * hubiera salido por su pie.
             *
             * La comisión se aplica a propósito. Sin ella, aguantar hasta el
             * final pagaría el 100% mientras que salirse pagaría entre un 10% y
             * un 50%, así que a nadie le compensaría volver a hacer cashout:
             * lo óptimo sería matar a uno y esconderse hasta que sonara el
             * timer. Con la misma comisión, terminar la partida equivale a
             * cobrar en ese instante y la decisión de cuándo salir sigue
             * significando lo mismo que hasta ahora.
             *
             * Se pone el carry a 0 tras pagar: restartRoom() devuelve el carry
             * que quede (partida anulada) y si no, se cobraría dos veces.
             */
            for (const [pid, cli] of room.clients) {
                const pj = room.sim.players.get(pid);
                if (!pj || !pj.alive || !(cli.carry > 0)) continue;
                const bruto = cli.carry;
                const fee = Math.floor(bruto * ctx.classicExitFeePct(pj.killStreak | 0) / 100);
                const neto = bruto - fee;
                cli.carry = 0;
                if (neto > 0 && cli.payWallet) ctx.econ.credit(cli.payWallet, neto);
                // El exit fee es ingreso del juego: va al pozo del staking. Hasta ahora
                // se descontaba del saldo y los tokens se quedaban en custodia sin que
                // nadie apuntara de quién eran.
                if (fee > 0 && cli.payWallet) ctx.econ.rakeStaking(fee, 'exit fee ' + room.key);
                try {
                    if (cli.ws.readyState === 1) cli.ws.send(JSON.stringify({
                        t: 'prize', reason: 'cashout', amount: neto, carry: bruto,
                        kills: pj.killStreak | 0, feePct: ctx.classicExitFeePct(pj.killStreak | 0), fee,
                    }));
                } catch (e) {}
            }
        }
        if (room.mode !== 'classic' && (room.pot || 0) > 0) {
            const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];
            const ranking = [...room.sim.players.values()]
                .filter(p => (p.peakMass | 0) > 0 || p.alive)
                .sort((a, b) => (b.peakMass | 0) - (a.peakMass | 0));
            const totalPot = room.pot;
            potFinal = totalPot;
            /*
             * COMISION DE LA CASA sobre el bote de arcade. Se aparta ANTES de repartir
             * y va al POZO DEL STAKING, como todo lo que factura el juego. La tesorería
             * bloqueada no recibe nada de aquí: esa solo tiene los tokens de la compra
             * inicial, y con ellos paga los premios del top 10 diario.
             *
             * Los pesos siguen sumando 100, pero sobre el bote YA descontada la
             * comisión: así el reparto entre los diez no cambia de forma y solo baja
             * la escala.
             */
            const comision = Math.floor(totalPot * ctx.ARCADE_RAKE_PCT / 100);
            const repartible = totalPot - comision;
            let repartido = 0;
            if (comision > 0) ctx.econ.rakeStaking(comision, 'comision arcade ' + room.key);
            const top = [];
            for (let i = 0; i < Math.min(10, ranking.length); i++) {
                const pj = ranking[i];
                const cli = room.clients.get(pj.id);
                const parte = Math.floor(repartible * PESOS[i] / 100);
                if (cli && cli.payWallet && parte > 0) { ctx.econ.credit(cli.payWallet, parte); repartido += parte; }
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
            /*
             * Lo que no se ha llegado a repartir también va al staking: puestos vacíos
             * cuando hay menos de diez en el ranking, partes de ganadores sin wallet
             * conectada, y la calderilla del redondeo. Antes se quedaba en custodia sin
             * que nadie apuntara de quién era — un rake accidental e invisible.
             */
            const sinRepartir = repartible - repartido;
            if (sinRepartir > 0) ctx.econ.rakeStaking(sinRepartir, 'bote no reclamado ' + room.key);
            ctx.log(`Reparto arcade ${room.key}: bote ${totalPot} (comisión ${comision}${sinRepartir > 0 ? ' + ' + sinRepartir + ' sin reclamar' : ''} → staking) → ${top.filter(t => t.paid).map(t => `#${t.pos}=${t.amount}`).join(' ') || '(sin ganadores con wallet)'}`);
            room.pot = 0;
        }
        /*
         * RECIBO DE LA PARTIDA. Se emite después del reparto (así lleva quién cobró)
         * y con los datos ya cerrados: kills, pico de masa y la firma con la que cada
         * jugador pidió entrar.
         *
         * Es lo que ancla en la cadena que esta partida existió a esta hora. El Host
         * solo reporta el hecho; escribirlo y anclarlo es del Director, como todo lo
         * que toca dinero. Ver server/matches.js.
         */
        ctx.econ.matchEnded({
            room: room.key,
            mode: room.mode,
            startedAt: room.startedAt || null,
            endedAt: Date.now(),
            entryFee: ctx.entryFeePill(room.comboKey, room.pillRate),
            pot: potFinal,
            players: [...room.clients].map(([pid, cli]) => {
                const pj = room.sim.players.get(pid);
                return {
                    wallet: cli.payWallet || null,
                    name: cli.name || null,
                    kills: pj ? (pj.killStreak | 0) : 0,
                    peak: pj ? (pj.peakMass | 0) : 0,
                    paid: !!cli.payWallet,
                    isTester: !!cli.isTester,
                    entry: cli.entrySig || null,
                };
            }),
        });
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
            const pj = room.sim.players.get(ev.playerId);
            ctx.econ.playerDeath(room.comboKey, dTest_, pj && pj.name);
            ctx.econ.peakMassFlush(room, ev.playerId, room.clients.get(ev.playerId));
            // ARCADE: cada muerte llena el bote (entrada del muerto va al bote).
            // Solo cuenta el carry REAL del muerto. Antes, si el muerto no era un
            // cliente con carry (= un bot), se añadía una entrada virtual al bote:
            // dinero creado de la nada al rate de la sala. Con el rate atado al
            // precio del token, tumbar el precio multiplicaba lo impreso por bot.
            // Los bots no pagan entrada, así que no aportan bote.
            if (room.mode !== 'classic') {
                const dCli = room.clients.get(ev.playerId);
                if (dCli && dCli.carry > 0) { ctx.addToPot(room, dCli.carry); dCli.carry = 0; }
            }
            // Q2 también cuenta al morir online (jugaste la partida hasta el final aunque te eliminaran)
            const cliD = room.clients.get(ev.playerId);
            if (cliD && cliD.cid) ctx.econ.questOnlineMatch(cliD.cid);
            if (!room.deadRemovals.has(ev.playerId)) room.deadRemovals.set(ev.playerId, now + ctx.DEAD_REMOVE_MS);
        } else if (ev.type === 'botKilled') {
            const killer = room.sim.players.get(ev.playerId);
            const cliKiller_ = room.clients.get(ev.playerId);
            // La wallet va junto al nombre porque el leaderboard DIARIO (el que paga
            // los premios de la tesorería) se indexa por dirección: un nombre no es
            // un sitio al que mandar tokens. El ranking histórico sigue yendo por
            // nombre, como siempre.
            ctx.econ.botKill(killer && killer.name, cliKiller_ && cliKiller_.isTester, cliKiller_ && cliKiller_.payWallet);
            // Pentakills acumulados de la sala (panel admin): se cuenta el momento
            // exacto de llegar a 5 (=== y no >=, para no recontar en la kill 6, 7...).
            if (room.mode === 'classic' && ev.streak === 5) room.pentas = (room.pentas | 0) + 1;
            // Las kills contra bots cuentan para Q2 (los bots simulan jugadores reales)
            const cliK = room.clients.get(ev.playerId);
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
            // CLASSIC: el matador recibe el carry de la víctima. Solo se mueve
            // dinero que alguien pagó — matar a un bot no da nada. Antes la
            // víctima bot "aportaba" una entrada virtual (entryFeePill al rate
            // de la sala), que era PILL impreso de la nada y encima proporcional
            // al rate: hundir el precio del token multiplicaba lo impreso.
            if (cliK && room.mode === 'classic') {
                const victimCli = ev.victimId ? room.clients.get(ev.victimId) : null;
                let gain = 0;
                if (victimCli && victimCli.carry > 0) {
                    gain = victimCli.carry; victimCli.carry = 0;
                    ctx.sendEcon(victimCli, room);
                }
                cliK.carry += gain;
                // Notificar el +X PILL al cliente para que muestre el floating naranja
                // (victimWasBot se quitó: con los bots sin aportar dinero, gain>0
                // implica víctima real, así que el campo era siempre false. El
                // cliente nunca lo leyó.)
                if (gain > 0) { try { cliK.ws.send(JSON.stringify({ t: 'killGain', amount: gain })); } catch (e) {} }
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
            let m = 0;
            for (const c of p.cells) m += c.mass;
            board.push({ id: p.id, n: p.name, m: Math.round(m) });
        }
        const botMap = new Map();   // id → { n, m }
        for (const e of room.sim.enemies) {
            const g = botMap.get(e.id);
            if (g) g.m += e.mass;
            else botMap.set(e.id, { n: e.name, m: e.mass });
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
