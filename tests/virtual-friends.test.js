'use strict';
const test = require('node:test');
const assert = require('node:assert');
const PillSim = require('../shared/sim.js');
const token = require('../server/social-token.js');
const { createSquad } = require('../server/squad.js');

function fakeWs() {
    return { readyState: 1, out: [], send(d) { this.out.push(typeof d === 'string' ? JSON.parse(d) : d); }, close() { this.readyState = 3; },
        last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (this.out[i].t === t) return this.out[i]; return null; } };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function make() {
    const rooms = new Map(), inputs = [];
    const sq = createSquad({
        rooms, resumeTokens: new Map(), PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000,
        buildSim: (mode) => { const s = new PillSim.Simulation({ mode, mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } }); s.populate(); return s; },
        welcomeMsg: () => '{}', refillBots: () => {}, broadcast: () => {}, log: () => {},
        startMatch: room => { room.state = 'playing'; },
        // Como el host: 'ready' spawnea al jugador
        handleInput: (room, pid, m) => { inputs.push(m.t); if (m.t === 'ready') { const c = room.clients.get(pid); c._spawned = true; room.sim.spawnPlayer(pid, 0); } },
    });
    return { sq, rooms, inputs };
}
function human(sq, id, u) {
    const ws = fakeWs();
    sq.handle(ws, { t: 'sq', a: 'hello', token: token.sign({ id, u, n: u, p: '' }) });
    return ws;
}
const say = (sq, ws, o) => sq.handle(ws, Object.assign({ t: 'sq' }, o));

test('@icefox y @bandit no salen en ninguna lista hasta que los buscas', () => {
    const { sq } = make();
    const me = human(sq, 'AAAAAAA', 'ana');
    assert.equal(me.last('sqFriends').friends.length, 0);
});

test('al buscarlos por @nombre aceptan, salen conectados y contestan a los susurros', async () => {
    const { sq } = make();
    const me = human(sq, 'AAAAAAA', 'ana');
    say(sq, me, { a: 'fadd', u: '@icefox' });
    await wait(600);
    const f = me.last('sqFriends').friends;
    assert.equal(f.length, 1);
    assert.equal(f[0].u, 'icefox');
    assert.equal(f[0].st, 'on');
    assert.ok(f[0].av && f[0].av.t === 'pill', 'tienen avatar');
    say(sq, me, { a: 'whisper', id: f[0].id, text: 'hola' });
    await wait(1200);
    const w = me.out.filter(o => o.t === 'sqWhisper' && !o.mine);
    assert.equal(w.length, 1);
    assert.equal(w[0].from.u, 'icefox');
});

test('invitados entran al grupo y juegan la practica: la sala nace ya iniciada y ellos spawnean', async () => {
    const { sq, rooms, inputs } = make();
    const me = human(sq, 'AAAAAAA', 'ana');
    for (const u of ['icefox', 'bandit']) { say(sq, me, { a: 'fadd', u }); }
    await wait(600);
    say(sq, me, { a: 'create' });
    for (const f of me.last('sqFriends').friends) say(sq, me, { a: 'pinvite', id: f.id });
    await wait(1000);
    const p = me.last('sqParty');
    assert.equal(p.members.length, 3, 'yo + los dos amigos');
    assert.deepEqual(p.members.map(m => m.name).sort(), ['@bandit', '@icefox', '@ana'].sort());
    say(sq, me, { a: 'play', custom: true });
    assert.equal(me.last('sqParty').size, 3);
    assert.equal(rooms.size, 0, 'buscar no abre ninguna sala');
    say(sq, me, { a: 'practice' });
    const room = [...rooms.values()][0];
    assert.equal(room.state, 'playing', 'la practica ya esta en marcha, sin lobby');
    // Yo entro con mi ticket; ellos entran solos
    const wsMe = fakeWs();
    sq.join(wsMe, 'x', { t: 'join', squad: me.last('sqTicket').ticket });
    await wait(900);
    assert.equal(room.clients.size, 3, 'yo y los dos amigos de prueba');
    assert.equal(room.squad.teams.A.length, 3);
    await wait(700);
    assert.ok(inputs.includes('ready'), 'piden spawnear al estar la sala en marcha');
    const bots = [...room.clients.values()].filter(c => c.ws.virtualGame);
    assert.equal(bots.length, 2);
    assert.ok(bots.every(c => c._spawned));
    assert.ok(inputs.includes('input'), 'se mueven por el mapa');
    // Si me voy, se van con la sala
    room.clients.delete([...room.clients].find(([, c]) => c.ws === wsMe)[0]);
    await wait(700);
    assert.equal(room.clients.size, 0, 'sin humanos dentro, los amigos de prueba salen');
    // y el grupo solo de virtuales desaparece cuando el ultimo humano se va
    sq.onClose(me);
    assert.equal(sq._internals.parties.size, 0);
});

test('en la partida entre grupos tambien entran y juegan con su equipo', async () => {
    const { sq, rooms } = make();
    const me = human(sq, 'AAAAAAA', 'ana'), foe = human(sq, 'BBBBBBB', 'bea');
    say(sq, me, { a: 'fadd', u: 'icefox' });
    await wait(600);
    say(sq, me, { a: 'create' });
    say(sq, me, { a: 'pinvite', id: me.last('sqFriends').friends[0].id });
    await wait(900);
    say(sq, foe, { a: 'create' });
    say(sq, foe, { a: 'play', custom: true });
    // el rival es de 1; nosotros somos 2: no coinciden
    say(sq, me, { a: 'challenge', code: foe.last('sqParty').code });
    assert.equal(me.last('sqErr').reason, 'size_mismatch');
    say(sq, foe, { a: 'cancel' });
    say(sq, me, { a: 'play' }); say(sq, foe, { a: 'leave' });
    const duo = human(sq, 'CCCCCCC', 'cat'); say(sq, duo, { a: 'create' });
    const duo2 = human(sq, 'DDDDDDD', 'dan'); say(sq, duo2, { a: 'join', code: duo.last('sqParty').code });
    say(sq, duo, { a: 'play' }); say(sq, duo2, { a: 'ready', v: true });
    await wait(900);
    const match = [...rooms.values()].find(r => !r.squad.practice);
    assert.ok(match, 'se crea la partida 2v2');
    const mine = [...match.clients.values()].filter(c => c.ws.virtualGame);
    assert.equal(mine.length, 1, 'icefox entra en la partida');
    assert.equal(mine[0].team, 'A');
});
