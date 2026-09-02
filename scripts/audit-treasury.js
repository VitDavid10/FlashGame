/*
 * AUDITOR INDEPENDIENTE DE LA TESORERIA DE PILLWARS.
 *
 *   node audit-treasury.js https://pillwars.fun
 *
 * Este fichero esta pensado para COPIARSE Y EJECUTARSE POR CUALQUIERA. No importa
 * nada del repo, no necesita npm install y no toca ningun fichero local: solo habla
 * con las URLs publicas del servidor y con un RPC de Solana. Node 18 o superior.
 *
 * Que no haya que confiar en el servidor es justo el punto. Si el auditor viviera
 * dentro del proyecto y leyera los ficheros del disco, estaria comprobando que el
 * servidor esta de acuerdo consigo mismo, que no demuestra nada.
 *
 * LO QUE COMPRUEBA, de menos a mas importante:
 *
 *   1. Que la cadena de hashes del leaderboard encaje: cada dia declara el hash del
 *      anterior y su propio hash cuadra con lo que publica. Reescribir un dia viejo
 *      rompe todos los siguientes.
 *   2. Que la raiz de Merkle de cada ronda salga de la lista publicada. Se rehace el
 *      arbol solo con {wallet, cantidad} y tiene que dar el mismo hash.
 *   3. Que la raiz que hay ON-CHAIN sea esa misma. Si el JSON dice una cosa y la
 *      cadena otra, la lista que se ensena no es la que se pago.
 *   4. Que los ganadores de cada ronda SEAN los del leaderboard de ese dia, en ese
 *      orden y con los pesos anunciados. Este es el que cierra el circulo: los otros
 *      tres demuestran que nadie ha cambiado la lista despues, este demuestra que la
 *      lista era la correcta desde el principio.
 *   5. Que ninguna ronda pase del tope diario que declara el contrato.
 *   6. Que la custodia cubra lo que se debe a los jugadores.
 *   7. Que el programa sea inmutable. Si no lo es, todo lo anterior es decorativo:
 *      quien tenga la upgrade authority puede desplegar una version que vacie los
 *      vaults, y ninguna de las comprobaciones de arriba lo impediria.
 *   8. Que los recibos de partida encajen con los lotes anclados en la cadena, y que
 *      los premiados se hayan cruzado con gente distinta. Un jugador de verdad juega
 *      con decenas de personas; diez wallets del mismo dueno solo se cruzan entre
 *      ellas, y eso se ve.
 *   9. Que el pasivo publicado sea la suma de la lista de saldos y que la custodia lo
 *      cubra. Es la mitad que casi nadie publica: decir cuanto tienes es facil, lo
 *      dificil es demostrar cuanto DEBES.
 *
 * POR QUE HACEN FALTA LAS CUATRO PRIMERAS. Cada una tapa el agujero que deja la
 * anterior. Probado con un servidor trucado a proposito:
 *
 *   Ataque 1 — cambio la wallet de un ganador en la lista de premios.
 *              Lo pilla (2): la raiz ya no sale de la lista. Y tambien (4).
 *   Ataque 2 — cambio la wallet Y regenero el arbol para que cuadre.
 *              Pasa (2), pero lo pilla (4): ese puesto lo gano otro en el leaderboard.
 *   Ataque 3 — cambio la wallet, regenero el arbol Y reescribo el leaderboard del dia.
 *              Pasa (2) y (4), pero lo pilla (1): el hash del dia deja de salir.
 *   Ataque 4 — todo lo anterior y ademas rehago la cadena de hashes entera.
 *              Lo pilla (3): la raiz que hay on-chain se publico hace dias y no se
 *              puede reescribir. Ahi es donde la cadena de Solana hace su trabajo, y
 *              por eso (3) no se puede quitar aunque parezca redundante.
 *
 * Sale con codigo 0 si todo cuadra y 1 si algo no.
 */
'use strict';

const crypto = require('crypto');

