'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createArenaPay } = require('../server/arena-pay.js');

function make() {
    const saldo = {}, casa = [];
    const pay = createArenaPay({ credit: (w, n) => { saldo[w] = (saldo[w] || 0) + n; }, treasury: n => casa.push(n), verify: (w, m, s) => s === 'ok' });
    return { pay, saldo, casa };
}

test('el precio del bracket se fija mientras haya alguien y se renueva al vaciarse', () => {
    const { pay } = make();
    let precio = 100;
    assert.equal(pay.feeOf('k', 2, u => u * precio), 200);
    pay.useBracket('k', 1);
    precio = 150;
    assert.equal(pay.feeOf('k', 2, u => u * precio), 200, 'sigue fijado');
    pay.useBracket('k', -1);
    assert.equal(pay.feeOf('k', 2, u => u * precio), 300, 'vacio: precio nuevo');
    assert.equal(pay.feeOf('k', 0, u => u * precio), 0, 'gratis');
});

test('reparto 2v2: el equipo ganador se lo lleva a partes iguales; 10 % de casa por cada comido por un bot', () => {
    const { pay, saldo, casa } = make();
    const r = pay.settle('m1', [
        { team: 'A', wallet: 'a1', fee: 100 }, { team: 'A', wallet: 'a2', fee: 100, byBot: true },
        { team: 'B', wallet: 'b1', fee: 100 }, { team: 'B', wallet: 'b2', fee: 100, byBot: true },
    ], 'A');
    assert.equal(r.pot, 400);
    assert.equal(r.share, 190);
    assert.equal(casa.reduce((a, b) => a + b, 0), 20);
    assert.equal(r.prizes.length, 2);
    assert.equal(saldo.a1, undefined, 'hasta el CLAIM no se abona');
    assert.deepEqual(pay.claim(r.prizes[0].id, 'a1', pay.claimMessage(r.prizes[0].id), 'mal'), { ok: false, reason: 'bad_signature' });
    assert.equal(pay.claim(r.prizes[0].id, 'a1', pay.claimMessage(r.prizes[0].id), 'ok').ok, true);
    assert.equal(saldo.a1, 190);
    assert.equal(pay.claim(r.prizes[0].id, 'a1', pay.claimMessage(r.prizes[0].id), 'ok').reason, 'already_claimed');
});

test('empate: cada uno recupera su entrada; y lo retenido se devuelve si se cancela', () => {
    const { pay, saldo } = make();
    pay.settle('m2', [{ team: 'A', wallet: 'x', fee: 50 }, { team: 'B', wallet: 'y', fee: 50 }], null);
    assert.equal(saldo.x, 50); assert.equal(saldo.y, 50);
    const ref = pay.hold('z', 70);
    assert.equal(pay.refund(ref), 70); assert.equal(saldo.z, 70);
    assert.equal(pay.refund(ref), 0, 'no se devuelve dos veces');
});
