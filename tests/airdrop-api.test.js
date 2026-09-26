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

test('the admin dashboard only opens with a link minted from the server itself', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());

    // From the internet (Caddy always adds x-forwarded-for): no link for you.
    const faked = await fetch(base + '/api/airdrop/admin-link', { method: 'POST', headers: { 'X-Forwarded-For': '8.8.8.8' } });
    assert.strictEqual(faked.status, 404);
    // GET instead of POST, and a made-up token: nothing.
    assert.strictEqual((await fetch(base + '/api/airdrop/admin-link')).status, 404);
    assert.strictEqual((await fetch(base + '/airdrop-admin/not-a-real-token')).status, 404);

    // From the machine itself (this test IS the machine): a working link.
    const r = await fetch(base + '/api/airdrop/admin-link', { method: 'POST' });
    assert.strictEqual(r.status, 200);
    const url = (await r.text()).trim();
    const token = url.split('/airdrop-admin/')[1];
    assert.match(token, /^[A-Za-z0-9_-]{30,}$/);

    const page = await fetch(base + '/airdrop-admin/' + token);
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    const html = await page.text();
    assert.match(html, /PILLWARS AIRDROP - ADMIN/);
    assert.match(html, /Eligible \(wallet,/);

    // Minting a new link kills the old one.
    const url2 = (await (await fetch(base + '/api/airdrop/admin-link', { method: 'POST' })).text()).trim();
    assert.notStrictEqual(url2, url);
    assert.strictEqual((await fetch(base + '/airdrop-admin/' + token)).status, 404);
});

