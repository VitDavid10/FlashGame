/*
 * EL CAMINO DE UN PREMIO, DE PUNTA A PUNTA Y EN LA CADENA DE VERDAD.
 *
 *   node scripts/rewards-prueba.js [--pct 15]
 *
 * Monta el escenario completo y comprueba que un ganador cobra:
 *
 *   1. crea (o reusa) la WALLET DE PREMIOS y la fondea con un % del supply
 *   2. cierra un dia de leaderboard con ganadores de mentira
 *   3. ancla el hash de ese dia en la cadena  <- ANTES de mover un token
 *   4. un ganador reclama, y el servidor le paga desde la wallet de premios
 *   5. se comprueba en la cadena que los tokens llegaron a SU wallet
 *
 * Y despues, lo que NO puede pasar:
 *
 *   - cobrar dos veces el mismo dia
 *   - que cobre alguien que no sale en la lista anclada
 *   - que se pague un dia que todavia no esta anclado
 *
 * El orden del punto 3 es lo que hace el reparto comprobable: el hash de la
 * clasificacion queda fijado CON FECHA antes de que salga un solo token, asi que
 * pagar a otro contradiria una lista que ya era publica.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/*
 * A PROPOSITO no se lee el .service aqui.
 *
 * Los otros scripts si lo hacen, para no tener que repetirles las direcciones. Este
 * no: sus numeros de abajo SON el escenario que demuestra. Con la config del VPS
 * encima (REWARD_BUDGET_PILL=50000, REWARD_FACTOR=1) seguiria pasando, seguiria
 * diciendo "premios repartidos", y estaria demostrando otra cosa.
 */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-premios-'));
process.env.LB_DIR = DIR;
process.env.REWARD_BUDGET_PILL = process.env.REWARD_BUDGET_PILL || '50000000';
process.env.REWARD_FACTOR = process.env.REWARD_FACTOR || '12';
delete process.env.TREASURY_PROGRAM;

const {
    Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, getAccount,
    transfer, getMint,
} = require('@solana/spl-token');

const solana = require('../server/solana.js');
const lb = require('../server/leaderboard.js');
const rewards = require('../server/rewards.js');
const matches = require('../server/matches.js');
const rake = require('../server/rake.js');

const DEC = solana.DECIMALS;
const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

let ok = 0, mal = 0;
const bien = (t) => { ok++; console.log('  OK    ' + t); };
const falla = (t, e) => { mal++; console.log('  FALLA ' + t + (e ? '\n         ' + e : '')); };

async function debeIr(t, fn) {
    try { const r = await fn(); bien(t); return r; }
    catch (e) { falla(t, e.message); throw e; }
}
async function debeFallar(t, fn, siPasa) {
    try { await fn(); falla(t + ' — NO fallo. ' + siPasa); }
    catch (e) { bien(t + ' — rechazado'); }
}

const arg = (n, def) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : def; };

/* La wallet de premios: se guarda para poder repetir la prueba con la misma. */
function walletDePremios() {
    const f = path.join(__dirname, '.rewards-wallet.json');
    if (fs.existsSync(f)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))));
    const kp = Keypair.generate();
    fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)));
    console.log('  (creada scripts/.rewards-wallet.json)');
    return kp;
}

