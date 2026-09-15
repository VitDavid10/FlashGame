'use strict';
/*
 * Airdrop participants: who linked which X account and wallet, their invite
 * code, who invited them and who they invited. One JSON file, written
 * atomically a moment after each change.
 *
 * Referral rule: an invite is recorded ONLY the first time the invited person
 * links a wallet (verified by signature before it gets here), never for
 * themselves, never twice.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_INVITES = 50;
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
    const byWallet = new Map(), byX = new Map(), byCode = new Map();
    for (const u of Object.values(data.users)) {
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
        if (what === 'wallet' && u.wallet) { byWallet.delete(u.wallet); u.wallet = null; }
        if (what === 'x' && u.x) { byX.delete(u.x.id); u.x = null; }
        save();
        return u;
    }

    const inviteCount = u => Math.min(MAX_INVITES, u.invited.length);
    /** What the page is allowed to see about the signed-in user. */
    function publicView(u) {
        if (!u) return null;
        return { code: u.code, wallet: u.wallet, x: u.x, invites: inviteCount(u), referred: !!u.referredBy };
    }
    const codeOf = token => { const u = sessionUser(token); return u ? u.code : ''; };
    // Latest points card of each participant: the preview of their invite link.
    function setCard(token, cardId) {
        const u = sessionUser(token); if (!u) return false;
        u.card = cardId; save(); return true;
    }
    const cardOfCode = code => { const u = user(byCode.get(String(code || '').toLowerCase())); return u && u.card || null; };

    return { linkWallet, linkX, unlink, sessionUser, publicView, codeOf, setCard, cardOfCode, inviteCount, flush, MAX_INVITES, _data: () => data };
}

module.exports = { createStore, MAX_INVITES };
