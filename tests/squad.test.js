'use strict';
const test = require('node:test');
const assert = require('node:assert');
const PillSim = require('../shared/sim.js');
const { createSquad } = require('../server/squad.js');

function fakeWs() {
    return { readyState: 1, out: [], send(d) { this.out.push(typeof d === 'string' ? JSON.parse(d) : d); }, close() { this.readyState = 3; },
        last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (this.out[i].t === t) return this.out[i]; return null; } };
}
function make() {
    const rooms = new Map(), resumeTokens = new Map();
    const sq = createSquad({
        rooms, resumeTokens, PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000,
        buildSim: (mode) => { const s = new PillSim.Simulation({ mode, mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } }); s.populate(); return s; },
        welcomeMsg: (room, id, token, type, extra) => JSON.stringify(Object.assign({ t: type || 'welcome', id }, extra)),
        refillBots: () => {}, broadcast: (room, o) => { for (const c of room.clients.values()) c.ws.send(JSON.stringify(o)); },
        log: () => {},
    });
    return { sq, rooms, resumeTokens };
}
// Grupo de `n` jugadores: el primero lo crea, el resto entra con el codigo (como al aceptar una invitacion).
const party = (sq, name, n = 1) => {
    const ws = fakeWs(); sq.handle(ws, { t: 'sq', a: 'create', name });
    const members = [ws];
    for (let i = 1; i < n; i++) { const w = fakeWs(); sq.handle(w, { t: 'sq', a: 'join', code: ws.last('sqParty').code, name: name + i }); members.push(w); }
    return members;
};
// El lider tambien da LISTO: en estas pruebas (gratis) va dentro del mismo 'play'.
const say = (sq, ws, o) => sq.handle(ws, Object.assign({ t: 'sq' }, (o.a === 'play' || o.a === 'challenge') && o.ready === undefined ? { ready: true } : {}, o));

test('la sala la fija cuantos sois: un grupo de 2 busca 2v2 y uno de 1 busca 1v1', () => {
    const { sq } = make();
    const duo = party(sq, 'ana', 2), solo = party(sq, 'bob', 1);
    say(sq, duo[0], { a: 'play' });
    assert.equal(duo[0].last('sqParty').state, 'idle', 'con companeros primero hay que dar LISTO');
    say(sq, duo[1], { a: 'ready', v: true });
    assert.equal(duo[0].last('sqParty').state, 'queued');
    assert.equal(duo[0].last('sqParty').size, 2);
    say(sq, solo[0], { a: 'play', size: 2 });
    assert.equal(solo[0].last('sqErr').reason, 'size_mismatch', 'un grupo de 1 no puede pedir una sala de 2');
    say(sq, solo[0], { a: 'play' });
    assert.equal(solo[0].last('sqParty').size, 1);
    assert.equal(sq._internals.queues[1].length, 1);
    assert.equal(sq._internals.queues[2].length, 1);
});

test('un grupo admite como mucho 3 y solo el lider busca', () => {
    const { sq } = make();
    const g = party(sq, 'ana', 3);
    const extra = fakeWs(); say(sq, extra, { a: 'join', code: g[0].last('sqParty').code, name: 'x' });
    assert.equal(extra.last('sqErr').reason, 'party_full');
    say(sq, g[1], { a: 'play' });
    assert.equal(g[1].last('sqErr').reason, 'not_leader');
});

test('buscar partida NO mete a nadie en partida: la practica es opcional', () => {
    const { sq, rooms } = make();
    const [lead] = party(sq, 'ana', 1);
    say(sq, lead, { a: 'play' });
    assert.equal(lead.last('sqTicket'), null, 'sin ticket hasta que lo pida');
    assert.equal(rooms.size, 0, 'ninguna sala creada');
    say(sq, lead, { a: 'play', custom: true });   // ya esta buscando: se ignora, sigue igual
    assert.equal(rooms.size, 0);
});

