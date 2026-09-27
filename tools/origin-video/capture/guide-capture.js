// Records the "how to play" thread: 5 clips of a real Daily Arena match,
// staged through the game's own controls (mouse, SPACE, skill keys) and its
// lab handle (__pwLab.sim) to put a pill or a virus where the clip needs it.
//   node capture/guide-capture.js http://localhost:8095 <tmp dir>
// Writes public/guide/<clip>.mp4 and public/guide/marks.json.
// The game runs in slow motion (its clock at SLOW) and every clip is squeezed
// back to real speed: this PC can't screencast the game smoothly in real time.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WS = require('../../../node_modules/ws');

const BASE = process.argv[2] || 'http://localhost:8095';
const TMP = process.argv[3] || path.join(require('os').tmpdir(), 'guide-capture');
const OUT = path.join(__dirname, '..', 'public', 'guide');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 2x: the edit zooms in on the player. Slower game clock to keep the frame rate up at that size.
const VW = 1280, VH = 720, DPR = 2, FPS = 30, SLOW = 0.4;
const wait = ms => new Promise(r => setTimeout(r, ms));
const W = ms => wait(ms / SLOW);   // a wait in game (slow-motion) time

(async () => {
    fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
    const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9340', '--user-data-dir=' + path.join(TMP, 'prof'), '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
    let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch('http://127.0.0.1:9340/json')).json(); if (tabs.some(t => t.type === 'page')) break; } catch (e) {} await wait(300); }
    const ws = new WS(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    let id = 0; const pend = {}, handlers = [];
    ws.on('message', m => { const j = JSON.parse(m); if (j.id && pend[j.id]) { pend[j.id](j.result || j.error); delete pend[j.id]; } else if (j.method) handlers.forEach(h => h(j)); });
    const cmd = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r && r.result ? r.result.value : undefined; };
    const G = `document.getElementById('game').contentWindow`;
    const g = code => js(`(() => { const w = ${G}, sim = w.__pwLab.sim, me = w.me(); ${code} })()`);

    await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Animation.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false });

    let rec = null;
    handlers.push(j => {
        if (j.method !== 'Page.screencastFrame') return;
        cmd('Page.screencastFrameAck', { sessionId: j.params.sessionId });
        if (!rec) return;
        const f = path.join(rec.dir, String(rec.frames.length).padStart(5, '0') + '.jpg');
        fs.writeFileSync(f, Buffer.from(j.params.data, 'base64'));
        rec.frames.push({ f, t: j.params.metadata.timestamp });
    });
    const marks = {};
    // A whole clip is game time: its frames are squeezed by SLOW, and so are the marks.
    async function record(clip, during) {
        const dir = path.join(TMP, clip); fs.mkdirSync(dir, { recursive: true });
        rec = { dir, frames: [], start: Date.now() / 1000 };
        const mk = marks[clip] = {};
        await cmd('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VW * DPR, maxHeight: VH * DPR, everyNthFrame: 1 });
        await during(name => { mk[name] = (Date.now() / 1000 - rec.start) * SLOW; });
        await cmd('Page.stopScreencast');
        const { frames, start } = rec, end = Date.now() / 1000; rec = null;
        for (const fr of frames) fr.t = Math.min(end, Math.max(start, fr.t));
        const list = frames.map((fr, i) => `file '${fr.f.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, ((frames[i + 1] ? frames[i + 1].t : end) - fr.t) * SLOW).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].f.replace(/\\/g, '/')}'`;
        const lf = path.join(dir, 'list.txt'); fs.writeFileSync(lf, list);
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lf, '-vf', `fps=${FPS},scale=2560:1440:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', path.join(OUT, clip + '.mp4')]);
        console.log(clip, frames.length, 'frames', JSON.stringify(mk));
    }

    // Game-side helpers, installed in the match's window.
    // Aiming: the game turns the mouse into a world point with its own view scale,
    // so instead the sim's input (movement) and actions (split, skills) are
    // pointed straight at a world target while w.__aim is set.
    const HELPERS = `(() => { const w = ${G}, sim = w.__pwLab.sim;
      const oI = sim.setInput.bind(sim), oQ = sim.queueAction.bind(sim);
      sim.setInput = (id, inp) => oI(id, id === 'me' && w.__aim ? w.__aim() : inp);
      sim.queueAction = (id, a) => oQ(id, id === 'me' && w.__aim ? Object.assign({}, a, w.__aim()) : a);
      w.__h = {
        // Head that way (screen-like dx, dy), or stay put with (0, 0).
        mouse(dx, dy) { w.__aim = () => { const c = w.__h.big(); return { tx: c.x + dx * 4, ty: c.y + dy * 4 }; }; },
        aimAt(x, y) { w.__aim = () => ({ tx: x, ty: y }); },
        aimAtBot(id) { w.__aim = () => { const b = w.__pwLab.sim.enemies.filter(e => e.id === id).sort((a, z) => z.r - a.r)[0], c = w.__h.big(); return b ? { tx: b.x, ty: b.y } : { tx: c.x, ty: c.y }; }; },
        key(code, key) { w.dispatchEvent(new w.KeyboardEvent('keydown', { code, key })); setTimeout(() => w.dispatchEvent(new w.KeyboardEvent('keyup', { code, key })), 60); },
        big() { const c = w.me().cells; return c.slice().sort((a, z) => z.r - a.r)[0]; },
        // A pill held still (or sliding) somewhere, followed by id: the game re-creates its objects.
        hold(id, fn) { clearInterval(w.__holdT); w.__holdT = setInterval(() => { const b = w.__pwLab.sim.enemies.filter(e => e.id === id).sort((a, z) => z.r - a.r)[0]; if (!b) return clearInterval(w.__holdT); b.immuneTime = 0; b.tpPhase = 0; b.boostX = 0; b.boostY = 0; b.vx = 0; b.vy = 0; b.lastSplitTime = w.__pwLab.sim.now; fn(b); }, 10); },
        stop() { clearInterval(w.__holdT); },
        singleBot(maxR) { const n = {}; for (const e of w.__pwLab.sim.enemies) n[e.id] = (n[e.id] || 0) + 1; return w.__pwLab.sim.enemies.filter(e => n[e.id] === 1 && e.r < maxR).sort((a, z) => a.r - z.r)[0]; },
        alive(id) { return w.__pwLab.sim.enemies.some(e => e.id === id); },
        // Somewhere near the middle of the map (the edge's red line looks bad on camera).
        center(dx = 0, dy = 0) { const m = w.__pwLab.sim.mapSize * 0.25, x = (Math.random() * 2 - 1) * m + dx, y = (Math.random() * 2 - 1) * m + dy; for (const c of w.me().cells) { c.x = x; c.y = y; } },
        virusNearMiddle() { return w.__pwLab.sim.viruses.slice().sort((a, z) => Math.hypot(a.x, a.y) - Math.hypot(z.x, z.y))[0]; },
        clearSkills() { const p = w.me(); p.skillSlots = [null, null, null, null]; try { w.updateSkillsUI_Arcade(); } catch (e) {} },
        grant(...ids) { for (const i of ids) w.__pwLab.sim.grantSkillToPlayer('me', i); try { w.updateSkillsUI_Arcade(); } catch (e) {} },
        singleBig() { const n = {}; for (const e of w.__pwLab.sim.enemies) n[e.id] = (n[e.id] || 0) + 1; return w.__pwLab.sim.enemies.filter(e => n[e.id] === 1).sort((a, z) => z.r - a.r)[0]; },
      };
    })()`;
    const slowMo = async on => {
        await js(`(() => { const w = ${G};
          // performance.now drives the update loop; Date.now drives the match clock (3:50).
          if (!w.__clk) { const real = w.performance.now.bind(w.performance), realD = w.Date.now; const c = w.__clk = { real, realD, rate: 1, bR: real(), bV: real(), dR: realD(), dV: realD() };
            w.performance.now = () => c.bV + (c.real() - c.bR) * c.rate; w.Date.now = () => Math.round(c.dV + (c.realD() - c.dR) * c.rate); }
          const c = w.__clk, v = w.performance.now(), dv = w.Date.now(); c.bR = c.real(); c.bV = v; c.dR = c.realD(); c.dV = dv; c.rate = ${on ? SLOW : 1}; })()`);
        await cmd('Animation.setPlaybackRate', { playbackRate: on ? SLOW : 1 });
    };
    const kills = () => js(`${G}.__kills || 0`);

    // ---- Into a match, the arena full screen ----
    await cmd('Page.navigate', { url: BASE + '/' }); await wait(6000);
    await js(`document.getElementById('introEnter').click()`); await wait(1000);
    await js(`document.getElementById('arenaBlock').scrollIntoView()`); await wait(2500);
    await js(`document.getElementById('screen').classList.add('full'); document.body.classList.add('arena-full'); document.getElementById('hudq').style.setProperty('display', 'none', 'important')`); await wait(800);
    await js(`window.__oldDoc = ${G}.document; document.getElementById('veil').click()`);
    for (let i = 0; i < 150; i++) { if (await js(`(() => { try { const w = ${G}, p = w.document !== window.__oldDoc && w.me && w.me(); if (p && p.alive && p.cells.length && w.__pwLab && w.__pwLab.sim) { p.godMode = true; return true; } } catch (e) {} return false; })()`)) break; await wait(100); }
    await js(HELPERS);
    await js(`(() => { const w = ${G}; w.__kills = 0; const o = w.processSimEvents; w.processSimEvents = function (evs) { try { for (const e of evs) if (e.type === 'botKilled' && e.playerId === 'me') w.__kills++; } catch (x) {} return o.apply(this, arguments); }; })()`);
    // The opening skill card: take the first one off screen, before the clips.
    const picking = `(() => { try { const o = ${G}.document.getElementById('skillChoiceOverlay'); return !!o && getComputedStyle(o).display !== 'none'; } catch (e) { return false; } })()`;
    for (let i = 0; i < 40 && !(await js(picking)); i++) await wait(150);
    if (await js(picking)) await js(`${G}.document.querySelector('#skillOptionsContainer .skill-opt-btn').click()`);
    await wait(800);
    await js(`${G}.__pwLab.nextSkillPickTime = 1e9`);
    await js(`window.__allowPick = false; clearInterval(window.__pickT); window.__pickT = setInterval(() => { if (window.__allowPick) return; try { const d = ${G}.document, o = d.getElementById('skillChoiceOverlay'); if (o && getComputedStyle(o).display !== 'none') d.querySelector('#skillOptionsContainer .skill-opt-btn').click(); } catch (e) {} }, 60)`);
    await g(`w.__h.center()`);
    await wait(1500);
    await slowMo(true);

    // ---- 1. Move & grow: steer around eating food, then a smaller pill ----
    await record('move', async mark => {
        const path_ = [[320, 60], [260, 240], [-80, 300], [-300, 120], [-260, -160], [60, -320], [300, -120], [280, 120]];
        for (const [dx, dy] of path_) { await g(`w.__h.mouse(${dx}, ${dy})`); await W(1200); }
        mark('prey');
        const k0 = await kills();
        await g(`const c = w.__h.big(), b = w.__h.singleBot(c.r * 2); if (!b) return; const sx = c.x + c.r * 5, sy = c.y - c.r, t0 = w.performance.now(); w.__prey = b.id;
          w.__h.hold(b.id, x => { const p = w.__h.big(); if (!p) return; const k = Math.min(1, (w.performance.now() - t0) / 1200), e = k * k; x.r = p.r * 0.6; x.x = sx + (p.x - sx) * e; x.y = sy + (p.y - sy) * e; });`);
        await g(`w.__h.aimAtBot(w.__prey)`);
        for (let i = 0; i < 90 && (await kills()) === k0; i++) await wait(100);
        mark('kill');
        await g(`w.__h.stop(); w.__h.mouse(200, 150)`);
        await W(3000);
    });

    // ---- 2. Hide in a virus: slip in, a big pill crashes into it and bursts ----
    // Off camera: next to a virus, facing it.
    await g(`const v = w.__h.virusNearMiddle(); w.__virus = v; for (const x of me.cells) { x.x = v.x - 260; x.y = v.y; }`);
    await g(`w.__h.mouse(0, 0)`);
    await wait(1200);
    await record('hide', async mark => {
        await W(700);
        mark('go');
        await g(`w.__h.aimAt(w.__virus.x, w.__virus.y)`);    // swim into the virus
        for (let i = 0; i < 60; i++) { if (await g(`const c = w.__h.big(), v = w.__virus; return Math.hypot(c.x - v.x, c.y - v.y) + c.r < v.r;`)) break; await wait(100); }
        // (still aimed at its centre: stays inside)
        mark('inside');
        await W(900);
        // A big pill charges through the virus.
        // It comes from the side with no other virus on the way, and appears there already big.
        await g(`const v = w.__virus, big = w.__h.singleBig(); w.__hunter = big.id; w.__vci = v.ci;
          let best = 0, bestD = -1; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, ax = Math.cos(a), ay = Math.sin(a); let near = 1e9;
            for (const o of sim.viruses) { if (o === v) continue; const t = Math.max(0, Math.min(600, (o.x - v.x) * ax + (o.y - v.y) * ay)); near = Math.min(near, Math.hypot(o.x - (v.x + ax * t), o.y - (v.y + ay * t))); }
            if (near > bestD) { bestD = near; best = a; } }
          const sx = v.x + Math.cos(best) * 560, sy = v.y + Math.sin(best) * 560, t0 = w.performance.now(); big.x = sx; big.y = sy;
          w.__h.hold(big.id, b => { const k = Math.min(1, (w.performance.now() - t0) / 1800); b.r = 115; b.x = sx + (v.x - sx) * k; b.y = sy + (v.y - sy) * k; if (!sim.viruses.some(o => o.ci === w.__vci)) w.__h.stop(); });`);
        mark('hunter');
        // Burst: that virus is gone (it breaks whatever bigger crashes into it).
        for (let i = 0; i < 80; i++) { if (await g(`return !sim.viruses.some(o => o.ci === w.__vci);`)) break; await wait(100); }
        mark('burst');
        await g(`w.__h.stop()`);
        await W(2200);
    });

    // ---- 3. Split: grow a bit, a smaller pill runs ahead, SPACE ----
    await g(`w.__h.center(); const c = w.__h.big(); c.r = Math.max(c.r, 40); w.__h.mouse(260, 0);`);
    await wait(1500);
    await record('split', async mark => {
        const k0 = await kills();
        await g(`const c = w.__h.big(), b = w.__h.singleBot(c.r * 2); if (!b) return; w.__prey = b.id;
          w.__h.hold(b.id, x => { const p = w.__h.big(); if (!p) return; x.r = 13; x.sprintTime = 0; x.lastSplitTime = sim.now;
            // Once the split flies it stays where it was (no sprinting off).
            if (w.__split) { x.x = w.__pp.x; x.y = w.__pp.y; return; }
            x.x = p.x + p.r * 3.4; x.y = p.y; w.__pp = { x: x.x, y: x.y }; });`);
        await g(`w.__h.aimAtBot(w.__prey)`);
        await W(1300);
        mark('space');
        await g(`w.__split = true; w.__h.key('Space', ' ');`);
        for (let i = 0; i < 60 && (await kills()) === k0; i++) await wait(100);
        await g(`w.__h.stop(); w.__split = false;`);
        mark('kill');
        await W(2600);
    });

    // ---- 4. Skills: pick a card, SHOT pops a virus, SPRINT ----
    await g(`w.__h.clearSkills(); w.__h.grant(2, 3);`);
    // Off camera: a virus straight ahead, in range.
    await g(`const v = w.__h.virusNearMiddle(); w.__virus = v; for (const x of me.cells) { x.x = v.x - 420; x.y = v.y; } w.__h.mouse(0, 0);`);
    await wait(1200);
    const slotOf = sid => js(`(() => { const s = ${G}.me().skillSlots || []; const i = s.findIndex(x => x && x.id === ${sid}); return i < 0 ? 0 : i + 1; })()`);
    await record('skills', async mark => {
        await js(`window.__allowPick = true; ${G}.__pwLab.nextSkillPickTime = 0`);   // a skill card right now
        for (let i = 0; i < 40 && !(await js(picking)); i++) await wait(100);
        mark('pick');
        await W(1500);
        await js(`${G}.document.querySelector('#skillOptionsContainer .skill-opt-btn').click(); window.__allowPick = false; ${G}.__pwLab.nextSkillPickTime = 1e9`);
        mark('picked');
        await W(1400);
        await g(`w.__h.aimAt(w.__virus.x, w.__virus.y)`);    // aim at the virus
        await W(500);
        const shot = await slotOf(2);
        mark('shot'); mark('shotKey' + shot);
        await g(`w.__h.key('Digit${shot}', '${shot}')`); await W(450); await g(`w.__h.key('Digit${shot}', '${shot}')`);
        await W(1800);
        const sprint = await slotOf(3);
        await g(`w.__h.mouse(-320, 120)`);
        mark('sprint'); mark('sprintKey' + sprint);
        await g(`w.__h.key('Digit${sprint}', '${sprint}')`);
        await W(2600);
    });

    // ---- 5. Survive: a big pill closes in, you run ----
    await g(`w.__h.center(); w.__h.clearSkills(); w.__h.grant(3);`);
    await wait(1200);
    await record('survive', async mark => {
        await g(`const big = w.__h.singleBig(); w.__hunter = big.id; const t0 = w.performance.now();
          w.__h.hold(big.id, b => { const p = w.__h.big(); if (!p) return; b.r = p.r * 2.2; const k = Math.min(1, (w.performance.now() - t0) / 5000); const d = p.r * (8 - k * 3.5); b.x = p.x - d; b.y = p.y + d * 0.25; });`);
        mark('hunter');
        await g(`w.__h.mouse(320, -40)`);
        await W(1600);
        const sprint = await slotOf(3);
        mark('sprintKey' + sprint);
        await g(`w.__h.key('Digit${sprint}', '${sprint}')`);
        await W(4800);
        await g(`w.__h.stop()`);
    });

    await slowMo(false);
    fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 1));
    ws.close(); edge.kill();
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
