/*
 * LLENA LAS BOVEDAS POR TODAS LAS VIAS, Y ENSENA LAS TRANSACCIONES.
 *
 *   node scripts/llenar-vault.js
 *
 * El juego factura por cinco caminos distintos y todos acaban en el mismo sitio.
 * Esto los ejercita uno a uno contra devnet y deja el rastro:
 *
 *   1. EXIT FEE de classic — sales con masa y la casa se queda un %
 *   2. COMISION DE ARCADE — se aparta del bote antes de repartirlo
 *   3. BOTE SIN RECLAMAR — puestos vacios y calderilla del redondeo
 *   4. ENTRADA PERDIDA — te desconectas y no vuelves
 *   5. TIENDA DE SKINS — lo que se gasta en skins
 *
 * Los cinco van a la MISMA cola (`rake.alStaking`) y de ahi al pozo del staking en
 * UNA transaccion cuando pasa del minimo. Eso no es un atajo: mandar cada exit fee
 * de 12 PILL por separado gastaria mas en gas del que recauda.
 *
 * Al final se barre de verdad y salen las firmas.
 */
'use strict';

const path = require('path');

// En el VPS la configuracion vive en el .service, que un shell no hereda. Antes de
// requerir nada de server/ (leen el entorno al importarse), se coge de ahi.
require('./env-del-servicio.js').carga();
process.env.LB_DIR = process.env.LB_DIR || path.join(__dirname, '..', '.tmp-demo', 'lb');
process.env.SOL_RPC = process.env.SOL_RPC || 'https://api.devnet.solana.com';
// El minimo por defecto son 1000 PILL; aqui se baja para que el barrido salte en
// la propia prueba en vez de quedarse esperando a que se acumule.
process.env.RAKE_SWEEP_MIN_PILL = process.env.RAKE_SWEEP_MIN_PILL || '1';

const solana = require('../server/solana.js');
const rake = require('../server/rake.js');
const staking = require('../server/staking.js');

const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

/*
 * Deja el barrido en el mismo registro que usa el servidor.
 *
 * El barrido que hace este script es REAL —mueve tokens de verdad— asi que tiene que
 * quedar apuntado igual que si lo hubiera hecho el servidor. Si no, el panel
 * ensenaria una boveda con dinero que aparecio de la nada.
 */
function apuntaEnElRegistro(destino, pill, sig) {
    const fs = require('fs');
    const f = path.join(__dirname, '..', 'server', 'transactions.log');
    const linea = JSON.stringify({
        fecha: new Date().toISOString(), type: 'vault', wallet: destino,
        amount: Math.round(pill), detail: 'rake → ' + destino + ' (scripts/llenar-vault.js)', sig,
    });
    try { fs.appendFileSync(f, linea + String.fromCharCode(10)); } catch (e) {}
}

const cl = /devnet/i.test(solana.RPC) ? '?cluster=devnet' : '';

/* Las cinco vias, con lo que las provoca en el juego de verdad. */
const VIAS = [
    { nombre: 'Exit fee de classic', pill: 1200,
      donde: 'room-loop.js: sales con masa y la casa se queda un % que sube con tus kills' },
    { nombre: 'Comision de arcade', pill: 800,
      donde: 'room-loop.js: se aparta del bote ANTES de repartir entre el top 10' },
    { nombre: 'Bote sin reclamar', pill: 350,
      donde: 'room-loop.js: puestos vacios, ganadores sin wallet y la calderilla del redondeo' },
    { nombre: 'Entrada perdida', pill: 500,
      donde: 'index.js: te desconectas de una sala de pago y no vuelves a tiempo' },
    { nombre: 'Tienda de skins', pill: 2000,
      donde: 'skinshop.js: lo que se gasta en skins' },
];

