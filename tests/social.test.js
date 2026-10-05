'use strict';
const test = require('node:test');
const assert = require('node:assert');
const PillSim = require('../shared/sim.js');
const token = require('../server/social-token.js');
const { createSquad } = require('../server/squad.js');

function fakeWs() {
    return { readyState: 1, out: [], send(d) { this.out.push(typeof d === 'string' ? JSON.parse(d) : d); }, close() { this.readyState = 3; },
        last(t) { for (let i = this.out.length - 1; i >= 0; i--) if (this.out[i].t === t) return this.out[i]; return null; },
        all(t) { return this.out.filter(o => o.t === t); } };
}
function make() {
    const rooms = new Map();
    return createSquad({
        rooms, resumeTokens: new Map(), PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000,
        buildSim: (mode) => { const s = new PillSim.Simulation({ mode, mapSize: 3000, worldSettings: { map: 1, food: 1, virus: 1, speed: 1 }, botConfig: { enabled: false, count: 0, respawn: false }, fx: { enabled: false } }); s.populate(); return s; },
        welcomeMsg: () => '{}', refillBots: () => {}, broadcast: () => {}, log: () => {},
    });
}
// Conexion identificada con una cuenta de X ficticia.
function user(sq, id, u) {
    const ws = fakeWs();
    sq.handle(ws, { t: 'sq', a: 'hello', token: token.sign({ id, u, n: u.toUpperCase(), p: 'https://pbs.twimg.com/profile_images/' + u + '.png' }) });
    return ws;
}
const say = (sq, ws, o) => sq.handle(ws, Object.assign({ t: 'sq' }, o));

test('la ficha firmada se verifica y una manipulada o caducada no', () => {
    const t = token.sign({ id: 'ABC1234', u: 'david', n: 'David', p: '' });
    assert.equal(token.verify(t).u, 'david');
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ id: 'OTRO', u: 'david', exp: Date.now() + 1e6 })).toString('base64url') + '.' + sig;
    assert.equal(token.verify(forged), null);
    assert.equal(token.verify(t, Date.now() + 13 * 3600 * 1000), null);
    assert.equal(token.verify('basura'), null);
    assert.equal(token.verify(body), null);
});

test('la foto de la ficha solo puede ser de X', () => {
    assert.equal(token.verify(token.sign({ id: 'A', u: 'a', n: 'A', p: 'https://evil.example/x.png' })).p, '');
    assert.equal(token.verify(token.sign({ id: 'A', u: 'a', n: 'A', p: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' })).p, 'https://pbs.twimg.com/profile_images/1/a_normal.jpg');
});

test('hello con ficha mala es rechazado y sin identidad no hay amigos', () => {
    const sq = make(), ws = fakeWs();
    say(sq, ws, { a: 'hello', token: 'nope' });
    assert.equal(ws.last('sqErr').reason, 'bad_token');
    say(sq, ws, { a: 'fadd', u: 'x' });
    assert.equal(ws.last('sqErr').reason, 'need_x');
});

test('peticion de amistad: se acepta y los dos se ven con presencia', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'fadd', u: '@Bob' });
    assert.equal(b.last('sqFriendReq').from.u, 'ana');
    assert.equal(b.last('sqFriends').inReq.length, 1);
    say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    assert.equal(a.last('sqFriends').friends[0].u, 'bob');
    assert.equal(a.last('sqFriends').friends[0].st, 'on');
    assert.equal(b.last('sqFriends').friends[0].u, 'ana');
    // si se va, el otro lo ve
    sq.onClose(b);
    assert.deepEqual(a.last('sqPresence'), { t: 'sqPresence', id: 'BBBBBBB', st: 'off' });
});

test('si los dos se piden amistad a la vez, quedan amigos sin pasos extra', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'fadd', u: 'bob' });
    say(sq, b, { a: 'fadd', u: 'ana' });
    assert.equal(a.last('sqFriends').friends.length, 1);
    assert.equal(b.last('sqFriends').friends.length, 1);
});

