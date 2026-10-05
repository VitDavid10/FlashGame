'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const aq = require('../server/appquests.js');

function make(day = '2026-10-06') {
    const pts = {}; let d = day;
    const q = aq.create({ file: null, now: () => new Date(d + 'T12:00:00Z'), addPoints: (cid, n) => (pts[cid] = (pts[cid] || 0) + n) });
    return { q, pts, setDay: x => { d = x; } };
}

test('cada dia hay 9 misiones distintas y siempre las mismas para ese dia', () => {
    const a = aq.missionsOf('2026-10-06'), b = aq.missionsOf('2026-10-06'), c = aq.missionsOf('2026-10-07');
    assert.equal(a.length, 9);
    assert.equal(new Set(a.map(m => m.id)).size, 9);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.map(m => m.id), c.map(m => m.id));
});

test('el servidor y el menu de la app sortean las MISMAS misiones (el pool no se desincroniza)', () => {
    const hub = fs.readFileSync(path.join(__dirname, '..', 'game', 'app-hub.js'), 'utf8');
    const bloque = hub.slice(hub.indexOf('const QP = ['), hub.indexOf('function qRng'));
    const tiers = [...bloque.matchAll(/tier: '([A-Z]+)', pts: \d+, q: \[(.*?)\]\s*\}/gs)].map(m => ({
        tier: m[1], q: [...m[2].matchAll(/\['([a-z0-9-]+)', '[^']*', (\d+), '[dm]'/g)].map(x => [x[1], +x[2]]),
    }));
    assert.equal(tiers.length, aq.POOL.length);
    assert.deepEqual(tiers, aq.POOL.map(p => ({ tier: p.tier, q: p.q })));
    const sp = hub.match(/const SP_TIER = (\{[^}]*\})/)[1].replace(/(\w+):/g, '"$1":');
    assert.deepEqual(JSON.parse(sp), aq.SP_TIER);
    const orden = hub.match(/const ORDEN_TIER = (\[[^\]]*\])/)[1].replace(/'/g, '"');
    assert.deepEqual(JSON.parse(orden).length, 9);
});

test('cobrar: solo misiones de hoy, una vez cada una, maximo 3 al dia y con cuenta', () => {
    const { q, pts, setDay } = make();
    const hoy = aq.missionsOf('2026-10-06');
    assert.equal(q.claim(null, 'cid1', hoy[0].id).error, 'no_account');
    assert.equal(q.claim('x_1', 'cid1', 'no-existe').error, 'not_today');
    const r = q.claim('x_1', 'cid1', hoy[0].id);
    assert.equal(r.ok, true);
    assert.equal(pts.cid1, hoy[0].sp);
    assert.equal(q.claim('x_1', 'cid1', hoy[0].id).already, true, 'repetir no paga otra vez');
    assert.equal(pts.cid1, hoy[0].sp);
    q.claim('x_1', 'cid1', hoy[1].id); q.claim('x_1', 'cid1', hoy[2].id);
    assert.equal(q.claim('x_1', 'cid1', hoy[3].id).error, 'limit', 'el cuarto del dia no');
    // otra cuenta tiene su propio tope
    assert.equal(q.claim('x_2', 'cid2', hoy[3].id).ok, true);
    // al dia siguiente se reinicia
    setDay('2026-10-07');
    const manana = aq.missionsOf('2026-10-07');
    assert.equal(q.claim('x_1', 'cid1', manana[0].id).ok, true);
    assert.equal(q.claim('x_1', 'cid1', hoy[3].id).error, 'not_today' , 'las de ayer ya no valen');
});
