'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchXP, qualifies, MIN_XP } = require('../server/airdrop-jumper.js');

test('reads the solana XP field from the response', async () => {
    const fetch = async url => {
        assert.match(url, /^https:\/\/jumper-jade\.vercel\.app\/api\/wallet\?sol=Wallet1$/);
        return { ok: true, json: async () => ({ solana: { xp: 1234 }, combinedXP: 1234 }) };
    };
    assert.strictEqual(await fetchXP('Wallet1', { fetch }), 1234);
});

test('a non-ok response or a network error fails closed (null, never throws)', async () => {
    assert.strictEqual(await fetchXP('W', { fetch: async () => ({ ok: false }) }), null);
    assert.strictEqual(await fetchXP('W', { fetch: async () => { throw new Error('down'); } }), null);
    assert.strictEqual(await fetchXP('W', { fetch: async () => ({ ok: true, json: async () => ({}) }) }), null);
});

test('qualifies only at or above the XP threshold', () => {
    assert.strictEqual(qualifies(MIN_XP), true);
    assert.strictEqual(qualifies(MIN_XP - 1), false);
    assert.strictEqual(qualifies(null), false);
    assert.strictEqual(qualifies(undefined), false);
});
