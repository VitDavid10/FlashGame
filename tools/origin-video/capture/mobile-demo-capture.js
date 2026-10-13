// Records the app (?app=1) in a phone-sized viewport for the "MobileDemo" video:
// stills of the mobile menu and its panels, and one offline CLASSIC match
// frame by frame (the game's clock is driven from here, so it comes out at an
// exact 30 fps even on a loaded PC). A tiny bot plays: it hunts what is smaller
// than it, runs from what is bigger and eats food otherwise.
//   node capture/mobile-demo-capture.js [seconds of match, default 36]
// Writes public/mobile-demo/*.jpg and public/mobile-demo/classic.mp4.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WS = require('../../../node_modules/ws');

const ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(__dirname, '..', 'public', 'mobile-demo');
const SECS = Number(process.argv[2] || 36);
const TMP = path.join(require('os').tmpdir(), 'pw-mobile-demo-' + Date.now());
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VW = 800, VH = 360, DPR = 2, FPS = 30, PORT = 8098, CDP = 9342;
const wait = ms => new Promise(r => setTimeout(r, ms));
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
}).listen(PORT);

(async () => {
    fs.mkdirSync(TMP, { recursive: true });
    fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
    const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(TMP, 'prof'), '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'], { stdio: 'ignore' });
    const fin = code => { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} server.close(); process.exit(code); };
    process.on('SIGINT', () => fin(1));
    try {
        let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch('http://127.0.0.1:' + CDP + '/json')).json(); if (tabs.some(t => t.type === 'page')) break; } catch (e) {} await wait(300); }
        const ws = new WS(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
        await new Promise(r => ws.on('open', r));
        let id = 0; const pend = {};
        ws.on('message', m => { const j = JSON.parse(m); if (j.id && pend[j.id]) { pend[j.id](j.result || j.error); delete pend[j.id]; } });
        const cmd = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
        const js = async expr => {
            const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
            return r && r.result ? r.result.value : undefined;
        };
        const shot = async (file, q = 82) => {
            const r = await cmd('Page.captureScreenshot', { format: 'jpeg', quality: q });
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        };
        const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
        const open = async () => {
            await cmd('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: true });
            await cmd('Page.navigate', { url: (process.env.BASE || 'http://localhost:' + PORT) + '/game/index.html?app=1' });
            for (let i = 0; i < 100; i++) { if (await js(`typeof startGame === 'function' && typeof PillSim !== 'undefined' && document.readyState === 'complete'`)) break; await wait(200); }
            await wait(3500);
        };
        await cmd('Page.enable'); await cmd('Runtime.enable');

        const hasPlay = () => js(`[...document.querySelectorAll('body *')].some(e => e.children.length === 0 && (e.innerText || '').trim().toUpperCase() === 'PLAY' && e.getBoundingClientRect().width > 20)`);
        // taps the title screen until the hub (the one with the PLAY button) shows
        const toHub = async () => { for (let i = 0; i < 5 && !(await hasPlay()); i++) { await click(VW / 2, VH / 2); await wait(3000); } await wait(1500); };
        // 1) the mobile menu: title screen, hub and each panel, as stills
        await open();
        await shot(path.join(OUT, 'title.jpg'));
        await toHub();
        await shot(path.join(OUT, 'menu.jpg'));
        const rectOf = text => js(`(() => { const t = ${JSON.stringify(text)}; const es = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && (e.innerText || '').trim().toUpperCase() === t); for (const e of es) { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); if (b.width > 4 && b.height > 4 && s.visibility !== 'hidden' && s.display !== 'none') return [b.x + b.width / 2, b.y + b.height / 2]; } return null; })()`);
        for (const name of ['ARENAS', 'THE PILL', 'STORE', 'QUESTS', 'PILLWARS CORE']) {
            const r = name === 'ARENAS' ? [120, 117] : await rectOf(name);
            console.log(name, r);
            if (!r) continue;
            await click(r[0], r[1]); await wait(2200);
            await shot(path.join(OUT, 'panel-' + name.toLowerCase().replace(/\W+/g, '-') + '.jpg'));
        }

        // 2) an offline CLASSIC match, frame by frame
        await open();
        await toHub();
        await js(`(() => {
            try { localStorage.clear(); } catch (e) {}
            currentGameMode = 'classic'; currentServer = 'clips'; roomStates = {}; roomTimers = {};
            startGame();
            const c = window.__vt = { p: performance.now(), d: Date.now(), q: [] };
            performance.now = () => c.p; Date.now = () => Math.round(c.d);
            window.requestAnimationFrame = f => { c.q.push(f); return c.q.length; };
            window.__paso = ms => { c.p += ms; c.d += ms; const q = c.q; c.q = []; for (const f of q) f(c.p); };
        })()`);
        await wait(800);
        const dir = path.join(TMP, 'classic'); fs.mkdirSync(dir, { recursive: true });
        const BOT = `(() => {
            const m = me(); const cs = m && m.cells; if (!cs || !cs.length) return;
            let x = 0, y = 0, R = 0; cs.forEach(c => { x += c.x; y += c.y; R = Math.max(R, c.r); }); x /= cs.length; y /= cs.length;
            let t = null, d0 = 1e9, flee = null, fd = 1e9;
            for (const e of sim.enemies) {
                const d = Math.hypot(e.x - x, e.y - y);
                if (e.r > R * 1.15 && d < 450 && d < fd) { fd = d; flee = e; }
                else if (e.r < R * 0.82 && d < 900 && d < d0) { d0 = d; t = e; }
            }
            if (!t) for (const f of sim.foods) { const d = Math.hypot(f.x - x, f.y - y); if (d < d0) { d0 = d; t = f; } }
            let tx = t ? t.x : x + 100, ty = t ? t.y : y;
            if (flee) { tx = x + (x - flee.x); ty = y + (y - flee.y); }
            const es = getViewScale(); mouse.x = width / 2 + (tx - camera.x) * es; mouse.y = height / 2 + (ty - camera.y) * es;
        })()`;
        const N = SECS * FPS;
        for (let i = 0; i < N; i++) {
            await js(`${BOT}; __paso(1000 / 60 + 0.01); __paso(1000 / 60 + 0.01); 0`);
            if (i === 100) await click(332, 188);   // picks the first skill offered
            await shot(path.join(dir, String(i).padStart(5, '0') + '.jpg'), 80);
            if (i % 90 === 0) console.log('frame', i, '/', N);
        }
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', path.join(OUT, 'classic.mp4')]);
        console.log('done');
        fin(0);
    } catch (e) { console.error(e); fin(1); }
})();