test('practica: solo entra quien la pide y un companero que la pide despues entra en la MISMA sala', () => {
    const { sq, rooms } = make();
    const [a, b] = party(sq, 'ana', 2);
    say(sq, a, { a: 'play' }); say(sq, b, { a: 'ready', v: true });
    say(sq, a, { a: 'practice' });
    const t1 = a.last('sqTicket');
    assert.equal(t1.kind, 'practice');
    assert.equal(t1.team, 'A');
    assert.equal(b.last('sqTicket'), null, 'el amigo no entra solo');
    assert.equal(rooms.size, 1);
    assert.equal(a.last('sqParty').practice, true);
    say(sq, b, { a: 'practice' });
    const t2 = b.last('sqTicket');
    assert.equal(rooms.size, 1, 'sigue habiendo una sola sala de practica');
    const wa = fakeWs(), wb = fakeWs();
    const ra = sq.join(wa, 'x', { t: 'join', squad: t1.ticket }), rb = sq.join(wb, 'x', { t: 'join', squad: t2.ticket });
    assert.equal(ra.room, rb.room, 'misma sala');
    assert.equal(ra.room.squad.teams.A.length, 2);
    assert.equal(ra.room.targetPop, 30);
});

test('la practica solo se pide buscando', () => {
    const { sq, rooms } = make();
    const [a] = party(sq, 'ana', 1);
    say(sq, a, { a: 'practice' });
    assert.equal(rooms.size, 0);
});

test('dos grupos del mismo tamano se emparejan y la sala tiene los dos equipos', () => {
    const { sq, rooms } = make();
    const a = party(sq, 'ana', 2), b = party(sq, 'bea', 2);
    say(sq, a[0], { a: 'play' }); say(sq, a[1], { a: 'ready', v: true });
    say(sq, b[0], { a: 'play' }); say(sq, b[1], { a: 'ready', v: true });
    const ta = a.map(w => w.last('sqTicket')), tb = b.map(w => w.last('sqTicket'));
    assert.ok(ta.every(t => t.kind === 'match' && t.team === 'A'));
    assert.ok(tb.every(t => t.kind === 'match' && t.team === 'B'));
    const wsList = [];
    for (const t of [ta[0], ta[1], tb[0], tb[1]]) {
        const ws = fakeWs(); wsList.push(ws);
        const r = sq.join(ws, '1.2.3.x', { t: 'join', squad: t.ticket });
        assert.ok(r, 'entra con su ticket');
        assert.equal(r.room.sim.players.get(r.playerId).team, t.team);
    }
    const room = [...rooms.values()].find(r => !r.squad.practice);
    assert.equal(room.squad.teams.A.length, 2);
    assert.equal(room.squad.teams.B.length, 2);
    assert.equal(wsList[3].last('squadRoster').me, 'B');
    assert.equal(sq.join(fakeWs(), 'x', { t: 'join', squad: ta[0].ticket }), null, 'un ticket vale una sola vez');
});

test('tamanos distintos no se emparejan', () => {
    const { sq } = make();
    const a = party(sq, 'ana', 2), b = party(sq, 'bob', 1);
    say(sq, a[0], { a: 'play' }); say(sq, a[1], { a: 'ready', v: true }); say(sq, b[0], { a: 'play' });
    assert.equal(a[0].last('sqParty').state, 'queued');
    assert.equal(b[0].last('sqParty').state, 'queued');
});

test('sin fuego amigo: companeros no se comen, rivales si', () => {
    const s = new PillSim.Simulation({ mode: 'arcade', mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } });
    s.populate();
    for (const [id, team] of [['a1', 'A'], ['a2', 'A'], ['b1', 'B']]) { s.addPlayer(id, { name: id, team }); s.spawnPlayer(id, 0); }
    const [a1, a2, b1] = ['a1', 'a2', 'b1'].map(id => s.players.get(id));
    for (const p of [a2, b1]) { p.cells[0].x = a1.cells[0].x; p.cells[0].y = a1.cells[0].y; }
    a1.cells[0].r = a1.cells[0].r * 3;
    s.step(25);
    assert.equal(a2.alive, true, 'el companero sigue vivo');
    assert.equal(b1.alive, false, 'el rival se lo come');
});

// Partida 1v1 a punto de jugarse, con los dos ya dentro.
function duel() {
    const { sq, rooms } = make();
    const a = party(sq, 'ana', 1), b = party(sq, 'bea', 1);
    for (const p of [a, b]) say(sq, p[0], { a: 'play' });
    const wa = fakeWs(), wb = fakeWs();
    const ra = sq.join(wa, 'x', { t: 'join', squad: a[0].last('sqTicket').ticket });
    const rb = sq.join(wb, 'x', { t: 'join', squad: b[0].last('sqTicket').ticket });
    return { sq, rooms, a, b, wa, wb, ra, rb, room: ra.room };
}

