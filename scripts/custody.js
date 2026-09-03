/*
 * HERRAMIENTA DE OPERACION DE LA CUSTODIA.
 *
 *   node scripts/custody.js init <programa> <mint> [autoridad]
 *   node scripts/custody.js estado <programa>
 *   node scripts/custody.js deposit <programa> <pill> [--keypair f.json]
 *   node scripts/custody.js withdraw <programa> <jugador> <pill> [--keypair f.json]
 *   node scripts/custody.js prueba <programa>     # ciclo completo, para devnet
 *
 * CONFIGURACION (env, igual que el resto del servidor):
 *   PILL_MINT / SOL_RPC / PILL_DECIMALS   (o scripts/devnet-token.json)
 *   TREASURY_SECRET    clave de la autoridad (o scripts/.devnet-authority.json)
 *
 * `prueba` es lo que de verdad importa antes de revocar nada: deposita, retira,
 * y comprueba que el contrato RECHAZA lo que tiene que rechazar. Un contrato que
 * hace lo que debe no esta probado; lo esta uno que ademas se niega a lo que no debe.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
    Connection, Keypair, PublicKey, Transaction, SystemProgram,
} = require('@solana/web3.js');
const {
    getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
    createTransferInstruction, getAccount, TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

const solana = require('../server/solana.js');
const cc = require('../server/custody-client.js');

const DEC = solana.DECIMALS;
const aRaw = (pill) => BigInt(Math.round(Number(pill) * 10 ** DEC));
const aPill = (raw) => Number(BigInt(raw)) / 10 ** DEC;
const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter(a => !a.startsWith('--'));
const flag = (n, def) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : def; };

function conn() { return new Connection(solana.RPC, 'confirmed'); }

function autoridad() {
    if (process.env.TREASURY_SECRET) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TREASURY_SECRET)));
    }
    const f = flag('keypair', path.join(__dirname, '.devnet-authority.json'));
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))));
}

async function manda(c, ixs, firmantes) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = firmantes[0].publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(...firmantes);
    const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await c.confirmTransaction(sig, 'confirmed');
    return sig;
}

/* ===================== COMANDOS ===================== */

async function init() {
    const [programa, mint, quien] = pos;
    if (!programa || !mint) throw new Error('uso: init <programa> <mint> [autoridad]');
    const c = conn(); const pagador = autoridad();
    const auth = quien || pagador.publicKey.toBase58();
    const { config, custody } = cc.pdas(programa);

    console.log('Programa :', programa);
    console.log('Mint     :', mint);
    console.log('Autoridad:', auth);
    console.log('Config   :', config.toBase58());
    console.log('Boveda   :', custody.toBase58(), '(PDA: no existe llave privada que firme por ella)');

    const sig = await manda(c, [cc.initialize(programa, {
        mint, authority: auth, payer: pagador.publicKey,
    })], [pagador]);
    console.log('\nInicializado:', sig);
    return sig;
}

async function estado() {
    const [programa] = pos;
    if (!programa) throw new Error('uso: estado <programa>');
    const c = conn();
    const { config, custody } = cc.pdas(programa);
    const info = await c.getAccountInfo(config);
    if (!info) { console.log('Sin inicializar.'); return; }
    const cfg = cc.decodeConfig(info.data);

    let enBoveda = 0n;
    try { enBoveda = (await getAccount(c, custody)).amount; } catch (e) {}

    const dep = BigInt(cfg.totalDeposited), ret = BigInt(cfg.totalWithdrawn);
    console.log('Autoridad        :', cfg.authority);
    console.log('Autoridad en cola:', cfg.pendingAuthority || '—');
    console.log('Mint             :', cfg.mint);
    console.log('Boveda           :', custody.toBase58());
    console.log('');
    console.log('Depositado total :', fmt(aPill(dep)), 'PILL');
    console.log('Retirado total   :', fmt(aPill(ret)), 'PILL');
    console.log('En la boveda     :', fmt(aPill(enBoveda)), 'PILL');
    // Los contadores son de la cadena y el saldo tambien: si no cuadran, algo entro
    // o salio sin pasar por el programa (una transferencia directa a la PDA, por
    // ejemplo). No es un error por si mismo, pero hay que verlo.
    const esperado = dep - ret;
    if (enBoveda !== esperado) {
        console.log('');
        console.log('OJO: el saldo no cuadra con los contadores.');
        console.log('  deposit - withdraw =', fmt(aPill(esperado)), 'PILL');
        console.log('  diferencia         =', fmt(aPill(enBoveda - esperado)), 'PILL');
        console.log('  (una transferencia directa a la boveda no pasa por deposit y no se cuenta)');
    }
}

async function deposit() {
    const [programa, pill] = pos;
    if (!programa || !pill) throw new Error('uso: deposit <programa> <pill>');
    const c = conn(); const yo = autoridad();
    const mint = new PublicKey(solana.MINT);
    const from = getAssociatedTokenAddressSync(mint, yo.publicKey, true);
    const sig = await manda(c, [cc.deposit(programa, {
        from, owner: yo.publicKey, amountRaw: aRaw(pill),
    })], [yo]);
    console.log('Depositados', fmt(pill), 'PILL:', sig);
}

async function withdraw() {
    const [programa, jugador, pill] = pos;
    if (!programa || !jugador || !pill) throw new Error('uso: withdraw <programa> <jugador> <pill>');
    const c = conn(); const auth = autoridad();
    // El jugador tambien firma. Aqui solo tiene sentido si la autoridad ES el jugador
    // (una prueba); en el servidor la firma la aporta el jugador desde su wallet.
    const sig = await manda(c, [cc.withdraw(programa, {
        player: jugador, mint: solana.MINT, authority: auth.publicKey, amountRaw: aRaw(pill),
    })], [auth]);
    console.log('Retirados', fmt(pill), 'PILL a', jugador + ':', sig);
}

module.exports = { init, estado, deposit, withdraw, conn, autoridad, manda, aRaw, aPill };

if (require.main === module) {
    const tabla = { init, estado, deposit, withdraw, prueba: () => require('./custody-prueba.js').run(pos, argv) };
    const f = tabla[cmd];
    if (!f) {
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''));
        process.exit(1);
    }
    f().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
