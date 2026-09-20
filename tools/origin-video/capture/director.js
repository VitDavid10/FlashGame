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
    // window.__captureMode picks what to record: 'kills' (default, the arena
    // scene), 'skills' (the four "in PILLWARS" clips) or 'deaths' (the three
    // kill clips of the closing beat). See skills() and deaths() below.
    const MODE = window.__captureMode || 'kills';
    // The crowns of the podium only exist in ARCADE, so that take starts there.
    const ARCADE = MODE === 'growth';
    const inject = code => { const s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); };
    window.__status = { phase: 'waiting' };

    // The page first runs a spectator match with a DIFFERENT sim, then the real
    // one: wait for a live, non-spectating player. The match is started from
    // here so this watch is already running when it begins (loaded by URL, the
    // seconds until a pasted script arrives were enough for bots to eat the hero).
    // A save from an earlier capture would bring back its pill (the skills
    // mode recolours it): always start clean.
    try { localStorage.removeItem('pillwars_save'); } catch (e) {}
    window.__pwArcade = ARCADE;
    inject(`window.__ready = () => { try { return gameRunning && !isSpectating && me() && me().alive && me().cells.length > 0; } catch (e) { return false; } };`);
    inject(`(async () => {
        if (gameRunning && !isSpectating) return;
        await selectMode(window.__pwArcade ? 'arcade' : 'classic', true);
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
        window.__shoot = () => useSkill(1);
        // Rivals' skill effects are a player setting, off by default. There
        // are two switches: enableEnemyFX for the extras of the aura and
        // enemySkillFx for the particles (the sprint bolts, the magnet). The
        // clips of bots using skills need both.
        enableEnemyFX = true;
        enemySkillFx = true;
        window.__botSkill = (c, id) => c.executeBotSkill(window.__pwLab.sim, id);
        window.__tick = ms => { window.__clock.t += ms; updateGame(); };
        window.__draw = () => draw();
        window.__snapCam = (x, y) => { camera.x = x; camera.y = y; };
        // cellPais() only ever returns a country for your own cells, so a bot
        // could never wear a flag. The capture needs Spain against Argentina:
        // this lets the director say which cell id wears what.
        window.__pais = new Map();
        const cp = cellPais;
        cellPais = function (c) { return (c && window.__pais.get(c.id)) || cp(c); };
        // Cinematic push-in done by the GAME's camera (not by scaling the frame
        // afterwards), so the pixels stay sharp. getViewScale() feeds both the
        // drawing and the mouse mapping, so wrapping it keeps them in step.
        window.__zoom = 1;
        const gvs = getViewScale;
        // The game zooms out as you grow, so a growing pill looks the same size
        // on screen. This gives the raw scale back, to cancel that out.
        window.__rawScale = () => gvs.call(null);
        // Your place on the podium (1-3) or null. The leaderboard recomputes it
        // every tick, so a take sets it again right before drawing.
        window.__rank = n => { _miPuesto = n; };
        window.getViewScale = function () { return gvs.apply(this, arguments) * window.__zoom; };
    })();`);

    const ws = new WebSocket('ws://127.0.0.1:8197');
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('receiver not running')); });
    const cv = document.getElementById('gameCanvas');
    const sendFrame = async (dir, n) => {
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
        ws.send(dir + String(n).padStart(4, '0') + '.jpg');
        ws.send(await blob.arrayBuffer());
    };
    if (MODE === 'kills') ws.send('reset arena');

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
    if (MODE === 'deaths') return deaths(sim, hero, sendFrame, ws);
    if (MODE === 'growth') return growth(sim, hero, sendFrame, ws);

    const plan = [
        // The kills land on the beats of the track (see src/Origin.tsx):
        // 100, 49 and 50 frames apart, and these distances hit them at about
        // real speed, so nothing has to be stretched or rushed afterwards.
        // Measured hero speed ~7 units/frame; the split fires 430 units short
        // of its prey and the half lands on it ~3 frames later, and the halves
        // then run at only ~6.6 units/frame (a 1 s lunge first). The third sits off the split's line, or
        // the flying half takes it early.
        { dx: 190, dy: 0, r: 16 },                  // 1: first kill, ~1 s in
        { dx: 975, dy: 0, r: 15, split: true },     // 2: caught with the split, ~2.9 s later
        { dx: 1432, dy: 150, r: 16 },               // 3: 1.7 s after that (one beat and a half)
    ];
    const pool = [...sim.enemies].filter(e => e.r < hero.r * 1.5)
        .sort((a, b) => Math.hypot(a.x - H0.x, a.y - H0.y) - Math.hypot(b.x - H0.x, b.y - H0.y));
    const prey = plan.map((p, i) => ({ c: pool[i], ax: H0.x + p.dx, ay: H0.y + p.dy, split: !!p.split, r: p.r }));
    prey.forEach(p => { p.c.r = p.r; });
    // The killer: a bot blown up to a size that swallows both halves at once.
    // It waits after the third kill (that pop-up clears and "or be eaten" is
    // typed) while the hero drifts on, then charges.
    const killer = { c: pool[plan.length], x: H0.x + 2882, y: H0.y + 150, go: false, wait: 20 };
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
        await sendFrame('arena/', f);
        window.__frame = f + 1;
        window.__status = { phase: 'recording', frame: f + 1, preyLeft: prey.filter(p => alive(p.c)).length, splitFrame, deathFrame };
        if (deathFrame !== null && f - deathFrame >= AFTER_DEATH) break;
    }

    // One entry per kill (the game fires more than one event per kill).
    const kills = [];
    for (const e of window.__events) if (e.type === 'botKilled' && e.me && !kills.some(k => Math.abs(k - e.f) < 4)) kills.push(e.f);
    const meta = { fps: 30, frames: window.__frame, splitFrame, kills, deathFrame };
    ws.send('arena/events.json'); ws.send(JSON.stringify(meta, null, 2));
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
        ws.send('reset skills');   // its own folder, so a re-run of one mode leaves the other alone
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

    /*
     * The closing beat: six short takes played out in the real game, cut so
     * fast they land on the music. The video speeds them up further, so
     * everything has to happen inside a second and nothing ever stands still.
     *   1. a virus bursts the hero and a giant cleans it up,
     *   2. smaller than a rival, the hero splits into its halves and eats them,
     *   3. the game's own mass milestone bursts the hero while it feeds,
     *   4. a Spain pill runs an Argentina one down,
     *   5. two hits of classic's shot on a virus: purple, then it bursts,
     *   6, 7, 8. three rivals using the game's skills: sprint, shield and a
     *      teleport, with the camera riding along.
     */
    async function deaths(sim, hero, sendFrame, ws) {
        ws.send('reset deaths');
        const p = window.me();
        const lim = sim.mapSize - 900;
        const shots = [];
        let n = 0;
        // Off-stage corner, far from every spot: anything not in the cast is
        // parked there every frame (bots chase, and the giant of the first
        // take would walk straight into the second).
        const DUMP = { x: lim * 0.92, y: lim * 0.92 };
        const tame = c => { c.botSkills = []; c.botNextSkillTime = 1e15; c.shouldSplit = false; c.immuneTime = 0; c.tpPhase = 0; c.sprintTime = 0; c.magnetTime = 0; };
        // All the same size off stage: piled on one spot they ate each other
        // and the later takes ran out of pills to cast.
        const exile = keep => { for (const e of sim.enemies) if (!keep.has(e)) { tame(e); e.r = 18; e.x = DUMP.x; e.y = DUMP.y; e.vx = e.vy = 0; e.targetX = e.x; e.targetY = e.y; } };
        const clearViruses = (x, y, keep) => { for (const v of sim.viruses) if (!keep.has(v) && Math.hypot(v.x - x, v.y - y) < 2400) { v.x = DUMP.x; v.y = DUMP.y; } };
        // Back from the dead: the hero is eaten in the first take, so each one
        // starts by putting it back on its feet.
        const revive = (x, y, r) => {
            p.alive = true; p.killStreak = 0;
            p.cells.length = 0; p.cells.push(hero);
            Object.assign(hero, { x, y, r, vx: 0, vy: 0, boostX: 0, boostY: 0, sprintTime: 0, immuneTime: 0, magnetTime: 0, tpPhase: 0, bornTime: sim.now - 60000 });
            p.splitMilestones = { level1: false, level2: false };
            p.lastSplitTime = 0;
            window.__pais.clear();
        };
        const put = (c, x, y) => { tame(c); c.x = x; c.y = y; c.vx = c.vy = 0; c.targetX = x; c.targetY = y; };
        // Nobody stands still: every pill drifts around its mark.
        const drift = (c, ax, ay, f, i) => put(c, ax + Math.cos(f / 9 + i) * 80, ay + Math.sin(f / 7 + i * 2) * 60);
        const centroid = () => {
            const cells = window.me().cells; let cx = 0, cy = 0;
            cells.forEach(c => { cx += c.x; cy += c.y; });
            return cells.length ? { x: cx / cells.length, y: cy / cells.length } : null;
        };
        const shoot = async (name, frames, zoom, setup, step) => {
            const spot = setup();
            window.__zoom = zoom;
            for (let i = 0; i < 16; i++) { exile(spot.cast); step(-1); window.__tick(TICK); }
            window.__snapCam(spot.x, spot.y);
            const from = n;
            for (let f = 0; f < frames; f++) {
                // Two rules of the game take pills out of a take: bots have a
                // time to live (botExpira), and a bot on a kill streak is
                // retired as a winner (botStreak -> 'pentakill'). Both off
                // while recording, or the star of the shot vanishes halfway.
                sim.botExpira.clear();
                sim.botStreak.clear();
                if (sim._botRetirar) sim._botRetirar.clear();
                exile(spot.cast);
                step(f);
                for (let k = 0; k < 2; k++) window.__tick(TICK);
                // After the ticks: updateGame recentres the camera on the
                // player, so a take that follows a BOT has to move it here.
                if (spot.cam) spot.cam();
                window.__draw();
                readHud();
                await sendFrame('deaths/', n++);
                window.__status = { phase: 'deaths', shot: name, frame: n, cells: window.me().cells.length };
            }
            shots.push({ name, from, frames });
        };
        const spare = () => [...sim.enemies].sort((a, b) => a.r - b.r);
        // The HUD is HTML over the canvas, so it is not in the capture: log
        // what it says, frame by frame, and the video redraws it (src/Origin).
        const hud = [];
        const txt = id => { const e = document.getElementById(id); return e ? e.textContent.trim() : ''; };
        const readHud = () => {
            // Each row is "<span>1. name</span><span>mass</span>" (.lb-item).
            const rows = [...document.querySelectorAll('#lb-list .lb-item')].slice(0, 10).map(r => {
                const sp = r.querySelectorAll('span');
                return { n: sp[0] ? sp[0].textContent.trim() : '', m: sp[1] ? sp[1].textContent.trim() : '', me: r.classList.contains('is-me') };
            });
            hud.push({ mass: txt('score'), alive: txt('enemyCount'), time: txt('timerDisplay'), kills: txt('killsVal'), lb: rows });
        };
        const spots = [[-0.5, 0.45], [0.4, -0.5], [-0.35, -0.4], [0.5, 0.35], [-0.55, -0.05], [0.1, 0.55], [-0.1, -0.6], [0.55, -0.15]];
        const at = i => ({ x: spots[i][0] * lim, y: spots[i][1] * lim });

        /* 1 - the virus gets you, and then they do. */
        {
            const { x, y } = at(0);
            const killer = spare()[sim.enemies.length - 1];
            const virus = sim.viruses[0];
            clearViruses(x, y, new Set([virus]));
            const cast = new Set([killer]);
            const go = { on: false };
            await shoot('virus', 56, 1.3, () => {
                revive(x, y, 62);
                virus.x = x + 240; virus.y = y - 20;
                killer.r = 150; put(killer, x + 620, y + 60);
                return { x, y, cast };
            }, f => {
                const h = centroid();
                if (!h) return;
                if (window.me().cells.length > 1) go.on = true;
                if (go.on) {
                    const dx = h.x - killer.x, dy = h.y - killer.y, d = Math.hypot(dx, dy) || 1, s = Math.min(d, 26);
                    put(killer, killer.x + dx / d * s, killer.y + dy / d * s);
                    window.__aim(h.x - 300, h.y - 60);
                } else {
                    put(killer, x + 620 + Math.sin(f / 6) * 50, y + 60 + Math.cos(f / 8) * 40);
                    window.__aim(virus.x, virus.y);
                }
            });
        }

        /* 2 - smaller than the rival, so you split into its halves. */
        {
            const { x, y } = at(1);
            const rival = spare().filter(e => e.r > 6).slice(0, 5);
            clearViruses(x, y, new Set());
            const cast = new Set(rival);
            const seats = [[380, -40], [560, 90], [750, -60], [940, 70], [1120, -20]];
            const split = { done: false };
            await shoot('outnumbered', 56, 1.15, () => {
                revive(x, y, 60);
                rival.forEach((c, i) => { Object.assign(c, { id: rival[0].id, name: 'WHALE', r: 34, colorTop: rival[0].colorTop, colorBot: rival[0].colorBot, skinUrl: null }); put(c, x + seats[i][0], y + seats[i][1]); });
                return { x, y, cast };
            }, f => {
                rival.forEach((c, i) => { if (sim.enemies.includes(c)) drift(c, x + seats[i][0], y + seats[i][1], f, i); });
                const h = centroid(), next = rival.find(c => sim.enemies.includes(c));
                if (!h || !next) return;
                window.__aim(next.x, next.y);
                if (!split.done && f >= 4) { window.__split(); split.done = true; }
            });
        }

        /* 3 - the mass milestone bursts you while you run, and the pieces feed. */
        {
            const { x, y } = at(2);
            const snack = spare().filter(e => e.r > 6).slice(0, 5);
            clearViruses(x, y, new Set());
            const cast = new Set(snack);
            const ring = [[360, -100], [560, 120], [760, -70], [950, 90], [1140, -30]];
            await shoot('milestone', 56, 1.15, () => {
                revive(x, y, Math.sqrt(96000 / (Math.PI * 2)));
                hero.bornTime = sim.now;   // freshly split, or the halves merge back
                const twin = new (hero.constructor)(x - 150, y - 90, hero.r, hero.colorBot, hero.colorTop, hero.name, false, hero.skinUrl, hero.id, sim.now);
                p.cells.push(twin);
                snack.forEach((c, i) => { Object.assign(c, { r: 62, skinUrl: null }); put(c, x + ring[i][0], y + ring[i][1]); });
                return { x, y, cast };
            }, f => {
                snack.forEach((c, i) => { if (sim.enemies.includes(c)) drift(c, x + ring[i][0], y + ring[i][1], f, i); });
                if (f === 3) p.cells.forEach(c => { c.r = Math.sqrt(105000 / (Math.PI * 2)); c.flashColor = '#00ff00'; c.flashTime = 600; });
                const h = centroid(), next = snack.find(c => sim.enemies.includes(c));
                if (h) window.__aim(next ? next.x : h.x + 500, next ? next.y : h.y);
            });
        }

        /* 4 - Spain runs down Argentina. */
        {
            const { x, y } = at(3);
            const prey = spare().filter(e => e.r > 6)[0];
            clearViruses(x, y, new Set());
            const cast = new Set([prey]);
            await shoot('flags', 50, 1.5, () => {
                revive(x, y, 58);
                Object.assign(prey, { r: 40, name: 'ARG', skinUrl: null });
                put(prey, x + 300, y - 40);
                window.__pais.set(hero.id, 'ES');
                window.__pais.set(prey.id, 'AR');
                return { x, y, cast };
            }, f => {
                if (!sim.enemies.includes(prey)) { window.__aim(hero.x + 600, hero.y - 120); return; }
                // It runs, and it is not fast enough: slower than the hero,
                // so the chase closes inside the take instead of never ending.
                put(prey, prey.x + 3.2, prey.y - 1.2 + Math.sin(f / 5) * 9);
                window.__aim(prey.x, prey.y);
            });
        }

        /* 7 - the shot: two hits on a virus. The first turns it purple, the
         *     second bursts it and throws its own projectile. */
        {
            const { x, y } = at(6);
            const virus = sim.viruses[0];
            clearViruses(x, y, new Set([virus]));
            const cast = new Set();
            // It keeps closing in while it fires, so the arena scrolls under
            // it: standing still to shoot looked parked.
            await shoot('shot', 50, 1.25, () => {
                revive(x - 40, y + 40, 72);
                // A shot slows down as it flies (0.93 per tick) and dies at
                // about 285 units: farther than that and it never arrived.
                virus.x = x + 250; virus.y = y - 30; virus.damaged = false; virus.animTime = 0;
                return { x, y, cast };
            }, f => {
                const live = sim.viruses.find(v => Math.hypot(v.x - x, v.y - y) < 1400) || virus;
                window.__aim(live.x, live.y);
                // The global cooldown lets one shot through every few frames.
                if (f % 3 === 0) window.__shoot();   // a burst: first hit turns it purple, the second bursts it
            });
        }

        /* 6, 7, 8 - other pills using the game's skills. The camera rides with
         *     the star (it is the subject of the shot) and the star never
         *     stops: it runs a straight line eating the pills strung along it,
         *     so the arena scrolls under it the whole take.
         */
        // Heading, speed, when the skill goes off and where its prey waits.
        const MOVES = {
            sprint: { ang: -0.22, speed: 21, fire: [0, 20], seats: [[-260, 30], [-20, -80], [230, 40], [470, -60]] },
            shield: { ang: 2.85, speed: 14, fire: [0, 16, 32], seats: [[220, -90], [10, 70], [-210, -40], [-430, 60]] },
            tp: { ang: 1.15, speed: 12, fire: [10], seats: [[-90, -230], [80, -20], [-120, 190], [60, 400]] },
        };
        const botTake = (name, i, id) => {
            const { x, y } = at(i);
            const pool = spare().filter(e => e.r > 6);
            const star = pool[pool.length - 1], prey = pool.slice(0, 4);
            if (!star || prey.length < 4) return Promise.resolve();
            clearViruses(x, y, new Set());
            for (const v of sim.viruses) if (Math.hypot(v.x - x, v.y - y) < 4000) { v.x = DUMP.x; v.y = DUMP.y; }
            const cast = new Set([star, ...prey]);
            // Each one runs its own line, at its own speed, and fires its
            // skill at its own moments: three takes with the same heading and
            // the same timing looked like the same clip pasted three times.
            const { ang: ANG, speed: SPEED, fire, seats } = MOVES[name];
            return shoot(name, 44, 1.25, () => {
                revive(DUMP.x, -DUMP.y, 40);           // the hero sits this one out, off stage
                Object.assign(star, {
                    r: 62, name: name.toUpperCase(), skinUrl: null,
                    // A bot that crosses the mass milestone gets a skill of its
                    // own, and the first thing it did was teleport out of shot.
                    massMilestoneMet: true, botSkills: [], botNextSkillTime: 1e15, botGcd: 1e15,
                });
                put(star, x - Math.cos(ANG) * 520, y - Math.sin(ANG) * 520);
                prey.forEach((c, k) => { Object.assign(c, { r: 30, skinUrl: null }); put(c, x + seats[k][0], y + seats[k][1]); });
                window.__botSkill(star, id);
                // The camera rides with the star. While it is teleporting OUT
                // it holds the spot it left, so the jump reads as one: it
                // vanishes here and the next frame is somewhere else entirely.
                const eye = { x, y };
                return { x, y, cast, cam: () => {
                    if (sim.enemies.includes(star) && star.tpPhase !== 1) { eye.x = star.x; eye.y = star.y; }
                    window.__snapCam(eye.x, eye.y);
                } };
            }, f => {
                prey.forEach((c, k) => { if (sim.enemies.includes(c)) drift(c, x + seats[k][0], y + seats[k][1], f, k); });
                if (!sim.enemies.includes(star)) return;
                if (fire.includes(f)) {
                    window.__botSkill(star, id);
                    // The real teleport of the game: it picks its own spot,
                    // anywhere on the map, and the camera goes with it. The only
                    // thing moved is a landing on top of the off-stage pile.
                    if (id === 4 && star.tpDest && Math.hypot(star.tpDest.x - DUMP.x, star.tpDest.y - DUMP.y) < 2200) {
                        star.tpDest = { x: -star.tpDest.x, y: -star.tpDest.y };
                    }
                }
                // While it is teleporting the game owns the cell: moving it by
                // hand turned the jump into a slide.
                if (star.tpPhase > 0) return;
                star.r = 62;                           // no growing: a big bot is retired by the game
                star.botSkills = []; star.botNextSkillTime = 1e15; star.massMilestoneMet = true;
                // Straight across, nudged towards whatever pill is next in line.
                const next = prey.find(c => sim.enemies.includes(c) && c.x > star.x - 60);
                const ty = next ? (next.y - star.y) * 0.18 : 0;
                star.x += Math.cos(ANG) * SPEED; star.y += Math.sin(ANG) * SPEED + ty;
                star.vx = star.vy = 0; star.targetX = star.x; star.targetY = star.y;
            });
        };
        await botTake('sprint', 4, 3);          // a rival bolts across, eating
        await botTake('shield', 5, 6);          // another crosses behind its shield
        await botTake('tp', 7, 4);              // and one vanishes mid-run

        ws.send('deaths/events.json'); ws.send(JSON.stringify({ fps: 30, shots, hud }, null, 2));
        await new Promise(r => setTimeout(r, 800));
        window.__status = { phase: 'done', shots };
    }

    /*
     * One pill, from the moment it is born until it owns the room: it grows,
     * and the podium crowns of arcade (bronze, silver, gold) land on its head
     * as it climbs. Only the crowns — the plain numbers of places 4 to 10 never
     * show, because the take sets the rank itself.
     *
     * The camera is the game's own: it pulls back as the pill grows, with the
     * live settings of the server (base zoom 2, exponent 0.29) and a little
     * extra push-in on top, because there is no HUD and no crowd here and at
     * the usual distance the frame would look empty.
     *
     * Nothing else is in the shot: the food is cleared and every other pill is
     * parked far outside the camera, so what is left is the grid, the pill and
     * its crown.
     */
    async function growth(sim, hero, sendFrame, ws) {
        ws.send('reset growth');
        const p = window.me();
        const FRAMES = 120, EXTRA = 1.35;      // 4 s at 30 fps
        // A recolour every half second, from the player's own palette
        // (PAL_DEFAULT in game/index.html). The first one is the pill everybody
        // starts with: grey over green.
        const COLORS = [
            ['#c0c8d0', '#00ff44'], ['#ffffff', '#1a73e8'], ['#ffce3d', '#ff2a2a'], ['#00ffaa', '#cc00ff'],
            ['#ff8c00', '#ffffff'], ['#66ccff', '#ff2a2a'], ['#cc00ff', '#ffce3d'], ['#ffffff', '#00ff44'],
        ];
        const R0 = 11, R1 = 150;
        // The server's live values, so it frames like a real match.
        ZOOM_CONFIG.baseScale = 2; ZOOM_CONFIG.exponent = 0.29; ZOOM_CONFIG.maxScale = 3.2;
        const x = 0, y = 0;
        // An empty stretch of arena: everything else parked far away.
        for (const e of sim.enemies) { e.x = sim.mapSize * 0.9; e.y = sim.mapSize * 0.9; e.vx = e.vy = 0; e.targetX = e.x; e.targetY = e.y; e.botSkills = []; e.botNextSkillTime = 1e15; }
        for (const v of sim.viruses) if (Math.hypot(v.x - x, v.y - y) < 3000) { v.x = sim.mapSize * 0.9; v.y = sim.mapSize * 0.9; }
        // Nothing but the grid: no food, and every virus parked in a corner.
        // Moving only the near ones was not enough — the camera pulls back as
        // the pill grows and one of them walked into the frame.
        const noFood = () => {
            sim.foods.length = 0;
            if (sim.foodGrid && sim.foodGrid.clear) sim.foodGrid.clear();
            for (const v of sim.viruses) { v.x = sim.mapSize * 0.95; v.y = sim.mapSize * 0.95; v.vx = v.vy = 0; }
            // The bots move on their own, and one of them wandered back into
            // shot once the camera was wide enough: park them every frame.
            for (const e of sim.enemies) { e.x = sim.mapSize * 0.9; e.y = sim.mapSize * 0.9; e.vx = e.vy = 0; e.targetX = e.x; e.targetY = e.y; }
            if (sim.ejectedMasses) sim.ejectedMasses.length = 0;
        };
        noFood();
        p.cells.length = 0; p.cells.push(hero);
        Object.assign(hero, { x, y, r: R0, vx: 0, vy: 0, boostX: 0, boostY: 0, bornTime: sim.now });
        for (let i = 0; i < 20; i++) { window.__tick(TICK); }
        for (let f = 0; f < FRAMES; f++) {
            const t = f / (FRAMES - 1);
            // Slow at first, faster as it goes: it reads as gaining speed.
            hero.r = R0 + (R1 - R0) * Math.pow(t, 1.7);
            hero.x = x; hero.y = y; hero.vx = hero.vy = 0;
            noFood();
            window.__aim(x + 220, y - 60);
            window.__tick(TICK); window.__tick(TICK);
            hero.r = R0 + (R1 - R0) * Math.pow(t, 1.7);
            hero.x = x; hero.y = y;
            const [cTop, cBot] = COLORS[Math.floor(f / 15) % COLORS.length];
            hero.colorTop = cTop; hero.colorBot = cBot;
            // A second of each: bare for the first second, then bronze,
            // silver and gold, one per second.
            window.__rank(f >= 90 ? 1 : f >= 60 ? 2 : f >= 30 ? 3 : null);
            window.__zoom = EXTRA;
            window.__snapCam(x, y);
            window.__draw();
            await sendFrame('growth/', f);
            window.__status = { phase: 'growth', frame: f + 1, r: Math.round(hero.r) };
        }
        ws.send('growth/events.json'); ws.send(JSON.stringify({ fps: 30, frames: FRAMES }, null, 2));
        await new Promise(r => setTimeout(r, 800));
        window.__status = { phase: 'done', frames: FRAMES };
    }
})().catch(e => { window.__status = { phase: 'error', msg: String(e) }; });
