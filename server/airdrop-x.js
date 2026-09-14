'use strict';
/*
 * Sign in with X for airdrop.html (OAuth 2.0 Authorization Code + PKCE).
 * Standalone process, it does not touch the game server:
 *
 *   X_CLIENT_ID=... X_CLIENT_SECRET=... node server/airdrop-x.js
 *
 * In the X developer portal the app needs "Read" permissions and this callback:
 *   http://localhost:8091/x/callback   (or AIRDROP_X_BASE + /x/callback)
 */
const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.AIRDROP_X_PORT, 10) || 8091;
const CLIENT_ID = process.env.X_CLIENT_ID || '';
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const BASE = (process.env.AIRDROP_X_BASE || 'http://localhost:' + PORT).replace(/\/$/, '');
const RETURN_ORIGINS = (process.env.AIRDROP_RETURN_ORIGINS || 'http://localhost:8090,http://127.0.0.1:8090,https://pillwars.fun').split(',');
const SCOPES = 'tweet.read users.read';
const PENDING_TTL_MS = 10 * 60 * 1000;

const pending = new Map();   // state -> { verifier, ret, t }
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function safeReturn(raw) {
    try {
        const u = new URL(raw);
        if (RETURN_ORIGINS.includes(u.origin)) return u.origin + u.pathname;
    } catch (e) {}
    return RETURN_ORIGINS[0] + '/airdrop.html';
}

function cors(req, res) {
    const o = req.headers.origin;
    if (o && RETURN_ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
}

function redirect(res, url) { res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' }); res.end(); }

async function exchange(code, verifier) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: BASE + '/x/callback', code_verifier: verifier });
    const tok = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body }).then(r => r.json());
    if (!tok.access_token) throw new Error('token: ' + JSON.stringify(tok));
    const me = await fetch('https://api.x.com/2/users/me?user.fields=created_at,public_metrics,profile_image_url,verified', {
        headers: { Authorization: 'Bearer ' + tok.access_token },
    }).then(r => r.json());
    if (!me.data) throw new Error('users/me: ' + JSON.stringify(me));
    const d = me.data, m = d.public_metrics || {};
    return {
        id: d.id, username: d.username, name: d.name, verified: !!d.verified, created_at: d.created_at,
        followers: m.followers_count || 0, following: m.following_count || 0, posts: m.tweet_count || 0,
        pic: d.profile_image_url || '',
    };
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    cors(req, res);
    const now = Date.now();
    for (const [k, v] of pending) if (now - v.t > PENDING_TTL_MS) pending.delete(k);

    if (url.pathname === '/x/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ configured: !!CLIENT_ID }));
    }

    if (url.pathname === '/x/login') {
        const ret = safeReturn(url.searchParams.get('return'));
        if (!CLIENT_ID) return redirect(res, ret + '#xerr=config');
        const verifier = b64url(crypto.randomBytes(32));
        const state = b64url(crypto.randomBytes(16));
        pending.set(state, { verifier, ret, t: now });
        const q = new URLSearchParams({
            response_type: 'code', client_id: CLIENT_ID, redirect_uri: BASE + '/x/callback', scope: SCOPES, state,
            code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
        });
        return redirect(res, 'https://x.com/i/oauth2/authorize?' + q);
    }

    if (url.pathname === '/x/callback') {
        const p = pending.get(url.searchParams.get('state') || '');
        if (!p) return redirect(res, RETURN_ORIGINS[0] + '/airdrop.html#xerr=state');
        pending.delete(url.searchParams.get('state'));
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, p.ret + '#xerr=denied');
        try {
            const profile = await exchange(code, p.verifier);
            return redirect(res, p.ret + '#x=' + b64url(JSON.stringify(profile)));
        } catch (e) {
            console.error('[airdrop-x]', e.message);
            return redirect(res, p.ret + '#xerr=api');
        }
    }

    res.writeHead(404); res.end();
}).listen(PORT, () => console.log('[airdrop-x] http://localhost:' + PORT + (CLIENT_ID ? '' : '  (X_CLIENT_ID missing: sign-in disabled)')));
