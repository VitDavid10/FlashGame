'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createDiscord } = require('../server/discord.js');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
const GUILD = '1552774307938304002', PLAYER = '1552778663433474098';

function call(d, body, { badSig = false } = {}) {
    const raw = Buffer.from(JSON.stringify(body)), ts = String(Date.now());
    let sig = crypto.sign(null, Buffer.concat([Buffer.from(ts), raw]), privateKey).toString('hex');
    if (badSig) sig = sig.replace(/^./, c => (c === '0' ? '1' : '0'));
    const req = Readable.from([raw]);
    Object.assign(req, { method: 'POST', headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } });
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b || ''; } };
    return d.handle(req, res, '/discord/interactions').then(() => res);
}

test('PING firmado contesta PONG', async () => {
    const res = await call(createDiscord({ publicKey: PUB_HEX, token: 't' }), { type: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { type: 1 });
});

test('firma mala = 401', async () => {
    const res = await call(createDiscord({ publicKey: PUB_HEX, token: 't' }), { type: 1 }, { badSig: true });
    assert.equal(res.status, 401);
});

test('verify pone el rol Player', async () => {
    const calls = [];
    const fetchImpl = async (url, o) => { calls.push([o.method, url]); return { status: 204, ok: true }; };
    const d = createDiscord({ publicKey: PUB_HEX, token: 't', fetchImpl });
    const res = await call(d, { type: 3, guild_id: GUILD, data: { custom_id: 'verify' }, member: { roles: [], user: { id: '42' } } });
    assert.equal(JSON.parse(res.body).type, 4);
    assert.deepEqual(calls, [['PUT', 'https://discord.com/api/v10/guilds/' + GUILD + '/members/42/roles/' + PLAYER]]);
});

test('sin DISCORD_PUBLIC_KEY no toca la ruta', async () => {
    assert.equal(await createDiscord({}).handle({}, {}, '/discord/interactions'), false);
});
