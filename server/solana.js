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

/*
 * A DÓNDE VAN LOS DEPÓSITOS.
 *
 * Sin contrato desplegado: a la wallet de la autoridad, como hasta ahora. Con
 * TREASURY_PROGRAM configurado: al PDA de custodia, que no tiene llave privada — ni
 * mía ni de nadie. Ese es el cambio que separa "el dueño guarda tu dinero" de "tu
 * dinero está en una cuenta que solo mueve el programa".
 *
 * El destino se resuelve UNA VEZ al arrancar y no en cada verificación: si esto
 * cambiara a mitad de vida del proceso, unos depósitos se acreditarían mirando una
 * cuenta y otros mirando otra.
 */
const TREASURY_PROGRAM = process.env.TREASURY_PROGRAM || '';
const DEPOSIT_OWNER = (() => {
    if (!TREASURY_PROGRAM) return TREASURY_OWNER;
    try {
        // El owner de la token account de custodia es el propio PDA (self-authority),
        // así que es lo que aparece como `owner` en los balances de la transacción.
        return require('./treasury-client.js').pdas(TREASURY_PROGRAM).custody.toBase58();
    } catch (e) {
        return TREASURY_OWNER;
    }
})();

function pillToRaw(pill) { return BigInt(Math.round(pill)) * (10n ** BigInt(DECIMALS)); }

// Tope de espera del RPC. Sin él, un devnet que no contesta dejaba la petición
// colgada hasta el timeout del socket (minutos) y el jugador se quedaba mirando
// el botón "Depositing..." sin saber si había fallado.
const RPC_TIMEOUT_MS = 15000;

async function rpc(method, params) {
    const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    // 429 (cuota del RPC público agotada) y 5xx no traen JSON-RPC válido: sin
    // esto el res.json() petaba con un error de parseo que no decía nada.
    if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 429 ? ' (cuota del RPC agotada, espera un poco)' : ''));
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
    if (!MINT || !DEPOSIT_OWNER) return { ok: false, reason: 'token no configurado' };
    if (!sig || !fromOwner) return { ok: false, reason: 'faltan datos' };
    let tx;
    try {
        tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    } catch (e) { return { ok: false, reason: 'rpc: ' + e.message }; }
    if (!tx) return { ok: false, reason: 'tx no encontrada (aún no confirmada?)' };
    if (tx.meta && tx.meta.err) return { ok: false, reason: 'tx falló on-chain' };

    const minRaw = pillToRaw(minPill);
    const treasuryDelta = deltaFor(tx.meta, DEPOSIT_OWNER);   // debe SUBIR
    const playerDelta = deltaFor(tx.meta, fromOwner);          // debe BAJAR

    if (treasuryDelta < minRaw) return { ok: false, reason: 'treasury no recibió lo suficiente', amount: Number(treasuryDelta) / 10 ** DECIMALS };
    if (playerDelta > -minRaw) return { ok: false, reason: 'el jugador no pagó esa cantidad' };
    // Se acredita lo que PAGÓ EL JUGADOR (-playerDelta), no lo que subió el
    // treasury: en una tx con varias transferencias al treasury, devolver
    // treasuryDelta acreditaba a quien reclamara la firma el total de TODOS los
    // ingresos de esa tx, no solo el suyo. Y por si acaso, nunca más de lo que
    // el treasury recibió de verdad.
    const acreditable = treasuryDelta < -playerDelta ? treasuryDelta : -playerDelta;
    return { ok: true, amount: Number(acreditable) / 10 ** DECIMALS };
}

// --- Retiro: envía PILL del treasury de vuelta a la wallet del jugador ---
// Requiere la keypair de la autoridad (treasury) en el servidor.
let _authority = null;
function loadAuthority() {
    if (_authority) return _authority;
    const { Keypair } = require('@solana/web3.js');
    // 1) Por variable de entorno (recomendado en el VPS, no se sube a git): TREASURY_SECRET=[1,2,3,...]
    if (process.env.TREASURY_SECRET) {
        _authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TREASURY_SECRET)));
        return _authority;
    }
    // 2) Por archivo local (en tu PC): scripts/.devnet-authority.json
    const f = path.join(__dirname, '..', 'scripts', '.devnet-authority.json');
    if (!fs.existsSync(f)) throw new Error('clave del treasury no disponible en el servidor');
    _authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))));
    return _authority;
}
function canWithdraw() { try { loadAuthority(); return true; } catch (e) { return false; } }

// --- Faucet SOL (devnet): envía SOL nativo del treasury a la wallet del jugador ---
// Usa la MISMA keypair de la autoridad (que ya paga el gas de los retiros). Esa
// cuenta debe tener SOL de devnet (se rellena con `solana airdrop 1 <addr> -u devnet`).
async function airdropSol(toWallet, sol) {
    const { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
    const auth = loadAuthority();
    const conn = new Connection(RPC, 'confirmed');
    const lamports = Math.round(sol * 1e9);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: auth.publicKey, toPubkey: new PublicKey(toWallet), lamports }));
    return await sendAndConfirmTransaction(conn, tx, [auth]);
}

