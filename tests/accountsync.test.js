'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { create } = require('../server/accountsync.js');
const day = '2026-10-09';
test('la foto mas reciente gana y las misiones se juntan entre dispositivos', () => {
    const s = create({ file: null, now: () => 1000 });
    s.put('a', { avatar: JSON.stringify({ t: 'pill' }), at: 500, aq: { day, pins: ['e-kill1'], prog: { 'e-kill1': 1 }, done: {}, claimed: {}, pt: 5 } });
    const r = s.put('a', { avatar: JSON.stringify({ t: 'ghost' }), at: 300, aq: { day, pins: ['m-kill3'], prog: { 'e-kill1': 0, 'm-kill3': 2 }, done: { 'e-pieces5': 1 }, claimed: {}, pt: 9 } });
    assert.strictEqual(JSON.parse(r.avatar).t, 'pill');
    assert.deepStrictEqual(r.aq.prog, { 'e-kill1': 1, 'm-kill3': 2 });
    assert.deepStrictEqual(r.aq.pins, ['m-kill3']);
    assert.ok(r.aq.done['e-pieces5']);
});
test('sin cuenta no guarda nada y un dia nuevo sustituye al viejo', () => {
    const s = create({ file: null, now: () => 1000 });
    assert.strictEqual(s.put(null, { at: 1 }), null);
    s.put('b', { aq: { day: '2026-10-08', pins: [], prog: { 'e-kill1': 1 }, done: {}, claimed: {}, pt: 1 } });
    const r = s.put('b', { aq: { day, pins: [], prog: {}, done: {}, claimed: {}, pt: 2 } });
    assert.strictEqual(r.aq.day, day);
    assert.deepStrictEqual(r.aq.prog, {});
});
test('ajustes: gana el mas reciente por clave; rejoin se guarda, caduca y se borra', () => {
    let t = 1000; const s = create({ file: null, now: () => t });
    s.put('c', { prefs: { pw_nicks: { v: '{"a":"x"}', t: 10 }, pw_wmute: { v: '{"all":true,"ids":{}}', t: 50 } } });
    const r = s.put('c', { prefs: { pw_nicks: { v: '{}', t: 5 }, pw_wmute: { v: '{"all":false,"ids":{}}', t: 60 }, otra: { v: 'x', t: 99 } } });
    assert.strictEqual(r.prefs.pw_nicks.v, '{"a":"x"}');
    assert.strictEqual(r.prefs.pw_wmute.v, '{"all":false,"ids":{}}');
    assert.strictEqual(r.prefs.otra, undefined);
    const rj = { token: 'abcdef123456', url: 'wss://pillwars.fun/h0/', mode: 'arcade', room: 'Free', roomName: 'x', expiresAt: 5000 };
    assert.ok(s.put('c', { resume: rj, rt: 100 }).resume);
    assert.strictEqual(s.put('c', { resume: Object.assign({}, rj, { url: 'javascript:alert(1)' }), rt: 200 }).resume.url, rj.url);
    t = 6000; assert.strictEqual(s.get('c').resume, null);
    t = 1000; assert.ok(s.get('c').resume);
    assert.strictEqual(s.put('c', { resumeClear: true, rt: 50 }).resume !== null, true);
    assert.strictEqual(s.put('c', { resumeClear: true, rt: 300 }).resume, null);
});