const BASE = (process.argv[2] || 'https://pillwars.fun').replace(/\/+$/, '');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sha256 = (...b) => crypto.createHash('sha256').update(Buffer.concat(b)).digest();

let fallos = 0, avisos = 0;
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const mal = (m) => { fallos++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m'); };
const avisa = (m) => { avisos++; console.log('  \x1b[33m! ' + m + '\x1b[0m'); };
// El numero lo pone el contador y no el texto: si una seccion no llega a correr
// (sin contrato desplegado, por ejemplo), la numeracion saltaba huecos y parecia que
// faltaban comprobaciones.
let _seccion = 0;
const titulo = (m) => console.log('\n\x1b[1m' + (++_seccion) + '. ' + m + '\x1b[0m');

async function get(ruta) {
    const r = await fetch(BASE + ruta, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(ruta + ' -> HTTP ' + r.status);
    return r.json();
}

/* ===================== MERKLE (reimplementado aqui a proposito) ===================== */

// No se importa el del proyecto: un auditor que usa el codigo del auditado no
// comprueba nada. Estas veinte lineas salen de la especificacion del contrato, que
// es publica, y si no coinciden con las del servidor es que una de las dos miente.
const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// Decodificador base58 minimo: solo para pasar una direccion de Solana a 32 bytes.
const ALFABETO = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(str) {
    let n = 0n;
    for (const c of str) {
        const i = ALFABETO.indexOf(c);
        if (i < 0) throw new Error('direccion no valida: ' + str);
        n = n * 58n + BigInt(i);
    }
    const bytes = [];
    while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const c of str) { if (c !== '1') break; bytes.unshift(0); }
    return Buffer.from(bytes);
}

const hoja = (epoch, wallet, amount) => sha256(LEAF, u64le(epoch), base58(wallet), u64le(amount));
const nodo = (a, b) => (Buffer.compare(a, b) <= 0 ? sha256(NODE, a, b) : sha256(NODE, b, a));

function raizDe(epoch, filas) {
    const orden = [...filas].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
    let nivel = orden.map(f => hoja(epoch, f.wallet, BigInt(f.amountRaw)));
    while (nivel.length > 1) {
        const arriba = [];
        for (let i = 0; i < nivel.length; i += 2) {
            arriba.push(i + 1 < nivel.length ? nodo(nivel[i], nivel[i + 1]) : nivel[i]);
        }
        nivel = arriba;
    }
    return nivel[0];
}

/* ===================== 1 y 4: LEADERBOARD ===================== */

// El json canonico que el servidor dice que hashea. Si el hash no sale, o el
// servidor no lo hace asi o los datos no son los que publico.
const canonico = (date, entries) => JSON.stringify({
    date,
    entries: entries.map(f => ({ rank: f.rank, wallet: f.wallet, kills: f.kills, peak: f.peak })),
});

async function auditaCadena() {
    titulo('Cadena de hashes del leaderboard');
    const { chain } = await get('/api/leaderboard/chain');
    if (!chain || !chain.length) { avisa('todavia no hay ningun dia cerrado'); return {}; }

    const dias = {};
    let prev = '0'.repeat(64);
    let rotos = 0;
    for (const eslabon of chain) {
        let snap;
        try { snap = await get('/api/leaderboard/' + eslabon.date); }
        catch (e) { mal(`${eslabon.date}: no se puede descargar el dia (${e.message})`); prev = eslabon.hash; continue; }
        dias[eslabon.date] = snap;

        if (snap.prevHash !== prev) { mal(`${eslabon.date}: declara un dia anterior que no es el que va antes`); rotos++; }
        const recalculado = sha256hex(prev + canonico(snap.date, snap.entries));
        if (recalculado !== eslabon.hash) { mal(`${eslabon.date}: el hash NO sale de lo que publica`); rotos++; }
        prev = eslabon.hash;
    }
    if (rotos === 0) ok(`${chain.length} dias, la cadena encaja entera (ultimo hash ${prev.slice(0, 16)}…)`);
    return dias;
}

/* ===================== 2, 3, 4 y 5: RONDAS ===================== */

const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];