test('termina cuando un equipo se queda sin vivos y gana el otro', () => {
    const { sq, a, wa, ra, rb, room } = duel();
    for (const r of [ra, rb]) { room.clients.get(r.playerId)._spawned = true; room.sim.spawnPlayer(r.playerId, 0); }
    room.state = 'playing'; room.endsAt = Date.now() + 100000;
    room.sim.players.get(rb.playerId).alive = false;
    sq.tick(room, Date.now());
    assert.ok(room.endsAt <= Date.now(), 'fin inmediato');
    sq.endOf(room);
    assert.equal(wa.last('squadEnd').winner, 'A');
    assert.equal(a[0].last('sqParty').state, 'idle', 'el grupo vuelve a estar libre');
});

test('un companero que aun esta cargando no cuenta como muerto', () => {
    const { sq } = make();
    const a = party(sq, 'ana', 2), b = party(sq, 'bea', 2);
    say(sq, a[0], { a: 'play' }); say(sq, a[1], { a: 'ready', v: true });
    say(sq, b[0], { a: 'play' }); say(sq, b[1], { a: 'ready', v: true });
    const joined = [...a, ...b].map(w => sq.join(fakeWs(), 'x', { t: 'join', squad: w.last('sqTicket').ticket }));
    const room = joined[0].room;
    room.state = 'playing'; room.endsAt = Date.now() + 100000;
    for (const j of [joined[0], joined[2], joined[3]]) { room.clients.get(j.playerId)._spawned = true; room.sim.spawnPlayer(j.playerId, 0); }
    room.sim.players.get(joined[0].playerId).alive = false;
    sq.tick(room, Date.now());
    assert.ok(room.endsAt > Date.now() + 1000, 'la partida sigue');
    room.clients.get(joined[1].playerId)._spawned = true; room.sim.spawnPlayer(joined[1].playerId, 0);
    room.sim.players.get(joined[1].playerId).alive = false;
    sq.tick(room, Date.now());
    assert.ok(room.endsAt <= Date.now());
});

test('si el lider se va, otro miembro toma el grupo y desaparece si queda vacio', () => {
    const { sq } = make();
    const [lead, mate] = party(sq, 'ana', 2);
    sq.onClose(lead);
    assert.equal(mate.last('sqParty').leader, mate.last('sqParty').me);
    sq.onClose(mate);
    assert.equal(sq._internals.parties.size, 0);
});

test('si alguien sale mientras el grupo busca, se cancela la busqueda (ya no cuadra el tamano)', () => {
    const { sq } = make();
    const [lead, mate] = party(sq, 'ana', 2);
    say(sq, lead, { a: 'play' });
    sq.onClose(mate);
    assert.equal(lead.last('sqParty').state, 'idle');
    assert.equal(sq._internals.queues[2].length, 0);
});

test('LISTO del grupo: no se busca hasta que todos dan listo; el lider avisa con RECORDAR y puede cancelar', () => {
    const { sq } = make();
    const [lead, b, c] = party(sq, 'ana', 3);
    say(sq, lead, { a: 'play' });
    const p = lead.last('sqParty');
    assert.equal(p.state, 'idle', 'aun no busca');
    assert.deepEqual(Object.values(p.rc.ready).sort(), [false, false, true], 'solo el lider esta listo');
    assert.equal(b.last('sqReadyCheck').kind, 'quick');
    assert.equal(c.last('sqReadyCheck').size, 3);
    assert.equal(lead.last('sqReadyCheck'), null, 'el lider no recibe cartel');
    // uno da listo: aun no
    say(sq, b, { a: 'ready', v: true });
    assert.equal(lead.last('sqParty').state, 'idle');
    // el lider recuerda: solo le llega al que falta
    const antes = b.out.filter(o => o.t === 'sqReadyCheck').length;
    say(sq, lead, { a: 'remind' });
    assert.equal(b.out.filter(o => o.t === 'sqReadyCheck').length, antes, 'b ya estaba listo');
    assert.equal(c.last('sqReadyCheck').remind, true);
    // el ultimo da listo: empieza la busqueda
    say(sq, c, { a: 'ready', v: true });
    assert.equal(lead.last('sqParty').state, 'queued');
    assert.equal(lead.last('sqParty').rc, null);
});

