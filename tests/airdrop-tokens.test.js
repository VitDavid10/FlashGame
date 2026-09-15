'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTokens, AIRDROP_TOKENS, ata } = require('../server/airdrop-tokens.js');
const OWNER = 'DHEPjhYWx6zu2HeaQVWLZ4jnSupB4A8F1t96szedmeq8';   // any valid base58 pubkey

// Fake RPC: `pages` is an array of arrays of {signature, blockTime}, newest page first,
// returned in order as `before` walks backward.
function fakeRpc(pages) {
    const calls = [];
    const call = async (method, params) => {
        calls.push({ method, before: params[1] && params[1].before });
        assert.strictEqual(method, 'getSignaturesForAddress');
        const i = calls.length - 1;
        return pages[i] || [];
    };
    return { call, calls };
}

test('a wallet that never touched the mint does not qualify', async () => {
    const { call } = fakeRpc([[]]);
    const t = createTokens({ call, gapMs: 0 });
    const got = await t.walletAirdrops(OWNER);
    assert.deepStrictEqual(got, []);
});

test('a receipt after the deadline does not qualify, one before it does', async () => {
    let n = 0;
    const call = async (method, params) => {
        n++;
        // First mint (jto): only a signature after its deadline -> no.
        // Second mint (pyth): a signature before its deadline -> yes.
        if (n === 1) return [{ signature: 'a', blockTime: AIRDROP_TOKENS[0].deadline + 86400 }];
        if (n === 2) return [{ signature: 'b', blockTime: AIRDROP_TOKENS[1].deadline - 86400 }];
        return [];
    };
    const t = createTokens({ call, gapMs: 0 });
    const got = await t.walletAirdrops(OWNER);
    assert.strictEqual(got.includes(AIRDROP_TOKENS[0].id), false);
    assert.strictEqual(got.includes(AIRDROP_TOKENS[1].id), true);
});

test('walks back through pages looking for an old enough signature', async () => {
    const deadline = AIRDROP_TOKENS[0].deadline;
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ signature: 'p1-' + i, blockTime: deadline + 1000 - i }));
    const page2 = [{ signature: 'p2-0', blockTime: deadline - 10 }];
    let n = 0;
    const call = async () => {
        n++;
        if (n === 1) return page1;
        if (n === 2) return page2;
        return [];
    };
    const t = createTokens({ call, gapMs: 0 });
    const got = await t.walletAirdrops(OWNER);
    assert.strictEqual(got.includes(AIRDROP_TOKENS[0].id), true);
});

test('ata derives a stable, valid base58 address', () => {
    const a = ata(OWNER, AIRDROP_TOKENS[0].mint);
    assert.match(a, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.strictEqual(a, ata(OWNER, AIRDROP_TOKENS[0].mint));
});
