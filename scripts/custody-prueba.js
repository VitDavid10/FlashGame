/*
 * EJERCICIO COMPLETO DE LA CUSTODIA CONTRA UNA CADENA DE VERDAD.
 *
 *   node scripts/custody.js prueba <programa> [--mint <mint>]
 *
 * Sirve para un validador local o para devnet. Lo que comprueba no es que el
 * contrato haga lo que debe —eso lo hace cualquier ejemplo— sino que se NIEGUE a lo
 * que no debe, que es donde los contratos simples pierden el dinero de todos:
 *
 *   1. inicializar dos veces
 *   2. inicializar sin ser el DEPLOYER compilado
 *   3. depositar un token que no es el mint del programa
 *   4. retirar a una cuenta que no es la del jugador
 *   5. retirar sin la firma del jugador
 *   6. retirar sin la firma de la autoridad
 *   7. retirar mas de lo que hay
 *
 * Un contrato que pasa los casos buenos no esta probado. Lo esta uno que ademas
 * rechaza los siete de arriba, y por eso este script falla si alguno NO revierte.
 */
'use strict';

const {
    Connection, Keypair, PublicKey, Transaction, SystemProgram,
} = require('@solana/web3.js');
const {
    createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
    getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

const cc = require('../server/custody-client.js');

const DEC = 6;
const aRaw = (pill) => BigInt(Math.round(Number(pill) * 10 ** DEC));
const aPill = (raw) => Number(BigInt(raw)) / 10 ** DEC;

let ok = 0, mal = 0;
const bien = (t) => { ok++; console.log('  OK   ' + t); };
const falla = (t, e) => { mal++; console.log('  FALLA ' + t + (e ? '\n         ' + e : '')); };

async function manda(c, ixs, firmantes) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = firmantes[0].publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(...firmantes);
    const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await c.confirmTransaction(sig, 'confirmed');
    return sig;
}

/*
 * Un caso que TIENE que revertir. Si pasa, es un agujero: se anota como fallo y se
 * dice exactamente que consiguio hacer, porque "la transaccion paso" no explica nada.
 */
async function debeFallar(titulo, fn, queSignificaSiPasa) {
    try {
        await fn();
        falla(titulo + ' — NO revirtio. ' + queSignificaSiPasa);
    } catch (e) {
        bien(titulo + ' — rechazado');
    }
}

async function debeIr(titulo, fn) {
    try { const r = await fn(); bien(titulo); return r; }
    catch (e) { falla(titulo, e.message); throw e; }
}