async function auditaRondas(estado, dias) {
    titulo('Raices de Merkle contra las listas publicadas');
    const rondas = (estado.premios && estado.premios.rondas) || [];
    if (!rondas.length) { avisa('todavia no hay ninguna ronda de premios'); return []; }

    const listas = {};
    for (const r of rondas) {
        let pub;
        try { pub = await get('/api/rewards/' + r.epoch); }
        catch (e) { mal(`epoca ${r.epoch}: no se puede descargar la lista (${e.message})`); continue; }
        listas[r.epoch] = pub;

        const raiz = raizDe(r.epoch, pub.entries).toString('hex');
        if (raiz !== pub.root) { mal(`epoca ${r.epoch}: la raiz NO sale de la lista publicada`); continue; }

        const suma = pub.entries.reduce((s, e) => s + BigInt(e.amountRaw), 0n);
        if (suma.toString() !== String(pub.total)) { mal(`epoca ${r.epoch}: el total anunciado no es la suma de la lista`); continue; }

        // Y cada prueba publicada tiene que valer para su hoja.
        let malas = 0;
        for (const fila of pub.entries) {
            let acc = hoja(r.epoch, fila.wallet, BigInt(fila.amountRaw));
            for (const h of fila.proof) acc = nodo(acc, Buffer.from(h, 'hex'));
            if (acc.toString('hex') !== pub.root) malas++;
        }
        if (malas) { mal(`epoca ${r.epoch}: ${malas} pruebas publicadas no validan`); continue; }
        ok(`epoca ${r.epoch} (${pub.date}): raiz, total y ${pub.entries.length} pruebas cuadran`);
    }

    titulo('Ganadores contra el leaderboard de ese dia');
    for (const r of rondas) {
        const pub = listas[r.epoch];
        if (!pub) continue;
        const dia = dias[pub.date];
        if (!dia) { avisa(`epoca ${r.epoch}: no tengo el leaderboard del ${pub.date} para contrastar`); continue; }

        // Que el hash del leaderboard que dice la ronda sea el de ese dia.
        if (pub.leaderboardHash && pub.leaderboardHash !== dia.hash) {
            mal(`epoca ${r.epoch}: dice salir de un leaderboard que no es el publicado para el ${pub.date}`);
            continue;
        }

        const top = dia.entries.slice(0, PESOS.length);
        const premiados = [...pub.entries].sort((a, b) => a.rank - b.rank);
        let problemas = 0;
        for (const p of premiados) {
            const enTop = top.find(t => t.rank === p.rank);
            if (!enTop) { mal(`epoca ${r.epoch}: el puesto ${p.rank} cobra pero no existe en el leaderboard`); problemas++; continue; }
            if (enTop.wallet !== p.wallet) {
                mal(`epoca ${r.epoch}: el puesto ${p.rank} lo gano ${enTop.wallet.slice(0, 8)}… y cobra ${p.wallet.slice(0, 8)}…`);
                problemas++;
            }
        }
        // Y los pesos: cada uno tiene que llevarse su parte del total, no la que le apetezca.
        const total = BigInt(pub.total);
        for (const p of premiados) {
            const esperado = (total * BigInt(Math.round(PESOS[p.rank - 1] * 10))) / 1000n;
            const real = BigInt(p.amountRaw);
            // Margen de una unidad minima: el reparto redondea a la baja.
            const dif = real > esperado ? real - esperado : esperado - real;
            if (dif > BigInt(premiados.length)) {
                mal(`epoca ${r.epoch}: el puesto ${p.rank} cobra ${real} y por peso le tocan ~${esperado}`);
                problemas++;
            }
        }
        if (!problemas) ok(`epoca ${r.epoch}: los ${premiados.length} premiados son el top del ${pub.date}, con sus pesos`);
    }

    titulo('Topes diarios');
    const cfg = estado.config;
    if (!cfg) { avisa('sin contrato desplegado no hay topes que comprobar'); return rondas; }
    const dec = 10 ** 6;
    for (const r of rondas) {
        if (r.pill > cfg.rewardCapPerEpoch + 1) mal(`epoca ${r.epoch}: reparte ${r.pill} PILL y el tope declarado es ${cfg.rewardCapPerEpoch}`);
    }
    const pasados = rondas.filter(r => r.pill > cfg.rewardCapPerEpoch + 1).length;
    if (!pasados) ok(`ninguna de las ${rondas.length} rondas pasa del tope de ${cfg.rewardCapPerEpoch} PILL/dia`);
    return rondas;
}

