'use strict';
/*
 * Amigos, presencia, invitaciones de grupo y susurros.
 *
 * Vive junto a los grupos (server/squad.js) en el mismo proceso y comparte sus
 * sockets. La identidad es la cuenta de X vinculada, que llega en una ficha firmada
 * (server/social-token.js): el id publico es el codigo de invitacion de la cuenta.
 * Quien solo tiene wallet y no ha vinculado X no tiene identidad social todavia.
 *
 * Persistente: perfiles y amistades (social.json). Efimero: quien esta conectado,
 * invitaciones y susurros (no se guardan mensajes: si el amigo no esta, no llega).
 *
 * Mensajes cliente -> server (t:'sq'): hello{token}, friends, fadd{id|u}, faccept{id},
 *   fdecline{id}, fremove{id}, pinvite{id}, whisper{id,text}
 * Server -> cliente: sqMe, sqFriends, sqPresence, sqFriendReq, sqInvite, sqWhisper, sqErr
 */
const fs = require('fs');
const path = require('path');
const token = require('./social-token.js');

const MAX_FRIENDS = 100;
const MAX_REQS = 50;
const WHISPER_MAX = 200;
const WHISPER_PER_MIN = 20;
const INVITE_GAP_MS = 8000;
const SAVE_MS = 2000;

