#!/usr/bin/env node
/*
 * VARIAS WALLETS STAKEANDO, PARA VER UN APR QUE SIGNIFIQUE ALGO.
 *
 *   node scripts/simular-stakers.js [TOTAL_PILL] [CUANTAS]
 *   node scripts/simular-stakers.js 1000000 20      <- por defecto
 *
 * Con una sola wallet dentro, el APR no mide nada: sale del goteo dividido entre
 * lo stakeado, asi que con 60.000 PILL y el pozo lleno da 1878%. El numero es
 * correcto y no sirve para nada — no se puede juzgar si la economia funciona
 * mirando una division por casi cero.
 *
 * Esto mete gente de verdad en la cadena: wallets nuevas, cada una con su saldo y
 * su posicion, firmando su propio stake. No es un mock del servidor; despues de
 * correrlo el contrato tiene ese dinero dentro y el APR que sale es el que veria
 * cualquiera.
 *
 * EL REPARTO NO ES A PARTES IGUALES. Veinte wallets con 50.000 cada una no se
 * parece a nada: en un pool real hay dos o tres que llevan la mitad y una cola
 * larga de gente con poco. Se usan pesos 1/n, que dan justo esa forma — la
 * primera se lleva el 28% y la ultima el 1,4%.
 *
 * LAS CLAVES SE GUARDAN en scripts/.stakers-devnet.json (en .gitignore). Son
 * wallets de prueba de devnet, pero sin guardarlas el dinero que se mete queda
 * dentro del contrato sin nadie que pueda sacarlo.
 */
'use strict';

const fs = require('fs');
const path = require('path');

require('./env-del-servicio.js').carga();

const solana = require('../server/solana.js');
const staking = require('../server/staking.js');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction,
        sendAndConfirmTransaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');

const FICHERO = path.join(__dirname, '.stakers-devnet.json');

const TOTAL = Number(process.argv[2] || 1000000);
const CUANTAS = Number(process.argv[3] || 20);
/*
 * SOL por wallet. No es gas: es la fianza de la cuenta de posicion, que la crea
 * el contrato con el DUENO de payer — la autoridad no puede ponerla por el. Con
 * menos, el stake falla a mitad de la tanda y quedan wallets con tokens y sin
 * posicion, que es el peor sitio donde parar.
 */
const SOL_POR_WALLET = 0.01;

const cl = /devnet/i.test(solana.RPC) ? '?cluster=devnet' : '';
const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 0 });

/** Pesos 1/n normalizados: unos pocos grandes y una cola larga. */
function reparto(total, n) {
    const pesos = Array.from({ length: n }, (_, i) => 1 / (i + 1));
    const suma = pesos.reduce((a, b) => a + b, 0);
    const out = pesos.map(p => Math.floor((total * p) / suma));
    // El redondeo hacia abajo deja unos PILL sueltos; van a la primera, que es la
    // que menos se nota y evita que el total no cuadre con lo que se pidio.
    out[0] += total - out.reduce((a, b) => a + b, 0);
    return out;
}

