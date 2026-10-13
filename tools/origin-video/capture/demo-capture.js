// Records the "Demo" video (src/Demo.tsx) from the real game, against a local
// server of its own (see demo-kit.js: test wallet, test friends, puppets).
//   DEMO_ROOT=<checkout to run the server from> node capture/demo-capture.js pc|mobile [scene]
// DEMO_ROOT should be a separate worktree: the server writes its json files
// there (balances, friends, arena pots...), and they are wiped first.
// Writes public/demo/<clip>.mp4 and public/demo/<clip>.json (click marks).
//
// PC (1280x720 at 1.5x = 1920x1080):
//   pc-arena1 / pc-arena1-end  ARENAS > 1V1 > FIND RIVALS > $4 > pay > VS > match ... VICTORY
//   pc-2v2 / pc-2v2-end        FRIENDS > @icefox > INVITE > ARENAS 2V2 > $5 > match ... VICTORY
//   pc-menus / pc-penta        PILLWARS CORE, STORE, QUESTS (3 marked) > CLASSIC rooms > $5 > match ... PENTAKILL
// Mobile (the app, 800x360 at 2x = 1600x720):
//   m-classic / m-classic-end  hub > CLASSIC $2 > match
//   m-arena / m-arena-end      ARENAS > 1V1 > $3 > VS > match ... VICTORY
//
// The rivals are puppets (test players driven from here). They stay out of the
// way until the filmed pill is clearly bigger, then come at it; when it has
// not grown enough by then, its mass is topped up with the admin /mass command
// while nothing is being recorded (the "MASS =" note it prints is hidden): the
// arena bots split after 30 s and the pilot is no match for them on its own.
const fs = require('fs');
const path = require('path');
const K = require('./demo-kit.js');
const BOT = require('./demo-bot.js');

const ROOT = process.env.DEMO_ROOT;
if (!ROOT || !fs.existsSync(path.join(ROOT, 'server', 'index.js'))) { console.error('DEMO_ROOT must point to a checkout of the repo'); process.exit(1); }
const WHICH = process.argv[2] || 'pc', ONLY = process.argv[3] || '';
const MOBILE = WHICH === 'mobile';
const PORT = 8099, CDP = 9361;
const VW = MOBILE ? 800 : 1280, VH = MOBILE ? 360 : 720, DPR = MOBILE ? 2 : 1.5;
const OUT = path.join(__dirname, '..', 'public', 'demo');
const TMP = path.join(require('os').tmpdir(), 'pw-demo-' + WHICH);
const wait = K.wait;

const me = K.keypair('me');
const PIC = 'https://pbs.twimg.com/profile_images/2098348662040449034/5lHWtABC_normal.png';
const ME = { user: { code: 'PILLDEV', wallet: me.address, walletPasted: false, x: { id: '1', username: 'pillwarsdotfun', name: 'PillWars', pic: PIC } }, score: null };
const TOK = { linked: true, token: K.socialToken({ id: 'PILLDEV', u: 'pillwarsdotfun', n: 'PillWars', p: PIC, w: me.address }), me: { id: 'PILLDEV', u: 'pillwarsdotfun', n: 'PillWars', p: PIC } };
// Puppets: name, colours.
const PUPS = [
    ['nyxie', '#ffffff', '#b86bff'], ['grumpy', '#2b2b2b', '#ff8a3d'], ['lunar', '#ffffff', '#9cc4ff'],
    ['kira', '#ffffff', '#ff4d6d'], ['vortex', '#14181a', '#2ee6d6'], ['mochi', '#ffffff', '#ff5fd2'],
    ['zed', '#2b2b2b', '#ffd23a'], ['bolt', '#ffffff', '#ccff00'], ['echo', '#e8e8e8', '#7c8cff'], ['pixelpete', '#ffffff', '#7cff6b'],
].map(([name, top, bot], i) => new K.Puppet({ port: PORT, name, kp: K.keypair('p' + i), top, bot }));