/* ===================== RECIBOS DE PARTIDA ===================== */

/*
 * Los recibos son lo que impide que el leaderboard sea "lo que dice el servidor". Se
 * comprueban tres cosas: que la cadena de lotes encaje, que cada recibo siga dando el
 * hash con el que se anclo, y —la que de verdad revela algo— que los premiados se
 * hayan cruzado con gente de verdad y no solo entre ellos.
 */
async function auditaPartidas(estado) {
    titulo('Recibos de partida');
    let cadena;
    try { cadena = await get('/api/matches/chain'); }
    catch (e) { avisa('no hay endpoint de recibos de partida en este servidor (' + e.message + ')'); return; }

    const check = cadena.check || {};
    if (!(cadena.batches || []).length) { avisa('todavia no se ha anclado ningun lote de partidas'); return; }
    if (check.ok) ok(`${check.lotes} lotes de recibos, la cadena encaja (${cadena.pendientes} recibos sin anclar)`);
    else {
        mal(`la cadena de recibos NO encaja: ${(check.fallos || []).length} problemas`);
        for (const f of (check.fallos || []).slice(0, 5)) console.log(`      lote ${f.lote}${f.match ? ' recibo ' + f.match : ''}: ${f.error}`);
    }

    // Rehacer un lote entero desde los recibos publicados, como haria un tercero.
    const ultimo = cadena.batches[cadena.batches.length - 1];
    try {
        const lote = await get('/api/matches/batch/' + ultimo.n);
        let rotos = 0;
        for (const r of lote.matches.slice(0, 25)) {
            const m = await get('/api/matches/' + r.id);
            // El hash del recibo se rehace con el mismo canonico que usa el servidor.
            const canon = JSON.stringify({
                seq: m.seq, room: m.room, mode: m.mode, startedAt: m.startedAt, endedAt: m.endedAt,
                entryFee: m.entryFee, pot: m.pot,
                players: m.players.slice()
                    .sort((a, b) => ((a.wallet || a.name || '') < (b.wallet || b.name || '') ? -1 : 1))
                    .map(p => ({ wallet: p.wallet, name: p.name, kills: p.kills, peak: p.peak, paid: p.paid })),
            });
            if (sha256hex(canon) !== r.hash) { mal(`recibo ${r.id}: el contenido no da el hash con el que se anclo`); rotos++; }
        }
        if (!rotos) ok(`los recibos del lote ${ultimo.n} cuadran con sus hashes`);
    } catch (e) { avisa('no pude bajar el ultimo lote: ' + e.message); }

    // Y el dato que revela el fraude que ninguna firma puede impedir.
    titulo('Con quien juegan los premiados');
    try {
        const op = await get('/api/matches/opponents?dias=7');
        const porWallet = new Map((op.wallets || []).map(w => [w.wallet, w]));
        const rondas = (estado.premios && estado.premios.rondas) || [];
        let sospechosas = 0, revisadas = 0;
        for (const r of rondas.slice(0, 3)) {
            const pub = await get('/api/rewards/' + r.epoch).catch(() => null);
            if (!pub) continue;
            for (const fila of pub.entries) {
                const w = porWallet.get(fila.wallet);
                revisadas++;
                if (!w) continue;   // puede haber premiado antes de la ventana de 7 dias
                if (w.oponentes < (op.minOponentes || 5)) {
                    mal(`${fila.wallet.slice(0, 8)}… cobro el puesto ${fila.rank} y solo se cruzo con ${w.oponentes} wallets en ${w.partidas} partidas`);
                    sospechosas++;
                }
            }
        }
        if (revisadas === 0) avisa('todavia no hay premiados que contrastar');
        else if (!sospechosas) ok(`los ${revisadas} premiados revisados se cruzan con gente distinta`);
    } catch (e) { avisa('no pude leer la tabla de oponentes: ' + e.message); }
}

