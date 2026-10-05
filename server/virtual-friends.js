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
];
const REPLIES = [
    "hey! I'm a test friend. Invite me to a group and press play.",
    'ready when you are. 2v2? 3v3?',
    "I can't type much, but I can play. Invite me!",
];
const TICK_MS = 250;
const rnd = a => a[Math.floor(Math.random() * a.length)];

function createVirtualFriends(ctx) {
    const { social, handle, join, rooms, handleInput, log } = ctx;
    const lobby = [];

    function say(ws, o) { handle(ws, Object.assign({ t: 'sq' }, o)); }

    function play(f, tk) {
        const gws = { readyState: 1, bufferedAmount: Infinity, virtualGame: true, send() {}, close() { this.readyState = 3; } };
        const res = join(gws, '0.0.0.0', { t: 'join', squad: tk.ticket, bin: 0, aspect: 1.7, colorTop: f.top, colorBot: f.bot });
        if (!res) return;
        const { room, playerId } = res;
        let tx = 0, ty = 0, until = 0, seenHuman = false;
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
            const now = Date.now(), lim = room.sim.mapSize - 200;
            // Huyen de lo que se los puede comer (bots mas grandes cerca); si no, pasean por el mapa.
            let amenaza = null, dMin = 700;
            for (const e of room.sim.enemies) {
                if (!(e.r > c.r * 1.1)) continue;
                const d = Math.hypot(e.x - c.x, e.y - c.y);
                if (d < dMin) { dMin = d; amenaza = e; }
            }
            if (amenaza) {
                tx = Math.max(-lim, Math.min(lim, c.x + (c.x - amenaza.x) * 3));
                ty = Math.max(-lim, Math.min(lim, c.y + (c.y - amenaza.y) * 3));
                until = now + 500;
            } else if (now > until) {
                tx = Math.max(-lim, Math.min(lim, c.x + (Math.random() * 2 - 1) * 900));
                ty = Math.max(-lim, Math.min(lim, c.y + (Math.random() * 2 - 1) * 900));
                until = now + 1500 + Math.random() * 2000;
            }
            handleInput(room, playerId, { t: 'input', tx, ty });
        }, TICK_MS);
        if (iv.unref) iv.unref();
        log(`Amigo de prueba @${f.u} entra a ${room.key}`);
    }

    function react(ws, f, m) {
        if (m.t === 'sqFriendReq') setTimeout(() => say(ws, { a: 'faccept', id: m.from.id }), 400);
        else if (m.t === 'sqWhisper' && !m.mine) setTimeout(() => say(ws, { a: 'whisper', id: m.from.id, text: rnd(REPLIES) }), 900);
        else if (m.t === 'sqInvite') setTimeout(() => say(ws, { a: 'join', code: m.code, name: f.u }), 500);
        else if (m.t === 'sqTicket') setTimeout(() => play(f, m), 350);
        else if (m.t === 'sqReadyCheck') setTimeout(() => say(ws, { a: 'ready', v: true }), 700);
    }

    for (const f of FRIENDS) {
        const ws = { readyState: 1, virtual: true, send(raw) { let m; try { m = JSON.parse(raw); } catch (e) { return; } react(ws, f, m); }, close() {} };
        social.hello(ws, token.sign({ id: f.id, u: f.u, n: f.u, p: '', w: '' }), f.av);
        lobby.push(ws);
    }
    return { lobby, ids: FRIENDS.map(f => f.id) };
}

module.exports = { createVirtualFriends };
