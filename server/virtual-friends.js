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
            else if (seenHuman || Date.now() - t0 > 30000) return stop(true);
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
        lider.rival = { resto, n, buscando: false, reta: m.custom ? m.code : null, vs: m.custom ? null : m.code, mode: m.mode };   // sala abierta (custom): la retan; si no, buscan partida
        say(lider, { a: 'leave' }); say(lider, { a: 'create' });
    }
    function react(ws, f, m) {
        if (m.t === 'sqParty' && ws.rival && m.leader === m.me && !ws.rival.buscando) {
            // el lider rival ya tiene su grupo: los demas entran y, con todos dentro, se pone a buscar
            const r = ws.rival;
            if (m.members.length < r.n) { if (!r.llamados) { r.llamados = true; setTimeout(() => r.resto.forEach(w => say(w, { a: 'join', code: m.code })), 300); } }
            else if (m.state === 'idle') { r.buscando = true; setTimeout(() => { say(ws, r.reta ? { a: 'challenge', code: r.reta, mode: r.mode } : { a: 'play', mode: r.mode, vs: r.vs }); ws.rival = null; }, 500); }
            return;
        }
        if (m.t === 'sqParty' && m.state === 'queued' && m.leader !== m.me) armaRival(m);
        if (m.t === 'sqFriendReq') setTimeout(() => say(ws, { a: 'faccept', id: m.from.id }), 400);
        else if (m.t === 'sqWhisper' && !m.mine) {
            // Susurrale "lead" y hace de lider: crea el grupo, te invita y, en cuanto entras, lanza el LISTO (para probar el cartel de companero).
            if (/^\s*lead\s*$/i.test(m.text)) {
                f.leadFor = m.from.id;
                setTimeout(() => { say(ws, { a: 'leave' }); say(ws, { a: 'create' }); say(ws, { a: 'pinvite', id: m.from.id }); say(ws, { a: 'whisper', id: m.from.id, text: LEAD_TXT }); }, 500);
            } else setTimeout(() => say(ws, { a: 'whisper', id: m.from.id, text: rnd(REPLIES) }), 900);
        }
        else if (m.t === 'sqParty' && f.leadFor && m.leader === m.me && m.state === 'idle' && !m.rc && m.members.length >= 2 && !f.leadBusy) {
            f.leadBusy = true;
            setTimeout(() => { f.leadBusy = false; say(ws, { a: 'play', custom: true }); }, 3500);
        }
        else if (m.t === 'sqInvite') setTimeout(() => say(ws, { a: 'join', code: m.code, name: f.u }), 500);
        else if (m.t === 'sqTicket') setTimeout(() => play(f, m), 350);
        else if (m.t === 'sqReadyCheck') setTimeout(() => say(ws, { a: 'ready', v: true }), m.remind ? 500 : READY_MS);
    }

    for (const f of FRIENDS) {
        const ws = { readyState: 1, virtual: true, send(raw) { let m; try { m = JSON.parse(raw); } catch (e) { return; } react(ws, f, m); }, close() {} };
        social.hello(ws, token.sign({ id: f.id, u: f.u, n: f.u, p: '', w: '' }), f.av, f.u);   // su nombre en la pildora: icefox, rcer... (sin @)
        ws.fid = f.id; lobby.push(ws);
    }
    return { lobby, ids: FRIENDS.map(f => f.id), onQueued: v => { if (v.state === 'queued') armaRival(v); } };
}

module.exports = { createVirtualFriends };