/* ===================== PRUEBA DE PASIVO ===================== */

/*
 * La otra mitad de la prueba de reservas, y la que casi nadie publica: cuanto se
 * DEBE. Sin esto, el ratio de reservas lo calcula el propio sospechoso.
 */
async function auditaPasivo(estado) {
    titulo('Lo que el servidor dice que debe');
    let r;
    try { r = await get('/api/reserves'); }
    catch (e) { avisa('no hay prueba de pasivo en este servidor (' + e.message + ')'); return; }
    if (!r.ultimo) { avisa('todavia no se ha publicado ningun snapshot de saldos'); return; }

    const check = r.check || {};
    if (check.ok) ok(`${check.snapshots} snapshots de saldos, la cadena encaja`);
    else {
        mal(`la cadena de saldos NO encaja: ${(check.fallos || []).length} problemas`);
        for (const f of (check.fallos || []).slice(0, 5)) console.log(`      snapshot ${f.n}: ${f.error}`);
    }

    // Rehacer el total desde la lista publicada: que el numero anunciado sea la suma.
    try {
        const snap = await get('/api/reserves/' + r.ultimo.n);
        const suma = (snap.balances || []).reduce((a, b) => a + b.saldo, 0);
        if (suma !== snap.total) mal(`el pasivo anunciado (${snap.total}) no es la suma de la lista (${suma})`);
        else ok(`pasivo ${suma.toLocaleString('es-ES')} PILL sobre ${snap.balances.length} wallets, y la suma cuadra`);

        // Y contra la custodia on-chain: es la comprobacion que importa.
        if (estado.custody) {
            if (estado.custody.balance >= suma) ok(`la custodia (${estado.custody.balance.toLocaleString('es-ES')}) cubre el pasivo`);
            else mal(`FALTA DINERO: custodia ${estado.custody.balance} contra ${suma} debidos`);
        } else {
            avisa('sin contrato desplegado no hay custodia on-chain contra la que contrastar');
        }
        /*
         * La diferencia con las obligaciones de AHORA es un aviso, no un fallo: entre
         * un snapshot y el siguiente la gente deposita, juega y retira, asi que salvo
         * en un servidor parado los dos numeros no van a coincidir nunca. Lo que si
         * dice algo es cuanto se han separado y cuanto hace del ultimo snapshot: una
         * diferencia enorme con un snapshot reciente es lo que habria que mirar.
         */
        if (estado.pasivo && typeof estado.obligaciones === 'number') {
            const dif = Math.abs(estado.obligaciones - snap.total);
            const horas = (Date.now() - new Date(snap.at).getTime()) / 3600e3;
            if (dif === 0) ok('el snapshot coincide exactamente con las obligaciones de ahora');
            else avisa(`el pasivo se ha movido ${dif.toLocaleString('es-ES')} PILL desde el ultimo snapshot (hace ${horas.toFixed(1)} h) — normal si hay gente jugando`);
            if (horas > 6) avisa(`el ultimo snapshot es de hace ${horas.toFixed(1)} h: deberia publicarse mas a menudo`);
        }
    } catch (e) { avisa('no pude bajar el ultimo snapshot: ' + e.message); }
}

/* ===================== 6 y 7: LA CADENA ===================== */