async function main() {
    const c = new Connection(solana.RPC, 'confirmed');
    const auth = (() => {
        const f = path.join(__dirname, '.devnet-authority.json');
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))));
    })();
    const mint = new PublicKey(solana.MINT);
    const pct = parseFloat(arg('pct', '15'));

    console.log('RPC       :', solana.RPC);
    console.log('Mint      :', solana.MINT);
    console.log('');

    /* ===================== 1. LA WALLET DE PREMIOS ===================== */
    console.log('1. LA WALLET DE PREMIOS');
    const premios = walletDePremios();
    process.env.REWARDS_SECRET = JSON.stringify(Array.from(premios.secretKey));
    console.log('  Wallet   :', premios.publicKey.toBase58());

    const supply = Number((await getMint(c, mint)).supply) / 10 ** DEC;
    const objetivo = Math.floor(supply * pct / 100);
    console.log(`  Supply   : ${fmt(supply)} $PILL`);
    console.log(`  Asignado : ${fmt(objetivo)} $PILL (${pct}%)`);

    await debeIr(`la wallet de premios tiene el ${pct}% del supply`, async () => {
        // SOL para el gas: un ganador sin SOL tiene que poder cobrar, asi que el gas
        // lo pone esta wallet.
        if ((await c.getBalance(premios.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
            const tx = new Transaction().add(SystemProgram.transfer({
                fromPubkey: auth.publicKey, toPubkey: premios.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL }));
            tx.feePayer = auth.publicKey;
            tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
            tx.sign(auth);
            await c.confirmTransaction(await c.sendRawTransaction(tx.serialize()), 'confirmed');
        }
        const suAta = await getOrCreateAssociatedTokenAccount(c, auth, mint, premios.publicKey);
        const tiene = Number(suAta.amount) / 10 ** DEC;
        if (tiene < objetivo) {
            const miAta = await getOrCreateAssociatedTokenAccount(c, auth, mint, auth.publicKey);
            const falta = objetivo - tiene;
            await transfer(c, auth, miAta.address, suAta.address, auth,
                BigInt(Math.round(falta * 10 ** DEC)));
        }
        const ahora = Number((await getAccount(c, suAta.address)).amount) / 10 ** DEC;
        console.log(`  Saldo    : ${fmt(ahora)} $PILL`);
        if (ahora < objetivo * 0.999) throw new Error(`solo tiene ${fmt(ahora)}`);
    });

    /* ===================== 2. UN DIA CON GANADORES ===================== */
    console.log('');
    console.log('2. UN DIA DE LEADERBOARD, CERRADO Y ANCLADO');

    // Cuatro ganadores de verdad: wallets nuevas, sin SOL y sin cuenta de token.
    // Es el caso realista y el que mas facil se rompe.
    const ganadores = Array.from({ length: 4 }, () => Keypair.generate());
    const FECHA = '2026-09-04';
    const t = Date.parse(FECHA + 'T12:00:00Z');

    rake.alStaking(500000, 'exit fees del dia', t);
    matches.registra({
        room: 'classic_5$_L1', mode: 'classic', startedAt: t - 300000, endedAt: t,
        entryFee: 1160, pot: 0,
        players: ganadores.map((g, i) => ({
            wallet: g.publicKey.toBase58(), name: 'ganador' + i, kills: 8 - i, peak: 1, paid: true, isTester: false,
        })),
    });
    ganadores.forEach((g, i) => {
        for (let k = 0; k < 12 - i; k++) lb.recordKill(g.publicKey.toBase58(), 'ganador' + i);
        lb.recordPeak(g.publicKey.toBase58(), 9000 - i * 100, 'ganador' + i);
    });
    lb._setFecha(FECHA);
    const snap = lb.cerrarAhora();
    console.log(`  Dia ${FECHA} cerrado con ${snap.entries.length} elegibles`);

    const ronda = rewards.prepararRonda(FECHA, rewards.pillToRaw(50000000));
    if (!ronda) throw new Error('no salio ronda: revisa el rake o el minimo de kills');
    const lista = rewards.rondaPublica(ronda.epoch).entries;
    console.log(`  Bote: ${fmt(rewards.rawToPill(ronda.totalRaw))} $PILL para ${lista.length} ganadores`);

    await debeFallar('pagar ANTES de anclar el dia', async () => {
        const r = await rewards.pagarUno(ronda.epoch, lista[0].wallet, solana, null);
        if (!r.ok) throw new Error(r.error);
    }, 'el reparto no se podria contrastar con nada.');

    const ancla = await debeIr('anclar el hash del dia en la cadena', async () => {
        const r = await lb.anclarDia(FECHA, solana, null);
        if (!r.ok) throw new Error(r.error);
        console.log('  Ancla:', r.sig);
        return r;
    });

    /* ===================== 3. EL GANADOR COBRA ===================== */
    console.log('');
    console.log('3. UN GANADOR RECLAMA Y COBRA');

    const primero = lista[0];
    const suPill = rewards.rawToPill(primero.amountRaw);
    console.log(`  #${primero.rank} ${primero.wallet.slice(0, 8)}… le tocan ${fmt(suPill)} $PILL`);

    const recibo = await debeIr('el servidor le paga desde la wallet de premios', async () => {
        const r = await rewards.pagarUno(ronda.epoch, primero.wallet, solana, null);
        if (!r.ok) throw new Error(r.error);
        console.log('  Pago :', r.sig);
        return r;
    });

    await debeIr('los tokens estan en la wallet del ganador, en la cadena', async () => {
        const ata = getAssociatedTokenAddressSync(mint, new PublicKey(primero.wallet), true);
        const saldo = Number((await getAccount(c, ata)).amount) / 10 ** DEC;
        if (Math.abs(saldo - suPill) > 0.000001) throw new Error(`tiene ${fmt(saldo)}, esperaba ${fmt(suPill)}`);
        console.log(`  Saldo del ganador: ${fmt(saldo)} $PILL`);
    });

    await debeIr('el ganador no necesitaba SOL ni cuenta de token', async () => {
        // Es la razon de que pague el servidor y no firme el ganador: alguien que
        // acaba de ganar su primer premio no tiene SOL para el gas ni ATA creada.
        const sol = await c.getBalance(new PublicKey(primero.wallet));
        if (sol !== 0) throw new Error(`la wallet tiene ${sol} lamports: la prueba no vale`);
    });

    await debeIr('sale de la wallet de premios y de ninguna otra', async () => {
        const tx = await c.getTransaction(recibo.sig, { maxSupportedTransactionVersion: 0 });
        const claves = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
        const firmante = claves[0].toBase58();
        if (firmante !== premios.publicKey.toBase58()) {
            throw new Error(`pago ${firmante} y no la wallet de premios`);
        }
    });

    /* ===================== 4. LO QUE NO PUEDE PASAR ===================== */
    console.log('');
    console.log('4. LO QUE NO PUEDE PASAR');

    await debeFallar('cobrar dos veces el mismo dia', async () => {
        const r = await rewards.pagarUno(ronda.epoch, primero.wallet, solana, null);
        if (!r.ok) throw new Error(r.error);
    }, 'se podria vaciar la asignacion repitiendo el claim.');

    await debeFallar('cobrar sin salir en la lista anclada', async () => {
        const intruso = Keypair.generate().publicKey.toBase58();
        const r = await rewards.pagarUno(ronda.epoch, intruso, solana, null);
        if (!r.ok) throw new Error(r.error);
    }, 'el destino lo elegiria quien pide el pago, no la lista.');

    /* ===================== 5. LO QUE VE CUALQUIERA ===================== */
    console.log('');
    console.log('5. LO QUE PUEDE COMPROBAR CUALQUIERA');
    console.log('  Lista anclada  : https://solscan.io/tx/' + ancla.sig + '?cluster=devnet');
    console.log('  Pago al ganador: https://solscan.io/tx/' + recibo.sig + '?cluster=devnet');
    console.log('  Wallet premios : https://solscan.io/account/' + premios.publicKey.toBase58() + '?cluster=devnet');
    console.log('  Ganador        : https://solscan.io/account/' + primero.wallet + '?cluster=devnet');
    console.log('');
    console.log('  El hash de la clasificacion se anclo ANTES de mover un token, asi que');
    console.log('  el pago se puede contrastar con una lista que ya era publica.');

    console.log('');
    console.log(`RESULTADO: ${ok} bien, ${mal} mal`);
    if (mal > 0) process.exitCode = 1;
}

main()
    .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1; })
    .finally(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} });
