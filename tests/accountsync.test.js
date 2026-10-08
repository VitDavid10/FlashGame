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
