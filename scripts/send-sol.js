#!/usr/bin/env node
/**
 * Envía SOL de DEVNET desde la autoridad a una wallet (p.ej. tu Phantom),
 * para que tengas SOL de prueba con el que pagar comisiones al firmar tx.
 *
 * Uso:
 *   node scripts/send-sol.js <DIRECCION_DESTINO> [CANTIDAD_SOL]
 *   npm run sol:send -- <DIRECCION_DESTINO> [CANTIDAD_SOL]
 *
 * CANTIDAD_SOL por defecto 0.2. Ejemplo:
 *   npm run sol:send -- 9xQe...AbC 0.5
 *
 * Ojo: la autoridad tiene poco SOL de devnet (el del airdrop). Si te quedas
 * corto, vuelve a fondearla en https://faucet.solana.com (red Devnet).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL,
  SystemProgram, Transaction, sendAndConfirmTransaction, clusterApiUrl,
} = require('@solana/web3.js');

const AUTH_FILE = path.join(__dirname, '.devnet-authority.json');
const TOKEN_FILE = path.join(__dirname, 'devnet-token.json');

const dest = process.argv[2];
const amountSol = parseFloat(process.argv[3] || '0.2');

if (!dest) { console.error('Falta la dirección destino.\nUso: node scripts/send-sol.js <DIRECCION> [CANTIDAD_SOL]'); process.exit(1); }
if (!fs.existsSync(AUTH_FILE)) { console.error('Falta la autoridad. Ejecuta primero: npm run token:devnet'); process.exit(1); }

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))));
const token = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) : {};
const RPC = process.env.RPC || token.rpc || clusterApiUrl('devnet');

(async () => {
  let destPk;
  try { destPk = new PublicKey(dest); } catch { console.error('Dirección destino inválida:', dest); process.exit(1); }

  const conn = new Connection(RPC, 'confirmed');
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const bal = await conn.getBalance(authority.publicKey);
  console.log('Red    :', RPC);
  console.log('De     :', authority.publicKey.toBase58(), '(' + (bal / LAMPORTS_PER_SOL).toFixed(3) + ' SOL)');
  console.log('A      :', destPk.toBase58());
  console.log('Cantidad:', amountSol, 'SOL');
  if (bal <= lamports + 5000) { console.error('La autoridad no tiene SOL suficiente. Fondéala en https://faucet.solana.com (Devnet):', authority.publicKey.toBase58()); process.exit(1); }

  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: destPk, lamports }));
  const sig = await sendAndConfirmTransaction(conn, tx, [authority]);

  console.log('\n✅ Enviado. Tx:', sig);
  console.log('Ver en explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
