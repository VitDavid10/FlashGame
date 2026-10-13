// Kit for the "Demo" video captures (capture/demo-capture.js): a local game
// server of its own, Edge driven over CDP, a stand-in wallet and "puppets".
//
// Everything runs against a LOCAL server started from `root` (a checkout of the
// repo; a separate worktree keeps the server's json files apart from the ones
// in the working copy). Nothing here talks to pillwars.fun or to devnet:
//   - The wallet is a test keypair (seeded, so the address never changes). The
//     page gets a Phantom-like provider whose signMessage is signed here, in
//     node, so the server checks a real ed25519 signature. Its $PILLY "in GAME"
//     balance is written into that server's warbalances.json before it starts.
//   - The airdrop account (X handle, wallet) is answered by a fetch stub, and
//     the friends/groups token is signed with the secret this server is given.
//   - Puppets are test players run from here over the game's own websocket
//     protocol: each one pays its entry with its own test keypair, so the money
//     the video shows (carry, pots, the loot of a PENTAKILL) is the real server's.
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const req = m => require(path.join(REPO, 'node_modules', m));
const WS = req('ws'), nacl = req('tweetnacl'), bs58 = req('bs58');
const B58 = bs58.default || bs58;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- test keypairs ----------
function keypair(name) {
    const kp = nacl.sign.keyPair.fromSeed(crypto.createHash('sha256').update('pw-demo-' + name).digest());
    return { address: B58.encode(Buffer.from(kp.publicKey)), sign: msg => Array.from(nacl.sign.detached(Buffer.from(msg, 'utf8'), kp.secretKey)) };
}

// ---------- server ----------
const ADMIN_KEY = 'demo-admin-key', SOCIAL_SECRET = 'demo-social-secret';
function startServer({ root, port, balances }) {
    // Balances first: the server reads the file once, when it starts.
    const f = path.join(root, 'server', 'warbalances.json');
    let j = { balances: {}, sigs: {} }; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    Object.assign(j.balances, balances || {});
    fs.writeFileSync(f, JSON.stringify(j));
    // Fixed price ($1 = 1,000 $PILLY, oracle off) and the $ shown next to it to match.
    const g = path.join(root, 'server', 'globalsettings.json');
    let gj = {}; try { gj = JSON.parse(fs.readFileSync(g, 'utf8')); } catch (e) {}
    Object.assign(gj, { pillUsd: 0.001, pillPerDollar: 1000 });
    fs.writeFileSync(g, JSON.stringify(gj));
    const env = Object.assign({}, process.env, { PORT: String(port), ADMIN_KEY, PW_SOCIAL_SECRET: SOCIAL_SECRET, PILL_PER_DOLLAR: '1000' });
    const proc = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const logf = fs.createWriteStream(path.join(root, 'demo-server.log'));
    proc.stdout.pipe(logf); proc.stderr.pipe(logf);
    return proc;
}
async function waitHttp(url) { for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) return; } catch (e) {} await wait(500); } throw new Error('server did not start: ' + url); }

// Admin command over the game websocket (rules of a room, forceStart...).
function admin(port, msg) {
    return new Promise(res => {
        const ws = new WS('ws://localhost:' + port);
        ws.on('open', () => { ws.send(JSON.stringify(Object.assign({ t: 'admin', key: ADMIN_KEY }, msg))); setTimeout(() => { ws.close(); res(); }, 400); });
        ws.on('error', () => res());
    });
}

