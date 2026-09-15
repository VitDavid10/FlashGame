'use strict';
/*
 * Airdrop routes for server/index.js.
 *
 *   /airdrop (or / with AIRDROP_ONLY), /airdrop-terms   the page and its terms
 *   /airdrop-auth/x/login|callback     Sign in with X (OAuth 2.0 + PKCE)
 *   POST /api/airdrop/card             stores a share image (PNG 1200x675)
 *   /c/<id>, /c/<id>.png               share link with og:image for X cards
 *
 * AIRDROP_ONLY=1 turns on the lockdown: every other page answers 404 and the
 * real site can't be browsed. The game is still served, but only inside the
 * airdrop page's iframe and to requests coming from it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CARD_MAX_BYTES = 1.5 * 1024 * 1024;
const CARD_W = 1200, CARD_H = 675;
const CARD_MAX_FILES = 20000;
const CARD_RATE = { max: 20, windowMs: 60 * 60 * 1000 };
const X_PENDING_TTL_MS = 10 * 60 * 1000;
const X_SCOPES = 'tweet.read users.read';

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOT_FOUND_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>404 - PillWars</title><link rel="icon" href="/img/web.png">
<style>@font-face{font-family:'Press Start 2P';src:url(/fonts/press-start-2p-latin.woff2) format('woff2')}
html,body{margin:0;height:100%;background:#050505;color:#8fa89a;font-family:'Press Start 2P',monospace;text-align:center}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:0 16px;
background-image:linear-gradient(rgba(0,255,136,.07) 2px,transparent 2px),linear-gradient(90deg,rgba(0,255,136,.07) 2px,transparent 2px);background-size:64px 64px}
h1{margin:0;font-size:clamp(48px,14vw,120px);color:#00ff88;text-shadow:0 6px 0 #00a857,0 12px 0 #004d27}
p{margin:0;font-size:12px;line-height:2}</style></head>
<body><h1>404</h1><p>PAGE NOT FOUND</p></body></html>`;

function createAirdrop(opts) {
    const ROOT = opts.root;
    const ONLY = !!opts.only;
    const adminPath = opts.adminPath || '';
    const clientIp = opts.clientIp;
    const log = opts.log || (() => {});
    const X_CLIENT_ID = process.env.X_CLIENT_ID || '';
    const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
    const CARD_DIR = process.env.AIRDROP_CARD_DIR || path.join(__dirname, 'airdrop-cards');

    // With the lockdown on, the airdrop IS the home page (pillwars.fun/).
    const HOME = ONLY ? '/' : '/airdrop';
    const xPending = new Map();      // state -> { verifier, redirectUri, t }
    const cardHits = new Map();      // ip -> [timestamps]

    // Origin as the browser sees it (Caddy terminates TLS in production).
    function originOf(req) {
        const host = String(req.headers.host || 'localhost');
        const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
        const proto = local ? 'http' : 'https';
        return proto + '://' + host;
    }
    const sameOriginReferer = req => {
        const ref = String(req.headers.referer || '');
        if (!ref) return null;
        try { const u = new URL(ref); return u.origin === originOf(req) ? u.pathname : null; } catch (e) { return null; }
    };

    function sendFile(res, rel, type) {
        fs.readFile(path.join(ROOT, rel), (err, data) => {
            if (err) { res.writeHead(500); res.end(); return; }
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
            res.end(data);
        });
    }
    function notFound(req, res) {
        const html = String(req.headers.accept || '').includes('text/html') && (req.method === 'GET' || req.method === 'HEAD');
        res.writeHead(404, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : (html ? NOT_FOUND_HTML : '404 Not Found'));
    }
    const redirect = (res, url, code) => { res.writeHead(code || 302, { Location: url, 'Cache-Control': 'no-store' }); res.end(); };

    /* ---------------- Sign in with X ---------------- */
    async function xExchange(code, verifier, redirectUri) {
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(X_CLIENT_ID + ':' + X_CLIENT_SECRET).toString('base64');
        const body = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: X_CLIENT_ID, redirect_uri: redirectUri, code_verifier: verifier });
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
    async function handleX(req, res, urlPath, query) {
        const now = Date.now();
        for (const [k, v] of xPending) if (now - v.t > X_PENDING_TTL_MS) xPending.delete(k);
        if (urlPath === '/airdrop-auth/x/login') {
            if (!X_CLIENT_ID) return redirect(res, HOME + '#xerr=config');
            const verifier = b64url(crypto.randomBytes(32)), state = b64url(crypto.randomBytes(16));
            const redirectUri = originOf(req) + '/airdrop-auth/x/callback';
            xPending.set(state, { verifier, redirectUri, t: now });
            const q = new URLSearchParams({
                response_type: 'code', client_id: X_CLIENT_ID, redirect_uri: redirectUri, scope: X_SCOPES, state,
                code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
            });
            return redirect(res, 'https://x.com/i/oauth2/authorize?' + q);
        }
        if (urlPath === '/airdrop-auth/x/callback') {
            const state = query.get('state') || '', p = xPending.get(state);
            if (!p) return redirect(res, HOME + '#xerr=state');
            xPending.delete(state);
            const code = query.get('code');
            if (!code) return redirect(res, HOME + '#xerr=denied');
            try {
                const profile = await xExchange(code, p.verifier, p.redirectUri);
                return redirect(res, HOME + '#x=' + b64url(JSON.stringify(profile)));
            } catch (e) {
                log('[airdrop] X sign-in failed: ' + e.message);
                return redirect(res, HOME + '#xerr=api');
            }
        }
        return notFound(req, res);
    }

    /* ---------------- share cards ---------------- */
    const CARD_ID = /^[A-Za-z0-9_-]{12}$/;
    function rateOk(ip) {
        const now = Date.now(), list = (cardHits.get(ip) || []).filter(t => now - t < CARD_RATE.windowMs);
        if (list.length >= CARD_RATE.max) { cardHits.set(ip, list); return false; }
        list.push(now); cardHits.set(ip, list);
        if (cardHits.size > 50000) cardHits.clear();
        return true;
    }
    function readBody(req, max) {
        return new Promise((resolve, reject) => {
            const chunks = []; let size = 0;
            req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });
    }
    const isCardPng = buf => buf.length > 33 &&
        buf.readUInt32BE(0) === 0x89504E47 && buf.readUInt32BE(4) === 0x0D0A1A0A &&
        buf.toString('ascii', 12, 16) === 'IHDR' && buf.readUInt32BE(16) === CARD_W && buf.readUInt32BE(20) === CARD_H;

    async function handleCardUpload(req, res) {
        const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
        if (req.method !== 'POST') return json(405, { error: 'method' });
        if (sameOriginReferer(req) === null) return json(403, { error: 'origin' });
        if (!rateOk(clientIp(req))) return json(429, { error: 'rate' });
        let buf;
        try { buf = await readBody(req, CARD_MAX_BYTES); } catch (e) { return json(413, { error: 'size' }); }
        if (!isCardPng(buf)) return json(400, { error: 'image' });
        const ref = String(req.headers['x-airdrop-ref'] || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
        const kind = req.headers['x-airdrop-kind'] === 'run' ? 'run' : 'card';
        try {
            await fs.promises.mkdir(CARD_DIR, { recursive: true });
            const count = (await fs.promises.readdir(CARD_DIR)).length;
            if (count / 2 >= CARD_MAX_FILES) return json(507, { error: 'full' });
            const id = b64url(crypto.randomBytes(9));
            await fs.promises.writeFile(path.join(CARD_DIR, id + '.png'), buf);
            await fs.promises.writeFile(path.join(CARD_DIR, id + '.json'), JSON.stringify({ ref, kind, t: Date.now() }));
            return json(200, { url: originOf(req) + '/c/' + id });
        } catch (e) {
            log('[airdrop] card save failed: ' + e.message);
            return json(500, { error: 'save' });
        }
    }
    function handleCard(req, res, urlPath) {
        const m = /^\/c\/([^/.]+)(\.png)?$/.exec(urlPath);
        if (!m || !CARD_ID.test(m[1])) return notFound(req, res);
        const id = m[1];
        if (m[2]) {
            return fs.readFile(path.join(CARD_DIR, id + '.png'), (err, data) => {
                if (err) return notFound(req, res);
                res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
                res.end(data);
            });
        }
        fs.readFile(path.join(CARD_DIR, id + '.json'), 'utf8', (err, raw) => {
            if (err) return notFound(req, res);
            let meta = {}; try { meta = JSON.parse(raw); } catch (e) {}
            const origin = originOf(req);
            const img = origin + '/c/' + id + '.png';
            const dest = HOME + (meta.ref ? '?ref=' + encodeURIComponent(meta.ref) : '');
            const title = meta.kind === 'run' ? 'PillWars Daily Arena' : 'PillWars';
            const desc = meta.kind === 'run' ? 'Think you can beat this run? Play the Daily Arena.' : 'Eat, grow and outplay rival pills. Where do you rank?';
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="PillWars">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + '/c/' + id)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="${CARD_W}"><meta property="og:image:height" content="${CARD_H}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@pillwarsdotfun">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${esc(dest)}"></head>
<body style="background:#050505"><a href="${esc(dest)}" style="color:#00ff88">Continue</a></body></html>`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
            res.end(req.method === 'HEAD' ? undefined : html);
        });
    }

    /* ---------------- lockdown ---------------- */
    const isDocument = req => {
        const dest = String(req.headers['sec-fetch-dest'] || '');
        if (dest) return dest === 'document' || dest === 'frame' || dest === 'iframe' || dest === 'embed' || dest === 'object';
        return String(req.headers.accept || '').includes('text/html');
    };
    function gate(req, res, urlPath) {
        if (adminPath && (urlPath === adminPath || urlPath.startsWith(adminPath + '/'))) return false;
        if (urlPath === '/robots.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            // /c/ must stay allowed: X's card crawler obeys robots.txt.
            res.end('User-agent: *\nAllow: /$\nAllow: /airdrop-terms\nAllow: /c/\nDisallow: /\n');
            return true;
        }
        // The game page only inside the airdrop iframe.
        if (urlPath === '/game/' || urlPath === '/game/index.html') {
            const from = sameOriginReferer(req);
            const ok = req.headers['sec-fetch-dest'] === 'iframe' && (from === '/' || (from || '').startsWith('/airdrop'));
            if (!ok) { notFound(req, res); return true; }
            return false;
        }
        if (isDocument(req) || /\.html?$/i.test(urlPath)) { notFound(req, res); return true; }
        // Scripts, images, fonts and API calls only for pages already on the site.
        if (sameOriginReferer(req) === null) { notFound(req, res); return true; }
        return false;
    }

    /** true = the request was answered here. */
    async function handle(req, res, urlPath, query) {
        const isHome = ONLY ? urlPath === '/' : (urlPath === '/airdrop' || urlPath === '/airdrop/');
        if (isHome) { sendFile(res, 'airdrop.html', 'text/html; charset=utf-8'); return true; }
        if (ONLY && (urlPath === '/airdrop' || urlPath === '/airdrop/')) { redirect(res, '/', 301); return true; }
        if (urlPath === '/airdrop-terms') { sendFile(res, 'airdrop-terms.html', 'text/html; charset=utf-8'); return true; }
        if (urlPath === '/airdrop.html') { redirect(res, HOME, 301); return true; }
        if (urlPath === '/airdrop-terms.html') { redirect(res, '/airdrop-terms', 301); return true; }
        if (urlPath.startsWith('/airdrop-auth/')) { await handleX(req, res, urlPath, query); return true; }
        if (urlPath === '/api/airdrop/card') { await handleCardUpload(req, res); return true; }
        if (urlPath.startsWith('/c/')) { handleCard(req, res, urlPath); return true; }
        if (!ONLY) return false;
        return gate(req, res, urlPath);
    }

    return { handle, only: ONLY };
}

module.exports = { createAirdrop, NOT_FOUND_HTML };