test('the admin dashboard can discard a wallet and restore it', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const c = client(base);
    await c.demoWallet();
    const token = (await (await fetch(base + '/api/airdrop/admin-link', { method: 'POST' })).text()).trim().split('/airdrop-admin/')[1];
    // uid isn't part of publicView; pull it from the dashboard's own DISCARD button.
    const before = await (await fetch(base + '/airdrop-admin/' + token)).text();
    const realUid = before.match(/data-uid="([^"]+)"/)[1];

    // An expired/wrong token can't discard anything.
    const forged = await fetch(base + '/airdrop-admin/not-a-real-token/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: realUid, on: true }) });
    assert.strictEqual(forged.status, 403);

    const discard = await fetch(base + '/airdrop-admin/' + token + '/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: realUid, on: true }) });
    assert.strictEqual(discard.status, 200);
    assert.deepStrictEqual(await discard.json(), { ok: true });

    let html = await (await fetch(base + '/airdrop-admin/' + token)).text();
    assert.match(html, /DISCARDED \(1\)/);
    assert.match(html, /ALL \(0\)/);
    assert.match(html, /solscan\.io\/account\//);

    const restore = await fetch(base + '/airdrop-admin/' + token + '/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: realUid, on: false }) });
    assert.strictEqual(restore.status, 200);
    html = await (await fetch(base + '/airdrop-admin/' + token)).text();
    assert.match(html, /DISCARDED \(0\)/);
    assert.match(html, /ALL \(1\)/);
});

test('a request from another origin (no matching Referer) is refused', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const r = await fetch(base + '/api/airdrop/arena/begin', { method: 'POST', headers: { Referer: 'https://evil.example/' }, body: '{}' });
    assert.strictEqual(r.status, 403);
});

// A second harness, this time WITH the lockdown on, that answers 200
// 'PASSTHROUGH' whenever the airdrop module lets a path through to the normal
// static server. That is the only way to tell "the gate blocked it" (404 from
// the gate) apart from "the gate allowed it" from outside.
function startLocked() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airdrop-lock-'));
    fs.writeFileSync(path.join(root, 'airdrop.html'), '<!--OG--><body>airdrop</body>');
    fs.writeFileSync(path.join(root, '404.html'), '404');
    process.env.AIRDROP_DATA_FILE = path.join(root, 'data.json');
    const airdrop = createAirdrop({ root, only: true, clientIp: () => '127.0.0.1', log: () => {} });
    const server = http.createServer(async (req, res) => {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const query = new URLSearchParams((req.url || '').split('?')[1] || '');
        if (await airdrop.handle(req, res, urlPath, query)) return;
        res.writeHead(200); res.end('PASSTHROUGH');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}

test('the lockdown keeps every browser out of the real site', async (t) => {
    const { server, base } = await startLocked();
    t.after(() => server.close());
    const get = (p, headers) => fetch(base + p, { headers: headers || {}, redirect: 'manual' });

    // A visitor typing the address, or following a link: a browser sends
    // sec-fetch-dest: document for that, and it must never get through.
    assert.strictEqual((await get('/game/', { 'Sec-Fetch-Dest': 'document', Referer: base + '/' })).status, 404);
    assert.strictEqual((await get('/index.html', { 'Sec-Fetch-Dest': 'document' })).status, 404);
    // Someone embedding the game in their own page: the Referer gives them away.
    assert.strictEqual((await get('/game/', { 'Sec-Fetch-Dest': 'iframe', Referer: 'https://evil.example/' })).status, 404);
    assert.strictEqual((await get('/game/', { 'Sec-Fetch-Dest': 'iframe' })).status, 404);
    // No walking out of the allowed prefixes.
    assert.strictEqual((await get('/game/../server/airdrop-data.json', { Referer: base + '/' })).status, 404);
    // Our own iframe is the one thing that works.
    assert.strictEqual((await get('/game/', { 'Sec-Fetch-Dest': 'iframe', Referer: base + '/' })).status, 200);
});

test('the owner can unlock the real site with a link minted on the server', async (t) => {
    const { server, base } = await startLocked();
    t.after(() => server.close());

    // Not from the internet (Caddy always adds x-forwarded-for), not by GET.
    assert.strictEqual((await fetch(base + '/api/airdrop/unlock-link', { method: 'POST', headers: { 'X-Forwarded-For': '8.8.8.8' } })).status, 404);
    assert.strictEqual((await fetch(base + '/api/airdrop/unlock-link')).status, 404);
    // A made-up token sets no cookie.
    assert.strictEqual((await fetch(base + '/airdrop-unlock/not-a-real-token', { redirect: 'manual' })).status, 404);

    const url = (await (await fetch(base + '/api/airdrop/unlock-link', { method: 'POST' })).text()).trim();
    const token = url.split('/airdrop-unlock/')[1];
    assert.match(token, /^[A-Za-z0-9_-]{30,}$/);

    const open = await fetch(base + '/airdrop-unlock/' + token, { redirect: 'manual' });
    assert.strictEqual(open.status, 302);
    assert.strictEqual(open.headers.get('location'), '/game/');
    const cookie = open.headers.get('set-cookie').split(';')[0];
    assert.match(open.headers.get('set-cookie'), /HttpOnly/);

    // With the pass, the real site answers as if there were no lockdown.
    const withPass = p => fetch(base + p, { headers: { Cookie: cookie, 'Sec-Fetch-Dest': 'document' } });
    assert.strictEqual((await withPass('/game/')).status, 200);
    assert.strictEqual(await (await withPass('/index.html')).text(), 'PASSTHROUGH');
    // A forged cookie value does nothing.
    const forged = await fetch(base + '/index.html', { headers: { Cookie: 'pwopen=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Sec-Fetch-Dest': 'document' } });
    assert.strictEqual(forged.status, 404);

    // Minting again revokes the previous pass.
    await fetch(base + '/api/airdrop/unlock-link', { method: 'POST' });
    assert.strictEqual((await withPass('/index.html')).status, 404);
});

test('quests and Daily Arena progress are written to disk, so a restart keeps them', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const file = process.env.AIRDROP_DATA_FILE;
    const c = client(base);
    await c.demoWallet();
    await new Promise(r => setTimeout(r, 1300));   // let the signup's own save land first
    assert.strictEqual((await c.quest('follow')).status, 200);
    await c.begin();
    await c.end({});
    await new Promise(r => setTimeout(r, 1300));
    const u = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).users)[0];
    assert.strictEqual(u.score.tasks.follow, true);
    assert.strictEqual(u.score.tasks.play, true);
});

test('a game host of the split (persist: false) never writes the airdrop file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airdrop-host-'));
    const file = path.join(root, 'data.json');
    fs.writeFileSync(file, JSON.stringify({ users: {}, sessions: {} }));
    process.env.AIRDROP_DATA_FILE = file;
    const host = createAirdrop({ root, only: false, persist: false, clientIp: () => '127.0.0.1', log: () => {} });
    // Meanwhile the real airdrop process saves new data...
    const fresh = JSON.stringify({ users: { u1: { uid: 'u1', code: 'abcdefg', invited: [] } }, sessions: {} });
    fs.writeFileSync(file, fresh);
    host.flush();   // ...and the host stops: its exit hook must not put its stale copy back
    assert.strictEqual(fs.readFileSync(file, 'utf8'), fresh);
});

test('the public leaderboard ranks real participants and tells you your place', async (t) => {
    const { server, base } = await startServer();
    t.after(() => server.close());
    const a = client(base), b = client(base);
    await a.demoWallet(); await b.demoWallet();
    await a.quest('daily:post');                 // a: 100 points, b: 0
    const r = await fetch(base + '/api/airdrop/leaderboard', { headers: { Referer: base + '/' } }).then(x => x.json());
    assert.strictEqual(r.total, 1);              // nobody with 0 points is listed
    assert.strictEqual(r.top[0].pts, 100);
    assert.strictEqual(r.me, null);              // no session on this request
    assert.ok(!('uid' in r.top[0]));             // internal ids never leave the server
});
