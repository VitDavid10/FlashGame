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
        virtualReadyMs: 60,
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
    assert.equal(me.last('sqParty').state, 'idle', 'los amigos de prueba no dan listo al instante');
    assert.ok(me.last('sqParty').rc, 'hay un chequeo abierto');
    await wait(300);
    assert.equal(me.last('sqParty').state, 'queued', 'acaban dando listo y empieza la busqueda');
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
    say(sq, me, { a: 'play' }); await wait(300); say(sq, foe, { a: 'leave' });
    const duo = human(sq, 'CCCCCCC', 'cat'); say(sq, duo, { a: 'create' });
    const duo2 = human(sq, 'DDDDDDD', 'dan'); say(sq, duo2, { a: 'join', code: duo.last('sqParty').code });
    say(sq, duo, { a: 'play' }); say(sq, duo2, { a: 'ready', v: true });
    await wait(900);
    const match = [...rooms.values()].find(r => !r.squad.practice);
    assert.ok(match, 'se crea la partida 2v2');
    const mine = [...match.clients.values()].filter(c => c.ws.virtualGame);
    assert.equal(mine.length, 1, 'icefox entra en la partida');
    assert.equal(mine[0].team, 'A');
    // juega con la IA de los bots del sim: tras unos ticks su celda tiene un objetivo valido y se mueve
    await wait(2500);
    const id = [...match.clients].find(([, c]) => c.ws.virtualGame)[0], p = match.sim.players.get(id), c = p && p.cells[0];
    if (c) assert.ok(Number.isFinite(c.targetX) && Number.isFinite(c.targetY), 'objetivo de la IA');
});

test('READY ALL: el lider avisa y los amigos de prueba contestan casi al momento', async () => {
    const { sq } = make();
    // ready lento para ver la diferencia
    const sq2 = createSquad({
        rooms: new Map(), resumeTokens: new Map(), PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000, virtualReadyMs: 5000, virtualRivals: false,
        buildSim: () => ({}), welcomeMsg: () => '{}', refillBots: () => {}, broadcast: () => {}, log: () => {},
    });
    const me = human(sq2, 'AAAAAAA', 'ana');
    say(sq2, me, { a: 'fadd', u: 'icefox' }); await wait(600);
    say(sq2, me, { a: 'create' }); say(sq2, me, { a: 'pinvite', id: me.last('sqFriends').friends[0].id }); await wait(900);
    say(sq2, me, { a: 'play' });
    assert.equal(me.last('sqParty').state, 'idle');
    await wait(300);
    assert.equal(me.last('sqParty').state, 'idle', 'con ready lento sigue esperando');
    say(sq2, me, { a: 'remind' });
    await wait(900);
    assert.equal(me.last('sqParty').state, 'queued', 'tras READY ALL contesta enseguida');
});

test('susurrar "lead" a un amigo de prueba: crea el grupo y te invita', async () => {
    const { sq } = make();
    const me = human(sq, 'AAAAAAA', 'ana');
    say(sq, me, { a: 'fadd', u: 'bandit' }); await wait(600);
    const id = me.last('sqFriends').friends[0].id;
    say(sq, me, { a: 'whisper', id, text: 'lead' });
    await wait(1200);
    const inv = me.last('sqInvite');
    assert.ok(inv, 'te llega la invitacion');
    assert.equal(inv.from.u, 'bandit');
    say(sq, me, { a: 'join', code: inv.code });
    assert.equal(me.last('sqParty').members.length, 2);
    assert.equal(me.last('sqParty').leader !== me.last('sqParty').me, true, 'el lider es el bot');
});

test('con bandit en tu grupo, al buscar rival icefox y rcer forman el grupo rival', async () => {
    const { sq, rooms } = make();
    const me = human(sq, 'AAAAAAA', 'ana');
    say(sq, me, { a: 'fadd', u: 'bandit' }); await wait(600);
    say(sq, me, { a: 'create' });
    say(sq, me, { a: 'pinvite', id: me.last('sqFriends').friends[0].id });
    await wait(900);
    say(sq, me, { a: 'play' });
    await wait(9000);
    const p = me.last('sqParty');
    const tk = me.last('sqTicket');
    assert.ok(tk && tk.kind === 'match', 'se encuentra rival: ' + JSON.stringify(p && p.state));
    assert.equal(tk.lineup.B.length + tk.lineup.A.length, 4);
});

test('si tu grupo con un bot abre sala (custom), los otros bots la retan', async () => {
    const { sq } = make();
    const me = human(sq, 'AAAAAAA', 'ana');
    say(sq, me, { a: 'fadd', u: 'icefox' }); await wait(600);
    say(sq, me, { a: 'create' });
    say(sq, me, { a: 'pinvite', id: me.last('sqFriends').friends[0].id });
    await wait(900);
    say(sq, me, { a: 'play', custom: true });
    await wait(9000);
    const tk = me.last('sqTicket');
    assert.ok(tk && tk.kind === 'match', 'la sala abierta recibe reto');
});
