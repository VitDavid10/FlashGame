// Graba los clips cortos del juego (BASICS y las 8 skills) en una partida
// offline, fotograma a fotograma: el reloj del juego (performance.now,
// Date.now y requestAnimationFrame) lo avanza este script, asi que salen a 30
// fps exactos aunque el PC vaya cargado. Camara mas cerca que en el juego y sin
// HUD (se captura solo el canvas).
//   node tools/origin-video/capture/clips-capture.js <salida> [clip,clip...]
// Escribe <salida>/<clip>.mp4 (960x540).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WS = require('../../../node_modules/ws');

const ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'video', 'clips'));
const SOLO = process.argv[3] ? process.argv[3].split(',') : null;
const TMP = path.join(require('os').tmpdir(), 'pw-clips');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VW = 960, VH = 540, FPS = 30, PORT = 8097, CDP = 9341;
const wait = ms => new Promise(r => setTimeout(r, ms));

// Servidor estatico del repo (el juego offline no necesita el servidor real).
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webp': 'image/webp', '.gif': 'image/gif' };
const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
}).listen(PORT);

(async () => {
    fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
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
            if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
            return r && r.result ? r.result.value : undefined;
        };
        await cmd('Page.enable'); await cmd('Runtime.enable');
        await cmd('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
        await cmd('Page.navigate', { url: 'http://localhost:' + PORT + '/game/index.html' });
        for (let i = 0; i < 100; i++) { if (await js(`typeof startGame === 'function' && typeof PillSim !== 'undefined' && document.readyState === 'complete'`)) break; await wait(200); }
        await wait(3000);

        const ctx = { js, cmd, frames: 0 };
        // Arranca una partida offline nueva y para el reloj del juego (a partir de aqui solo avanza con paso()).
        ctx.partida = async (modo) => {
            await js(`(() => {
                try { localStorage.clear(); } catch (e) {}
                currentGameMode = '${modo || 'arcade'}'; currentServer = 'clips';
                roomStates = {}; roomTimers = {};
                startGame();
                const p = me(); p.godMode = true; p.skillSlots = [null, null, null, null];
                __pwLab.nextSkillPickTime = 1e9;
                if (!window.__vt) {
                    const c = window.__vt = { p: performance.now(), d: Date.now(), q: [] };
                    performance.now = () => c.p; Date.now = () => Math.round(c.d);
                    window.requestAnimationFrame = f => { c.q.push(f); return c.q.length; };
                    window.__paso = ms => { c.p += ms; c.d += ms; const q = c.q; c.q = []; for (const f of q) f(c.p); };
                    // Zoom fijo por clip (window.__es, escala de mundo a pantalla); sin el, 1,6 veces el del juego.
                    const gv = getViewScale; window.getViewScale = () => window.__es || gv() * 1.6;
                    // Camara quieta en window.__cam ({x, y}) si la escena la pone; si no, sigue al jugador.
                    const ug = updateGame; window.updateGame = function () { ug.apply(this, arguments); if (window.__cam) { camera.x = window.__cam.x; camera.y = window.__cam.y; } };
                }
            })()`);
            await wait(500);
            await js(`(() => { try { closeSkillChoice(); } catch (e) {} })()`);
        };
        // Avanza n fotogramas de video (2 pasos de juego de 1/60 s cada uno) sin grabar.
        ctx.avanza = async (n, cada) => { for (let i = 0; i < n; i++) { await js(`(() => { ${cada || ''}; __paso(1000 / 60 + 0.01); __paso(1000 / 60 + 0.01); })()`); } };
        // Igual, pero guardando cada fotograma (el canvas, sin el HUD de HTML).
        ctx.graba = async (n, cada) => {
            for (let i = 0; i < n; i++) {
                const d = await js(`(() => { ${cada || ''}; __paso(1000 / 60 + 0.01); __paso(1000 / 60 + 0.01); return canvas.toDataURL('image/jpeg', 0.92); })()`);
                fs.writeFileSync(path.join(ctx.dir, String(ctx.frames++).padStart(5, '0') + '.jpg'), Buffer.from(d.split(',')[1], 'base64'));
            }
        };
        ctx.clip = async (nombre, fn) => {
            if (SOLO && !SOLO.includes(nombre)) return;
            ctx.dir = path.join(TMP, nombre); fs.mkdirSync(ctx.dir, { recursive: true }); ctx.frames = 0;
            await fn();
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(ctx.dir, '%05d.jpg'), '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, nombre + '.mp4')]);
            console.log(nombre, ctx.frames, 'fotogramas');
        };
        await require('./clips-escenas.js')(ctx);
        fin(0);
    } catch (e) { console.error(e); fin(1); }
})();