test('LISTO del grupo: si alguien dice que no, o el lider cancela, no se busca', () => {
    const { sq } = make();
    const [lead, b] = party(sq, 'ana', 2);
    say(sq, lead, { a: 'play', custom: true });
    say(sq, b, { a: 'ready', v: false });
    assert.equal(lead.last('sqParty').state, 'idle');
    assert.equal(lead.last('sqParty').rc, null);
    assert.equal(lead.last('sqReadyEnd').reason, 'declined');
    assert.equal(sq._internals.customRooms.size, 0);
    say(sq, lead, { a: 'play' });
    say(sq, lead, { a: 'cancel' });
    assert.equal(b.last('sqReadyEnd').reason, 'cancelled');
    assert.equal(lead.last('sqParty').state, 'idle');
});

test('LISTO del grupo: si alguien se va o entra uno nuevo se anula, y unirse a una sala tambien pide listo', () => {
    const { sq } = make();
    const [lead, b] = party(sq, 'ana', 2);
    say(sq, lead, { a: 'play' });
    sq.onClose(b);
    assert.equal(lead.last('sqParty').rc, null);
    // sala publica de un solo jugador y un duo que quiere unirse a ella
    const solo = party(sq, 'sol', 1)[0];
    say(sq, solo, { a: 'play', custom: true });
    const [l2, m2] = party(sq, 'duo', 2);
    const sola2 = party(sq, 'otro', 1)[0];
    say(sq, sola2, { a: 'play', custom: true });
    const codeSolo = sq._internals.parties.get(solo.last('sqParty').code);
    // el duo no puede unirse a una sala de 1 (tamano distinto)
    say(sq, l2, { a: 'challenge', code: codeSolo.code });
    assert.equal(l2.last('sqErr').reason, 'size_mismatch');
    // un duo publica sala (con listo) y otro duo se une (con listo)
    say(sq, l2, { a: 'play', custom: true }); say(sq, m2, { a: 'ready', v: true });
    const [l3, m3] = party(sq, 'duo3', 2);
    say(sq, l3, { a: 'challenge', code: l2.last('sqParty').code });
    assert.equal(l3.last('sqParty').state, 'idle', 'aun no se une');
    say(sq, m3, { a: 'ready', v: true });
    assert.equal(l3.last('sqTicket').kind, 'match');
    assert.equal(l2.last('sqTicket').kind, 'match');
});

test('al emparejar cada uno recibe la alineacion de los dos equipos (fotos VS fotos)', () => {
    const { sq } = make();
    const a = party(sq, 'ana', 2), b = party(sq, 'bea', 2);
    say(sq, a[0], { a: 'play' }); say(sq, a[1], { a: 'ready', v: true });
    say(sq, b[0], { a: 'play' }); say(sq, b[1], { a: 'ready', v: true });
    const t = a[0].last('sqTicket');
    assert.equal(t.kind, 'match');
    assert.equal(t.lineup.A.length, 2);
    assert.equal(t.lineup.B.length, 2);
    assert.deepEqual(t.lineup.A.map(x => x.name).sort(), ['ana', 'ana1']);
    assert.deepEqual(b[1].last('sqTicket').lineup.B.map(x => x.name).sort(), ['bea', 'bea1']);
    assert.ok('pic' in t.lineup.A[0] && 'av' in t.lineup.A[0]);
});

