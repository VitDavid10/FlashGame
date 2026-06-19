#!/usr/bin/env node
/**
 * Crea el token $PILL de PRUEBA en la devnet de Solana.
 *
 * Qué hace:
 *  1. Carga (o genera) una keypair de autoridad y la guarda en scripts/.devnet-authority.json
 *     (¡SECRETO! está en .gitignore — no se sube nunca).
 *  2. Pide un airdrop de SOL de devnet a esa autoridad (para pagar las comisiones).
 *  3. Crea el mint (6 decimales, como pump.fun).
 *  4. Acuña el supply inicial a la cuenta de la autoridad.
 *  5. Guarda el resultado en scripts/devnet-token.json y lo imprime.
 *
 * Uso:
 *   npm install        (instala @solana/web3.js y @solana/spl-token)
 *   npm run token:devnet
 *
 * Variables opcionales:
 *   RPC=https://api.devnet.solana.com   (por defecto, RPC público de devnet)
 *   SUPPLY=1000000000                   (supply total, por defecto 1.000.000.000)
 *   DECIMALS=6
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl,
} = require('@solana/web3.js');
const {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
} = require('@solana/spl-token');

const RPC = process.env.RPC || clusterApiUrl('devnet');
const DECIMALS = parseInt(process.env.DECIMALS || '6', 10);
const SUPPLY = BigInt(process.env.SUPPLY || '1000000000'); // 1.000 millones (como pump.fun)

const AUTH_FILE = path.join(__dirname, '.devnet-authority.json');
const OUT_FILE = path.join(__dirname, 'devnet-token.json');

function loadOrCreateAuthority() {
  if (fs.existsSync(AUTH_FILE)) {
    const secret = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(Array.from(kp.secretKey)));
  console.log('Nueva keypair de autoridad guardada en', AUTH_FILE, '(SECRETO, no la subas)');
  return kp;
}

async function ensureSol(conn, pubkey) {
  let bal = await conn.getBalance(pubkey);
  if (bal >= 0.5 * LAMPORTS_PER_SOL) return;
  console.log('Pidiendo airdrop de 1 SOL (devnet)...');
  try {
    const sig = await conn.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
  } catch (e) {
    console.warn('Airdrop falló (el faucet público suele estar saturado):', e.message);
    console.warn('Mete SOL de devnet a mano en esta dirección y reintenta:');
    console.warn('  ', pubkey.toBase58());
    console.warn('Faucet web: https://faucet.solana.com  (pega la dirección, red Devnet)');
  }
  bal = await conn.getBalance(pubkey);
  if (bal < 0.1 * LAMPORTS_PER_SOL) throw new Error('Sin SOL suficiente en la autoridad para crear el token.');
}

(async () => {
  console.log('Red:', RPC);
  const conn = new Connection(RPC, 'confirmed');
  const authority = loadOrCreateAuthority();
  console.log('Autoridad:', authority.publicKey.toBase58());

  await ensureSol(conn, authority.publicKey);

  console.log('Creando mint (', DECIMALS, 'decimales )...');
  const mint = await createMint(conn, authority, authority.publicKey, authority.publicKey, DECIMALS);
  console.log('Mint creado:', mint.toBase58());

  const ata = await getOrCreateAssociatedTokenAccount(conn, authority, mint, authority.publicKey);
  const raw = SUPPLY * (10n ** BigInt(DECIMALS));
  console.log('Acuñando supply:', SUPPLY.toString(), 'PILL...');
  await mintTo(conn, authority, mint, ata.address, authority, raw);

  const out = {
    cluster: 'devnet',
    rpc: RPC,
    mint: mint.toBase58(),
    decimals: DECIMALS,
    supply: SUPPLY.toString(),
    authority: authority.publicKey.toBase58(),
    authorityTokenAccount: ata.address.toBase58(),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  console.log('\n──────────────────────────────────────────────');
  console.log('TOKEN $PILL (DEVNET) CREADO');
  console.log('  Mint     :', out.mint);
  console.log('  Decimales:', out.decimals);
  console.log('  Supply   :', out.supply, 'en', out.authorityTokenAccount);
  console.log('  Guardado :', OUT_FILE);
  console.log('──────────────────────────────────────────────');
  console.log('Pon este mint en la web (Config.Token) para leer balances en devnet.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