function createSocial(opts) {
    const file = opts.file || null;
    const log = opts.log || (() => {});
    const partyInfoOf = opts.partyInfoOf || (() => null);   // (id) -> { state, code, size, full } | null
    const now = opts.now || Date.now;
    const directory = opts.directory || null;   // (q) -> perfil del airdrop o null: encuentra a quien aun no ha abierto Arenas

    let data = { profiles: {}, rel: {} };     // profiles[id] = {u,n,p}; rel[id] = { f:[], i:[], o:[] }
    if (file) { try { data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') log('[social] no se pudo leer ' + file + ': ' + e.message); } }
    const online = new Map();                 // id -> Set<ws>
    const byUsername = new Map();             // usuario de X en minusculas -> id
    const byWallet = new Map();               // wallet (distingue mayusculas) -> id
    for (const [id, p] of Object.entries(data.profiles)) { if (p.u) byUsername.set(String(p.u).toLowerCase(), id); if (p.w) byWallet.set(p.w, id); }

    if (file) log('[social] ' + Object.keys(data.profiles).length + ' perfiles y ' + Object.keys(data.rel).length + ' cuentas con amigos cargados de ' + path.basename(file));
    let timer = null;
    function save() {
        if (!file || timer) return;
        timer = setTimeout(flush, SAVE_MS); if (timer.unref) timer.unref();
    }
    function flush() {
        clearTimeout(timer); timer = null;
        if (!file) return;
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); } catch (e) { log('[social] no se pudo guardar: ' + e.message); }
    }

    const send = (ws, o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} };
    const sendTo = (id, o) => { const s = online.get(id); if (s) for (const ws of s) send(ws, o); };
    const err = (ws, reason) => send(ws, { t: 'sqErr', reason });
    const relOf = id => data.rel[id] || (data.rel[id] = { f: [], i: [], o: [] });
    const profileOf = id => data.profiles[id] ? Object.assign({ id }, data.profiles[id]) : null;
    // El nombre que ve la gente es el que el jugador eligio en el menu (dn); si no puso ninguno, su @ de X, y si no, el resumen de su wallet.
    // np: el jugador eligio su propio icono en el perfil; entonces su foto de X no sale (sale el icono elegido).
    // hx: HIDE X ACCOUNT en el perfil; en las partidas sale el nombre de la pildora en vez de su @ (y sin su foto de X).
    const pub = id => { const p = data.profiles[id] || {}; return { id, u: p.u || '', n: p.n || p.u || 'PLAYER', dn: p.dn || '', p: p.np ? '' : (p.p || ''), av: p.av || null, hx: !!p.hx }; };

    function statusOf(id) {
        if (!online.has(id)) return 'off';
        const pi = partyInfoOf(id);
        if (pi && pi.state === 'match') return 'game';
        if (pi && pi.state === 'queued') return 'wait';
        if (pi) return 'party';
        return 'on';
    }
    // q: si busca partida (LISTO), en que tamano y precio (centimos): sus amigos pueden ir a por el.
    const queueOf = id => { const pi = online.has(id) ? partyInfoOf(id) : null; return pi && pi.state === 'queued' && pi.q ? pi.q : null; };
    const row = id => { const q = queueOf(id); return Object.assign(pub(id), { st: statusOf(id) }, q ? { q } : {}); };

    function pushFriends(id) {
        const r = relOf(id);
        sendTo(id, { t: 'sqFriends', friends: r.f.map(row), inReq: r.i.map(row), outReq: r.o.map(row) });
    }
    // Avisa a los amigos conectados de que cambio el estado de `id`.
    function pushPresence(id) {
        const st = statusOf(id);
        const q = queueOf(id);
        for (const f of relOf(id).f) sendTo(f, q ? { t: 'sqPresence', id, st, q } : { t: 'sqPresence', id, st });
    }

    // El avatar del jugador (icono del menu) que ven sus amigos cuando no tiene foto de X. Solo valores simples.
    const HEX = /^#[0-9a-fA-F]{6}$/;
    function cleanAv(a) {
        if (!a || typeof a !== 'object' || !['pill', 'spook', 'bag', 'npc'].includes(a.t)) return null;
        const o = { t: a.t, bg: HEX.test(a.bg) ? a.bg : '#8a948f' };
        if (HEX.test(a.top)) o.top = a.top;
        if (HEX.test(a.bot)) o.bot = a.bot;
        if (typeof a.skin === 'string' && /^[\w-]{1,24}$/.test(a.skin)) o.skin = a.skin;
        return o;
    }
    function cleanDn(s) {
        const n = String(s == null ? '' : s).replace(/[^\w .\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
        return n && n.toUpperCase() !== 'PLAYER' ? n : '';
    }
    function hello(ws, tk, av, name, noPic, hideX) {
        const prof = token.verify(tk);
        if (!prof) { err(ws, 'bad_token'); return null; }
        const old = data.profiles[prof.id];
        const cav = cleanAv(av) || (old && old.av) || null;
        const dn = name === undefined ? (old && old.dn) || '' : cleanDn(name);
        const np = noPic === undefined ? !!(old && old.np) : !!noPic;
        const hx = hideX === undefined ? !!(old && old.hx) : !!hideX;
        if (!old || old.u !== prof.u || old.n !== prof.n || old.p !== prof.p || (old.w || '') !== prof.w || (old.dn || '') !== dn || !!old.np !== np || !!old.hx !== hx || JSON.stringify(old.av || null) !== JSON.stringify(cav)) { data.profiles[prof.id] = { u: prof.u, n: prof.n, p: prof.p, w: prof.w, av: cav, dn, np, hx }; save(); }
        if (prof.u) byUsername.set(String(prof.u).toLowerCase(), prof.id);
        if (prof.w) byWallet.set(prof.w, prof.id);
        if (ws.pwId && ws.pwId !== prof.id) detach(ws);
        ws.pwId = prof.id;
        let set = online.get(prof.id); if (!set) online.set(prof.id, set = new Set());
        const first = set.size === 0;
        set.add(ws);
        send(ws, { t: 'sqMe', me: pub(prof.id) });
        pushFriends(prof.id);
        if (first) pushPresence(prof.id);
        return prof.id;
    }
    function detach(ws) {
        const id = ws.pwId; if (!id) return;
        const set = online.get(id);
        if (set) { set.delete(ws); if (!set.size) { online.delete(id); pushPresence(id); } }
        ws.pwId = null;
    }
    function onClose(ws) { detach(ws); }

    // ---- amigos ----
    function add(ws, me, msg) {
        let target = msg.id ? String(msg.id) : null;
        // Por usuario de X (@nombre) o por la direccion de la wallet.
        // Por usuario de X (@nombre), direccion de wallet o codigo de amigo (el que sale en el perfil).
        if (!target && msg.u) {
            const q = String(msg.u).trim();
            target = byWallet.get(q) || byUsername.get(q.replace(/^@/, '').toLowerCase()) || (data.profiles[q] ? q : null) || (data.profiles[q.toLowerCase()] ? q.toLowerCase() : null);
            // Gente del airdrop que aun no ha abierto Arenas: se aprende su perfil y la peticion espera a que entre.
            if (!target && directory) {
                let f = null; try { f = directory(q); } catch (e) {}
                const clean = f && token.verify(token.sign(f));   // pasa por el mismo saneado que la ficha (foto solo de X, wallet valida)
                if (clean) {
                    if (!data.profiles[clean.id]) data.profiles[clean.id] = { u: clean.u, n: clean.n, p: clean.p, w: clean.w, av: null };
                    if (clean.u) byUsername.set(String(clean.u).toLowerCase(), clean.id);
                    if (clean.w) byWallet.set(clean.w, clean.id);
                    target = clean.id;
                }
            }
        }
        if (!target || !data.profiles[target]) return err(ws, 'no_such_user');
        if (target === me) return err(ws, 'self');
        const a = relOf(me), b = relOf(target);
        if (a.f.includes(target)) return err(ws, 'already_friends');
        if (a.f.length >= MAX_FRIENDS || b.f.length >= MAX_FRIENDS) return err(ws, 'friends_full');
        if (a.i.includes(target)) return accept(ws, me, { id: target });   // el otro ya te habia pedido: se aceptan
        if (a.o.includes(target)) return err(ws, 'already_requested');
        if (b.i.length >= MAX_REQS) return err(ws, 'requests_full');
        a.o.push(target); b.i.push(me);
        save();
        pushFriends(me); pushFriends(target);
        sendTo(target, { t: 'sqFriendReq', from: pub(me) });
    }
    function accept(ws, me, msg) {
        const other = String(msg.id || '');
        const a = relOf(me), b = relOf(other);
        if (!a.i.includes(other)) return err(ws, 'no_request');
        a.i = a.i.filter(x => x !== other); b.o = b.o.filter(x => x !== me);
        if (!a.f.includes(other)) a.f.push(other);
        if (!b.f.includes(me)) b.f.push(me);
        save();
        pushFriends(me); pushFriends(other);
    }
    function decline(ws, me, msg) {
        const other = String(msg.id || '');
        const a = relOf(me), b = relOf(other);
        a.i = a.i.filter(x => x !== other); b.o = b.o.filter(x => x !== me);
        save(); pushFriends(me); pushFriends(other);
    }
    function remove(ws, me, msg) {
        const other = String(msg.id || '');
        const a = relOf(me), b = relOf(other);
        a.f = a.f.filter(x => x !== other); b.f = b.f.filter(x => x !== me);
        a.o = a.o.filter(x => x !== other); b.i = b.i.filter(x => x !== me);
        save(); pushFriends(me); pushFriends(other);
    }

    // ---- invitaciones y susurros ----
    const lastInvite = new Map();   // "de>a" -> ts
    function invite(ws, me, msg) {
        const to = String(msg.id || '');
        if (!relOf(me).f.includes(to)) return err(ws, 'not_friends');
        const pi = partyInfoOf(me);
        // Se puede invitar aunque el grupo este buscando partida (si aceptan, la busqueda se cancela); no en plena partida.
        if (!pi) return err(ws, 'no_open_party');
        if (pi.state === 'match') return err(ws, 'party_busy');
        if (pi.full) return err(ws, 'party_full');
        if (!online.has(to)) return err(ws, 'offline');
        const k = me + '>' + to, t = now();
        if (t - (lastInvite.get(k) || 0) < INVITE_GAP_MS) return err(ws, 'slow_down');
        lastInvite.set(k, t);
        if (lastInvite.size > 5000) lastInvite.clear();
        sendTo(to, { t: 'sqInvite', from: pub(me), code: pi.code, size: pi.size });
        send(ws, { t: 'sqInvited', id: to });
    }
    const whisperHits = new Map();   // id -> [ts]
    function whisper(ws, me, msg) {
        const to = String(msg.id || '');
        if (!relOf(me).f.includes(to)) return err(ws, 'not_friends');
        const text = String(msg.text == null ? '' : msg.text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, WHISPER_MAX);
        if (!text) return;
        const t = now(), hits = (whisperHits.get(me) || []).filter(x => t - x < 60000);
        if (hits.length >= WHISPER_PER_MIN) return err(ws, 'slow_down');
        hits.push(t); whisperHits.set(me, hits);
        if (!online.has(to)) return err(ws, 'offline');
        const m = { t: 'sqWhisper', from: pub(me), to: pub(to), text, ts: t };
        sendTo(to, m); sendTo(me, Object.assign({ mine: true }, m));
    }

    // Devuelve true si el mensaje era del servicio social (y ya esta atendido).
    function handle(ws, msg) {
        const a = String(msg.a || '');
        if (a === 'hello') { hello(ws, msg.token, msg.av, msg.name, msg.noPic, msg.hx); return true; }
        if (!['friends', 'fadd', 'faccept', 'fdecline', 'fremove', 'pinvite', 'whisper'].includes(a)) return false;
        const me = ws.pwId;
        if (!me) { err(ws, 'need_x'); return true; }
        if (a === 'friends') pushFriends(me);
        else if (a === 'fadd') add(ws, me, msg);
        else if (a === 'faccept') accept(ws, me, msg);
        else if (a === 'fdecline') decline(ws, me, msg);
        else if (a === 'fremove') remove(ws, me, msg);
        else if (a === 'pinvite') invite(ws, me, msg);
        else if (a === 'whisper') whisper(ws, me, msg);
        return true;
    }

    // Al parar el servidor (actualizar/reiniciar) se vuelca lo pendiente: el guardado va con 2 s de retraso y un reinicio rapido lo perdia.
    if (file) for (const sig of ['SIGTERM', 'SIGINT', 'beforeExit']) process.once(sig, () => { try { if (timer) flush(); } catch (e) {} });
    return { handle, hello, onClose, pushPresence, pub, isOnline: id => online.has(id), flush, _data: () => data };
}

module.exports = { createSocial };