async function run(pos, argv) {
    const programa = pos[0];
    if (!programa) throw new Error('uso: node scripts/custody.js prueba <programa> [--mint <mint>]');
    const rpc = process.env.SOL_RPC || 'http://127.0.0.1:8899';
    const c = new Connection(rpc, 'confirmed');
    const i = argv.indexOf('--mint');
    let mint = i >= 0 ? new PublicKey(argv[i + 1]) : null;

    const pagador = require('./custody.js').autoridad();   // la que va compilada en DEPLOYER
    console.log('RPC      :', rpc);
    console.log('Programa :', programa);
    console.log('Pagador  :', pagador.publicKey.toBase58());

    // Saldo para las comisiones. En un validador local se pide y ya.
    const saldo = await c.getBalance(pagador.publicKey);
    if (saldo < 1e8) {
        try {
            const s = await c.requestAirdrop(pagador.publicKey, 2e9);
            await c.confirmTransaction(s, 'confirmed');
        } catch (e) { console.log('(sin airdrop: ' + e.message + ')'); }
    }

    /* --- Un token de mentira para la prueba, si no dan uno --- */
    if (!mint) {
        mint = await createMint(c, pagador, pagador.publicKey, null, DEC);
        console.log('Mint     :', mint.toBase58(), '(creado para la prueba)');
    } else {
        console.log('Mint     :', mint.toBase58());
    }
    const miAta = await getOrCreateAssociatedTokenAccount(c, pagador, mint, pagador.publicKey);
    await mintTo(c, pagador, mint, miAta.address, pagador, Number(aRaw(1000)));

    const { config, custody } = cc.pdas(programa);
    console.log('Config   :', config.toBase58());
    console.log('Boveda   :', custody.toBase58());
    console.log('');

    /* ===================== LO QUE TIENE QUE FUNCIONAR ===================== */
    console.log('LO QUE TIENE QUE FUNCIONAR');

    const yaEsta = await c.getAccountInfo(config);
    if (!yaEsta) {
        await debeIr('initialize crea config y boveda', () => manda(c, [
            cc.initialize(programa, { mint, authority: pagador.publicKey, payer: pagador.publicKey }),
        ], [pagador]));
    } else {
        console.log('  (ya estaba inicializado, sigo)');
    }

    await debeIr('deposit mueve 100 PILL a la boveda', async () => {
        const antes = (await getAccount(c, custody)).amount;
        await manda(c, [cc.deposit(programa, {
            from: miAta.address, owner: pagador.publicKey, amountRaw: aRaw(100),
        })], [pagador]);
        const despues = (await getAccount(c, custody)).amount;
        if (despues - antes !== aRaw(100)) throw new Error(`la boveda subio ${aPill(despues - antes)}, no 100`);
    });

    // Un jugador de verdad, con su propia llave.
    const jugador = Keypair.generate();
    await debeIr('withdraw manda 40 PILL a la cuenta asociada del jugador', async () => {
        const ata = getAssociatedTokenAddressSync(mint, jugador.publicKey, true);
        // La ATA la crea quien paga; el jugador no necesita ni un lamport.
        await manda(c, [createAssociatedTokenAccountInstruction(
            pagador.publicKey, ata, jugador.publicKey, mint)], [pagador]);
        await manda(c, [cc.withdraw(programa, {
            player: jugador.publicKey, mint, authority: pagador.publicKey, amountRaw: aRaw(40),
        })], [pagador, jugador]);
        const saldoJ = (await getAccount(c, ata)).amount;
        if (saldoJ !== aRaw(40)) throw new Error(`el jugador tiene ${aPill(saldoJ)}, no 40`);
    });

    await debeIr('los contadores cuadran con el saldo de la boveda', async () => {
        const cfg = cc.decodeConfig((await c.getAccountInfo(config)).data);
        const enBoveda = (await getAccount(c, custody)).amount;
        const esperado = BigInt(cfg.totalDeposited) - BigInt(cfg.totalWithdrawn);
        if (enBoveda !== esperado) {
            throw new Error(`boveda ${aPill(enBoveda)} vs deposit-withdraw ${aPill(esperado)}`);
        }
    });

    /* ===================== LO QUE TIENE QUE FALLAR ===================== */
    console.log('');
    console.log('LO QUE TIENE QUE FALLAR');

    await debeFallar('initialize por segunda vez', () => manda(c, [
        cc.initialize(programa, { mint, authority: pagador.publicKey, payer: pagador.publicKey }),
    ], [pagador]), 'la config se podria reescribir y con ella la autoridad.');

    const intruso = Keypair.generate();
    await debeFallar('initialize desde otra wallet (no es DEPLOYER)', async () => {
        const s = await c.requestAirdrop(intruso.publicKey, 1e9);
        await c.confirmTransaction(s, 'confirmed');
        await manda(c, [cc.initialize(programa, {
            mint, authority: intruso.publicKey, payer: intruso.publicKey,
        })], [intruso]);
    }, 'cualquiera podria quedarse el programa recien desplegado.');

    await debeFallar('deposit con un token que no es el mint del programa', async () => {
        const otro = await createMint(c, pagador, pagador.publicKey, null, DEC);
        const ata = await getOrCreateAssociatedTokenAccount(c, pagador, otro, pagador.publicKey);
        await mintTo(c, pagador, otro, ata.address, pagador, Number(aRaw(500)));
        await manda(c, [cc.deposit(programa, {
            from: ata.address, owner: pagador.publicKey, amountRaw: aRaw(500),
        })], [pagador]);
    }, 'se podria depositar un token sin valor y retirar PILL.');

    await debeFallar('withdraw a una cuenta que no es la del jugador', async () => {
        // El destino no lo elige quien firma: sale de la direccion del jugador.
        const ix = cc.withdraw(programa, {
            player: jugador.publicKey, mint, authority: pagador.publicKey, amountRaw: aRaw(10),
        });
        ix.keys[2] = { pubkey: miAta.address, isSigner: false, isWritable: true };
        await manda(c, [ix], [pagador, jugador]);
    }, 'un retiro se podria desviar a otra wallet.');

    await debeFallar('withdraw sin la firma del jugador', async () => {
        const ix = cc.withdraw(programa, {
            player: jugador.publicKey, mint, authority: pagador.publicKey, amountRaw: aRaw(10),
        });
        await manda(c, [ix], [pagador]);
    }, 'la autoridad podria vaciar saldos sin que el dueno se entere.');

    await debeFallar('withdraw sin la firma de la autoridad', async () => {
        const ix = cc.withdraw(programa, {
            player: jugador.publicKey, mint, authority: intruso.publicKey, amountRaw: aRaw(10),
        });
        await manda(c, [ix], [intruso, jugador]);
    }, 'cualquiera podria sacar de la boveda con solo firmar el.');

    await debeFallar('withdraw de mas de lo que hay en la boveda', () => manda(c, [
        cc.withdraw(programa, {
            player: jugador.publicKey, mint, authority: pagador.publicKey, amountRaw: aRaw(1000000),
        }),
    ], [pagador, jugador]), 'la boveda quedaria en negativo o robaria de otra cuenta.');

    console.log('');
    console.log(`RESULTADO: ${ok} bien, ${mal} mal`);
    if (mal > 0) {
        console.log('');
        console.log('NO revoques la upgrade authority con esto asi: un fallo aqui es dinero');
        console.log('de los jugadores que se queda encerrado para siempre.');
        process.exitCode = 1;
    }
}

module.exports = { run };
