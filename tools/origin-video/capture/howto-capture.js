// Records the airdrop page for the HowTo video: one clip per scene plus where
// the things the voice talks about are on screen (for the highlight boxes).
//   node capture/howto-capture.js http://localhost:8095 <tmp dir>
// Needs the airdrop server running with AIRDROP_ONLY=1. Writes
// public/howto/<scene>.mp4 and public/howto/rects.json.
// From 'card' on, /api/airdrop/me answers with a sample account (@pillwarsdotfun
// and a sample wallet): locally there is no Sign in with X.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WS = require('../../../node_modules/ws');

const BASE = process.argv[2] || 'http://localhost:8095';
const TMP = process.argv[3] || path.join(require('os').tmpdir(), 'howto-capture');
const OUT = path.join(__dirname, '..', 'public', 'howto');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VW = 1280, VH = 720, DPR = 1.5, FPS = 30;
const wait = ms => new Promise(r => setTimeout(r, ms));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sampleWallet = Array.from({ length: 44 }, (_, i) => B58[(i * 37 + 11) % B58.length]).join('');
const today = new Date().toISOString().slice(0, 10);
const FAKE_ME = {
    user: {
        code: 'pill7xq', wallet: sampleWallet, walletPasted: false, invites: 3, pendingInvites: 1, referred: false,
        x: { id: '1', username: 'pillwarsdotfun', name: 'Pillwars', verified: true, created_at: '2024-02-28T17:54:10Z', followers: 1520, following: 28, posts: 22,
            pic: 'https://pbs.twimg.com/profile_images/2098348662040449034/5lHWtABC_normal.png' },
        chain: { txs: 2159, firstAt: Math.floor(Date.now() / 1000) - 1171 * 86400, capped: false, nfts: ['saga'], airdrops: ['jto', 'pyth', 'w', 'bonk', 'me'] },
    },
    score: {
        gamePts: 340, socialPts: 500, shareAt: 0, tasks: { follow: true, tg: true },
        daily: { date: today, done: {}, matches: 0, kills: 0, social: {}, c: { pieces: 0, skills: 0, skillSet: [], skill: {}, splitKills: 0, splits: 0, picks: 0, virusPops: 0, gambleWins: 0 } },
        boosted: false, verified: 0, total: 0, match: null,
    },
};
// Runs before the page's own scripts on every load.
const FAKE_FETCH = `(() => {
  if (!sessionStorage.getItem('howtoFake')) return;
  const real = window.fetch, body = ${JSON.stringify(JSON.stringify(FAKE_ME))};
  window.fetch = (u, o) => String(u).includes('/api/airdrop/me') ? Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })) : real(u, o);
})();`;

