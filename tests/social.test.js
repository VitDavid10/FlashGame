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
    say(sq, a, { a: 'create', name: 'ignorado' });
    assert.equal(a.last('sqParty').members[0].name, '@ana', 'con X se usa su usuario, no el nombre escrito');
    assert.equal(a.last('sqFriends').friends[0].st, 'on');
    say(sq, a, { a: 'pinvite', id: 'BBBBBBB' });
    const inv = b.last('sqInvite');
    assert.equal(inv.from.u, 'ana');
    say(sq, b, { a: 'join', code: inv.code, name: 'x' });
    assert.equal(b.last('sqParty').members.length, 2);
    assert.equal(b.last('sqParty').members[1].pic, 'https://pbs.twimg.com/profile_images/bob.png');
    // la presencia del grupo se ve
    assert.deepEqual(a.last('sqPresence'), { t: 'sqPresence', id: 'BBBBBBB', st: 'party' });
    // con 3 el grupo esta lleno: ya no se puede invitar a mas
    const c = user(sq, 'CCCCCCC', 'cat'), d = user(sq, 'DDDDDDD', 'dan');
    for (const x of [c, d]) { say(sq, a, { a: 'fadd', u: x === c ? 'cat' : 'dan' }); say(sq, x, { a: 'faccept', id: 'AAAAAAA' }); }
    say(sq, a, { a: 'pinvite', id: 'CCCCCCC' });
    say(sq, c, { a: 'join', code: c.last('sqInvite').code });
    say(sq, a, { a: 'pinvite', id: 'DDDDDDD' });
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

test('sala custom: se publica con quien la creo, otro grupo la une y empieza la partida', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob'), spectator = fakeWs();
    say(sq, a, { a: 'create' });
    say(sq, a, { a: 'play', custom: true });
    assert.equal(a.last('sqTicket'), null, 'esperar rival no mete en ninguna partida');
    say(sq, spectator, { a: 'rooms' });
    const list = spectator.last('sqRooms').rooms;
    assert.equal(list.length, 1);
    assert.equal(list[0].size, 1);
    assert.equal(list[0].leader.name, '@ana');
    assert.equal(list[0].leader.pic, 'https://pbs.twimg.com/profile_images/ana.png');
    assert.equal(sq._internals.queues[1].length, 0, 'no entra en la cola automatica');
    say(sq, b, { a: 'create' });
    say(sq, b, { a: 'challenge', code: list[0].code });
    assert.equal(a.last('sqTicket').kind, 'match');
    assert.equal(a.last('sqTicket').team, 'A');
    assert.equal(b.last('sqTicket').kind, 'match');
    assert.equal(b.last('sqTicket').team, 'B');
    say(sq, spectator, { a: 'rooms' });
    assert.equal(spectator.last('sqRooms').rooms.length, 0, 'la sala ya no esta libre');
});

test('retos: tamano distinto o sala inexistente se rechazan', () => {
    const sq = make();
    const a = fakeWs(), a2 = fakeWs(), b = fakeWs();
    say(sq, a, { a: 'create', name: 'A' });
    const codeA = a.last('sqParty').code;
    say(sq, a2, { a: 'join', code: codeA, name: 'A2' });
    say(sq, a, { a: 'play', custom: true }); say(sq, a2, { a: 'ready', v: true });          // sala de 2
    say(sq, b, { a: 'create', name: 'B' });            // grupo de 1
    say(sq, b, { a: 'challenge', code: codeA });
    assert.equal(b.last('sqErr').reason, 'size_mismatch');
    say(sq, b, { a: 'challenge', code: 'NOPE1' });
    assert.equal(b.last('sqErr').reason, 'room_gone');
    say(sq, a, { a: 'challenge', code: codeA });
    assert.equal(a.last('sqErr').reason, 'party_busy', 'no te puedes retar a ti mismo mientras esperas');
});

test('cancelar una sala custom la saca de la lista', () => {
    const sq = make(), a = fakeWs(), v = fakeWs();
    say(sq, a, { a: 'create', name: 'A' }); say(sq, a, { a: 'play', custom: true });
    say(sq, a, { a: 'cancel' });
    say(sq, v, { a: 'rooms' });
    assert.equal(v.last('sqRooms').rooms.length, 0);
    assert.equal(a.last('sqParty').state, 'idle');
});

