'use strict';
/*
 * NFTs that give airdrop points, read straight from a mainnet RPC (no DAS
 * needed, so the public endpoint works too):
 *   - Metaplex NFTs (Saga Genesis Token, Mad Lads...): the wallet's SPL token
 *     accounts holding 1 unit of a 0-decimals mint, then each mint's metadata
 *     account, whose VERIFIED collection must match (a fake NFT can't set
 *     verified = true for a collection it doesn't control).
 *   - Seeker Genesis Token: Token-2022 mint checked as Solana Mobile documents
 *     (mint authority, metadata pointer and group member).
 */
const { PublicKey } = require('@solana/web3.js');

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const SGT = { mintAuthority: 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4', group: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te' };
// Verified collection address -> id. Each one checked on-chain (its metadata name).
const COLLECTIONS = {
    '46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC': 'saga',
    'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w': 'madlads',
};
const MAX_MINTS = 2000;     // spam-heavy wallets: enough to find real NFTs
const BATCH = 100;          // getMultipleAccounts limit

const metadataPda = mint => PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], METADATA_PROGRAM)[0].toBase58();

/** Metaplex metadata account -> { name, collection: { verified, key } | null }. */
function parseMetadata(buf) {
    let o = 1 + 32 + 32;
    const str = () => { const n = buf.readUInt32LE(o); o += 4; const s = buf.slice(o, o + n).toString('utf8').replace(/\0+$/, ''); o += n; return s; };
    const name = str(); str(); str();       // name, symbol, uri
    o += 2;                                  // seller fee
    if (buf[o++]) { const n = buf.readUInt32LE(o); o += 4 + n * 34; }   // creators
    o += 2;                                  // primary sale, mutable
    if (buf[o++]) o += 1;                    // edition nonce
    if (buf[o++]) o += 1;                    // token standard
    const collection = buf[o++] ? { verified: !!buf[o], key: new PublicKey(buf.slice(o + 1, o + 33)).toBase58() } : null;
    return { name, collection };
}

function isSeekerMint(info) {
    if (!info || info.mintAuthority !== SGT.mintAuthority) return false;
    const ext = Object.fromEntries((info.extensions || []).map(e => [e.extension, e.state || {}]));
    const mp = ext.metadataPointer, gm = ext.groupMemberPointer, member = ext.tokenGroupMember;
    return !!(mp && mp.authority === SGT.mintAuthority && mp.metadataAddress === SGT.group &&
        gm && gm.memberAddress && member && member.group === SGT.group);
}

function createNfts(opts) {
    const call = opts.call;   // (method, params) => result, from airdrop-chain.js

    async function heldMints(owner, programId) {
        const r = await call('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed' }]);
        return r.value.map(a => a.account.data.parsed.info)
            .filter(i => i.tokenAmount.decimals === 0 && i.tokenAmount.amount !== '0')
            .map(i => i.mint).slice(0, MAX_MINTS);
    }
    async function accounts(keys, encoding) {
        const out = [];
        for (let i = 0; i < keys.length; i += BATCH) {
            const r = await call('getMultipleAccounts', [keys.slice(i, i + BATCH), { encoding }]);
            out.push(...r.value);
        }
        return out;
    }

    /** { saga: mint, madlads: mint, seeker: mint } for whatever the wallet holds. */
    async function walletNfts(owner) {
        const found = {};
        const mints = await heldMints(owner, TOKEN);
        const metas = await accounts(mints.map(metadataPda), 'base64');
        metas.forEach((acc, i) => {
            if (!acc) return;
            try {
                const c = parseMetadata(Buffer.from(acc.data[0], 'base64')).collection;
                const id = c && c.verified && COLLECTIONS[c.key];
                if (id && !found[id]) found[id] = mints[i];
            } catch (e) { /* not a metadata account we understand */ }
        });
        const mints22 = await heldMints(owner, TOKEN_2022);
        const infos = await accounts(mints22, 'jsonParsed');
        infos.forEach((acc, i) => {
            if (!found.seeker && acc && acc.data && acc.data.parsed && isSeekerMint(acc.data.parsed.info)) found.seeker = mints22[i];
        });
        return found;
    }

    return { walletNfts };
}

module.exports = { createNfts, parseMetadata, isSeekerMint, metadataPda, COLLECTIONS, SGT };