test('al acabar, los resultados llevan las estadisticas de cada jugador de los dos equipos', () => {
    const { sq } = make();
    const a = party(sq, 'ana', 1), b = party(sq, 'bea', 1);
    for (const p of [a, b]) say(sq, p[0], { a: 'play' });
    const wa = fakeWs(), wb = fakeWs();
    const ra = sq.join(wa, 'x', { t: 'join', squad: a[0].last('sqTicket').ticket });
    const rb = sq.join(wb, 'x', { t: 'join', squad: b[0].last('sqTicket').ticket });
    const room = ra.room;
    for (const r of [ra, rb]) { room.clients.get(r.playerId)._spawned = true; room.sim.spawnPlayer(r.playerId, 0); }
    room.state = 'playing'; room.endsAt = Date.now() + 100000;
    sq.tick(room, Date.now() - 12000);                    // marca el instante de aparicion
    sq.onEvent(room, { type: 'botKilled', playerId: ra.playerId, victimId: rb.playerId }, Date.now());
    sq.onEvent(room, { type: 'botKilled', playerId: ra.playerId, victimId: 'otro' }, Date.now());
    sq.onEvent(room, { type: 'botKilled', playerId: ra.playerId }, Date.now());   // un bot: no cuenta
    sq.onEvent(room, { type: 'botPieceEaten', playerId: ra.playerId }, Date.now());
    room.sim.players.get(ra.playerId).peakMass = 4321.6;
    sq.onEvent(room, { type: 'playerDied', playerId: rb.playerId }, Date.now());
    room.sim.players.get(rb.playerId).alive = false;
    sq.endOf(room);
    const m = wa.last('squadEnd');
    assert.equal(m.players.A.length, 1);
    assert.equal(m.players.A[0].name, 'ana');
    assert.equal(m.players.A[0].kills, 2);
    assert.equal(m.players.A[0].pieces, 1);
    assert.equal(m.players.A[0].peak, 4322);
    assert.ok(m.players.A[0].secs >= 11 && m.players.A[0].secs <= 14, 'segundos jugados');
    assert.equal(m.players.A[0].alive, true);
    assert.equal(m.players.B[0].alive, false);
    assert.equal(m.players.B[0].name, 'bea');
    assert.equal(m.winner, 'A');
});

test('arenas arcade y classic no se mezclan: cada modo tiene su cola y su sala', () => {
    const { sq, rooms } = make();
    const a = party(sq, 'ana', 1)[0], b = party(sq, 'bob', 1)[0], c = party(sq, 'cat', 1)[0];
    say(sq, a, { a: 'play', mode: 'classic' });
    say(sq, b, { a: 'play', mode: 'arcade' });
    assert.equal(a.last('sqParty').state, 'queued');
    assert.equal(b.last('sqParty').state, 'queued', 'distinto modo: no se emparejan');
    say(sq, c, { a: 'play', mode: 'classic' });
    const t = c.last('sqTicket');
    assert.ok(t && t.kind === 'match' && t.mode === 'classic');
    assert.equal([...rooms.values()].find(r => !r.squad.practice).mode, 'classic');
});

test('QUICK MATCH entra en una sala abierta del mismo tamano y modo; y se puede mirar la partida', () => {
    const { sq, rooms } = make();
    const a = party(sq, 'ana', 1)[0], b = party(sq, 'bob', 1)[0];
    say(sq, a, { a: 'play', custom: true, mode: 'arcade' });
    assert.equal(sq._internals.customRooms.size, 1);
    say(sq, b, { a: 'play', mode: 'arcade' });
    assert.equal(b.last('sqTicket').kind, 'match', 'quick match se une a la sala abierta');
    // REJOIN: el que se fue al morir vuelve a su partida a mirar con su equipo, sin contar como jugador nuevo
    const wa = fakeWs(), wb = fakeWs();
    const ra = sq.join(wa, 'x', { t: 'join', squad: a.last('sqTicket').ticket });
    const rb = sq.join(wb, 'x', { t: 'join', squad: b.last('sqTicket').ticket });
    const room = ra.room;
    for (const r of [ra, rb]) { room.clients.get(r.playerId)._spawned = true; room.sim.spawnPlayer(r.playerId, 0); }
    room.state = 'playing'; sq.tick(room, Date.now());
    room.sim.players.get(ra.playerId).alive = false; room.clients.delete(ra.playerId); room.sim.removePlayer(ra.playerId);   // murio y se fue
    say(sq, a, { a: 'rejoin' });
    const t = a.last('sqTicket');
    assert.ok(t && t.rejoin && t.kind === 'match');
    const w2 = fakeWs(), r2 = sq.join(w2, 'x', { t: 'join', squad: t.ticket });
    assert.ok(r2 && r2.room === room);
    assert.equal(room.sim.players.has(r2.playerId), false, 'no vuelve a jugar');
    assert.equal(room.squad.teams.A.length + room.squad.teams.B.length, 2, 'no cuenta como jugador nuevo');
    // y como su equipo se quedo sin nadie vivo, la partida acaba (antes, al irse, ya no acababa)
    sq.tick(room, Date.now());
    assert.ok(room.endsAt <= Date.now());
    sq.endOf(room);
    const end = w2.last('squadEnd');
    assert.ok(end && end.winner, 'el que volvio recibe el resultado');
    assert.equal(end.players[room.clients.get(r2.playerId).team][0].name, 'ana');
});

