'use strict';
/*
 * Real on-chain history of an airdrop wallet: how many successful transactions
 * it appears in, when the first one happened and which point-giving NFTs it
 * holds (airdrop-nfts.js). Read from a Solana mainnet RPC
 * (AIRDROP_RPC, e.g. a Helius URL; the public endpoint works for low traffic),
 * one wallet at a time so a burst of sign-ups can't get the server rate limited.
 */
const { createNfts } = require('./airdrop-nfts.js');

const PAGE = 1000;
const MAX_PAGES = 20;               // 20,000 transactions: far past the points cap
const TIMEOUT_MS = 15000;
const REFRESH_MS = 24 * 3600 * 1000;
const TOP_TXS = 5000, TOP_AGE_DAYS = 3 * 365;   // top tiers of the page's score
const RETRIES = 6, RETRY_MS = 3000, PAGE_GAP_MS = 400;

function createChain(opts) {
    const rpc = opts.rpc;
    const log = opts.log || (() => {});
    const now = opts.now || Date.now;
    const doFetch = opts.fetch || fetch;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function call(method, params) {
        for (let attempt = 1; ; attempt++) {
            const r = await doFetch(rpc, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const j = r.status === 429 ? { error: { message: 'Too many requests' } } : await r.json();
            if (!j.error) return j.result;
            // Rate limited (the public RPC is strict): back off and try again.
            if (/too many/i.test(j.error.message || '') && attempt < RETRIES) { await sleep(RETRY_MS * attempt); continue; }
            throw new Error(method + ': ' + (j.error.message || JSON.stringify(j.error)));
        }
    }

    const nfts = createNfts({ call });

    /** { txs, firstAt (unix s or null), capped, checkedAt, nfts: { id: mint } } */
    async function walletStats(address) {
        let before, txs = 0, firstAt = null, pages = 0, last = [];
        do {
            if (pages) await sleep(opts.pageGapMs == null ? PAGE_GAP_MS : opts.pageGapMs);
            const cfg = { limit: PAGE }; if (before) cfg.before = before;
            last = await call('getSignaturesForAddress', [address, cfg]);
            for (const s of last) {
                if (s.err === null) txs++;
                if (s.blockTime && (firstAt === null || s.blockTime < firstAt)) firstAt = s.blockTime;
            }
            before = last.length ? last[last.length - 1].signature : null;
            pages++;
            // Past both top tiers (5,000 txs and 3 years) there is nothing left to learn.
            if (txs >= TOP_TXS && firstAt && now() / 1000 - firstAt >= TOP_AGE_DAYS * 86400) break;
        } while (last.length === PAGE && pages < MAX_PAGES);
        const out = { txs, firstAt, capped: last.length === PAGE, checkedAt: now() };
        if (opts.nfts !== false) out.nfts = await nfts.walletNfts(address);
        return out;
    }

    // Also stale if it predates the NFTs check (older wallets never picked it up).
    const stale = st => !st || now() - st.checkedAt > REFRESH_MS || !st.nfts;
    let queue = Promise.resolve();
    const inFlight = new Set();
    /** Looks the wallet up in the background; `done(stats)` runs on success. */
    function refresh(address, done) {
        if (!rpc || inFlight.has(address)) return;
        inFlight.add(address);
        queue = queue.then(() => walletStats(address))
            .then(done, e => log('[airdrop] on-chain lookup failed for ' + address + ': ' + e.message))
            .finally(() => inFlight.delete(address));
    }

    return { walletStats, refresh, stale };
}

module.exports = { createChain, MAX_PAGES, PAGE };
