'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, MAX_INVITES } = require('../server/airdrop-store.js');

const W = n => 'Wallet' + String(n).padStart(38, '0');
// On-chain history that makes an invited wallet count (60+ days, 50+ txs).
const real = (s, w) => s.setChain(w, { txs: 120, firstAt: Math.floor(Date.now() / 1000) - 400 * 86400, capped: false, checkedAt: Date.now() });
const X = n => ({ id: String(1000 + n), username: 'user' + n, followers: 10, created_at: '2020-01-01T00:00:00Z' });

test('linking a wallet creates a user with its own invite code', () => {
    const s = createStore({});
    const r = s.linkWallet(null, W(1), '');
    assert.ok(r.token);
    const me = s.publicView(s.sessionUser(r.token));
    assert.strictEqual(me.wallet, W(1));
    assert.match(me.code, /^[a-z2-9]{7}$/);
    assert.strictEqual(me.invites, 0);
});

test('an invite is recorded when the invited person links a wallet with the code', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const code = s.codeOf(a.token);
    const b = s.linkWallet(null, W(2), code);
    assert.strictEqual(b.referred, true);
    real(s, W(2));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 1);
});

test('an invite only counts when the invited wallet is 60+ days old with 50+ transactions', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    s.linkWallet(null, W(2), s.codeOf(a.token));
    const view = () => s.publicView(s.sessionUser(a.token));
    const day = 86400, nowS = Math.floor(Date.now() / 1000);
    assert.deepStrictEqual([view().invites, view().pendingInvites], [0, 1]);
    s.setChain(W(2), { txs: 49, firstAt: nowS - 400 * day, capped: false, checkedAt: Date.now() });
    assert.strictEqual(view().invites, 0);
    s.setChain(W(2), { txs: 500, firstAt: nowS - 59 * day, capped: false, checkedAt: Date.now() });
    assert.strictEqual(view().invites, 0);
    s.setChain(W(2), { txs: 50, firstAt: nowS - 61 * day, capped: false, checkedAt: Date.now() });
    assert.deepStrictEqual([view().invites, view().pendingInvites], [1, 0]);
});

test('linking X alone never records an invite', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const b = s.linkX(null, X(2));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 0);
    // The wallet linked later with the code does count: it is the first wallet.
    const b2 = s.linkWallet(b.token, W(2), s.codeOf(a.token));
    assert.strictEqual(b2.referred, true);
    real(s, W(2));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 1);
    assert.strictEqual(s.sessionUser(b2.token).x.username, 'user2');
});

test('nobody can invite themselves', () => {
    const s = createStore({});
    const a = s.linkX(null, X(1));
    const code = s.codeOf(a.token);
    const r = s.linkWallet(a.token, W(1), code);
    assert.strictEqual(r.referred, false);
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 0);
});

test('an invite counts once: relinking or another code later changes nothing', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const c = s.linkWallet(null, W(3), '');
    const b = s.linkWallet(null, W(2), s.codeOf(a.token));
    s.unlink(b.token, 'wallet');
    const again = s.linkWallet(b.token, W(2), s.codeOf(c.token));
    assert.strictEqual(again.referred, false);
    const other = s.linkWallet(null, W(2), s.codeOf(c.token));
    assert.strictEqual(other.referred, false);
    real(s, W(2));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 1);
    assert.strictEqual(s.publicView(s.sessionUser(c.token)).invites, 0);
});

test('a second wallet on the same account is refused and never counts as an invite', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const code = s.codeOf(a.token);
    const second = s.linkWallet(a.token, W(2), code);
    assert.strictEqual(second.error, 'already_linked');
    assert.strictEqual(second.referred, false);
    assert.strictEqual(s.sessionUser(a.token).wallet, W(1));
    // Swapping wallets goes through unlink, and the new one is not an invite either.
    s.unlink(a.token, 'wallet');
    const swapped = s.linkWallet(a.token, W(2), code);
    assert.strictEqual(swapped.referred, false);
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 0);
});

test('an unknown code is ignored', () => {
    const s = createStore({});
    const r = s.linkWallet(null, W(1), 'zzzzzzz');
    assert.strictEqual(r.referred, false);
});

test('invites stop counting at the cap', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(0), '');
    const code = s.codeOf(a.token);
    for (let i = 1; i <= MAX_INVITES + 5; i++) { s.linkWallet(null, W(i), code); real(s, W(i)); }
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, MAX_INVITES);
});

test('X on one device and the wallet on another end up as one person', () => {
    const s = createStore({});
    const phone = s.linkWallet(null, W(1), '');
    const pc = s.linkX(null, X(1));
    const pcWallet = s.linkWallet(pc.token, W(1), '');
    const u = s.sessionUser(pcWallet.token);
    assert.strictEqual(u.wallet, W(1));
    assert.strictEqual(u.x.username, 'user1');
    assert.strictEqual(s.sessionUser(phone.token).uid, u.uid);
});

