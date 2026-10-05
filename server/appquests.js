'use strict';
/*
 * Misiones de la app (menu QUESTS del movil): cada dia salen 9, el jugador marca hasta 3 y las hace en cualquier
 * modo, tambien sin conexion o en practica. El cliente cuenta el progreso; el servidor solo PAGA los SP:
 *   - la mision tiene que ser una de las 9 de hoy (mismo sorteo por dia UTC que el cliente, game/app-hub.js),
 *   - maximo 3 cobros al dia por cuenta (X o wallet firmada) y uno por mision,
 *   - sin cuenta no se cobra: la mision queda hecha en el movil y se cobra al conectar.
 * Que el progreso lo cuente el cliente es lo que permite jugarlas offline; el tope de 3 cobros al dia y la cuenta
 * son lo que limita lo que se puede sacar de ahi (como mucho 60 SP al dia por cuenta).
 */
const fs = require('fs');
const path = require('path');

const MAX_CLAIMS = 3;
const FILE = path.join(__dirname, 'appquests.json');

// [id, titulo, meta, tipo]. Mismos ids, orden y tiers que QP de game/app-hub.js (hay un test que lo vigila).
const POOL = [
    { tier: 'EASY', q: [['e-kill1', 1], ['e-pieces5', 5], ['e-skills2', 2], ['e-mass3k', 3000], ['e-survive60', 60]] },
    { tier: 'MEDIUM', q: [['m-kill3', 3], ['m-splitkill', 1], ['m-pieces15', 15], ['m-mass8k', 8000], ['m-skills3', 3]] },
    { tier: 'HARD', q: [['h-kill5', 5], ['h-kill3match', 3], ['h-mass20k', 20000], ['h-finish', 1], ['h-top5', 1]] },
    { tier: 'SKILL', q: [['s-sprint', 1], ['s-blink', 1], ['s-magnet', 1], ['s-shield', 1], ['s-shot', 1], ['s-gamble', 1]] },
    { tier: 'GRIND', q: [['g-play3', 3], ['g-survive90', 90], ['g-split10', 10], ['g-picks5', 5], ['g-virus', 1]] },
];
const SP_TIER = { EASY: 5, MEDIUM: 10, HARD: 20, SKILL: 10, GRIND: 10 };
const ORDEN_TIER = ['EASY', 'MEDIUM', 'HARD', 'SKILL', 'GRIND', 'EASY', 'MEDIUM', 'SKILL', 'GRIND'];

function qRng(seed) {
    let h = 2166136261;
    for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
// Las 5 del airdrop (se excluyen de las de la app).
function airdropIds(day) {
    const r = qRng('quests:' + day);
    return POOL.map(p => p.q[Math.floor(r() * p.q.length)][0]);
}
function missionsOf(day) {
    const fuera = new Set(airdropIds(day));
    const r = qRng('app:' + day), bolsa = {};
    POOL.forEach(p => {
        const lista = p.q.filter(q => !fuera.has(q[0]));
        for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]]; }
        bolsa[p.tier] = lista;
    });
    return ORDEN_TIER.map(t => { const q = bolsa[t].shift(); return q && { id: q[0], goal: q[1], tier: t, sp: SP_TIER[t] }; }).filter(Boolean);
}

function create(opts) {
    const file = opts.file === undefined ? FILE : opts.file;
    const addPoints = opts.addPoints;            // (cid, n) -> saldo
    const now = opts.now || (() => new Date());
    let data = {};                               // cuenta -> { day, claimed: [ids] }
    if (file) { try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) {} }
    let dirty = false;
    const save = () => { if (!file || !dirty) return; dirty = false; fs.writeFile(file, JSON.stringify(data), () => {}); };
    const timer = setInterval(save, 3000); if (timer.unref) timer.unref();
    const today = () => now().toISOString().slice(0, 10);

    function claim(acct, cid, id) {
        if (!acct) return { ok: false, error: 'no_account' };
        const day = today();
        const m = missionsOf(day).find(x => x.id === id);
        if (!m) return { ok: false, error: 'not_today' };
        let rec = data[acct];
        if (!rec || rec.day !== day) rec = data[acct] = { day, claimed: [] };
        if (rec.claimed.includes(id)) return { ok: true, already: true, claimed: rec.claimed.slice() };
        if (rec.claimed.length >= MAX_CLAIMS) return { ok: false, error: 'limit', claimed: rec.claimed.slice() };
        rec.claimed.push(id); dirty = true;
        const sp = addPoints(cid, m.sp);
        return { ok: true, sp, reward: m.sp, claimed: rec.claimed.slice() };
    }
    return { claim, missionsOf, flush: () => { dirty = true; save(); } };
}

module.exports = { create, missionsOf, POOL, SP_TIER, MAX_CLAIMS };