test('no te puedes agregar a ti, ni a quien no existe, ni dos veces', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'); user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'fadd', u: 'ana' }); assert.equal(a.last('sqErr').reason, 'self');
    say(sq, a, { a: 'fadd', u: 'nadie' }); assert.equal(a.last('sqErr').reason, 'no_such_user');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, a, { a: 'fadd', u: 'bob' });
    assert.equal(a.last('sqErr').reason, 'already_requested');
});

test('amigos: borrar quita a los dos y rechazar limpia la peticion', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob'), c = user(sq, 'CCCCCCC', 'cat');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    say(sq, c, { a: 'fadd', u: 'ana' }); say(sq, a, { a: 'fdecline', id: 'CCCCCCC' });
    assert.equal(a.last('sqFriends').inReq.length, 0);
    assert.equal(c.last('sqFriends').outReq.length, 0);
    say(sq, a, { a: 'fremove', id: 'BBBBBBB' });
    assert.equal(a.last('sqFriends').friends.length, 0);
    assert.equal(b.last('sqFriends').friends.length, 0);
});

test('susurros: solo entre amigos, llegan a ambos lados y se limpian', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob'), c = user(sq, 'CCCCCCC', 'cat');
    say(sq, a, { a: 'whisper', id: 'BBBBBBB', text: 'hola' });
    assert.equal(a.last('sqErr').reason, 'not_friends');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    say(sq, a, { a: 'whisper', id: 'BBBBBBB', text: '  hola\u0007 que tal  ' });
    assert.equal(b.last('sqWhisper').text, 'hola  que tal');
    assert.equal(b.last('sqWhisper').from.u, 'ana');
    assert.equal(a.last('sqWhisper').mine, true);
    assert.equal(c.last('sqWhisper'), null, 'un tercero no lo ve');
    sq.onClose(b);
    say(sq, a, { a: 'whisper', id: 'BBBBBBB', text: 'sigues?' });
    assert.equal(a.last('sqErr').reason, 'offline');
});

test('susurros: limite por minuto', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    for (let i = 0; i < 25; i++) say(sq, a, { a: 'whisper', id: 'BBBBBBB', text: 'x' + i });
    assert.equal(b.all('sqWhisper').length, 20);
    assert.equal(a.last('sqErr').reason, 'slow_down');
});

test('invitar a un amigo al grupo: llega con el codigo y se une con el nombre de X', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    say(sq, a, { a: 'create', name: 'ignorado', size: 2 });
    assert.equal(a.last('sqParty').members[0].name, '@ana', 'con X se usa su usuario, no el nombre escrito');
    assert.equal(a.last('sqFriends').friends[0].st, 'on');
    say(sq, a, { a: 'pinvite', id: 'BBBBBBB' });
    const inv = b.last('sqInvite');
    assert.equal(inv.from.u, 'ana');
    assert.equal(inv.size, 2);
    say(sq, b, { a: 'join', code: inv.code, name: 'x' });
    assert.equal(b.last('sqParty').members.length, 2);
    assert.equal(b.last('sqParty').members[1].pic, 'https://pbs.twimg.com/profile_images/bob.png');
    // la presencia del grupo se ve
    assert.deepEqual(a.last('sqPresence'), { t: 'sqPresence', id: 'BBBBBBB', st: 'party' });
    // grupo lleno: ya no se puede invitar a mas
    const c = user(sq, 'CCCCCCC', 'cat');
    say(sq, a, { a: 'fadd', u: 'cat' }); say(sq, c, { a: 'faccept', id: 'AAAAAAA' });
    say(sq, a, { a: 'pinvite', id: 'CCCCCCC' });
    assert.equal(a.last('sqErr').reason, 'party_full');
});

test('no se puede invitar a quien no es amigo ni sin grupo abierto', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'pinvite', id: 'BBBBBBB' });
    assert.equal(a.last('sqErr').reason, 'not_friends');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    say(sq, a, { a: 'pinvite', id: 'BBBBBBB' });
    assert.equal(a.last('sqErr').reason, 'no_open_party');
});

