'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, MAX_INVITES } = require('../server/airdrop-store.js');

const W = n => 'Wallet' + String(n).padStart(38, '0');
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
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 1);
});

test('linking X alone never records an invite', () => {
    const s = createStore({});
    const a = s.linkWallet(null, W(1), '');
    const b = s.linkX(null, X(2));
    assert.strictEqual(s.publicView(s.sessionUser(a.token)).invites, 0);
    // The wallet linked later with the code does count: it is the first wallet.
    const b2 = s.linkWallet(b.token, W(2), s.codeOf(a.token));
    assert.strictEqual(b2.referred, true);
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
    for (let i = 1; i <= MAX_INVITES + 5; i++) s.linkWallet(null, W(i), code);
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

test('everything survives a restart', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airdrop-')), 'data.json');
    const s1 = createStore({ file });
    const a = s1.linkWallet(null, W(1), '');
    s1.linkWallet(null, W(2), s1.codeOf(a.token));
    s1.flush();
    const s2 = createStore({ file });
    const me = s2.publicView(s2.sessionUser(a.token));
    assert.strictEqual(me.wallet, W(1));
    assert.strictEqual(me.invites, 1);
    const dup = s2.linkWallet(null, W(3), me.code);
    assert.strictEqual(dup.referred, true);
});
