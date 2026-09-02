/*
 * HERRAMIENTA DE OPERACION DE LA TESORERIA.
 *
 *   node scripts/treasury.js status
 *   node scripts/treasury.js init --unlock-days 30 --cap 60000 --bps 5 --sweep-cap 500000
 *   node scripts/treasury.js fund 1000000
 *   node scripts/treasury.js sweep 50000
 *   node scripts/treasury.js publish <epoch>
 *   node scripts/treasury.js claim <epoch> <wallet>
 *   node scripts/treasury.js extend-lock --years 4
 *   node scripts/treasury.js tighten --cap 60000
 *   node scripts/treasury.js finalize
 *   node scripts/treasury.js verify
 *
 * CONFIGURACION (env, igual que el resto del servidor):
 *   TREASURY_PROGRAM   direccion del programa desplegado
 *   PILL_MINT / SOL_RPC / PILL_DECIMALS   (o scripts/devnet-token.json)
 *   TREASURY_SECRET    clave de la autoridad (o scripts/.devnet-authority.json)
 *
 * LAS TRES IRREVERSIBLES —extend-lock, tighten y finalize— piden confirmacion
 * escrita. No es paternalismo: son las tres que no tienen deshacer, y la unica
 * proteccion contra ejecutarlas con el argumento equivocado es tener que teclear lo
 * que va a pasar antes de que pase.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');

const solana = require('../server/solana.js');
const tc = require('../server/treasury-client.js');
const rewards = require('../server/rewards.js');
const leaderboard = require('../server/leaderboard.js');
const merkle = require('../server/merkle.js');

const PROGRAM = process.env.TREASURY_PROGRAM || '';
const DEC = solana.DECIMALS;
const aPill = (raw) => Number(BigInt(raw)) / 10 ** DEC;
const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

const args = process.argv.slice(3);
const flag = (n, def) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const tiene = (n) => args.includes('--' + n);

function conn() { return new Connection(solana.RPC, 'confirmed'); }
function exigePrograma() {
    if (!PROGRAM) { console.error('Falta TREASURY_PROGRAM. Despliega el programa y exporta su direccion.'); process.exit(1); }
    return PROGRAM;
}
function exigeAutoridad() {
    const a = solana.authorityPubkey();
    if (!a) { console.error('No hay clave de la autoridad (TREASURY_SECRET o scripts/.devnet-authority.json).'); process.exit(1); }
    return a;
}

/** Confirmacion escrita para lo que no tiene vuelta atras. */
function confirmar(frase) {
    if (tiene('yes')) return Promise.resolve(true);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => {
        rl.question(`\nEsto NO se puede deshacer.\nEscribe exactamente:  ${frase}\n> `, (r) => {
            rl.close();
            res(r.trim() === frase);
        });
    });
}

/* ===================== STATUS ===================== */