// Friends/groups token, signed like server/social-token.js does with this server's secret.
function socialToken(p) {
    const body = Buffer.from(JSON.stringify({ id: p.id, u: p.u || '', n: p.n || '', p: p.p || '', w: p.w || '', exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', SOCIAL_SECRET).update(body).digest('base64url');
}

// ---------- Edge over CDP ----------
async function startEdge({ tmp, cdpPort, w, h }) {
    fs.mkdirSync(tmp, { recursive: true });
    const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + cdpPort, '--user-data-dir=' + path.join(tmp, 'prof-' + cdpPort),
        '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=' + w + ',' + h, 'about:blank'], { stdio: 'ignore' });
    let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); if (tabs.some(t => t.type === 'page')) break; } catch (e) {} await wait(300); }
    const ws = new WS(tabs.find(t => t.type === 'page').webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise(r => ws.on('open', r));
    let id = 0; const pend = {}, handlers = [];
    ws.on('message', m => { const j = JSON.parse(m); if (j.id && pend[j.id]) { pend[j.id](j.result || j.error); delete pend[j.id]; } else if (j.method) handlers.forEach(fn => fn(j)); });
    const cmd = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async expr => {
        const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
        return r && r.result ? r.result.value : undefined;
    };
    const kill = () => { try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} };
    return { proc, cmd, js, on: fn => handlers.push(fn), kill };
}

// Phantom-like provider + airdrop account stub, run before the page's own scripts.
function pageStub({ wallet, me, token }) {
    return `(() => {
  const addr = ${JSON.stringify(wallet)};
  const pk = { toString: () => addr, toBase58: () => addr, toBytes: () => new Uint8Array(32) };
  let n = 0; const waiting = {};
  window.__pwSigned = (i, sig) => { const f = waiting[i]; delete waiting[i]; if (f) f(new Uint8Array(sig)); };
  const prov = {
    isPhantom: true, publicKey: pk, isConnected: true,
    connect: async () => ({ publicKey: pk }), disconnect: async () => {},
    on() {}, off() {}, removeListener() {},
    signMessage: bytes => new Promise(res => { const i = ++n; waiting[i] = s => res({ signature: s, publicKey: pk }); window.__pwSign(JSON.stringify({ i, m: new TextDecoder().decode(bytes) })); }),
  };
  window.phantom = { solana: prov }; window.solana = prov;
  try { localStorage.setItem('pw_wallet', 'phantom'); localStorage.setItem('pw_addr', addr); } catch (e) {}
  const me = ${JSON.stringify(me)}, tok = ${JSON.stringify(token)};
  const real = window.fetch;
  const reply = j => Promise.resolve(new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (u, o) => {
    const s = String(u && u.url || u);
    if (s.includes('/api/airdrop/me')) return reply(me);
    if (s.includes('/api/airdrop/social-token')) return reply(tok);
    return real(u, o);
  };
})();`;
}
async function installStub(edge, kp, me, token) {
    await edge.cmd('Runtime.addBinding', { name: '__pwSign' });
    edge.on(j => {
        if (j.method !== 'Runtime.bindingCalled' || j.params.name !== '__pwSign') return;
        const { i, m } = JSON.parse(j.params.payload);
        edge.cmd('Runtime.evaluate', { expression: `window.__pwSigned(${i}, ${JSON.stringify(kp.sign(m))})` });
    });
    await edge.cmd('Page.addScriptToEvaluateOnNewDocument', { source: pageStub({ wallet: kp.address, me, token }) });
}

