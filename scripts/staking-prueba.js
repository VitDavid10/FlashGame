/*
 * EJERCICIO COMPLETO DEL STAKING CONTRA UNA CADENA DE VERDAD.
 *
 *   node scripts/staking.js prueba <programa> [--mint <mint>]
 *
 * Igual que el de la custodia: lo que importa no es que funcione, sino que se NIEGUE
 * a lo que no debe. En un pool de staking los agujeros caros son estos:
 *
 *   1. retirar sin esperar el enfriamiento
 *   2. retirar a una cuenta que no es la del dueno
 *   3. tocar la posicion de otro
 *   4. pedir salir de mas de lo que se tiene dentro
 *   5. llenar el pozo sin ser la autoridad (recalcula el ritmo: fastidia a todos)
 *   6. un periodo de goteo demasiado corto (equivale a repartir de golpe)
 *   7. cobrar sin tener nada pendiente
 *
 * Y ademas se comprueba lo que la interfaz ENSENA: que el pendiente calculado en JS
 * coincide con lo que paga el programa. Si esas dos cuentas se separan, el usuario ve
 * un numero, cobra otro, y piensa que le han robado.
 */
'use strict';

const {
    Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
    getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');

const sc = require('../server/staking-client.js');

const DEC = 6;
const aRaw = (pill) => BigInt(Math.round(Number(pill) * 10 ** DEC));
const aPill = (raw) => Number(BigInt(raw)) / 10 ** DEC;

let ok = 0, mal = 0, dudoso = 0;
const bien = (t) => { ok++; console.log('  OK    ' + t); };
const falla = (t, e) => { mal++; console.log('  FALLA ' + t + (e ? '\n         ' + e : '')); };
const sinProbar = (t) => { dudoso++; console.log('  ¿?    ' + t); };

async function manda(c, ixs, firmantes) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = firmantes[0].publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(...firmantes);
    const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await c.confirmTransaction(sig, 'confirmed');
    return sig;
}

async function debeIr(titulo, fn) {
    try { const r = await fn(); bien(titulo); return r; }
    catch (e) { falla(titulo, e.message); throw e; }
}

/* Un rechazo por el motivo equivocado es un test que miente: `porQueNoVale` marca
 * esos casos como no probados en vez de darlos por buenos. */
async function debeFallar(titulo, fn, siPasa, porQueNoVale) {
    try {
        await fn();
        falla(titulo + ' — NO revirtio. ' + siPasa);
    } catch (e) {
        const logs = ((e.logs || []).join('\n') + '\n' + (e.message || ''));
        if (porQueNoVale && porQueNoVale.test(logs)) { sinProbar(titulo + ' — revirtio por otro motivo'); return; }
        bien(titulo + ' — rechazado');
    }
}

