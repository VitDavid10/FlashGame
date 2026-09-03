/*
 * HERRAMIENTA DE OPERACION DEL STAKING.
 *
 *   node scripts/staking.js init <programa> <mint> [autoridad]
 *   node scripts/staking.js estado <programa>
 *   node scripts/staking.js fund <programa> <pill> [--horas 24]
 *   node scripts/staking.js posicion <programa> <wallet>
 *   node scripts/staking.js prueba <programa> [--mint <mint>]
 *
 * CONFIGURACION (env, igual que el resto del servidor):
 *   PILL_MINT / SOL_RPC / PILL_DECIMALS   (o scripts/devnet-token.json)
 *   TREASURY_SECRET    clave de la autoridad (o scripts/.devnet-authority.json)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, getAccount } = require('@solana/spl-token');

const solana = require('../server/solana.js');
const sc = require('../server/staking-client.js');

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
    const { config, stakeVault, rewardVault } = sc.pdas(programa);

    console.log('Programa    :', programa);
    console.log('Mint        :', mint);
    console.log('Autoridad   :', auth);
    console.log('Config      :', config.toBase58());
    console.log('Principal   :', stakeVault.toBase58(), '(PDA: sin llave privada)');
    console.log('Recompensas :', rewardVault.toBase58(), '(PDA: sin llave privada)');

    const sig = await manda(c, [sc.initialize(programa, {
        mint, authority: auth, payer: pagador.publicKey,
    })], [pagador]);
    console.log('\nInicializado:', sig);
    return sig;
}

async function estado() {
    const [programa] = pos;
    if (!programa) throw new Error('uso: estado <programa>');
    const c = conn();
    const { config, stakeVault, rewardVault } = sc.pdas(programa);
    const info = await c.getAccountInfo(config);
    if (!info) { console.log('Sin inicializar.'); return; }
    const cfg = sc.decodeConfig(info.data);

    let enPrincipal = 0n, enRecompensas = 0n;
    try { enPrincipal = (await getAccount(c, stakeVault)).amount; } catch (e) {}
    try { enRecompensas = (await getAccount(c, rewardVault)).amount; } catch (e) {}

    const ahora = Math.floor(Date.now() / 1000);
    console.log('Autoridad        :', cfg.authority);
    console.log('Autoridad en cola:', cfg.pendingAuthority || '—');
    console.log('Mint             :', cfg.mint);
    console.log('');
    console.log('Staked (rindiendo):', fmt(aPill(cfg.totalStaked)), 'PILL');
    console.log('En la boveda      :', fmt(aPill(enPrincipal)), 'PILL');
    // La diferencia es lo que hay pedido para salir: sigue fisicamente dentro pero
    // ya no rinde. Que no cuadren es lo NORMAL, y por eso se dice.
    const enSalida = enPrincipal - BigInt(cfg.totalStaked);
    if (enSalida !== 0n) console.log('  (' + fmt(aPill(enSalida)), 'PILL pedidos para salir: siguen dentro pero ya no rinden)');
    console.log('');
    console.log('Pozo de recompensas:', fmt(aPill(enRecompensas)), 'PILL');
    console.log('Ritmo ahora        :', fmt(aPill(cfg.rewardRate)), 'PILL/s');
    console.log('Goteo hasta        :', cfg.periodFinish
        ? new Date(cfg.periodFinish * 1000).toISOString() + (ahora >= cfg.periodFinish ? '  (TERMINADO)' : '')
        : '—');
    console.log('APR aproximado     :', sc.aprAprox(cfg, ahora).toFixed(2) + ' %');
    console.log('');
    console.log('Aportado total   :', fmt(aPill(cfg.totalFunded)), 'PILL');
    console.log('Pagado total     :', fmt(aPill(cfg.totalPaid)), 'PILL');
}

async function fund() {
    const [programa, pill] = pos;
    if (!programa || !pill) throw new Error('uso: fund <programa> <pill> [--horas 24]');
    const horas = parseFloat(flag('horas', '24'));
    const c = conn(); const auth = autoridad();
    const from = getAssociatedTokenAddressSync(new PublicKey(solana.MINT), auth.publicKey, true);
    const sig = await manda(c, [sc.fundRewards(programa, {
        from, authority: auth.publicKey, amountRaw: aRaw(pill), duration: Math.round(horas * 3600),
    })], [auth]);
    console.log(`Aportados ${fmt(pill)} PILL a repartir en ${horas} h:`, sig);
}

async function posicion() {
    const [programa, wallet] = pos;
    if (!programa || !wallet) throw new Error('uso: posicion <programa> <wallet>');
    const c = conn();
    const { config } = sc.pdas(programa);
    const cfg = sc.decodeConfig((await c.getAccountInfo(config)).data);
    const pda = sc.stakeAccount(programa, wallet);
    const info = await c.getAccountInfo(pda);
    if (!info) { console.log('Esa wallet no tiene posicion.'); return; }
    const acc = sc.decodeStakeAccount(info.data);
    const ahora = Math.floor(Date.now() / 1000);

    console.log('Wallet     :', wallet);
    console.log('Posicion   :', pda.toBase58());
    console.log('Dentro     :', fmt(aPill(acc.amount)), 'PILL');
    console.log('Pendiente  :', fmt(aPill(sc.pendienteAhora(cfg, acc, ahora))), 'PILL');
    if (BigInt(acc.unstaking) > 0n) {
        const falta = acc.unstakeReadyAt - ahora;
        console.log('De salida  :', fmt(aPill(acc.unstaking)), 'PILL',
            falta > 0 ? `(faltan ${(falta / 3600).toFixed(1)} h)` : '(ya retirable)');
    }
}

module.exports = { init, estado, fund, posicion, conn, autoridad, manda, aRaw, aPill };

if (require.main === module) {
    const tabla = { init, estado, fund, posicion, prueba: () => require('./staking-prueba.js').run(pos, argv) };
    const f = tabla[cmd];
    if (!f) {
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\n?/, '').replace(/^ \* ?/gm, ''));
        process.exit(1);
    }
    f().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