async function status() {
    console.log(`RPC    ${solana.RPC}`);
    console.log(`Mint   ${solana.MINT || '(sin configurar)'}`);
    console.log(`Autoridad  ${solana.authorityPubkey() || '(sin clave en este equipo)'}`);
    if (!PROGRAM) {
        console.log('\nNo hay TREASURY_PROGRAM configurado: la custodia y la tesoreria siguen en la misma wallet.');
        console.log(`Treasury legacy: ${solana.TREASURY_OWNER || '(sin configurar)'}`);
        return;
    }
    const c = conn();
    const p = tc.pdas(PROGRAM);
    console.log(`\nPrograma  ${PROGRAM}`);
    console.log(`  custody   ${p.custody.toBase58()}`);
    console.log(`  treasury  ${p.treasury.toBase58()}`);
    console.log(`  config    ${p.config.toBase58()}`);

    const [cfgInfo, cusInfo, treInfo] = await c.getMultipleAccountsInfo([p.config, p.custody, p.treasury]);
    if (!cfgInfo) { console.log('\nSin inicializar: ejecuta `init`.'); return; }
    const saldo = (i) => (i && i.data.length >= 72 ? i.data.readBigUInt64LE(64) : 0n);
    const cfg = tc.decodeConfig(cfgInfo.data);

    console.log(`\nSALDOS`);
    console.log(`  CUSTODIA (de los jugadores) ${fmt(aPill(saldo(cusInfo))).padStart(16)} PILL`);
    console.log(`  TESORERIA (bloqueada)       ${fmt(aPill(saldo(treInfo))).padStart(16)} PILL`);
    console.log(`  reservado por rondas vivas  ${fmt(aPill(cfg.reserved)).padStart(16)} PILL`);

    const ahora = Math.floor(Date.now() / 1000);
    const dias = Math.ceil((cfg.unlockTs - ahora) / 86400);
    console.log(`\nBLOQUEO`);
    console.log(`  hasta        ${new Date(cfg.unlockTs * 1000).toISOString()}`);
    console.log(`  estado       ${ahora < cfg.unlockTs ? `BLOQUEADA (${dias} dias)` : 'VENCIDO'}`);
    console.log(`  finalizada   ${cfg.finalized ? 'SI (parametros congelados)' : 'no (todavia se pueden endurecer)'}`);

    console.log(`\nGRIFO`);
    console.log(`  cap por epoca      ${fmt(aPill(cfg.rewardCapPerEpoch))} PILL`);
    console.log(`  bps del saldo      ${cfg.rewardBpsPerEpoch} (${(cfg.rewardBpsPerEpoch / 100).toFixed(2)} %/epoca)`);
    console.log(`  ventana impugnar   ${cfg.challengeSecs / 3600} h`);
    console.log(`  sweep cap          ${fmt(aPill(cfg.sweepCapPerEpoch))} PILL/epoca`);

    console.log(`\nACUMULADO`);
    console.log(`  depositado ${fmt(aPill(cfg.totalDeposited))} · retirado ${fmt(aPill(cfg.totalWithdrawn))}`);
    console.log(`  aportado   ${fmt(aPill(cfg.totalFunded))} · barrido ${fmt(aPill(cfg.totalSwept))}`);
    console.log(`  premiado   ${fmt(aPill(cfg.totalRewarded))} · caducado ${fmt(aPill(cfg.totalExpired))}`);
    console.log(`  rondas publicadas ${cfg.roundsPublished}`);

    // Lo primero que mira cualquiera que audite esto.
    const info = await c.getAccountInfo(new PublicKey(PROGRAM));
    if (info && info.data.length >= 36) {
        const pd = await c.getAccountInfo(new PublicKey(info.data.subarray(4, 36)));
        if (pd && pd.data.length >= 45) {
            const tieneAuth = pd.data[12] === 1;
            console.log(`\nUPGRADE AUTHORITY  ${tieneAuth ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : 'NINGUNA (programa inmutable)'}`);
            if (tieneAuth) {
                console.log('  ⚠ Mientras exista, el bloqueo no garantiza nada: con ella se despliega');
                console.log('    otra version del programa que vacie los vaults. Revocala con:');
                console.log(`    solana program set-upgrade-authority ${PROGRAM} --final`);
            }
        }
    }
}

/* ===================== INIT ===================== */

