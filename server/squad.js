'use strict';
/*
 * Arenas por equipos 1v1 / 2v2 / 3v3.
 *
 * Servicio de grupos (party) + salas + cola, todo en memoria y en el proceso que lo
 * hospeda (en el split, el host 0; el Director enruta /match?mode=squad a el).
 *
 * Un GRUPO es de 1 a 3 jugadores (amigos que se invitan desde el panel de amigos, o uno
 * solo). La sala la fija cuantos sois: 1 = 1v1, 2 = 2v2, 3 = 3v3. El lider:
 *   - crea una SALA (play custom:true): queda publica en la lista, con quien la creo, y
 *     otro grupo del mismo tamano la UNE (challenge) y empieza la partida; o
 *   - pulsa PARTIDA RAPIDA (play): cola automatica, se empareja con el primer grupo igual.
 * Mientras esperan rival NO se mete a nadie en partida: cada uno decide si quiere jugar
 * una sala de PRACTICA contra bots (practice); es una por grupo, asi que si un companero la
 * pide despues entra en la misma.
 *
 * Partida: grupo A contra grupo B y bots neutrales hasta 30. Sin fuego amigo (sim:
 * jugadores del mismo `team` no se comen). GRATIS: la entrada ira en room.squad.stake.
 *
 * Amigos, invitaciones y susurros: server/social.js (mismo socket, misma ficha firmada).
 *
 * Mensajes cliente -> server: { t:'sq', a:'create'|'join'|'leave'|'kick'|'play'|'cancel'|
 *   'practice'|'rooms'|'challenge', ... } + los de social.js
 * Mensajes server -> cliente: sqParty, sqTicket, sqErr, sqGone, sqRooms, y dentro de la
 * sala: squadRoster / squadEnd.
 */
const crypto = require('crypto');
const { createSocial } = require('./social.js');
const { createArenaPay } = require('./arena-pay.js');
const { createVirtualFriends } = require('./virtual-friends.js');

const SIZES = [1, 2, 3];
const MAX_PARTY = 3;                  // un grupo es de 1 a 3 jugadores; la sala (1v1/2v2/3v3) la fija cuantos sois
const POP = 30;                       // jugadores totales por sala (humanos + bots)
const MATCH_START_MS = 12000;         // los dos grupos tienen este margen para entrar
const PRACTICE_START_MS = 2500;
const SQUAD_CAP_MS = 20 * 60 * 1000;    // arenas sin reloj: tope invisible de 20 min
const BOT_SPLIT_FROM_MS = 30000;      // los bots no dividen en los primeros 30 s
const TICKET_TTL_MS = 180000;
const PARTY_IDLE_MS = 30 * 60 * 1000;
const NAME_MAX = 16;

const rnd = n => crypto.randomBytes(n).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode(taken) {
    for (;;) {
        let c = ''; const b = crypto.randomBytes(5);
        for (let i = 0; i < 5; i++) c += CODE_CHARS[b[i] % CODE_CHARS.length];
        if (!taken.has(c)) return c;
    }
}
const cleanName = s => String(s == null ? '' : s).replace(/[^\w .\-@]/g, '').trim().slice(0, NAME_MAX) || 'PLAYER';