(async () => {
    fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
    const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + path.join(TMP, 'prof'), '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
    let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch('http://127.0.0.1:9334/json')).json(); if (tabs.some(t => t.type === 'page')) break; } catch (e) {} await wait(300); }
    const ws = new WS(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    let id = 0; const pend = {}, handlers = [];
    ws.on('message', m => { const j = JSON.parse(m); if (j.id && pend[j.id]) { pend[j.id](j.result || j.error); delete pend[j.id]; } else if (j.method) handlers.forEach(h => h(j)); });
    const cmd = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r && r.result ? r.result.value : undefined; };
    const rect = async sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * ${DPR})); })()`);

    await cmd('Page.enable'); await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false });
    await cmd('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_FETCH });

    // Screencast frames of the current page, with their timestamps.
    let rec = null;
    handlers.push(j => {
        if (j.method !== 'Page.screencastFrame') return;
        cmd('Page.screencastFrameAck', { sessionId: j.params.sessionId });
        if (!rec) return;
        const f = path.join(rec.dir, String(rec.frames.length).padStart(5, '0') + '.jpg');
        fs.writeFileSync(f, Buffer.from(j.params.data, 'base64'));
        rec.frames.push({ f, t: j.params.metadata.timestamp });
    });
    const rects = {};
    async function record(scene, ms, during) {
        const dir = path.join(TMP, scene); fs.mkdirSync(dir, { recursive: true });
        rec = { dir, frames: [], start: Date.now() / 1000 };
        rects[scene] = {};
        await cmd('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * DPR, maxHeight: VH * DPR, everyNthFrame: 1 });
        if (during) await during(async (name, sel, t) => { rects[scene][name] = { t: t == null ? (Date.now() / 1000 - rec.start) : t, r: await rect(sel) }; });
        const left = rec.start + ms / 1000 - Date.now() / 1000; if (left > 0) await wait(left * 1000);
        await cmd('Page.stopScreencast');
        const { frames } = rec, start = rec.start, end = rec.start + ms / 1000; rec = null;
        // The first frame can carry the time the page last painted, long before
        // the recording started: nothing counts from before the start.
        for (const fr of frames) fr.t = Math.min(end, Math.max(start, fr.t));
        // Constant 30 fps: each frame lasts until the next one arrived.
        const list = frames.map((fr, i) => `file '${fr.f.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, ((frames[i + 1] ? frames[i + 1].t : end) - fr.t)).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].f.replace(/\\/g, '/')}'`;
        const lf = path.join(dir, 'list.txt'); fs.writeFileSync(lf, list);
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lf, '-vf', `fps=${FPS},scale=1920:1080:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', path.join(OUT, scene + '.mp4')]);
        console.log(scene, frames.length, 'frames');
    }
    const click = sel => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const scrollTo = (sel, off) => js(`window.scrollTo({ top: document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top + scrollY - ${off || 90}, behavior: 'smooth' })`);

    // 1. The start screen, already loaded and moving (the game behind it takes a while).
    await cmd('Page.navigate', { url: BASE + '/' });
    await wait(12000);
    await record('intro', 11000);

    // 2. Connect X.
    await click('#introEnter'); await wait(2500);
    await js('scrollTo(0, 0)'); await wait(500);
    await record('x', 6500, async mark => { await mark('cx', '#cX'); await mark('xbtn', '#xBtn'); });

    // 3. The wallet window: signature note, wallets, then the address typed in.
    await js(`document.getElementById('demoWallet').remove()`);
    await click('#wBtn'); await wait(400);
    await record('wallet', 10500, async mark => {
        await mark('safe', '.wsafe'); await mark('wallets', '.wopt');
        await mark('last', '.wopt[data-w="backpack"]');
        await wait(5600);
        await mark('paste', '.wpaste');
        await js(`document.getElementById('wPaste').focus()`);
        for (const ch of sampleWallet) { await cmd('Input.insertText', { text: ch }); await wait(35); }
    });
    await js(`document.getElementById('mWallet').hidden = true`);

    // 4. From here on, a connected sample account.
    await js(`sessionStorage.setItem('howtoFake', '1')`);
    await cmd('Page.reload'); await wait(7000);
    await click('#introEnter'); await wait(3000);
    await js('scrollTo(0, 0)'); await wait(600);
    await record('card', 9000, async mark => { await mark('cw', '#cW'); await mark('card', '#card'); });

    // 5. Boost quests.
    await scrollTo('.qpanel', 70); await wait(1500);
    await record('boost', 15800, async mark => {
        await mark('banner', '#boostBanner');
        await wait(2500);
        await js(`(() => { const q = document.getElementById('qSocial'); const g = [...q.querySelectorAll('.qgroup')].find(e => /ONE-TIME/.test(e.textContent)); q.scrollTo({ top: g.offsetTop - q.offsetTop - 4, behavior: 'smooth' }); })()`);
        await wait(1200);
        await mark('once', '#qSocial');
    });

    // 6. Daily Arena, further down.
    await record('arena', 7300, async mark => {
        await wait(600);
        await scrollTo('#arenaBlock', 40); await wait(1400);
        await mark('title', '#arenaBlock h2'); await mark('game', '#game');
    });

    // 7. THE GAME tab.
    await js('scrollTo({ top: 0, behavior: "smooth" })'); await wait(1500);
    await record('game', 9300, async mark => {
        await mark('tab', '[data-view="game"]');
        await wait(2600);
        await click('[data-view="game"]'); await wait(700);
        await mark('view', '#view-game');
        await wait(1500);
        await js('scrollBy({ top: 420, behavior: "smooth" })');
    });

    fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 1));
    ws.close(); edge.kill();
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
