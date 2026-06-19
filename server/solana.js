/*
 * Verificación de depósitos $PILL en Solana (devnet) para las salas de pago.
 *
 * Modelo (FASE B2, custodiado en devnet): el jugador hace un transfer SPL normal
 * de la entrada al "treasury" (por ahora la cuenta de la autoridad). El servidor
 * NO mueve nada para verificar: solo lee la transacción por RPC y comprueba que el
 * jugador ingresó al treasury la cantidad mínima de PILL. Antes de mainnet esto se
 * reemplaza por un programa Anchor (vault on-chain trustless), misma lógica.
 *
 * Sin dependencias: usa fetch (Node 18+) contra el RPC JSON, como hace la web.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Config del token: lee scripts/devnet-token.json si existe; override por env.
let tok = {};
try { tok = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'devnet-token.json'), 'utf8')); } catch (e) {}

const RPC = process.env.SOL_RPC || tok.rpc || 'https://api.devnet.solana.com';
const MINT = process.env.PILL_MINT || tok.mint || '';
const DECIMALS = parseInt(process.env.PILL_DECIMALS, 10) || tok.decimals || 6;
// Dueño del treasury (a dónde se ingresan las entradas). Por ahora = autoridad.
const TREASURY_OWNER = process.env.PILL_TREASURY || tok.authority || '';

function pillToRaw(pill) { return BigInt(Math.round(pill)) * (10n ** BigInt(DECIMALS)); }

async function rpc(method, params) {
    const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'RPC error');
    return j.result;
}

// Suma (post - pre) de los token accounts cuyo owner==owner y mint==MINT, en RAW.
function deltaFor(meta, owner) {
    const pre = new Map(), post = new Map();
    for (const b of (meta.preTokenBalances || [])) if (b.mint === MINT && b.owner === owner) pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
    for (const b of (meta.postTokenBalances || [])) if (b.mint === MINT && b.owner === owner) post.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
    let delta = 0n;
    const idxs = new Set([...pre.keys(), ...post.keys()]);
    for (const i of idxs) delta += (post.get(i) || 0n) - (pre.get(i) || 0n);
    return delta;
}

/*
 * Verifica que `sig` es un depósito válido: el jugador `fromOwner` ingresó al
 * treasury al menos `minPill` de PILL, y la tx tuvo éxito.
 * Devuelve { ok, amount, reason }.
 */
async function verifyDeposit({ sig, fromOwner, minPill }) {
    if (!MINT || !TREASURY_OWNER) return { ok: false, reason: 'token no configurado' };
    if (!sig || !fromOwner) return { ok: false, reason: 'faltan datos' };
    let tx;
    try {
        tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    } catch (e) { return { ok: false, reason: 'rpc: ' + e.message }; }
    if (!tx) return { ok: false, reason: 'tx no encontrada (aún no confirmada?)' };
    if (tx.meta && tx.meta.err) return { ok: false, reason: 'tx falló on-chain' };

    const minRaw = pillToRaw(minPill);
    const treasuryDelta = deltaFor(tx.meta, TREASURY_OWNER);   // debe SUBIR
    const playerDelta = deltaFor(tx.meta, fromOwner);          // debe BAJAR

    if (treasuryDelta < minRaw) return { ok: false, reason: 'treasury no recibió lo suficiente', amount: Number(treasuryDelta) / 10 ** DECIMALS };
    if (playerDelta > -minRaw) return { ok: false, reason: 'el jugador no pagó esa cantidad' };
    return { ok: true, amount: Number(treasuryDelta) / 10 ** DECIMALS };
}

module.exports = { verifyDeposit, RPC, MINT, DECIMALS, TREASURY_OWNER, pillToRaw };