async function main() {
    console.log('RPC     :', solana.RPC);
    console.log('Staking :', staking.PROGRAMA || '(sin desplegar)');
    if (!staking.PROGRAMA) {
        console.log('');
        console.log('Sin STAKING_PROGRAM no hay donde stakear.');
        process.exitCode = 1;
        return;
    }
    if (!solana.canWithdraw()) {
        console.log('');
        console.log('No hay clave de autoridad, y de ahi sale el dinero:', solana.porQueNoFirma());
        process.exitCode = 1;
        return;
    }

    const conn = new Connection(solana.RPC, 'confirmed');
    const autoridad = solana.loadAuthority();
    const mint = new PublicKey(solana.MINT);

    // Lo que hace falta, ANTES de crear nada. Una tanda a medias deja wallets con
    // tokens y sin posicion, y hay que ir a buscarlas a mano.
    const origen = await getOrCreateAssociatedTokenAccount(conn, autoridad, mint, autoridad.publicKey);
    const tienePill = Number(origen.amount) / 10 ** solana.DECIMALS;
    const tieneSol = (await conn.getBalance(autoridad.publicKey)) / 1e9;
    const solHace = CUANTAS * SOL_POR_WALLET + 0.05;
    console.log('');
    console.log('La autoridad tiene :', fmt(tienePill), 'PILL y', tieneSol.toFixed(3), 'SOL');
    console.log('Hace falta         :', fmt(TOTAL), 'PILL y', solHace.toFixed(3), 'SOL');
    if (tienePill < TOTAL) { console.log('\nNo llega el $PILL.'); process.exitCode = 1; return; }
    if (tieneSol < solHace) { console.log('\nNo llega el SOL.'); process.exitCode = 1; return; }

    const cantidades = reparto(TOTAL, CUANTAS);
    const previas = fs.existsSync(FICHERO) ? JSON.parse(fs.readFileSync(FICHERO, 'utf8')) : [];
    const guardadas = previas.slice();

    console.log('');
    console.log('REPARTO');
    for (let i = 0; i < CUANTAS; i++) {
        const pct = (cantidades[i] * 100 / TOTAL).toFixed(1);
        console.log(`  #${String(i + 1).padStart(2)}  ${fmt(cantidades[i]).padStart(9)} PILL  ${pct.padStart(5)}%`);
    }

    console.log('');
    console.log('METIENDOLAS');
    let dentro = 0;
    for (let i = 0; i < CUANTAS; i++) {
        const w = Keypair.generate();
        const pill = cantidades[i];
        try {
            // 1. La fianza de su cuenta de posicion.
            await sendAndConfirmTransaction(conn, new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: autoridad.publicKey, toPubkey: w.publicKey,
                    lamports: Math.round(SOL_POR_WALLET * 1e9),
                })), [autoridad]);

            // 2. Sus $PILL. La cuenta la paga la autoridad: la wallet nueva solo
            //    tiene lo justo para su posicion.
            const suya = await getOrCreateAssociatedTokenAccount(conn, autoridad, mint, w.publicKey);
            await transfer(conn, autoridad, origen.address, suya.address, autoridad,
                BigInt(Math.round(pill * 10 ** solana.DECIMALS)));

            // 3. Y stakea ELLA. La autoridad no firma aqui: el contrato exige la
            //    firma del dueno, que es justo lo que hace que el principal sea suyo.
            const ix = staking.ix('stake', {
                wallet: w.publicKey.toBase58(), from: suya.address.toBase58(),
                amountRaw: BigInt(Math.round(pill * 10 ** solana.DECIMALS)),
            });
            const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [w]);

            guardadas.push({ wallet: w.publicKey.toBase58(), secret: Array.from(w.secretKey), pill });
            fs.writeFileSync(FICHERO, JSON.stringify(guardadas), { mode: 0o600 });
            dentro += pill;
            console.log(`  #${String(i + 1).padStart(2)}  ${fmt(pill).padStart(9)} PILL  ${w.publicKey.toBase58().slice(0, 8)}…  ${sig.slice(0, 16)}…`);
        } catch (e) {
            console.log(`  #${String(i + 1).padStart(2)}  FALLO: ${e.message}`);
        }
    }

    // El estado que se ve en el juego, leido de la cadena y no de lo que creemos
    // haber metido: si alguna fallo, aqui se nota.
    const p = staking.pdas();
    const info = await conn.getAccountInfo(p.config);
    console.log('');
    console.log('COMO QUEDA');
    console.log('  Metido en esta tanda :', fmt(dentro), 'PILL');
    if (info) {
        const cfg = staking.decodeConfig(info.data);
        const total = Number(cfg.totalStaked) / 10 ** solana.DECIMALS;
        const porDia = Number(cfg.rewardRate) * 86400 / 10 ** solana.DECIMALS;
        console.log('  Stakeado en total    :', fmt(total), 'PILL');
        console.log('  Repartiendo al dia   :', fmt(porDia), 'PILL');
        console.log('  APR                  :', total > 0 ? (porDia * 365 * 100 / total).toFixed(1) + '%' : '—');
        console.log('  https://solscan.io/account/' + p.stakeVault.toBase58() + cl);
    }
    console.log('');
    console.log('Claves en', FICHERO, '(600, en .gitignore)');
}

main().catch((e) => { console.error('Fallo:', e.message); process.exitCode = 1; });
