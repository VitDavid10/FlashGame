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
    const rooms = new Map(), resumeTokens = new Map(), sent = [];
    const sq = createSquad({
        rooms, resumeTokens, PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000,
        buildSim: (mode) => { const s = new PillSim.Simulation({ mode, mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } }); s.populate(); return s; },
        welcomeMsg: (room, id, token, type, extra) => JSON.stringify(Object.assign({ t: type || 'welcome', id }, extra)),
        refillBots: () => {}, broadcast: (room, o) => { for (const c of room.clients.values()) c.ws.send(JSON.stringify(o)); },
        log: () => {},
    });
    return { sq, rooms, resumeTokens };
}
const party = (sq, name, size, extra = 0) => {
    const ws = fakeWs(); sq.handle(ws, { t: 'sq', a: 'create', name, size });
    const members = [ws];
    for (let i = 0; i < extra; i++) { const w = fakeWs(); sq.handle(w, { t: 'sq', a: 'join', code: ws.last('sqParty').code, name: name + i }); members.push(w); }
    return members;
};

test('un grupo no puede jugar incompleto ni sin que todos esten listos', () => {
    const { sq } = make();
    const [lead, mate] = party(sq, 'ana', 2, 1);
    sq.handle(lead, { t: 'sq', a: 'play' });
    assert.equal(lead.last('sqErr').reason, 'not_ready');
    sq.handle(mate, { t: 'sq', a: 'ready', v: true });
    sq.handle(lead, { t: 'sq', a: 'play' });
    assert.equal(lead.last('sqParty').state, 'queued');
    const solo = party(sq, 'bob', 2)[0];
    sq.handle(solo, { t: 'sq', a: 'play' });
    assert.equal(solo.last('sqErr').reason, 'need_full_party');
});

test('al ponerse en cola el grupo recibe sala de practica con equipo A', () => {
    const { sq, rooms } = make();
    const [lead] = party(sq, 'ana', 1);
    sq.handle(lead, { t: 'sq', a: 'play' });
    const tk = lead.last('sqTicket');
    assert.equal(tk.kind, 'practice');
    assert.equal(tk.team, 'A');
    assert.equal(rooms.size, 1);
    assert.equal([...rooms.values()][0].targetPop, 30);
});

test('dos grupos del mismo tamano se emparejan y la sala tiene los dos equipos', () => {
    const { sq, rooms } = make();
    const a = party(sq, 'ana', 2, 1), b = party(sq, 'bea', 2, 1);
    for (const p of [a, b]) { sq.handle(p[1], { t: 'sq', a: 'ready', v: true }); sq.handle(p[0], { t: 'sq', a: 'play' }); }
    const ta = a.map(w => w.last('sqTicket')), tb = b.map(w => w.last('sqTicket'));
    assert.ok(ta.every(t => t.kind === 'match' && t.team === 'A'));
    assert.ok(tb.every(t => t.kind === 'match' && t.team === 'B'));
    const wsList = [];
    for (const [t, i] of [[ta[0], 0], [ta[1], 1], [tb[0], 2], [tb[1], 3]]) {
        const ws = fakeWs(); wsList.push(ws);
        const r = sq.join(ws, '1.2.3.x', { t: 'join', squad: t.ticket });
        assert.ok(r, 'entra con su ticket');
        assert.equal(r.room.sim.players.get(r.playerId).team, t.team);
    }
    const room = [...rooms.values()].find(r => !r.squad.practice);
    assert.equal(room.squad.teams.A.length, 2);
    assert.equal(room.squad.teams.B.length, 2);
    assert.equal(wsList[3].last('squadRoster').me, 'B');
    // un ticket vale una sola vez
    assert.equal(sq.join(fakeWs(), 'x', { t: 'join', squad: ta[0].ticket }), null);
});

