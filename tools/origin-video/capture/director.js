/*
 * Captures the arena scene from the REAL game, frame by frame.
 *
 * 1. Run the game locally (pillwars-local-8090) and the receiver
 *    (node tools/origin-video/capture/receiver.js).
 * 2. Open http://localhost:8090/game/ at a 1920x1080 viewport (the director
 *    starts the match itself).
 * 3. Paste this whole file into that page's console.
 * 4. Watch window.__status until done; frames land in public/arena/.
 *
 * How it works: the game's clock is frozen (Date.now / performance.now) and its
 * requestAnimationFrame loop stopped, then every video frame advances the
 * simulation by exactly two 60 Hz ticks and calls the game's own draw(). So the
 * pixels are the game's, the timing is exact, and it doesn't matter whether the
 * tab is visible. The page's CSP forbids eval, but inline <script> tags run in
 * the game's global scope, which is how the director reaches `mouse`, `camera`
 * and friends (script-level `let`s, not window properties).
 *
 * CLASSIC mode on purpose: in arcade every kill writes a taunt on the canvas
 * ("BOOM <name>"); in classic the kill shows the money pop-up instead, which is
 * HTML over the canvas, so the video draws that one itself (src/KillGain.tsx).
 *
 * The choreography: the default grey/green pill eats one pill, splits straight
 * away and eats a second with the split; eats a third, and right after a giant
 * pill charges in and eats it. The prey are pinned in place with their bot
 * skills off, viruses are moved out of the lane (to its edges, still in shot),
 * and anything else big enough to eat the hero is sent far away.
 */