async function main() {
    console.log('RPC     :', solana.RPC);
    console.log('Staking :', staking.PROGRAMA || '(sin desplegar)');
    console.log('Modo    :', staking.MODO || '—');
    if (!staking.PROGRAMA) {
        /*
         * Sin sitio a donde barrer. Lo importante es no mandar a buscar la direccion:
         * si el servidor esta funcionando, ya la tiene, y pedirla otra vez acaba en
         * una copiada a mano o —peor— en un `<direccion>` pegado tal cual.
         */
        const env = require('./env-del-servicio.js');
        const enUnidad = env.leeUnidad(env.UNIDAD).STAKING_PROGRAM;
        console.log('');
        console.log('Sin STAKING_PROGRAM no hay a donde barrer.');
        if (enUnidad) {
            console.log(`Esta en ${env.UNIDAD} pero no ha llegado hasta aqui. Lanza el script`);
            console.log('desde la raiz del repo para que pueda leer esa unidad.');
        } else {
            console.log(`No esta en el entorno ni en ${env.UNIDAD}. Anadelo alli:`);
            console.log(String.raw`  sudo sed -i '/^\[Service\]/a Environment=STAKING_PROGRAM=LA_DIRECCION_DEL_CONTRATO' ${env.UNIDAD}`);
        }
        process.exitCode = 1;
        return;
    }

    const antes = rake.estado();
    console.log('');
    console.log('LAS CINCO VIAS');
    let total = 0;
    for (const v of VIAS) {
        rake.alStaking(v.pill, v.nombre);
        total += v.pill;
        console.log(`  +${String(fmt(v.pill)).padStart(7)} PILL  ${v.nombre}`);
        console.log(`  ${' '.repeat(13)}${v.donde}`);
    }
    console.log('');
    console.log(`  Pendiente antes : ${fmt(antes.pendienteStaking)} PILL`);
    console.log(`  Anadido         : ${fmt(total)} PILL`);
    console.log(`  Pendiente ahora : ${fmt(rake.estado().pendienteStaking)} PILL`);

    /* Y ahora el barrido de verdad. Es UNA transaccion para las cinco vias: cada
     * exit fee por separado gastaria mas gas del que recauda. */
    console.log('');
    console.log('EL BARRIDO');
    const firmas = [];
    const hecho = await rake.barre(
        solana, require('../server/treasury-client.js'),
        process.env.TREASURY_PROGRAM || '', (m) => console.log('  ' + m),
        null, (destino, pill, sig) => { firmas.push({ destino, pill, sig }); apuntaEnElRegistro(destino, pill, sig); },
    );

    if (!hecho.stake && !hecho.tesoreria) {
        console.log('  No se barrio nada. ¿Hay clave de la autoridad y saldo?');
        process.exitCode = 1;
        return;
    }

    console.log('');
    console.log('LO QUE HA ENTRADO EN LA BOVEDA');
    for (const f of firmas) {
        console.log(`  ${fmt(f.pill)} PILL → ${f.destino}`);
        console.log(`  https://solscan.io/tx/${f.sig}${cl}`);
    }

    // Y el saldo de la boveda, leido de la cadena: es la comprobacion de que lo de
    // arriba no es solo un apunte nuestro.
    const est = rake.estado();
    console.log('');
    console.log('ESTADO');
    console.log(`  Barrido acumulado al staking : ${fmt(est.totalStaking)} PILL`);
    console.log(`  Pendiente de barrer          : ${fmt(est.pendienteStaking)} PILL`);
    try {
        const { Connection, PublicKey } = require('@solana/web3.js');
        const { getAccount } = require('@solana/spl-token');
        const c = new Connection(solana.RPC, 'confirmed');
        const p = staking.pdas();
        const pozo = Number((await getAccount(c, new PublicKey(p.rewardVault))).amount) / 10 ** solana.DECIMALS;
        console.log(`  En el pozo, segun la cadena  : ${fmt(pozo)} PILL`);
        console.log(`  https://solscan.io/account/${p.rewardVault.toBase58()}${cl}`);
    } catch (e) { console.log('  (no pude leer el pozo: ' + e.message + ')'); }
}

main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1; });
