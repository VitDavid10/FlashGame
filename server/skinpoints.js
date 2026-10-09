/*
 * Ledger de SKIN POINTS por clientId (anónimo, no requiere wallet).
 * Se ganan completando daily quests. Se gastarán en el catálogo de skins.
 *
 * Cuentas de X: un clientId (el de cada movil/navegador) puede quedar enlazado
 * a una cuenta 'x_<id>' (linkCid). Desde entonces todo lo de ese cid se lee y
 * se escribe en la cuenta, asi que los SP y las skins viajan con tu X y no con
 * el movil. Al enlazar se SUMA lo que tenia el cid: nunca se pierde nada.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'skinpoints.json');

let data = { points: {}, owned: {}, links: {} };
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); data.points = j.points || {}; data.owned = j.owned || {}; data.links = j.links || {}; } catch (e) {}

let dirty = false;
function save() { if (!dirty) return; dirty = false; fs.writeFile(FILE, JSON.stringify(data), () => {}); }
setInterval(save, 3000).unref();   // ver la nota en skinshop.js
process.on('SIGTERM', save); process.on('SIGINT', () => { save(); process.exit(0); });

// La cuenta real de un cid: la de X si esta enlazado, si no el propio cid.
function cuenta(cid) { return (cid && data.links[cid]) || cid; }

function getPoints(cid) { return data.points[cuenta(cid)] | 0; }
function addPoints(cid, n) { const k = cuenta(cid); data.points[k] = (data.points[k] | 0) + (n | 0); dirty = true; return data.points[k]; }
function spendPoints(cid, n) {
    const k = cuenta(cid), have = data.points[k] | 0;
    if (have < n) return false;
    data.points[k] = have - n; dirty = true; return data.points[k];
}
function ownedOf(cid) { return data.owned[cuenta(cid)] || []; }
function addOwned(cid, skinId) {
    const k = cuenta(cid);
    if (!data.owned[k]) data.owned[k] = [];
    if (!data.owned[k].includes(skinId)) data.owned[k].push(skinId);
    dirty = true; return data.owned[k];
}

// Enlaza un cid a una cuenta de X y le pasa lo que tuviera (solo suma).
// Devuelve false si ya estaba enlazado a esa cuenta (no habia nada que mover).
// Cuenta de wallet ('w_<wallet>', la que se usa mientras no hay X) -> cuenta de X: se suma todo y los cids
// que apuntaban a la de wallet pasan a la de X. Sin esto, al enlazar X despues, los SP se quedaban en la 'w_'.
function migraWallet(acct, wallet) {
    const w = wallet && acct && acct.startsWith('x_') ? 'w_' + wallet : null;
    if (!w) return false;
    let cambio = false;
    if (data.points[w]) { data.points[acct] = (data.points[acct] | 0) + (data.points[w] | 0); delete data.points[w]; cambio = true; }
    if (data.owned[w]) {
        if (!data.owned[acct]) data.owned[acct] = [];
        for (const s of data.owned[w]) if (!data.owned[acct].includes(s)) data.owned[acct].push(s);
        delete data.owned[w]; cambio = true;
    }
    for (const k of Object.keys(data.links)) if (data.links[k] === w) { data.links[k] = acct; cambio = true; }
    if (cambio) dirty = true;
    return cambio;
}

function linkCid(cid, acct) {
    if (!cid || !acct || cid === acct) return false;
    if (data.links[cid] === acct) return false;
    // Enlazado antes a OTRA cuenta de X: lo suyo ya vive alli y alli se queda;
    // este cid pasa a la nueva cuenta sin llevarse nada.
    if (!data.links[cid]) {
        data.points[acct] = (data.points[acct] | 0) + (data.points[cid] | 0);
        delete data.points[cid];
        for (const s of data.owned[cid] || []) {
            if (!data.owned[acct]) data.owned[acct] = [];
            if (!data.owned[acct].includes(s)) data.owned[acct].push(s);
        }
        delete data.owned[cid];
    }
    data.links[cid] = acct;
    dirty = true;
    return true;
}

module.exports = {
    getPoints, addPoints, spendPoints,
    ownedOf, addOwned,
    cuenta, linkCid, migraWallet,
    get _points() { return data.points; },
    get _owned() { return data.owned; },
};
