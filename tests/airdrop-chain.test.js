'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createChain, PAGE, MAX_PAGES } = require('../server/airdrop-chain.js');
const { createStore } = require('../server/airdrop-store.js');

// Fake RPC with `n` signatures, newest first; every 7th failed.
function fakeRpc(n, opts = {}) {
    const sigs = Array.from({ length: n }, (_, i) => ({ signature: 's' + i, blockTime: 2000000000 - i * 60, err: i % 7 === 6 ? { x: 1 } : null }));
    let throttled = opts.throttle || 0;
    const calls = [];
    const fetch = async (url, init) => {
        const { method, params } = JSON.parse(init.body);
        calls.push(method);
        if (throttled-- > 0) return { status: 429, json: async () => ({}) };
        const start = params[1].before ? sigs.findIndex(s => s.signature === params[1].before) + 1 : 0;
        return { status: 200, json: async () => ({ result: sigs.slice(start, start + params[1].limit) }) };
    };
    return { fetch, calls, sigs };
}

test('counts successful transactions across pages and finds the first one', async () => {
    const f = fakeRpc(2500);
    const c = createChain({ rpc: 'x', fetch: f.fetch, pageGapMs: 0 });
    const st = await c.walletStats('W');
    assert.strictEqual(st.txs, 2500 - Math.floor(2500 / 7));
    assert.strictEqual(st.firstAt, f.sigs[2499].blockTime);
    assert.strictEqual(st.capped, false);
    assert.strictEqual(f.calls.length, 3);
});

test('a brand new wallet has no transactions and no age', async () => {
    const c = createChain({ rpc: 'x', fetch: fakeRpc(0).fetch, pageGapMs: 0 });
    assert.deepStrictEqual((({ txs, firstAt, capped }) => ({ txs, firstAt, capped }))(await c.walletStats('W')), { txs: 0, firstAt: null, capped: false });
});

test('stops at the page cap and says so', async () => {
    const f = fakeRpc(PAGE * MAX_PAGES + 10);
    const c = createChain({ rpc: 'x', fetch: f.fetch, pageGapMs: 0 });
    const st = await c.walletStats('W');
    assert.strictEqual(st.capped, true);
    assert.strictEqual(f.calls.length, MAX_PAGES);
});

test('the page only sees the history of the wallet currently linked', () => {
    const s = createStore({});
    const W1 = 'Wallet' + '1'.padStart(38, '0'), W2 = 'Wallet' + '2'.padStart(38, '0');
    const a = s.linkWallet(null, W1, '');
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).chain, null);
    s.setChain(W1, { txs: 42, firstAt: 1700000000, capped: false, checkedAt: 1 });
    assert.deepStrictEqual(s.publicView(s.sessionUser(a.token)).chain, { txs: 42, firstAt: 1700000000, capped: false });
    s.unlink(a.token, 'wallet');
    s.linkWallet(a.token, W2, '');
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).chain, null);
});
