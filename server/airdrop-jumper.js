'use strict';
/*
 * Jumper Exchange XP for a Solana wallet. Jumper has no official public API
 * for this, so this calls a third-party site (not run by Jumper) that proxies
 * it: https://jumper-jade.vercel.app/api/wallet?sol=<address>. Any failure
 * (down, renamed, rate-limited, unexpected shape) fails CLOSED - the wallet
 * simply doesn't get the points that check, never a crash and never a false
 * "yes".
 */
const ENDPOINT = 'https://jumper-jade.vercel.app/api/wallet?sol=';
const TIMEOUT_MS = 8000;
const MIN_XP = 1000;

async function fetchXP(address, opts) {
    const doFetch = (opts && opts.fetch) || fetch;
    const log = (opts && opts.log) || (() => {});
    try {
        const r = await doFetch(ENDPOINT + encodeURIComponent(address), { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!r.ok) return null;
        const j = await r.json();
        const xp = j && j.solana && j.solana.xp;
        return typeof xp === 'number' ? xp : null;
    } catch (e) {
        log('[airdrop] jumper XP lookup failed for ' + address + ': ' + e.message);
        return null;
    }
}

const qualifies = xp => typeof xp === 'number' && xp >= MIN_XP;

module.exports = { fetchXP, qualifies, MIN_XP };
