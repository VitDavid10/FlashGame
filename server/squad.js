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

const SIZES = [1, 2, 3];
const MAX_PARTY = 3;                  // un grupo es de 1 a 3 jugadores; la sala (1v1/2v2/3v3) la fija cuantos sois
const POP = 30;                       // jugadores totales por sala (humanos + bots)
const MATCH_START_MS = 12000;         // los dos grupos tienen este margen para entrar
const PRACTICE_START_MS = 2500;
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
    const { rooms, buildSim, welcomeMsg, refillBots, broadcast, log, resumeTokens, PillSim, MATCH_MS, SPAWN_IMMUNE_MS } = deps;

    const parties = new Map();        // code -> party
    const byWs = new Map();           // ws -> { party, id, name }
    const queues = { 1: [], 2: [], 3: [] };   // partes esperando rival, por tamano
    const tickets = new Map();        // ticket -> { roomKey, team, name, exp }
    const customRooms = new Set();    // grupos en espera de un retador (salas custom publicas)

    // Estado de grupo de una cuenta, para la presencia y las invitaciones de amigos.
    function partyInfoOf(uid) {
        for (const m of byWs.values()) if (m.uid === uid) return { state: m.party.state, code: m.party.code, size: m.party.members.size, full: m.party.members.size >= MAX_PARTY };
        return null;
    }
    const social = createSocial({ file: deps.socialFile || null, log, partyInfoOf });
    // Identidad de quien entra a un grupo: su usuario de X o, sin X, el resumen de su wallet.
    function identOf(ws, fallback) {
        if (ws.pwId) { const p = social.pub(ws.pwId); return { uid: ws.pwId, name: cleanName(p.u ? '@' + p.u : p.n), pic: p.p }; }
        return { uid: null, name: cleanName(fallback), pic: '' };
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
            practice: practiceAlive(p),
            members: [...p.members.values()].map(m => ({ id: m.id, uid: m.uid || null, pic: m.pic || '', name: m.name, leader: m.id === p.leader })),
        };
    }
    function pushParty(p) {
        const v = view(p);
        for (const m of p.members.values()) send(m.ws, Object.assign({ me: m.id }, v));
        // Los amigos ven cuando el grupo pasa a buscar partida o a jugar.
        if (p._pst !== p.state) { p._pst = p.state; for (const m of p.members.values()) if (m.uid) social.pushPresence(m.uid); }
    }
    function dequeue(p) {
        const q = queues[p.qsize]; const i = q ? q.indexOf(p) : -1;
        if (i >= 0) q.splice(i, 1);
        customRooms.delete(p);
        p.queuedAt = null;
    }
    function disband(p, reason) {
        dequeue(p);
        for (const m of p.members.values()) { byWs.delete(m.ws); send(m.ws, { t: 'sqGone', reason }); }
        parties.delete(p.code);
        for (const m of p.members.values()) if (m.uid) social.pushPresence(m.uid);
    }
    function backToIdle(p) {
        dequeue(p); p.custom = false; p.state = 'idle';
    }

    // ---------- salas ----------
    function makeRoom(kind, size, groups) {
        const key = 'squad_' + kind[0] + '_' + rnd(4);
        const now = Date.now();
        const room = {
            key, comboKey: 'squad_Free', layerIdx: 1, mode: 'arcade', roomName: 'Free',
            sim: buildSim('arcade', { food: 1, virus: 1, speed: 1, botsEnabled: false, botCount: 0 }),
            clients: new Map(), state: 'waiting',
            tickCount: 0, lastTick: now, emptySince: 0,
            endsAt: null, restartAt: null, startAt: now + (kind === 'practice' ? PRACTICE_START_MS : MATCH_START_MS),
            pendingRemovals: new Map(), deadRemovals: new Map(), spectators: new Set(),
            persistent: false, pot: 0,
            targetPop: POP, instantBots: true,
            squad: { kind, practice: kind === 'practice', size, stake: 0, teams: { A: [], B: [] }, groups, joined: 0 },
        };
        rooms.set(key, room);
        log(`Squad: sala ${kind} ${size}v${size} creada (${key})`);
        return room;
    }
    function issueTo(m, room, team) {
        const ticket = rnd(16);
        tickets.set(ticket, { roomKey: room.key, team, name: m.name, exp: Date.now() + TICKET_TTL_MS });
        send(m.ws, { t: 'sqTicket', kind: room.squad.kind, ticket, size: room.squad.size, team, startIn: Math.max(0, room.startAt - Date.now()) });
    }
    function issue(party, room, team) {
        for (const m of party.members.values()) issueTo(m, room, team);
    }
    // Practica del grupo: solo si alguien la pide (nada de meter a nadie en partida sin querer).
    // La sala es una por grupo: quien la pide entra y, si un companero la pide despues, entra en la misma.
    function practiceFor(p, m) {
        if (p.state !== 'queued') return;
        let room = practiceAlive(p) ? rooms.get(p.practiceRoom) : null;
        if (!room) { room = makeRoom('practice', p.qsize, [p.code]); p.practiceRoom = room.key; pushParty(p); }
        issueTo(m, room, 'A');
    }
    function startMatchBetween(a, b) {
        a.queuedAt = b.queuedAt = null;
        a.custom = b.custom = false;
        a.state = b.state = 'match';
        const room = makeRoom('match', a.qsize, [a.code, b.code]);
        a.matchRoom = b.matchRoom = room.key;
        issue(a, room, 'A'); issue(b, room, 'B');
        pushParty(a); pushParty(b);
        log(`Squad: ${a.code} vs ${b.code} (${a.qsize}v${a.qsize})`);
    }
    function tryMatch(size) {
        const q = queues[size];
        while (q.length >= 2) startMatchBetween(q.shift(), q.shift());
    }
    // Grupos publicos esperando retador, para la lista de salas.
    function roomsList() {
        return [...customRooms].filter(p => p.state === 'queued').map(p => {
            const lead = p.members.get(p.leader) || {};
            return { code: p.code, size: p.qsize, since: p.queuedAt, leader: { name: lead.name || 'PLAYER', pic: lead.pic || '', uid: lead.uid || null }, members: [...p.members.values()].map(m => ({ name: m.name, pic: m.pic || '' })) };
        }).sort((x, y) => x.since - y.since);
    }

    // ---------- mensajes del lobby ----------
    function handle(ws, msg) {
        if (social.handle(ws, msg)) return;
        const a = String(msg.a || '');
        let me = byWs.get(ws);
        if (a === 'rooms') return send(ws, { t: 'sqRooms', rooms: roomsList() });
        if (a === 'create') {
            if (me) return err(ws, 'already_in_party');
            const code = newCode(parties);
            const ident = identOf(ws, msg.name);
            const id = rnd(4), name = ident.name;
            const p = { code, state: 'idle', leader: id, members: new Map(), queuedAt: null, qsize: 1, lastActive: Date.now() };
            const m = { ws, id, name, uid: ident.uid, pic: ident.pic, party: p };
            p.members.set(id, m); parties.set(code, p); byWs.set(ws, m);
            pushParty(p);
            if (m.uid) social.pushPresence(m.uid);
            return;
        }
        if (a === 'join') {
            if (me) return err(ws, 'already_in_party');
            const p = parties.get(String(msg.code || '').toUpperCase().trim());
            if (!p) return err(ws, 'no_party');
            if (p.state !== 'idle') return err(ws, 'party_busy');
            if (p.members.size >= MAX_PARTY) return err(ws, 'party_full');
            const ident = identOf(ws, msg.name);
            const id = rnd(4), m = { ws, id, name: ident.name, uid: ident.uid, pic: ident.pic, party: p };
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
            const n = p.members.size;
            if (msg.size && (msg.size | 0) !== n) return err(ws, 'size_mismatch');
            if (!SIZES.includes(n)) return err(ws, 'size_mismatch');
            p.state = 'queued'; p.queuedAt = Date.now(); p.qsize = n; p.practiceRoom = null;
            p.custom = !!msg.custom;
            // Sala custom: no entra en la cola automatica; se publica y espera un retador.
            if (p.custom) customRooms.add(p); else queues[n].push(p);
            pushParty(p);
            if (!p.custom) tryMatch(n);
            return;
        }
        if (a === 'challenge') {
            if (!leader) return err(ws, 'not_leader');
            if (p.state !== 'idle') return err(ws, 'party_busy');
            const t = parties.get(String(msg.code || '').toUpperCase().trim());
            if (!t || !customRooms.has(t) || t.state !== 'queued') return err(ws, 'room_gone');
            if (t === p) return err(ws, 'self');
            if (t.qsize !== p.members.size) return err(ws, 'size_mismatch');
            customRooms.delete(t);
            p.qsize = t.qsize;
            startMatchBetween(t, p);
            return;
        }
        if (a === 'practice') { practiceFor(p, me); return; }
        if (a === 'cancel') {
            if (!leader) return err(ws, 'not_leader');
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
        if (p.members.size === 0) { dequeue(p); parties.delete(p.code); return; }
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
        room.sim.addPlayer(playerId, opts);
        sq.teams[tk.team].push(playerId);
        sq.joined++;
        const token = crypto.randomBytes(32).toString('hex');
        resumeTokens.set(token, { roomKey: room.key, playerId });
        const binV = msg.bin === true ? 1 : Math.max(0, Math.min(2, msg.bin | 0));
        const useBin = binV >= 1;
        const aspect = (typeof msg.aspect === 'number' && msg.aspect > 0) ? Math.max(0.5, Math.min(4, msg.aspect)) : 1;
        const cid = (typeof msg.cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(msg.cid)) ? msg.cid : null;
        room.clients.set(playerId, { ws, ip, name, joinedAt: Date.now(), token, opts, cid, paidFee: 0, payWallet: null, carry: 0, isTester: false, useBin, binV, aspect, _spawned: false, entrySig: null, team: tk.team });
        tickets.delete(String(msg.squad));
        ws.send(welcomeMsg(room, playerId, token, undefined, Object.assign(useBin ? { useBin: true, binV } : {}, { squad: { team: tk.team, size: sq.size, practice: sq.practice } })));
        if (room.state === 'playing') refillBots(room);
        else if (room.startAt) broadcast(room, { t: 'lobbyCountdown', startIn: Math.max(0, room.startAt - Date.now()), count: room.clients.size, needed: room.clients.size, roomName: 'Squad', mode: room.mode });
        sendRoster(room);
        return { room, playerId };
    }
    function rosterOf(room) {
        const out = { A: [], B: [] };
        for (const t of ['A', 'B']) for (const id of room.squad.teams[t]) {
            const p = room.sim.players.get(id);
            if (p) out[t].push({ id, name: p.name });
        }
        return out;
    }
    function sendRoster(room) {
        const teams = rosterOf(room);
        for (const [pid, cli] of room.clients) send(cli.ws, { t: 'squadRoster', me: cli.team, size: room.squad.size, practice: room.squad.practice, teams });
    }

    // ---------- tick y fin de partida (los llama room-loop via ctx) ----------
    function teamScore(room, team) {
        let s = 0, alive = 0, seen = 0, n = 0;
        for (const id of room.squad.teams[team]) {
            const p = room.sim.players.get(id), cli = room.clients.get(id);
            if (!p) continue;
            n++;
            if (cli && cli._spawned) seen++;
            if (p.alive) { alive++; for (const c of p.cells) s += c.mass; }
        }
        return { score: Math.round(s), alive, seen, n };
    }
    // Partida real: si un equipo se queda sin nadie vivo, acaba ya.
    function tick(room, now) {
        const sq = room.squad;
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
        broadcast(room, { t: 'squadEnd', practice: sq.practice, winner, a: a.score, b: b.score, stake: sq.stake });
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
    }, 60000);
    if (gc.unref) gc.unref();

    return { handle, onClose, join, tick, endOf, social, _internals: { parties, queues, tickets, makeRoom, customRooms } };
}

module.exports = { createSquad, SIZES, POP };
