#!/usr/bin/env node
/*
 * SEPARA LA WALLET DE PREMIOS DE LA AUTORIDAD.
 *
 *   node scripts/separar-premios.js [PILL] [SOL]
 *
 * Mientras no estan separadas, la direccion que aparece en el panel como "de aqui
 * salen los premios" es la misma que paga el gas, barre el rake y firma los retiros.
 * Tiene el grueso del supply, asi que el 82% que se le ve NO son los premios: es el
 * proyecto entero. La frase "los premios los paga esta wallet" no se puede comprobar
 * porque esa wallet hace otras cuatro cosas.
 *
 * Separarlas arregla dos cosas a la vez:
 *
 *   SE VE.     Cualquiera abre esa direccion en el explorador y ve entrar la
 *              asignacion y salir los premios, sin mezclarse con nada mas. Deja de
 *              ser una promesa y pasa a ser una lista de transacciones.
 *   SE ACOTA.  Lleva lo de unos dias, no la asignacion entera. Si el servidor cae en
 *              malas manos, se pierde lo de esos dias.
 *
 * LA CLAVE NUEVA SE GENERA AQUI Y NO SALE DE AQUI. Se escribe en
 * scripts/.rewards-wallet.json, que esta en .gitignore, con permisos 600. No se
 * imprime, no hace falta copiarla a ningun sitio y no hay que tocar el .service:
 * el servidor la busca en ese fichero solo.
 */
'use strict';

const fs = require('fs');
const path = require('path');

require('./env-del-servicio.js').carga();

const solana = require('../server/solana.js');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');

const FICHERO = path.join(__dirname, '.rewards-wallet.json');

/*
 * Cuanto lleva. Por defecto una semana del presupuesto diario, que es el orden de
 * magnitud correcto para una wallet caliente: si es mucho mas, no hemos acotado
 * nada; si es mucho menos, hay que recargarla a mano cada dos dias.
 */
const PRESUPUESTO_DIA = parseInt(process.env.REWARD_BUDGET_PILL, 10) || 50000;
const PILL = Number(process.argv[2] || PRESUPUESTO_DIA * 7);
const SOL = Number(process.argv[3] || 0.05);

const cl = /devnet/i.test(solana.RPC) ? '?cluster=devnet' : '';
const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

async function main() {
    console.log('RPC  :', solana.RPC);
    console.log('Mint :', solana.MINT);

    if (process.env.REWARDS_SECRET) {
        console.log('');
        console.log('Ya hay una REWARDS_SECRET en el entorno, y esa MANDA sobre este fichero.');
        console.log('Crear el fichero ahora no cambiaria nada y quedarian dos claves,');
        console.log('una de ellas muerta. Quita la variable primero o usa la que ya hay.');
        process.exitCode = 1;
        return;
    }

    /*
     * Si ya existe NO se toca. Sobrescribirla dejaria el dinero que tenga dentro sin
     * ninguna llave que lo mueva — y este script se ejecuta justo cuando uno quiere
     * "asegurarse de que esta bien", que es cuando mas se repite un comando.
     */
    if (fs.existsSync(FICHERO)) {
        const yaEs = solana.rewardsPubkey();
        console.log('');
        console.log('Ya hay wallet de premios:', yaEs);
        console.log('Aparte de la autoridad :', solana.rewardsAparte() ? 'si' : 'NO');
        console.log('');
        console.log('No se toca. Para recargarla:');
        console.log(`  node scripts/send-pill.js ${yaEs} LA_CANTIDAD_EN_PILL`);
        return;
    }

    if (!solana.canWithdraw()) {
        console.log('');
        console.log('No hay clave de autoridad, asi que no hay de donde sacar la asignacion:');
        console.log(' ', solana.porQueNoFirma());
        process.exitCode = 1;
        return;
    }

    const conn = new Connection(solana.RPC, 'confirmed');
    const autoridad = solana.loadAuthority();
    const mint = new PublicKey(solana.MINT);

    // Se comprueba ANTES de generar nada: una clave a medio fondear es peor que no
    // haber empezado, porque el panel ya la ensena como la wallet de premios.
    const origen = await getOrCreateAssociatedTokenAccount(conn, autoridad, mint, autoridad.publicKey);
    const tiene = Number(origen.amount) / 10 ** solana.DECIMALS;
    const lamports = await conn.getBalance(autoridad.publicKey);
    console.log('');
    console.log('La autoridad tiene :', fmt(tiene), 'PILL y', fmt(lamports / 1e9), 'SOL');
    console.log('Se va a mover      :', fmt(PILL), 'PILL y', SOL, 'SOL');
    if (tiene < PILL) {
        console.log('');
        console.log('No llega. Pide menos:  node scripts/separar-premios.js', Math.floor(tiene));
        process.exitCode = 1;
        return;
    }

    const premios = Keypair.generate();
    fs.writeFileSync(FICHERO, JSON.stringify(Array.from(premios.secretKey)), { mode: 0o600 });
    try { fs.chmodSync(FICHERO, 0o600); } catch (e) {}
    console.log('');
    console.log('Wallet de premios  :', premios.publicKey.toBase58());
    console.log('Clave              :', FICHERO, '(600, en .gitignore, no sale de aqui)');

    // El SOL primero: sin gas no puede ni crear su cuenta de tokens para cobrar, y
    // un ganador sin SOL tiene que poder reclamar sin poner nada.
    const { SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
    const sigSol = await sendAndConfirmTransaction(conn, new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: autoridad.publicKey, toPubkey: premios.publicKey,
            lamports: Math.round(SOL * 1e9),
        })), [autoridad]);
    console.log('');
    console.log('SOL para gas :', SOL, '—', sigSol);

    const destino = await getOrCreateAssociatedTokenAccount(conn, autoridad, mint, premios.publicKey);
    const raw = BigInt(Math.round(PILL * 10 ** solana.DECIMALS));
    const sigPill = await transfer(conn, autoridad, origen.address, destino.address, autoridad, raw);
    console.log('Asignacion   :', fmt(PILL), 'PILL —', sigPill);

    console.log('');
    console.log('  https://solscan.io/account/' + premios.publicKey.toBase58() + cl);
    console.log('');
    console.log('Reinicia para que el servidor la coja:  sudo systemctl restart pillwars');
}

main().catch((e) => { console.error('Fallo:', e.message); process.exitCode = 1; });
