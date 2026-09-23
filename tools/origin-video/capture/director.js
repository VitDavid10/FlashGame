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
    // kill clips of the closing beat), 'growth' (the pill and its crowns),
    // 'tour' (the bare map, no pill) or 'action' (10 s of scenes on the beat
    // of the game's music). See skills(), deaths(), growth(), tour(), action().
    const MODE = window.__captureMode || 'kills';
    // The crowns of the podium only exist in ARCADE, so that take starts there.
    const ARCADE = MODE === 'growth';
    // No player pill on screen in these two (see drawEnemyArrow below).
    window.__pwTour = MODE === 'tour' || MODE === 'action';
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
        // The tour and the action take have no pill on screen, so the
        // "NOBODY NEARBY" compass (it fires after 5 s without an enemy in
        // view) would otherwise pop up over an empty map.
        if (window.__pwTour) drawEnemyArrow = function () {};
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

    // Before the virus shuffle below: the tour wants the map as it is.
    if (MODE === 'tour') return tour(sim, hero, sendFrame, ws);
    if (MODE === 'action') return action(sim, hero, sendFrame, ws);

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
     *      magnet, with the camera riding along.
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
                // The camera rides with the star, and holds its last spot if
                // the star is gone, instead of snapping back to the hero.
                const eye = { x, y };
                return { x, y, cast, cam: () => {
                    if (sim.enemies.includes(star)) { eye.x = star.x; eye.y = star.y; }
                    window.__snapCam(eye.x, eye.y);
                } };
            }, f => {
                prey.forEach((c, k) => { if (sim.enemies.includes(c)) drift(c, x + seats[k][0], y + seats[k][1], f, k); });
                if (!sim.enemies.includes(star)) return;
                if (fire.includes(f)) window.__botSkill(star, id);
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
        /* 8 - the magnet. It is the HERO's: the game only drags food towards a
         *     PLAYER's cells (a bot's magnet is just particles), and this one
         *     has to be seen pulling the arena in. */
        {
            const { x, y } = at(7);
            const snack = spare().filter(e => e.r > 6).slice(0, 3);
            clearViruses(x, y, new Set());
            for (const v of sim.viruses) if (Math.hypot(v.x - x, v.y - y) < 4000) { v.x = DUMP.x; v.y = DUMP.y; }
            const cast = new Set(snack);
            const seats = [[420, -120], [640, 90], [880, -50]];
            await shoot('magnet', 44, 1.2, () => {
                revive(x, y, 56);
                snack.forEach((c, k) => { Object.assign(c, { r: 30, skinUrl: null }); put(c, x + seats[k][0], y + seats[k][1]); });
                return { x, y, cast };
            }, f => {
                p.skillState[5] = 8000;            // magnet on for the whole take
                snack.forEach((c, k) => { if (sim.enemies.includes(c)) drift(c, x + seats[k][0], y + seats[k][1], f, k); });
                const next = snack.find(c => sim.enemies.includes(c));
                window.__aim(next ? next.x : hero.x + 600, next ? next.y : hero.y - 60);
            });
        }

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
        const FRAMES = 120, EXTRA = 1.8;       // 4 s at 30 fps
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
            // The game keeps sending replacements in (botRespawnQueue), and a
            // fresh bot spawns anywhere: that is what flashed on screen for a
            // few frames. No relief while recording.
            if (sim.botRespawnQueue) sim.botRespawnQueue.length = 0;
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
            noFood();                 // again after the ticks: a bot respawned mid-frame shows up otherwise
            window.__snapCam(x, y);
            window.__draw();
            await sendFrame('growth/', f);
            window.__status = { phase: 'growth', frame: f + 1, r: Math.round(hero.r) };
        }
        ws.send('growth/events.json'); ws.send(JSON.stringify({ fps: 30, frames: FRAMES }, null, 2));
        await new Promise(r => setTimeout(r, 800));
        window.__status = { phase: 'done', frames: FRAMES };
    }

    /*
     * A flight over the bare map: no player pill, just the arena as it is
     * (food and viruses) plus staged bits of real gameplay it flies past: bots
     * running others down (the game's own collision rule eats the loser,
     * nothing is faked) and pills leaving the cover of a virus
     * (isHiddenInVirus in shared/sim.js — sitting inside a virus you're
     * smaller than is a real hiding spot, not a pose).
     *
     * 20 s in two halves. The first 10 s (OPEN) start pushed in on the food
     * and open up as the camera speeds up; the next 10 s cruise at full speed
     * and the final zoom. Each half has one chase and one hiding pill.
     *
     * The camera is the director's, not the game's: the game's view scale is
     * replaced by a fixed curve (px per world unit), because with no player
     * there is nothing for the game's own zoom to follow. The hero is parked in
     * a corner and every bot not in a scene sits in the opposite corner, both
     * far from the route, so nothing else touches the food or the viruses.
     *
     * The route is not hand-placed: it is picked by scanning the map for the
     * straight run that passes the most viruses — spaced apart, so they don't
     * bunch into one cluttered shot — without one already being in the first
     * frame (so they arrive as the view opens).
     */
    async function tour(sim, hero, sendFrame, ws) {
        ws.send('reset tour');
        const OPEN = 300;                      // the opening 10 s (speeding up, zooming out)
        const FRAMES = 600;                    // 20 s at 30 fps; after OPEN it cruises
        const SMALL_R = 24, BIG_R = 36;        // the chase pairs: 1.5x, well past the game's 1.15x
        // Z0 lower and the zoom on an ease-OUT curve (was ease-in-out): the old
        // curve barely moved for its first ~2 s — it looked stuck on the tight
        // opening shot ("demasiado zoom" before the 2 s mark, David) — an
        // ease-out starts opening the frame from frame 0.
        const Z0 = 2.1, Z1 = 1.25;             // px per world unit, tight to open
        const V0 = 3.5, V1 = 8;                // camera speed, units per frame
        const M = sim.mapSize, LIM = M * 0.72;  // keep the route (and the view around it) far from the walls
        const sway = 140;                      // sideways weave, so it is not a ruler-straight line
        const easeOut = t => 1 - (1 - t) * (1 - t);
        const openT = f => Math.min(1, f / (OPEN - 1));
        // How far along the line the camera is at frame f (units); cached per
        // frame so the scenes below can also ask "when does the camera get
        // here" (frameAtS), not just the flight loop.
        const ALONG = new Float64Array(FRAMES);
        { let s = 0; for (let f = 0; f < FRAMES; f++) { ALONG[f] = s; s += V0 + (V1 - V0) * easeOut(openT(f)); } }
        const LEN = ALONG[FRAMES - 1];
        const zoomAt = f => Z0 + (Z1 - Z0) * easeOut(openT(f));
        const frameAtS = targetS => { for (let f = 0; f < FRAMES; f++) if (ALONG[f] >= targetS) return f; return FRAMES - 1; };

        // What the widest frame of the run can see, for the scan.
        const halfH = 540 / Z1;
        const first = { w: 960 / Z0, h: 540 / Z0 };
        // Two viruses only both count on the route if they are at least this
        // far apart along it — otherwise a tight cluster scored as well as a
        // well-spaced run and the flight looked crowded with virus after
        // virus ("muchos virus juntos", David).
        const MIN_VIRUS_GAP = 900;
        // The chases: where along the route (the camera gets there at that
        // frame) and on which side of it. No virus may sit there, or the small
        // pill hides in it and can't be eaten.
        const DUELS = [{ s: ALONG[OPEN - 1] * 0.32, side: 1 }, { s: ALONG[430], side: -1 }];
        // The hiding pills: which stretch of the route their virus must be in —
        // after that half's chase, and early enough that the pill is all the
        // way out before the half ends — and the spot it's best near.
        const HIDES = [
            { from: ALONG[OPEN - 1] * 0.45, to: ALONG[OPEN - 70], aim: ALONG[OPEN - 1] * 0.62 },
            { from: ALONG[490], to: ALONG[FRAMES - 70], aim: ALONG[505] },
        ];
        const CROWD_AT = [];
        for (let k = 0; k < FRAMES; k += 50) CROWD_AT.push(k);
        CROWD_AT.push(FRAMES - 1);
        let best = null;
        // Never more than 2 viruses on screen at once; 3 only if no route in
        // the map allows 2.
        for (const maxCrowd of [2, 3]) {
            for (let i = 0; i < 6000; i++) {
                const sx = (Math.random() * 2 - 1) * LIM, sy = (Math.random() * 2 - 1) * LIM, a = Math.random() * Math.PI * 2;
                const ux = Math.cos(a), uy = Math.sin(a);
                if (Math.abs(sx + ux * LEN) > LIM || Math.abs(sy + uy * LEN) > LIM) continue;
                let skip = false;
                const onRoute = [];
                for (const v of sim.viruses) {
                    const rx = v.x - sx, ry = v.y - sy;
                    const s = rx * ux + ry * uy, c = -rx * uy + ry * ux;
                    if (DUELS.some(d => s > d.s - 450 && s < d.s + 550 && Math.abs(c - d.side * 90) < 300)) { skip = true; break; }
                    if (s > 0 && s < LEN && Math.abs(c) < halfH * 0.8) onRoute.push({ v, s, c });
                    if (Math.abs(rx) < first.w + v.r && Math.abs(ry) < first.h + v.r) { skip = true; break; }
                }
                if (skip) continue;
                // Spacing along the lane isn't enough: once the shot opens up,
                // the whole frame counts (checked on a frame every 50; the
                // sway is ignored, ~140 units).
                let crowd = 0;
                for (const k of CROWD_AT) {
                    const cx = sx + ux * ALONG[k], cy = sy + uy * ALONG[k], hw = 960 / zoomAt(k), hh = 540 / zoomAt(k);
                    let n = 0;
                    for (const v of sim.viruses) if (Math.abs(v.x - cx) < hw + v.r && Math.abs(v.y - cy) < hh + v.r) n++;
                    crowd = Math.max(crowd, n);
                }
                if (crowd > maxCrowd) continue;
                onRoute.sort((p, q) => p.s - q.s);
                const spaced = [];
                for (const o of onRoute) if (!spaced.length || o.s - spaced[spaced.length - 1].s >= MIN_VIRUS_GAP) spaced.push(o);
                const hideAt = HIDES.map(h => spaced.filter(o => o.s > h.from && o.s < h.to));
                let food = 0;
                for (const f of sim.foods) {
                    const rx = f.x - sx, ry = f.y - sy;
                    const s = rx * ux + ry * uy, c = -rx * uy + ry * ux;
                    if (s > 0 && s < LEN && Math.abs(c) < halfH * 0.8) food++;
                }
                const score = hideAt.filter(l => l.length).length * 5000 + Math.min(spaced.length, 7) * 1000 + food;
                if (!best || score > best.score) best = { score, sx, sy, ux, uy, spaced, hideAt, food, crowd };
            }
            if (best) break;
        }
        if (!best) throw new Error('no route found');
        const dirX = best.ux, dirY = best.uy, perpX = -best.uy, perpY = best.ux;

        const HERO_AT = { x: -M * 0.93, y: -M * 0.93 }, PARK = { x: M * 0.9, y: M * 0.9 };
        // Every real bot not in a scene gets parked at the SAME point (PARK)
        // every frame — cheap, but it piles them on top of one another, and the
        // game's own "bigger eats smaller" collision rule (shared/sim.js)
        // doesn't know it's a parking spot: a cast member left in that pile
        // could get eaten before its own turn ever comes. So the cast is never
        // sent there — updateCast() below places it every single frame.
        const castSet = new Set();
        const hold = () => {
            Object.assign(hero, { x: HERO_AT.x, y: HERO_AT.y, vx: 0, vy: 0, boostX: 0, boostY: 0 });
            for (const e of sim.enemies) {
                if (castSet.has(e)) continue;
                e.x = PARK.x; e.y = PARK.y; e.vx = e.vy = 0; e.targetX = e.x; e.targetY = e.y; e.botSkills = []; e.botNextSkillTime = 1e15;
            }
            // A bot's natural time-to-live or kill-streak retirement would pull
            // it out of sim.enemies on its own; the cast has to survive on cue,
            // not whenever the game feels like retiring it (same guard as the
            // 'deaths' mode above).
            sim.botExpira.clear(); sim.botStreak.clear();
            if (sim._botRetirar) sim._botRetirar.clear();
            if (sim.ejectedMasses) sim.ejectedMasses.length = 0;
            if (sim.botRespawnQueue) sim.botRespawnQueue.length = 0;
        };
        const tame = c => { c.botSkills = []; c.botNextSkillTime = 1e15; c.shouldSplit = false; c.immuneTime = 0; c.tpPhase = 0; c.sprintTime = 0; c.magnetTime = 0; };
        const put = (c, x, y) => { c.x = x; c.y = y; c.vx = c.vy = 0; c.targetX = x; c.targetY = y; };
        const p = window.me();
        p.cells.length = 0; p.cells.push(hero);
        hero.r = 10;
        // A fixed scale instead of the game's: see above.
        window.__abs = Z0;
        window.getViewScale = () => window.__abs;
        // The pill has to be out of the shot: any HUD text or hint the canvas
        // draws for it would be a giveaway, and floating texts are cleared.
        floatingTexts.length = 0;

        // The cast is on stage from the first frame to the last, and never
        // jumps: nobody pops in or out of the shot (David). A pill "arrives"
        // because the camera flies up to where it already is, and "leaves"
        // because it keeps going its own way while the camera flies on. The
        // only exit that isn't the frame's edge is being eaten, on screen.
        // No names over them either: they're scenery, not players.
        const pool = [...sim.enemies].filter(e => e.r > 6).sort((a, b) => a.r - b.r);
        const take = i => pool.splice(i, 1)[0];

        // ---- Chases: one bot runs another down. Real cells, real collision
        // (shared/sim.js resolves bot-vs-bot eating on its own): this only has
        // to place them and let it happen.
        const duels = [];
        for (const d of DUELS) {
            if (pool.length < 2) break;
            const small = take(0), big = take(pool.length - 1);
            const anchor = { x: best.sx + dirX * d.s, y: best.sy + dirY * d.s };
            const px = perpX * d.side, py = perpY * d.side;
            // The chase starts a little before the camera gets there, so it's
            // already under way as they come into view. Closing speed is
            // 8.5 - 1.6 = 6.9 units/frame on a ~320-unit gap: ~46 frames.
            const startF = Math.max(0, frameAtS(d.s) - 26);
            const smallAt = { x: anchor.x + px * 90 + dirX * 60, y: anchor.y + py * 90 + dirY * 60 };
            const bigAt = { x: anchor.x + px * 90 - dirX * 260, y: anchor.y + py * 90 - dirY * 260 };
            duels.push({ small, big, startF, smallAt, bigAt, px, py });
            castSet.add(small); castSet.add(big);
            tame(small); tame(big);
            // The game eats only past 1.15x. They're on stage (and eating
            // pellets) from frame 0, which once took 34 vs 26 to 35 vs 31 —
            // under the bar, and the big one just sat on top of the small one.
            // Sizes are held until the catch (updateCast), with room to spare.
            small.r = SMALL_R; big.r = BIG_R;
            small.name = big.name = '';
            put(small, smallAt.x, smallAt.y); put(big, bigAt.x, bigAt.y);
        }

        // ---- Hiding pills: tucked inside a virus, then they leave cover.
        // isHiddenInVirus() needs r < virus.r and to sit fully inside it —
        // this places it there for real, not just visually near one. It's
        // inside from frame 0, so it doesn't appear: it was always there.
        const hides = [];
        HIDES.forEach((h, k) => {
            const list = best.hideAt[k];
            if (!list.length || !pool.length) return;
            const target = list.reduce((a, b) => Math.abs(b.s - h.aim) < Math.abs(a.s - h.aim) ? b : a);
            const bot = take(pool.length - 1);
            const v = target.v;
            const revealF = Math.max(0, frameAtS(target.s) - 6), outF = revealF + 38;
            // It walks out on the far side from the route, not across the
            // camera's path.
            const side = target.c >= 0 ? 1 : -1;
            hides.push({ bot, v, revealF, outF, px: perpX * side, py: perpY * side });
            castSet.add(bot);
            tame(bot);
            bot.r = Math.max(8, v.r * 0.45);
            bot.name = '';
            put(bot, v.x, v.y);
        });

        // Places the cast every frame. Called once per frame — the movement
        // below is a per-frame step, not a per-tick one (the flight loop still
        // ticks the sim twice a frame).
        const updateCast = f => {
            for (const duel of duels) {
                const smallAlive = sim.enemies.includes(duel.small);
                if (smallAlive) { duel.small.r = SMALL_R; duel.big.r = BIG_R; }
                if (f < duel.startF) {
                    // Waiting: a small idle sway around its spot (a sine, not
                    // accumulated, so it stays put overall).
                    put(duel.small, duel.smallAt.x + duel.px * Math.sin(f / 9) * 6, duel.smallAt.y + duel.py * Math.sin(f / 9) * 6);
                    put(duel.big, duel.bigAt.x + dirX * Math.sin(f / 11) * 6, duel.bigAt.y + dirY * Math.sin(f / 11) * 6);
                } else if (smallAlive) {
                    duel.small.x += dirX * 1.6 + duel.px * Math.sin(f / 5) * 2;
                    duel.small.y += dirY * 1.6 + duel.py * Math.sin(f / 5) * 2;
                    put(duel.small, duel.small.x, duel.small.y);
                    const dx = duel.small.x - duel.big.x, dy = duel.small.y - duel.big.y, d = Math.hypot(dx, dy) || 1, step = Math.min(d, 8.5);
                    put(duel.big, duel.big.x + dx / d * step, duel.big.y + dy / d * step);
                } else {
                    // Caught it: it wanders off sideways, away from the route,
                    // and out the edge of the frame. Along the route it walked
                    // straight into the next scene's virus.
                    put(duel.big, duel.big.x + duel.px * 3, duel.big.y + duel.py * 3);
                }
            }
            for (const hide of hides) {
                hide.v.vx = hide.v.vy = 0;   // a moving virus can burst anything touching it: hold it still, it's cover
                const out = hide.v.r + 60;
                let d = 0;
                if (f >= hide.revealF) {
                    const t = Math.min(1, (f - hide.revealF) / (hide.outF - hide.revealF));
                    d = out * (1 - (1 - t) * (1 - t));
                    if (f > hide.outF) d += (f - hide.outF) * 1.5;   // out of cover, it keeps walking away
                }
                put(hide.bot, hide.v.x + hide.px * d, hide.v.y + hide.py * d);
            }
        };

        // Food a cast pill eats respawns at a random spot of the map — and if
        // that spot is in shot, a pellet pops out of nowhere. Respawns that
        // land in (or next to) the frame are moved elsewhere.
        let view = null, foodEaten = 0;
        sim.spawnFood = function () {
            Object.getPrototypeOf(this).spawnFood.call(this);
            foodEaten++;
            const fd = this.foods[this.foods.length - 1];
            for (let k = 0; view && k < 50 && Math.abs(fd.x - view.x) < view.hw && Math.abs(fd.y - view.y) < view.hh; k++) {
                this.foodGrid.remove(fd);
                fd.x = (Math.random() * 2 - 1) * this.mapSize * 0.95; fd.y = (Math.random() * 2 - 1) * this.mapSize * 0.95;
                this.foodGrid.insert(fd);
            }
        };
        // Largest single-frame jump of any cast pill: a check that nobody
        // teleported (a real move is under ~10 units a frame).
        const lastAt = new Map();
        let maxStep = 0;

        const virusesBefore = sim.viruses.length;
        for (let i = 0; i < 10; i++) { hold(); window.__tick(TICK); }
        // The weave: one arc over the opening (as the 10 s cut had), and it
        // keeps going as a slow S after it.
        const pos = f => {
            const s = ALONG[f];
            const off = sway * Math.sin(f / (OPEN - 1) * Math.PI);
            return { x: best.sx + best.ux * s - best.uy * off, y: best.sy + best.uy * s + best.ux * off };
        };
        window.__frame = 0;
        window.__status = { phase: 'recording', frame: 0 };
        foodEaten = 0;   // the warm-up ticks don't count
        for (let f = 0; f < FRAMES; f++) {
            const c = pos(f), z = zoomAt(f);
            // The frame plus a margin: the camera moves under 10 units a frame.
            view = { x: c.x, y: c.y, hw: 960 / z + 300, hh: 540 / z + 300 };
            updateCast(f);
            hold(); window.__tick(TICK);
            hold(); window.__tick(TICK);
            hold();
            for (const b of castSet) {
                if (!sim.enemies.includes(b)) continue;
                const l = lastAt.get(b);
                if (l) maxStep = Math.max(maxStep, Math.hypot(b.x - l.x, b.y - l.y));
                lastAt.set(b, { x: b.x, y: b.y });
            }
            window.__abs = z;
            window.__snapCam(c.x, c.y);
            window.__draw();
            await sendFrame('tour/', f);
            window.__frame = f + 1;
            window.__status = { phase: 'recording', frame: f + 1 };
        }
        view = null;
        delete sim.spawnFood;
        const meta = {
            fps: 30, frames: FRAMES, zoom: [Z0, Z1], route: { from: { x: best.sx, y: best.sy }, len: Math.round(LEN) },
            viruses: best.spaced.length, virusesOnScreenMax: best.crowd, foodOnRoute: best.food,
            duels: duels.map(d => ({ startF: d.startF, eaten: !sim.enemies.includes(d.small) })),
            hides: hides.map(h => ({ revealF: h.revealF, outF: h.outF })),
            maxStep: Math.round(maxStep * 10) / 10,
            // Pellets the cast pills ate on screen (each one respawned outside the frame).
            foodEaten,
            virusesBefore, virusesAfter: sim.viruses.length,
        };
        ws.send('tour/events.json'); ws.send(JSON.stringify(meta, null, 2));
        await new Promise(r => setTimeout(r, 800));
        window.__status = { phase: 'done', ...meta };
    }

    /*
     * 10 s of action on the beat of the game's own match music (snd/music.mp3
     * from 37.172 s: 123 bpm, a kick every 14.63 frames, bars starting on
     * frames 0, 59, 117, 176 and 234, and the song's cut on 293). The camera
     * flies over the map and a scene plays out in front of it on every bar,
     * each hit landing on a kick:
     *   bar 1  a pill sprints into shot and catches another (bar 2's first beat),
     *   bar 2  a pill splits and its half lunges onto a prey,
     *   bar 3  a heavy pill runs into a virus and bursts (the bar's first beat),
     *   bar 4  a pill dives into a virus; its hunter circles it and gives up,
     *          and the pill peeks back out,
     *   bar 5  a pill raises its shield and eats three in a row, one a beat.
     * All of it is the game's own mechanics — eating, splitting, the virus
     * burst, hiding in a virus, the skills — the director only places the
     * actors and times them.
     *
     * Nobody pops in or out of the shot: every actor is on the map from frame
     * 0, comes into shot because the camera gets there, and leaves by an edge.
     * A prey is about a third of its eater's size, and the game draws the
     * bigger pill on top: by the time the game removes the prey it is already
     * under its eater, so it's seen being swallowed, not vanishing (the 20 s
     * tour ate with 36 vs 24, and the prey was still half outside).
     */
    async function action(sim, hero, sendFrame, ws) {
        ws.send('reset action');
        const FRAMES = 300;
        const BEAT = 60 / 123.01 * 30;                   // 14.63 frames
        const beat = k => Math.round(k * BEAT);          // 0, 15, 29, 44, 59, 73, 88 ...
        const V = 6;                                      // camera speed, units per frame
        const M = sim.mapSize;
        // The shot opens up smoothly over the 10 s. (It used to kick in and out
        // on every beat; David: it made the gameplay look like it was shaking.)
        const zoomAt = f => 1.7 - 0.35 * (1 - Math.pow(1 - f / (FRAMES - 1), 2));

        // The route: mostly left to right on screen, anywhere on the map the
        // stretch it needs (and its margins) fits.
        const th = (Math.random() * 2 - 1) * 0.3;
        const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
        const A0 = -1300, A1 = 3000, B = 1100;            // the stretch kept clear, in route units
        let O = null;
        for (let i = 0; i < 500 && !O; i++) {
            const o = { x: (Math.random() * 2 - 1) * M * 0.8, y: (Math.random() * 2 - 1) * M * 0.8 };
            const ok = [[A0, -B], [A0, B], [A1, -B], [A1, B]].every(([a, b]) =>
                Math.abs(o.x + dx * a + nx * b) < M * 0.92 && Math.abs(o.y + dy * a + ny * b) < M * 0.92);
            if (ok) O = o;
        }
        if (!O) throw new Error('no room for the route');
        const W = (a, b) => ({ x: O.x + dx * a + nx * b, y: O.y + dy * a + ny * b });
        const AB = p => { const rx = p.x - O.x, ry = p.y - O.y; return { a: rx * dx + ry * dy, b: rx * nx + ry * ny }; };
        const cam = f => W(V * f, 50 * Math.sin(Math.PI * f / (FRAMES - 1)));

        // Viruses: the stretch is emptied (before frame 0, so nobody sees it)
        // and two are set where scenes need them.
        const inStretch = p => { const q = AB(p); return q.a > A0 && q.a < A1 && Math.abs(q.b) < B; };
        const far = () => { for (;;) { const p = { x: (Math.random() * 2 - 1) * M * 0.9, y: (Math.random() * 2 - 1) * M * 0.9 }; if (!inStretch(p)) return p; } };
        for (const v of sim.viruses) if (inStretch(v)) Object.assign(v, far(), { vx: 0, vy: 0 });
        const vPop = sim.viruses[0], vHide = sim.viruses[1];
        Object.assign(vPop, W(730, -40), { vx: 0, vy: 0, damaged: false });
        Object.assign(vHide, W(1120, 150), { vx: 0, vy: 0, damaged: false });

        // The cast: bots that are a single cell (a split bot's pieces share an
        // id, and the parking below goes by id).
        const cells = new Map();
        for (const e of sim.enemies) cells.set(e.id, (cells.get(e.id) || 0) + 1);
        const pool = sim.enemies.filter(e => cells.get(e.id) === 1);
        if (pool.length < 11) throw new Error('not enough bots for the cast');
        const castIds = new Set();
        const who = [];                                  // [label, cell], for the framing log
        // Each actor wears its own colours (from the player palette, and none
        // of the viruses' green): left to the bots' random ones, a take came
        // out with half the cast the same teal, and they read as one pill.
        const cast = (r, label, [top, bot]) => {
            const c = pool.pop(); castIds.add(c.id); adopt(c); c.r = r; who.push([label, c]);
            Object.assign(c, { colorTop: top, colorBot: bot, skinUrl: null });
            return c;
        };
        // A cast pill moves only as the scene says: its own AI (botAI in
        // shared/sim.js) would steer it at any prey within 750 units — or
        // away from any hunter — every tick, eat a frame or two ahead of the
        // beat, and a bot over r 45 would even split by itself.
        const adopt = c => { tame(c); c.name = ''; c.botAI = function () {}; };

        const HERO_AT = { x: -M * 0.93, y: -M * 0.93 }, PARK = { x: M * 0.9, y: M * 0.9 };
        const tame = c => { c.botSkills = []; c.botNextSkillTime = 1e15; c.shouldSplit = false; c.immuneTime = 0; c.tpPhase = 0; c.sprintTime = 0; c.magnetTime = 0; };
        // Everyone not in the cast waits in a corner far from the route (same
        // as the tour). The cast is never sent there: in that pile the game's
        // own "bigger eats smaller" would take them before their cue.
        const hold = () => {
            Object.assign(hero, { x: HERO_AT.x, y: HERO_AT.y, vx: 0, vy: 0, boostX: 0, boostY: 0 });
            for (const e of sim.enemies) {
                if (castIds.has(e.id)) continue;
                e.x = PARK.x; e.y = PARK.y; e.vx = e.vy = 0; e.targetX = e.x; e.targetY = e.y; e.botSkills = []; e.botNextSkillTime = 1e15;
            }
            sim.botExpira.clear(); sim.botStreak.clear();
            if (sim._botRetirar) sim._botRetirar.clear();
            if (sim.ejectedMasses) sim.ejectedMasses.length = 0;
            if (sim.botRespawnQueue) sim.botRespawnQueue.length = 0;
            vPop.vx = vPop.vy = vHide.vx = vHide.vy = 0;
        };
        const put = (c, p) => { c.x = p.x; c.y = p.y; c.vx = c.vy = 0; c.boostX = c.boostY = 0; c.targetX = p.x; c.targetY = p.y; };
        const alive = c => sim.enemies.includes(c);
        const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        // Waiting actors roam a little loop around their spot instead of sitting.
        const sway = (p, f, s, amp) => ({ x: p.x + Math.sin(f / 13 + s) * amp, y: p.y + Math.sin(f / 17 + s * 2) * amp * 0.8 });
        const smooth = t => t * t * (3 - 2 * t);
        // The game's distance for eating (getEllipticalDist, shared/sim.js):
        // along a pill's long axis it counts half.
        const ell = (x, y) => { const k = 0.7071, rx = x * k - y * k, ry = (x * k + y * k) / 2; return Math.hypot(rx, ry); };
        // Where a hunter is at frame f, closing in on its prey from a fixed
        // bearing so the game takes the prey exactly on frame F: on F-1 it is
        // just outside the bite (0.6 r, the game's distance), on F just inside.
        const hunt = (f, f0, F, from, preyAt, r, ease = u => u) => {
            const p0 = preyAt(f0), ox = from.x - p0.x, oy = from.y - p0.y, d0 = Math.hypot(ox, oy) || 1;
            const ux = ox / d0, uy = oy / d0, bite = 0.6 * r / ell(ux, uy);
            const u = Math.min(1, Math.max(0, (f - f0) / (F - 1 - f0)));
            const d = f >= F ? bite * 0.8 : bite * 1.08 + (d0 - bite * 1.08) * (1 - ease(u));
            const p = preyAt(f);
            return { x: p.x + ux * d, y: p.y + uy * d };
        };
        // After a scene an actor eases from the speed it had into walking off
        // along `dir` (route units), out the edge of the frame.
        const leave = st => (c, f, dirA, dirB, speed) => {
            if (!st.v) { st.v = { x: st.last.x - st.prev.x, y: st.last.y - st.prev.y }; st.t = 0; }
            const t = Math.min(1, ++st.t / 20), to = W(0, 0), tip = W(dirA, dirB);
            const ex = (tip.x - to.x) * speed, ey = (tip.y - to.y) * speed;
            put(c, { x: c.x + st.v.x * (1 - t) + ex * t, y: c.y + st.v.y * (1 - t) + ey * t });
        };
        // An actor's last two positions, for the speed it leaves a scene with.
        const track = c => ({ prev: { x: c.x, y: c.y }, last: { x: c.x, y: c.y }, mark(e) { this.prev = this.last; this.last = { x: e.x, y: e.y }; } });

        const log = {};                                  // what happened, and on which frame
        const scenes = [];                               // placing the cast, before the frame's ticks
        const watch = [];                                // noting what happened, after them

        // ---- Bar 1: the sprint chase. Caught on beat 4 (bar 2's first).
        {
            const prey = cast(16, 'sprint prey', ['#66ccff', '#1a73e8']), hunter = cast(46, 'sprinter', ['#ffce3d', '#ff2a2a']);
            const preyAt = f => W(150 + 3.5 * f, -110 + 35 * Math.sin(f / 12));
            const from = W(-720, -190), F = beat(4), stH = track(hunter), off = leave(stH);
            scenes.push(f => {
                if (alive(prey)) { prey.r = 16; put(prey, preyAt(f)); }
                if (f <= F) { hunter.r = 46; put(hunter, hunt(f, 0, F, from, preyAt, 46)); }
                else { hunter.r = Math.min(hunter.r, 48); off(hunter, f, 0.35, -0.94, 6); }   // under r 49: past it, it would burst the next virus
                stH.mark(hunter);
                if (f === beat(1)) { window.__botSkill(hunter, 3); log.sprint = f; }
            });
            watch.push(f => { if (log.catch1 == null && !alive(prey)) log.catch1 = f; });
        }

        // ---- Bar 2: the split. Splits on beat 6, the half eats on beat 7.
        {
            const parent = cast(58, 'splitter', ['#ffffff', '#cc00ff']), prey = cast(16, 'split prey', ['#ff8c00', '#ffffff']);
            const preyAt = f => W(1000 - 2 * f, 210 + 25 * Math.sin(f / 10));
            const rest = W(520, 170), S = beat(6), F = beat(7);
            let half = null, from = null;
            const stP = track(parent), stH = track(parent), offP = leave(stP), offH = leave(stH);
            scenes.push(f => {
                if (alive(prey)) { prey.r = 16; put(prey, preyAt(f)); }
                if (f < S) { parent.r = 58; put(parent, sway(rest, f, 1, 22)); }
                if (f === S) {
                    const p = preyAt(S), before = new Set(sim.enemies);
                    sim.performSplit(parent, Math.atan2(p.y - parent.y, p.x - parent.x));
                    half = sim.enemies.find(e => !before.has(e));
                    adopt(half); who.push(['split half', half]);
                    from = { x: half.x, y: half.y };
                    log.split = f;
                }
                if (f >= S && half) {
                    if (f <= F) put(half, hunt(f, S, F, from, preyAt, half.r, u => 1 - (1 - u) * (1 - u)));
                    else offH(half, f, 0.3, 0.95, 4);
                    stH.mark(half);
                    if (f > S) offP(parent, f, -0.2, 0.98, 3);
                }
                stP.mark(parent);
            });
            watch.push(f => { if (log.catch2 == null && log.split != null && !alive(prey)) log.catch2 = f; });
        }

        // ---- Bar 3: into the virus. Bursts on beat 8 (bar 3's first).
        {
            const big = cast(62, 'burster', ['#ff8c00', '#1a73e8']);
            const rest = W(1000, -290), P = beat(8), vAt = () => ({ x: vPop.x, y: vPop.y });
            // The game bursts a pill this heavy when its centre comes within
            // 0.9 r of the virus's: hunt() with 1.5 r bites at 0.9 r.
            const center = W(730, -40);
            // Which way each piece flies (route units): fanned out ahead of the
            // camera, clear of the other scenes' actors.
            // (Downward, one crossed the split pair walking off that way; almost
            // straight ahead, one kept pace with the camera and hung beside the
            // shield scene until the end.)
            const dirs = [[-0.35, -0.94], [0.2, -0.98], [0.7, -0.71]];
            let pieces = null;
            scenes.push(f => {
                if (log.pop == null) {
                    big.r = 62;
                    put(big, f < 60 ? sway(rest, f, 2, 22) : hunt(f, 60, P, sway(rest, 60, 2, 22), vAt, 1.5 * 62));
                }
            });
            // Right after each tick: the burst happens inside a tick and throws
            // the pieces at random angles — they're put on their scripted
            // paths before anything is drawn.
            scenes.fix = (f, sub) => {
                if (log.pop == null) {
                    // The burst splits it: more than one cell with its id. (Not
                    // "the virus is gone": the game recycles that very object
                    // for the virus it spawns in its place.)
                    if (sim.enemies.filter(e => e.id === big.id).length < 2) return;
                    log.pop = f;
                    pieces = sim.enemies.filter(e => e.id === big.id);
                    pieces.forEach((c, i) => { adopt(c); if (c !== big) who.push(['piece ' + i, c]); });
                }
                if (!pieces) return;
                const t = f - log.pop + (sub + 1) / 2;
                // A burst that settles into a drift: ~160 units in the first
                // half second, then 4 a frame, out of shot within a bar or so
                // (at 2 they hung about the top of the frame for 5 s).
                const D = 160 * (1 - Math.exp(-t / 5)) + 4 * t;
                pieces.forEach((p, i) => {
                    if (!alive(p)) return;
                    const [a, b] = dirs[i % dirs.length], tip = W(a, b), o = W(0, 0);
                    put(p, { x: center.x + (tip.x - o.x) * D, y: center.y + (tip.y - o.y) * D });
                });
            };
        }

        // ---- Bar 4: the hideout. The pill dives into the virus on beat 12
        // (bar 4's first), the hunter reaches it on 13, circles it until 14 and
        // leaves; the pill peeks out on 15. isHiddenInVirus (shared/sim.js):
        // inside a virus you're smaller than, you can't be eaten. The hunter is
        // kept under the size that would burst the virus (mass 15000).
        {
            const prey = cast(18, 'hider', ['#ffffff', '#ff2a2a']), hunter = cast(44, 'seeker', ['#cc00ff', '#ffce3d']);
            const pRest = W(1420, 330), hRest = W(1560, 360), vC = () => ({ x: vHide.x, y: vHide.y });
            const G = 140, IN = beat(12), AT = beat(13), GO = beat(14), OUT = beat(15);
            const pStart = sway(pRest, G, 3, 22);   // where its roam has it when it bolts
            const path = f => lerp(pStart, vC(), smooth(Math.min(1, Math.max(0, (f - G) / (IN - G)))));
            // The hunter stops on the virus's rim (on top of it the virus would
            // cover it) and goes round a quarter of it.
            const rim = ang => { const c = vC(); return { x: c.x + Math.cos(ang) * 80, y: c.y + Math.sin(ang) * 80 }; };
            const a0 = Math.atan2(hRest.y - vHide.y, hRest.x - vHide.x);
            const stH = track(hunter), stP = track(prey), offH = leave(stH), offP = leave(stP);
            scenes.push(f => {
                hunter.r = 44; prey.r = 18;
                if (f < OUT) put(prey, f < G ? sway(pRest, f, 3, 22) : path(f));
                else offP(prey, f, -0.5, 0.87, 5);
                if (f < G) put(hunter, sway(hRest, f, 4, 22));
                else if (f < G + 14) put(hunter, lerp(sway(hRest, G, 4, 22), pStart, smooth((f - G) / 14)));
                else if (f < AT) put(hunter, lerp(path(f - 14), rim(a0), smooth(Math.max(0, (f - (AT - 12)) / 12))));
                else if (f < GO) put(hunter, rim(a0 + (Math.PI / 2) * smooth((f - AT) / (GO - AT))));
                else offH(hunter, f, 0.6, 0.8, 6);
                stH.mark(hunter); stP.mark(prey);
                if (f === IN) log.hide = f;
                if (f === OUT) log.peek = f;
            });
        }

        // ---- Bar 5: the shield. Up on beat 16 (bar 5's first), then three
        // gulps on 17, 18 and 19 — the last strong kick before the cut.
        {
            const big = cast(50, 'shield', ['#66ccff', '#ff2a2a']);
            const SNACK = [['#ffce3d', '#cc00ff'], ['#ffffff', '#ff8c00'], ['#ff2a2a', '#66ccff']];
            const snacks = [[1450, -20], [1560, -100], [1675, -30]].map(([a, b], i) => ({ c: cast(13, 'snack', SNACK[i]), at: W(a, b) }));
            const rest = W(1330, -60), UP = beat(16), EATS = [beat(17), beat(18), beat(19)];
            const snackAt = (i, f) => sway(snacks[i].at, f, 5 + i, 16);
            const stB = track(big), off = leave(stB);
            let from = null;
            scenes.push(f => {
                snacks.forEach((s, i) => { if (alive(s.c)) { s.c.r = 13; put(s.c, snackAt(i, f)); } });
                if (f < UP) { big.r = 50; put(big, sway(rest, f, 6, 20)); }
                else {
                    const i = EATS.findIndex(F => f <= F);
                    if (i >= 0) {
                        const f0 = i ? EATS[i - 1] : UP;
                        if (f === f0 || !from) from = { x: big.x, y: big.y };
                        put(big, hunt(f, f0, EATS[i], from, g => snackAt(i, g), big.r));
                        if (f === EATS[i]) from = null;
                    } else off(big, f, 1, 0.2, 4);
                }
                stB.mark(big);
                if (f === UP) { window.__botSkill(big, 6); log.shield = f; }
            });
            watch.push(f => { log.snacks = snacks.map(s => (alive(s.c) ? null : (s.done = s.done ?? f))); });
        }

        // A pellet the cast eats respawns at a random spot, and a virus the
        // burst takes too — in shot, that would be something out of nowhere.
        let view = null;
        const offView = (o, grid) => {
            for (let k = 0; view && k < 50 && Math.abs(o.x - view.x) < view.hw && Math.abs(o.y - view.y) < view.hh; k++) {
                if (grid) grid.remove(o);
                Object.assign(o, far());
                if (grid) grid.insert(o);
            }
        };
        sim.spawnFood = function () { Object.getPrototypeOf(this).spawnFood.call(this); offView(this.foods[this.foods.length - 1], this.foodGrid); };
        sim.spawnVirus = function () { Object.getPrototypeOf(this).spawnVirus.call(this); offView(this.viruses[this.viruses.length - 1]); };

        const p = window.me();
        p.cells.length = 0; p.cells.push(hero);
        hero.r = 10;
        window.__abs = zoomAt(0);
        window.getViewScale = () => window.__abs;
        floatingTexts.length = 0;

        const virusesBefore = sim.viruses.length;
        for (let i = 0; i < 10; i++) { scenes.forEach(s => s(0)); hold(); window.__tick(TICK); }
        // Largest jump of any cast pill between two frames (the split lunge
        // and the burst are the fast ones; a teleport would be hundreds).
        const lastAt = new Map();
        let maxStep = 0;
        const framing = {};
        window.__frame = 0;
        window.__status = { phase: 'recording', frame: 0 };
        for (let f = 0; f < FRAMES; f++) {
            const c = cam(f), z = zoomAt(f);
            view = { x: c.x, y: c.y, hw: 960 / z + 300, hh: 540 / z + 300 };
            scenes.forEach(s => s(f));
            for (let k = 0; k < 2; k++) { hold(); window.__tick(TICK); scenes.fix(f, k); }
            hold();
            watch.forEach(w => w(f));
            for (const e of sim.enemies) {
                if (!castIds.has(e.id)) continue;
                const l = lastAt.get(e);
                if (l) maxStep = Math.max(maxStep, Math.hypot(e.x - l.x, e.y - l.y));
                lastAt.set(e, { x: e.x, y: e.y });
            }
            window.__abs = z;
            window.__snapCam(c.x, c.y);
            window.__draw();
            // Where each actor is on screen (px, 1920x1080; null = eaten), every
            // 15 frames: the framing is checked from this, not by eye.
            if (f % 15 === 0) framing[f] = Object.fromEntries(who.map(([l, e]) => [l, alive(e)
                ? [Math.round((e.x - c.x) * z + 960), Math.round((e.y - c.y) * z + 540), Math.round(e.r)] : null]));
            await sendFrame('action/', f);
            window.__frame = f + 1;
            window.__status = { phase: 'recording', frame: f + 1, log };
        }
        view = null;
        delete sim.spawnFood; delete sim.spawnVirus;
        const meta = {
            // public/snd/action-music.wav is snd/music.mp3 from 37.175 s: the
            // render adds ~35 ms to the audio, and from there the kicks land
            // ~17 ms after their frames (measured on the rendered mp4).
            fps: 30, frames: FRAMES, music: { file: 'snd/action-music.wav', from: 37.175, bpm: 123.01 },
            beats: Array.from({ length: 21 }, (_, k) => beat(k)),
            // When each thing actually happened in the game (the video's
            // sounds go on these frames).
            events: log,
            maxStep: Math.round(maxStep * 10) / 10,
            virusesBefore, virusesAfter: sim.viruses.length,
            framing,
        };
        ws.send('action/events.json'); ws.send(JSON.stringify(meta, null, 2));
        await new Promise(r => setTimeout(r, 800));
        window.__status = { phase: 'done', ...meta };
    }
})().catch(e => { window.__status = { phase: 'error', msg: String(e) }; });
