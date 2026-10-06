'use strict';
/*
 * Amigos de PRUEBA: @icefox y @bandit.
 *
 * Existen desde que arranca el servidor pero no salen en ninguna lista: aparecen al
 * buscarlos por su nombre (@icefox). Entonces:
 *   - aceptan tu peticion de amistad al momento y salen siempre conectados,
 *   - contestan a los susurros,
 *   - si los invitas a un grupo, entran,
 *   - y juegan: entran a la practica o a la partida con su ticket y se mueven por el mapa,
 *     para poder ver los colores, los aros de companero/rival y como se juega en 2v2 y 3v3.
 *
 * Cuando tu grupo con alguno de ellos se pone a buscar rival, los que quedan libres forman el grupo rival y tambien
 * buscan, para poder probar el VS (1v1 y 2v2; en 3v3 no hay bots de sobra).
 * No son jugadores reales ni rellenan salas por su cuenta: solo actuan por tu invitacion. Se
 * quitan solos de la sala cuando ya no queda ningun humano dentro.
 *
 * Por dentro son sockets falsos (sin red): uno para el lobby y otro por cada sala. El de sala
 * lleva bufferedAmount infinito para que el servidor no gaste en prepararles snapshots.
 */
const token = require('./social-token.js');

const FRIENDS = [
    { id: 'TESTICE', u: 'icefox', av: { t: 'pill', bg: '#1e6bff', top: '#e8f6ff', bot: '#3aa7ff' }, top: '#e8f6ff', bot: '#3aa7ff' },
    { id: 'TESTBAN', u: 'bandit', av: { t: 'bag', bg: '#ff2a55' }, top: '#2b2b2b', bot: '#ff2a55' },
    { id: 'TESTRCE', u: 'rcer', av: { t: 'spook', bg: '#ffb347' }, top: '#fff3d6', bot: '#ffb347' },
];
// Jugadores de prueba "random" (solo en devnet, con salas de pago): buscan partida solos, en duo o en trio, cada grupo
// a un precio distinto para que no se emparejen entre ellos. Salen en FIND RIVALS y se les puede retar en 1v1, 2v2 y 3v3.
const RANDOS = [
    ['TESTR01', 'pixelpete', '#7cff6b'], ['TESTR02', 'nyx', '#b86bff'], ['TESTR03', 'grumpy', '#ff8a3d'], ['TESTR04', 'lunar', '#9cc4ff'],
    ['TESTR05', 'vortex', '#2ee6d6'], ['TESTR06', 'mochi', '#ff5fd2'], ['TESTR07', 'zed', '#ffd23a'], ['TESTR08', 'kira', '#ff4d6d'],
    ['TESTR09', 'bolt', '#ccff00'], ['TESTR10', 'echo', '#e8e8e8'],
].map(([id, u, c]) => ({ id, u, av: { t: 'pill', bg: '#14181a', top: '#ffffff', bot: c }, top: '#ffffff', bot: c }));
// [indices en RANDOS, precio en $]
const GRUPOS_RANDOS = [[[0], 0], [[1], 3], [[2], 10], [[3, 4], 0], [[5, 6], 2], [[7, 8, 9], 1]];
const LEAD_TXT = "OK! I'll lead. Join my group and I'll start a ready check in a few seconds.";
const REPLIES = [
    "hey! I'm a test friend. Invite me to a group and press play.",
    'ready when you are. 2v2? 3v3?',
    "I can't type much, but I can play. Invite me!",
];
const TICK_MS = 250;
const rnd = a => a[Math.floor(Math.random() * a.length)];

