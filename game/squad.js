/*
 * ARENAS por equipos (1v1 / 2v2 / 3v3) y AMIGOS — cliente.
 *
 * Dos paneles separados:
 *  - ARENAS: la lista de salas (1V1, 2V2, 3V3). Ves las salas que ha creado la gente y puedes
 *    UNIRTE, o crear la tuya pulsando una sala vacia, o dar a PARTIDA RAPIDA. Al buscar sale
 *    "BUSCANDO" con la opcion de jugar una practica mientras esperas (no se mete a nadie en
 *    partida sin querer).
 *  - AMIGOS: lista con presencia, susurros y el GRUPO. Desde aqui se invita a los amigos y asi se
 *    forma el grupo (1 a 3) con el que luego se entra a las salas. Un grupo de 2 va a salas 2V2.
 *
 * La identidad es la cuenta del airdrop: wallet o X, da igual cual (con X se ve su usuario y
 * foto; con solo la wallet, su resumen). Protocolo y reglas: server/squad.js y server/social.js.
 *
 * Una sola UI para PC y app: render() pinta dentro de los contenedores montados. En la app van
 * dentro de los paneles del hub (app-hub.js); en PC, en carteles propios (#sqPc, #sqPcFr).
 * El tamano se escala con `em`, asi que cada sitio fija su font-size.
 */
