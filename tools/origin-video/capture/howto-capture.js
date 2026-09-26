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
// Scenes that get zoomed are recorded at 2.25x (2880x1620) so the zoom has real
// pixels to show; the gameplay stays at 1.5x, where the screencast keeps up.
const VW = 1280, VH = 720, SHARP = 2.25, FAST = 1.5, FPS = 30, OUT_W = 2880, OUT_H = 1620, SLOW = 0.5;
const TO_1920 = 1920 / VW;   // rects are stored in 1920x1080 coordinates
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
  const real = window.fetch, me = ${JSON.stringify(FAKE_ME)};
  const reply = j => Promise.resolve(new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } }));
  // The Daily Arena answered like the real server: today's MEDIUM mission is
  // KILL 3 (+60), credited on the third kill.
  window.fetch = (u, o) => {
    u = String(u);
    if (u.includes('/api/airdrop/me')) return reply(me);
    if (u.includes('/api/airdrop/arena/') || u.includes('/api/airdrop/quest/complete')) {
      const b = JSON.parse((o && o.body) || '{}'), sc = me.score;
      if (u.endsWith('/begin')) sc.tasks.play = true;
      if (u.endsWith('/event') && b.type === 'botKilled') {
        sc.daily.kills++;
        if (sc.daily.kills >= 3 && !sc.daily.done['m-kill3']) { sc.daily.done['m-kill3'] = true; sc.gamePts += 60; }
      }
      if (u.endsWith('/end')) sc.daily.matches++;
      return reply({ score: sc });
    }
    return real(u, o);
  };
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
    const rect = async sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * ${TO_1920})); })()`);
    let dpr = SHARP;
    const setDpr = d => { dpr = d; return cmd('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: d, mobile: false }); };

    await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Animation.enable');
    await setDpr(SHARP);
    await cmd('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_FETCH });

    // Screencast frames of the current page, with their timestamps.
    let rec = null;
    handlers.push(j => {
        if (j.method !== 'Page.screencastFrame') return;
        cmd('Page.screencastFrameAck', { sessionId: j.params.sessionId });
        if (!rec || rec.skip) return;
        const f = path.join(rec.dir, String(rec.frames.length).padStart(5, '0') + '.jpg');
        fs.writeFileSync(f, Buffer.from(j.params.data, 'base64'));
        rec.frames.push({ f, t: j.params.metadata.timestamp });
    });
    const rects = {};
    // ONLY=<scene>: the other scenes still run (the page has to get there) but are not re-recorded.
    const ONLY = process.env.ONLY || '';
    async function record(scene, ms, during) {
        if (ONLY && scene !== ONLY) {
            const noop = async () => {};
            const saved = rec; rec = { slow: [], start: Date.now() / 1000, frames: [], dir: TMP, skip: true };
            if (during) await during(noop);
            rec = saved; return;
        }
        const dir = path.join(TMP, scene); fs.mkdirSync(dir, { recursive: true });
        rec = { dir, frames: [], start: Date.now() / 1000, slow: [] };
        rects[scene] = {};
        await cmd('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(VW * dpr), maxHeight: Math.round(VH * dpr), everyNthFrame: 1 });
        // `during` returning true ends the clip right there (ms is then just a cap).
        const early = during ? await during(async (name, sel, t) => { rects[scene][name] = { t: t == null ? (Date.now() / 1000 - rec.start) : t, r: await rect(sel) }; }) : false;
        if (early) ms = (Date.now() / 1000 - rec.start) * 1000;
        const left = rec.start + ms / 1000 - Date.now() / 1000; if (left > 0) await wait(left * 1000);
        await cmd('Page.stopScreencast');
        const { frames, slow } = rec, start = rec.start, end = rec.start + ms / 1000; rec = null;
        // The first frame can carry the time the page last painted, long before
        // the recording started: nothing counts from before the start.
        for (const fr of frames) fr.t = Math.min(end, Math.max(start, fr.t));
        // Slow-motion stretches (see slowMo) play back at normal speed: their time shrinks by SLOW.
        const remap = tAbs => { let r = tAbs - start; for (const [a, b] of slow) r -= Math.max(0, Math.min(tAbs - start, b) - a) * (1 - SLOW); return r; };
        for (const m of Object.values(rects[scene])) m.t = remap(start + m.t);
        // Constant 30 fps: each frame lasts until the next one arrived.
        const list = frames.map((fr, i) => `file '${fr.f.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, remap(frames[i + 1] ? frames[i + 1].t : end) - remap(fr.t)).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].f.replace(/\\/g, '/')}'`;
        const lf = path.join(dir, 'list.txt'); fs.writeFileSync(lf, list);
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lf, '-vf', `fps=${FPS},scale=${OUT_W}:${OUT_H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', path.join(OUT, scene + '.mp4')]);
        console.log(scene, frames.length, 'frames');
    }
    const click = sel => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
    // Slow motion for the gameplay: this PC cannot screencast the game at a smooth
    // frame rate, so the game's clock (performance.now, which drives its update
    // loop) and the CSS animations run at SLOW, and that stretch is sped back up
    // when the clip is built: twice the frames per second of game time.
    const GAME = `document.getElementById('game').contentWindow`;
    async function slowMo(on) {
        await js(`(() => { const w = ${GAME};
          if (!w.__clk) { const real = w.performance.now.bind(w.performance); const c = w.__clk = { real, rate: 1, bR: real(), bV: real() };
            w.performance.now = () => c.bV + (c.real() - c.bR) * c.rate; }
          const c = w.__clk, v = w.performance.now(); c.bR = c.real(); c.bV = v; c.rate = ${on ? SLOW : 1}; })()`);
        await cmd('Animation.setPlaybackRate', { playbackRate: on ? SLOW : 1 });
        const r = Date.now() / 1000 - rec.start;
        if (on) rec.slow.push([r, Infinity]); else if (rec.slow.length) rec.slow[rec.slow.length - 1][1] = r;
    }
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
    await record('card', 17500, async mark => {
        await mark('cw', '#cW'); await mark('card', '#card'); await mark('sharebtn', '#shareCard');
        await wait(9200);
        await click('#shareCard'); await wait(900);
        await mark('sharecard', '#mShare .panel');
    });
    await js(`document.getElementById('mShare').hidden = true`);

    // 5. Boost quests.
    await scrollTo('.qpanel', 70); await wait(1500);
    await record('boost', 15800, async mark => {
        await mark('banner', '#boostBanner');
        await wait(2500);
        await js(`(() => { const q = document.getElementById('qSocial'); const g = [...q.querySelectorAll('.qgroup')].find(e => /ONE-TIME/.test(e.textContent)); q.scrollTo({ top: g.offsetTop - q.offsetTop - 4, behavior: 'smooth' }); })()`);
        await wait(1200);
        await mark('once', '#qSocial');
    });

    // 6. Daily Arena: scroll down, PRESS TO START, eat 3 small pills (today's
    // KILL 3 mission), get eaten by a big one, share the run. The match is
    // staged through the game's lab handle (__pwLab.sim): feeding real bots to
    // the player and putting a big one on top of it, so the game itself plays
    // the kills, the death and the results screen.
    await setDpr(FAST); await wait(800);
    await record('arena', 30000, async mark => {
        await wait(600);
        await scrollTo('#arenaBlock', 40); await wait(1400);
        await mark('title', '#arenaBlock h2'); await mark('game', '#game');
        await wait(1500);
        await mark('press', '#veil');
        // The game rewrites its own URL on boot: the new match is told apart by its new document.
        await js(`window.__oldDoc = document.getElementById('game').contentDocument`);
        await click('#veil');
        const G = `document.getElementById('game').contentWindow`;
        // The real match (a new document, not the ambient demo behind PRESS TO START).
        // It is shielded (the sim's godMode) until we let it die: a bot must not
        // eat it on its own while the skill card is still on screen.
        const alive = `(() => { try { const w = ${G}; const p = w.document !== window.__oldDoc && w.me && w.me(); if (!(p && p.alive && p.cells.length && w.__pwLab && w.__pwLab.sim)) return false; p.godMode = true; return true; } catch (e) { return false; } })()`;
        for (let i = 0; i < 150 && !(await js(alive)); i++) await wait(100);
        await mark('started', 'body');
        await slowMo(true);
        // Arcade opens with a skill pick: pick the first card, like a player would.
        const picking = `(() => { try { const o = ${G}.document.getElementById('skillChoiceOverlay'); return !!o && getComputedStyle(o).display !== 'none'; } catch (e) { return false; } })()`;
        const pick = async () => {
            if (!(await js(picking))) return;
            await wait(1200);
            await js(`(() => { const b = ${G}.document.querySelector('#skillOptionsContainer .skill-opt-btn'); if (b) b.click(); })()`);
            for (let i = 0; i < 20 && (await js(picking)); i++) await wait(100);
        };
        for (let i = 0; i < 70 && !(await js(picking)); i++) await wait(120);   // it opens a few s in (twice that in slow motion)
        await pick();
        await wait(1200);
        // Three visible kills: a smaller pill shows up a few radii away and slides
        // into the player (game time, so it follows the slow motion), which eats it.
        // The game re-creates its bot objects, so a bot is followed by its id.
        const DIRS = [[1, 0.15], [-0.6, 0.8], [-0.5, -0.85]];
        for (const [dx, dy] of DIRS) {
            const ok = await js(`(() => { const w = ${G}, me = w.me(), c = me.cells[0], S = () => w.__pwLab.sim;
              const n = {}; for (const e of S().enemies) n[e.id] = (n[e.id] || 0) + 1;
              const b0 = S().enemies.filter(e => n[e.id] === 1 && e.r < c.r * 2).sort((a, z) => a.r - z.r)[0]; if (!b0) return false;
              const id = b0.id, l = Math.hypot(${dx}, ${dy}), sx = c.x + ${dx} / l * c.r * 5, sy = c.y + ${dy} / l * c.r * 5, t0 = w.performance.now();
              w.__feed = id;
              clearInterval(w.__feedT); w.__feedT = setInterval(() => {
                const p = w.me().cells[0], b = S().enemies.find(e => e.id === id); if (!p || !b) { clearInterval(w.__feedT); return; }
                const k = Math.min(1, (w.performance.now() - t0) / 1300), e = k * k;
                // Its own update must not undo this: size, shield and push are held too.
                b.r = p.r * 0.62; b.immuneTime = 0; b.tpPhase = 0; b.boostX = 0; b.boostY = 0; b.vx = 0; b.vy = 0;
                b.x = sx + (p.x - sx) * e; b.y = sy + (p.y - sy) * e;
              }, 10);
              return true; })()`);
            if (!ok) continue;
            // Until no enemy has that id any more (eaten), at most 7 s of real time.
            for (let i = 0; i < 70; i++) { if (await js(`(() => { const w = ${G}; return !w.__pwLab.sim.enemies.some(e => e.id === w.__feed); })()`)) break; await wait(100); }
            console.log('kill', dx, dy, await js(`(() => { const w = ${G}; return w.__pwLab.sim.enemies.some(e => e.id === w.__feed) ? 'NOT EATEN' : 'eaten'; })()`));
            await js(`(() => { const w = ${G}; clearInterval(w.__feedT); w.__feed = null; })()`);
            await wait(1000);
        }
        await wait(3600);   // the +60 quest pop (slow motion: 1.8 s on screen)
        await mark('kills', 'body');
        await pick();
        // The death, on screen: a big pill shows up a few radii away and closes in
        // on the player, who is steered into it.
        await js(`(() => { const w = ${G}, sim = w.__pwLab.sim, me = w.me(); me.godMode = false;
          const c = me.cells.slice().sort((a, z) => z.r - a.r)[0];
          const bigId = sim.enemies.slice().sort((a, z) => z.r - a.r)[0].id, R = Math.max(sim.enemies.find(e => e.id === bigId).r, c.r * 2.6);
          const B = () => w.__pwLab.sim.enemies.filter(e => e.id === bigId).sort((a, z) => z.r - a.r)[0];
          const sx = c.x - c.r * 6, sy = c.y + c.r * 1.2, t0 = w.performance.now();
          clearInterval(w.__feedT); w.__feedT = setInterval(() => {
            const k = Math.min(1, (w.performance.now() - t0) / 1600), p = w.me().cells[0], big = B(); if (!p || !big) { clearInterval(w.__feedT); return; }
            big.r = R; big.immuneTime = 0; big.tpPhase = 0; big.boostX = 0; big.boostY = 0; big.vx = 0; big.vy = 0;
            big.x = sx + (p.x - sx) * k; big.y = sy + (p.y - sy) * k;
          }, 10); })()`);
        for (let i = 0; i < 120; i++) { if (await js(`!document.getElementById('over').hidden`)) break; await wait(150); }
        await slowMo(false);
        await mark('over', '#over');
        await js(`(() => { try { clearInterval(${G}.__feedT); } catch (e) {} })()`);
        await wait(1800);
        await mark('sharerun', '#shareRun');
        await click('#shareRun'); await wait(1200);
        await mark('runcard', '#mShare .panel');
        await wait(3500);
        return true;
    });
    await js(`document.getElementById('mShare').hidden = true`);
    await click('#quit'); await wait(1500);
    await setDpr(SHARP); await wait(800);

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

    if (ONLY) { const old = JSON.parse(fs.readFileSync(path.join(OUT, 'rects.json'), 'utf8')); old[ONLY] = rects[ONLY]; fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(old, null, 1)); }
    else fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 1));
    ws.close(); edge.kill();
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
