'use strict';
/*
 * Lo que debe verse igual en todos los dispositivos de una cuenta (X o wallet firmada):
 *   - la foto de perfil (avatar): gana la mas reciente,
 *   - las misiones de la app de HOY: el progreso mas alto de cada una, las hechas y las cobradas de los dos lados juntas,
 *     y las marcadas para verlas en partida: las del dispositivo que las toco mas tarde.
 * El cliente cuenta y manda; el servidor solo guarda y mezcla. No concede nada: los SP se siguen pagando en appquests.js.
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'accountsync.json');
const ID = /^[a-z0-9-]{1,40}$/i;

function create(opts) {
    const file = opts && opts.file !== undefined ? opts.file : FILE;
    const now = (opts && opts.now) || (() => Date.now());
    let data = {};
    if (file) { try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) {} }
    let dirty = false;
    const save = () => { if (!file || !dirty) return; dirty = false; fs.writeFile(file, JSON.stringify(data), () => {}); };
    const timer = setInterval(save, 3000); if (timer.unref) timer.unref();

    const num = v => Math.max(0, Math.min(1e9, Math.floor(Number(v) || 0)));
    function cleanAvatar(a) {
        if (typeof a !== 'string' || a.length > 600) return null;
        try { const o = JSON.parse(a); return o && typeof o === 'object' ? JSON.stringify(o) : null; } catch (e) { return null; }
    }
    function cleanAq(q) {
        if (!q || typeof q !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(q.day))) return null;
        const out = { day: q.day, pins: [], prog: {}, done: {}, claimed: {}, pt: num(q.pt) };
        for (const id of Array.isArray(q.pins) ? q.pins.slice(0, 3) : []) if (ID.test(String(id))) out.pins.push(String(id));
        for (const k of Object.keys(q.prog || {}).slice(0, 12)) if (ID.test(k)) out.prog[k] = num(q.prog[k]);
        for (const k of Object.keys(q.done || {}).slice(0, 12)) if (ID.test(k) && q.done[k]) out.done[k] = 1;
        for (const k of Object.keys(q.claimed || {}).slice(0, 12)) if (ID.test(k) && q.claimed[k]) out.claimed[k] = 1;
        return out;
    }
    function mergeAq(a, b) {
        if (!a) return b; if (!b) return a;
        if (a.day !== b.day) return a.day > b.day ? a : b;
        const out = { day: a.day, pins: (b.pt > a.pt ? b : a).pins.slice(), prog: {}, done: {}, claimed: {}, pt: Math.max(a.pt, b.pt) };
        for (const o of [a, b]) {
            for (const k of Object.keys(o.prog)) out.prog[k] = Math.max(out.prog[k] || 0, o.prog[k]);
            for (const k of Object.keys(o.done)) out.done[k] = 1;
            for (const k of Object.keys(o.claimed)) out.claimed[k] = 1;
        }
        return out;
    }
    function get(acct) {
        const r = data[acct]; if (!r) return { avatar: null, at: 0, aq: null };
        return { avatar: r.avatar || null, at: r.at || 0, aq: r.aq || null };
    }
    // body: { avatar?: string(JSON), at?: ms, clear?: true, aq?: {...} }
    function put(acct, body) {
        if (!acct) return null;
        const r = data[acct] || (data[acct] = { avatar: null, at: 0, aq: null });
        const at = Math.min(num(body && body.at), now() + 60000);
        if (body && (body.avatar !== undefined || body.clear) && at >= (r.at || 0)) {
            r.avatar = body.clear ? null : cleanAvatar(body.avatar);
            r.at = at; dirty = true;
        }
        const aq = cleanAq(body && body.aq);
        if (aq) { r.aq = mergeAq(r.aq, aq); dirty = true; }
        return get(acct);
    }
    return { get, put, flush: () => { dirty = true; save(); }, mergeAq };
}
module.exports = { create };