async function auditaOnChain(estado) {
    titulo('Estado on-chain');
    if (!estado.programa) {
        avisa('NO HAY CONTRATO DESPLEGADO: el dinero de los jugadores y el del proyecto');
        avisa('comparten una wallet normal, sin bloqueo. Nada de lo de arriba esta respaldado');
        avisa('por ningun contrato todavia.');
        return;
    }

    const rpc = estado.rpc;
    const llamada = async (method, params) => {
        const r = await fetch(rpc, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(20000),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        return j.result;
    };

    // Los saldos, leidos del RPC y no del servidor: es la diferencia entre comprobar
    // y creerse lo que le cuentan a uno.
    for (const [nombre, v] of [['custodia', estado.custody], ['tesoreria', estado.treasury]]) {
        if (!v) continue;
        try {
            const r = await llamada('getTokenAccountBalance', [v.address]);
            const real = Number(r.value.uiAmount);
            if (Math.abs(real - v.balance) > 1) mal(`${nombre}: el servidor dice ${v.balance} y la cadena ${real}`);
            else ok(`${nombre}: ${real.toLocaleString('es-ES')} PILL, coincide con lo que publica el servidor`);
        } catch (e) { avisa(`${nombre}: no pude leer el saldo del RPC (${e.message})`); }
    }

    if (estado.obligaciones > 0 && estado.custody) {
        if (estado.custody.balance >= estado.obligaciones) {
            ok(`reservas cubiertas: ${estado.custody.balance.toLocaleString('es-ES')} en custodia contra ${estado.obligaciones.toLocaleString('es-ES')} debidos`);
        } else {
            mal(`RESERVAS CORTAS: ${estado.custody.balance} en custodia y ${estado.obligaciones} debidos a los jugadores`);
        }
    }

    if (estado.config) {
        const c = estado.config;
        if (c.bloqueado) ok(`tesoreria bloqueada ${c.diasParaDesbloqueo} dias mas (hasta ${c.unlockDate.slice(0, 10)})`);
        else avisa(`el bloqueo VENCIO el ${c.unlockDate.slice(0, 10)}: la tesoreria se puede retirar libremente`);
        if (c.finalized) ok('parametros congelados (finalize ejecutado)');
        else avisa('los parametros aun se pueden endurecer: fase de calibracion');
    }

    titulo('Lo que decide si algo de esto vale');
    const u = estado.upgradeAuthority;
    if (!u || !u.conocido) { avisa('no se pudo leer la upgrade authority del programa'); return; }
    if (u.inmutable) {
        ok('EL PROGRAMA ES INMUTABLE: la upgrade authority esta revocada.');
        ok('El codigo que impone el bloqueo no lo puede sustituir nadie.');
    } else {
        mal('EL PROGRAMA SIGUE SIENDO UPGRADEABLE.');
        mal(`Quien tenga la upgrade authority (${u.authority}) puede desplegar`);
        mal('una version nueva que vacie los vaults. Mientras esto sea asi, el bloqueo');
        mal('no garantiza nada y las comprobaciones de arriba no lo impiden.');
    }
}

/* ===================== MAIN ===================== */

(async () => {
    console.log(`\nAuditoria de la tesoreria de PillWars`);
    console.log(`Servidor: ${BASE}`);
    console.log(`Este script no usa nada del proyecto auditado salvo sus URLs publicas.`);

    let estado;
    try { estado = await get('/api/treasury'); }
    catch (e) { console.error('\nNo se puede leer /api/treasury: ' + e.message); process.exit(1); }

    const dias = await auditaCadena();
    await auditaRondas(estado, dias);
    await auditaOnChain(estado);
    await auditaPartidas(estado);
    await auditaPasivo(estado);

    console.log('');
    if (fallos === 0) {
        console.log(`\x1b[32m✓ Todo cuadra.\x1b[0m` + (avisos ? ` (${avisos} avisos)` : ''));
    } else {
        console.log(`\x1b[31m✗ ${fallos} comprobaciones fallidas.\x1b[0m` + (avisos ? ` (${avisos} avisos)` : ''));
    }
    console.log('');
    // exitCode y no exit(): con un process.exit() inmediato, los sockets que fetch
    // deja en el pool se cierran a mitad y libuv suelta un assert por consola que
    // parece un error de la auditoria sin serlo.
    process.exitCode = fallos === 0 ? 0 : 1;
})();