async function init() {
    exigePrograma(); const authority = exigeAutoridad();
    if (!solana.MINT) { console.error('Falta PILL_MINT.'); process.exit(1); }

    const dias = parseInt(flag('unlock-days', '30'), 10);
    const unlockTs = Math.floor(Date.now() / 1000) + dias * 86400;
    const cap = Math.round(Number(flag('cap', '60000')));
    const bps = parseInt(flag('bps', '5'), 10);
    const challengeH = parseInt(flag('challenge-hours', '48'), 10);
    const sweepCap = Math.round(Number(flag('sweep-cap', '500000')));

    console.log('Se va a inicializar con:');
    console.log(`  bloqueo inicial     ${dias} dias  (${new Date(unlockTs * 1000).toISOString()})`);
    console.log(`  cap de premios      ${fmt(cap)} PILL/epoca`);
    console.log(`  bps del saldo       ${bps}`);
    console.log(`  ventana impugnar    ${challengeH} h`);
    console.log(`  cap de sweep        ${fmt(sweepCap)} PILL/epoca`);
    console.log('\nEl bloqueo corto es a proposito: es la fase de calibracion. Se alarga con');
    console.log('extend-lock cuando los numeros del simulador cuadren con los datos reales.');

    const ix = tc.initialize(PROGRAM, {
        mint: solana.MINT,
        authority,
        payer: authority,
        args: {
            unlockTs,
            epochSecs: 86400,
            rewardCapPerEpoch: solana.pillToRaw(cap),
            rewardBpsPerEpoch: bps,
            challengeSecs: challengeH * 3600,
            sweepCapPerEpoch: solana.pillToRaw(sweepCap),
        },
    });
    const sig = await solana.sendInstructions([ix]);
    const p = tc.pdas(PROGRAM);
    console.log(`\nInicializado: ${sig}`);
    console.log(`  CUSTODIA   ${p.custody.toBase58()}`);
    console.log(`  TESORERIA  ${p.treasury.toBase58()}`);
    console.log('\nApunta esas dos direcciones: son las que la gente va a mirar en el explorador.');
}

/* ===================== MOVIMIENTOS ===================== */

async function fund() {
    exigePrograma(); const authority = exigeAutoridad();
    const pill = Math.round(Number(args[0]));
    if (!(pill > 0)) { console.error('Uso: treasury.js fund <pill>'); process.exit(1); }
    const from = getAssociatedTokenAddressSync(new PublicKey(solana.MINT), new PublicKey(authority), true);
    console.log(`Aportando ${fmt(pill)} PILL a la TESORERIA. Esto es de ida: queda bloqueado igual que el resto.`);
    const ix = tc.fund(PROGRAM, { from, owner: authority, amountRaw: solana.pillToRaw(pill) });
    console.log('OK: ' + await solana.sendInstructions([ix]));
}

async function sweep() {
    exigePrograma(); const authority = exigeAutoridad();
    const pill = Math.round(Number(args[0]));
    if (!(pill > 0)) { console.error('Uso: treasury.js sweep <pill>'); process.exit(1); }
    const ix = tc.sweep(PROGRAM, { authority, amountRaw: solana.pillToRaw(pill) });
    console.log(`Barriendo ${fmt(pill)} PILL de CUSTODIA a TESORERIA...`);
    console.log('OK: ' + await solana.sendInstructions([ix]));
}

/* ===================== RONDAS ===================== */

async function publish() {
    exigePrograma(); exigeAutoridad();
    const epoch = parseInt(args[0], 10);
    if (!Number.isFinite(epoch)) { console.error('Uso: treasury.js publish <epoch>'); process.exit(1); }
    const pub = rewards.rondaPublica(epoch);
    if (!pub) { console.error(`No hay ronda preparada para la epoca ${epoch} (${rewards.fechaDeEpoch(epoch)}).`); process.exit(1); }
    console.log(`Ronda ${epoch} (${pub.date}): ${fmt(aPill(pub.total))} PILL para ${pub.winners} ganadores`);
    console.log(`  raiz ${pub.root}`);
    console.log(`  leaderboard ${pub.leaderboardHash}`);
    const r = await rewards.publicarRonda(
        { epoch, root: pub.root, totalRaw: pub.total, winners: pub.winners, date: pub.date },
        solana, console.log
    );
    console.log(r.ok ? 'Publicada: ' + r.sig : 'FALLO: ' + r.error);
}

