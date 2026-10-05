/*
 * ARENAS por equipos (1v1 / 2v2 / 3v3) — cliente.
 *
 * Lobby de grupos estilo LoL: creas grupo o entras con un codigo, todos marcais LISTO,
 * el lider elige 1v1/2v2/3v3 y da a JUGAR. Mientras llega rival se juega una sala de
 * practica juntos contra bots; al haber rival el servidor manda un ticket y se pasa a
 * la partida real. Protocolo y reglas: server/squad.js.
 *
 * Una sola UI para PC y app: render() pinta dentro de un contenedor. En la app va dentro
 * del panel ARENAS del hub (app-hub.js); en PC, en un cartel propio (#sqPc) que abre el
 * popup de PLAY. El tamano se escala con `em`, asi que cada sitio fija su font-size.
 */
(function () {
    'use strict';
    const SIZES = [1, 2, 3];
    const S = { ws: null, conn: 'idle', party: null, me: null, err: '', box: null, pcRoot: null, roster: null, ticketTimer: null, practiceTimer: null, enterBusy: false };
    const EN_APP = document.documentElement.classList.contains('pw-app');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const snd = n => { try { SoundManager.play(n); } catch (e) {} };
    const ERRS = {
        no_party: 'That party code does not exist.', party_full: 'That party is full.', party_busy: 'That party is already searching for a match.',
        need_full_party: 'You need a full party: every slot taken.', not_ready: 'Everyone must be READY first.', not_leader: 'Only the party leader can do that.',
        size_too_small: 'There are more players than slots in that size.', already_in_party: 'You are already in a party.',
    };

    const css = `
.sq{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.8em;padding:.2em .3em}
.sq *{box-sizing:border-box}
#ahArBody .sq-t.home{display:none}
.sq-t{font-size:.95em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000;letter-spacing:.06em}
.sq-p{font-size:.42em;line-height:1.9;color:#cfd8d3;max-width:36em}
.sq-row{display:flex;gap:.6em;align-items:stretch;justify-content:center;flex-wrap:wrap;width:100%}
.sq-b{font-family:'Russo One',sans-serif;font-size:.78em;letter-spacing:.1em;padding:.55em 1.1em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer;min-width:5.6em}
.sq-b.on{background:var(--ac,#00ff88);border-color:var(--ac,#00ff88);color:#04150c}
.sq-b.gold{background:#ffd23a;border-color:#ffd23a;color:#241a00}
.sq-b:disabled{opacity:.35;cursor:default}
.sq-b:active:not(:disabled){transform:translateY(.1em)}
.sq-sz{display:flex;gap:.5em}
.sq-sz .sq-b{font-family:'Press Start 2P',monospace;font-size:.62em;padding:.7em .9em;min-width:0}
.sq-in{font-family:'Press Start 2P',monospace;font-size:.62em;text-align:center;text-transform:uppercase;color:#fff;background:#050c09;border:.2em solid #2c3630;padding:.8em .5em;outline:none;width:11em;letter-spacing:.2em}
.sq-in:focus{border-color:var(--ac,#00ff88)}
.sq-in.nm{width:13em;letter-spacing:.05em}
.sq-lab{font-size:.36em;color:#7d8a82;letter-spacing:.12em;margin-bottom:-.3em}
.sq-code{font-size:1.5em;letter-spacing:.3em;color:#ffd23a;text-shadow:.1em .1em 0 #000;padding:.2em .2em .1em .5em;border:.12em dashed #5a4a10;background:rgba(0,0,0,.35)}
.sq-slots{display:flex;gap:.55em;width:100%;justify-content:center;flex-wrap:wrap}
.sq-slot{position:relative;width:9.5em;min-height:5.2em;padding:.7em .4em;background:rgba(0,0,0,.32);border:.07em solid rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.55em}
.sq-slot.me{border:.14em solid var(--ac,#00ff88)}
.sq-slot.empty{border-style:dashed;color:#56635b}
.sq-slot .n{font-size:.5em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-slot .s{font-size:.36em;letter-spacing:.1em;color:#7d8a82}
.sq-slot .s.rd{color:#00ff66}
.sq-slot .s.ld{color:#ffd23a}
.sq-slot .k{position:absolute;right:.2em;top:.1em;font-size:.4em;color:#e5302f;cursor:pointer;padding:.4em}
.sq-err{font-size:.4em;color:#ff6a5a;min-height:1.4em;line-height:1.6}
.sq-q{font-size:.55em;color:#9bbfff;letter-spacing:.1em;animation:sqB 1s steps(2) infinite}
@keyframes sqB{50%{opacity:.35}}
.sq-note{font-size:.38em;line-height:1.9;color:#8aa096;max-width:36em}
#sqPc{position:fixed;inset:0;z-index:120;background:rgba(3,6,4,.88);display:none;align-items:center;justify-content:center}
#sqPc.open{display:flex}
#sqPc .sq-box{position:relative;width:min(46em,94vw);font-size:16px;padding:1.4em 1.4em 1.1em;background:#0b120e;border:.2em solid var(--ac,#00ff88);box-shadow:0 0 0 .2em #000,.4em .4em 0 .2em rgba(0,0,0,.6),0 0 2em rgba(0,255,136,.25)}
#sqPc .sq-x{position:absolute;right:.5em;top:.4em;font-family:'Russo One',sans-serif;font-size:.7em;letter-spacing:.1em;padding:.4em .8em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer}
#sqFound,#sqEnd{position:fixed;inset:0;z-index:300;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(3,6,4,.82);font-family:'Press Start 2P',monospace;color:#fff;text-align:center}
#sqFound.show,#sqEnd.show{display:flex}
#sqFound .a{font-size:22px;color:#ffd23a;text-shadow:3px 3px 0 #000,0 0 18px #ffd23a}
#sqFound .b{font-size:12px;color:#9bbfff}
#sqEnd .a{font-size:28px;text-shadow:3px 3px 0 #000}
#sqEnd .a.w{color:#00ff66}#sqEnd .a.l{color:#ff5a4e}#sqEnd .a.d{color:#ffd23a}
#sqEnd .b{font-size:11px;color:#cfd8d3;line-height:1.9}
#sqEnd button{font-family:'Russo One',sans-serif;font-size:14px;letter-spacing:2px;padding:10px 26px;border:3px solid #000;background:#00ff88;color:#04150c;cursor:pointer;margin-top:8px}
#sqHud{position:fixed;left:8px;top:64px;z-index:56;display:none;font-family:'Press Start 2P',monospace;font-size:8px;line-height:1.7;background:rgba(6,10,8,.78);border:2px solid #2c3630;padding:6px 8px;pointer-events:none;text-shadow:1px 1px 0 #000}
#sqHud.show{display:block}
#sqHud .a{color:#00ff88}#sqHud .b{color:#ff6a5a}#sqHud .h{color:#9bbfff;margin-bottom:2px}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    // ---------------- conexion del lobby ----------------
    async function hostUrl() {
        const qs = new URLSearchParams(location.search).get('server');
        let saved = null; try { saved = localStorage.getItem('pw_server'); } catch (e) {}
        const url = qs || saved || (location.protocol === 'https:' ? 'wss://' + location.host : 'ws://localhost:8080');
        try {
            const u = new URL(url), isWss = url.startsWith('wss://');
            const mj = await (await fetch((isWss ? 'https://' : 'http://') + u.host + '/match?mode=squad&price=Free', { cache: 'no-store' })).json();
            if (mj && mj.ok) {
                if (isWss && mj.path) return 'wss://' + u.host + mj.path + '/';
                if (!isWss && mj.port && String(mj.port) !== (u.port || '80')) return 'ws://' + u.hostname + ':' + mj.port;
            }
        } catch (e) {}
        return url;
    }
    function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(Object.assign({ t: 'sq' }, o))); }
    function myName() {
        const el = document.getElementById('playerNameInput');
        let n = (el && el.value || '').trim();
        if (!n) { try { n = localStorage.getItem('pw_app_name') || localStorage.getItem('pw_sq_name') || ''; } catch (e) {} }
        return (n || '').slice(0, 16);
    }
    function connect(then) {
        if (S.ws && S.ws.readyState === 1) { then && then(); return; }
        if (then) S.after = then;   // si ya se esta conectando, se ejecuta al abrir
        if (S.conn === 'connecting') return;
        S.conn = 'connecting'; S.err = ''; render();
        hostUrl().then(url => {
            const ws = new WebSocket(url);
            S.ws = ws;
            ws.onopen = () => { S.conn = 'open'; render(); const f = S.after; S.after = null; f && f(); };
            ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
            ws.onclose = () => {
                if (S.ws !== ws) return;
                S.ws = null; S.conn = 'idle';
                if (S.party) { S.party = null; S.err = 'Connection to the party was lost.'; }
                render();
            };
            ws.onerror = () => { if (S.conn === 'connecting') { S.conn = 'idle'; S.after = null; S.err = "Couldn't reach the server. Try again."; render(); } };
        });
    }
    function onMsg(m) {
        if (m.t === 'sqParty') { S.party = m; S.me = m.me; S.err = ''; render(); if (m.state === 'queued') hidePc(); }
        else if (m.t === 'sqGone') { S.party = null; S.err = m.reason === 'kicked' ? 'You were removed from the party.' : ''; render(); }
        else if (m.t === 'sqErr') { S.err = ERRS[m.reason] || 'Something went wrong.'; render(); }
        else if (m.t === 'sqTicket') onTicket(m);
    }

    // ---------------- entrada a sala ----------------
    function enter(ticket, kind) {
        if (S.enterBusy) return;
        S.enterBusy = true; setTimeout(() => { S.enterBusy = false; }, 2500);
        hidePc(); closeHubPanel();
        if (typeof window.pwSquadEnter === 'function') window.pwSquadEnter(ticket, kind);
    }
    function onTicket(m) {
        if (m.kind === 'practice') {
            // Esperando rival: se juega junto contra bots. Si ya hay una partida de equipo en curso no se pisa.
            if (window.pwSquadActive && window.pwSquadActive() === 'match') return;
            enter(m.ticket, 'practice');
            return;
        }
        // Rival encontrado: aviso con cuenta atras y entrada automatica.
        let n = 5;
        const el = foundEl();
        const paint = () => { el.querySelector('.b').textContent = 'ENTERING IN ' + n + '…'; };
        el.querySelector('.a').textContent = 'RIVAL FOUND!';
        el.querySelector('.c').textContent = m.size + 'V' + m.size + ' · TEAM ' + m.team;
        el.classList.add('show'); paint(); snd('alert');
        clearInterval(S.ticketTimer);
        S.ticketTimer = setInterval(() => {
            n--;
            if (n > 0) { paint(); return; }
            clearInterval(S.ticketTimer); S.ticketTimer = null;
            el.classList.remove('show');
            S.enterBusy = false;
            enter(m.ticket, 'match');
        }, 1000);
    }
    function foundEl() {
        let el = document.getElementById('sqFound');
        if (!el) { el = document.createElement('div'); el.id = 'sqFound'; el.innerHTML = '<div class="a"></div><div class="c b"></div><div class="b"></div>'; document.body.appendChild(el); }
        return el;
    }

    // ---------------- dentro de la partida ----------------
    function hud() {
        let el = document.getElementById('sqHud');
        if (!el) { el = document.createElement('div'); el.id = 'sqHud'; document.body.appendChild(el); }
        return el;
    }
    function onRoster(m) {
        S.roster = m;
        S.rel = new Map();
        const mine = m.me === 'A' ? 'A' : 'B', other = mine === 'A' ? 'B' : 'A';
        for (const p of m.teams[mine]) S.rel.set(p.id, 'ally');
        for (const p of m.teams[other]) S.rel.set(p.id, 'foe');
        const el = hud();
        const row = (cls, list) => list.map(p => '<div class="' + cls + '">' + esc(p.name || 'PLAYER') + '</div>').join('');
        el.innerHTML = '<div class="h">' + (m.practice ? 'PRACTICE · ' : '') + m.size + 'V' + m.size + '</div>' +
            row('a', m.teams[mine]) + (m.practice ? '' : '<div class="h" style="margin-top:3px">VS</div>' + row('b', m.teams[other]));
        el.classList.add('show');
    }
    function onEnd(m) {
        hud().classList.remove('show');
        S.rel = null;
        if (m.practice) {
            // La sala de practica acabo: si el grupo sigue en cola se le pide otra.
            clearTimeout(S.practiceTimer);
            S.practiceTimer = setTimeout(() => { if (S.party && S.party.state === 'queued') send({ a: 'practice' }); }, 6000);
            return;
        }
        let el = document.getElementById('sqEnd');
        if (!el) { el = document.createElement('div'); el.id = 'sqEnd'; el.innerHTML = '<div class="a"></div><div class="b"></div><button>CONTINUE</button>'; document.body.appendChild(el); el.querySelector('button').onclick = () => el.classList.remove('show'); }
        const mine = S.roster ? S.roster.me : 'A';
        const a = el.querySelector('.a');
        if (!m.winner) { a.textContent = 'DRAW'; a.className = 'a d'; }
        else if (m.winner === mine) { a.textContent = 'VICTORY!'; a.className = 'a w'; }
        else { a.textContent = 'DEFEAT'; a.className = 'a l'; }
        const my = mine === 'A' ? m.a : m.b, their = mine === 'A' ? m.b : m.a;
        el.querySelector('.b').innerHTML = 'YOUR TEAM ' + my + '<br>RIVALS ' + their;
        el.classList.add('show'); snd(m.winner === mine ? 'select' : 'alert');
    }

    // ---------------- UI ----------------
    function slotsHtml(p) {
        const mem = p.members, out = [];
        for (let i = 0; i < p.size; i++) {
            const m = mem[i];
            if (!m) { out.push('<div class="sq-slot empty"><div class="n">EMPTY</div><div class="s">WAITING…</div></div>'); continue; }
            const imLeader = p.leader === S.me;
            const st = m.leader ? '<div class="s ld">LEADER</div>' : (m.ready ? '<div class="s rd">READY</div>' : '<div class="s">NOT READY</div>');
            out.push('<div class="sq-slot' + (m.id === S.me ? ' me' : '') + '">' + (imLeader && m.id !== S.me && p.state === 'idle' ? '<span class="k" data-k="' + m.id + '">X</span>' : '') +
                '<div class="n">' + esc(m.name) + '</div>' + st + '</div>');
        }
        return out.join('');
    }
    function html() {
        const p = S.party;
        const err = '<div class="sq-err">' + esc(S.err || '') + '</div>';
        if (!p) {
            const nm = myName();
            return '<div class="sq"><div class="sq-t home">ARENAS</div>' +
                '<div class="sq-p">Team battles in small arenas: 1V1, 2V2 or 3V3 plus bots up to 30 players. Make a party, share the code, and the last team standing wins. Free for now.</div>' +
                '<div class="sq-lab">YOUR NAME</div><input class="sq-in nm" id="sqName" maxlength="16" placeholder="PLAYER" value="' + esc(nm) + '">' +
                '<div class="sq-lab">CREATE A PARTY</div><div class="sq-row">' + SIZES.map(n => '<button class="sq-b on" data-c="' + n + '">' + n + 'V' + n + '</button>').join('') + '</div>' +
                '<div class="sq-lab">OR JOIN WITH A CODE</div><div class="sq-row"><input class="sq-in" id="sqCode" maxlength="5" placeholder="CODE"><button class="sq-b" id="sqJoin">JOIN</button></div>' +
                err + (S.conn === 'connecting' ? '<div class="sq-q">CONNECTING…</div>' : '') + '</div>';
        }
        const imLeader = p.leader === S.me;
        const meM = p.members.find(m => m.id === S.me) || {};
        const full = p.members.length === p.size, allReady = p.members.every(m => m.leader || m.ready);
        let head = '<div class="sq-t">' + p.size + 'V' + p.size + ' PARTY</div>';
        let ctl = '';
        if (p.state === 'queued') {
            const secs = Math.max(0, Math.round((Date.now() - (p.queuedAt || Date.now())) / 1000));
            head += '<div class="sq-q" id="sqQ">SEARCHING FOR A RIVAL… ' + secs + 's</div>' +
                '<div class="sq-note">You are playing a practice room together against bots while we find a rival party. When one shows up you jump straight into the match.</div>';
            ctl = imLeader ? '<button class="sq-b" data-a="cancel">CANCEL SEARCH</button>' : '';
        } else if (p.state === 'match') {
            head += '<div class="sq-q">MATCH IN PROGRESS</div>';
        } else {
            ctl = (imLeader ? SIZES.map(n => '<button class="sq-b' + (n === p.size ? ' on' : '') + '" data-s="' + n + '">' + n + 'V' + n + '</button>').join('') +
                '<button class="sq-b gold" data-a="play"' + (full && allReady ? '' : ' disabled') + '>PLAY</button>' :
                '<button class="sq-b' + (meM.ready ? '' : ' on') + '" data-a="ready">' + (meM.ready ? 'NOT READY' : 'READY') + '</button>');
        }
        return '<div class="sq">' + head +
            '<div class="sq-lab">PARTY CODE · SHARE IT WITH YOUR TEAMMATES</div><div class="sq-row" style="align-items:center"><div class="sq-code">' + esc(p.code) + '</div><button class="sq-b" data-a="copy">COPY LINK</button></div>' +
            '<div class="sq-slots">' + slotsHtml(p) + '</div>' +
            (p.state === 'idle' ? '<div class="sq-note">' + (full ? (allReady ? 'Everyone is ready.' : 'Waiting for everyone to be READY.') : 'Waiting for ' + (p.size - p.members.length) + ' more player(s).') + '</div>' : '') +
            '<div class="sq-row">' + ctl + '<button class="sq-b" data-a="leave">LEAVE</button></div>' + err + '</div>';
    }
    function render() {
        if (!S.box) return;
        S.box.innerHTML = html();
        wire();
        try { if (window.PWSquadHooks && PWSquadHooks.afterRender) PWSquadHooks.afterRender(); } catch (e) {}
    }
    function wire() {
        const b = S.box;
        const nameOf = () => { const el = b.querySelector('#sqName'); const v = el ? el.value.trim() : myName(); try { localStorage.setItem('pw_sq_name', v); } catch (e) {} return v || 'PLAYER'; };
        b.querySelectorAll('[data-c]').forEach(x => x.onclick = () => { snd('simpleselect'); const n = +x.dataset.c, nm = nameOf(); connect(() => send({ a: 'create', name: nm, size: n })); });
        const j = b.querySelector('#sqJoin');
        if (j) j.onclick = () => { snd('simpleselect'); const c = b.querySelector('#sqCode').value.trim(), nm = nameOf(); if (!c) { S.err = 'Type the party code first.'; render(); return; } connect(() => send({ a: 'join', code: c, name: nm })); };
        b.querySelectorAll('[data-s]').forEach(x => x.onclick = () => { snd('simpleselect'); send({ a: 'size', n: +x.dataset.s }); });
        b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => send({ a: 'kick', id: x.dataset.k }));
        b.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
            const a = x.dataset.a; snd('simpleselect');
            if (a === 'ready') send({ a: 'ready', v: !((S.party.members.find(m => m.id === S.me) || {}).ready) });
            else if (a === 'copy') copyLink();
            else if (a === 'leave') { send({ a: 'leave' }); S.party = null; S.err = ''; render(); }
            else send({ a });
        });
    }
    function copyLink() {
        if (!S.party) return;
        const link = location.origin + location.pathname + '?party=' + S.party.code;
        const done = () => { S.err = ''; const el = S.box && S.box.querySelector('[data-a="copy"]'); if (el) { el.textContent = 'COPIED!'; setTimeout(() => { if (el.isConnected) el.textContent = 'COPY LINK'; }, 1500); } };
        try { navigator.clipboard.writeText(link).then(done, done); } catch (e) { done(); }
    }
    // El contador de la cola se actualiza sin repintar todo.
    setInterval(() => {
        const q = document.getElementById('sqQ');
        if (q && S.party && S.party.queuedAt) q.textContent = 'SEARCHING FOR A RIVAL… ' + Math.max(0, Math.round((Date.now() - S.party.queuedAt) / 1000)) + 's';
    }, 1000);

    // ---------------- montaje ----------------
    function pcRoot() {
        if (S.pcRoot) return S.pcRoot;
        const r = document.createElement('div'); r.id = 'sqPc';
        r.innerHTML = '<div class="sq-box"><button class="sq-x">CLOSE</button><div id="sqPcBody"></div></div>';
        r.querySelector('.sq-x').onclick = hidePc;
        r.addEventListener('click', e => { if (e.target === r) hidePc(); });
        document.body.appendChild(r);
        S.pcRoot = r; return r;
    }
    function hidePc() { if (S.pcRoot) S.pcRoot.classList.remove('open'); }
    function closeHubPanel() { const ar = document.getElementById('ahAr'); if (ar) ar.classList.remove('open'); }
    function openPc() {
        const r = pcRoot(); r.classList.add('open');
        S.box = r.querySelector('#sqPcBody');
        try { closePlayChoice(); } catch (e) {}
        connect(); render();
    }
    // La app monta el panel dentro de su ARENAS (el hub llama a mountIn con su contenedor).
    function mountIn(box) { S.box = box; connect(); render(); }
    function open() { if (EN_APP && document.getElementById('ahAr')) return; openPc(); }
    function joinFromLink() {
        const c = new URLSearchParams(location.search).get('party');
        if (!c || !/^[A-Za-z0-9]{5}$/.test(c)) return;
        const go = () => {
            if (EN_APP) { const it = document.querySelector('#appHub [data-a="arenas"]'); if (it) it.click(); }
            else openPc();
            const nm = myName() || 'PLAYER';
            connect(() => send({ a: 'join', code: c, name: nm }));
        };
        setTimeout(go, 1200);
    }
    // Para el render: 'ally' (companero, aro azul), 'foe' (rival real, aro rojo) o null.
    window.pwSquadRel = id => (S.rel ? S.rel.get(id) || null : null);
    window.PWSquad = { open, mountIn, onRoster, onEnd, state: S };
    if (document.readyState === 'complete') joinFromLink(); else addEventListener('load', joinFromLink);
})();