test('identidad con solo wallet: nombre = resumen de la wallet y te encuentran por la direccion', () => {
    const sq = make();
    const WALLET = 'AjGQ7kVxYh2sT9bC3dE4fG5hJ6kLmNpQrStUvWqX6k';
    const w = fakeWs();
    say(sq, w, { a: 'hello', token: token.sign({ id: 'WALLET1', u: '', n: 'AjGQ...qX6k', p: '', w: WALLET }) });
    const x = user(sq, 'XXXXXXX', 'xavi');
    say(sq, x, { a: 'fadd', u: WALLET });
    assert.equal(w.last('sqFriendReq').from.u, 'xavi');
    say(sq, w, { a: 'faccept', id: 'XXXXXXX' });
    const row = x.last('sqFriends').friends[0];
    assert.equal(row.n, 'AjGQ...qX6k');
    assert.equal(row.u, '');
    assert.equal(JSON.stringify(x.out).includes(WALLET), false, 'la wallet no se difunde a los demas');
    // y en un grupo se le ve con ese resumen
    say(sq, w, { a: 'create' });
    assert.equal(w.last('sqParty').members[0].name, 'AjGQ...qX6k');
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

test('tambien se agrega por codigo de amigo, con cualquier mayuscula', () => {
    const sq = make();
    const a = user(sq, 'abcd234', 'ana'), b = user(sq, 'wxyz567', 'bob');
    say(sq, a, { a: 'fadd', u: 'WXYZ567' });
    assert.equal(b.last('sqFriendReq').from.u, 'ana');
    say(sq, b, { a: 'faccept', id: 'abcd234' });
    assert.equal(a.last('sqFriends').friends[0].u, 'bob');
});

test('el avatar del menu viaja con el hello, se sanea y lo ven amigos y grupo', () => {
    const sq = make();
    const a = fakeWs(), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'hello', token: token.sign({ id: 'AAAAAAA', u: '', n: 'AjGQ...qX6k', p: '' }), av: { t: 'spook', bg: '#ab9ff2', top: 'javascript:alert(1)', skin: '../etc/passwd' } });
    say(sq, b, { a: 'fadd', id: 'AAAAAAA' }); say(sq, a, { a: 'faccept', id: 'BBBBBBB' });
    const f = b.last('sqFriends').friends[0];
    assert.deepEqual(f.av, { t: 'spook', bg: '#ab9ff2' }, 'solo valores simples');
    say(sq, a, { a: 'create' });
    assert.deepEqual(a.last('sqParty').members[0].av, { t: 'spook', bg: '#ab9ff2' });
    say(sq, a, { a: 'hello', token: token.sign({ id: 'AAAAAAA', u: '', n: 'AjGQ...qX6k', p: '' }), av: { t: 'junk' } });
    assert.deepEqual(b.last('sqFriends').friends[0].av, { t: 'spook', bg: '#ab9ff2' }, 'un avatar invalido no borra el bueno');
});

test('gente del airdrop que aun no ha abierto Arenas se encuentra por @usuario o codigo, y la peticion espera', () => {
    const rooms = new Map();
    const lista = { zed: { id: 'zed2345', u: 'zed', n: 'Zed', p: 'https://pbs.twimg.com/profile_images/9/zed.png', w: '' }, zed2345: null };
    lista.zed2345 = lista.zed;
    const sq = createSquad({
        rooms, resumeTokens: new Map(), PillSim, MATCH_MS: 230000, SPAWN_IMMUNE_MS: 3000, virtualFriends: false,
        buildSim: () => ({}), welcomeMsg: () => '{}', refillBots: () => {}, broadcast: () => {}, log: () => {},
        directory: q => lista[String(q).replace(/^@/, '').toLowerCase()] || null,
    });
    const a = user(sq, 'AAAAAAA', 'ana');
    say(sq, a, { a: 'fadd', u: '@Zed' });
    assert.equal(a.last('sqErr'), null, 'se encuentra aunque no haya abierto Arenas');
    assert.equal(a.last('sqFriends').outReq[0].u, 'zed');
    // cuando zed entra por fin, ve la peticion y puede aceptarla
    const z = fakeWs();
    say(sq, z, { a: 'hello', token: token.sign({ id: 'zed2345', u: 'zed', n: 'Zed', p: '' }) });
    assert.equal(z.last('sqFriends').inReq[0].u, 'ana');
    say(sq, z, { a: 'faccept', id: 'AAAAAAA' });
    assert.equal(a.last('sqFriends').friends[0].u, 'zed');
    // por codigo tambien, y una foto que no es de X se descarta
    const b = user(sq, 'BBBBBBB', 'bob');
    say(sq, b, { a: 'fadd', u: 'ZED2345' });
    assert.equal(b.last('sqFriends').outReq.length, 1);
    lista.mal = { id: 'mal1111', u: 'mal', n: 'Mal', p: 'https://evil.example/x.png', w: '' };
    say(sq, b, { a: 'fadd', u: 'mal' });
    assert.equal(b.last('sqFriends').outReq.find(r => r.u === 'mal').p, '');
});