async function claim() {
    exigePrograma(); const payer = exigeAutoridad();
    const epoch = parseInt(args[0], 10);
    const wallet = args[1];
    if (!Number.isFinite(epoch) || !wallet) { console.error('Uso: treasury.js claim <epoch> <wallet>'); process.exit(1); }
    const pub = rewards.rondaPublica(epoch);
    if (!pub) { console.error('No hay ronda para esa epoca.'); process.exit(1); }
    const fila = pub.entries.find(e => e.wallet === wallet);
    if (!fila) { console.error('Esa wallet no esta en la ronda.'); process.exit(1); }

    // Reclamar por otro es normal: el destino sale de la hoja, no de quien firma.
    console.log(`Reclamando ${fmt(aPill(fila.amountRaw))} PILL para ${wallet} (puesto ${fila.rank})`);
    const ix = tc.claim(PROGRAM, {
        epoch, winner: wallet, amountRaw: BigInt(fila.amountRaw),
        proof: fila.proof, mint: solana.MINT, payer,
    });
    const sig = await solana.sendInstructions([ix]);
    rewards.marcarCobrado(epoch, wallet, sig);
    console.log('OK: ' + sig);
}

/* ===================== EL CERROJO ===================== */

async function extendLock() {
    exigePrograma(); const authority = exigeAutoridad();
    const anios = Number(flag('years', '0'));
    const dias = Number(flag('days', '0'));
    if (!(anios > 0 || dias > 0)) { console.error('Uso: treasury.js extend-lock --years 4  |  --days 365'); process.exit(1); }
    const nuevo = Math.floor(Date.now() / 1000) + Math.round(anios * 365 * 86400 + dias * 86400);
    const fecha = new Date(nuevo * 1000).toISOString().slice(0, 10);

    console.log(`\nSe va a bloquear la TESORERIA hasta el ${fecha}.`);
    console.log('A partir de ahi, la unica salida hasta esa fecha son los premios del top 10,');
    console.log('reclamados por los ganadores contra listas publicadas 48 h antes.');
    console.log('El bloqueo NO se puede acortar despues. Ni por ti, ni por nadie.');
    if (!await confirmar(`BLOQUEAR HASTA ${fecha}`)) { console.log('Cancelado.'); return; }

    const ix = tc.extendLock(PROGRAM, { newUnlockTs: nuevo, authority });
    console.log('OK: ' + await solana.sendInstructions([ix]));
}

async function tighten() {
    exigePrograma(); const authority = exigeAutoridad();
    const cap = flag('cap', null);
    const bps = flag('bps', null);
    const sweepCap = flag('sweep-cap', null);
    const challengeH = flag('challenge-hours', null);
    if (cap == null && bps == null && sweepCap == null && challengeH == null) {
        console.error('Uso: treasury.js tighten [--cap N] [--bps N] [--sweep-cap N] [--challenge-hours N]');
        console.error('Recuerda: los caps SOLO bajan y la ventana SOLO sube. El contrato rechaza lo demas.');
        process.exit(1);
    }
    console.log('\nEndureciendo limites:');
    if (cap != null) console.log(`  cap de premios -> ${fmt(cap)} PILL/epoca`);
    if (bps != null) console.log(`  bps -> ${bps}`);
    if (sweepCap != null) console.log(`  cap de sweep -> ${fmt(sweepCap)} PILL/epoca`);
    if (challengeH != null) console.log(`  ventana -> ${challengeH} h`);
    console.log('Esto no se puede aflojar despues.');
    if (!await confirmar('ENDURECER')) { console.log('Cancelado.'); return; }

    const ix = tc.tighten(PROGRAM, {
        authority,
        rewardCapPerEpoch: cap != null ? solana.pillToRaw(Math.round(Number(cap))) : null,
        rewardBpsPerEpoch: bps != null ? parseInt(bps, 10) : null,
        sweepCapPerEpoch: sweepCap != null ? solana.pillToRaw(Math.round(Number(sweepCap))) : null,
        challengeSecs: challengeH != null ? parseInt(challengeH, 10) * 3600 : null,
    });
    console.log('OK: ' + await solana.sendInstructions([ix]));
}

async function finalize() {
    exigePrograma(); const authority = exigeAutoridad();
    console.log('\nSe van a CONGELAR los parametros para siempre: caps, bps y ventana de');
    console.log('impugnacion quedan como estan. Ni siquiera se podran endurecer mas.');
    console.log('\nEsto se hace cuando la calibracion ha terminado y los numeros cuadran.');
    console.log('Despues, el ultimo paso es revocar la upgrade authority del programa:');
    console.log(`  solana program set-upgrade-authority ${PROGRAM} --final`);
    console.log('Sin ese ultimo paso, nada de esto garantiza nada.');
    if (!await confirmar('CONGELAR PARA SIEMPRE')) { console.log('Cancelado.'); return; }

    const ix = tc.finalize(PROGRAM, { authority });
    console.log('OK: ' + await solana.sendInstructions([ix]));
}

