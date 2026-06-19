#!/usr/bin/env node
/**
 * Envía $PILL de prueba (devnet) desde la autoridad a una wallet (p.ej. tu Phantom).
 *
 * Uso:
 *   node scripts/send-pill.js <DIRECCION_DESTINO> [CANTIDAD]
 *   npm run pill:send -- <DIRECCION_DESTINO> [CANTIDAD]
 *
 * CANTIDAD en PILL (por defecto 1.000.000). Ejemplo:
 *   node scripts/send-pill.js 9xQe...AbC 5000000
 *
 * Requisitos: haber creado el token antes (npm run token:devnet) y que la
 * autoridad tenga algo de SOL de devnet para la comisión.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');

const AUTH_FILE = path.join(__dirname, '.devnet-authority.json');
const TOKEN_FILE = path.join(__dirname, 'devnet-token.json');

const dest = process.argv[2];
const amountPill = BigInt(process.argv[3] || '1000000'); // por defecto 1.000.000 PILL

if (!dest) { console.error('Falta la dirección destino.\nUso: node scripts/send-pill.js <DIRECCION> [CANTIDAD]'); process.exit(1); }
if (!fs.existsSync(AUTH_FILE) || !fs.existsSync(TOKEN_FILE)) { console.error('Falta la autoridad o el token. Ejecuta primero: npm run token:devnet'); process.exit(1); }

const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))));
const RPC = process.env.RPC || token.rpc || clusterApiUrl('devnet');

(async () => {
  let destPk;
  try { destPk = new PublicKey(dest); } catch { console.error('Dirección destino inválida:', dest); process.exit(1); }

  const conn = new Connection(RPC, 'confirmed');
  const mint = new PublicKey(token.mint);
  const decimals = token.decimals || 6;
  const raw = amountPill * (10n ** BigInt(decimals));

  console.log('Red    :', RPC);
  console.log('Mint   :', token.mint);
  console.log('De     :', authority.publicKey.toBase58());
  console.log('A      :', destPk.toBase58());
  console.log('Cantidad:', amountPill.toString(), 'PILL');

  const fromAta = await getOrCreateAssociatedTokenAccount(conn, authority, mint, authority.publicKey);
  const toAta = await getOrCreateAssociatedTokenAccount(conn, authority, mint, destPk);
  const sig = await transfer(conn, authority, fromAta.address, toAta.address, authority, raw);

  console.log('\n✅ Enviado. Tx:', sig);
  console.log('Ver en explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
