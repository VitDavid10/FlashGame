'use strict';
/*
 * Airdrop routes for server/index.js.
 *
 *   /airdrop (or / with AIRDROP_ONLY), /airdrop-terms   the page and its terms
 *   /airdrop-auth/x/login|callback     Sign in with X (OAuth 2.0 + PKCE)
 *   POST /api/airdrop/card             stores a share image (PNG 1200x630)
 *   /c/<id>, /c/<id>.png               share link with og:image for X cards
 *
 * AIRDROP_ONLY=1 turns on the lockdown: every other page answers 404 and the
 * real site can't be browsed. The game is still served, but only inside the
 * airdrop page's iframe and to requests coming from it.
 *
 * SITE_CLOSED=1 goes one step further: EVERYTHING answers 404, the airdrop
 * included, and nothing is served to anyone. The only doors left open are the
 * private pass (/airdrop-unlock/<token>, minted from a shell on the server),
 * so the owner can still open the site in one browser, and the dApp Store
 * app's secret path (APP_PATH) with what the game loads from it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./airdrop-store.js');
const { createChain } = require('./airdrop-chain.js');
const { createScore } = require('./airdrop-score.js');
const { createAdmin } = require('./airdrop-admin.js');
const { PublicKey } = require('@solana/web3.js');

const CARD_MAX_BYTES = 1.5 * 1024 * 1024;
const CARD_W = 1200, CARD_H = 630;
const CARD_MAX_FILES = 20000;
const CARD_RATE = { max: 20, windowMs: 60 * 60 * 1000 };
const X_PENDING_TTL_MS = 10 * 60 * 1000;
const X_LOGIN_PER_MIN = 10, X_PENDING_MAX = 20000;
const X_SCOPES = 'tweet.read users.read';
// With AIRDROP_ONLY=1, the only static paths served (prefixes end in '/').
const LOCKDOWN_ALLOW = ['/game/', '/shared/', '/vendor/', '/fonts/', '/img/', '/snd/', '/video/', '/api/', '/info.css', '/info.js', '/cookies.js'];
// The legal pages the dApp Store listing links to: public even through the
// lockdown and the blackout (the store's reviewers open them).
const LEGAL_PAGES = ['/privacy.html', '/terms.html', '/contact.html'];
const SESSION_COOKIE = 'pwad';
// Private "let me in" pass for the owner while AIRDROP_ONLY hides the real site.
// Minted from a shell on the server itself, same as the admin dashboard link.
const UNLOCK_COOKIE = 'pwopen';
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_MAX_AGE_S = 90 * 24 * 3600;
const NONCE_TTL_MS = 5 * 60 * 1000;
const WALLET_MESSAGE = nonce => 'Sign in to PillWars Airdrop\n\nThis only proves you own this wallet. It costs nothing and moves no funds.\n\nNonce: ' + nonce;

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createAirdrop(opts) {
    const ROOT = opts.root;
    const ONLY = !!opts.only;
    const CLOSED = !!opts.closed;
    const adminPath = opts.adminPath || '';
    // The dApp Store app's secret alias of /game/ (APP_PATH): the app opens the
    // game there, so the lockdown lets it through like the admin panel.
    const appPath = opts.appPath || '';
    const clientIp = opts.clientIp;
    const log = opts.log || (() => {});
    const X_CLIENT_ID = process.env.X_CLIENT_ID || '';
    const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
    const CARD_DIR = process.env.AIRDROP_CARD_DIR || path.join(__dirname, 'airdrop-cards');
    const verifySignature = opts.verifySignature;
    // persist: false in the split's game hosts. They are forks of the same server
    // and would load this file at start and write that stale copy over the real
    // one when they stop; only the process that serves the airdrop owns it.
    const store = createStore({ file: opts.persist === false ? null : process.env.AIRDROP_DATA_FILE || path.join(__dirname, 'airdrop-data.json'), log });
    // Always mainnet: the game's SOL_RPC may point at devnet.
    const AIRDROP_RPC = process.env.AIRDROP_RPC || 'https://api.mainnet-beta.solana.com';
    const chain = createChain({ rpc: AIRDROP_RPC, log });
    // Real history for linked wallets, refreshed once a day (demo wallets have none).
    const syncChain = u => {
        if (!u || !u.wallet || u.wallet.startsWith('Demo') || !chain.stale(store.chainOf(u))) return;
        chain.refresh(u.wallet, st => store.setChain(u.wallet, st));
    };
    log('[airdrop] on-chain RPC ' + AIRDROP_RPC.replace(/([?&]api-key=)[^&]+/, '$1***'));
    // Real post ids to repost/like - keep this in sync with POSTS in airdrop.html.
    const POST_IDS = ['2104586375907729522', '2103911009433841817'];
    const score = createScore({ postIds: POST_IDS, inviteCountOf: store.inviteCount });
    const admin = createAdmin({ store, score, log, password: process.env.ADMIN_KEY });
    log('[airdrop] lockdown ' + (ONLY ? 'ON' : 'off') + ' | X client id ' + (X_CLIENT_ID ? 'set (' + X_CLIENT_ID.length + ' chars)' : 'MISSING') +
        ' | X client secret ' + (X_CLIENT_SECRET ? 'set (' + X_CLIENT_SECRET.length + ' chars)' : 'MISSING'));

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

    // The airdrop page with its link preview: always the generic card. Invite
    // links (?ref=, also in the daily post) used to show the player's points card,
    // and with few points that made the post look poor (David, 2-oct-2026).
    function sendHome(req, res, query) {
        fs.readFile(path.join(ROOT, 'airdrop.html'), 'utf8', (err, html) => {
            if (err) { res.writeHead(500); res.end(); return; }
            const origin = originOf(req);
            const ref = String(query.get('ref') || '').toLowerCase();
            const img = origin + '/img/airdrop-og.png?v=2';   // ?v: X caches previews by URL
            const url = origin + (HOME === '/' ? '/' : HOME) + (/^[a-z2-9]{7}$/.test(ref) ? '?ref=' + ref : '');
            const desc = 'Eat, grow and outplay rival pills. Play the Daily Arena, climb the ranking and earn airdrop points.';
            const og = `<meta property="og:type" content="website"><meta property="og:site_name" content="PillWars">
<meta property="og:title" content="PillWars"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="${CARD_W}"><meta property="og:image:height" content="${CARD_H}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@pillwarsdotfun">
<meta name="twitter:title" content="PillWars"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(html.replace('<!--OG-->', og));
        });
    }
    function sendFile(res, rel, type) {
        fs.readFile(path.join(ROOT, rel), (err, data) => {
            if (err) { res.writeHead(500); res.end(); return; }
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
            res.end(data);
        });
    }
    // Same 404.html as the real site (it only links back to /, the airdrop here).
    function notFound(req, res) {
        const text = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end('404 Not Found'); };
        const html = String(req.headers.accept || '').includes('text/html') && (req.method === 'GET' || req.method === 'HEAD');
        if (!html) return text();
        fs.readFile(path.join(ROOT, '404.html'), (err, data) => {
            if (err) return text();
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(req.method === 'HEAD' ? undefined : data);
        });
    }
    const redirect = (res, url, code) => { res.writeHead(code || 302, { Location: url, 'Cache-Control': 'no-store' }); res.end(); };

    /* ---------------- session ---------------- */
    function sessionToken(req) {
        const m = new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([A-Za-z0-9_-]{20,64})').exec(String(req.headers.cookie || ''));
        return m ? m[1] : null;
    }
    function setSession(req, res, token) {
        const secure = originOf(req).startsWith('https:') ? '; Secure' : '';
        res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_MAX_AGE_S + secure);
    }

    /* ---------------- owner's pass through the lockdown ---------------- */
    let unlockPass = null;   // { token, until }
    function mintUnlock() {
        unlockPass = { token: b64url(crypto.randomBytes(24)), until: Date.now() + UNLOCK_TTL_MS };
        log('[airdrop] site unlock link minted, valid for ' + Math.round(UNLOCK_TTL_MS / 3600000) + ' hours');
        return (process.env.AIRDROP_ORIGIN || 'https://pillwars.fun') + '/airdrop-unlock/' + unlockPass.token;
    }
    // Pase fijo del dueño (AIRDROP_UNLOCK_TOKEN en el .service): no caduca ni se pierde al
    // reiniciar. Para revocarlo, cambiar o borrar la variable.
    const FIXED_PASS = /^[A-Za-z0-9_-]{32,64}$/.test(process.env.AIRDROP_UNLOCK_TOKEN || '') ? process.env.AIRDROP_UNLOCK_TOKEN : null;
    const same = (x, y) => { const a = Buffer.from(String(x)), b = Buffer.from(y); return a.length === b.length && crypto.timingSafeEqual(a, b); };
    const isFixedPass = token => !!FIXED_PASS && same(token, FIXED_PASS);
    function unlockTokenOk(token) {
        if (isFixedPass(token)) return true;
        if (!unlockPass || Date.now() > unlockPass.until) return false;
        return same(token, unlockPass.token);
    }
    // The two paths that keep working with SITE_CLOSED=1: minting the pass
    // from a shell on the server, and opening it in a browser.
    function isUnlockPath(req, urlPath) {
        // The admin dashboard too: its link is minted the same way and the page checks its token.
        return urlPath.startsWith('/airdrop-unlock/') || urlPath === '/airdrop-admin' || urlPath.startsWith('/airdrop-admin/') ||
            ((urlPath === '/api/airdrop/unlock-link' || urlPath === '/api/airdrop/admin-link') && req.method === 'POST' && admin.fromServerItself(req));
    }
    function unlocked(req) {
        const m = new RegExp('(?:^|;\\s*)' + UNLOCK_COOKIE + '=([A-Za-z0-9_-]{20,64})').exec(String(req.headers.cookie || ''));
        return !!m && unlockTokenOk(m[1]);
    }
    // The app keeps playing through the blackout: its secret path, plus the
    // lockdown's allow-list (sounds, images, APIs...) when the page asking for
    // them is that path. Nothing else of the site comes back.
    function fromApp(req, urlPath) {
        if (!appPath) return false;
        if (urlPath === appPath || urlPath.startsWith(appPath + '/')) return true;
        const from = sameOriginReferer(req);
        return !!from && from.startsWith(appPath + '/') &&
            LOCKDOWN_ALLOW.some(p => p.endsWith('/') ? urlPath.startsWith(p) : urlPath === p);
    }
    // Same idea for the legal pages: the page itself, and what it (or its
    // info.css, which pulls the fonts) loads from the allow-list.
    function legal(req, urlPath) {
        if (LEGAL_PAGES.includes(urlPath)) return true;
        const from = sameOriginReferer(req);
        return !!from && (LEGAL_PAGES.includes(from) || from === '/info.css') &&
            LOCKDOWN_ALLOW.some(p => p.endsWith('/') ? urlPath.startsWith(p) : urlPath === p);
    }
    const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

    /* ---------------- participant API ---------------- */
    const nonces = new Map();      // nonce -> expiry
    const apiHits = new Map();
    const hitOk = (ip, max) => {
        const now = Date.now(), list = (apiHits.get(ip) || []).filter(t => now - t < 60000);
        list.push(now); apiHits.set(ip, list);
        if (apiHits.size > 50000) apiHits.clear();
        return list.length <= max;
    };
    async function readJson(req) {
        try { return JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); } catch (e) { return null; }
    }
    const arenaHits = new Map();
    // Real gameplay reports several events a minute (kills, skills, mass...);
    // give it a much higher budget than the rest of the API.
    const arenaHitOk = ip => {
        const now = Date.now(), list = (arenaHits.get(ip) || []).filter(t => now - t < 60000);
        list.push(now); arenaHits.set(ip, list);
        if (arenaHits.size > 50000) arenaHits.clear();
        return list.length <= 300;
    };
    async function handleApi(req, res, urlPath) {
        if (urlPath === '/api/airdrop/arena/stats') {
            if (!hitOk(clientIp(req), 30)) return json(res, 429, { error: 'rate' });
            const u = store.sessionUser(sessionToken(req));
            const st = u && admin.arenaStats(u.uid);
            return st ? json(res, 200, st) : json(res, 404, { error: 'no_stats' });
        }
        if (urlPath === '/api/airdrop/leaderboard') {
            if (!hitOk(clientIp(req), 30)) return json(res, 429, { error: 'rate' });
            const u = store.sessionUser(sessionToken(req));
            const by = new URLSearchParams(String(req.url || '').split('?')[1] || '').get('by') || 'pts';
            return json(res, 200, admin.leaderboard(u && u.uid, by));
        }
        if (urlPath === '/api/airdrop/me') {
            const u = store.sessionUser(sessionToken(req));
            syncChain(u);
            // Invited wallets are checked when they link; retry any lookup that failed.
            if (u) store.invitedOf(u).forEach(i => { if (!store.chainOf(i)) syncChain(i); });
            return json(res, 200, { user: store.publicView(u), score: u ? score.view(u) : null });
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'method' });
        if (sameOriginReferer(req) === null) return json(res, 403, { error: 'origin' });

        if (urlPath.startsWith('/api/airdrop/arena/') || urlPath === '/api/airdrop/quest/complete') {
            if (!arenaHitOk(clientIp(req))) return json(res, 429, { error: 'rate' });
            const u = store.sessionUser(sessionToken(req));
            if (!u) return json(res, 401, { error: 'no_session' });
            const body = await readJson(req);
            if (!body) return json(res, 400, { error: 'body' });
            let r;
            if (urlPath === '/api/airdrop/arena/begin') r = score.beginMatch(u);
            else if (urlPath === '/api/airdrop/arena/event') r = score.reportEvent(u, body);
            else if (urlPath === '/api/airdrop/arena/end') r = score.endMatch(u, body);
            // 'discord' is only credited by the Discord bot (claimDiscord below).
            else if (urlPath === '/api/airdrop/quest/complete') r = body.key === 'discord' ? { error: 'bad_key' } : score.completeTask(u, String(body.key || ''));
            else return json(res, 404, { error: 'not found' });
            if (r.error) return json(res, r.error === 'rate' ? 429 : r.error === 'not_linked' ? 403 : 409, { error: r.error });
            // Points, quests and the Daily Arena live on the user record: write it,
            // or a restart loses everything since the last unrelated save.
            store.save();
            return json(res, 200, { score: r.view });
        }
        if (!hitOk(clientIp(req), 30)) return json(res, 429, { error: 'rate' });

        if (urlPath === '/api/airdrop/discord-code') {
            const code = store.discordCode(sessionToken(req));
            return code ? json(res, 200, { code }) : json(res, 403, { error: 'not_linked' });
        }
        if (urlPath === '/api/airdrop/nonce') {
            const now = Date.now();
            for (const [k, t] of nonces) if (t < now) nonces.delete(k);
            if (nonces.size > 100000) nonces.clear();
            const nonce = b64url(crypto.randomBytes(16));
            nonces.set(nonce, now + NONCE_TTL_MS);
            return json(res, 200, { nonce, message: WALLET_MESSAGE(nonce) });
        }
        if (urlPath === '/api/airdrop/wallet') {
            const body = await readJson(req);
            if (!body) return json(res, 400, { error: 'body' });
            const ref = String(body.ref || '').slice(0, 16);
            let wallet;
            if (body.demo && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(originOf(req))) {
                wallet = 'Demo' + b64url(crypto.randomBytes(30)).replace(/[-_]/g, 'x').slice(0, 40);
            } else {
                const nonce = String(body.nonce || ''), exp = nonces.get(nonce);
                nonces.delete(nonce);
                if (!exp || exp < Date.now()) return json(res, 400, { error: 'nonce' });
                wallet = String(body.address || '');
                if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) || !Array.isArray(body.signature) || body.signature.length !== 64) return json(res, 400, { error: 'signature' });
                if (!verifySignature || !verifySignature(wallet, WALLET_MESSAGE(nonce), body.signature)) return json(res, 400, { error: 'signature' });
            }
            const r = store.linkWallet(sessionToken(req), wallet, ref);
            if (r.error) return json(res, 409, { error: r.error, user: store.publicView(r.user) });
            setSession(req, res, r.token);
            syncChain(r.user);
            return json(res, 200, { user: store.publicView(r.user), referred: r.referred });
        }
        if (urlPath === '/api/airdrop/wallet-paste') {
            const body = await readJson(req);
            const wallet = String(body && body.address || '').trim();
            // A real wallet address (on the curve): never a program or PDA, which could not receive the airdrop.
            let ok = false;
            try { ok = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) && PublicKey.isOnCurve(new PublicKey(wallet).toBytes()); } catch (e) {}
            if (!ok) return json(res, 400, { error: 'address' });
            const r = store.pasteWallet(sessionToken(req), wallet);
            if (r.error) return json(res, r.error === 'need_x' ? 403 : 409, { error: r.error, user: store.publicView(r.user || null) });
            log('[airdrop] wallet pasted (not signed) by ' + r.user.uid);
            syncChain(r.user);
            return json(res, 200, { user: store.publicView(r.user) });
        }
        if (urlPath === '/api/airdrop/unlink') {
            const body = await readJson(req);
            const what = body && (body.what === 'x' || body.what === 'wallet') ? body.what : null;
            if (!what) return json(res, 400, { error: 'what' });
            return json(res, 200, { user: store.publicView(store.unlink(sessionToken(req), what)) });
        }
        return json(res, 404, { error: 'not found' });
    }

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
    // Vuelta tras el login de X: por defecto la pagina del airdrop; el juego de la
    // app pasa su propia ruta (?ret=). Solo rutas locales simples, sin query ni
    // dominio ("//x" o "https:" se rechazan): nada de redirecciones abiertas.
    const xHandoff = new Map();   // codigo de un solo uso -> { token, h, ret, exp }
    const retOk = r => (typeof r === 'string' && /^\/(?!\/)[A-Za-z0-9_\-\/]{0,120}$/.test(r)) ? r : null;
    async function handleX(req, res, urlPath, query) {
        const now = Date.now();
        for (const [k, v] of xPending) if (now - v.t > X_PENDING_TTL_MS) xPending.delete(k);
        if (urlPath === '/airdrop-auth/x/login') {
            if (!X_CLIENT_ID) return redirect(res, HOME + '#xerr=config');
            // Each start keeps a pending state for 10 minutes: cap how fast one IP can
            // open them, and how many can be open at once.
            if (!hitOk('xlogin:' + clientIp(req), X_LOGIN_PER_MIN) || xPending.size >= X_PENDING_MAX) return redirect(res, HOME + '#xerr=rate');
            const verifier = b64url(crypto.randomBytes(32)), state = b64url(crypto.randomBytes(16));
            const redirectUri = originOf(req) + '/airdrop-auth/x/callback';
            // app=1: el login va por el NAVEGADOR del movil (dentro del WebView X
            // acababa abriendo su propia app y no volvia). Al final se vuelve a la
            // app por pillwars://xlogin con un codigo de un solo uso, atado a un
            // secreto que la app guardo antes de salir (h = sha256 del secreto).
            const h = /^[A-Za-z0-9_-]{43}$/.test(query.get('h') || '') ? query.get('h') : null;
            xPending.set(state, { verifier, redirectUri, t: now, ret: retOk(query.get('ret')), app: query.get('app') === '1' && !!h, h });
            const q = new URLSearchParams({
                response_type: 'code', client_id: X_CLIENT_ID, redirect_uri: redirectUri, scope: X_SCOPES, state,
                code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
            });
            return redirect(res, 'https://x.com/i/oauth2/authorize?' + q);
        }
        if (urlPath === '/airdrop-auth/x/callback') {
            const state = query.get('state') || '', p = xPending.get(state);
            if (!p) { log('[airdrop] X callback: unknown or expired state'); return redirect(res, HOME + '#xerr=state'); }
            xPending.delete(state);
            const code = query.get('code');
            const vuelta = p.ret || HOME;
            const alApp = q => redirect(res, 'pillwars://xlogin?' + q);
            if (!code) { log('[airdrop] X callback: no code (' + (query.get('error') || 'denied') + ')'); return p.app ? alApp('err=denied') : redirect(res, vuelta + '#xerr=denied'); }
            try {
                const profile = await xExchange(code, p.verifier, p.redirectUri);
                const r = store.linkX(sessionToken(req), profile);
                log('[airdrop] X linked @' + profile.username + (sessionToken(req) ? ' (existing session)' : ' (new session)'));
                setSession(req, res, r.token);
                if (p.app) {
                    const t = b64url(crypto.randomBytes(24));
                    for (const [k, v] of xHandoff) if (v.exp < now) xHandoff.delete(k);
                    xHandoff.set(t, { token: r.token, h: p.h, ret: p.ret, exp: now + 2 * 60 * 1000 });
                    return alApp('t=' + t);
                }
                return redirect(res, vuelta + '#x=ok');
            } catch (e) {
                log('[airdrop] X sign-in failed: ' + e.message);
                return p.app ? alApp('err=api') : redirect(res, vuelta + '#xerr=api');
            }
        }
        // La app canjea el codigo de pillwars://xlogin DENTRO de su WebView: aqui
        // recibe la cookie de sesion. Un solo uso, 2 minutos, y solo con el
        // secreto cuyo hash mando al empezar (una app que robara el enlace no lo tiene).
        if (urlPath === '/airdrop-auth/x/handoff') {
            const t = query.get('t') || '', sec = query.get('s') || '', hit = xHandoff.get(t);
            xHandoff.delete(t);
            if (!hit || hit.exp < now || !sec) return redirect(res, (hit && hit.ret || HOME) + '#xerr=state');
            const hs = b64url(crypto.createHash('sha256').update(sec).digest());
            if (!same(hs, hit.h)) { log('[airdrop] X handoff: bad secret'); return redirect(res, (hit.ret || HOME) + '#xerr=state'); }
            setSession(req, res, hit.token);
            return redirect(res, (hit.ret || HOME) + '#x=ok');
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
        // The invite code comes from the session, never from the page.
        const ref = store.codeOf(sessionToken(req));
        const kind = req.headers['x-airdrop-kind'] === 'run' ? 'run' : 'card';
        try {
            await fs.promises.mkdir(CARD_DIR, { recursive: true });
            const count = (await fs.promises.readdir(CARD_DIR)).length;
            if (count / 2 >= CARD_MAX_FILES) return json(507, { error: 'full' });
            const id = b64url(crypto.randomBytes(9));
            await fs.promises.writeFile(path.join(CARD_DIR, id + '.png'), buf);
            await fs.promises.writeFile(path.join(CARD_DIR, id + '.json'), JSON.stringify({ ref, kind, t: Date.now() }));
            if (kind === 'card') store.setCard(sessionToken(req), id);
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
            // X prints og:title on top of the image: short and always the same.
            const title = 'PillWars';
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
        // The owner's browser carries a pass: serve the real site as if there
        // were no lockdown (see mintUnlock). '/' keeps showing the airdrop page,
        // so the real landing is at /index.html while this is on.
        if (unlocked(req)) return false;
        if (adminPath && (urlPath === adminPath || urlPath.startsWith(adminPath + '/'))) return false;
        if (appPath && (urlPath === appPath || urlPath.startsWith(appPath + '/'))) return false;
        if (LEGAL_PAGES.includes(urlPath)) return false;
        if (urlPath === '/robots.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            // X's card crawler obeys robots.txt: /c/, invite links (/?ref=...) and the
            // generic preview image must stay allowed or posts show no card.
            res.end('User-agent: *\nAllow: /$\nAllow: /?ref=\nAllow: /airdrop-terms\nAllow: /c/\nAllow: /img/airdrop-og.png\nDisallow: /\n');
            return true;
        }
        // The game page only inside the airdrop iframe.
        if (urlPath === '/game/' || urlPath === '/game/index.html') {
            const from = sameOriginReferer(req);
            // Some in-app browsers (older iOS WebViews, like X's) send no Sec-Fetch-* at all:
            // there the same-origin Referer alone decides. A typed URL still has neither.
            const dest = req.headers['sec-fetch-dest'];
            const ok = (dest === 'iframe' || dest === undefined) && (from === '/' || (from || '').startsWith('/airdrop'));
            if (!ok) { notFound(req, res); return true; }
            return false;
        }
        if (isDocument(req) || /\.html?$/i.test(urlPath)) { notFound(req, res); return true; }
        // Headers can be forged with curl, so on top of that only what the airdrop
        // page and the game actually load is served. Everything else is a 404.
        if (!LOCKDOWN_ALLOW.some(p => p.endsWith('/') ? urlPath.startsWith(p) : urlPath === p)) { notFound(req, res); return true; }
        // Scripts, images, fonts and API calls only for pages already on the site.
        // The generic link preview is the exception: X's crawler sends no Referer.
        if (sameOriginReferer(req) === null && urlPath !== '/img/airdrop-og.png') { notFound(req, res); return true; }
        return false;
    }

    /** true = the request was answered here. */
    async function handle(req, res, urlPath, query) {
        // Blackout: only the private pass answers, everything else is a 404.
        if (CLOSED && !unlocked(req) && !isUnlockPath(req, urlPath) && !fromApp(req, urlPath) && !legal(req, urlPath)) { notFound(req, res); return true; }
        const isHome = ONLY ? urlPath === '/' : (urlPath === '/airdrop' || urlPath === '/airdrop/');
        if (isHome) { sendHome(req, res, query); return true; }
        if (ONLY && (urlPath === '/airdrop' || urlPath === '/airdrop/')) { redirect(res, '/', 301); return true; }
        if (urlPath === '/airdrop-terms') { sendFile(res, 'airdrop-terms.html', 'text/html; charset=utf-8'); return true; }
        if (urlPath === '/airdrop.html') { redirect(res, HOME, 301); return true; }
        if (urlPath === '/airdrop-terms.html') { redirect(res, '/airdrop-terms', 301); return true; }
        if (urlPath.startsWith('/airdrop-auth/')) { await handleX(req, res, urlPath, query); return true; }
        // Private dashboard: the link is minted from a shell on the server (see airdrop-admin.js).
        if (urlPath === '/api/airdrop/admin-link') {
            if (req.method !== 'POST' || !admin.fromServerItself(req)) { notFound(req, res); return true; }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(admin.mint() + '\n');
            return true;
        }
        // Same minting rule as the admin link: only from a shell on the server.
        if (urlPath === '/api/airdrop/unlock-link') {
            if (req.method !== 'POST' || !admin.fromServerItself(req)) { notFound(req, res); return true; }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(mintUnlock() + '\n');
            return true;
        }
        if (urlPath.startsWith('/airdrop-unlock/')) {
            if (!hitOk('unlock:' + clientIp(req), 20)) { notFound(req, res); return true; }
            const token = urlPath.slice('/airdrop-unlock/'.length);
            if (req.method !== 'GET' || !unlockTokenOk(token)) { notFound(req, res); return true; }
            const secure = originOf(req).startsWith('https:') ? '; Secure' : '';
            // Con el pase fijo la cookie dura lo máximo que aceptan los navegadores (400 días).
            const maxAge = isFixedPass(token) ? 400 * 24 * 3600 : Math.round(UNLOCK_TTL_MS / 1000);
            res.setHeader('Set-Cookie', UNLOCK_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + secure);
            log('[airdrop] site unlocked for one browser');
            redirect(res, '/game/', 302);
            return true;
        }
        // Fixed entry: the admin password opens a dashboard link of its own.
        if (urlPath === '/airdrop-admin') {
            const noStore = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
            if (req.method === 'GET') { res.writeHead(200, noStore); res.end(admin.loginPage('')); return true; }
            if (req.method !== 'POST') { notFound(req, res); return true; }
            if (!hitOk('adminlogin:' + clientIp(req), 5)) { res.writeHead(429, noStore); res.end(admin.loginPage('Too many tries. Wait a minute.')); return true; }
            let pass = '';
            try { pass = new URLSearchParams((await readBody(req, 2048)).toString('utf8')).get('password') || ''; } catch (e) {}
            const token = admin.login(pass);
            if (!token) { log('[airdrop] wrong admin password from ' + clientIp(req)); res.writeHead(401, noStore); res.end(admin.loginPage('Wrong password.')); return true; }
            res.writeHead(303, { Location: '/airdrop-admin/' + token, 'Cache-Control': 'no-store' }); res.end();
            return true;
        }
        if (urlPath.startsWith('/airdrop-admin/')) {
            if (!hitOk('admin:' + clientIp(req), 20)) { notFound(req, res); return true; }
            const rest = urlPath.slice('/airdrop-admin/'.length);
            const discardMatch = rest.match(/^([^/]+)\/discard$/);
            const deleteMatch = rest.match(/^([^/]+)\/delete$/);
            const token = discardMatch ? discardMatch[1] : deleteMatch ? deleteMatch[1] : rest;
            if (deleteMatch) {
                if (req.method !== 'POST') { notFound(req, res); return true; }
                const body = await readJson(req);
                const ok = body && typeof body.uid === 'string' && admin.removeUser(token, body.uid);
                json(res, ok ? 200 : 403, { ok: !!ok });
                return true;
            }
            if (discardMatch) {
                if (req.method !== 'POST') { notFound(req, res); return true; }
                const body = await readJson(req);
                const ok = body && typeof body.uid === 'string' && admin.setDiscarded(token, body.uid, !!body.on);
                json(res, ok ? 200 : 403, { ok: !!ok });
                return true;
            }
            if (req.method !== 'GET' || !admin.valid(token)) { notFound(req, res); return true; }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
            res.end(admin.page());
            return true;
        }
        if (urlPath === '/api/airdrop/card') { await handleCardUpload(req, res); return true; }
        if (urlPath.startsWith('/api/airdrop/')) {
            // A bug here must answer 500 (and show in the log), not leave the page's request hanging.
            try { await handleApi(req, res, urlPath); }
            catch (e) {
                log('[airdrop] ' + urlPath + ' failed: ' + (e && e.stack || e));
                if (!res.headersSent) json(res, 500, { error: 'server' });
            }
            return true;
        }
        if (urlPath.startsWith('/c/')) { handleCard(req, res, urlPath); return true; }
        if (!ONLY) return false;
        return gate(req, res, urlPath);
    }

    /** Discord "Claim Genesis Hunter": the code from the page, pasted by `discordId`. */
    function claimDiscord(code, discordId) {
        const r = store.claimDiscord(code, discordId);
        if (r.error) return r;
        score.completeTask(r.user, 'discord');
        log('[airdrop] Genesis Hunter: ' + r.user.uid + ' <- discord ' + discordId);
        return { ok: true };
    }

    // La cuenta de X de esta peticion (cookie de sesion del airdrop), para que el
    // juego guarde los SP en ella. null sin sesion o sin X enlazada.
    // Sin X, la wallet firmada de la sesion tambien vale como cuenta.
    function xAccountOf(req) {
        const u = store.sessionUser(sessionToken(req));
        if (u && u.x && u.x.id) return { id: 'x_' + u.x.id, x: u.x, wallet: u.wallet || null };
        if (u && u.wallet && !u.walletPasted) return { id: 'w_' + u.wallet, x: null, wallet: u.wallet };
        return null;
    }
    return { handle, only: ONLY, closed: CLOSED, claimDiscord, flush: store.flush, xAccountOf };
}

module.exports = { createAirdrop };
