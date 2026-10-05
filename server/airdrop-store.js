'use strict';
/*
 * Airdrop participants: who linked which X account and wallet, their invite
 * code, who invited them and who they invited. One JSON file, written
 * atomically a moment after each change.
 *
 * Referral rule: an invite is recorded ONLY the first time the invited person
 * links a wallet (verified by signature before it gets here), never for
 * themselves, never twice. It counts once that wallet is 60+ days old with 50+
 * transactions on-chain.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_INVITES = 50;
const INVITE_MIN_AGE_DAYS = 60;
const INVITE_MIN_TXS = 50;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LEN = 7;
const SAVE_DELAY_MS = 1000;

function createStore(opts) {
    const file = opts.file;
    const now = opts.now || Date.now;
    const log = opts.log || (() => {});

    let data = { users: {}, sessions: {} };
    if (file) {
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') log('[airdrop] could not read ' + file + ': ' + e.message); }
        data.users = data.users || {}; data.sessions = data.sessions || {};
    }
    data.nftClaims = data.nftClaims || {};   // NFT mint -> first wallet that showed it
    data.discord = data.discord || {};       // Discord user id -> uid that claimed Genesis Hunter with it
    const byWallet = new Map(), byX = new Map(), byCode = new Map(), byDcode = new Map();
    for (const u of Object.values(data.users)) {
        if (u.dcode) byDcode.set(u.dcode, u.uid);
        if (u.wallet) byWallet.set(u.wallet, u.uid);
        if (u.x) byX.set(u.x.id, u.uid);
        byCode.set(u.code, u.uid);
    }

    let saveTimer = null;
    function save() {
        if (!file || saveTimer) return;
        saveTimer = setTimeout(flush, SAVE_DELAY_MS);
        if (saveTimer.unref) saveTimer.unref();
    }
    function flush() {
        clearTimeout(saveTimer); saveTimer = null;
        if (!file) return;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(data));
            fs.renameSync(tmp, file);
        } catch (e) { log('[airdrop] could not save ' + file + ': ' + e.message); }
    }

    const rand = n => crypto.randomBytes(n);
    function newCode() {
        for (;;) {
            let c = ''; const b = rand(CODE_LEN);
            for (let i = 0; i < CODE_LEN; i++) c += CODE_CHARS[b[i] % CODE_CHARS.length];
            if (!byCode.has(c)) return c;
        }
    }
    function newUser() {
        const u = { uid: rand(9).toString('hex'), code: newCode(), wallet: null, x: null, referredBy: null, walletLinkedAt: null, invited: [], createdAt: now() };
        data.users[u.uid] = u; byCode.set(u.code, u.uid);
        return u;
    }
    const user = uid => (uid && data.users[uid]) || null;

    function newSession(uid) {
        const token = rand(24).toString('base64url');
        data.sessions[token] = { uid, t: now() };
        save();
        return token;
    }
    const sessionUser = token => (token && data.sessions[token] ? user(data.sessions[token].uid) : null);
    function pointSession(token, uid) {
        if (token && data.sessions[token]) { data.sessions[token].uid = uid; return token; }
        return newSession(uid);
    }

    function attachReferral(u, refCode) {
        if (u.referredBy || u.walletLinkedAt) return false;
        const refUid = byCode.get(String(refCode || '').toLowerCase());
        const referrer = user(refUid);
        if (!referrer || referrer.uid === u.uid || (referrer.wallet && referrer.wallet === u.wallet)) return false;
        u.referredBy = referrer.uid;
        if (!referrer.invited.includes(u.uid)) referrer.invited.push(u.uid);
        return true;
    }

    // Moves everything from `src` into `dst` (used when one person turns out to
    // own two records: signed in with X on one device, wallet on another).
    function merge(src, dst) {
        if (src === dst) return dst;
        if (!dst.wallet && src.wallet) { dst.wallet = src.wallet; byWallet.set(dst.wallet, dst.uid); dst.walletLinkedAt = dst.walletLinkedAt || src.walletLinkedAt; }
        if (!dst.x && src.x) { dst.x = src.x; byX.set(dst.x.id, dst.uid); }
        if (!dst.referredBy && src.referredBy && src.referredBy !== dst.uid) {
            dst.referredBy = src.referredBy;
            const r = user(src.referredBy);
            if (r) { r.invited = r.invited.filter(id => id !== src.uid); if (!r.invited.includes(dst.uid)) r.invited.push(dst.uid); }
        }
        for (const id of src.invited) {
            if (id === dst.uid || dst.invited.includes(id)) continue;
            dst.invited.push(id);
            const inv = user(id); if (inv) inv.referredBy = dst.uid;
        }
        for (const s of Object.values(data.sessions)) if (s.uid === src.uid) s.uid = dst.uid;
        if (!dst.discord && src.discord) { dst.discord = src.discord; data.discord[src.discord] = dst.uid; }
        if (src.dcode) byDcode.delete(src.dcode);
        byCode.delete(src.code);
        if (src.wallet && byWallet.get(src.wallet) === src.uid) byWallet.delete(src.wallet);
        if (src.x && byX.get(src.x.id) === src.uid) byX.delete(src.x.id);
        delete data.users[src.uid];
        return dst;
    }
    const isEmpty = u => !u.wallet && !u.x && !u.invited.length;

    /** Wallet already verified by signature. Returns { token, user, referred }. */
    function linkWallet(token, wallet, refCode) {
        let cur = sessionUser(token);
        // Signing beats pasting: a pasted copy of this wallet is dropped from
        // whoever pasted it, or just becomes signed if it is the same account.
        const pasted = user(byWallet.get(wallet));
        if (pasted && pasted.walletPasted) {
            if (cur && cur.uid === pasted.uid) { pasted.walletPasted = false; save(); return { token, user: pasted, referred: false }; }
            pasted.wallet = null; pasted.walletPasted = false; pasted.chain = null; byWallet.delete(wallet);
            log('[airdrop] pasted wallet ' + wallet + ' taken back by its signer');
        }
        const ownerUid = byWallet.get(wallet);
        if (ownerUid) {
            let owner = user(ownerUid);
            if (cur && cur.uid !== owner.uid) {
                if (!cur.wallet && (!owner.x || !cur.x)) owner = merge(cur, owner);
            }
            return { token: pointSession(token, owner.uid), user: owner, referred: false };
        }
        // One wallet per account: to change it, unlink first (the page does that).
        if (cur && cur.wallet) return { error: 'already_linked', token, user: cur, referred: false };
        const u = cur || newUser();
        u.wallet = wallet; byWallet.set(wallet, u.uid);
        const referred = attachReferral(u, refCode);
        u.walletLinkedAt = u.walletLinkedAt || now();
        save();
        return { token: pointSession(token, u.uid), user: u, referred };
    }

    /** An address typed in, not signed: it gets paid and earns the same
     * on-chain points, but never counts as an invite, needs X linked first,
     * and a signature for it always wins (see linkWallet). */
    function pasteWallet(token, wallet) {
        const cur = sessionUser(token);
        if (!cur || !cur.x) return { error: 'need_x' };
        if (cur.wallet) return { error: 'already_linked', user: cur };
        if (byWallet.has(wallet)) return { error: 'taken', user: cur };
        cur.wallet = wallet; cur.walletPasted = true; byWallet.set(wallet, cur.uid);
        save();
        return { user: cur };
    }

    /** Profile from X's users/me. Linking X never records a referral. */
    function linkX(token, profile) {
        const x = {
            id: String(profile.id), username: profile.username, name: profile.name, verified: !!profile.verified,
            created_at: profile.created_at, followers: profile.followers | 0, following: profile.following | 0,
            posts: profile.posts | 0, pic: profile.pic || '',
        };
        let cur = sessionUser(token);
        const ownerUid = byX.get(x.id);
        if (ownerUid) {
            let owner = user(ownerUid);
            owner.x = x;
            if (cur && cur.uid !== owner.uid && !cur.x && (!owner.wallet || !cur.wallet)) owner = merge(cur, owner);
            save();
            return { token: pointSession(token, owner.uid), user: owner };
        }
        const u = cur && !cur.x ? cur : newUser();
        u.x = x; byX.set(x.id, u.uid);
        save();
        return { token: pointSession(token, u.uid), user: u };
    }

    function unlink(token, what) {
        const u = sessionUser(token); if (!u) return null;
        if (what === 'wallet' && u.wallet) { byWallet.delete(u.wallet); u.wallet = null; u.walletPasted = false; }
        if (what === 'x' && u.x) { byX.delete(u.x.id); u.x = null; }
        save();
        return u;
    }

    // An invite only counts once the invited wallet is a real one: old enough and
    // with some history (checked on-chain, see airdrop-chain.js).
    const qualifies = c => !!(c && c.firstAt && c.txs >= INVITE_MIN_TXS && now() / 1000 - c.firstAt >= INVITE_MIN_AGE_DAYS * 86400);
    // A pasted wallet proves nothing about who the friend is: it never counts.
    const invitedValid = u => u.invited.filter(id => { const f = user(id); return f && !f.walletPasted && qualifies(chainOf(f)); });
    const inviteCount = u => Math.min(MAX_INVITES, invitedValid(u).length);
    /** What the page is allowed to see about the signed-in user. */
    function publicView(u) {
        if (!u) return null;
        const c = chainOf(u);
        const chain = c ? { txs: c.txs, firstAt: c.firstAt, capped: c.capped, nfts: Object.keys(c.nfts || {}), airdrops: c.airdrops || [], jumper: !!c.jumper } : null;
        const invites = inviteCount(u);
        return { code: u.code, wallet: u.wallet, walletPasted: !!u.walletPasted, x: u.x, invites, pendingInvites: Math.max(0, Math.min(MAX_INVITES, u.invited.length) - invites), referred: !!u.referredBy, chain };
    }
    /** On-chain history of a wallet (see airdrop-chain.js), kept with its owner. */
    // Each NFT pays once per season: it counts only for the first wallet that
    // showed it, so passing one NFT from wallet to wallet earns nothing.
    function setChain(wallet, stats) {
        const u = user(byWallet.get(wallet)); if (!u) return false;
        const nfts = {};
        for (const [id, mint] of Object.entries(stats.nfts || {})) {
            if (!data.nftClaims[mint]) data.nftClaims[mint] = wallet;
            if (data.nftClaims[mint] === wallet) nfts[id] = mint;
        }
        u.chain = Object.assign({ wallet }, stats, { nfts }); save(); return true;
    }
    const chainOf = u => (u && u.wallet && u.chain && u.chain.wallet === u.wallet ? u.chain : null);
    const codeOf = token => { const u = sessionUser(token); return u ? u.code : ''; };
    // Latest points card of each participant: the preview of their invite link.
    function setCard(token, cardId) {
        const u = sessionUser(token); if (!u) return false;
        u.card = cardId; save(); return true;
    }
    const cardOfCode = code => { const u = user(byCode.get(String(code || '').toLowerCase())); return u && u.card || null; };

    // Genesis Hunter (Discord role): the page shows a private code, the user
    // pastes it in Discord and the bot calls claimDiscord. Not the invite code:
    // that one is public in every invite link.
    function discordCode(token) {
        const u = sessionUser(token); if (!u || !(u.wallet || u.x)) return null;
        if (!u.dcode) {
            do { u.dcode = 'GH-' + rand(4).toString('hex').toUpperCase(); } while (byDcode.has(u.dcode));
            byDcode.set(u.dcode, u.uid); save();
        }
        return u.dcode;
    }
    function claimDiscord(code, discordId) {
        const u = user(byDcode.get(String(code || '').trim().toUpperCase()));
        if (!u) return { error: 'bad_code' };
        const owner = data.discord[discordId];
        if (owner && owner !== u.uid) return { error: 'discord_used' };
        if (u.discord && u.discord !== discordId) return { error: 'code_used' };
        u.discord = discordId; data.discord[discordId] = u.uid; save();
        return { user: u };
    }

    // Admin-only, manual: a wallet someone flagged (suspected sybil/bot) as not
    // eligible for the airdrop, regardless of its points. Reversible any time.
    function setDiscarded(uid, discarded) {
        const u = user(uid); if (!u) return false;
        u.discarded = !!discarded; save(); return true;
    }
    // Admin-only, irreversible: wipes a participant (points, links, invites,
    // sessions) so the same X and wallet can sign up again from zero.
    function removeUser(uid) {
        const u = user(uid); if (!u) return false;
        const r = user(u.referredBy);
        if (r) r.invited = r.invited.filter(id => id !== uid);
        for (const id of u.invited) { const inv = user(id); if (inv && inv.referredBy === uid) inv.referredBy = null; }
        for (const [t, s] of Object.entries(data.sessions)) if (s.uid === uid) delete data.sessions[t];
        if (u.wallet && byWallet.get(u.wallet) === uid) byWallet.delete(u.wallet);
        if (u.x && byX.get(u.x.id) === uid) byX.delete(u.x.id);
        if (u.dcode) byDcode.delete(u.dcode);
        if (u.discord && data.discord[u.discord] === uid) delete data.discord[u.discord];
        if (u.wallet) for (const [mint, w] of Object.entries(data.nftClaims)) if (w === u.wallet) delete data.nftClaims[mint];
        byCode.delete(u.code);
        delete data.users[uid];
        save(); return true;
    }

    /** Cuenta por usuario de X o por codigo de amigo, para encontrar amigos. Nunca por wallet: buscar una
     * direccion revelaria de quien es. Solo cuentas con X o con wallet firmada (una pegada no demuestra nada). */
    function find(q) {
        const raw = String(q || '').trim();
        // El leaderboard enseña "AjGQ...qX6k" para quien solo tiene wallet: se acepta ese mismo resumen, y solo
        // para cuentas sin X (con X el leaderboard enseña su @, asi que esto no revela nada nuevo). Si coincide mas de una, ninguna.
        const sh = /^([1-9A-HJ-NP-Za-km-z]{4})(?:\.\.\.|\u2026)([1-9A-HJ-NP-Za-km-z]{4})$/.exec(raw);
        if (sh) {
            const c = Object.values(data.users).filter(x => !x.x && x.wallet && !x.walletPasted && x.wallet.startsWith(sh[1]) && x.wallet.endsWith(sh[2]));
            return c.length === 1 ? c[0] : null;
        }
        q = raw.replace(/^@/, '').toLowerCase();
        if (!q) return null;
        let u = user(byCode.get(q));
        if (!u) u = Object.values(data.users).find(x => x.x && String(x.x.username || '').toLowerCase() === q) || null;
        if (!u || !(u.x || (u.wallet && !u.walletPasted))) return null;
        return u;
    }

    return { find, linkWallet, pasteWallet, linkX, unlink, sessionUser, publicView, setChain, chainOf, invitedOf: u => u.invited.map(user).filter(Boolean), codeOf, setCard, cardOfCode, discordCode, claimDiscord, inviteCount, setDiscarded, removeUser, save, flush, MAX_INVITES, _data: () => data };
}

module.exports = { createStore, MAX_INVITES, INVITE_MIN_AGE_DAYS, INVITE_MIN_TXS };