/*
 * Devuelve PILL a la wallet del jugador.
 *
 * CON CONTRATO: sale del PDA de custodia por la instrucción `withdraw`, que el
 * programa solo deja apuntar a una token account que no sea la tesorería. Aunque
 * esta clave se filtrara, quien la tenga no puede tocar el dinero bloqueado — ni
 * mandarlo a la tesorería para inutilizarlo.
 *
 * SIN CONTRATO: transferencia normal desde la ATA de la autoridad, como siempre.
 */
async function withdraw(toWallet, pill) {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');
    const auth = loadAuthority();
    const conn = new Connection(RPC, 'confirmed');
    const mint = new PublicKey(MINT);

    if (TREASURY_PROGRAM) {
        const tc = require('./treasury-client.js');
        // La ATA del jugador tiene que existir antes: el programa transfiere a una
        // token account ya creada, no la crea él. La paga la autoridad, que es quien
        // firma — un jugador que retira por primera vez no tiene por qué haber
        // recibido nunca este token.
        const toAta = await getOrCreateAssociatedTokenAccount(conn, auth, mint, new PublicKey(toWallet));
        const ix = tc.withdraw(TREASURY_PROGRAM, {
            to: toAta.address, authority: auth.publicKey, amountRaw: pillToRaw(pill),
        });
        return await sendInstructions([ix]);
    }

    const fromAta = await getOrCreateAssociatedTokenAccount(conn, auth, mint, auth.publicKey);
    const toAta = await getOrCreateAssociatedTokenAccount(conn, auth, mint, new PublicKey(toWallet));
    const sig = await transfer(conn, auth, fromAta.address, toAta.address, auth, pillToRaw(pill));
    return sig;
}

// --- QUEMA de $PILL ---
// Destruye tokens del ATA del treasury de verdad: bajan el supply total del mint,
// no van a "otra cartera" de la que se pudieran sacar luego. Es lo que hace que
// "el $PILL gastado en skins se quema" sea una afirmación comprobable en el
// explorador y no una promesa.
// La autoridad es dueña del ATA, así que puede quemar de él sin permiso de nadie.
async function burn(pill) {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const { getOrCreateAssociatedTokenAccount, burn: splBurn } = require('@solana/spl-token');
    const auth = loadAuthority();

    // Con el contrato, lo gastado en la tienda vive en el PDA de custodia y la
    // autoridad ya no es dueña de esos tokens: quemar pasa a ser una instrucción del
    // programa, capada por época igual que el sweep. Es el mismo hecho de siempre
    // (baja el supply, no va a ninguna cartera) por un camino que nadie controla.
    if (TREASURY_PROGRAM) {
        const tc = require('./treasury-client.js');
        const ix = tc.burn(TREASURY_PROGRAM, { authority: auth.publicKey, mint: MINT, amountRaw: pillToRaw(pill) });
        return await sendInstructions([ix]);
    }

    const conn = new Connection(RPC, 'confirmed');
    const mint = new PublicKey(MINT);
    const ata = await getOrCreateAssociatedTokenAccount(conn, auth, mint, auth.publicKey);
    return await splBurn(conn, auth, ata.address, mint, auth, pillToRaw(pill));
}

/*
 * Envía una o varias instrucciones firmadas por la autoridad. Es lo que usa el
 * módulo de premios para hablar con el programa de tesorería (publish_round,
 * sweep, extend_lock...).
 *
 * Vive aquí y no en treasury-client.js a propósito: la clave de la autoridad NO
 * debe salir de este fichero. treasury-client construye instrucciones —datos, sin
 * secretos— y quien las firma es siempre este módulo, que es el único que sabe
 * cargar la keypair. Así hay un solo sitio al que mirar cuando la pregunta es
 * "quién puede firmar con la autoridad".
 */
async function sendInstructions(instructions, extraSigners = []) {
    const { Connection, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
    const auth = loadAuthority();
    const conn = new Connection(RPC, 'confirmed');
    const tx = new Transaction();
    for (const ix of instructions) tx.add(ix);
    return await sendAndConfirmTransaction(conn, tx, [auth, ...extraSigners]);
}

/** Pubkey de la autoridad, sin exponer la clave privada. */
function authorityPubkey() {
    try { return loadAuthority().publicKey.toBase58(); } catch (e) { return null; }
}

// Verifica que `signature` es una firma válida de `message` hecha por `wallet`.
// (El jugador firma un mensaje con su wallet para AUTORIZAR el retiro; prueba que es el dueño.)
function verifySignedMessage(wallet, message, signatureArr) {
    try {
        const nacl = require('tweetnacl');
        const { PublicKey } = require('@solana/web3.js');
        const pub = new PublicKey(wallet).toBytes();
        const sig = Uint8Array.from(signatureArr);
        const msg = new TextEncoder().encode(message);
        return nacl.sign.detached.verify(msg, sig, pub);
    } catch (e) { return false; }
}

module.exports = { verifyDeposit, withdraw, burn, airdropSol, canWithdraw, verifySignedMessage, sendInstructions, authorityPubkey, RPC, MINT, DECIMALS, TREASURY_OWNER, DEPOSIT_OWNER, TREASURY_PROGRAM, pillToRaw };
