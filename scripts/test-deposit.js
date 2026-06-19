#!/usr/bin/env node
/**
 * Test e2e del depósito + verificación (FASE B2, devnet).
 *  1. Crea un jugador de prueba (keypair efímera) y lo fondea con SOL + PILL desde la autoridad.
 *  2. El jugador deposita la "entrada" (PILL) al treasury (= cuenta de la autoridad).
 *  3. Verifica esa tx con server/solana.js (la misma lógica que usará el servidor).
 *
 * Uso: npm run test:deposit  (o node scripts/test-deposit.js [ENTRADA_PILL])
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');
const { verifyDeposit } = require('../server/solana.js');

const ENTRY_PILL = parseInt(process.argv[2] || '50000', 10);   // entrada de prueba: 50.000 PILL

const tok = JSON.parse(fs.readFileSync(path.join(__dirname, 'devnet-token.json'), 'utf8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, '.devnet-authority.json'), 'utf8'))));
const RPC = process.env.RPC || tok.rpc || clusterApiUrl('devnet');
const mint = new PublicKey(tok.mint);
const dec = tok.decimals || 6;

(async () => {
    const conn = new Connection(RPC, 'confirmed');
    const player = Keypair.generate();
    console.log('Jugador de prueba:', player.publicKey.toBase58());

    // 1) Fondear SOL (para comisiones) y PILL (para depositar) desde la autoridad
    console.log('Fondeando SOL...');
    const { SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({
        fromPubkey: authority.publicKey, toPubkey: player.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL,
    })), [authority]);

    console.log('Fondeando PILL...');
    const authAta = await getOrCreateAssociatedTokenAccount(conn, authority, mint, authority.publicKey);
    const playerAta = await getOrCreateAssociatedTokenAccount(conn, authority, mint, player.publicKey);
    await transfer(conn, authority, authAta.address, playerAta.address, authority, BigInt(ENTRY_PILL) * (10n ** BigInt(dec)));

    // 2) El jugador deposita la entrada al treasury (= ATA de la autoridad)
    console.log('Depositando entrada de', ENTRY_PILL, 'PILL al treasury...');
    const sig = await transfer(conn, player, playerAta.address, authAta.address, player, BigInt(ENTRY_PILL) * (10n ** BigInt(dec)));
    console.log('Tx depósito:', sig);

    // 3) Verificar con el módulo del servidor
    console.log('\nVerificando con server/solana.js...');
    await new Promise(r => setTimeout(r, 2000));
    const okExacto = await verifyDeposit({ sig, fromOwner: player.publicKey.toBase58(), minPill: ENTRY_PILL });
    console.log('  Pago exacto (minPill=' + ENTRY_PILL + '):', okExacto);
    const okDemas = await verifyDeposit({ sig, fromOwner: player.publicKey.toBase58(), minPill: ENTRY_PILL + 1 });
    console.log('  Debe FALLAR (pide más de lo pagado):', okDemas);
    const okOtro = await verifyDeposit({ sig, fromOwner: authority.publicKey.toBase58(), minPill: ENTRY_PILL });
    console.log('  Debe FALLAR (otro pagador):', okOtro);

    console.log('\n' + (okExacto.ok && !okDemas.ok && !okOtro.ok ? '✅ Verificación correcta' : '⚠ Revisar: la verificación no dio lo esperado'));
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