(async () => {
    // A clean server state every run.
    for (const f of ['warbalances.json', 'social.json', 'arena-pay.json', 'appquests.json', 'quests.json', 'daily.json', 'players.json', 'stats.json', 'roomrules.json', 'leaderboard-today.json', 'arena-pay-ledger.jsonl', 'transactions.log'])
        fs.rmSync(path.join(ROOT, 'server', f), { force: true });
    const balances = { [me.address]: 30000 };
    PUPS.forEach(p => { balances[p.kp.address] = 60000; });
    const srv = K.startServer({ root: ROOT, port: PORT, balances });
    let edge = null;
    const fin = code => { try { edge && edge.kill(); } catch (e) {} try { srv.kill(); } catch (e) {} PUPS.forEach(p => p.close()); process.exit(code); };
    process.on('SIGINT', () => fin(1));
    try {
        await K.waitHttp('http://localhost:' + PORT + '/game/index.html');
        fs.mkdirSync(OUT, { recursive: true });
        fs.rmSync(TMP, { recursive: true, force: true });   // fresh browser profile (no quests or wallet left from a previous run)
        edge = await K.startEdge({ tmp: TMP, cdpPort: CDP, w: VW, h: VH });
        const { js, cmd } = edge;
        await cmd('Page.enable'); await cmd('Runtime.enable');
        await cmd('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: MOBILE });
        await K.installStub(edge, me, ME, TOK);
        const rec = K.recorder(edge, { dir: TMP, w: Math.round(VW * DPR), h: Math.round(VH * DPR) });

        // ---------- page helpers ----------
        const click = async (x, y) => {
            rec.mark('click', { x: +(x / VW).toFixed(4), y: +(y / VH).toFixed(4) });
            await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
            for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        };
        // Centre of the first visible element `find` returns (a function body, in the page), scrolled into view.
        const centre = find => js(`(() => { const e = (() => { ${find} })(); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        const VIS = `const vis = e => e && e.offsetWidth > 0 && e.offsetHeight > 0 && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().bottom > 0; const tx = e => (e.innerText || '').trim().toUpperCase().replace(/\\s+/g, ' ');`;
        const byText = (t, sel = 'button,[data-a]') => `${VIS} const t = ${JSON.stringify(t)}; const all = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(vis); return all.find(e => tx(e) === t) || all.find(e => tx(e).startsWith(t)) || [...document.querySelectorAll('div,span')].filter(vis).find(e => e.children.length === 0 && tx(e) === t);`;
        async function tap(t, opt = {}) {
            for (let i = 0; i < (opt.tries || 20); i++) {
                const c = await centre(opt.find || byText(t, opt.sel));
                if (c) { await click(Math.round(c[0]), Math.round(c[1])); await wait(opt.after == null ? 900 : opt.after); return true; }
                await wait(250);
            }
            if (opt.optional) return false;
            throw new Error('not found: ' + t);
        }
        // Hub rows: the pointer goes there, but the row is clicked from the page (a mouse click on a row
        // while another panel is open only closes that panel).
        const hub = async a => {
            const sel = `[...document.querySelectorAll('#appHub [data-a="${a}"]')].find(e => e.offsetWidth > 0)`;
            const c = await centre(`return ${sel};`); if (!c) throw new Error('no hub row ' + a);
            rec.mark('click', { x: +(c[0] / VW).toFixed(4), y: +(c[1] / VH).toFixed(4) });
            await js(`${sel}.click(); 1`); await wait(900);
        };
        async function type(text) { for (const ch of text) { await cmd('Input.insertText', { text: ch }); await wait(110); } }
        const until = async (expr, ms = 60000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await js(expr)) return true; } catch (e) {} await wait(step); } return false; };
        const playing = `!!(typeof gameRunning !== 'undefined' && gameRunning && typeof me === 'function' && me() && me().alive && me().cells.length)`;
        const ended = `!!document.querySelector('#sqEnd.show')`;
        async function clip(name, body) {
            if (ONLY && !name.startsWith(ONLY)) { await body(); return; }
            await rec.start(name);
            // Each puppet that dies on camera leaves a 'kill' mark (for the sound in the edit).
            const seen = new Set(PUPS.filter(p => p.dead).map(p => p.name));
            const kp = setInterval(() => { for (const p of PUPS) if (p.dead && !seen.has(p.name)) { seen.add(p.name); rec.mark('kill', { name: p.name }); } }, 100);
            await wait(400);
            await body();
            clearInterval(kp);
            const r = await rec.stop(path.join(OUT, name + '.mp4'));
            fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(r, null, 1));
            if (process.env.STOP === name) { console.log('STOP after', name); fin(0); }
        }
        // Filmed player: centre and biggest cell.
        const myState = () => js(`JSON.stringify((() => { const m = typeof me === 'function' && me(); if (!m || !m.cells.length) return null; let x=0,y=0,k=0,big=0,mass=0; for (const c of m.cells) { const w=c.r*c.r; x+=c.x*w; y+=c.y*w; k+=w; big=Math.max(big,c.r); mass+=c.mass||0; } return { x:x/k, y:y/k, big, mass, n: m.cells.length, id: sim && sim.myId }; })())`).then(s => JSON.parse(s || 'null'));
        // Puppets follow the filmed pill around (only the ones told to 'go').
        let feed = null;
        const startFeed = list => { clearInterval(feed); feed = setInterval(async () => { try { const s = await myState(); if (s) list.forEach(p => { p.goal = { x: s.x, y: s.y, r: s.big }; }); } catch (e) {} }, 150); };
        // Admin /mass on the filmed pill, in steps, its "MASS =" note hidden.
        async function grow(target) {
            await js(`(() => { if (!window.__sftHid) { window.__sftHid = true; const f = spawnFloatingText; spawnFloatingText = function (t) { if (/^MASS =/.test(String(t))) return; return f.apply(this, arguments); }; } })()`);
            for (let i = 0; i < 6; i++) {
                const s = await myState(); if (!s || !s.id) return;
                if (s.mass >= target) return;
                await K.admin(PORT, { cmd: 'power', playerId: s.id, name: 'mass', args: [String(Math.round(Math.min(target, s.mass * 1.7)))] });
                await wait(500);
            }
        }
        // Off camera: the puppets keep away and the pill is made clearly bigger than them.
        async function prepKill(list, k = 1.8, mode = 'near') {
            list.forEach(p => { p.mode = mode; });
            await wait(1500);
            for (let i = 0; i < 30; i++) {
                if (await js(ended)) return false;
                const s = await myState(); if (!s) return false;
                const r = Math.max(...list.filter(p => p.pos && !p.dead).map(p => p.pos.r), 1);
                console.log('  prep', i, 'me', Math.round(s.big), 'cells', s.n, 'them', Math.round(r), list.map(p => p.name + ':' + (p.id || '-') + (p.pos ? ':P' + Math.round(p.pos.r) : '') + (p.dead ? ':D' : '') + ':' + (p.msgs || 0) + (p.log.length ? ':' + p.log.join('|') : '')).join(' '));
                if (s.big > r * k) { if (s.n <= 4) return true; await wait(1000); continue; }   // big enough: just wait for the pieces to merge
                await grow(s.mass * Math.min(3, Math.max(1.3, (k * r / s.big) ** 2 * 1.15)));
                await wait(1000);
            }
            return true;
        }
        // On camera: the pilot goes for them and they come at it, one after the other.
        async function charge(list, gap = 1800) {
            const rest = PUPS.filter(p => !list.includes(p)).map(p => p.name);   // the others wait their turn
            await js(`window.__bot.cfg.spare = ${JSON.stringify(rest)}; window.__bot.cfg.hunt = ${JSON.stringify(list.map(p => p.name))}; 1`);
            for (const p of list) { if (p.dead) continue; p.mode = 'go'; const t0 = Date.now(); while (!p.dead && Date.now() - t0 < 12000) await wait(150); await wait(gap); }
        }
        const open = async () => {
            await cmd('Page.navigate', { url: 'http://localhost:' + PORT + '/game/index.html?server=ws://localhost:' + PORT + (MOBILE ? '&app=1' : '') });
            await until(`typeof startGame === 'function' && document.readyState === 'complete'`, 30000);
            await wait(3500);
            // title screen -> hub
            for (let i = 0; i < 6 && !(await js(`!!document.querySelector('#appHub [data-a="arenas"]') && document.querySelector('#appHub [data-a="arenas"]').offsetWidth > 0`)); i++) { await click(VW / 2, VH * 0.7); await wait(2500); }
            await wait(1500);
        };
        const pilot = async spare => { await js(BOT); await js(`window.__bot.cfg.spare = ${JSON.stringify(spare)}; 1`); };
        const backToHub = async () => { await tap('MENU', { optional: true, tries: 12 }); await wait(2500); };

        // FROM=<part> starts at that part (arena1, 2v2, menus / classic, arena) and skips the ones before it.
        const PARTS = MOBILE ? ['classic', 'arena'] : ['arena1', '2v2', 'menus'];
        const runs = part => !process.env.FROM || PARTS.indexOf(part) >= PARTS.indexOf(process.env.FROM);
        if (!MOBILE) {
            await open();
          if (runs('arena1')) {
            // ---- 1v1 against nyxie, $4 ----
            const [nyx] = PUPS;
            await K.arenaGroup([nyx], 4);
            await wait(2000);
            await clip('pc-arena1', async () => {
                await wait(1500);
                await hub('arenas'); await wait(400);
                await tap('1V1', { find: `${VIS} return [...document.querySelectorAll('div,span,b')].filter(vis).find(e => e.children.length === 0 && tx(e) === '1V1');` });
                await tap('FIND RIVALS', { after: 1800 });
                await tap('$4 FIGHT', { find: `${VIS} const row = [...document.querySelectorAll('*')].filter(vis).find(e => e.children.length === 0 && /^\\$4 · /.test(tx(e))); let p = row; for (let i = 0; i < 5 && p; i++) { const b = p.querySelector && [...p.querySelectorAll('button')].find(b => /FIGHT/.test(tx(b))); if (b) return b; p = p.parentElement; } return null;`, after: 1600 });
                await tap('PAY & READY', { after: 1100 });
                await tap('CONFIRM', { after: 300 });
                await until(playing, 40000);
                rec.mark('go');
                await pilot(['nyxie']);
                nyx.mode = 'wander';
                await wait(9000);
            });
            startFeed([nyx]);
            await prepKill([nyx]);
            await clip('pc-arena1-end', async () => {
                await wait(800);
                await charge([nyx]);
                await until(ended, 60000);
                rec.mark('end');
                await wait(3500);
                await tap('CLAIM', { optional: true, tries: 4, after: 2500 });
            });
            nyx.close();
            await backToHub();
          }
          if (runs('2v2')) {

            // ---- 2v2 with @icefox against grumpy + lunar, $5 ----
            const duo = [PUPS[1], PUPS[2]];
            await K.arenaGroup(duo, 5);
            await wait(2000);
            await clip('pc-2v2', async () => {
                await wait(1200);
                await hub('friends'); await wait(500);
                await tap('ADD FIELD', { find: `return [...document.querySelectorAll('input')].find(e => e.offsetWidth > 0 && /ADD/i.test(e.placeholder || ''));`, after: 300 });
                await type('@icefox'); await wait(500);
                await tap('ADD', { after: 1800 });
                await tap('INVITE', { after: 2600 });
                await hub('arenas'); await wait(400);
                await tap('2V2', { find: `${VIS} return [...document.querySelectorAll('div,span,b')].filter(vis).find(e => e.children.length === 0 && tx(e) === '2V2');` });
                await tap('FIND RIVALS', { after: 1800 });
                await tap('$5 FIGHT', { find: `${VIS} const row = [...document.querySelectorAll('*')].filter(vis).find(e => e.children.length === 0 && /^\\$5 · /.test(tx(e))); let p = row; for (let i = 0; i < 5 && p; i++) { const b = p.querySelector && [...p.querySelectorAll('button')].find(b => /FIGHT/.test(tx(b))); if (b) return b; p = p.parentElement; } return null;`, after: 1600 });
                await tap('PAY & READY', { after: 1100 });
                await tap('CONFIRM', { after: 300 });
                await until(playing, 60000);
                rec.mark('go');
                await pilot(['grumpy', 'lunar']);
                duo.forEach(p => { p.mode = 'wander'; });
                await wait(9000);
            });
            startFeed(duo);
            await prepKill(duo);
            await clip('pc-2v2-end', async () => {
                await wait(800);
                await charge(duo, 2500);
                await until(ended, 60000);
                rec.mark('end');
                await wait(4500);
            });
            duo.forEach(p => p.close());
            await backToHub();
          }

            // ---- menus, then CLASSIC $5 and a PENTAKILL ----
            await K.admin(PORT, { cmd: 'rules', room: 'classic_5$', rules: { botsEnabled: false, botCount: 0, targetPop: 0 } });
            const five = PUPS.slice(3, 8);
            for (const p of five.slice(0, 3)) { p.join({ t: 'join', mode: 'classic', room: '5$', name: p.name, colorTop: p.top, colorBot: p.bot, bin: 0, aspect: 1.78 }); await wait(500); }
            await wait(2500);
            await clip('pc-menus', async () => {
                await wait(1000);
                await hub('core'); await wait(3800);
                await hub('store'); await wait(3000);
                await hub('quests'); await wait(1200);
                for (let i = 0; i < 3; i++) await tap('QUEST ' + i, { find: `return [...document.querySelectorAll('.qc')].filter(e => e.offsetWidth > 0 && !e.classList.contains('qpin') && !e.classList.contains('done'))[0];`, after: 750 });
                await wait(1000);
                await hub('rooms'); await wait(1300);
                await tap('$5', { find: `${VIS} return [...document.querySelectorAll('div,span,b')].filter(vis).find(e => e.children.length === 0 && tx(e) === '$5');`, after: 1300 });
                await tap('PLAY', { find: `return document.querySelector('#appHub .ah-play');`, after: 1500 });
                await tap('CONTINUE', { after: 800 });
                for (let i = 0; i < 40 && !(await js(playing)); i++) { await tap('CONFIRM', { optional: true, tries: 1, after: 300 }); await wait(400); }
                await until(playing, 60000);
                rec.mark('go');
                await pilot(five.map(p => p.name));
                await js(`window.__bot.cfg.eatK = 0.5; 1`);   // bots too count for the PENTAKILL: it leaves them alone
                five.slice(0, 3).forEach(p => { p.mode = 'wander'; });
                for (const p of five.slice(3)) { p.join({ t: 'join', mode: 'classic', room: '5$', name: p.name, colorTop: p.top, colorBot: p.bot, bin: 0, aspect: 1.78 }); p.mode = 'wander'; }
                startFeed(five);
                await wait(4500);
            });
            // classic starts small among bigger bots: the pill is grown right away, off camera
            await prepKill(five, 1.7, 'wander');
            await charge(five.slice(0, 3), 600);
            await until(`(typeof myKillStreak === 'function' ? myKillStreak() : 0) >= 3 || !me() || !me().cells.length`, 45000);
            console.log('  streak', await js(`typeof myKillStreak === 'function' ? myKillStreak() : -1`));
            await js(`window.__bot.cfg.hunt = []; window.__bot.cfg.spare = ${JSON.stringify(five.map(p => p.name))}; 1`);
            await prepKill(five.slice(3), 1.7, 'wander');
            await clip('pc-penta', async () => {
                await wait(1000);
                await charge(five.slice(3), 300);
                await until(`!!document.querySelector('#sqEnd.show')`, 60000);
                rec.mark('end');
                await wait(5000);
            });
            five.forEach(p => p.close());
        } else {
            await open();
          if (runs('classic')) {
            // ---- the app: CLASSIC $2 ----
            await K.admin(PORT, { cmd: 'rules', room: 'classic_2$', rules: { botsEnabled: false, botCount: 0, targetPop: 0 } });
            const cl = PUPS.slice(0, 4);
            for (const p of cl.slice(0, 3)) { p.join({ t: 'join', mode: 'classic', room: '2$', name: p.name, colorTop: p.top, colorBot: p.bot, bin: 0, aspect: 2.2 }); await wait(500); }
            await wait(2500);
            await clip('m-classic', async () => {
                await wait(2500);
                await hub('rooms'); await wait(1300);
                await tap('$2', { find: `${VIS} return [...document.querySelectorAll('div,span,b')].filter(vis).find(e => e.children.length === 0 && tx(e) === '$2');`, after: 1300 });
                await tap('PLAY', { find: `return document.querySelector('#appHub .ah-play');`, after: 1500 });
                await tap('CONTINUE', { after: 800, optional: true });
                for (let i = 0; i < 40 && !(await js(playing)); i++) { await tap('CONFIRM', { optional: true, tries: 1, after: 300 }); await wait(400); }
                await until(playing, 60000);
                rec.mark('go');
                await pilot(cl.map(p => p.name));
                cl.slice(0, 3).forEach(p => { p.mode = 'wander'; });
                await wait(10000);
            });
            startFeed(cl);
            await prepKill(cl.slice(0, 2), 1.6, 'wander');
            await clip('m-classic-end', async () => {
                await wait(600);
                await charge(cl.slice(0, 2), 2500);
                await wait(5000);
            });
            await tap('EXIT', { find: `return document.getElementById('exitGameBtn');`, optional: true, tries: 4 });
            await wait(1500);
            await tap('LEAVE', { optional: true, tries: 6 });
            await wait(2500);
            cl.forEach(p => p.close());
            await open();
          }
            // ---- the app: ARENAS 1v1, $3 ----
            const [riv] = PUPS.slice(4, 5);
            await K.arenaGroup([riv], 4);
            await wait(2000);
            await clip('m-arena', async () => {
                await wait(1200);
                await hub('arenas'); await wait(500);
                await tap('1V1', { find: `${VIS} return [...document.querySelectorAll('div,span,b')].filter(vis).find(e => e.children.length === 0 && tx(e) === '1V1');` });
                await tap('FIND RIVALS', { after: 1800 });
                await tap('$4 FIGHT', { find: `${VIS} const row = [...document.querySelectorAll('*')].filter(vis).find(e => e.children.length === 0 && /^\\$4 · /.test(tx(e))); let p = row; for (let i = 0; i < 5 && p; i++) { const b = p.querySelector && [...p.querySelectorAll('button')].find(b => /FIGHT/.test(tx(b))); if (b) return b; p = p.parentElement; } return null;`, after: 1600 });
                await tap('PAY & READY', { after: 1100 });
                await tap('CONFIRM', { after: 300 });
                await until(playing, 40000);
                rec.mark('go');
                await pilot([riv.name]);
                riv.mode = 'wander';
                await wait(12000);
            });
            startFeed([riv]);
            await prepKill([riv]);
            await clip('m-arena-end', async () => {
                await wait(800);
                await charge([riv]);
                await until(ended, 60000);
                rec.mark('end');
                await wait(4500);
            });
            riv.close();
        }
        clearInterval(feed);
        console.log('done');
        fin(0);
    } catch (e) { console.error(e); fin(1); }
})();