test('sin fuego amigo: companeros no se comen, rivales si', () => {
    const s = new PillSim.Simulation({ mode: 'arcade', mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } });
    s.populate();
    for (const [id, team] of [['a1', 'A'], ['a2', 'A'], ['b1', 'B']]) { s.addPlayer(id, { name: id, team }); s.spawnPlayer(id, 0); }
    const [a1, a2, b1] = ['a1', 'a2', 'b1'].map(id => s.players.get(id));
    // a1 enorme encima de a2 (mismo equipo) y de b1 (rival)
    for (const p of [a2, b1]) { p.cells[0].x = a1.cells[0].x; p.cells[0].y = a1.cells[0].y; }
    a1.cells[0].r = a1.cells[0].r * 3;
    s.step(25);
    assert.equal(a2.alive, true, 'el companero sigue vivo');
    assert.equal(b1.alive, false, 'el rival se lo come');
});

test('termina cuando un equipo se queda sin vivos y gana el otro', () => {
    const { sq, rooms } = make();
    const a = party(sq, 'ana', 1), b = party(sq, 'bea', 1);
    for (const p of [a, b]) sq.handle(p[0], { t: 'sq', a: 'play' });
    const wa = fakeWs(), wb = fakeWs();
    const ra = sq.join(wa, 'x', { t: 'join', squad: a[0].last('sqTicket').ticket });
    const rb = sq.join(wb, 'x', { t: 'join', squad: b[0].last('sqTicket').ticket });
    const room = ra.room;
    for (const [r, ws] of [[ra, wa], [rb, wb]]) { room.clients.get(r.playerId)._spawned = true; room.sim.spawnPlayer(r.playerId, 0); }
    room.state = 'playing'; room.endsAt = Date.now() + 100000;
    room.sim.players.get(rb.playerId).alive = false;
    sq.tick(room, Date.now());
    assert.ok(room.endsAt <= Date.now(), 'fin inmediato');
    sq.endOf(room);
    assert.equal(wa.last('squadEnd').winner, 'A');
    assert.equal(a[0].last('sqParty').state, 'idle', 'el grupo vuelve al lobby');
});

test('si el lider se va, otro miembro toma el grupo y desaparece si queda vacio', () => {
    const { sq } = make();
    const [lead, mate] = party(sq, 'ana', 2, 1);
    sq.onClose(lead);
    assert.equal(mate.last('sqParty').leader, mate.last('sqParty').me);
    sq.onClose(mate);
    assert.equal(sq._internals.parties.size, 0);
});

test('un companero que aun esta cargando no cuenta como muerto', () => {
    const { sq } = make();
    const a = party(sq, 'ana', 2, 1), b = party(sq, 'bea', 2, 1);
    for (const p of [a, b]) { sq.handle(p[1], { t: 'sq', a: 'ready', v: true }); sq.handle(p[0], { t: 'sq', a: 'play' }); }
    const joined = [...a, ...b].map(w => { const t = w.last('sqTicket'); return sq.join(fakeWs(), 'x', { t: 'join', squad: t.ticket }); });
    const room = joined[0].room;
    room.state = 'playing'; room.endsAt = Date.now() + 100000;
    // A: solo el primero ha spawneado y muere; el segundo sigue cargando. B: los dos vivos.
    for (const j of [joined[0], joined[2], joined[3]]) { room.clients.get(j.playerId)._spawned = true; room.sim.spawnPlayer(j.playerId, 0); }
    room.sim.players.get(joined[0].playerId).alive = false;
    sq.tick(room, Date.now());
    assert.ok(room.endsAt > Date.now() + 1000, 'la partida sigue');
    // Cuando el segundo spawnea y tambien cae, ahora si acaba.
    room.clients.get(joined[1].playerId)._spawned = true; room.sim.spawnPlayer(joined[1].playerId, 0);
    room.sim.players.get(joined[1].playerId).alive = false;
    sq.tick(room, Date.now());
    assert.ok(room.endsAt <= Date.now());
});