// ---------- screencast recorder ----------
// Frames as they come, with their timestamps; build() turns a stretch into a
// constant 30 fps mp4 (each frame lasts until the next one arrived).
function recorder(edge, { dir, w, h }) {
    let rec = null;
    edge.on(j => {
        if (j.method !== 'Page.screencastFrame') return;
        edge.cmd('Page.screencastFrameAck', { sessionId: j.params.sessionId });
        if (!rec) return;
        const f = path.join(rec.dir, String(rec.frames.length).padStart(6, '0') + '.jpg');
        fs.writeFileSync(f, Buffer.from(j.params.data, 'base64'));
        rec.frames.push({ f, t: j.params.metadata.timestamp });
    });
    return {
        async start(name) {
            const d = path.join(dir, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true });
            rec = { name, dir: d, frames: [], start: Date.now() / 1000, marks: [] };
            await edge.cmd('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
        },
        get on() { return !!rec; },
        mark(label, data) { if (rec) { rec.marks.push(Object.assign({ label, t: Date.now() / 1000 - rec.start }, data || {})); console.log('  mark', label, (Date.now() / 1000 - rec.start).toFixed(2)); } },
        async stop(out) {
            await edge.cmd('Page.stopScreencast');
            const r = rec; rec = null;
            const end = Date.now() / 1000;
            for (const fr of r.frames) fr.t = Math.min(end, Math.max(r.start, fr.t));
            const list = r.frames.map((fr, i) => `file '${fr.f.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, (r.frames[i + 1] ? r.frames[i + 1].t : end) - fr.t).toFixed(4)}`).join('\n') + `\nfile '${r.frames[r.frames.length - 1].f.replace(/\\/g, '/')}'`;
            const lf = path.join(r.dir, 'list.txt'); fs.writeFileSync(lf, list);
            // The clip starts at the first frame: marks are made relative to it.
            const t0 = r.frames[0].t - r.start;
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lf, '-vf', `fps=30,scale=${w}:${h}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', out]);
            const marks = r.marks.map(m => Object.assign({}, m, { t: +(m.t - t0).toFixed(2) }));
            console.log('clip', path.basename(out), r.frames.length, 'frames', (end - r.start).toFixed(1) + 's', 'fps~' + (r.frames.length / (end - r.start)).toFixed(1));
            return { frames: r.frames.length, secs: end - r.start - t0, marks };
        },
    };
}

// ---------- puppets ----------
// A test player over the game's websocket protocol. In a match it does what it
// is told: 'hold' (stays put), 'wander' (drifts around its spawn), 'avoid'
// (wanders, but moves away from `goal` when it gets close), 'near' (circles
// `goal` at 500-900 plus 4 radii of the filmed pill, waiting for its turn) or 'go' (heads for
// `goal`, which the capture feeds with the filmed player's position).
class Puppet {
    constructor({ port, name, kp, top = '#ffffff', bot = '#ff4d6d' }) {
        Object.assign(this, { port, name, kp, top, bot });
        this.mode = 'hold'; this.goal = null; this.pos = null; this.alive = false; this.dead = false; this.log = [];
    }
    pay(combo, fee) { const ts = Date.now(), message = `PillWars enter ${combo} paying ${fee} PILLY @ ${ts}`; return { wallet: this.kp.address, message, ts, signature: this.kp.sign(message) }; }
    // --- arenas lobby ---
    lobby() {
        if (this.lws) return Promise.resolve();
        return new Promise(res => {
            const ws = this.lws = new WS('ws://localhost:' + this.port);
            ws.on('open', () => {
                ws.send(JSON.stringify({ t: 'sq', a: 'hello', token: socialToken({ id: 'D' + this.name.toUpperCase().slice(0, 6), u: this.name, n: this.name, w: this.kp.address }), av: { t: 'pill', bg: '#14181a', top: this.top, bot: this.bot }, name: this.name }));
                res();
            });
            ws.on('message', d => { let m; try { m = JSON.parse(d); } catch (e) { return; } this.onLobby(m); });
            ws.on('error', e => this.log.push('lobby ' + e.message));
        });
    }
    sq(o) { this.lws.send(JSON.stringify(Object.assign({ t: 'sq' }, o))); }
    onLobby(m) {
        if (m.t === 'sqParty') { this.party = m; if (this.onParty) this.onParty(m); }
        else if (m.t === 'sqReadyCheck') {
            if (m.fee > 0) this.sq({ a: 'ready', v: true, pay: this.pay('arena_' + m.cents, m.fee) });
            else this.sq({ a: 'ready', v: true });
        }
        else if (m.t === 'sqTicket') { this.ticket = m; this.join({ t: 'join', squad: m.ticket, mode: m.mode, room: 'Free', name: this.name, colorTop: this.top, colorBot: this.bot, bin: 0, aspect: 1.78 }); }
        else if (m.t === 'sqErr') this.log.push('sqErr ' + JSON.stringify(m));
    }
    // --- a match ---
    join(msg, paidRetry) {
        const ws = this.gws = new WS('ws://localhost:' + this.port);
        ws.on('open', () => ws.send(JSON.stringify(msg)));
        ws.on('message', d => {
            let m; try { m = JSON.parse(d); } catch (e) { return; }
            if (m.t === 'payRequired' && !paidRetry) { try { ws.close(); } catch (e) {} const combo = msg.mode + '_' + msg.room; this.join(Object.assign({}, msg, { pay: this.pay(combo, m.fee) }), true); return; }
            if (m.t === 'payRequired') { this.log.push('pay refused ' + JSON.stringify(m)); return; }
            if (m.t === 'welcome' && m.id) this.id = m.id;
            if (m.t === 'matchStart' || (m.t === 'welcome' && m.state === 'playing')) ws.send(JSON.stringify({ t: 'ready' }));
            this.msgs = (this.msgs || 0) + 1;
            if (m.t === 'snap' && Array.isArray(m.players)) {
                const me = m.players.find(q => q.id === this.id);
                if (me && me.cells && me.cells.length) { let x = 0, y = 0, k = 0; for (const c of me.cells) { const w = c.r * c.r; x += c.x * w; y += c.y * w; k += w; } this.pos = { x: x / k, y: y / k, r: Math.max(...me.cells.map(c => c.r)) }; this.alive = true; if (me.alive !== false) this.dead = false; /* classic: the lobby before the match also 'kills' them */ if (!this.home) this.home = { x: this.pos.x, y: this.pos.y }; }
            }
            const evs = (m.t === 'events' && m.events) || (m.t === 'snap' && m.ev) || [];
            for (const ev of evs) if (this.id && ev.type === 'playerDied' && ev.playerId === this.id) { this.dead = true; this.alive = false; }
        });
        ws.on('error', e => this.log.push('game ' + e.message));
        clearInterval(this.iv);
        this.iv = setInterval(() => {
            if (ws.readyState !== 1 || !this.pos || this.dead) return;
            let tx = this.pos.x, ty = this.pos.y;
            if (this.mode === 'go' && this.goal) { tx = this.goal.x; ty = this.goal.y; }
            else if (this.mode === 'near' && this.goal) {
                // keeps 550-900 away from `goal`, circling it: close enough for a short charge, not close enough to be eaten
                const dx = this.pos.x - this.goal.x, dy = this.pos.y - this.goal.y, d = Math.hypot(dx, dy) || 1, lo = 500 + 4 * (this.goal.r || 0);
                if (d > lo + 400) { tx = this.goal.x; ty = this.goal.y; }
                else if (d < lo) { tx = this.pos.x + dx / d * 400; ty = this.pos.y + dy / d * 400; }
                else { tx = this.pos.x - dy / d * 300; ty = this.pos.y + dx / d * 300; }
            }
            else if (this.mode === 'avoid' && this.goal && Math.hypot(this.goal.x - this.pos.x, this.goal.y - this.pos.y) < 1100) { tx = this.pos.x + (this.pos.x - this.goal.x); ty = this.pos.y + (this.pos.y - this.goal.y); }
            else if ((this.mode === 'wander' || this.mode === 'avoid') && this.home) { const a = Date.now() / 2500 + this.name.length; tx = this.home.x + Math.cos(a) * 260; ty = this.home.y + Math.sin(a) * 260; }
            ws.send(JSON.stringify({ t: 'input', tx, ty }));
        }, 100);
    }
    close() { clearInterval(this.iv); try { this.gws && this.gws.close(); } catch (e) {} try { this.lws && this.lws.close(); } catch (e) {} this.gws = this.lws = null; this.dead = false; this.alive = false; this.pos = this.home = null; this.mode = 'hold'; }
}
// A puppet group queued in arenas (FIND RIVALS) at a price: the first creates the group, the rest join it.
async function arenaGroup(puppets, price) {
    for (const p of puppets) await p.lobby();
    const [lead, ...rest] = puppets;
    await new Promise(res => { lead.onParty = m => { if (m.code) { lead.onParty = null; res(); } }; lead.sq({ a: 'create', name: lead.name }); });
    for (const p of rest) { p.sq({ a: 'join', code: lead.party.code, name: p.name }); await wait(400); }
    await wait(600);
    lead.sq({ a: 'play', mode: 'arcade', price, ready: false });
}

module.exports = { Puppet, arenaGroup, REPO, WS, wait, keypair, startServer, waitHttp, admin, socialToken, startEdge, installStub, recorder, ADMIN_KEY };
