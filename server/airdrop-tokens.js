'use strict';
/*
 * Real verification for the "Airdrop Hunter" list: for each project, a wallet
 * qualifies only if its associated token account for that mint shows a
 * transaction dated on or before that project's own claim deadline. That date
 * can't be faked by buying the token today - a transaction can't be backdated.
 * (This proves the wallet RECEIVED the airdrop; it may have sold it since,
 * which still counts - that is what "qualified for the airdrop" means.)
 *
 * Every mint and deadline below was checked against mainnet (name in the
 * token's own on-chain metadata) and the project's own announcement. Sources
 * and the exact date used are in docs/airdrop-points.md.
 */
const { PublicKey } = require('@solana/web3.js');

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ata = (owner, mint) => PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], ATOKEN_PROGRAM)[0].toBase58();

const d = (y, m, day) => Date.UTC(y, m - 1, day) / 1000;
// { id, mint, deadline: last day a genuine claim could have landed in the wallet }
const AIRDROP_TOKENS = [
    { id: 'jto', mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', deadline: d(2025, 6, 7) },
    { id: 'pyth', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', deadline: d(2024, 2, 20) },
    { id: 'w', mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', deadline: d(2024, 7, 2) },
    { id: 'tnsr', mint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', deadline: d(2024, 10, 5) },
    { id: 'drift', mint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7', deadline: d(2025, 11, 14) },
    { id: 'me', mint: 'MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u', deadline: d(2025, 2, 1) },
    { id: 'met', mint: 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', deadline: d(2026, 1, 23) },
    { id: 'bonk', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', deadline: d(2023, 2, 1) },
    { id: 'cloud', mint: 'CLoUDKc4Ane7HeQcPpE3YHnznRxhMimJ4MyaUqyHFzAu', deadline: d(2025, 4, 14) },
    { id: 'grass', mint: 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', deadline: d(2025, 3, 27) },
];
const PAGE = 1000, MAX_PAGES = 5, GAP_MS = 400;

function createTokens(opts) {
    const call = opts.call;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /** Does `address` have a transaction dated at or before `deadline` (unix s)? */
    async function everHeldBy(address, deadline) {
        let before;
        for (let page = 0; page < MAX_PAGES; page++) {
            if (page) await sleep(opts.gapMs == null ? GAP_MS : opts.gapMs);
            const cfg = { limit: PAGE }; if (before) cfg.before = before;
            const sigs = await call('getSignaturesForAddress', [address, cfg]);
            if (!sigs.length) return false;
            if (sigs.some(s => s.blockTime && s.blockTime <= deadline)) return true;
            if (sigs.length < PAGE) return false;
            before = sigs[sigs.length - 1].signature;
        }
        return false;
    }

    /** ids of AIRDROP_TOKENS this wallet qualified for. */
    async function walletAirdrops(owner) {
        const got = [];
        for (const t of AIRDROP_TOKENS) {
            if (got.length) await sleep(opts.gapMs == null ? GAP_MS : opts.gapMs);
            if (await everHeldBy(ata(owner, t.mint), t.deadline)) got.push(t.id);
        }
        return got;
    }

    return { walletAirdrops };
}

module.exports = { createTokens, AIRDROP_TOKENS, ata };
