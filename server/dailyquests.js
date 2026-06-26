/*
 * Daily quests rotativas. Cada día (UTC) el servidor elige 5 retos del pool de forma
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
// `reward` = skin points que da completarlo. 50+ variaciones.
const POOL = [
    // Classic wins & kills
    { id: 'win_classic',  event: 'classic_5kills',     target: 1,  reward: 500, t: 'WIN 1 CLASSIC MATCH (5 KILLS)' },
    { id: 'kills_5',      event: 'kill',               target: 5,  reward: 150, t: 'GET 5 KILLS IN ANY MODE' },
    { id: 'kills_10',     event: 'kill',               target: 10, reward: 250, t: 'GET 10 KILLS IN ANY MODE' },
    { id: 'kills_25',     event: 'kill',               target: 25, reward: 550, t: 'GET 25 KILLS IN ANY MODE' },
    { id: 'kills_50',     event: 'kill',               target: 50, reward: 1000, t: 'GET 50 KILLS IN ANY MODE' },
    { id: 'kills_100',    event: 'kill',               target: 100, reward: 1800, t: 'GET 100 KILLS TOTAL' },
    // Mass milestones
    { id: 'mass_10k',     event: 'mass_100k',          target: 1,  reward: 100, t: 'REACH 10K MASS IN ONE MATCH' },
    { id: 'mass_50k',     event: 'mass_50k',           target: 1,  reward: 150, t: 'REACH 50K MASS IN ANY MODE' },
    { id: 'mass_100k',    event: 'mass_100k',          target: 1,  reward: 350, t: 'REACH 100K MASS IN ANY MODE' },
    { id: 'mass_200k',    event: 'mass_100k',          target: 2,  reward: 700, t: 'REACH 100K MASS TWICE' },
    // Match streaks
    { id: 'arcade_play2', event: 'arcade_match',       target: 2,  reward: 120, t: 'PLAY 2 ARCADE MATCHES' },
    { id: 'arcade_play3', event: 'arcade_match',       target: 3,  reward: 150, t: 'PLAY 3 ARCADE MATCHES' },
    { id: 'arcade_play5', event: 'arcade_match',       target: 5,  reward: 300, t: 'PLAY 5 ARCADE MATCHES' },
    { id: 'classic_play2',event: 'classic_match',      target: 2,  reward: 120, t: 'PLAY 2 CLASSIC MATCHES' },
    { id: 'classic_play3',event: 'classic_match',      target: 3,  reward: 150, t: 'PLAY 3 CLASSIC MATCHES' },
    { id: 'classic_play5',event: 'classic_match',      target: 5,  reward: 300, t: 'PLAY 5 CLASSIC MATCHES' },
    // Online play
    { id: 'online_play1', event: 'classic_match',      target: 1,  reward: 100, t: 'PLAY 1 ONLINE MATCH' },
    { id: 'online_play2', event: 'classic_match',      target: 2,  reward: 150, t: 'PLAY 2 ONLINE MATCHES' },
    { id: 'online_kills3',event: 'kill',               target: 3,  reward: 200, t: 'GET 3 KILLS IN ONLINE' },
    // Safe cashout
    { id: 'safe_cashout1',event: 'classic_safe_exit',  target: 1,  reward: 300, t: 'CASHOUT CLASSIC SAFELY (2+ KILLS)' },
    { id: 'safe_cashout2',event: 'classic_safe_exit',  target: 2,  reward: 600, t: 'CASHOUT CLASSIC SAFELY TWICE' },
    // Arcade top finishes
    { id: 'arcade_top5_1',event: 'arcade_top5',        target: 1,  reward: 400, t: 'FINISH TOP 5 IN ARCADE' },
    { id: 'arcade_top5_3',event: 'arcade_top5',        target: 3,  reward: 900, t: 'FINISH TOP 5 IN ARCADE 3 TIMES' },
    { id: 'arcade_top5_5',event: 'arcade_top5',        target: 5,  reward: 1500, t: 'FINISH TOP 5 IN ARCADE 5 TIMES' },
    // Skill usage
    { id: 'skills_4',     event: 'skill_used_arcade',  target: 4,  reward: 120, t: 'USE 4 SKILLS IN ARCADE' },
    { id: 'skills_8',     event: 'skill_used_arcade',  target: 8,  reward: 200, t: 'USE 8 SKILLS IN ARCADE' },
    { id: 'skills_12',    event: 'skill_used_arcade',  target: 12, reward: 200, t: 'USE 12 SKILLS IN ARCADE' },
    { id: 'skills_20',    event: 'skill_used_arcade',  target: 20, reward: 400, t: 'USE 20 SKILLS IN ARCADE' },
    // Survival in classic
    { id: 'survive_1',    event: 'classic_safe_exit',  target: 1,  reward: 200, t: 'SURVIVE 1 CLASSIC MATCH' },
    { id: 'survive_2',    event: 'classic_safe_exit',  target: 2,  reward: 300, t: 'SURVIVE 2 CLASSIC MATCHES' },
    { id: 'survive_5',    event: 'classic_safe_exit',  target: 5,  reward: 700, t: 'SURVIVE 5 CLASSIC MATCHES' },
    // Combo challenges
    { id: 'arcade_survive_1', event: 'arcade_match',   target: 1,  reward: 150, t: 'COMPLETE 1 ARCADE MATCH' },
    { id: 'classic_pentakill_1', event: 'classic_5kills', target: 1, reward: 500, t: 'ACHIEVE 1 PENTAKILL' },
    { id: 'classic_pentakill_2', event: 'classic_5kills', target: 2, reward: 1000, t: 'ACHIEVE 2 PENTAKILLS' },
    // Extra variety
    { id: 'mass_variety_1', event: 'mass_50k',         target: 1,  reward: 200, t: 'REACH 50K MASS ONCE' },
    { id: 'kills_variety_1', event: 'kill',            target: 15, reward: 350, t: 'GET 15 KILLS TOTAL' },
    { id: 'kills_variety_2', event: 'kill',            target: 30, reward: 700, t: 'GET 30 KILLS TOTAL' },
    { id: 'arcade_elite_1', event: 'arcade_top5',      target: 2,  reward: 700, t: 'TOP 5 IN ARCADE TWICE' },
    { id: 'skill_master_1', event: 'skill_used_arcade', target: 15, reward: 350, t: 'USE 15 SKILLS IN ARCADE' },
    { id: 'play_both_1',  event: 'arcade_match',       target: 2,  reward: 200, t: 'PLAY 2 OF EACH MODE' },
    { id: 'play_both_2',  event: 'classic_match',      target: 2,  reward: 200, t: 'PLAY CLASSIC & ARCADE' },
    // Filler for rotation variety
    { id: 'mass_grind_1', event: 'mass_100k',          target: 1,  reward: 300, t: 'HIT 100K MASS MILESTONE' },
    { id: 'combat_veteran_1', event: 'kill',           target: 20, reward: 400, t: 'GET 20 KILLS IN TOTAL' },
    { id: 'survive_veteran_1', event: 'classic_safe_exit', target: 3, reward: 450, t: 'SURVIVE 3 CLASSIC MATCHES' },
];

// Hash determinista de un string. Same date → same picks para todos.
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }

function todayKey() { return new Date().toISOString().slice(0, 10); }   // YYYY-MM-DD UTC

// Elige 5 retos del pool para `date`, sin repetir.
// Cacheado por fecha: solo recalcula cuando cambia el día UTC (1 vez/día),
// no en cada kill/skill. Antes era el hot-spot del tick loop online.
let _pickCacheDate = null, _pickCachePicks = null;
function pickFor(date) {
    if (date === _pickCacheDate) return _pickCachePicks;
    const idxs = [];
    let seed = hash(date);
    const pool = POOL.slice();
    while (idxs.length < 5 && pool.length) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const i = seed % pool.length;
        idxs.push(pool.splice(i, 1)[0]);
    }
    _pickCacheDate = date;
    _pickCachePicks = idxs;
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
        id: q.id, t: q.t, desc: q.desc || '', target: q.target, reward: q.reward,
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
