/*
 * "WAR bank": saldo interno de $PILL de cada jugador (off-chain).
 *
 * Modelo: el jugador DEPOSITA PILL al treasury (on-chain, una firma) → se le acredita
 * aquí un saldo WAR. Entrar a salas de pago DESCUENTA de este saldo (instantáneo, sin
 * firmar). Las ganancias suman. RETIRAR envía PILL de vuelta a la wallet (on-chain).
 *
 * Persistencia simple en server/warbalances.json. Anti-replay: guarda las firmas de
 * depósito ya acreditadas para no acreditarlas dos veces.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'warbalances.json');
let data = { balances: {}, sigs: {} };
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); data.balances = j.balances || {}; data.sigs = j.sigs || {}; } catch (e) {}

let dirty = false;
function save() { if (!dirty) return; dirty = false; fs.writeFile(FILE, JSON.stringify(data), () => {}); }
setInterval(save, 3000);
process.on('SIGTERM', save); process.on('SIGINT', () => { save(); process.exit(0); });

// Purga periódica de firmas viejas (>24h). Anti-leak: el map crece eternamente si no.
const SIG_TTL_MS = 24 * 3600 * 1000;
setInterval(() => {
    const cutoff = Date.now() - SIG_TTL_MS;
    let removed = 0;
    for (const [k, t] of Object.entries(data.sigs)) {
        if (t < cutoff) { delete data.sigs[k]; removed++; }
    }
    if (removed > 0) dirty = true;
}, 30 * 60 * 1000);   // cada 30 min

function getBalance(wallet) { return data.balances[wallet] || 0; }
function sigUsed(sig) { return !!data.sigs[sig]; }

// Acredita un depósito verificado. Marca la firma para que no se reuse.
function creditDeposit(wallet, amount, sig) {
    if (sig) data.sigs[sig] = Date.now();
    data.balances[wallet] = (data.balances[wallet] || 0) + amount;
    dirty = true;
    return data.balances[wallet];
}
// Suma genérica (ganancias). Resta genérica (entrada a sala). Devuelve nuevo saldo o false.
function credit(wallet, amount) { data.balances[wallet] = (data.balances[wallet] || 0) + amount; dirty = true; return data.balances[wallet]; }
function debit(wallet, amount) {
    if ((data.balances[wallet] || 0) < amount) return false;
    data.balances[wallet] -= amount; dirty = true; return data.balances[wallet];
}

module.exports = {
    getBalance, sigUsed, creditDeposit, credit, debit, save,
    // Expone los maps para el endpoint /api/health (solo lectura, diagnóstico)
    get _balances() { return data.balances; },
    get _sigs() { return data.sigs; },
};