test('arena de pago 1v1: precio fijado, cada uno paga al dar LISTO, bote en la sala y el ganador cobra con CLAIM', async () => {
    const rooms = new Map(), saldo = { wa: 1000, wb: 1000 };
    const sq = createSquad({
        rooms, resumeTokens: new Map(), PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000,
        buildSim: (mode) => { const s = new PillSim.Simulation({ mode, mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } }); s.populate(); return s; },
        welcomeMsg: (room, id, token, type, extra) => JSON.stringify(Object.assign({ t: type || 'welcome', id }, extra)),
        refillBots: () => {}, broadcast: (room, o) => { for (const c of room.clients.values()) c.ws.send(JSON.stringify(o)); }, log: () => {},
        quote: usd => usd * 50, pillUsd: () => 0.02,
        authorize: ({ fee, pay }) => { const w = pay && pay.wallet; if (!w || saldo[w] < fee) return { ok: false, reason: 'saldo' }; saldo[w] -= fee; return { ok: true, payWallet: w, fee }; },
        credit: (w, n) => { saldo[w] += n; }, treasury: () => {}, verify: () => true,
    });
    const a = party(sq, 'ana', 1)[0], b = party(sq, 'bea', 1)[0];
    say(sq, a, { a: 'play', price: 2, ready: false });
    const rc = a.last('sqReadyCheck');
    assert.equal(rc.fee, 100, '2 $ a 50 PILL/$');
    assert.equal(a.last('sqParty').state, 'idle', 'hasta el LISTO no busca');
    say(sq, a, { a: 'ready', v: true, pay: { wallet: 'wa' } });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(saldo.wa, 900);
    assert.equal(a.last('sqParty').state, 'queued');
    say(sq, b, { a: 'play', price: 2, ready: false });
    say(sq, b, { a: 'ready', v: true, pay: { wallet: 'wb' } });
    await new Promise(r => setTimeout(r, 10));
    const ja = fakeWs(), jb = fakeWs();
    const ra = sq.join(ja, 'x', { t: 'join', squad: a.last('sqTicket').ticket });
    const rb = sq.join(jb, 'x', { t: 'join', squad: b.last('sqTicket').ticket });
    const room = ra.room;
    assert.equal(ja.last('squadRoster').pot, 200, 'bote: los dos equipos');
    for (const r of [ra, rb]) { room.clients.get(r.playerId)._spawned = true; room.sim.spawnPlayer(r.playerId, 0); }
    room.state = 'playing'; room.endsAt = Date.now() + 100000;
    sq.onEvent(room, { type: 'botKilled', playerId: ra.playerId, victimId: rb.playerId }, Date.now());
    sq.onEvent(room, { type: 'playerDied', playerId: rb.playerId }, Date.now());
    assert.equal(ja.last('killGain').amount, 100, 'al que se lo come le sale lo que llevaba (+$2)');
    assert.equal(jb.last('killGain'), null, 'al que cae no le sale nada');
    room.sim.players.get(rb.playerId).alive = false;
    sq.tick(room, Date.now());
    sq.endOf(room);
    const end = ja.last('squadEnd');
    assert.equal(end.winner, 'A');
    assert.equal(end.money.pot, 200);
    const prize = ja.last('squadPrize');
    assert.equal(prize.amount, 200, 'murio por nada (no un bot): sin comision');
    say(sq, a, { a: 'claim', id: prize.id, wallet: 'wa', message: 'PillWars claim arena ' + prize.id, signature: [1] });
    assert.equal(a.last('sqClaim').ok, true);
    assert.equal(saldo.wa, 1100);
});
