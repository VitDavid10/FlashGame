/*
 * Daily missions rotativas. Cada día (UTC) el servidor elige 5 retos del pool de forma
 * determinística por fecha (mismo set para todos los jugadores ese día). Al completar
 * un reto se acreditan SKIN POINTS al clientId. Se resetean al cambiar de día.
 *
 * El servidor llama `recordEvent(cid, type, amount?)` desde el bucle del juego.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const skinpoints = require('./skinpoints.js');

const FILE = path.join(__dirname, 'daily.json');
let data = {};   // clientId → { date, counters, claimed }
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) {}

let dirty = false;
function save() { if (!dirty) return; dirty = false; fs.writeFile(FILE, JSON.stringify(data), () => {}); }
setInterval(save, 3000);
process.on('SIGTERM', save); process.on('SIGINT', () => { save(); process.exit(0); });

// Pool de retos posibles. `event` se machea con lo que dispara recordEvent.
// `reward` = skin points que da completarlo.
const POOL = [
    { id: 'win_classic',  event: 'classic_5kills',     target: 1,  reward: 500, t: 'WIN 1 CLASSIC MATCH (5 KILLS)' },
    { id: 'mass_50k',     event: 'mass_50k',           target: 1,  reward: 150, t: 'REACH 50K MASS IN ANY MODE' },
    { id: 'mass_100k',    event: 'mass_100k',          target: 1,  reward: 350, t: 'REACH 100K MASS IN ANY MODE' },
    { id: 'kills_10',     event: 'kill',               target: 10, reward: 250, t: 'GET 10 KILLS IN ANY MODE' },
    { id: 'kills_25',     event: 'kill',               target: 25, reward: 550, t: 'GET 25 KILLS IN ANY MODE' },
    { id: 'arcade_play3', event: 'arcade_match',       target: 3,  reward: 150, t: 'PLAY 3 ARCADE MATCHES' },
    { id: 'classic_play3',event: 'classic_match',      target: 3,  reward: 150, t: 'PLAY 3 CLASSIC MATCHES' },
    { id: 'safe_cashout', event: 'classic_safe_exit',  target: 1,  reward: 300, t: 'CASHOUT CLASSIC SAFELY (2+ KILLS)' },
    { id: 'arcade_top5',  event: 'arcade_top5',        target: 1,  reward: 400, t: 'FINISH TOP 5 IN ARCADE' },
    { id: 'skills_12',    event: 'skill_used_arcade',  target: 12, reward: 200, t: 'USE 12 SKILLS IN ARCADE' },
];

// Hash determinista de un string. Same date → same picks para todos.
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }

function todayKey() { return new Date().toISOString().slice(0, 10); }   // YYYY-MM-DD UTC

// Elige 5 retos del pool para `date`, sin repetir.
function pickFor(date) {
    const idxs = [];
    let seed = hash(date);
    const pool = POOL.slice();
    while (idxs.length < 5 && pool.length) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const i = seed % pool.length;
        idxs.push(pool.splice(i, 1)[0]);
    }
    return idxs;
}

// Garantiza que el clientId tiene entrada para HOY (resetea si cambió la fecha).
function ensureToday(cid) {
    const today = todayKey();
    if (!data[cid] || data[cid].date !== today) {
        data[cid] = { date: today, counters: {}, claimed: {} };
        dirty = true;
    }
    return data[cid];
}

// Devuelve el estado del jugador para HOY (retos, progreso, claimed, puntos totales).
function getState(cid) {
    if (!cid) return { quests: [], date: todayKey(), points: 0 };
    const u = ensureToday(cid);
    const today = u.date;
    const quests = pickFor(today).map(q => ({
        id: q.id, t: q.t, target: q.target, reward: q.reward,
        progress: Math.min(q.target, u.counters[q.id] | 0),
        done: !!u.claimed[q.id],
    }));
    return { date: today, quests, points: skinpoints.getPoints(cid) };
}

// Llamada del servidor cuando ocurre un evento del juego. Suma a TODOS los retos del
// día cuyo `event` matchee. Si completa un reto y no estaba reclamado, acredita los
// puntos y lo marca como claimed.
function recordEvent(cid, eventType, amount) {
    if (!cid) return;
    const u = ensureToday(cid);
    const today = u.date;
    const picks = pickFor(today);
    const inc = amount | 0 || 1;
    let pointsGained = 0;
    for (const q of picks) {
        if (q.event !== eventType) continue;
        if (u.claimed[q.id]) continue;
        const before = u.counters[q.id] | 0;
        const after = Math.min(q.target, before + inc);
        if (after !== before) { u.counters[q.id] = after; dirty = true; }
        if (after >= q.target && !u.claimed[q.id]) {
            u.claimed[q.id] = true;
            skinpoints.addPoints(cid, q.reward);
            pointsGained += q.reward;
        }
    }
    return pointsGained;
}

module.exports = { getState, recordEvent, POOL, todayKey };