function createSquad(deps) {
    const { rooms, buildSim, welcomeMsg, refillBots, broadcast, log, resumeTokens, PillSim, MATCH_MS, SPAWN_IMMUNE_MS, startMatch, handleInput } = deps;

    const parties = new Map();        // code -> party
    const byWs = new Map();           // ws -> { party, id, name }
    const queues = { 1: [], 2: [], 3: [], c1: [], c2: [], c3: [] };   // partes esperando rival, por tamano (c = classic; sin letra = arcade) y precio (@centimos)
    const qkey = (size, mode, cents) => (mode === 'classic' ? 'c' : '') + size + (cents > 0 ? '@' + cents : '');
    const Q = k => queues[k] || (queues[k] = []);
    // ---------- dinero de las arenas de pago (server/arena-pay.js) ----------
    const arena = createArenaPay({ file: deps.arenaFile || null, credit: deps.credit || (() => {}), treasury: deps.treasury, verify: deps.verify, log });
    const quote = usd => (deps.quote ? deps.quote(usd) : 0);
    const usdOf = pill => { const u = deps.pillUsd ? deps.pillUsd() : 0; return u > 0 ? Math.round(pill * u * 100) / 100 : null; };
    const bkey = (mode, size, cents) => cleanMode(mode) + '|' + size + '|' + cents;
    const cleanCents = v => Math.max(0, Math.min(2000, Math.round(Number(v) || 0)));   // centimos de 0 a 2000 (0-20 $)
    function refundMap(map, why) { for (const k of Object.keys(map || {})) arena.refund(map[k].ref, why); }
    function releaseBracket(p) { if (p.inBracket) { arena.useBracket(p.inBracket, -1); p.inBracket = null; } }
    const liveStakes = new Map();   // sala -> apuestas aun sin repartir (por si la sala desaparece sin acabar)
    // Precio en el que esta un grupo: el que busca (cola) o el que mira (want).
    const centsOf = p => (p.state === 'queued' && !p.custom) ? (p.cents | 0) : (p.want == null ? -1 : p.want);
    // Alguien entra en tu precio (busca o mira): aviso a todos los de ese precio y tamano para que sepan que hay rival.
    function avisaBracket(p) {
        const c = centsOf(p); if (c < 0) return;
        const n = p.state === 'queued' ? p.qsize : p.members.size;
        const otros = [...parties.values()].filter(x => x !== p && centsOf(x) === c && (x.state === 'queued' ? x.qsize : x.members.size) === n);
        if (!otros.length) return;
        const quien = (p.members.get(p.leader) || {}).name || 'PLAYER';
        for (const x of otros) for (const m of x.members.values()) send(m.ws, { t: 'sqBracket', cents: c, size: n, who: quien, ready: p.state === 'queued' });
        for (const m of p.members.values()) send(m.ws, { t: 'sqBracket', cents: c, size: n, who: (otros[0].members.get(otros[0].leader) || {}).name || 'PLAYER', ready: otros[0].state === 'queued', count: otros.length });
    }
    // FIND RIVALS: por tamano y precio, cuantos estan buscando (LISTOS), cuantos mirando y cuantos jugando.
    function rivalsList() {
        const map = new Map(), at = (size, cents) => { const k = size + '|' + cents; let e = map.get(k); if (!e) map.set(k, e = { size, cents, ready: 0, looking: 0, playing: 0, fee: cents > 0 ? arena.bracketFee(bkey('arcade', size, cents)) : 0 }); return e; };
        for (const x of parties.values()) {
            if (x.state === 'queued' && !x.custom) at(x.qsize, x.cents | 0).ready += x.members.size;
            else if (x.state === 'idle' && x.want != null) at(x.members.size, x.want).looking += x.members.size;
        }
        for (const r of rooms.values()) if (r.squad && !r.squad.practice && r.state !== 'ended') at(r.squad.size, r.squad.cents | 0).playing += r.clients.size;
        return [...map.values()].sort((a, b) => a.cents - b.cents || a.size - b.size);
    }
    const cleanMode = m => (m === 'classic' ? 'classic' : 'arcade');
    const tickets = new Map();        // ticket -> { roomKey, team, name, exp }
    const customRooms = new Set();    // grupos en espera de un retador (salas custom publicas)

    // Estado de grupo de una cuenta, para la presencia y las invitaciones de amigos.
    function partyInfoOf(uid) {
        for (const m of byWs.values()) if (m.uid === uid) return { state: m.party.state, code: m.party.code, size: m.party.members.size, full: m.party.members.size >= MAX_PARTY };
        return null;
    }
    const social = createSocial({ file: deps.socialFile || null, log, partyInfoOf, directory: deps.directory || null });
    // Identidad de quien entra a un grupo: su usuario de X o, sin X, el resumen de su wallet.
    function identOf(ws, fallback) {
        // name = como te ven los demas en grupos, amigos y pantallas previas (tu @ de X o, sin X, el resumen de tu wallet).
        // gn = el nombre que sale sobre tu pildora en el mapa: el que pones en THE PILL y, si no pones ninguno, ninguno.
        if (ws.pwId) { const p = social.pub(ws.pwId); return { uid: ws.pwId, name: cleanName(p.u ? '@' + p.u : p.n), gn: p.dn || '', pic: p.p, av: p.av }; }   // pub ya quita la foto si eligio icono propio
        const typed = cleanName(fallback);
        return { uid: null, name: typed, gn: typed === 'PLAYER' ? '' : typed, pic: '', av: null };
    }

    const send = (ws, o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} };
    const err = (ws, reason) => send(ws, { t: 'sqErr', reason });
    const practiceAlive = p => !!(p.practiceRoom && rooms.has(p.practiceRoom) && rooms.get(p.practiceRoom).state !== 'ended');

    // `size` = jugadores del grupo: abierto es lo que hay ahora; buscando o jugando, lo que habia al empezar.
    function view(p) {
        return {
            t: 'sqParty', code: p.code, max: MAX_PARTY, size: p.state === 'idle' ? p.members.size : p.qsize, state: p.state, leader: p.leader,
            queuedAt: p.queuedAt || null,
            custom: !!p.custom,
            mode: p.mode || 'arcade',
            cents: p.cents | 0, want: p.want == null ? null : p.want,
            fee: p.cents > 0 ? arena.bracketFee(bkey(p.mode, p.qsize || p.members.size, p.cents)) || p.fee || 0 : 0,
            paid: Object.keys(p.paid || {}),
            practice: practiceAlive(p),
            rc: p.rc ? { kind: p.rc.kind, size: p.rc.size, exp: p.rc.exp, ready: Object.assign({}, p.rc.ready), fee: p.rc.fee, cents: p.rc.cents, usd: usdOf(p.rc.fee), paid: Object.keys(p.rc.paid) } : null,
            members: [...p.members.values()].map(m => ({ id: m.id, uid: m.uid || null, pic: m.pic || '', av: m.av || null, name: m.name, leader: m.id === p.leader })),
        };
    }
    function pushParty(p) {
        const v = view(p);
        for (const m of p.members.values()) send(m.ws, Object.assign({ me: m.id }, v));
        // Los amigos ven cuando el grupo pasa a buscar partida o a jugar.
        if (p._pst !== p.state) { p._pst = p.state; for (const m of p.members.values()) if (m.uid) social.pushPresence(m.uid); }
    }
    function dequeue(p) {
        const q = queues[qkey(p.qsize, p.mode, p.cents)]; const i = q ? q.indexOf(p) : -1;
        if (i >= 0) q.splice(i, 1);
        customRooms.delete(p);
        p.queuedAt = null;
    }
    function disband(p, reason) {
        dequeue(p); clearRc(p); refundMap(p.paid, 'grupo disuelto'); p.paid = {}; releaseBracket(p);
        for (const m of p.members.values()) { byWs.delete(m.ws); send(m.ws, { t: 'sqGone', reason }); }
        parties.delete(p.code);
        for (const m of p.members.values()) if (m.uid) social.pushPresence(m.uid);
    }
    function backToIdle(p) {
        dequeue(p); p.custom = false; p.state = 'idle';
        refundMap(p.paid, 'busqueda cancelada'); p.paid = {}; releaseBracket(p);
    }

    // ---------- salas ----------
    function makeRoom(kind, size, groups, mode) {
        mode = cleanMode(mode);
        const key = 'squad_' + kind[0] + '_' + rnd(4);
        const now = Date.now();
        const room = {
            key, comboKey: 'squad_Free', layerIdx: 1, mode, roomName: 'Free',
            sim: buildSim(mode, { food: 1, virus: 1, speed: 1, botsEnabled: false, botCount: 0 }),
            clients: new Map(), state: 'waiting',
            tickCount: 0, lastTick: now, emptySince: 0,
            endsAt: null, restartAt: null, startAt: now + (kind === 'practice' ? PRACTICE_START_MS : MATCH_START_MS),
            pendingRemovals: new Map(), deadRemovals: new Map(), spectators: new Set(),
            persistent: false, pot: 0,
            targetPop: POP, instantBots: true,
            squad: { kind, practice: kind === 'practice', size, stake: 0, teams: { A: [], B: [] }, groups, joined: 0, stats: {} },
        };
        // Arenas: se empieza grande (radio 60, el virus mide 70) y los bots no dividen hasta los 30 s, y luego cada 30 s.
        Object.assign(room.sim.config, { startRadius: 60, botSplitMs: 30000, botSplitFrom: Infinity });   // botSplitFrom se fija al empezar (tick)
        rooms.set(key, room);
        // La practica nace ya en marcha: quien entra solo espera a que cargue el mapa (hasta el GO), sin lobby.
        if (kind === 'practice' && startMatch) startMatch(room);
        log(`Squad: sala ${kind} ${size}v${size} creada (${key})`);
        return room;
    }
    function issueTo(m, room, team, lineup, stake) {
        const ticket = rnd(16);
        tickets.set(ticket, { roomKey: room.key, team, name: m.gn || '', idName: m.name, pic: m.pic || '', av: m.av || null, uid: m.uid || null, stakeRef: stake ? stake.ref : null, exp: Date.now() + TICKET_TTL_MS });
        send(m.ws, { t: 'sqTicket', kind: room.squad.kind, mode: room.mode, ticket, size: room.squad.size, team, lineup: lineup || null, startIn: Math.max(0, room.startAt - Date.now()) });
    }
    function issue(party, room, team, lineup) {
        for (const m of party.members.values()) issueTo(m, room, team, lineup);
    }
    // Quienes se enfrentan, para la pantalla previa (fotos VS fotos).
    const lineupOf = g => [...g.members.values()].map(m => ({ name: m.name, pic: m.pic || '', av: m.av || null }));
    // Practica del grupo: solo si alguien la pide (nada de meter a nadie en partida sin querer).
    // La sala es una por grupo: quien la pide entra y, si un companero la pide despues, entra en la misma.
    function practiceFor(p, m) {
        if (p.state !== 'queued') return;
        let room = practiceAlive(p) ? rooms.get(p.practiceRoom) : null;
        if (!room) { room = makeRoom('practice', p.qsize, [p.code], p.mode); p.practiceRoom = room.key; pushParty(p); }
        issueTo(m, room, 'A');
        // Los amigos de prueba (server/virtual-friends.js) entran con quien pide la practica.
        if (!m.ws.virtual) for (const v of p.members.values()) if (v.ws.virtual) issueTo(v, room, 'A');
    }
    function startMatchBetween(a, b) {
        a.queuedAt = b.queuedAt = null;
        a.custom = b.custom = false;
        a.state = b.state = 'match';
        dequeue(a); dequeue(b);
        const room = makeRoom('match', a.qsize, [a.code, b.code], a.mode);
        a.matchRoom = b.matchRoom = room.key;
        // Lo que cada uno pago pasa a ser el bote de esta partida (sigue retenido hasta el reparto).
        const sq = room.squad, stakes = [];
        for (const [g, team] of [[a, 'A'], [b, 'B']]) for (const m of g.members.values()) {
            const pd = (g.paid || {})[m.id];
            if (pd) stakes.push({ ref: pd.ref, wallet: pd.wallet, fee: pd.fee, team, memberId: m.id, uid: m.uid || null, ws: m.ws, playerId: null });
        }
        sq.stakes = stakes; sq.cents = a.cents | 0;
        sq.fee = stakes.length ? stakes[0].fee : (a.cents > 0 ? arena.bracketFee(bkey(a.mode, a.qsize, a.cents)) : 0);
        sq.pot = stakes.reduce((n, x) => n + x.fee, 0);
        if (stakes.length) liveStakes.set(room.key, stakes);
        a.paid = {}; b.paid = {}; releaseBracket(a); releaseBracket(b);
        const lineup = { A: lineupOf(a), B: lineupOf(b) };
        for (const [g, team] of [[a, 'A'], [b, 'B']]) for (const m of g.members.values()) issueTo(m, room, team, lineup, stakes.find(x => x.memberId === m.id && x.ws === m.ws));
        pushParty(a); pushParty(b);
        log(`Squad: ${a.code} vs ${b.code} (${a.qsize}v${a.qsize})`);
    }
    function tryMatch(size, mode, cents) {
        const q = Q(qkey(size, mode, cents));
        while (q.length >= 2) startMatchBetween(q.shift(), q.shift());
    }
    // Grupos publicos esperando retador, para la lista de salas.
    function roomsList() {
        return [...customRooms].filter(p => p.state === 'queued').map(p => {
            const lead = p.members.get(p.leader) || {};
            return { code: p.code, size: p.qsize, mode: p.mode || 'arcade', since: p.queuedAt, leader: { name: lead.name || 'PLAYER', pic: lead.pic || '', av: lead.av || null, uid: lead.uid || null }, members: [...p.members.values()].map(m => ({ name: m.name, pic: m.pic || '', av: m.av || null })) };
        }).sort((x, y) => x.since - y.since);
    }

    // ---------- LISTO del grupo ----------
    // El lider pulsa buscar o unirse; con companeros les sale un cartel a todos y solo cuando todos dan LISTO
    // empieza la busqueda. Solo, es inmediato.
    const RC_MS = 20000;
    // keep: el LISTO salio bien y lo pagado pasa al grupo; si no, se devuelve lo que se hubiera pagado.
    function clearRc(p, keep) {
        if (!p.rc) return;
        clearTimeout(p.rc.timer);
        if (!keep) { refundMap(p.rc.paid, 'LISTO cancelado'); if (p.state === 'idle') releaseBracket(p); }
        p.rc = null;
    }
    function cancelRc(p, why, reason) {
        if (!p.rc) return;
        clearRc(p);
        for (const m of p.members.values()) send(m.ws, { t: 'sqReadyEnd', reason, why });
        pushParty(p);
    }
    // LISTO de todos, tambien del lider y en 1v1: en una sala de pago es aqui donde cada uno firma y paga su entrada.
    // El precio en $PILLY del bracket se fija ahora (o se coge el que ya tenga, si hay alguien dentro).
    function readyThen(p, action) {
        const cents = action.cents | 0;
        let fee = 0;
        releaseBracket(p);
        if (cents > 0) {
            const k = bkey(action.mode, p.members.size, cents);
            fee = arena.feeOf(k, cents / 100, quote);
            if (!fee) { for (const m of p.members.values()) send(m.ws, { t: 'sqErr', reason: 'pay_off' }); return; }
            arena.useBracket(k, 1); p.inBracket = k; p.fee = fee;
        }
        p.cents = cents;
        const exp = Date.now() + RC_MS;
        // Bots de prueba: contestan al aviso como uno mas (no pagan). leaderReady: el lider ya dio LISTO al pulsar (solo gratis).
        const ready = {}; for (const m of p.members.values()) ready[m.id] = (m.id === p.leader && !!action.leaderReady && !fee);
        p.rc = { action, kind: action.kind, size: p.members.size, exp, ready, fee, cents, paid: {}, paying: {}, timer: setTimeout(() => cancelRc(p, 'Nobody answered in time', 'timeout'), RC_MS) };
        if (p.rc.timer.unref) p.rc.timer.unref();
        const lead = (p.members.get(p.leader) || {}).name || 'PLAYER';
        for (const m of p.members.values()) if (!ready[m.id] || m.ws.virtual) send(m.ws, { t: 'sqReadyCheck', kind: action.kind, size: p.members.size, exp, leader: lead, fee, cents, usd: usdOf(fee), you: m.id === p.leader });
        pushParty(p);
        if (Object.values(ready).every(Boolean)) { const act = action; clearRc(p, true); runAction(p, act); }
    }
    function runAction(p, action) {
        if (p.state !== 'idle') { refundMap(p.paid, 'grupo ocupado'); p.paid = {}; releaseBracket(p); return; }
        p.mode = cleanMode(action.mode);
        p.cents = action.cents | 0;
        if (action.kind === 'join') {
            const t = parties.get(action.code);
            if (!t || !customRooms.has(t) || t.state !== 'queued' || t.qsize !== p.members.size || t.mode !== p.mode || (t.cents | 0) !== p.cents) { refundMap(p.paid, 'sala ya no esta'); p.paid = {}; releaseBracket(p); for (const m of p.members.values()) send(m.ws, { t: 'sqErr', reason: 'room_gone' }); return; }
            customRooms.delete(t);
            p.qsize = t.qsize;
            startMatchBetween(t, p);
            return;
        }
        const n = p.members.size;
        // QUICK MATCH: si alguien ya tiene una sala abierta del mismo tamano y modo, se entra en ella en vez de esperar.
        if (!action.custom && action.vs) {
            const t = parties.get(action.vs);
            const q = t && queues[qkey(t.qsize, t.mode, t.cents)];
            if (t && t !== p && t.state === 'queued' && !t.custom && t.qsize === n && t.mode === p.mode && (t.cents | 0) === (p.cents | 0) && q && q.includes(t)) { q.splice(q.indexOf(t), 1); p.qsize = n; startMatchBetween(t, p); return; }
        }
        if (!action.custom && !(p.cents > 0)) {
            const abierta = [...customRooms].find(x => x !== p && x.state === 'queued' && x.qsize === n && x.mode === p.mode);
            if (abierta) { customRooms.delete(abierta); p.qsize = n; startMatchBetween(abierta, p); return; }
        }
        p.state = 'queued'; p.queuedAt = Date.now(); p.qsize = n; p.practiceRoom = null;
        p.custom = !!action.custom;
        // Sala custom: no entra en la cola automatica; se publica y espera un retador.
        if (p.custom) customRooms.add(p); else Q(qkey(n, p.mode, p.cents)).push(p);
        pushParty(p);
        if (!p.custom) { avisaBracket(p); tryMatch(n, p.mode, p.cents); }
        if (virtual && p.state === 'queued') setTimeout(() => { if (p.state === 'queued') virtual.onQueued(view(p)); }, 1500);   // rivales de prueba para quien tiene a los bots de amigos
    }

    // ---------- mensajes del lobby ----------
    function handle(ws, msg) {
        if (social.handle(ws, msg)) {
            // Cambio de nombre o de icono con el grupo abierto: los demas lo ven al momento.
            if (msg.a === 'hello' && ws.pwId) { const m = byWs.get(ws); if (m) { const i = identOf(ws); m.name = i.name; m.gn = i.gn; m.pic = i.pic; m.av = i.av; pushParty(m.party); } }
            return;
        }
        const a = String(msg.a || '');
        let me = byWs.get(ws);
        if (a === 'rooms') return send(ws, { t: 'sqRooms', rooms: roomsList() });
        // FIND RIVALS y la cotizacion del precio: se puede mirar sin grupo.
        if (a === 'rivals') { const n = Math.max(1, Math.min(3, msg.size | 0 || 1)); return send(ws, { t: 'sqRivals', list: rivalsList(), pillUsd: deps.pillUsd ? deps.pillUsd() : 0, quote: [1, 2, 5, 10, 20].map(u => ({ usd: u, fee: arena.bracketFee(bkey('arcade', n, u * 100)) || Math.round(quote(u)) })) }); }
        if (a === 'create') {
            if (me) return err(ws, 'already_in_party');
            const code = newCode(parties);
            const ident = identOf(ws, msg.name);
            const id = rnd(4), name = ident.name;
            const p = { code, state: 'idle', leader: id, members: new Map(), queuedAt: null, qsize: 1, lastActive: Date.now() };
            const m = { ws, id, name, gn: ident.gn, uid: ident.uid, pic: ident.pic, av: ident.av, party: p };
            p.members.set(id, m); parties.set(code, p); byWs.set(ws, m);
            pushParty(p);
            if (m.uid) social.pushPresence(m.uid);
            return;
        }
        if (a === 'join') {
            if (me) return err(ws, 'already_in_party');
            const p = parties.get(String(msg.code || '').toUpperCase().trim());
            if (!p) return err(ws, 'no_party');
            if (p.state === 'match') return err(ws, 'party_busy');
            if (p.members.size >= MAX_PARTY) return err(ws, 'party_full');
            // Alguien entra mientras el grupo busca: ya no cuadra la sala, la busqueda se cancela.
            if (p.state === 'queued') { backToIdle(p); }
            if (p.rc) cancelRc(p, 'A new player joined', 'joined');
            const ident = identOf(ws, msg.name);
            const id = rnd(4), m = { ws, id, name: ident.name, gn: ident.gn, uid: ident.uid, pic: ident.pic, av: ident.av, party: p };
            p.members.set(id, m); byWs.set(ws, m);
            p.lastActive = Date.now();
            pushParty(p);
            if (m.uid) social.pushPresence(m.uid);
            return;
        }
        if (!me) return err(ws, 'no_party');
        const p = me.party;
        p.lastActive = Date.now();
        const leader = me.id === p.leader;
        if (a === 'leave') { leaveMember(ws); return; }
        if (a === 'kick') {
            if (!leader || p.state !== 'idle') return;
            const t = p.members.get(String(msg.id || ''));
            if (!t || t.id === me.id) return;
            p.members.delete(t.id); byWs.delete(t.ws);
            send(t.ws, { t: 'sqGone', reason: 'kicked' });
            if (t.uid) social.pushPresence(t.uid);
            return pushParty(p);
        }
        if (a === 'play') {
            if (!leader) return err(ws, 'not_leader');
            if (p.state !== 'idle') return;
            if (p.rc) return;
            const n = p.members.size;
            if (msg.size && (msg.size | 0) !== n) return err(ws, 'size_mismatch');
            if (!SIZES.includes(n)) return err(ws, 'size_mismatch');
            // Nadie busca rival hasta que todos (tambien el lider, tambien en 1v1) hayan dado LISTO. price: dolares de 0 a 20.
            const cents = msg.cents != null ? cleanCents(msg.cents) : cleanCents((Number(msg.price) || 0) * 100);
            readyThen(p, { kind: msg.custom ? 'room' : 'quick', custom: !!msg.custom, mode: cleanMode(msg.mode), cents, leaderReady: msg.ready === true, vs: ws.virtual ? String(msg.vs || '') : '' });
            return;
        }
        if (a === 'challenge') {
            if (!leader) return err(ws, 'not_leader');
            if (p.state !== 'idle') return err(ws, 'party_busy');
            if (p.rc) return;
            const t = parties.get(String(msg.code || '').toUpperCase().trim());
            if (!t || !customRooms.has(t) || t.state !== 'queued') return err(ws, 'room_gone');
            if (t === p) return err(ws, 'self');
            if (t.qsize !== p.members.size) return err(ws, 'size_mismatch');
            if (t.mode !== cleanMode(msg.mode)) return err(ws, 'room_gone');
            readyThen(p, { kind: 'join', code: t.code, mode: cleanMode(msg.mode), cents: t.cents | 0, leaderReady: msg.ready === true });   // se paga el precio de la sala retada
            return;
        }
        // ---- LISTO del grupo ----
        if (a === 'ready') {
            if (!p.rc) return;
            if (!msg.v) { cancelRc(p, me.name + ' is not ready', 'declined'); return; }
            const rc = p.rc;
            if (rc.ready[me.id]) return;
            const listo = () => {
                if (p.rc !== rc || !p.members.has(me.id)) return;
                rc.ready[me.id] = true;
                if (Object.values(rc.ready).every(Boolean)) { const act = rc.action, paid = rc.paid; clearRc(p, true); p.paid = Object.assign({}, p.paid, paid); runAction(p, act); }
                else pushParty(p);
            };
            if (rc.fee > 0 && !me.ws.virtual) {
                if (rc.paying[me.id]) return;
                rc.paying[me.id] = true;
                Promise.resolve(deps.authorize ? deps.authorize({ comboKey: 'arena_' + rc.cents, key: 'arena_' + p.code, fee: rc.fee, pay: msg.pay }) : { ok: false, reason: 'payments off' })
                    .then(auth => {
                        delete rc.paying[me.id];
                        if (!auth || !auth.ok) { send(ws, { t: 'sqErr', reason: 'pay_failed', detail: (auth && auth.reason) || '' }); return; }
                        if (auth.payWallet && auth.fee > 0) {
                            const ref = arena.hold(auth.payWallet, auth.fee, 'arena ' + p.code);
                            if (p.rc !== rc || !p.members.has(me.id)) { arena.refund(ref, 'el LISTO ya no valia'); return; }
                            rc.paid[me.id] = { ref, wallet: auth.payWallet, fee: auth.fee };
                        }
                        listo();
                    })
                    .catch(() => { delete rc.paying[me.id]; send(ws, { t: 'sqErr', reason: 'pay_failed' }); });
                return;
            }
            listo();
            return;
        }
        // Interes por un precio (FIND RIVALS / QUICK MATCH): sale en la lista y avisa a los demas de ese precio.
        if (a === 'want') {
            p.want = msg.cents == null ? null : cleanCents(msg.cents);
            pushParty(p);
            if (p.want != null) avisaBracket(p);
            return;
        }
        if (a === 'claim') {
            const r = arena.claim(String(msg.id || ''), String(msg.wallet || ''), String(msg.message || ''), Array.isArray(msg.signature) ? msg.signature : []);
            return send(ws, Object.assign({ t: 'sqClaim', id: String(msg.id || '') }, r));
        }
        // El lider avisa de nuevo a quien aun no ha contestado.
        if (a === 'remind') {
            if (!leader) return err(ws, 'not_leader');
            if (!p.rc || Date.now() - (p.rc.lastRemind || 0) < 3000) return;
            p.rc.lastRemind = Date.now();
            for (const m of p.members.values()) if (!p.rc.ready[m.id]) send(m.ws, { t: 'sqReadyCheck', kind: p.rc.kind, size: p.rc.size, exp: p.rc.exp, leader: (p.members.get(p.leader) || {}).name || 'PLAYER', remind: true });
            return;
        }
        if (a === 'practice') { practiceFor(p, me); return; }
        // Te saliste al morir: vuelves a mirar la partida de tu grupo (siguiendo a tus companeros).
        if (a === 'rejoin') {
            const room = p.state === 'match' && rooms.get(p.matchRoom);
            if (!room || room.state === 'ended') return err(ws, 'room_gone');
            const team = room.squad.groups[0] === p.code ? 'A' : 'B';
            const ticket = rnd(16);
            const pid = me.uid && room.squad.byUid && room.squad.byUid[me.uid];
            const viva = !!(pid && room.sim.players.has(pid) && room.sim.players.get(pid).alive && !room.clients.has(pid));
            tickets.set(ticket, { roomKey: room.key, team, rejoin: !viva, resumePid: viva ? pid : null, name: me.gn || '', idName: me.name, pic: me.pic || '', av: me.av || null, exp: Date.now() + TICKET_TTL_MS });
            return send(ws, { t: 'sqTicket', kind: 'match', rejoin: !viva, resume: viva, mode: room.mode, ticket, size: room.squad.size, team, lineup: null, startIn: 0 });
        }
        if (a === 'cancel') {
            if (!leader) return err(ws, 'not_leader');
            if (p.rc) { cancelRc(p, 'Cancelled', 'cancelled'); return; }
            if (p.state === 'queued') { backToIdle(p); pushParty(p); }
            return;
        }
    }
    function leaveMember(ws) {
        const me = byWs.get(ws);
        if (!me) return;
        const p = me.party;
        byWs.delete(ws);
        p.members.delete(me.id);
        if (me.uid) social.pushPresence(me.uid);
        clearRc(p);
        if (p.members.size === 0) { backToIdle(p); parties.delete(p.code); return; }
        // Un grupo solo de amigos de prueba no tiene sentido: se va con el ultimo humano.
        if (![...p.members.values()].some(x => !x.ws.virtual)) {
            for (const x of [...p.members.values()]) { byWs.delete(x.ws); if (x.uid) social.pushPresence(x.uid); }
            backToIdle(p); parties.delete(p.code); return;
        }
        if (me.id === p.leader) p.leader = p.members.keys().next().value;
        // Si alguien se va con el grupo buscando, se vuelve a empezar (el tamano ya no cuadra).
        if (p.state === 'queued') backToIdle(p);
        pushParty(p);
    }
    function onClose(ws) { leaveMember(ws); social.onClose(ws); }

    // ---------- entrar a una sala con ticket ----------
    // Devuelve { room, playerId } igual que handleJoin, o null.
    function join(ws, ip, msg) {
        const tk = tickets.get(String(msg.squad || ''));
        const room = tk && rooms.get(tk.roomKey);
        if (!tk || tk.exp < Date.now() || !room || room.state === 'ended') { send(ws, { t: 'squadBad' }); return null; }
        if (ws.readyState !== 1) return null;
        const sq = room.squad;
        const playerId = PillSim.uuid();
        const name = tk.name;
        const opts = {
            name,
            colorBot: typeof msg.colorBot === 'string' ? msg.colorBot.slice(0, 9) : undefined,
            colorTop: typeof msg.colorTop === 'string' ? msg.colorTop.slice(0, 9) : undefined,
            startSkills: Array.isArray(msg.startSkills) ? msg.startSkills.slice(0, 2).map(n => n | 0) : undefined,
            team: tk.team,
        };
        // Volver a tu partida con tu pildora aun viva (te saliste): recuperas el control, sin limite de tiempo.
        if (tk.resumePid && room.sim.players.has(tk.resumePid) && !room.clients.has(tk.resumePid)) return resumeInto(ws, room, tk, msg);
        if (!tk.rejoin) {
            room.sim.addPlayer(playerId, opts);
            sq.teams[tk.team].push(playerId);
            sq.joined++;
            statOf(room, playerId).ident = { name: tk.idName || 'PLAYER', pic: tk.pic || '', av: tk.av || null };
            if (tk.uid) (sq.byUid || (sq.byUid = {}))[tk.uid] = playerId;
            const stk = tk.stakeRef && (sq.stakes || []).find(x => x.ref === tk.stakeRef);
            if (stk) stk.playerId = playerId;
        }
        const token = crypto.randomBytes(32).toString('hex');
        resumeTokens.set(token, { roomKey: room.key, playerId });
        const binV = msg.bin === true ? 1 : Math.max(0, Math.min(2, msg.bin | 0));
        const useBin = binV >= 1;
        const aspect = (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1;
        const cid = (typeof msg.cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(msg.cid)) ? msg.cid : null;
        if (deps.recordEntry && cid && !ws.virtualGame && !tk.rejoin) { try { deps.recordEntry({ comboKey: 'squad_Free', key: room.key, mode: room.mode, playerId, name: '', cid, ip, tester: false }); } catch (e) {} }
        room.clients.set(playerId, { ws, ip, name, idName: tk.idName || 'PLAYER', pic: tk.pic || '', av: tk.av || null, joinedAt: Date.now(), token, opts, cid, paidFee: 0, payWallet: null, carry: 0, isTester: false, useBin, binV, aspect, _spawned: false, entrySig: null, team: tk.team });
        if (tk.rejoin) { const c = room.clients.get(playerId); c.rejoin = true; c._spawned = true; c.team = tk.team; }   // nunca spawnea: mira
        tickets.delete(String(msg.squad));
        ws.send(welcomeMsg(room, playerId, token, undefined, Object.assign(useBin ? { useBin: true, binV } : {}, { squad: { team: tk.team, size: sq.size, practice: sq.practice } })));
        if (room.state === 'playing') refillBots(room);
        else if (room.startAt) broadcast(room, { t: 'lobbyCountdown', startIn: Math.max(0, room.startAt - Date.now()), count: room.clients.size, needed: room.clients.size, roomName: 'Squad', mode: room.mode });
        // Partida entre grupos: en cuanto estan todos dentro no se espera mas.
        if (!sq.practice && room.state === 'waiting' && sq.joined >= sq.size * 2) room.startAt = Math.min(room.startAt, Date.now() + 2000);
        sendRoster(room);
        return { room, playerId };
    }
    function rosterOf(room) {
        const out = { A: [], B: [] };
        for (const t of ['A', 'B']) for (const id of room.squad.teams[t]) {
            const p = room.sim.players.get(id), cli = room.clients.get(id);
            if (p && cli) out[t].push({ id, name: (cli && cli.idName) || 'PLAYER', pic: (cli && cli.pic) || '', av: (cli && cli.av) || null });
        }
        return out;
    }
    function sendRoster(room) {
        const teams = rosterOf(room), sq = room.squad;
        // pot: lo que hay en juego en la sala (los dos equipos), en $PILLY y en dolares.
        for (const [pid, cli] of room.clients) send(cli.ws, { t: 'squadRoster', me: cli.team, myId: pid, size: sq.size, practice: sq.practice, teams, pot: sq.pot | 0, fee: sq.fee | 0, usd: usdOf(sq.pot | 0), cents: sq.cents | 0 });
    }
    // Recupera tu pildora (sigue en el mapa aunque te fueras): nuevo socket, mismo jugador.
    function resumeInto(ws, room, tk, msg) {
        const playerId = tk.resumePid, sq = room.squad, p = room.sim.players.get(playerId);
        const token = crypto.randomBytes(32).toString('hex');
        resumeTokens.set(token, { roomKey: room.key, playerId });
        room.pendingRemovals.delete(playerId);
        const binV = msg.bin === true ? 1 : Math.max(0, Math.min(2, msg.bin | 0));
        const aspect = (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1;
        room.clients.set(playerId, { ws, ip: '', name: p.name, idName: tk.idName || 'PLAYER', pic: tk.pic || '', av: tk.av || null, joinedAt: Date.now(), token, opts: { name: p.name, colorBot: p.colorBot, colorTop: p.colorTop, team: tk.team }, cid: null, paidFee: 0, payWallet: null, carry: 0, isTester: false, useBin: binV >= 1, binV, aspect, _spawned: true, team: tk.team });
        tickets.delete(String(msg.squad));
        ws.send(welcomeMsg(room, playerId, token, undefined, Object.assign(binV >= 1 ? { useBin: true, binV } : {}, { squad: { team: tk.team, size: sq.size, practice: sq.practice } })));
        sendRoster(room);
        log(`Squad: ${tk.idName || playerId} vuelve a su pildora en ${room.key}`);
        return { room, playerId };
    }

    // ---------- tick y fin de partida (los llama room-loop via ctx) ----------
    function teamScore(room, team) {
        let s = 0, alive = 0, seen = 0, n = 0;
        for (const id of room.squad.teams[team]) {
            // Quien murio y se fue sigue contando como del equipo (muerto): antes, al irse, la partida ya no acababa nunca.
            const p = room.sim.players.get(id), st = room.squad.stats[id];
            n++;
            if (st && st.spawnAt) seen++;
            if (p && p.alive) { alive++; for (const c of p.cells) s += c.mass; }
        }
        return { score: Math.round(s), alive, seen, n };
    }
    // Partida real: si un equipo se queda sin nadie vivo, acaba ya.
    // Posicion de tus companeros (solo los tuyos): el cliente los marca en el borde de la pantalla cuando no se ven.
    // Los snapshots solo llevan lo que cae en tu zona, asi que sin esto no sabrias donde estan.
    // Centro de masa de un jugador vivo (o null).
    function centerOf(room, id) {
        const p = room.sim.players.get(id);
        if (!p || !p.alive || !p.cells.length) return null;
        let x = 0, y = 0, m = 0;
        for (const c of p.cells) { x += c.x * c.mass; y += c.y * c.mass; m += c.mass; }
        return m > 0 ? { x: Math.round(x / m), y: Math.round(y / m) } : null;
    }
    // Flecha de caza: cada equipo persigue a UN rival al azar, siempre el mismo hasta que muere (asi no se tarda en encontrarlos).
    function targetFor(room, team) {
        const sq = room.squad; if (sq.practice) return null;
        sq.target = sq.target || {};
        let id = sq.target[team], pos = id && centerOf(room, id);
        if (!pos) {
            const vivos = (sq.teams[team === 'A' ? 'B' : 'A'] || []).filter(x => centerOf(room, x));
            id = vivos.length ? vivos[Math.floor(Math.random() * vivos.length)] : null;
            sq.target[team] = id; pos = id && centerOf(room, id);
        }
        return pos ? { id, x: pos.x, y: pos.y } : null;
    }
    function sendAllies(room) {
        const sq = room.squad;
        const tg = { A: targetFor(room, 'A'), B: targetFor(room, 'B') };
        for (const [pid, cli] of room.clients) {
            if (cli.ws.virtualGame || cli.ws.readyState !== 1 || !(cli.ws.bufferedAmount < 65536)) continue;
            const mates = [], frames = [];
            for (const id of sq.teams[cli.team] || []) {
                if (id === pid || !room.clients.has(id)) continue;   // sin cliente = jugador fantasma de una entrada anterior
                const p = room.sim.players.get(id);
                if (!p || !p.alive || !p.cells.length) { frames.push({ id, m: 0 }); continue; }
                let x = 0, y = 0, m = 0;
                for (const c of p.cells) { x += c.x * c.mass; y += c.y * c.mass; m += c.mass; }
                if (m > 0) { mates.push({ id, x: Math.round(x / m), y: Math.round(y / m) }); frames.push({ id, m: Math.round(m) }); }
            }
            try { cli.ws.send(JSON.stringify({ t: 'squadAllies', a: mates, f: frames, tg: tg[cli.team] || null })); } catch (e) {}
        }
    }
    // Estadisticas de partida por jugador (para la pantalla de resultados): kills y trozos comidos salen de los eventos de la sim.
    function nameOfId(room, id) { const c = room.clients.get(id), st = room.squad.stats[id]; return (c && c.idName) || (st && st.ident && st.ident.name) || 'PLAYER'; }
    function statOf(room, id) { const st = room.squad.stats; return st[id] || (st[id] = { kills: 0, pieces: 0, spawnAt: 0, diedAt: 0 }); }
    function onEvent(room, ev, now) {
        if (!ev || !ev.playerId) return;
        if (ev.type === 'botKilled' && ev.victimId) {   // solo cuentan los jugadores, no los bots
            statOf(room, ev.playerId).kills++;
            statOf(room, ev.victimId).by = (room.clients.get(ev.playerId) || {}).idName || nameOfId(room, ev.playerId);
            statOf(room, ev.victimId).byId = ev.playerId;
        }
        else if (ev.type === 'botPieceEaten') statOf(room, ev.playerId).pieces++;
        else if (ev.type === 'playerDied') {
            const st = statOf(room, ev.playerId); st.diedAt = now;
            if (!st.by) st.byBot = true;   // sin jugador que se lo comiera: un bot (o el mapa)
            // Se anuncia en la partida quien cayo y a manos de quien.
            const stk = (room.squad.stakes || []).find(x => x.playerId === ev.playerId);
            if (!room.squad.practice) broadcast(room, { t: 'squadKill', victim: nameOfId(room, ev.playerId), by: st.by || null });
            // Arena de pago: al equipo que se lo come le sale lo que llevaba (+$2), igual que el botin de classic.
            const killer = stk && st.byId && room.clients.get(st.byId);
            if (killer && killer.team !== stk.team) for (const c of room.clients.values()) if (c.team === killer.team) send(c.ws, { t: 'killGain', amount: stk.fee, rate: Math.round(quote(1)) || 0 });
        }
    }
    function tick(room, now) {
        const sq = room.squad;
        for (const [pid, cli] of room.clients) if (cli._spawned && !cli.rejoin) { const st = statOf(room, pid); if (!st.spawnAt) st.spawnAt = now; }
        if (room.tickCount % 10 === 0) sendAllies(room);
        // Sin reloj: se gana eliminando al otro equipo. Solo un tope invisible para que una sala no viva para siempre.
        if (room.state === 'playing' && !sq.capped) { sq.capped = true; room.endsAt = now + SQUAD_CAP_MS; room.sim.config.botSplitFrom = room.sim.now + BOT_SPLIT_FROM_MS; }
        // Aviso cuando los bots ya pueden dividirse.
        if (!sq.splitWarned && room.sim.now >= room.sim.config.botSplitFrom) { sq.splitWarned = true; broadcast(room, { t: 'squadNote', text: 'BOTS CAN SPLIT NOW · BE CAREFUL' }); }
        if (sq.practice || !room.endsAt || room.endsAt - now < 1500) return;
        const a = teamScore(room, 'A'), b = teamScore(room, 'B');
        // Solo cuenta cuando todos han entrado Y spawneado: uno que aun esta cargando no esta muerto.
        const listos = t => t.n === sq.size && t.seen === t.n;
        if (listos(a) && listos(b) && (a.alive === 0 || b.alive === 0)) room.endsAt = now;
    }
    function endOf(room) {
        const sq = room.squad;
        const a = teamScore(room, 'A'), b = teamScore(room, 'B');
        const winner = sq.practice ? null : (a.score > b.score ? 'A' : b.score > a.score ? 'B' : null);
        const now = Date.now(), players = { A: [], B: [] };
        for (const t of ['A', 'B']) for (const id of sq.teams[t]) {
            const cli = room.clients.get(id), p = room.sim.players.get(id), st = sq.stats[id] || {};
            const fin = st.diedAt || now;
            players[t].push({
                name: (cli && cli.idName) || (st.ident && st.ident.name) || 'PLAYER', pic: (cli && cli.pic) || (st.ident && st.ident.pic) || '', av: (cli && cli.av) || (st.ident && st.ident.av) || null,
                kills: st.kills | 0, pieces: st.pieces | 0, peak: p ? Math.round(p.peakMass || 0) : 0,
                secs: st.spawnAt ? Math.max(0, Math.round((fin - st.spawnAt) / 1000)) : 0, alive: !!(p && p.alive), byBot: !!st.byBot,
            });
        }
        // Reparto del bote (si era de pago): el equipo ganador a partes iguales; 10 % de casa por cada uno que se comio un bot.
        let money = null;
        if (!sq.practice && (sq.stakes || []).length && !sq.settled) {
            sq.settled = true; liveStakes.delete(room.key);
            const lista = sq.stakes.map(x => { arena.take(x.ref); const st2 = x.playerId && sq.stats[x.playerId]; return { team: x.team, wallet: x.wallet, fee: x.fee, byBot: !!(st2 && st2.byBot) }; });
            const r = arena.settle(room.key, lista, winner);
            money = { pot: r.pot, share: r.share, usdShare: usdOf(r.share), usdPot: usdOf(r.pot), fee: sq.fee, cents: sq.cents, draw: !!r.draw };
            for (const t of ['A', 'B']) players[t].forEach((pl, i) => { const id = sq.teams[t][i], x = sq.stakes.find(y => y.playerId === id); pl.stake = x ? x.fee : 0; });
            // A cada ganador que pago, su premio para cobrar con CLAIM (por la sala y por el lobby, por si ya se fue).
            for (const pz of r.prizes) {
                const msgP = { t: 'squadPrize', id: pz.id, amount: pz.amount, usd: usdOf(pz.amount) };
                for (const x of sq.stakes.filter(y => y.wallet === pz.wallet)) { const cli = x.playerId && room.clients.get(x.playerId); if (cli) send(cli.ws, msgP); if (x.ws) send(x.ws, msgP); }
            }
        }
        broadcast(room, { t: 'squadEnd', practice: sq.practice, winner, a: a.score, b: b.score, stake: sq.stake, players, money });
        if (!sq.practice) {
            for (const code of sq.groups) { const p = parties.get(code); if (p) { p.state = 'idle'; pushParty(p); } }
        }
    }
    // Limpieza: tickets caducados y grupos abandonados.
    const gc = setInterval(() => {
        const now = Date.now();
        for (const [t, v] of tickets) if (v.exp < now) tickets.delete(t);
        for (const p of [...parties.values()]) {
            if (now - p.lastActive > PARTY_IDLE_MS) { disband(p, 'idle'); continue; }
            // La sala de la partida ya no existe (todos salieron sin que acabara): vuelta al lobby.
            if (p.state === 'match' && !rooms.has(p.matchRoom)) { p.state = 'idle'; pushParty(p); }
        }
        for (const [key, st] of liveStakes) if (!rooms.has(key)) { for (const x of st) arena.refund(x.ref, 'la sala se cerro sin acabar'); liveStakes.delete(key); }
    }, 60000);
    if (gc.unref) gc.unref();

    // Amigos de prueba @icefox y @bandit: aparecen al buscarlos, aceptan, contestan y juegan.
    const virtual = deps.virtualFriends === false ? null : createVirtualFriends({ social, handle, join, rooms, handleInput, log, readyMs: deps.virtualReadyMs, rivals: deps.virtualRivals !== false });

    return { handle, onClose, join, tick, endOf, onEvent, social, virtual, _internals: { parties, queues, tickets, makeRoom, customRooms } };
}

module.exports = { createSquad, SIZES, POP };