/* ===================== VERIFY ===================== */

/*
 * La auditoria que cualquiera puede repetir, hecha desde aqui para poder correrla
 * antes de que la haga otro: que la cadena del leaderboard encaje, y que cada raiz
 * publicada on-chain sea de verdad la de la lista que se publico.
 */
async function verify() {
    const cadena = leaderboard.verificarCadena();
    console.log(`CADENA DEL LEADERBOARD  ${cadena.dias} dias`);
    console.log(cadena.ok ? '  ✓ encaja entera' : '  ✗ FALLOS:');
    for (const f of cadena.fallos) console.log(`    ${f.date}: ${f.error}`);

    const est = rewards.estado();
    console.log(`\nRONDAS  ${est.total} (${est.sinPublicar} sin publicar)`);
    let malas = 0;
    for (const r of est.rondas) {
        const pub = rewards.rondaPublica(r.epoch);
        if (!pub) { console.log(`  ${r.epoch} ✗ falta el JSON publico`); malas++; continue; }
        // Se rehace el arbol solo con {wallet, amount}, como haria un tercero.
        const soloDatos = pub.entries.map(e => ({ wallet: e.wallet, amountRaw: BigInt(e.amountRaw) }));
        const recalculada = merkle.buildTree(r.epoch, soloDatos).rootHex;
        const suma = soloDatos.reduce((s, e) => s + e.amountRaw, 0n);
        const okRaiz = recalculada === pub.root;
        const okTotal = suma.toString() === pub.total;
        if (!okRaiz || !okTotal) malas++;
        console.log(`  ${r.epoch} (${r.date}) ${okRaiz && okTotal ? '✓' : '✗'} ${fmt(r.pill)} PILL · ${r.winners} ganadores${okRaiz ? '' : ' · RAIZ NO CUADRA'}${okTotal ? '' : ' · TOTAL NO CUADRA'}`);
    }

    if (PROGRAM) {
        console.log('\nCONTRASTE CON LA CADENA');
        const c = conn();
        const cuentas = await c.getMultipleAccountsInfo(est.rondas.filter(r => r.publicada).map(r => tc.roundPda(PROGRAM, r.epoch)));
        est.rondas.filter(r => r.publicada).forEach((r, i) => {
            const info = cuentas[i];
            if (!info) { console.log(`  ${r.epoch} ✗ no existe on-chain pese a estar marcada como publicada`); malas++; return; }
            const on = tc.decodeRound(info.data);
            const igual = on.merkleRoot === r.root;
            if (!igual) malas++;
            console.log(`  ${r.epoch} ${igual ? '✓' : '✗ LA RAIZ ON-CHAIN NO ES LA PUBLICADA'} · reclamado ${fmt(aPill(on.claimed))}/${fmt(aPill(on.total))} PILL`);
        });
    }

    console.log(malas === 0 && cadena.ok ? '\n✓ Todo cuadra.' : `\n✗ ${malas} problemas. Ninguno se arregla solo.`);
    process.exitCode = malas === 0 && cadena.ok ? 0 : 1;
}

/* ===================== MAIN ===================== */

const COMANDOS = { status, init, fund, sweep, publish, claim, 'extend-lock': extendLock, tighten, finalize, verify };
const cmd = process.argv[2];
if (!cmd || !COMANDOS[cmd]) {
    console.log('Comandos: ' + Object.keys(COMANDOS).join(', '));
    console.log('Cabecera de scripts/treasury.js para los detalles.');
    process.exit(cmd ? 1 : 0);
}
COMANDOS[cmd]().catch(e => { console.error('\nERROR: ' + e.message); process.exit(1); });