test('sala custom: se publica con quien la creo, otro grupo la reta y empieza la partida', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob'), spectator = fakeWs();
    say(sq, a, { a: 'create', size: 1 });
    say(sq, a, { a: 'play', custom: true });
    assert.equal(a.last('sqTicket').kind, 'practice', 'mientras espera practica contra bots');
    say(sq, spectator, { a: 'rooms' });
    const list = spectator.last('sqRooms').rooms;
    assert.equal(list.length, 1);
    assert.equal(list[0].leader.name, '@ana');
    assert.equal(list[0].leader.pic, 'https://pbs.twimg.com/profile_images/ana.png');
    assert.equal(sq._internals.queues[1].length, 0, 'no entra en la cola automatica');
    say(sq, b, { a: 'create', size: 1 });
    say(sq, b, { a: 'challenge', code: list[0].code });
    assert.equal(a.last('sqTicket').kind, 'match');
    assert.equal(a.last('sqTicket').team, 'A');
    assert.equal(b.last('sqTicket').kind, 'match');
    assert.equal(b.last('sqTicket').team, 'B');
    say(sq, spectator, { a: 'rooms' });
    assert.equal(spectator.last('sqRooms').rooms.length, 0, 'la sala ya no esta libre');
});

test('retos: tamano distinto, grupo incompleto o sala inexistente se rechazan', () => {
    const sq = make();
    const a = fakeWs(), b = fakeWs(), c = fakeWs();
    say(sq, a, { a: 'create', name: 'A', size: 2 }); say(sq, a, { a: 'join', code: 'ZZZZZ' });
    const codeA = a.last('sqParty').code;
    const a2 = fakeWs(); say(sq, a2, { a: 'join', code: codeA, name: 'A2' }); say(sq, a2, { a: 'ready', v: true });
    say(sq, a, { a: 'play', custom: true });
    say(sq, b, { a: 'create', name: 'B', size: 1 });
    say(sq, b, { a: 'challenge', code: codeA });
    assert.equal(b.last('sqErr').reason, 'wrong_size');
    say(sq, c, { a: 'create', name: 'C', size: 2 });
    say(sq, c, { a: 'challenge', code: codeA });
    assert.equal(c.last('sqErr').reason, 'need_full_party');
    say(sq, c, { a: 'challenge', code: 'NOPE1' });
    assert.equal(c.last('sqErr').reason, 'room_gone');
});

test('cancelar una sala custom la saca de la lista', () => {
    const sq = make(), a = fakeWs(), v = fakeWs();
    say(sq, a, { a: 'create', name: 'A', size: 1 }); say(sq, a, { a: 'play', custom: true });
    say(sq, a, { a: 'cancel' });
    say(sq, v, { a: 'rooms' });
    assert.equal(v.last('sqRooms').rooms.length, 0);
    assert.equal(a.last('sqParty').state, 'idle');
});

test('las amistades se guardan en disco y se recuperan', () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-')), file = path.join(dir, 'social.json');
    const { createSocial } = require('../server/social.js');
    const s1 = createSocial({ file, partyInfoOf: () => null });
    const a = fakeWs(), b = fakeWs();
    s1.hello(a, token.sign({ id: 'AAAAAAA', u: 'ana', n: 'Ana', p: '' }));
    s1.hello(b, token.sign({ id: 'BBBBBBB', u: 'bob', n: 'Bob', p: '' }));
    s1.handle(a, { a: 'fadd', u: 'bob' }); s1.handle(b, { a: 'faccept', id: 'AAAAAAA' });
    s1.flush();
    const s2 = createSocial({ file, partyInfoOf: () => null });
    const c = fakeWs();
    s2.hello(c, token.sign({ id: 'AAAAAAA', u: 'ana', n: 'Ana', p: '' }));
    assert.equal(c.last('sqFriends').friends[0].u, 'bob');
    assert.equal(c.last('sqFriends').friends[0].st, 'off');
    fs.rmSync(dir, { recursive: true, force: true });
});