(function () {
    'use strict';
    const SIZES = [1, 2, 3];
    const SLOTS = 3;   // tarjetas por columna en la lista de salas
    const S = {
        ws: null, conn: 'idle', party: null, me: null, err: '', note: '',
        box: { rooms: null, friends: null }, pc: {}, roster: null, rel: null,
        ticketTimer: null, practiceTimer: null, enterBusy: false, after: null,
        x: 'unknown', token: null, prof: null, idAt: 0,
        friends: { friends: [], inReq: [], outReq: [] }, rooms: [], chat: {}, chatWith: null, unread: {}, roomsTimer: null,
    };
    const EN_APP = document.documentElement.classList.contains('pw-app');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const snd = n => { try { SoundManager.play(n); } catch (e) {} };
    const ERRS = {
        no_party: 'That group is gone.', party_full: 'That group is full (3 players).', party_busy: "You can't do that while your group is searching.",
        not_leader: 'Only the group leader can do that.', size_mismatch: 'Your group size does not match that room.', already_in_party: 'You are already in a group.',
        bad_token: 'Could not verify your account. Reopen this panel.', need_x: 'Connect your wallet to use friends.',
        no_such_user: 'Nobody with that X name or wallet has opened Arenas yet.', self: "That's you!", already_friends: 'You are already friends.',
        already_requested: 'Request already sent.', friends_full: 'Friends list is full.', requests_full: 'That player has too many pending requests.',
        no_request: 'That request is gone.', not_friends: 'You can only do that with friends.', no_open_party: 'Invite a friend first.',
        offline: 'That friend is offline.', slow_down: 'Slow down a little.', room_gone: 'That room is no longer available.',
    };
    const ST = { on: 'ONLINE', party: 'IN A GROUP', game: 'IN A MATCH', off: 'OFFLINE' };
    const nameOf = o => o.u ? '@' + o.u : (o.n || 'PLAYER');
    const initial = o => esc(String(o.u || o.n || '?').replace(/^@/, '').slice(0, 1).toUpperCase());

    const css = `
.sq{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.8em;padding:.4em .8em .2em}
.sq *{box-sizing:border-box}
.sq-t{font-size:.9em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000;letter-spacing:.06em}
.sq-p{font-size:.4em;line-height:2;color:#cfd8d3;max-width:38em}
.sq-row{display:flex;gap:.8em;align-items:center;justify-content:center;flex-wrap:wrap;width:100%}
.sq-b{font-family:'Russo One',sans-serif;font-size:.74em;letter-spacing:.1em;padding:.6em 1.2em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer;min-width:5.6em}
.sq-b.sm{font-size:.5em;padding:.45em .9em;min-width:0}
.sq-b.on{background:var(--ac,#00ff88);border-color:var(--ac,#00ff88);color:#04150c}
.sq-b.gold{background:#ffd23a;border-color:#ffd23a;color:#241a00}
.sq-b.red{border-color:#7a2a26;color:#ff8a7a}
.sq-b:disabled{opacity:.35;cursor:default}
.sq-b:active:not(:disabled){transform:translateY(.1em)}
.sq-in{font-family:'Press Start 2P',monospace;font-size:.5em;color:#fff;background:#050c09;border:.2em solid #2c3630;padding:1em .9em;outline:none;width:100%;letter-spacing:.02em}
.sq-in:focus{border-color:var(--ac,#00ff88)}
.sq-lab{font-size:.36em;color:#7d8a82;letter-spacing:.14em}
.sq-err{font-size:.4em;color:#ff6a5a;min-height:1.6em;line-height:1.8}
.sq-ok{color:#00ff66}
.sq-q{font-size:.6em;color:#9bbfff;letter-spacing:.1em;animation:sqB 1s steps(2) infinite}
@keyframes sqB{50%{opacity:.35}}
.sq-note{font-size:.38em;line-height:2;color:#8aa096;max-width:36em}
.sq-pic{width:2.2em;height:2.2em;border-radius:50%;object-fit:cover;background:#16201b;box-shadow:0 0 0 .12em #000;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:.8em;color:#7d8a82}
/* grupo: foto y nombre debajo */
.sq-grp{display:flex;gap:1.2em;justify-content:center;align-items:flex-start;width:100%}
.sq-av{display:flex;flex-direction:column;align-items:center;gap:.6em;width:7em}
.sq-av .sq-pic{width:3.4em;height:3.4em;font-size:1.1em}
.sq-av .n{font-size:.42em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-av.me .sq-pic{box-shadow:0 0 0 .16em var(--ac,#00ff88)}
.sq-av .l{font-size:.32em;color:#ffd23a;letter-spacing:.1em;margin-top:-.3em}
.sq-av.empty .sq-pic{background:none;border:.14em dashed #34423a;box-shadow:none}
.sq-pic{overflow:hidden}
#ahFrBody,#ahArBody{max-height:17.5em;overflow-y:auto}
.sq-pic .av,.sq-pic .av-cv{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center}
.sq-pic .av svg{width:60%;height:60%}
.sq-pic canvas{image-rendering:pixelated}
/* buscando: los jugadores son lo central, grandes, y los botones van abajo */
.sq.find{min-height:15.5em;justify-content:space-between;gap:.6em}
.sq-grp.big{flex:1;align-items:center;gap:2.6em;margin:.2em 0}
.sq-grp.big .sq-av{width:12em;gap:.9em}
.sq-grp.big .sq-av .sq-pic{width:5.2em;height:5.2em;font-size:1.5em}
.sq-grp.big .sq-av .n{font-size:.55em}
.sq-grp.big .sq-av .l{font-size:.36em}
.sq-bot{display:flex;flex-direction:column;align-items:center;gap:.8em;width:100%}
.sq-av .k{font-size:.4em;color:#e5302f;cursor:pointer;padding:.2em .6em;border:.14em solid #5a2420}
/* lista de salas */
.sq-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:1em;width:100%}
.sq-col{display:flex;flex-direction:column;gap:.5em;min-width:0}
.sq-ch{font-size:.62em;letter-spacing:.1em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000}
.sq-col.dim .sq-ch{color:#56635b}
.sq-rm{display:flex;align-items:center;gap:.7em;min-height:2.9em;padding:.4em .7em;background:rgba(0,0,0,.3);border:.07em solid rgba(255,255,255,.1);text-align:left;min-width:0}
.sq-rm .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.5em}
.sq-rm .sq-pic{width:1.9em;height:1.9em}
.sq-rm .n{font-size:.45em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-rm .s{font-size:.32em;color:#7d8a82;letter-spacing:.08em}
.sq-rm.empty{border:.12em dashed #2f3d35;background:none;justify-content:center;flex-direction:column;gap:.35em;cursor:pointer;text-align:center}
.sq-rm.empty .n{color:#5d6b63}
.sq-rm.empty .s{letter-spacing:.3em;color:#3d4a43}
.sq-rm.empty:active{border-color:var(--ac,#00ff88)}
.sq-col.dim .sq-rm{opacity:.5}
.sq-more{max-height:10.5em;overflow:auto;display:flex;flex-direction:column;gap:.5em}
/* amigos */
.sq-list{width:100%;max-height:9em;overflow:auto;display:flex;flex-direction:column;gap:.6em;text-align:left;padding-right:.2em}
.sq-it{display:flex;align-items:center;gap:.9em;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.08);padding:.6em .8em}
.sq-it .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.55em}
.sq-it .n{font-size:.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-it .s{font-size:.34em;letter-spacing:.08em;color:#7d8a82;display:flex;align-items:center;gap:.6em}
.sq-it .s i{width:.9em;height:.9em;background:#56635b;display:inline-block}
.sq-it .s.on i{background:#00ff66}.sq-it .s.party i{background:#4d9bff}.sq-it .s.game i{background:#ffd23a}
.sq-it .a{display:flex;gap:.5em;flex:none}
.sq-h{font-size:.4em;color:var(--ac,#00ff88);letter-spacing:.14em;text-align:left;width:100%}
.sq-bd{background:#e5302f;color:#fff;font-family:'Press Start 2P',monospace;font-size:.7em;padding:.3em .45em .2em;box-shadow:0 0 0 .15em #000;margin-left:.5em}
.sq-chat{width:100%;height:7.5em;overflow:auto;background:rgba(0,0,0,.35);border:.07em solid rgba(255,255,255,.08);padding:.6em .8em;display:flex;flex-direction:column;gap:.5em;text-align:left}
.sq-chat div{font-family:'VT323',monospace;font-size:1.05em;line-height:1.15;color:#cfd8d3;word-break:break-word}
.sq-chat div b{color:var(--ac,#00ff88);font-weight:400}
.sq-chat div.me b{color:#ffd23a}
.sq-pcp{position:fixed;inset:0;z-index:120;background:rgba(3,6,4,.88);display:none;align-items:center;justify-content:center}
.sq-pcp.open{display:flex}
.sq-pcp .sq-box{position:relative;width:min(48em,94vw);max-height:94vh;overflow:auto;font-size:16px;padding:1.6em 1.4em 1.2em;background:#0b120e;border:.2em solid var(--ac,#00ff88);box-shadow:0 0 0 .2em #000,.4em .4em 0 .2em rgba(0,0,0,.6),0 0 2em rgba(0,255,136,.25)}
.sq-pcp .sq-x{position:absolute;right:.5em;top:.4em;font-family:'Russo One',sans-serif;font-size:.7em;letter-spacing:.1em;padding:.4em .8em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer}
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

    // ---------------- identidad (cuenta del airdrop: wallet o X) ----------------
    async function loadIdentity(force) {
        if (!force && Date.now() - S.idAt < 10 * 60 * 1000 && S.x !== 'unknown') return;
        try {
            const j = await (await fetch('/api/airdrop/social-token', { cache: 'no-store' })).json();
            if (j && j.linked) { S.x = 'linked'; S.token = j.token; S.prof = j.me; }
            else { S.x = 'nosession'; S.token = null; S.prof = null; }
            S.idAt = Date.now();
        } catch (e) { /* sin red: se reintenta al abrir */ }
    }

    // ---------------- conexion ----------------
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
        return (n || 'PLAYER').slice(0, 16);
    }
    // El icono del menu del jugador: lo ven sus amigos cuando no tiene foto de X.
    function myAv() { try { return window._hubAvatar ? window._hubAvatar() : null; } catch (e) { return null; } }
    function refreshAv() { if (S.token) send({ a: 'hello', token: S.token, av: myAv() }); }
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
                if (S.token) send({ a: 'hello', token: S.token, av: myAv() });   // antes que cualquier otra orden
                render(); const f = S.after; S.after = null; f && f();
            };
            ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
            ws.onclose = () => {
                if (S.ws !== ws) return;
                S.ws = null; S.conn = 'idle';
                if (S.party) { S.party = null; S.err = 'Connection lost.'; }
                render();
            };
            ws.onerror = () => { if (S.conn === 'connecting') { S.conn = 'idle'; S.after = null; S.err = "Couldn't reach the server. Try again."; render(); } };
        });
    }
    function badgeCount() { return S.friends.inReq.length + Object.values(S.unread).reduce((a, b) => a + b, 0); }
    function onMsg(m) {
        if (m.t === 'sqParty') { S.party = m; S.me = m.me; S.err = ''; render(); }
        else if (m.t === 'sqGone') { S.party = null; S.err = m.reason === 'kicked' ? 'You were removed from the group.' : ''; render(); }
        else if (m.t === 'sqErr') { S.err = ERRS[m.reason] || 'Something went wrong.'; S.note = ''; render(); }
        else if (m.t === 'sqTicket') onTicket(m);
        else if (m.t === 'sqMe') { S.prof = m.me; }
        else if (m.t === 'sqFriends') { S.friends = { friends: m.friends, inReq: m.inReq, outReq: m.outReq }; render(); }
        else if (m.t === 'sqPresence') { const f = S.friends.friends.find(x => x.id === m.id); if (f) { f.st = m.st; render(); } }
        else if (m.t === 'sqRooms') { S.rooms = m.rooms; render(); }
        else if (m.t === 'sqInvited') { S.note = 'Invite sent!'; S.err = ''; render(); }
        else if (m.t === 'sqFriendReq') { toast({ pic: m.from.p, text: esc(nameOf(m.from)) + ' wants to be your friend', warm: true, actions: [['ACCEPT', () => send({ a: 'faccept', id: m.from.id }), 1], ['LATER', null]] }); render(); }
        else if (m.t === 'sqInvite') onInvite(m);
        else if (m.t === 'sqWhisper') onWhisper(m);
    }

    // ---------------- avisos ----------------
    function toast(o) {
        let box = document.getElementById('sqToast');
        if (!box) { box = document.createElement('div'); box.id = 'sqToast'; document.body.appendChild(box); }
        const el = document.createElement('div'); el.className = 't' + (o.warm ? ' w' : '');
        el.innerHTML = '<div class="r">' + (o.pic ? '<img src="' + esc(o.pic) + '" alt="" referrerpolicy="no-referrer">' : '') + '<div>' + o.text + '</div></div>' + (o.actions ? '<div class="r">' + o.actions.map((a, i) => '<button data-i="' + i + '" class="' + (a[2] ? 'y' : '') + '">' + a[0] + '</button>').join('') + '</div>' : '');
        const kill = () => { clearTimeout(tm); el.remove(); };
        const tm = setTimeout(kill, o.ms || 14000);
        el.querySelectorAll('button').forEach(b => b.onclick = () => { const a = o.actions[+b.dataset.i]; kill(); if (a[1]) a[1](); });
        box.appendChild(el); snd('alert');
        while (box.children.length > 3) box.firstChild.remove();
    }
    function onInvite(m) {
        toast({
            pic: m.from.p, warm: true, ms: 30000, text: esc(nameOf(m.from)) + ' invites you to a group',
            actions: [['JOIN', () => joinCode(m.code), 1], ['NO', null]],
        });
    }
    function joinCode(code) {
        if (S.party) { send({ a: 'leave' }); S.party = null; }
        openFriends();
        connect(() => send({ a: 'join', code, name: myName() }));
    }
    function onWhisper(m) {
        const other = m.mine ? m.to : m.from;
        const list = S.chat[other.id] || (S.chat[other.id] = []);
        list.push({ me: !!m.mine, text: m.text, ts: m.ts }); if (list.length > 40) list.shift();
        if (!m.mine) {
            const viewing = S.chatWith === other.id && isOpen('friends');
            if (!viewing) {
                S.unread[other.id] = (S.unread[other.id] || 0) + 1;
                toast({ pic: other.p, text: esc(nameOf(other)) + ': ' + esc(m.text.slice(0, 80)), actions: [['REPLY', () => { S.chatWith = other.id; S.unread[other.id] = 0; openFriends(); }, 1], ['X', null]], ms: 9000 });
            }
        }
        render();
        const c = S.box.friends && S.box.friends.querySelector('.sq-chat'); if (c) c.scrollTop = c.scrollHeight;
    }

    // ---------------- entrada a sala ----------------
    function enter(ticket, kind) {
        if (S.enterBusy) return;
        S.enterBusy = true; setTimeout(() => { S.enterBusy = false; }, 2500);
        closeAll();
        if (typeof window.pwSquadEnter === 'function') window.pwSquadEnter(ticket, kind);
    }
    function onTicket(m) {
        if (m.kind === 'practice') {
            // El jugador pidio practicar mientras espera. Si ya hay una partida de equipo en curso no se pisa.
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
            // La practica acabo: si el grupo sigue buscando, se vuelve a ofrecer sin meter a nadie a la fuerza.
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
    // Foto de X; sin ella, el icono del menu del jugador (se dibuja al pintar, ver hydrate); y si no, su inicial.
    const pic = o => o.p ? '<img class="sq-pic" src="' + esc(o.p) + '" alt="" referrerpolicy="no-referrer">'
        : (o.av && window._hubAvatarEl ? '<span class="sq-pic" data-av="' + esc(JSON.stringify(o.av)) + '"></span>' : '<span class="sq-pic">' + initial(o) + '</span>');
    const memberO = m => ({ p: m.pic, av: m.av, u: '', n: m.name });
    function hydrate(box) {
        box.querySelectorAll('[data-av]').forEach(x => {
            try { const el = window._hubAvatarEl(JSON.parse(x.dataset.av), 96); x.removeAttribute('data-av'); x.appendChild(el); } catch (e) { x.removeAttribute('data-av'); }
        });
    }
    const imLeader = () => !S.party || S.party.leader === S.me;
    const groupSize = () => S.party ? S.party.members.length : 1;
    const errLine = () => '<div class="sq-err">' + (S.note ? '<span class="sq-ok">' + esc(S.note) + '</span>' : esc(S.err || '')) + '</div>';

    // El grupo: foto de cada uno con el nombre debajo.
    function groupHtml(withKick, slots, big) {
        const p = S.party;
        if (!p) return '';
        const out = [];
        for (let i = 0; i < Math.max(slots || p.members.length, p.members.length); i++) {
            const m = p.members[i];
            if (!m) { out.push('<div class="sq-av empty"><span class="sq-pic">+</span><div class="n" style="color:#4a5850">EMPTY</div></div>'); continue; }
            out.push('<div class="sq-av' + (m.id === S.me ? ' me' : '') + '">' + pic(memberO(m)) + '<div class="n">' + esc(m.name) + '</div>' +
                (m.leader ? '<div class="l">LEADER</div>' : (withKick && S.party.leader === S.me && p.state === 'idle' ? '<span class="k" data-k="' + m.id + '">KICK</span>' : '')) + '</div>');
        }
        return '<div class="sq-grp' + (big ? ' big' : '') + '">' + out.join('') + '</div>';
    }

    // ----- panel ARENAS: lista de salas / buscando -----
    function searchingHtml() {
        const p = S.party, leader = imLeader();
        const secs = Math.max(0, Math.round((Date.now() - (p.queuedAt || Date.now())) / 1000));
        return '<div class="sq find"><div class="sq-q" id="sqQ">' + (p.custom ? 'ROOM OPEN · WAITING FOR A RIVAL' : 'SEARCHING FOR A RIVAL') + ' · ' + secs + 's</div>' +
            groupHtml(false, p.size, true) +
            '<div class="sq-bot"><div class="sq-row"><button class="sq-b on" data-a="practice">' + (p.practice ? 'JOIN PRACTICE' : 'PLAY WHILE YOU WAIT') + '</button>' +
            (leader ? '<button class="sq-b" data-a="cancel">CANCEL</button>' : '') + '</div>' +
            '<div class="sq-note">' + (p.practice ? 'A practice room is open: jump in with your group.' : 'Practice against bots until a rival shows up.') + '</div>' + errLine() + '</div></div>';
    }
    function roomCard(r, mine) {
        const can = mine === r.size;
        return '<div class="sq-rm">' + pic({ p: r.leader.pic, av: r.leader.av, n: r.leader.name }) + '<div class="w"><div class="n">' + esc(r.leader.name) + '</div><div class="s">' + r.members.length + '/' + r.size + ' IN ROOM</div></div>' +
            '<button class="sq-b sm gold" data-join="' + esc(r.code) + '" data-size="' + r.size + '">JOIN</button></div>';
    }
    function roomsHtml() {
        const p = S.party;
        if (p && p.state === 'queued') return searchingHtml();
        if (p && p.state === 'match') return '<div class="sq find"><div class="sq-q">MATCH IN PROGRESS</div>' + groupHtml(false, p.size, true) + '<div class="sq-bot"></div></div>';
        const mine = groupSize();
        const cols = SIZES.map(n => {
            const live = S.rooms.filter(r => r.size === n);
            const cards = live.map(r => roomCard(r, mine));
            while (cards.length < SLOTS) cards.push('<div class="sq-rm empty" data-new="' + n + '"><div class="n">EMPTY ROOM</div><div class="s">- - - -</div></div>');
            return '<div class="sq-col' + (n === mine ? '' : ' dim') + '"><div class="sq-ch">' + n + 'V' + n + '</div><div class="sq-more">' + cards.join('') + '</div></div>';
        }).join('');
        const hint = S.party && mine > 1 ? 'YOUR GROUP · ' + mine + ' PLAYERS · ' + mine + 'V' + mine + ' ROOMS'
            : 'PLAYING SOLO · 1V1 ROOMS · FORM A GROUP IN FRIENDS FOR 2V2 / 3V3';
        return '<div class="sq"><div class="sq-row"><span class="sq-lab">' + hint + '</span></div>' +
            '<div class="sq-cols">' + cols + '</div>' +
            '<div class="sq-row"><button class="sq-b on" data-a="quick">QUICK MATCH · ' + mine + 'V' + mine + '</button></div>' + errLine() + '</div>';
    }

    // ----- panel AMIGOS: grupo, amigos y susurros -----
    function noAccount() {
        return '<div class="sq"><div class="sq-t">FRIENDS</div><div class="sq-p">' + (EN_APP
            ? 'Connect your wallet to get a friends list, invites and whispers. Your wallet is your account.'
            : 'Sign in with your wallet or your X account on the airdrop page to get a friends list, invites and whispers.') + '</div>' +
            '<div class="sq-row"><button class="sq-b on" data-a="login">' + (EN_APP ? 'CONNECT WALLET' : 'OPEN AIRDROP PAGE') + '</button><button class="sq-b" data-a="recheck">I DID IT</button></div></div>';
    }
    function friendsHtml() {
        if (S.x !== 'linked') return noAccount();
        const F = S.friends, p = S.party;
        const canInvite = !p || (p.state === 'idle' && p.members.length < p.max && imLeader());
        if (S.chatWith) {
            const f = F.friends.find(x => x.id === S.chatWith) || { u: '?', p: '', st: 'off', id: S.chatWith };
            const msgs = (S.chat[f.id] || []).map(m => '<div class="' + (m.me ? 'me' : '') + '"><b>' + (m.me ? 'YOU' : esc(nameOf(f))) + ':</b> ' + esc(m.text) + '</div>').join('') || '<div>Say hi to ' + esc(nameOf(f)) + '.</div>';
            return '<div class="sq"><div class="sq-row" style="justify-content:flex-start"><button class="sq-b sm" data-a="chatx">BACK</button>' + pic(f) + '<span style="font-size:.5em">' + esc(nameOf(f)) + '</span></div>' +
                '<div class="sq-chat" id="sqChat">' + msgs + '</div>' +
                '<div class="sq-row" style="flex-wrap:nowrap"><input class="sq-in" id="sqMsg" maxlength="200" placeholder="Whisper…" autocomplete="off"><button class="sq-b sm on" data-a="wsend">SEND</button></div>' + errLine() + '</div>';
        }
        // El grupo solo se enseña cuando de verdad hay alguien mas contigo.
        const grp = p && p.members.length >= 2
            ? '<div class="sq-h">YOUR GROUP · ' + p.members.length + '/' + p.max + '</div>' + groupHtml(true, p.members.length) + '<div class="sq-row"><button class="sq-b sm red" data-a="leave">LEAVE GROUP</button></div>'
            : '<div class="sq-note">Invite friends to play 2V2 or 3V3 together, then pick a room in ARENAS.</div>';
        const reqs = F.inReq.length ? '<div class="sq-h">REQUESTS</div><div class="sq-list">' + F.inReq.map(r => '<div class="sq-it">' + pic(r) + '<div class="w"><div class="n">' + esc(nameOf(r)) + '</div></div><div class="a"><button class="sq-b sm on" data-ac="' + r.id + '">ACCEPT</button><button class="sq-b sm" data-dc="' + r.id + '">NO</button></div></div>').join('') + '</div>' : '';
        const order = { on: 0, party: 1, game: 1, off: 2 };
        const list = F.friends.slice().sort((a, b) => order[a.st] - order[b.st] || nameOf(a).localeCompare(nameOf(b))).map(f =>
            '<div class="sq-it">' + pic(f) + '<div class="w"><div class="n">' + esc(nameOf(f)) + (S.unread[f.id] ? '<span class="sq-bd">' + S.unread[f.id] + '</span>' : '') + '</div><div class="s ' + f.st + '"><i></i>' + ST[f.st] + '</div></div>' +
            '<div class="a">' + (canInvite && f.st !== 'off' ? '<button class="sq-b sm on" data-inv="' + f.id + '">INVITE</button>' : '') + '<button class="sq-b sm" data-w="' + f.id + '"' + (f.st === 'off' ? ' disabled' : '') + '>WHISPER</button><button class="sq-b sm red" data-rm="' + f.id + '">X</button></div></div>').join('');
        return '<div class="sq">' + grp +
            '<div class="sq-row" style="flex-wrap:nowrap"><input class="sq-in" id="sqAdd" maxlength="48" placeholder="ADD: @X NAME, WALLET OR CODE" autocomplete="off"><button class="sq-b sm on" data-a="fadd">ADD</button></div>' +
            reqs + '<div class="sq-h">FRIENDS · ' + F.friends.filter(f => f.st !== 'off').length + ' ONLINE</div>' +
            '<div class="sq-list">' + (list || '<div class="sq-note" style="padding:.8em">No friends yet. Add someone by their @X name, wallet address or friend code (it is in your profile). They need to have opened Arenas or Friends once.</div>') + '</div>' +
            (F.outReq.length ? '<div class="sq-note">Pending: ' + F.outReq.map(r => esc(nameOf(r))).join(', ') + '</div>' : '') + errLine() + '</div>';
    }

    function paint(kind, html) {
        const box = S.box[kind]; if (!box) return;
        const add = box.querySelector('#sqAdd'), msg = box.querySelector('#sqMsg');
        const keep = add ? add.value : null, keepMsg = msg ? msg.value : null, focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
        box.innerHTML = html;
        if (keep != null && box.querySelector('#sqAdd')) box.querySelector('#sqAdd').value = keep;
        if (keepMsg != null && box.querySelector('#sqMsg')) box.querySelector('#sqMsg').value = keepMsg;
        if (focus && box.querySelector('#' + focus)) box.querySelector('#' + focus).focus();
        const c = box.querySelector('#sqChat'); if (c) c.scrollTop = c.scrollHeight;
        hydrate(box);
        wire(box);
    }
    function render() {
        if (S.box.rooms) paint('rooms', roomsHtml());
        if (S.box.friends) paint('friends', friendsHtml());
        try { if (window.PWSquadHooks) { if (PWSquadHooks.afterRender) PWSquadHooks.afterRender(); if (PWSquadHooks.badge) PWSquadHooks.badge(badgeCount()); } } catch (e) {}
    }
    function fail(msg) { S.err = msg; S.note = ''; render(); }
    function start(then) { connect(() => { if (!S.party) send({ a: 'create', name: myName() }); then(); }); }

    function wire(b) {
        b.querySelectorAll('[data-new]').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.new, have = groupSize();
            if (!imLeader()) return fail('Only your group leader can create rooms.');
            if (have !== n) return fail(have === 1 ? 'To play ' + n + 'V' + n + ' you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: pick a ' + have + 'V' + have + ' room.');
            start(() => send({ a: 'play', custom: true, size: n }));
        });
        b.querySelectorAll('[data-join]').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.size, have = groupSize();
            if (!imLeader()) return fail('Only your group leader can join rooms.');
            if (have !== n) return fail(have === 1 ? 'That is a ' + n + 'V' + n + ' room: you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: join a ' + have + 'V' + have + ' room.');
            start(() => send({ a: 'challenge', code: x.dataset.join }));
        });
        b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => send({ a: 'kick', id: x.dataset.k }));
        b.querySelectorAll('[data-ac]').forEach(x => x.onclick = () => send({ a: 'faccept', id: x.dataset.ac }));
        b.querySelectorAll('[data-dc]').forEach(x => x.onclick = () => send({ a: 'fdecline', id: x.dataset.dc }));
        b.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { if (x.dataset.sure === '1') send({ a: 'fremove', id: x.dataset.rm }); else { x.dataset.sure = '1'; x.textContent = 'SURE?'; setTimeout(() => { if (x.isConnected) { x.dataset.sure = ''; x.textContent = 'X'; } }, 2500); } });
        // Invitar sin grupo crea el grupo (el servidor atiende en orden: create y luego la invitacion).
        b.querySelectorAll('[data-inv]').forEach(x => x.onclick = () => { snd('simpleselect'); const id = x.dataset.inv; start(() => send({ a: 'pinvite', id })); });
        b.querySelectorAll('[data-w]').forEach(x => x.onclick = () => { S.chatWith = x.dataset.w; S.unread[x.dataset.w] = 0; render(); const i = b.querySelector('#sqMsg'); if (i) i.focus(); });
        const addIn = b.querySelector('#sqAdd');
        if (addIn) addIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="fadd"]').click(); };
        const msgIn = b.querySelector('#sqMsg');
        if (msgIn) msgIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="wsend"]').click(); };
        b.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
            const a = x.dataset.a; snd('simpleselect');
            if (a === 'quick') start(() => send({ a: 'play' }));
            else if (a === 'practice') send({ a: 'practice' });
            else if (a === 'cancel') send({ a: 'cancel' });
            else if (a === 'leave') { send({ a: 'leave' }); S.party = null; S.err = ''; render(); }
            else if (a === 'fadd') { const v = (b.querySelector('#sqAdd').value || '').trim(); if (v) { send({ a: 'fadd', u: v }); b.querySelector('#sqAdd').value = ''; S.note = 'Request sent!'; S.err = ''; } }
            else if (a === 'chatx') { S.chatWith = null; render(); }
            else if (a === 'wsend') { const i = b.querySelector('#sqMsg'), v = (i.value || '').trim(); if (v) { send({ a: 'whisper', id: S.chatWith, text: v }); i.value = ''; } }
            else if (a === 'login') login();
            else if (a === 'recheck') loadIdentity(true).then(() => { if (S.x === 'linked') { if (S.ws) { S.ws.close(); } connect(() => send({ a: 'friends' })); } else S.err = 'Not signed in yet.'; render(); });
        });
    }
    function login() {
        // App: el perfil del hub conecta la wallet. PC: la pagina del airdrop.
        if (EN_APP && typeof window._hubConnectX === 'function') { closeAll(); window._hubConnectX(); return; }
        window.open('/airdrop', '_blank');
    }
    // El contador de la busqueda se actualiza sin repintar todo.
    setInterval(() => {
        const q = document.getElementById('sqQ');
        if (q && S.party && S.party.queuedAt) q.textContent = (S.party.custom ? 'ROOM OPEN · WAITING FOR A RIVAL' : 'SEARCHING FOR A RIVAL') + ' · ' + Math.max(0, Math.round((Date.now() - S.party.queuedAt) / 1000)) + 's';
    }, 1000);

    // ---------------- montaje ----------------
    function pcPanel(kind) {
        if (S.pc[kind]) return S.pc[kind];
        const r = document.createElement('div'); r.className = 'sq-pcp'; r.id = 'sqPc' + (kind === 'friends' ? 'Fr' : '');
        r.innerHTML = '<div class="sq-box"><button class="sq-x">CLOSE</button><div class="sq-body"></div></div>';
        r.querySelector('.sq-x').onclick = () => r.classList.remove('open');
        r.addEventListener('click', e => { if (e.target === r) r.classList.remove('open'); });
        document.body.appendChild(r);
        S.pc[kind] = r; return r;
    }
    function isOpen(kind) {
        const hub = document.getElementById(kind === 'friends' ? 'ahFr' : 'ahAr');
        return !!((hub && hub.classList.contains('open')) || (S.pc[kind] && S.pc[kind].classList.contains('open')));
    }
    function closeAll() {
        for (const id of ['ahAr', 'ahFr']) { const e = document.getElementById(id); if (e) e.classList.remove('open'); }
        for (const k of Object.keys(S.pc)) S.pc[k].classList.remove('open');
        clearInterval(S.roomsTimer); S.roomsTimer = null;
    }
    function watchRooms() {
        clearInterval(S.roomsTimer);
        send({ a: 'rooms' });
        S.roomsTimer = setInterval(() => { if (isOpen('rooms') && !(S.party && S.party.state !== 'idle')) send({ a: 'rooms' }); }, 4000);
    }
    // La app monta cada panel dentro del suyo (el hub llama con su contenedor).
    function mountIn(kind, box) {
        S.box[kind] = box; S.err = ''; S.note = '';
        if (kind === 'friends') loadIdentity(true).then(() => { connect(() => send({ a: 'friends' })); render(); });
        else connect(watchRooms);
        render();
    }
    function openPc(kind) {
        closePcBackdrops();
        const r = pcPanel(kind); r.classList.add('open');
        S.box[kind] = r.querySelector('.sq-body'); S.err = ''; S.note = '';
        try { closePlayChoice(); } catch (e) {}
        if (kind === 'friends') loadIdentity(true).then(() => { connect(() => send({ a: 'friends' })); render(); });
        else connect(watchRooms);
        render();
    }
    function closePcBackdrops() { for (const k of Object.keys(S.pc)) S.pc[k].classList.remove('open'); }
    function open() { if (EN_APP && document.getElementById('ahAr')) return; openPc('rooms'); }
    function openFriends() {
        if (EN_APP && document.getElementById('ahFr')) { const b = document.querySelector('#appHub [data-a="friends"]'); if (b) b.click(); } else openPc('friends');
    }
    // Conexion en segundo plano: con cuenta se reciben invitaciones y susurros aunque el panel este cerrado.
    async function boot() {
        await loadIdentity(true);
        if (S.x === 'linked' && !(S.ws && S.ws.readyState === 1)) connect();
    }
    function joinFromLink() {
        const c = new URLSearchParams(location.search).get('party');
        if (!c || !/^[A-Za-z0-9]{5}$/.test(c)) { setTimeout(boot, 2500); return; }
        setTimeout(() => joinCode(c.toUpperCase()), 1200);
    }
    window.PWSquad = { open, openFriends, mountIn, onRoster, onEnd, boot, refreshAv, state: S };
    // Para el render: 'ally' (companero, aro azul), 'foe' (rival real, aro rojo) o null.
    window.pwSquadRel = id => (S.rel ? S.rel.get(id) || null : null);
    if (document.readyState === 'complete') joinFromLink(); else addEventListener('load', joinFromLink);
})();
