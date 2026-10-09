'use strict';
const test = require('node:test'), assert = require('node:assert');
const sp = require('../server/skinpoints.js');

test('al enlazar X, los SP de la cuenta de wallet pasan a la de X', () => {
    const cid = 'cid_migra_test_1', w = 'WalletMigraTest1', x = 'x_migra_test_1';
    sp.linkCid(cid, 'w_' + w);
    sp.addPoints(cid, 120);
    assert.strictEqual(sp.getPoints(cid), 120);
    assert.ok(sp.migraWallet(x, w));
    sp.linkCid(cid, x);
    assert.strictEqual(sp.getPoints(cid), 120);
    assert.strictEqual(sp._points['w_' + w], undefined);
});