test('se puede invitar mientras el grupo busca: si aceptan, la busqueda se cancela', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'fadd', u: 'bob' }); say(sq, b, { a: 'faccept', id: 'AAAAAAA' });
    say(sq, a, { a: 'create' });
    say(sq, a, { a: 'play' });
    assert.equal(a.last('sqParty').state, 'queued');
    say(sq, a, { a: 'pinvite', id: 'BBBBBBB' });
    assert.equal(a.last('sqErr'), null, 'invitar buscando esta permitido');
    const inv = b.last('sqInvite');
    assert.ok(inv);
    say(sq, b, { a: 'join', code: inv.code });
    assert.equal(a.last('sqParty').state, 'idle', 'la busqueda se cancela');
    assert.equal(a.last('sqParty').members.length, 2);
    assert.equal(sq._internals.queues[1].length, 0);
    // en plena partida no
    const c = user(sq, 'CCCCCCC', 'cat'); say(sq, c, { a: 'create' });
    const d = user(sq, 'DDDDDDD', 'dan'); say(sq, d, { a: 'create' });
    say(sq, c, { a: 'play' }); say(sq, d, { a: 'play' });
    say(sq, c, { a: 'fadd', u: 'ana' }); say(sq, a, { a: 'faccept', id: 'CCCCCCC' });
    say(sq, c, { a: 'pinvite', id: 'AAAAAAA' });
    assert.equal(c.last('sqErr').reason, 'party_busy');
});

test('en el mapa sale el nombre de THE PILL (o ninguno); en grupos y amigos, el @ de X o el resumen de wallet', () => {
    const sq = make();
    // Entra a una practica en solitario y devuelve el nombre que lleva la pildora.
    const juega = ws => {
        say(sq, ws, { a: 'create' }); say(sq, ws, { a: 'play' }); say(sq, ws, { a: 'practice' });
        const r = sq.join(fakeWs(), 'x', { t: 'join', squad: ws.last('sqTicket').ticket });
        say(sq, ws, { a: 'leave' });
        return r.room.sim.players.get(r.playerId).name;
    };
    const a = fakeWs(), tk = token.sign({ id: 'AAAAAAA', u: '', n: 'AjGQ...qX6k', p: '' });
    say(sq, a, { a: 'hello', token: tk, name: 'Pillwars<b>', av: { t: 'npc', bg: '#8a948f' } });
    say(sq, a, { a: 'create' });
    assert.equal(a.last('sqParty').members[0].name, 'AjGQ...qX6k', 'en el grupo: el resumen de la wallet');
    say(sq, a, { a: 'leave' });
    assert.equal(juega(a), 'Pillwarsb', 'en el mapa: el nombre elegido, saneado');
    // cambio de nombre con el grupo abierto
    say(sq, a, { a: 'create' });
    say(sq, a, { a: 'hello', token: tk, name: 'David', av: { t: 'spook', bg: '#ab9ff2' } });
    assert.equal(a.last('sqParty').members[0].av.t, 'spook');
    say(sq, a, { a: 'leave' });
    assert.equal(juega(a), 'David');
    // con @ de X: en el grupo el @, en el mapa lo que puso
    const x = fakeWs();
    say(sq, x, { a: 'hello', token: token.sign({ id: 'XXXXXXX', u: 'xavi', n: 'Xavi', p: '' }), name: 'Otro' });
    say(sq, x, { a: 'create' });
    assert.equal(x.last('sqParty').members[0].name, '@xavi');
    say(sq, x, { a: 'leave' });
    assert.equal(juega(x), 'Otro');
    // sin nombre elegido: ninguno sobre la pildora (el @ solo sale en amigos y grupos)
    const y = fakeWs();
    say(sq, y, { a: 'hello', token: token.sign({ id: 'YYYYYYY', u: 'yago', n: 'Yago', p: '' }), name: 'PLAYER' });
    say(sq, y, { a: 'create' });
    assert.equal(y.last('sqParty').members[0].name, '@yago');
    say(sq, y, { a: 'leave' });
    assert.equal(juega(y), '', 'sin nombre elegido, ningun nombre en el mapa');
});

test('las posiciones de companeros llegan solo a los del mismo equipo y no a los virtuales', () => {
    const sq = make();
    const a = user(sq, 'AAAAAAA', 'ana'), b = user(sq, 'BBBBBBB', 'bob');
    say(sq, a, { a: 'create' }); say(sq, b, { a: 'join', code: a.last('sqParty').code });
    say(sq, a, { a: 'play' }); say(sq, b, { a: 'ready', v: true });
    const wa = fakeWs(), wb = fakeWs();
    say(sq, a, { a: 'practice' }); say(sq, b, { a: 'practice' });
    const ra = sq.join(wa, 'x', { t: 'join', squad: a.last('sqTicket').ticket }), rb = sq.join(wb, 'x', { t: 'join', squad: b.last('sqTicket').ticket });
    const room = ra.room;
    for (const r of [ra, rb]) { room.clients.get(r.playerId)._spawned = true; room.sim.spawnPlayer(r.playerId, 0); }
    room.state = 'playing'; room.endsAt = Date.now() + 100000; room.tickCount = 10;
    wa.bufferedAmount = 0; wb.bufferedAmount = 0;
    sq.tick(room, Date.now());
    const m = wa.last('squadAllies');
    assert.equal(m.a.length, 1, 'ana ve a bob, no a si misma');
    assert.equal(typeof m.a[0].x, 'number');
    assert.equal(wb.last('squadAllies').a.length, 1);
});