function createVirtualFriends(ctx) {
    const { social, handle, join, rooms, handleInput, log } = ctx;
    const READY_MS = ctx.readyMs == null ? 4500 : ctx.readyMs;   // lo que tardan en dar LISTO; con READY ALL contestan casi al momento
    const lobby = [];
    const bots = FRIENDS.map(f => Object.assign({}, f));   // estado propio de esta instancia (leadFor...)

    function say(ws, o) { handle(ws, Object.assign({ t: 'sq' }, o)); }

    function play(f, tk) {
        const gws = { readyState: 1, bufferedAmount: Infinity, virtualGame: true, send() {}, close() { this.readyState = 3; } };
        const res = join(gws, '0.0.0.0', { t: 'join', squad: tk.ticket, bin: 0, aspect: 1.7, colorTop: f.top, colorBot: f.bot });
        if (!res) return;
        const { room, playerId } = res;
        let aliados = null, seenHuman = false;
        const t0 = Date.now();
        const stop = clean => {
            clearInterval(iv);
            if (clean && room.clients.has(playerId)) { room.clients.delete(playerId); room.sim.removePlayer(playerId); }
        };
        const iv = setInterval(() => {
            const cli = room.clients.get(playerId);
            if (!cli || !rooms.has(room.key) || room.state === 'ended') return stop(false);
            // Sin ningun humano dentro no hace falta que sigan jugando solos. El humano tarda en entrar (cuenta
            // atras, carga): hasta que lo vean una vez, o pasen 30 s, esperan.
            const humans = [...room.clients.values()].some(c => !c.ws.virtualGame);
            if (humans) seenHuman = true;
            else if (!(room.squad && !room.squad.practice) && (seenHuman || Date.now() - t0 > 30000)) return stop(true);   // en la practica se van; en una partida de verdad siguen (puedes volver con REJOIN)
            if (room.state === 'playing' && !cli._spawned) { handleInput(room, playerId, { t: 'ready' }); return; }
            const p = room.sim.players.get(playerId), c = p && p.alive && p.cells[0];
            if (!c) return;
            // Misma IA que los bots del sim (huir de los grandes, cazar a los pequenos, ir a comer), sin hacer dano a su equipo.
            if (!aliados) aliados = new Set(room.squad.teams[cli.team] || [playerId]);
            c.changeDirTimer = Math.min(c.changeDirTimer, 2);   // la IA de los bots corre a 60 Hz y esta a 4: se re-apunta antes
            c.botSteer(room.sim, [c], aliados);
            handleInput(room, playerId, { t: 'input', tx: c.targetX, ty: c.targetY });
        }, TICK_MS);
        if (iv.unref) iv.unref();
        log(`Amigo de prueba @${f.u} entra a ${room.key}`);
    }

    // Rival de prueba: los amigos libres crean un grupo del mismo tamano y buscan partida.
    const rivalDe = new Set();
    function armaRival(m) {
        if (!ctx.rivals || rivalDe.has(m.code) || !m.members) return;
        const dentro = new Set(m.members.map(x => x.uid));
        const jefe = m.members.find(x => x.id === m.leader);
        if (!jefe || FRIENDS.some(x => x.id === jefe.uid)) return;  // el grupo lo lleva un bot: es un rival, no el tuyo
        // Hace falta un bot en tu grupo, o (yendo solo) tener a alguno de amigo: a los demas jugadores no les salen rivales de prueba.
        const amigos = (((social._data().rel || {})[jefe.uid] || {}).f) || [];
        if (!m.members.some(x => FRIENDS.some(b => b.id === x.uid)) && !amigos.some(id => FRIENDS.some(b => b.id === id))) return;
        const libres = lobby.filter(w => !dentro.has(w.fid));
        const n = m.size || m.members.length;
        if (libres.length < n) return;
        rivalDe.add(m.code); setTimeout(() => rivalDe.delete(m.code), 120000);
        const [lider, ...resto] = libres.slice(0, n);
        lider.rival = { resto, n, buscando: false, reta: m.custom ? m.code : null, vs: m.custom ? null : m.code, mode: m.mode, price: (m.cents | 0) / 100 };   // sala abierta (custom): la retan; si no, buscan partida (al mismo precio)
        say(lider, { a: 'leave' }); say(lider, { a: 'create' });
    }
    function react(ws, f, m) {
        if (m.t === 'sqParty') { if (!ws.p || ws.p.state !== m.state || ws.p.code !== m.code) ws.since = Date.now(); ws.p = m; }
        else if (m.t === 'sqGone') { ws.p = null; ws.since = Date.now(); }
        if (m.t === 'sqParty' && ws.rival && m.leader === m.me && !ws.rival.buscando) {
            // el lider rival ya tiene su grupo: los demas entran y, con todos dentro, se pone a buscar
            const r = ws.rival;
            if (m.members.length < r.n) { if (!r.llamados) { r.llamados = true; setTimeout(() => r.resto.forEach(w => say(w, { a: 'join', code: m.code })), 300); } }
            else if (m.state === 'idle') { r.buscando = true; setTimeout(() => { say(ws, r.reta ? { a: 'challenge', code: r.reta, mode: r.mode } : { a: 'play', mode: r.mode, vs: r.vs, price: r.price }); ws.rival = null; }, 500); }
            return;
        }
        if (m.t === 'sqParty' && m.state === 'queued' && m.leader !== m.me) armaRival(m);
        if (m.t === 'sqFriendReq') setTimeout(() => say(ws, { a: 'faccept', id: m.from.id }), 400);
        else if (m.t === 'sqWhisper' && !m.mine) {
            // Susurrale "lead" y hace de lider: crea el grupo, te invita y, en cuanto entras, lanza el LISTO (para probar el cartel de companero).
            if (/^\s*lead\s*$/i.test(m.text)) {
                f.leadFor = m.from.id; f.leadAt = Date.now();
                setTimeout(() => { say(ws, { a: 'leave' }); say(ws, { a: 'create' }); say(ws, { a: 'pinvite', id: m.from.id }); say(ws, { a: 'whisper', id: m.from.id, text: LEAD_TXT }); }, 500);
            } else setTimeout(() => say(ws, { a: 'whisper', id: m.from.id, text: rnd(REPLIES) }), 900);
        }
        else if (m.t === 'sqParty' && f.leadFor && m.leader === m.me && m.state === 'idle' && !m.rc && m.members.length >= 2 && !f.leadBusy) {
            f.leadBusy = true;
            setTimeout(() => { f.leadBusy = false; say(ws, { a: 'play', custom: true }); }, 3500);
        }
        else if (m.t === 'sqInvite') setTimeout(() => { say(ws, { a: 'leave' }); say(ws, { a: 'join', code: m.code, name: f.u }); }, 500);
        else if (m.t === 'sqTicket') setTimeout(() => play(f, m), 350);
        else if (m.t === 'sqReadyCheck') setTimeout(() => say(ws, { a: 'ready', v: true }), m.remind ? 500 : READY_MS);
    }

    // Libres, cada bot busca un 1v1 a su precio ($1, $2 y $5, solo en devnet): salen en FIND RIVALS y se les puede retar.
    const PRECIOS = [1, 2, 5];
    const randos = [];
    // Un grupo de bots en cola: el primero lo crea, los demas entran con el codigo y, completo, busca a su precio.
    function enCola(lider, f, resto, price) {
        const p = lider.p;
        if (lider.rival || (f.leadFor && Date.now() - f.leadAt < 120000) || Date.now() - (lider.since || 0) < 2500) return;   // haciendo de lider para alguien: 2 min fuera de la cola
        if (!p) { say(lider, { a: 'create' }); return; }
        if (p.leader !== p.me || p.state !== 'idle' || p.rc || p.cm) return;
        const libre = w => !w.p || (w.p.members.length === 1 && w.p.state === 'idle' && !w.p.rc);
        for (const w of resto) if (!(w.p && w.p.code === p.code) && libre(w) && !w.rival) { if (w.p) say(w, { a: 'leave' }); say(w, { a: 'join', code: p.code }); }
        if (p.members.length === resto.length + 1) say(lider, { a: 'play', mode: 'arcade', price });
    }
    if (ctx.queue && ctx.paid) {   // sin pago (mainnet) no: gratis se emparejarian entre ellos
        const cola = setInterval(() => {
            lobby.forEach((ws, i) => enCola(ws, bots[i], [], PRECIOS[i]));
            for (const [idx, price] of GRUPOS_RANDOS) enCola(randos[idx[0]], RANDOS_F[idx[0]], idx.slice(1).map(k => randos[k]), price);
        }, 3000);
        if (cola.unref) cola.unref();
    }
    const RANDOS_F = RANDOS.map(f => Object.assign({}, f));
    if (ctx.queue && ctx.paid) for (const f of RANDOS_F) {
        const ws = { readyState: 1, virtual: true, send(raw) { let m; try { m = JSON.parse(raw); } catch (e) { return; } react(ws, f, m); }, close() {} };
        social.hello(ws, token.sign({ id: f.id, u: f.u, n: f.u, p: '', w: '' }), f.av, f.u);
        ws.fid = f.id; randos.push(ws);
    }
    for (const f of bots) {
        const ws = { readyState: 1, virtual: true, send(raw) { let m; try { m = JSON.parse(raw); } catch (e) { return; } react(ws, f, m); }, close() {} };
        social.hello(ws, token.sign({ id: f.id, u: f.u, n: f.u, p: '', w: '' }), f.av, f.u);   // su nombre en la pildora: icefox, rcer... (sin @)
        ws.fid = f.id; lobby.push(ws);
    }
    return { lobby, ids: FRIENDS.map(f => f.id), onQueued: v => { if (v.state === 'queued') armaRival(v); } };
}

module.exports = { createVirtualFriends };
