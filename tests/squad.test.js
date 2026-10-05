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
const say = (sq, ws, o) => sq.handle(ws, Object.assign({ t: 'sq' }, o));

test('la sala la fija cuantos sois: un grupo de 2 busca 2v2 y uno de 1 busca 1v1', () => {
    const { sq } = make();
    const duo = party(sq, 'ana', 2), solo = party(sq, 'bob', 1);
    say(sq, duo[0], { a: 'play' });
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
    say(sq, a, { a: 'play' });
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
    say(sq, a[0], { a: 'play' }); say(sq, b[0], { a: 'play' });
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
    say(sq, a[0], { a: 'play' }); say(sq, b[0], { a: 'play' });
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
    say(sq, a[0], { a: 'play' }); say(sq, b[0], { a: 'play' });
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