test('the latest card of a participant is found by their invite code', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const code = s.codeOf(a.token);
    assert.strictEqual(s.cardOfCode(code), null);
    assert.strictEqual(s.setCard(null, 'nope'), false);
    s.setCard(a.token, 'card1'); s.setCard(a.token, 'card2');
    assert.strictEqual(s.cardOfCode(code), 'card2');
    assert.strictEqual(s.cardOfCode(code.toUpperCase()), 'card2');
    assert.strictEqual(s.cardOfCode('zzzzzzz'), null);
});

test('everything survives a restart', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airdrop-')), 'data.json');
    const s1 = createStore({ file });
    const a = s1.linkWallet(null, W(1), '');
    s1.linkWallet(null, W(2), s1.codeOf(a.token));
    real(s1, W(2));
    s1.flush();
    const s2 = createStore({ file });
    const me = s2.publicView(s2.sessionUser(a.token));
    assert.strictEqual(me.wallet, W(1));
    assert.strictEqual(me.invites, 1);
    const dup = s2.linkWallet(null, W(3), me.code);
    assert.strictEqual(dup.referred, true);
});

test('Genesis Hunter: the private code links one Discord account to one airdrop account', () => {
    const s = createStore({});
    assert.strictEqual(s.discordCode('nope'), null);   // no linked account, no code
    const a = s.linkWallet(null, W(1), ''), b = s.linkWallet(null, W(2), '');
    const ca = s.discordCode(a.token), cb = s.discordCode(b.token);
    assert.match(ca, /^GH-[0-9A-F]{8}$/);
    assert.strictEqual(s.discordCode(a.token), ca);    // stable
    assert.notStrictEqual(ca, s.codeOf(a.token));      // not the public invite code
    assert.strictEqual(s.claimDiscord('GH-00000000', 'd1').error, 'bad_code');
    assert.ok(s.claimDiscord(ca.toLowerCase(), 'd1').user);
    assert.ok(s.claimDiscord(ca, 'd1').user);          // same pair again is fine
    assert.strictEqual(s.claimDiscord(ca, 'd2').error, 'code_used');
    assert.strictEqual(s.claimDiscord(cb, 'd1').error, 'discord_used');
});

test('removeUser wipes a participant so the same X and wallet start again from zero', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const b = s.linkWallet(null, W(2), s.codeOf(a.token));
    s.linkX(b.token, X(2));
    real(s, W(2));
    const dc = s.discordCode(b.token); s.claimDiscord(dc, 'd9');
    const uid = s.sessionUser(b.token).uid, oldCode = s.codeOf(b.token);
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 1);
    assert.ok(s.removeUser(uid));
    assert.strictEqual(s.removeUser(uid), false);
    assert.strictEqual(s.sessionUser(b.token), null);                  // old session is dead
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 0); // the invite is gone
    assert.strictEqual(s.claimDiscord(dc, 'd9').error, 'bad_code');
    const again = s.linkWallet(null, W(2), '');
    assert.notStrictEqual(s.sessionUser(again.token).uid, uid);       // a brand new record
    assert.notStrictEqual(s.codeOf(again.token), oldCode);
    assert.strictEqual(s.sessionUser(again.token).x, null);
    assert.strictEqual(s.linkX(again.token, X(2)).user.uid, s.sessionUser(again.token).uid);
});

test('a pasted wallet needs X, is taken back by whoever signs it, and never counts as an invite', () => {
    const s = createStore({});
    const anon = s.linkX(null, X(1)).token;
    assert.strictEqual(s.pasteWallet(null, W(9)).error, 'need_x');
    assert.ok(s.pasteWallet(anon, W(9)).user);
    assert.strictEqual(s.publicView(s.sessionUser(anon)).walletPasted, true);
    // Someone else cannot paste it again.
    const other = s.linkX(null, X(2)).token;
    assert.strictEqual(s.pasteWallet(other, W(9)).error, 'taken');
    // Its real owner signs it: the paster loses it.
    const owner = s.linkWallet(null, W(9), '');
    assert.strictEqual(s.sessionUser(owner.token).wallet, W(9));
    assert.notStrictEqual(s.sessionUser(owner.token).uid, s.sessionUser(anon).uid);
    assert.strictEqual(s.sessionUser(anon).wallet, null);
    assert.strictEqual(s.sessionUser(anon).walletPasted, false);
    // The same account signing its own pasted wallet just makes it signed.
    s.pasteWallet(other, W(8));
    const signed = s.linkWallet(other, W(8), '');
    assert.strictEqual(signed.user.uid, s.sessionUser(other).uid);
    assert.strictEqual(signed.user.walletPasted, false);
});

test('an invited friend who swaps to a pasted wallet stops counting as an invite', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const b = s.linkWallet(null, W(2), s.codeOf(a.token));
    s.linkX(b.token, X(2));
    real(s, W(2));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 1);
    s.unlink(b.token, 'wallet');
    s.pasteWallet(b.token, W(3));
    real(s, W(3));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 0);
});