(async function director() {
    const TICK = 1000 / 60, MAX_FRAMES = 520, AFTER_DEATH = 24;
    // window.__captureMode = 'skills' before pasting records the skill clips
    // instead (see skills() below); anything else, the kills.
    const MODE = window.__captureMode || 'kills';
    const inject = code => { const s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); };
    window.__status = { phase: 'waiting' };

    // The page first runs a spectator match with a DIFFERENT sim, then the real
    // one: wait for a live, non-spectating player. The match is started from
    // here so this watch is already running when it begins (loaded by URL, the
    // seconds until a pasted script arrives were enough for bots to eat the hero).
    // A save from an earlier capture would bring back its pill (the skills
    // mode recolours it): always start clean.
    try { localStorage.removeItem('pillwars_save'); } catch (e) {}
    inject(`window.__ready =() => { try { return gameRunning && !isSpectating && me() && me().alive && me().cells.length > 0; } catch (e) { return false; } };`);
    inject(`(async () => {
        if (gameRunning && !isSpectating) return;
        await selectMode('classic', true);
        const n = document.getElementById('playerNameInput'); if (n) n.value = '';
        selectRoom('Free');
        els.modeScreen.style.display = 'none';
        startGame();
    })();`);
    while (!window.__ready()) await new Promise(r => setTimeout(r, 5));

    inject(`(function () {
        const T = Date.now(), P = performance.now();
        window.__clock = { t: 0 };
        Date.now = () => T + window.__clock.t;
        performance.now = () => P + window.__clock.t;
        window.requestAnimationFrame = () => 0;
        window.__events = [];
        const orig = processSimEvents;
        window.processSimEvents = function (evs) {
            try { for (const e of evs) window.__events.push({ f: window.__frame | 0, type: e.type, me: e.playerId === 'me' }); } catch (e) {}
            return orig.apply(this, arguments);
        };
        // The GAME OVER panel is HTML (not in the capture) and swaps the match
        // out after 1.4 s of real time: keep the canvas alive after the death.
        window.showResultsUI = function () {};
        // Other players' round results ("<bot> WON - PENTAKILL") are canvas
        // text from a match that isn't this one: keep them out of the shot.
        floatingTexts.length = 0;
        const sft = spawnFloatingText;
        spawnFloatingText = function (text) { if (/ WON - /.test(String(text))) return; return sft.apply(this, arguments); };
        window.__aim = (tx, ty) => { const es = getViewScale(); mouse.x = width / 2 + (tx - camera.x) * es; mouse.y = height / 2 + (ty - camera.y) * es; inputMode = 'MOUSE'; };
        window.__split = () => splitPlayer();
        window.__tick = ms => { window.__clock.t += ms; updateGame(); };
        window.__draw = () => draw();
        window.__snapCam = (x, y) => { camera.x = x; camera.y = y; };
        // Cinematic push-in done by the GAME's camera (not by scaling the frame
        // afterwards), so the pixels stay sharp. getViewScale() feeds both the
        // drawing and the mouse mapping, so wrapping it keeps them in step.
        window.__zoom = 1;
        const gvs = getViewScale;
        window.getViewScale = function () { return gvs.apply(this, arguments) * window.__zoom; };
    })();`);

    const ws = new WebSocket('ws://127.0.0.1:8197');
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('receiver not running')); });
    const cv = document.getElementById('gameCanvas');
    const sendFrame = async (dir, n) => {
        if (n === undefined) { n = dir; dir = ''; }
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
        ws.send(dir + String(n).padStart(4, '0') + '.jpg');
        ws.send(await blob.arrayBuffer());
    };
    if (MODE !== 'skills') ws.send('reset');

    const sim = window.__pwLab.sim;
    const hero = window.me().cells[0];
    hero.r = 40;
    Object.assign(hero, { colorTop: '#c0c8d0', colorBot: '#00ff44' });   // the default pill
    const H0 = { x: hero.x, y: hero.y };

    for (const v of sim.viruses) {
        if (v.x > H0.x - 900 && v.x < H0.x + 4000 && Math.abs(v.y - H0.y) < 520) {
            v.y = H0.y + (v.y >= H0.y ? 1 : -1) * (620 + Math.random() * 260);
        }
    }

    if (MODE === 'skills') return skills(sim, hero, sendFrame, ws);

    const plan = [
        // Kills ~3.5 s apart: the classic money pop-up (2 s) clears, then the
        // next phrase is typed and clears, and only then the next kill lands.
        // Measured hero speed ~7 units/frame; the split fires 430 units short
        // of its prey and the half lands on it ~3 frames later, and the halves
        // then run at only ~6.6 units/frame (a 1 s lunge first). The third sits off the split's line, or
        // the flying half takes it early.
        { dx: 190, dy: 0, r: 16 },                  // 1: first kill, ~1 s in
        { dx: 1185, dy: 0, r: 15, split: true },    // 2: caught with the split, ~3.5 s later
        { dx: 1965, dy: 150, r: 16 },               // 3: ~3 s after that
    ];
    const pool = [...sim.enemies].filter(e => e.r < hero.r * 1.5)
        .sort((a, b) => Math.hypot(a.x - H0.x, a.y - H0.y) - Math.hypot(b.x - H0.x, b.y - H0.y));
    const prey = plan.map((p, i) => ({ c: pool[i], ax: H0.x + p.dx, ay: H0.y + p.dy, split: !!p.split, r: p.r }));
    prey.forEach(p => { p.c.r = p.r; });
    // The killer: a bot blown up to a size that swallows both halves at once.
    // It waits ~2.5 s after the third kill (that pop-up clears and "or be
    // eaten" is typed) while the hero drifts on, then charges.
    const killer = { c: pool[plan.length], x: H0.x + 3415, y: H0.y + 150, go: false, wait: 75 };
    killer.c.r = 130;
    const cast = new Set([...prey.map(p => p.c), killer.c]);
    // Also any bot big enough to eat a prey before the hero gets there.
    const exiled = sim.enemies.filter(e => !cast.has(e) && e.r > 14 &&
        Math.hypot(e.x - H0.x, e.y - H0.y) < 5000).map(e => ({ c: e, x: H0.x - 4200, y: H0.y + 3200 }));

    const alive = c => sim.enemies.includes(c);
    const tame = c => { c.botSkills = []; c.botNextSkillTime = 1e15; c.shouldSplit = false; c.immuneTime = 0; c.tpPhase = 0; c.sprintTime = 0; c.magnetTime = 0; };
    const centroid = () => {
        const cells = window.me().cells; let cx = 0, cy = 0;
        cells.forEach(c => { cx += c.x; cy += c.y; });
        return cells.length ? { x: cx / cells.length, y: cy / cells.length } : null;
    };
    const pin = t => {
        for (const p of prey) {
            if (!alive(p.c)) continue;
            tame(p.c);
            p.c.x = p.ax + Math.sin(t / 700 + p.ax) * 14; p.c.y = p.ay + Math.cos(t / 900 + p.ay) * 10;
            p.c.vx = p.c.vy = 0; p.c.targetX = p.c.x; p.c.targetY = p.c.y;
        }
        if (alive(killer.c)) {
            tame(killer.c);
            const h = centroid();
            if (killer.go && h) {
                const dx = h.x - killer.x, dy = h.y - killer.y, d = Math.hypot(dx, dy) || 1, step = Math.min(d, 17);
                killer.x += dx / d * step; killer.y += dy / d * step;
            }
            killer.c.x = killer.x; killer.c.y = killer.y; killer.c.vx = killer.c.vy = 0;
            killer.c.targetX = killer.x; killer.c.targetY = killer.y;
        }
        for (const e of exiled) { e.c.x = e.x; e.c.y = e.y; e.c.vx = e.c.vy = 0; e.c.targetX = e.x; e.c.targetY = e.y; }
    };

    // Warm-up, not recorded: the camera settles on the grown hero.
    for (let i = 0; i < 60; i++) { pin(window.__clock.t); window.__aim(hero.x, hero.y); window.__tick(TICK); }   // hold still: distances stay as planned

    window.__frame = 0;
    let splitFrame = null, deathFrame = null;
    window.__status = { phase: 'recording', frame: 0 };
    const ZOOM_TO = 1.45, ZOOM_FRAMES = 30;
    const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    for (let f = 0; f < MAX_FRAMES; f++) {
        window.__zoom = 1 + (ZOOM_TO - 1) * easeInOut(Math.min(1, f / ZOOM_FRAMES));
        const h = centroid();
        if (h && deathFrame === null) {
            const next = prey.find(p => alive(p.c));
            if (next) {
                window.__aim(next.c.x, next.c.y);
                if (next.split && splitFrame === null && Math.hypot(next.c.x - h.x, next.c.y - h.y) < 430) { window.__split(); splitFrame = f; }
            } else {
                if (--killer.wait <= 0) killer.go = true;   // a beat after the third kill, here it comes
                window.__aim(h.x + 400, h.y);
            }
        }
        for (let k = 0; k < 2; k++) { pin(window.__clock.t); window.__tick(TICK); }
        if (deathFrame === null && !window.me().cells.length) deathFrame = f;
        window.__draw();
        await sendFrame(f);
        window.__frame = f + 1;
        window.__status = { phase: 'recording', frame: f + 1, preyLeft: prey.filter(p => alive(p.c)).length, splitFrame, deathFrame };
        if (deathFrame !== null && f - deathFrame >= AFTER_DEATH) break;
    }

    // One entry per kill (the game fires more than one event per kill).
    const kills = [];
    for (const e of window.__events) if (e.type === 'botKilled' && e.me && !kills.some(k => Math.abs(k - e.f) < 4)) kills.push(e.f);
    const meta = { fps: 30, frames: window.__frame, splitFrame, kills, deathFrame };
    ws.send('events.json'); ws.send(JSON.stringify(meta, null, 2));
    await new Promise(r => setTimeout(r, 800));
    window.__status = { phase: 'done', ...meta };

    /*
     * The "in PILLWARS" beat: four short clips, a different pill in a different
     * spot of the map each time, running with one skill on: sprint, shield,
     * magnet and teleport. The camera follows the pill, so it stays centred
     * while the arena moves under it; the game's camera is pushed in so the
     * pill reads big. Effects are switched on straight on the cells, as the
     * sim does it (in classic the skill keys only shoot).
     */
    async function skills(sim, hero, sendFrame, ws) {
        ws.send('reset skills');
        const SHOTS = [
            { name: 'sprint', top: '#ffffff', bot: '#1d9bf0', frames: 22, ang: 0.3,  at: [0.45, -0.35] },
            { name: 'shield', top: '#ffce3d', bot: '#f62a2d', frames: 22, ang: 2.6,  at: [-0.5, 0.4] },
            { name: 'magnet', top: '#ccff00', bot: '#7a3cff', frames: 22, ang: -2.2, at: [0.3, 0.55] },
            { name: 'tp',     top: '#00e5ff', bot: '#ff9f1c', frames: 32, ang: -0.6, at: [-0.4, -0.5] },
        ];
        const p = window.me();
        const lim = sim.mapSize - 600;
        window.__zoom = 1.9;
        const shots = [];
        let n = 0;
        for (const s of SHOTS) {
            const x = s.at[0] * lim, y = s.at[1] * lim;
            // Keep the spot safe: nothing that could eat the pill nearby.
            for (const e of sim.enemies) if (e.r > hero.r * 0.8 && Math.hypot(e.x - x, e.y - y) < 1800) { e.x = x + 5000 * Math.sign(-x || 1); e.y = y; }
            Object.assign(hero, { x, y, r: 48, colorTop: s.top, colorBot: s.bot, sprintTime: 0, immuneTime: 0, magnetTime: 0, tpPhase: 0, vx: 0, vy: 0, boostX: 0, boostY: 0 });
            p.skillState[5] = 0;
            window.__snapCam(x, y);
            const aim = () => window.__aim(hero.x + Math.cos(s.ang) * 500, hero.y + Math.sin(s.ang) * 500);
            const fx = () => {
                if (s.name === 'sprint') hero.sprintTime = 10000;
                if (s.name === 'shield') hero.immuneTime = 3000;
                if (s.name === 'magnet') p.skillState[5] = 8000;
            };
            // Up to speed and with the effect already on when the clip starts.
            for (let i = 0; i < 40; i++) { fx(); aim(); window.__tick(TICK); }
            const from = n;
            for (let f = 0; f < s.frames; f++) {
                if (s.name === 'tp' && f === 3) Object.assign(hero, { tpPhase: 1, tpTimer: 500, tpDest: { x: hero.x + Math.cos(s.ang) * 420, y: hero.y + Math.sin(s.ang) * 420 } });
                fx(); aim();
                for (let k = 0; k < 2; k++) window.__tick(TICK);
                window.__snapCam(hero.x, hero.y);   // dead centre, not the game's trailing camera
                window.__draw();
                await sendFrame('skills/', n++);
                window.__status = { phase: 'skills', shot: s.name, frame: n };
            }
            shots.push({ name: s.name, from, frames: s.frames });
        }
        ws.send('skills/events.json'); ws.send(JSON.stringify({ fps: 30, shots }, null, 2));
        await new Promise(r => setTimeout(r, 800));
        window.__status = { phase: 'done', shots };
    }
})().catch(e => { window.__status = { phase: 'error', msg: String(e) }; });
