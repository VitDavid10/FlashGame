'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAirdrop } = require('../server/airdrop.js');

// A real HTTP server around createAirdrop, mirroring server/index.js's wiring,
// so these tests exercise the actual request/response/cookie path.
function startServer() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airdrop-api-'));
    fs.writeFileSync(path.join(root, 'airdrop.html'), '<!--OG--><body>test</body>');
    fs.writeFileSync(path.join(root, '404.html'), '404');
    process.env.AIRDROP_DATA_FILE = path.join(root, 'data.json');
    const airdrop = createAirdrop({ root, only: false, clientIp: () => '127.0.0.1', log: () => {} });
    const server = http.createServer(async (req, res) => {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const query = new URLSearchParams((req.url || '').split('?')[1] || '');
        if (await airdrop.handle(req, res, urlPath, query)) return;
        res.writeHead(404); res.end();
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}

// A tiny client that keeps the session cookie and always sends a same-origin
// Referer, matching what the real page does.
function client(base) {
    let cookie = '';
    async function call(path, body) {
        const headers = { Referer: base + '/', Cookie: cookie };
        const init = body === undefined ? { headers } : { method: 'POST', headers: Object.assign(headers, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) };
        const r = await fetch(base + path, init);
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { status: r.status, json: await r.json().catch(() => null) };
    }
    return {
        me: () => call('/api/airdrop/me'),
        demoWallet: () => call('/api/airdrop/wallet', { demo: true }),
        begin: () => call('/api/airdrop/arena/begin', {}),
        event: ev => call('/api/airdrop/arena/event', ev),
        end: body => call('/api/airdrop/arena/end', body || {}),
        quest: key => call('/api/airdrop/quest/complete', { key }),
    };
}

test('arena and quest routes are wired end to end over real HTTP', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const c = client(base);

    // No session yet: arena routes refuse cleanly instead of crashing.
    const anon = await c.begin();
    assert.strictEqual(anon.status, 401);

    await c.demoWallet();   // creates a session + wallet (localhost demo path)

    const begin = await c.begin();
    assert.strictEqual(begin.status, 200);
    assert.strictEqual(begin.json.score.match !== null, true);

    // A forged request can't smuggle its own point value - only `type` is read.
    const ev = await c.event({ type: 'botKilled', pts: 999999 });
    assert.strictEqual(ev.status, 200);
    assert.strictEqual(ev.json.score.gamePts < 999999, true);

    const bad = await c.event({ type: 'not_a_real_event' });
    assert.strictEqual(bad.status, 409);
    assert.strictEqual(bad.json.error, 'bad_type');

    const end = await c.end({ finished: true, place: 1 });
    assert.strictEqual(end.status, 200);
    assert.strictEqual(end.json.score.match.kills, 1);   // final snapshot of the match just closed

    const q = await c.quest('follow');
    assert.strictEqual(q.status, 200);
    assert.strictEqual(q.json.score.tasks.follow, true);

    const me = await c.me();
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.json.score.tasks.follow, true);
    assert.strictEqual(me.json.score.daily.matches, 1);
    assert.strictEqual(me.json.score.match, null);   // cleared once the match ended
});

test('quest/complete rejects a key nobody defined', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const c = client(base);
    await c.demoWallet();
    const r = await c.quest('give-me-points');
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.error, 'bad_key');
});

test('a request from another origin (no matching Referer) is refused', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const r = await fetch(base + '/api/airdrop/arena/begin', { method: 'POST', headers: { Referer: 'https://evil.example/' }, body: '{}' });
    assert.strictEqual(r.status, 403);
});
