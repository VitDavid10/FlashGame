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
 * The choreography: the default grey/green pill, grown a bit, eats three smaller
 * pills in a row and catches the fourth with a split. The prey have their bot
 * skills switched off (otherwise they shield, split or teleport out of the
 * script) and viruses are moved out of the lane to its edges, so they still
 * show but can't pop the hero.
 */
(async function director() {
    const TICK = 1000 / 60, MAX_FRAMES = 330, TAIL = 55;
    const inject = code => { const s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); };
    window.__status = { phase: 'waiting' };

    // Not just "a pill exists": the page first runs a spectator match with a
    // DIFFERENT sim, then starts the real one. Freezing during the first grabs
    // the wrong sim (and spectators ignore the mouse). Don't also wait for the
    // opening skill pick to close: it doesn't block movement, and meanwhile the
    // real-time match goes on and the bots eat the hero.
    inject(`window.__ready = () => { try { return gameRunning && !isSpectating && me() && me().alive && me().cells.length > 0; } catch (e) { return false; } };`);
    // Start the match from here (same call as the hero's PLAY NOW) instead of
    // loading ?heroplay=1: that way the watch below is already running when the
    // match starts. Loaded by URL, the few seconds until this script arrives
    // were enough for the bots to eat the hero.
    inject(`if (!gameRunning || isSpectating) heroQuickPlay('');`);
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
            try { for (const e of evs) window.__events.push({ f: window.__frame | 0, type: e.type }); } catch (e) {}
            return orig.apply(this, arguments);
        };
        window.__aim = (tx, ty) => { const es = getViewScale(); mouse.x = width / 2 + (tx - camera.x) * es; mouse.y = height / 2 + (ty - camera.y) * es; inputMode = 'MOUSE'; };
        window.__split = () => splitPlayer();
        window.__tick = ms => { window.__clock.t += ms; updateGame(); };
        window.__draw = () => draw();
    })();`);

    const ws = new WebSocket('ws://127.0.0.1:8197');
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('receiver not running')); });
    const cv = document.getElementById('gameCanvas');
    const sendFrame = async n => {
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
        ws.send(String(n).padStart(4, '0') + '.jpg');
        ws.send(await blob.arrayBuffer());
    };
    ws.send('reset');

    const sim = window.__pwLab.sim;
    const hero = window.me().cells[0];
    hero.r = 40;
    const H0 = { x: hero.x, y: hero.y };

    // Viruses out of the lane, parked just above/below it so they stay in shot.
    for (const v of sim.viruses) {
        if (v.x > H0.x - 900 && v.x < H0.x + 2800 && Math.abs(v.y - H0.y) < 520) {
            v.y = H0.y + (v.y >= H0.y ? 1 : -1) * (620 + Math.random() * 260);
        }
    }

    const plan = [
        // Spaced so each one is seen coming (~1 s apart at the hero's speed).
        { dx: 460, dy: -50, r: 16 },
        { dx: 880, dy: 70, r: 20 },
        { dx: 1300, dy: -40, r: 22 },
        { dx: 1720, dy: 30, r: 17, split: true },
    ];
    const pool = [...sim.enemies].filter(e => e.r < hero.r * 1.5)
        .sort((a, b) => Math.hypot(a.x - H0.x, a.y - H0.y) - Math.hypot(b.x - H0.x, b.y - H0.y));
    const prey = plan.map((p, i) => ({ c: pool[i], ax: H0.x + p.dx, ay: H0.y + p.dy, split: !!p.split, r: p.r }));
    prey.forEach(p => { p.c.r = p.r; });
    const preyIds = new Set(prey.map(p => p.c));
    // Anything big enough to eat the hero is sent far away and kept there.
    const exiled = sim.enemies.filter(e => !preyIds.has(e) && e.r > hero.r * 0.7 &&
        Math.hypot(e.x - H0.x, e.y - H0.y) < 3800).map(e => ({ c: e, x: H0.x - 4200, y: H0.y + 3200 }));

    const alive = c => sim.enemies.includes(c);
    const tame = c => { c.botSkills = []; c.botNextSkillTime = 1e15; c.shouldSplit = false; c.immuneTime = 0; c.tpPhase = 0; c.sprintTime = 0; c.magnetTime = 0; };
    const pin = t => {
        for (const p of prey) {
            if (!alive(p.c)) continue;
            tame(p.c);
            p.c.x = p.ax + Math.sin(t / 700 + p.ax) * 14; p.c.y = p.ay + Math.cos(t / 900 + p.ay) * 10;
            p.c.vx = p.c.vy = 0; p.c.targetX = p.c.x; p.c.targetY = p.c.y;
        }
        for (const e of exiled) { e.c.x = e.x; e.c.y = e.y; e.c.vx = e.c.vy = 0; e.c.targetX = e.x; e.c.targetY = e.y; }
    };

    // Warm-up, not recorded: the camera settles on the grown hero.
    for (let i = 0; i < 60; i++) { pin(window.__clock.t); window.__aim(hero.x + 40, hero.y); window.__tick(TICK); }

    window.__frame = 0;
    let splitFrame = null, doneAt = null;
    window.__status = { phase: 'recording', frame: 0 };
    for (let f = 0; f < MAX_FRAMES; f++) {
        const cells = window.me().cells;
        if (!cells.length) { window.__status = { phase: 'hero died', frame: f }; break; }
        let cx = 0, cy = 0; cells.forEach(c => { cx += c.x; cy += c.y; }); cx /= cells.length; cy /= cells.length;
        const next = prey.find(p => alive(p.c));
        if (next) {
            window.__aim(next.c.x, next.c.y);
            if (next.split && splitFrame === null && Math.hypot(next.c.x - cx, next.c.y - cy) < 420) { window.__split(); splitFrame = f; }
        } else {
            window.__aim(cx + 400, cy);
            if (doneAt === null) doneAt = f;
        }
        for (let k = 0; k < 2; k++) { pin(window.__clock.t); window.__tick(TICK); }
        window.__draw();
        await sendFrame(f);
        window.__frame = f + 1;
        window.__status = { phase: 'recording', frame: f + 1, preyLeft: prey.filter(p => alive(p.c)).length, splitFrame };
        if (doneAt !== null && f - doneAt >= TAIL) break;
    }

    // Kill and split moments, so the video can put the game's sounds on them.
    const kills = window.__events.filter(e => e.type === 'botKilled').map(e => e.f);
    const meta = { fps: 30, frames: window.__frame, splitFrame, kills, preyLeft: prey.filter(p => alive(p.c)).length };
    ws.send('events.json'); ws.send(JSON.stringify(meta, null, 2));
    await new Promise(r => setTimeout(r, 800));
    window.__status = { phase: 'done', ...meta };
})();
