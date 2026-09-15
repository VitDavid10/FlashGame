'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createChain, PAGE, MAX_PAGES } = require('../server/airdrop-chain.js');
const { createStore } = require('../server/airdrop-store.js');
const { parseMetadata, isSeekerMint, SGT } = require('../server/airdrop-nfts.js');
const { PublicKey } = require('@solana/web3.js');
const COLLECTIONS_SAGA = '46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC';

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
    const c = createChain({ rpc: 'x', fetch: f.fetch, pageGapMs: 0, nfts: false });
    const st = await c.walletStats('W');
    assert.strictEqual(st.txs, 2500 - Math.floor(2500 / 7));
    assert.strictEqual(st.firstAt, f.sigs[2499].blockTime);
    assert.strictEqual(st.capped, false);
    assert.strictEqual(f.calls.length, 3);
});

test('a brand new wallet has no transactions and no age', async () => {
    const c = createChain({ rpc: 'x', fetch: fakeRpc(0).fetch, pageGapMs: 0, nfts: false });
    assert.deepStrictEqual((({ txs, firstAt, capped }) => ({ txs, firstAt, capped }))(await c.walletStats('W')), { txs: 0, firstAt: null, capped: false });
});

test('stops at the page cap and says so', async () => {
    const f = fakeRpc(PAGE * MAX_PAGES + 10);
    const c = createChain({ rpc: 'x', fetch: f.fetch, pageGapMs: 0, nfts: false });
    const st = await c.walletStats('W');
    assert.strictEqual(st.capped, true);
    assert.strictEqual(f.calls.length, MAX_PAGES);
});

test('a wallet checked before the NFT check existed is stale even if recent', () => {
    const c = createChain({ rpc: 'x', fetch: fakeRpc(0).fetch, pageGapMs: 0 });
    assert.strictEqual(c.stale({ txs: 1, firstAt: 1, capped: false, checkedAt: Date.now() }), true);
    assert.strictEqual(c.stale({ txs: 1, firstAt: 1, capped: false, checkedAt: Date.now(), nfts: {} }), false);
    assert.strictEqual(c.stale(null), true);
});

test('the page only sees the history of the wallet currently linked', () => {
    const s = createStore({});
    const W1 = 'Wallet' + '1'.padStart(38, '0'), W2 = 'Wallet' + '2'.padStart(38, '0');
    const a = s.linkWallet(null, W1, '');
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).chain, null);
    s.setChain(W1, { txs: 42, firstAt: 1700000000, capped: false, checkedAt: 1 });
    assert.deepStrictEqual(s.publicView(s.sessionUser(a.token)).chain, { txs: 42, firstAt: 1700000000, capped: false, nfts: [] });
    s.unlink(a.token, 'wallet');
    s.linkWallet(a.token, W2, '');
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).chain, null);
});

test('an NFT only pays for the first wallet that showed it', () => {
    const s = createStore({});
    const W1 = 'Wallet' + '1'.padStart(38, '0'), W2 = 'Wallet' + '2'.padStart(38, '0');
    const a = s.linkWallet(null, W1, ''), b = s.linkWallet(null, W2, '');
    const st = nfts => ({ txs: 1, firstAt: 1, capped: false, checkedAt: 1, nfts });
    s.setChain(W1, st({ saga: 'MintA', madlads: 'MintB' }));
    s.setChain(W2, st({ saga: 'MintA', seeker: 'MintC' }));   // MintA moved to W2
    assert.deepStrictEqual(s.publicView(s.sessionUser(a.token)).chain.nfts, ['saga', 'madlads']);
    assert.deepStrictEqual(s.publicView(s.sessionUser(b.token)).chain.nfts, ['seeker']);
    s.setChain(W1, st({ madlads: 'MintB' }));                  // W1 refreshes without it: still W1's
    s.setChain(W2, st({ saga: 'MintA', seeker: 'MintC' }));
    assert.deepStrictEqual(s.publicView(s.sessionUser(b.token)).chain.nfts, ['seeker']);
});

test('reads a real Saga Genesis Token metadata account', () => {
    // Metadata of mint G42ih3u2X8QHy2FMuGB48LMQ6eJKj7WxSGtedSmNSP5x, trimmed after the collection.
    const b = Buffer.alloc(1 + 32 + 32 + 4 + 18 + 4 + 0 + 4 + 0 + 2 + 1 + 2 + 2 + 2 + 1 + 1 + 32);
    let o = 65;
    const str = s => { b.writeUInt32LE(s.length, o); o += 4; b.write(s, o); o += s.length; };
    str('Saga genesis token'); str(''); str('');
    o += 2; b[o++] = 0; o += 2; b[o++] = 1; o++; b[o++] = 1; o++;
    b[o++] = 1; b[o++] = 1; new PublicKey(COLLECTIONS_SAGA).toBuffer().copy(b, o);
    const m = parseMetadata(b);
    assert.strictEqual(m.name, 'Saga genesis token');
    assert.deepStrictEqual(m.collection, { verified: true, key: COLLECTIONS_SAGA });
});

test('Seeker Genesis Token needs the documented authority, metadata pointer and group', () => {
    const good = {
        mintAuthority: SGT.mintAuthority,
        extensions: [
            { extension: 'metadataPointer', state: { authority: SGT.mintAuthority, metadataAddress: SGT.group } },
            { extension: 'groupMemberPointer', state: { memberAddress: 'Mint' } },
            { extension: 'tokenGroupMember', state: { group: SGT.group } },
        ],
    };
    assert.strictEqual(isSeekerMint(good), true);
    assert.strictEqual(isSeekerMint(Object.assign({}, good, { mintAuthority: 'Someone' })), false);
    assert.strictEqual(isSeekerMint(Object.assign({}, good, { extensions: good.extensions.slice(0, 2) })), false);
});
