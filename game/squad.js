/*
 * ARENAS por equipos (1v1 / 2v2 / 3v3) + amigos — cliente.
 *
 * Tres pestanas: GRUPO (lobby estilo LoL: creas grupo o entras con un codigo, todos
 * marcais LISTO y el lider da a BUSCAR PARTIDA o CREAR SALA), AMIGOS (lista con
 * presencia, invitar al grupo y susurros) y SALAS (los grupos que han creado sala custom
 * y esperan retador: ves quien es y lo retas).
 *
 * Mientras llega rival se juega una sala de practica juntos contra bots; al haber
 * rival el servidor manda un ticket y se pasa a la partida real. Protocolo y reglas:
 * server/squad.js y server/social.js.
 *
 * La identidad es la cuenta de X vinculada (la wallet del movil ya entra en esa misma
 * cuenta). Sin X vinculado se puede jugar en grupo con codigo, pero no hay amigos.
 *
 * Una sola UI para PC y app: render() pinta dentro de un contenedor. En la app va dentro
 * del panel ARENAS del hub (app-hub.js); en PC, en un cartel propio (#sqPc) que abre el
 * popup de PLAY. El tamano se escala con `em`, asi que cada sitio fija su font-size.
 */
(function () {
    'use strict';
    const SIZES = [1, 2, 3];
    const S = {
        ws: null, conn: 'idle', party: null, me: null, err: '', box: null, pcRoot: null, roster: null, rel: null,
        ticketTimer: null, practiceTimer: null, enterBusy: false, after: null,
        tab: 'party', x: 'unknown', token: null, prof: null, idAt: 0,
        friends: { friends: [], inReq: [], outReq: [] }, rooms: [], chat: {}, chatWith: null, unread: {}, roomsTimer: null, note: '',
    };
    const EN_APP = document.documentElement.classList.contains('pw-app');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const snd = n => { try { SoundManager.play(n); } catch (e) {} };
    const ERRS = {
        no_party: 'That party code does not exist.', party_full: 'That party is full.', party_busy: 'That party is busy right now.',
        need_full_party: 'You need a full party: every slot taken.', not_ready: 'Everyone must be READY first.', not_leader: 'Only the party leader can do that.',
        size_too_small: 'There are more players than slots in that size.', already_in_party: 'You are already in a party.',
        bad_token: 'Could not verify your X account. Reopen this panel.', need_x: 'Link your X account to use friends.',
        no_such_user: 'No player with that X name has opened Arenas yet.', self: "That's you!", already_friends: 'You are already friends.',
        already_requested: 'Request already sent.', friends_full: 'Friends list is full.', requests_full: 'That player has too many pending requests.',
        no_request: 'That request is gone.', not_friends: 'You can only do that with friends.', no_open_party: 'Create a party first.',
        offline: 'That friend is offline.', slow_down: 'Slow down a little.', room_gone: 'That room is no longer available.',
        wrong_size: 'Your party must be the same size as that room.',
    };
    const ST = { on: 'ONLINE', party: 'IN A PARTY', game: 'IN A MATCH', off: 'OFFLINE' };

    const css = `
#ahArBody .sq-t.home{display:none}
.sq{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.7em;padding:.2em .3em}
.sq *{box-sizing:border-box}
.sq-t{font-size:.95em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000;letter-spacing:.06em}
.sq-p{font-size:.42em;line-height:1.9;color:#cfd8d3;max-width:36em}
.sq-tabs{display:flex;gap:.4em;width:100%;justify-content:center}
.sq-tab{position:relative;font-family:'Russo One',sans-serif;font-size:.62em;letter-spacing:.1em;padding:.45em 1.1em;border:.14em solid #2c3630;color:#7d8a82;background:none;cursor:pointer}
.sq-tab.on{background:var(--ac,#00ff88);border-color:var(--ac,#00ff88);color:#04150c}
.sq-bd{position:absolute;right:-.5em;top:-.7em;background:#e5302f;color:#fff;font-family:'Press Start 2P',monospace;font-size:.6em;padding:.3em .4em .2em;box-shadow:0 0 0 .15em #000}
.sq-row{display:flex;gap:.6em;align-items:stretch;justify-content:center;flex-wrap:wrap;width:100%}
.sq-b{font-family:'Russo One',sans-serif;font-size:.78em;letter-spacing:.1em;padding:.55em 1.1em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer;min-width:5.6em}
.sq-b.sm{font-size:.5em;padding:.4em .8em;min-width:0}
.sq-b.on{background:var(--ac,#00ff88);border-color:var(--ac,#00ff88);color:#04150c}
.sq-b.gold{background:#ffd23a;border-color:#ffd23a;color:#241a00}
.sq-b.red{border-color:#7a2a26;color:#ff8a7a}
.sq-b:disabled{opacity:.35;cursor:default}
.sq-b:active:not(:disabled){transform:translateY(.1em)}
.sq-sz{display:flex;gap:.5em}
.sq-in{font-family:'Press Start 2P',monospace;font-size:.62em;text-align:center;text-transform:uppercase;color:#fff;background:#050c09;border:.2em solid #2c3630;padding:.8em .5em;outline:none;width:11em;letter-spacing:.2em}
.sq-in:focus{border-color:var(--ac,#00ff88)}
.sq-in.nm{width:13em;letter-spacing:.05em}
.sq-in.tx{text-transform:none;letter-spacing:.02em;width:100%;text-align:left;font-size:.5em}
.sq-lab{font-size:.36em;color:#7d8a82;letter-spacing:.12em;margin-bottom:-.3em}
.sq-code{font-size:1.5em;letter-spacing:.3em;color:#ffd23a;text-shadow:.1em .1em 0 #000;padding:.2em .2em .1em .5em;border:.12em dashed #5a4a10;background:rgba(0,0,0,.35)}
.sq-slots{display:flex;gap:.55em;width:100%;justify-content:center;flex-wrap:wrap}
.sq-slot{position:relative;width:9.5em;min-height:5.2em;padding:.7em .4em;background:rgba(0,0,0,.32);border:.07em solid rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5em}
.sq-slot.me{border:.14em solid var(--ac,#00ff88)}
.sq-slot.empty{border-style:dashed;color:#56635b}
.sq-slot .n{font-size:.5em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-slot .s{font-size:.36em;letter-spacing:.1em;color:#7d8a82}
.sq-slot .s.rd{color:#00ff66}
.sq-slot .s.ld{color:#ffd23a}
.sq-slot .k{position:absolute;right:.2em;top:.1em;font-size:.4em;color:#e5302f;cursor:pointer;padding:.4em}
.sq-pic{width:1.9em;height:1.9em;border-radius:50%;object-fit:cover;background:#16201b;box-shadow:0 0 0 .12em #000;flex:none;display:inline-block}
.sq-slot .sq-pic{width:2.3em;height:2.3em}
.sq-err{font-size:.4em;color:#ff6a5a;min-height:1.4em;line-height:1.6}
.sq-ok{color:#00ff66}
.sq-q{font-size:.55em;color:#9bbfff;letter-spacing:.1em;animation:sqB 1s steps(2) infinite}
@keyframes sqB{50%{opacity:.35}}
.sq-note{font-size:.38em;line-height:1.9;color:#8aa096;max-width:36em}
.sq-list{width:100%;max-height:11.5em;overflow:auto;display:flex;flex-direction:column;gap:.35em;text-align:left;padding-right:.2em}
.sq-it{display:flex;align-items:center;gap:.7em;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.08);padding:.45em .6em}
.sq-it .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.45em}
.sq-it .n{font-size:.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-it .s{font-size:.34em;letter-spacing:.08em;color:#7d8a82;display:flex;align-items:center;gap:.6em}
.sq-it .s i{width:.9em;height:.9em;background:#56635b;display:inline-block}
.sq-it .s.on i{background:#00ff66}.sq-it .s.party i{background:#4d9bff}.sq-it .s.game i{background:#ffd23a}
.sq-it .a{display:flex;gap:.35em;flex:none}
.sq-h{font-size:.4em;color:var(--ac,#00ff88);letter-spacing:.12em;text-align:left;width:100%;margin-top:.3em}
.sq-chat{width:100%;height:8.5em;overflow:auto;background:rgba(0,0,0,.35);border:.07em solid rgba(255,255,255,.08);padding:.5em .6em;display:flex;flex-direction:column;gap:.4em;text-align:left}
.sq-chat div{font-family:'VT323',monospace;font-size:1.05em;line-height:1.15;color:#cfd8d3;word-break:break-word}
.sq-chat div b{color:var(--ac,#00ff88);font-weight:400}
.sq-chat div.me b{color:#ffd23a}
#sqPc{position:fixed;inset:0;z-index:120;background:rgba(3,6,4,.88);display:none;align-items:center;justify-content:center}
#sqPc.open{display:flex}
#sqPc .sq-box{position:relative;width:min(46em,94vw);max-height:94vh;overflow:auto;font-size:16px;padding:1.4em 1.4em 1.1em;background:#0b120e;border:.2em solid var(--ac,#00ff88);box-shadow:0 0 0 .2em #000,.4em .4em 0 .2em rgba(0,0,0,.6),0 0 2em rgba(0,255,136,.25)}
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
#sqToast{position:fixed;right:10px;top:10px;z-index:310;display:flex;flex-direction:column;gap:8px;max-width:min(330px,92vw);font-family:'Press Start 2P',monospace}
#sqToast .t{background:rgba(8,12,10,.96);border:2px solid #4d9bff;box-shadow:3px 3px 0 rgba(0,0,0,.6),0 0 14px rgba(77,155,255,.35);padding:9px 10px;font-size:8px;line-height:1.7;color:#fff;display:flex;flex-direction:column;gap:7px}
#sqToast .t.w{border-color:#ffd23a;box-shadow:3px 3px 0 rgba(0,0,0,.6),0 0 14px rgba(255,210,58,.3)}
#sqToast .t .r{display:flex;gap:6px;align-items:center}
#sqToast .t img{width:22px;height:22px;border-radius:50%;object-fit:cover}
#sqToast .t button{font-family:'Russo One',sans-serif;font-size:10px;letter-spacing:1px;padding:4px 10px;border:2px solid #2c3630;background:none;color:#9fb0a6;cursor:pointer}
#sqToast .t button.y{background:#00ff88;border-color:#00ff88;color:#04150c}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    // ---------------- identidad (cuenta de X vinculada) ----------------
    async function loadIdentity(force) {
        if (!force && Date.now() - S.idAt < 10 * 60 * 1000 && S.x !== 'unknown') return;
        try {
            const j = await (await fetch('/api/airdrop/social-token', { cache: 'no-store' })).json();
            if (j && j.linked) { S.x = 'linked'; S.token = j.token; S.prof = j.me; }
            else { S.x = j && j.signedIn ? 'nox' : 'nosession'; S.token = null; S.prof = null; }
            S.idAt = Date.now();
        } catch (e) { /* sin red: se reintenta al abrir */ }
    }

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
        loadIdentity().then(hostUrl).then(url => {
            const ws = new WebSocket(url);
            S.ws = ws;
            ws.onopen = () => {
                S.conn = 'open';
                if (S.token) send({ a: 'hello', token: S.token });   // antes que cualquier otra orden
                render(); const f = S.after; S.after = null; f && f();
            };
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
    function badgeCount() { return S.friends.inReq.length + Object.values(S.unread).reduce((a, b) => a + b, 0); }
    function onMsg(m) {
        if (m.t === 'sqParty') { S.party = m; S.me = m.me; S.err = ''; render(); if (m.state === 'queued') hidePc(); }
        else if (m.t === 'sqGone') { S.party = null; S.err = m.reason === 'kicked' ? 'You were removed from the party.' : ''; render(); }
        else if (m.t === 'sqErr') { S.err = ERRS[m.reason] || 'Something went wrong.'; S.note = ''; render(); }
        else if (m.t === 'sqTicket') onTicket(m);
        else if (m.t === 'sqMe') { S.prof = m.me; }
        else if (m.t === 'sqFriends') { S.friends = { friends: m.friends, inReq: m.inReq, outReq: m.outReq }; render(); }
        else if (m.t === 'sqPresence') { const f = S.friends.friends.find(x => x.id === m.id); if (f) { f.st = m.st; if (S.tab === 'friends') render(); } }
        else if (m.t === 'sqRooms') { S.rooms = m.rooms; if (S.tab === 'rooms') render(); }
        else if (m.t === 'sqInvited') { S.note = 'Invite sent!'; S.err = ''; render(); }
        else if (m.t === 'sqFriendReq') { toast({ pic: m.from.p, text: '@' + esc(m.from.u) + ' wants to be your friend', warm: true, actions: [['ACCEPT', () => send({ a: 'faccept', id: m.from.id }), 1], ['LATER', null]] }); render(); }
        else if (m.t === 'sqInvite') onInvite(m);
        else if (m.t === 'sqWhisper') onWhisper(m);
    }

    // ---------------- avisos ----------------
    function toast(o) {
        let box = document.getElementById('sqToast');
        if (!box) { box = document.createElement('div'); box.id = 'sqToast'; document.body.appendChild(box); }
        const el = document.createElement('div'); el.className = 't' + (o.warm ? ' w' : '');
        el.innerHTML = '<div class="r">' + (o.pic ? '<img src="' + esc(o.pic) + '" alt="">' : '') + '<div>' + o.text + '</div></div>' + (o.actions ? '<div class="r">' + o.actions.map((a, i) => '<button data-i="' + i + '" class="' + (a[2] ? 'y' : '') + '">' + a[0] + '</button>').join('') + '</div>' : '');
        const kill = () => { clearTimeout(tm); el.remove(); };
        const tm = setTimeout(kill, o.ms || 14000);
        el.querySelectorAll('button').forEach(b => b.onclick = () => { const a = o.actions[+b.dataset.i]; kill(); if (a[1]) a[1](); });
        box.appendChild(el); snd('alert');
        while (box.children.length > 3) box.firstChild.remove();
    }
    function onInvite(m) {
        toast({
            pic: m.from.p, warm: true, ms: 30000, text: '@' + esc(m.from.u) + ' invites you to a ' + m.size + 'V' + m.size + ' party',
            actions: [['JOIN', () => joinCode(m.code), 1], ['NO', null]],
        });
    }
    function joinCode(code) {
        if (S.party) { send({ a: 'leave' }); S.party = null; }
        S.tab = 'party';
        openPanel();
        connect(() => send({ a: 'join', code, name: myName() || 'PLAYER' }));
    }
    function onWhisper(m) {
        const other = m.mine ? m.to : m.from;
        const list = S.chat[other.id] || (S.chat[other.id] = []);
        list.push({ me: !!m.mine, text: m.text, ts: m.ts }); if (list.length > 40) list.shift();
        if (!m.mine) {
            const viewing = S.tab === 'friends' && S.chatWith === other.id && panelOpen();
            if (!viewing) {
                S.unread[other.id] = (S.unread[other.id] || 0) + 1;
                toast({ pic: other.p, text: '@' + esc(other.u) + ': ' + esc(m.text.slice(0, 80)), actions: [['REPLY', () => { S.tab = 'friends'; S.chatWith = other.id; S.unread[other.id] = 0; openPanel(); }, 1], ['X', null]], ms: 9000 });
            }
        }
        render();
        const c = S.box && S.box.querySelector('.sq-chat'); if (c) c.scrollTop = c.scrollHeight;
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
    const pic = u => u ? '<img class="sq-pic" src="' + esc(u) + '" alt="" referrerpolicy="no-referrer">' : '<span class="sq-pic"></span>';
    function slotsHtml(p) {
        const mem = p.members, out = [];
        for (let i = 0; i < p.size; i++) {
            const m = mem[i];
            if (!m) { out.push('<div class="sq-slot empty"><div class="n">EMPTY</div><div class="s">WAITING…</div></div>'); continue; }
            const imLeader = p.leader === S.me;
            const stt = m.leader ? '<div class="s ld">LEADER</div>' : (m.ready ? '<div class="s rd">READY</div>' : '<div class="s">NOT READY</div>');
            out.push('<div class="sq-slot' + (m.id === S.me ? ' me' : '') + '">' + (imLeader && m.id !== S.me && p.state === 'idle' ? '<span class="k" data-k="' + m.id + '">X</span>' : '') +
                (m.pic ? pic(m.pic) : '') + '<div class="n">' + esc(m.name) + '</div>' + stt + '</div>');
        }
        return out.join('');
    }
    function partyHtml() {
        const p = S.party;
        const err = '<div class="sq-err">' + (S.note ? '<span class="sq-ok">' + esc(S.note) + '</span>' : esc(S.err || '')) + '</div>';
        if (!p) {
            const nm = S.prof ? '@' + S.prof.u : myName();
            return '<div class="sq"><div class="sq-t home">ARENAS</div>' +
                '<div class="sq-p">Team battles in small arenas: 1V1, 2V2 or 3V3 plus bots up to 30 players. Make a party, share the code or invite a friend, and the last team standing wins. Free for now.</div>' +
                (S.prof ? '<div class="sq-lab">PLAYING AS</div><div class="sq-row" style="align-items:center">' + pic(S.prof.p) + '<span style="font-size:.6em">@' + esc(S.prof.u) + '</span></div>'
                    : '<div class="sq-lab">YOUR NAME</div><input class="sq-in nm" id="sqName" maxlength="16" placeholder="PLAYER" value="' + esc(nm) + '">') +
                '<div class="sq-lab">CREATE A PARTY</div><div class="sq-row">' + SIZES.map(n => '<button class="sq-b on" data-c="' + n + '">' + n + 'V' + n + '</button>').join('') + '</div>' +
                '<div class="sq-lab">OR JOIN WITH A CODE</div><div class="sq-row"><input class="sq-in" id="sqCode" maxlength="5" placeholder="CODE"><button class="sq-b" id="sqJoin">JOIN</button></div>' +
                err + (S.conn === 'connecting' ? '<div class="sq-q">CONNECTING…</div>' : '') + '</div>';
        }
        const imLeader = p.leader === S.me;
        const meM = p.members.find(m => m.id === S.me) || {};
        const full = p.members.length === p.size, allReady = p.members.every(m => m.leader || m.ready);
        let head = '<div class="sq-t">' + p.size + 'V' + p.size + (p.custom && p.state === 'queued' ? ' ROOM' : ' PARTY') + '</div>';
        let ctl = '';
        if (p.state === 'queued') {
            const secs = Math.max(0, Math.round((Date.now() - (p.queuedAt || Date.now())) / 1000));
            head += '<div class="sq-q" id="sqQ">' + (p.custom ? 'WAITING FOR A CHALLENGER… ' : 'SEARCHING FOR A RIVAL… ') + secs + 's</div>' +
                '<div class="sq-note">' + (p.custom ? 'Your room is listed in ROOMS so other parties can challenge you. ' : '') + 'You are playing a practice room together against bots meanwhile. When a rival shows up you jump straight into the match.</div>';
            ctl = imLeader ? '<button class="sq-b" data-a="cancel">CANCEL</button>' : '';
        } else if (p.state === 'match') {
            head += '<div class="sq-q">MATCH IN PROGRESS</div>';
        } else {
            ctl = (imLeader ? SIZES.map(n => '<button class="sq-b' + (n === p.size ? ' on' : '') + '" data-s="' + n + '">' + n + 'V' + n + '</button>').join('') +
                '<button class="sq-b gold" data-a="play"' + (full && allReady ? '' : ' disabled') + '>FIND MATCH</button>' +
                '<button class="sq-b gold" data-a="room"' + (full && allReady ? '' : ' disabled') + '>CREATE ROOM</button>' :
                '<button class="sq-b' + (meM.ready ? '' : ' on') + '" data-a="ready">' + (meM.ready ? 'NOT READY' : 'READY') + '</button>');
        }
        return '<div class="sq">' + head +
            '<div class="sq-lab">PARTY CODE · SHARE IT OR INVITE A FRIEND</div><div class="sq-row" style="align-items:center"><div class="sq-code">' + esc(p.code) + '</div><button class="sq-b" data-a="copy">COPY LINK</button>' +
            (S.x === 'linked' && p.state === 'idle' && !full ? '<button class="sq-b" data-a="invite">INVITE FRIEND</button>' : '') + '</div>' +
            '<div class="sq-slots">' + slotsHtml(p) + '</div>' +
            (p.state === 'idle' ? '<div class="sq-note">' + (full ? (allReady ? 'Everyone is ready.' : 'Waiting for everyone to be READY.') : 'Waiting for ' + (p.size - p.members.length) + ' more player(s).') + '</div>' : '') +
            '<div class="sq-row">' + ctl + '<button class="sq-b" data-a="leave">LEAVE</button></div>' + err + '</div>';
    }
    function noX() {
        return '<div class="sq"><div class="sq-t">FRIENDS</div><div class="sq-p">' + (S.x === 'nosession'
            ? 'Connect your wallet and your X account to get a friends list, invites and whispers. One X account per wallet.'
            : 'Link your X account to this wallet to get a friends list, invites and whispers. It is linked once and stays linked.') + '</div>' +
            '<div class="sq-row"><button class="sq-b on" data-a="linkx">CONNECT X</button><button class="sq-b" data-a="recheck">I DID IT</button></div></div>';
    }
    function friendsHtml() {
        if (S.x !== 'linked') return noX();
        const F = S.friends, p = S.party, canInvite = p && p.state === 'idle' && p.members.length < p.size;
        const err = '<div class="sq-err">' + (S.note ? '<span class="sq-ok">' + esc(S.note) + '</span>' : esc(S.err || '')) + '</div>';
        if (S.chatWith) {
            const f = F.friends.find(x => x.id === S.chatWith) || { u: '?', p: '', st: 'off', id: S.chatWith };
            const msgs = (S.chat[f.id] || []).map(m => '<div class="' + (m.me ? 'me' : '') + '"><b>' + (m.me ? 'YOU' : '@' + esc(f.u)) + ':</b> ' + esc(m.text) + '</div>').join('') || '<div>Say hi to @' + esc(f.u) + '.</div>';
            return '<div class="sq"><div class="sq-row" style="align-items:center;justify-content:flex-start">' + '<button class="sq-b sm" data-a="chatx">BACK</button>' + pic(f.p) + '<span style="font-size:.55em">@' + esc(f.u) + '</span><span class="sq-it" style="border:0;background:none;padding:0"><span class="s ' + f.st + '"><i></i>' + ST[f.st] + '</span></span></div>' +
                '<div class="sq-chat" id="sqChat">' + msgs + '</div>' +
                '<div class="sq-row"><input class="sq-in tx" id="sqMsg" maxlength="200" placeholder="Whisper to @' + esc(f.u) + '…" autocomplete="off"><button class="sq-b sm on" data-a="wsend">SEND</button></div>' + err + '</div>';
        }
        const reqs = F.inReq.length ? '<div class="sq-h">REQUESTS</div><div class="sq-list">' + F.inReq.map(r => '<div class="sq-it">' + pic(r.p) + '<div class="w"><div class="n">@' + esc(r.u) + '</div></div><div class="a"><button class="sq-b sm on" data-ac="' + r.id + '">ACCEPT</button><button class="sq-b sm" data-dc="' + r.id + '">NO</button></div></div>').join('') + '</div>' : '';
        const order = { on: 0, party: 1, game: 1, off: 2 };
        const list = F.friends.slice().sort((a, b) => order[a.st] - order[b.st] || a.u.localeCompare(b.u)).map(f =>
            '<div class="sq-it">' + pic(f.p) + '<div class="w"><div class="n">@' + esc(f.u) + (S.unread[f.id] ? ' <span class="sq-bd" style="position:static;margin-left:.4em">' + S.unread[f.id] + '</span>' : '') + '</div><div class="s ' + f.st + '"><i></i>' + ST[f.st] + '</div></div>' +
            '<div class="a">' + (canInvite && f.st !== 'off' ? '<button class="sq-b sm on" data-inv="' + f.id + '">INVITE</button>' : '') + '<button class="sq-b sm" data-w="' + f.id + '"' + (f.st === 'off' ? ' disabled' : '') + '>WHISPER</button><button class="sq-b sm red" data-rm="' + f.id + '">X</button></div></div>').join('');
        return '<div class="sq"><div class="sq-row" style="align-items:center"><input class="sq-in tx" id="sqAdd" maxlength="20" placeholder="@X NAME" autocomplete="off" style="width:16em"><button class="sq-b sm on" data-a="fadd">ADD</button></div>' +
            reqs + '<div class="sq-h">FRIENDS · ' + F.friends.filter(f => f.st !== 'off').length + ' ONLINE</div>' +
            '<div class="sq-list">' + (list || '<div class="sq-note" style="padding:.8em">No friends yet. Add someone by their X name. They need to have opened Arenas once.</div>') + '</div>' +
            (F.outReq.length ? '<div class="sq-note">Pending: ' + F.outReq.map(r => '@' + esc(r.u)).join(', ') + '</div>' : '') + err + '</div>';
    }
    function roomsHtml() {
        const p = S.party;
        const ready = p && p.state === 'idle' && p.members.length === p.size && p.members.every(m => m.leader || m.ready) && p.leader === S.me;
        const err = '<div class="sq-err">' + esc(S.err || '') + '</div>';
        const list = S.rooms.filter(r => !p || r.code !== p.code).map(r => {
            const can = ready && p.size === r.size;
            const secs = Math.max(0, Math.round((Date.now() - r.since) / 1000));
            return '<div class="sq-it">' + pic(r.leader.pic) + '<div class="w"><div class="n">' + esc(r.leader.name) + "'S ROOM</div><div class=\"s\">" + r.size + 'V' + r.size + ' · ' + r.members.map(esc).join(', ') + ' · ' + secs + 's</div></div>' +
                '<div class="a"><button class="sq-b sm gold" data-ch="' + r.code + '"' + (can ? '' : ' disabled') + '>CHALLENGE</button></div></div>';
        }).join('');
        return '<div class="sq"><div class="sq-t">OPEN ROOMS</div>' +
            '<div class="sq-p">Parties that created a room and wait for a challenger. ' + (p ? (ready ? 'Pick one with your size to challenge it.' : 'To challenge you need a full party of the same size, everyone READY, and be the leader.') : 'Create a party first, then challenge a room.') + '</div>' +
            '<div class="sq-list">' + (list || '<div class="sq-note" style="padding:.8em">No open rooms right now. Create yours with CREATE ROOM in your party.</div>') + '</div>' + err + '</div>';
    }
    function tabsHtml() {
        const n = badgeCount();
        return '<div class="sq-tabs">' +
            ['party:PARTY', 'friends:FRIENDS', 'rooms:ROOMS'].map(x => { const [k, l] = x.split(':'); return '<button class="sq-tab' + (S.tab === k ? ' on' : '') + '" data-tab="' + k + '">' + l + (k === 'friends' && n ? '<span class="sq-bd">' + n + '</span>' : '') + '</button>'; }).join('') + '</div>';
    }
    function render() {
        if (!S.box) return;
        const keep = S.box.querySelector('#sqAdd') ? S.box.querySelector('#sqAdd').value : null, keepMsg = S.box.querySelector('#sqMsg') ? S.box.querySelector('#sqMsg').value : null;
        const focus = document.activeElement && document.activeElement.id;
        S.box.innerHTML = tabsHtml() + (S.tab === 'friends' ? friendsHtml() : S.tab === 'rooms' ? roomsHtml() : partyHtml());
        if (keep != null && S.box.querySelector('#sqAdd')) S.box.querySelector('#sqAdd').value = keep;
        if (keepMsg != null && S.box.querySelector('#sqMsg')) S.box.querySelector('#sqMsg').value = keepMsg;
        if (focus && S.box.querySelector('#' + focus)) { const el = S.box.querySelector('#' + focus); el.focus(); }
        const c = S.box.querySelector('#sqChat'); if (c) c.scrollTop = c.scrollHeight;
        wire();
        try { if (window.PWSquadHooks && PWSquadHooks.afterRender) PWSquadHooks.afterRender(); } catch (e) {}
    }
    function setTab(t) {
        S.tab = t; S.err = ''; S.note = ''; S.chatWith = t === 'friends' ? S.chatWith : null;
        clearInterval(S.roomsTimer); S.roomsTimer = null;
        if (t === 'rooms') { send({ a: 'rooms' }); S.roomsTimer = setInterval(() => { if (S.tab === 'rooms' && panelOpen()) send({ a: 'rooms' }); }, 4000); }
        if (t === 'friends' && S.x === 'unknown') loadIdentity(true).then(render);
        render();
    }
    function wire() {
        const b = S.box;
        const nameOf = () => { const el = b.querySelector('#sqName'); const v = el ? el.value.trim() : myName(); try { localStorage.setItem('pw_sq_name', v); } catch (e) {} return v || 'PLAYER'; };
        b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { snd('simpleselect'); setTab(x.dataset.tab); });
        b.querySelectorAll('[data-c]').forEach(x => x.onclick = () => { snd('simpleselect'); const n = +x.dataset.c, nm = nameOf(); connect(() => send({ a: 'create', name: nm, size: n })); });
        const j = b.querySelector('#sqJoin');
        if (j) j.onclick = () => { snd('simpleselect'); const c = b.querySelector('#sqCode').value.trim(), nm = nameOf(); if (!c) { S.err = 'Type the party code first.'; render(); return; } connect(() => send({ a: 'join', code: c, name: nm })); };
        b.querySelectorAll('[data-s]').forEach(x => x.onclick = () => { snd('simpleselect'); send({ a: 'size', n: +x.dataset.s }); });
        b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => send({ a: 'kick', id: x.dataset.k }));
        b.querySelectorAll('[data-ac]').forEach(x => x.onclick = () => send({ a: 'faccept', id: x.dataset.ac }));
        b.querySelectorAll('[data-dc]').forEach(x => x.onclick = () => send({ a: 'fdecline', id: x.dataset.dc }));
        b.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { if (x.dataset.sure === '1') send({ a: 'fremove', id: x.dataset.rm }); else { x.dataset.sure = '1'; x.textContent = 'SURE?'; setTimeout(() => { if (x.isConnected) { x.dataset.sure = ''; x.textContent = 'X'; } }, 2500); } });
        b.querySelectorAll('[data-inv]').forEach(x => x.onclick = () => { snd('simpleselect'); send({ a: 'pinvite', id: x.dataset.inv }); });
        b.querySelectorAll('[data-w]').forEach(x => x.onclick = () => { S.chatWith = x.dataset.w; S.unread[x.dataset.w] = 0; render(); const i = b.querySelector('#sqMsg'); if (i) i.focus(); });
        b.querySelectorAll('[data-ch]').forEach(x => x.onclick = () => { snd('simpleselect'); send({ a: 'challenge', code: x.dataset.ch }); });
        const addIn = b.querySelector('#sqAdd');
        if (addIn) addIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="fadd"]').click(); };
        const msgIn = b.querySelector('#sqMsg');
        if (msgIn) msgIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="wsend"]').click(); };
        b.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
            const a = x.dataset.a; snd('simpleselect');
            if (a === 'ready') send({ a: 'ready', v: !((S.party.members.find(m => m.id === S.me) || {}).ready) });
            else if (a === 'copy') copyLink();
            else if (a === 'leave') { send({ a: 'leave' }); S.party = null; S.err = ''; render(); }
            else if (a === 'play') send({ a: 'play' });
            else if (a === 'room') send({ a: 'play', custom: true });
            else if (a === 'invite') setTab('friends');
            else if (a === 'fadd') { const v = (b.querySelector('#sqAdd').value || '').trim(); if (v) { send({ a: 'fadd', u: v }); b.querySelector('#sqAdd').value = ''; S.note = 'Request sent!'; S.err = ''; } }
            else if (a === 'chatx') { S.chatWith = null; render(); }
            else if (a === 'wsend') { const i = b.querySelector('#sqMsg'), v = (i.value || '').trim(); if (v) { send({ a: 'whisper', id: S.chatWith, text: v }); i.value = ''; } }
            else if (a === 'linkx') linkX();
            else if (a === 'recheck') loadIdentity(true).then(() => { S.x === 'linked' ? connect(() => { send({ a: 'friends' }); render(); }) : (S.err = 'Not linked yet.'); render(); });
            else send({ a });
        });
    }
    function linkX() {
        // App: el perfil del hub lleva a conectar wallet y X. PC: la pagina del airdrop.
        if (EN_APP && typeof window._hubConnectX === 'function') { closeHubPanel(); window._hubConnectX(); return; }
        window.open('/airdrop', '_blank');
    }
    function copyLink() {
        if (!S.party) return;
        const link = location.origin + location.pathname + '?party=' + S.party.code;
        const done = () => { const el = S.box && S.box.querySelector('[data-a="copy"]'); if (el) { el.textContent = 'COPIED!'; setTimeout(() => { if (el.isConnected) el.textContent = 'COPY LINK'; }, 1500); } };
        try { navigator.clipboard.writeText(link).then(done, done); } catch (e) { done(); }
    }
    // El contador de la cola se actualiza sin repintar todo.
    setInterval(() => {
        const q = document.getElementById('sqQ');
        if (q && S.party && S.party.queuedAt) q.textContent = (S.party.custom ? 'WAITING FOR A CHALLENGER… ' : 'SEARCHING FOR A RIVAL… ') + Math.max(0, Math.round((Date.now() - S.party.queuedAt) / 1000)) + 's';
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
    function panelOpen() { const ar = document.getElementById('ahAr'); return !!((ar && ar.classList.contains('open')) || (S.pcRoot && S.pcRoot.classList.contains('open'))); }
    function openPc() {
        const r = pcRoot(); r.classList.add('open');
        S.box = r.querySelector('#sqPcBody');
        try { closePlayChoice(); } catch (e) {}
        connect(); render();
    }
    // La app monta el panel dentro de su ARENAS (el hub llama a mountIn con su contenedor).
    function mountIn(box) { S.box = box; connect(); render(); }
    function openPanel() {
        if (EN_APP && document.getElementById('ahAr')) { const it = document.querySelector('#appHub [data-a="arenas"]'); if (it) it.click(); } else openPc();
    }
    function open() { if (EN_APP && document.getElementById('ahAr')) return; openPc(); }
    // Conexion en segundo plano: con X vinculado se reciben invitaciones y susurros aunque el panel este cerrado.
    async function boot() {
        await loadIdentity(true);
        if (S.x === 'linked' && !(S.ws && S.ws.readyState === 1)) connect();
    }
    function joinFromLink() {
        const c = new URLSearchParams(location.search).get('party');
        if (!c || !/^[A-Za-z0-9]{5}$/.test(c)) { setTimeout(boot, 2500); return; }
        setTimeout(() => joinCode(c.toUpperCase()), 1200);
    }
    window.PWSquad = { open, mountIn, onRoster, onEnd, boot, state: S };
    // Para el render: 'ally' (companero, aro azul), 'foe' (rival real, aro rojo) o null.
    window.pwSquadRel = id => (S.rel ? S.rel.get(id) || null : null);
    if (document.readyState === 'complete') joinFromLink(); else addEventListener('load', joinFromLink);
})();