async function run(pos, argv) {
    const programa = pos[0];
    if (!programa) throw new Error('uso: node scripts/staking.js prueba <programa> [--mint <mint>]');
    const rpc = process.env.SOL_RPC || 'https://api.devnet.solana.com';
    const c = new Connection(rpc, 'confirmed');
    const i = argv.indexOf('--mint');
    let mint = i >= 0 ? new PublicKey(argv[i + 1]) : null;

    const pagador = require('./staking.js').autoridad();
    console.log('RPC      :', rpc);
    console.log('Programa :', programa);
    console.log('Pagador  :', pagador.publicKey.toBase58());

    if (!mint) {
        mint = await createMint(c, pagador, pagador.publicKey, null, DEC);
        console.log('Mint     :', mint.toBase58(), '(creado para la prueba)');
    } else {
        console.log('Mint     :', mint.toBase58());
    }
    const miAta = await getOrCreateAssociatedTokenAccount(c, pagador, mint, pagador.publicKey);
    try { await mintTo(c, pagador, mint, miAta.address, pagador, Number(aRaw(10000))); } catch (e) {}

    const { config, stakeVault, rewardVault } = sc.pdas(programa);
    console.log('Config   :', config.toBase58());
    console.log('Principal:', stakeVault.toBase58());
    console.log('Pozo     :', rewardVault.toBase58());
    console.log('');

    /* ===================== LO QUE TIENE QUE FUNCIONAR ===================== */
    console.log('LO QUE TIENE QUE FUNCIONAR');

    if (!(await c.getAccountInfo(config))) {
        await debeIr('initialize crea la config y las dos bovedas', () => manda(c, [
            sc.initialize(programa, { mint, authority: pagador.publicKey, payer: pagador.publicKey }),
        ], [pagador]));
    } else {
        console.log('  (ya estaba inicializado, sigo)');
    }

    await debeIr('stake mete 1000 PILL en la boveda del principal', async () => {
        const antes = (await getAccount(c, stakeVault)).amount;
        await manda(c, [sc.stake(programa, {
            from: miAta.address, owner: pagador.publicKey, amountRaw: aRaw(1000),
        })], [pagador]);
        const dif = (await getAccount(c, stakeVault)).amount - antes;
        if (dif !== aRaw(1000)) throw new Error(`entraron ${aPill(dif)}, no 1000`);
    });

    // Goteo corto para que el rendimiento se vea en la propia prueba.
    await debeIr('fund_rewards llena el pozo y arranca el goteo', async () => {
        await manda(c, [sc.fundRewards(programa, {
            from: miAta.address, authority: pagador.publicKey, amountRaw: aRaw(360), duration: 3600,
        })], [pagador]);
        const cfg = sc.decodeConfig((await c.getAccountInfo(config)).data);
        if (BigInt(cfg.rewardRate) <= 0n) throw new Error('el ritmo se quedo a cero');
    });

    await debeIr('el pendiente sube con el tiempo y NO se paga de golpe', async () => {
        // Lo caro de equivocarse aqui es soltar el pozo entero al llamar: quien
        // stakea un segundo antes se lleva el dia completo y sale.
        const cfg = sc.decodeConfig((await c.getAccountInfo(config)).data);
        const acc = sc.decodeStakeAccount((await c.getAccountInfo(sc.stakeAccount(programa, pagador.publicKey))).data);
        const t0 = cfg.lastUpdate;
        const en10s = BigInt(sc.pendienteAhora(cfg, acc, t0 + 10));
        const en100s = BigInt(sc.pendienteAhora(cfg, acc, t0 + 100));
        if (!(en100s > en10s)) throw new Error('el pendiente no crece con el tiempo');
        // 0,1 PILL/s durante 3600 s = 360. En 10 s no puede haber mas de ~1.
        if (en10s > aRaw(5)) throw new Error(`en 10 s ya habia ${aPill(en10s)} PILL: se solto de golpe`);
    });

    await debeIr('lo que ensena la interfaz es lo que paga el programa', async () => {
        /*
         * pendienteAhora() rehace en JS la cuenta del contrato. Si las dos se separan,
         * el usuario ve un numero y cobra otro.
         */
        const antesAta = (await getAccount(c, miAta.address)).amount;
        const cfg = sc.decodeConfig((await c.getAccountInfo(config)).data);
        const acc = sc.decodeStakeAccount((await c.getAccountInfo(sc.stakeAccount(programa, pagador.publicKey))).data);
        const previsto = BigInt(sc.pendienteAhora(cfg, acc, Math.floor(Date.now() / 1000)));
        await manda(c, [sc.claimRewards(programa, { owner: pagador.publicKey, mint })], [pagador]);
        const cobrado = (await getAccount(c, miAta.address)).amount - antesAta;
        // Unos segundos de diferencia entre la lectura y el bloque son inevitables.
        const margen = BigInt(cfg.rewardRate) * 30n;
        const dif = cobrado > previsto ? cobrado - previsto : previsto - cobrado;
        if (dif > margen) {
            throw new Error(`la interfaz decia ${aPill(previsto)} y pago ${aPill(cobrado)}`);
        }
    });

    await debeIr('request_unstake saca del rendimiento sin mover tokens', async () => {
        const antes = (await getAccount(c, stakeVault)).amount;
        await manda(c, [sc.requestUnstake(programa, {
            owner: pagador.publicKey, amountRaw: aRaw(400),
        })], [pagador]);
        const despues = (await getAccount(c, stakeVault)).amount;
        if (despues !== antes) throw new Error('ha movido tokens, y no debe');
        const cfg = sc.decodeConfig((await c.getAccountInfo(config)).data);
        const acc = sc.decodeStakeAccount((await c.getAccountInfo(sc.stakeAccount(programa, pagador.publicKey))).data);
        if (BigInt(acc.unstaking) !== aRaw(400)) throw new Error('no ha apuntado la salida');
        // Y lo pedido deja de contar para el reparto en el acto: si siguiera contando,
        // el resto de stakers cobraria menos por unos tokens que ya estan de salida.
        if (BigInt(cfg.totalStaked) !== BigInt(acc.amount)) {
            throw new Error(`total_staked ${aPill(cfg.totalStaked)} no cuadra con lo que rinde ${aPill(acc.amount)}`);
        }
    });

    await debeIr('compound mete lo ganado en el principal sin pasar por la wallet', async () => {
        const antesAta = (await getAccount(c, miAta.address)).amount;
        const antesVault = (await getAccount(c, stakeVault)).amount;
        await manda(c, [sc.compound(programa, { owner: pagador.publicKey })], [pagador]);
        const ata = (await getAccount(c, miAta.address)).amount;
        const vault = (await getAccount(c, stakeVault)).amount;
        if (ata !== antesAta) throw new Error('ha pasado por la wallet, y no debe');
        if (!(vault > antesVault)) throw new Error('el principal no ha subido');
    });

    /* ===================== LO QUE TIENE QUE FALLAR ===================== */
    console.log('');
    console.log('LO QUE TIENE QUE FALLAR');

    await debeFallar('withdraw_unstaked antes de que pase el enfriamiento', () => manda(c, [
        sc.withdrawUnstaked(programa, { owner: pagador.publicKey, mint }),
    ], [pagador]), 'se podria entrar el dia del reparto y salir al siguiente.');

    const intruso = Keypair.generate();
    await manda(c, [SystemProgram.transfer({
        fromPubkey: pagador.publicKey, toPubkey: intruso.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL,
    })], [pagador]);

    await debeFallar('tocar la posicion de otro (request_unstake ajeno)', async () => {
        const ix = sc.requestUnstake(programa, { owner: pagador.publicKey, amountRaw: aRaw(1) });
        // Mismo PDA de posicion, pero firma el intruso.
        ix.keys[2] = { pubkey: intruso.publicKey, isSigner: true, isWritable: false };
        await manda(c, [ix], [intruso]);
    }, 'cualquiera podria sacar el principal de otro.');

    await debeFallar('retirar a una cuenta que no es la del dueno', async () => {
        const ix = sc.withdrawUnstaked(programa, { owner: pagador.publicKey, mint });
        ix.keys[3] = { pubkey: getAssociatedTokenAddressSync(mint, intruso.publicKey, true), isSigner: false, isWritable: true };
        await manda(c, [ix], [pagador]);
    }, 'el principal se podria desviar a otra wallet.');

    await debeFallar('pedir salir de mas de lo que se tiene dentro', () => manda(c, [
        sc.requestUnstake(programa, { owner: pagador.publicKey, amountRaw: aRaw(999999) }),
    ], [pagador]), 'la boveda quedaria a deber, o robaria del principal de otro.');

    await debeFallar('llenar el pozo sin ser la autoridad', async () => {
        const suAta = await getOrCreateAssociatedTokenAccount(c, pagador, mint, intruso.publicKey);
        await mintTo(c, pagador, mint, suAta.address, pagador, Number(aRaw(10)));
        await manda(c, [sc.fundRewards(programa, {
            from: suAta.address, authority: intruso.publicKey, amountRaw: aRaw(10), duration: 30 * 86400,
        })], [intruso]);
    }, 'cualquiera podria estirar el reparto a un mes y fastidiar a todos los stakers.');

    await debeFallar('un goteo mas corto que el minimo', () => manda(c, [
        sc.fundRewards(programa, {
            from: miAta.address, authority: pagador.publicKey, amountRaw: aRaw(1), duration: 60,
        }),
    ], [pagador]), 'repartir en un minuto es casi repartir de golpe.');

    await debeFallar('cobrar sin tener nada pendiente', async () => {
        const nadie = Keypair.generate();
        await manda(c, [SystemProgram.transfer({
            fromPubkey: pagador.publicKey, toPubkey: nadie.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL,
        })], [pagador]);
        await manda(c, [sc.claimRewards(programa, { owner: nadie.publicKey, mint })], [nadie]);
    }, 'se podria cobrar sin haber stakeado nunca.');

    console.log('');
    console.log(`RESULTADO: ${ok} bien, ${mal} mal` + (dudoso ? `, ${dudoso} sin probar` : ''));
    if (mal > 0) {
        console.log('');
        console.log('NO revoques la upgrade authority con esto asi: aqui el principal es');
        console.log('dinero de los stakers y un fallo lo deja encerrado para siempre.');
        process.exitCode = 1;
    }
}

module.exports = { run };
