/*
 * Ledger de SKIN POINTS por clientId (anónimo, no requiere wallet).
 * Se ganan completando daily quests. Se gastarán en el catálogo de skins.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'skinpoints.json');

let data = { points: {}, owned: {} };
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); data.points = j.points || {}; data.owned = j.owned || {}; } catch (e) {}

let dirty = false;
function save() { if (!dirty) return; dirty = false; fs.writeFile(FILE, JSON.stringify(data), () => {}); }
setInterval(save, 3000);
process.on('SIGTERM', save); process.on('SIGINT', () => { save(); process.exit(0); });

function getPoints(cid) { return data.points[cid] | 0; }
function addPoints(cid, n) { data.points[cid] = (data.points[cid] | 0) + (n | 0); dirty = true; return data.points[cid]; }
function spendPoints(cid, n) {
    const have = data.points[cid] | 0;
    if (have < n) return false;
    data.points[cid] = have - n; dirty = true; return data.points[cid];
}
function ownedOf(cid) { return data.owned[cid] || []; }
function addOwned(cid, skinId) {
    if (!data.owned[cid]) data.owned[cid] = [];
    if (!data.owned[cid].includes(skinId)) data.owned[cid].push(skinId);
    dirty = true; return data.owned[cid];
}

module.exports = {
    getPoints, addPoints, spendPoints,
    ownedOf, addOwned,
    get _points() { return data.points; },
    get _owned() { return data.owned; },
};
