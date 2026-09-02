/*
 * SIMULADOR DE LA TESORERIA — la herramienta de la fase de calibracion.
 *
 * Los caps del contrato solo se pueden APRETAR, nunca aflojar, y el bloqueo dura
 * anios. Un cap mal puesto no tiene arreglo: si es corto, la tesoreria se hincha sin
 * poder repartirse; si es largo y el juego no ingresa lo suficiente, los premios se
 * cortan de golpe un martes cualquiera. Este script proyecta las dos cosas antes de
 * que sean irreversibles.
 *
 *   node scripts/treasury-sim.js                 escenarios base / pesimista / optimista
 *   node scripts/treasury-sim.js --anios 6
 *   node scripts/treasury-sim.js --partidas 400 --skins 12 --inicial 40000000
 *   node scripts/treasury-sim.js --json          salida cruda para pegarla en otro sitio
 *
 * DE DONDE SALEN LOS INGRESOS (los tres son rake que HOY ya existe o casi):
 *
 *   1. Exit fee de classic. classicExitFeePct() cobra 10/20/50 % del carry al hacer
 *      cashout segun kills (server/index.js:651). Ese PILL se descuenta del saldo
 *      interno y se queda fisicamente en el treasury: es rake real que hoy no se
 *      contabiliza en ninguna parte.
 *   2. Bote de arcade sin reclamar. Los pesos suman 100 %, pero solo cobra quien
 *      tiene wallet y solo hay diez puestos: con menos de diez jugadores en el
 *      ranking, o con ganadores sin wallet, la parte sobrante se queda dentro
 *      (server/room-loop.js:155).
 *   3. Tienda de skins y conversor de SP. Hoy se quema el 100 %. La propuesta es
 *      partirlo: mitad quemar (el supply sigue bajando) y mitad a tesoreria.
 *
 * LO QUE ESTE SIMULADOR NO SABE: si la gente va a jugar. Los numeros de entrada son
 * hipotesis, no datos. Sirve para responder "SI pasa esto, aguanta?", no para
 * adivinar cuanta gente va a venir. En cuanto haya un mes de datos reales, los
 * parametros salen de transactions.log y esto deja de ser una hipotesis.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ===================== PARAMETROS ===================== */

const args = process.argv.slice(2);
const flag = (nombre, def) => {
    const i = args.indexOf('--' + nombre);
    return i >= 0 && args[i + 1] != null ? Number(args[i + 1]) : def;
};
const tiene = (nombre) => args.includes('--' + nombre);
const flagStr = (nombre) => { const i = args.indexOf('--' + nombre); return i >= 0 && args[i + 1] != null ? args[i + 1] : null; };

// Precio real del oraculo (server/globalsettings.json). Se usa solo para traducir a $.
const PILL_POR_DOLAR = flag('rate', 232.3);
const PRECIO_SKIN_PILL = 25000;          // skinshop.js: PRECIO_SP * PILL_POR_SP

const ESCENARIOS = {
    pesimista: {
        nombre: 'PESIMISTA',
        partidasDia: 60,            // partidas de pago al dia (todas las salas)
        jugadoresPartida: 6,
        entradaMediaUsd: 3,
        feeMedioClassic: 0.12,      // % efectivo del exit fee sobre el volumen
        pctClassic: 0.5,            // reparto classic / arcade
        noReclamadoArcade: 0.18,    // parte del bote que no llega a cobrarse
        skinsDia: 1,
        conversionDiaPill: 20000,
        splitTesoreria: 0.5,        // de lo que se gasta en la tienda, cuanto NO se quema
    },
    base: {
        nombre: 'BASE',
        partidasDia: 250,
        jugadoresPartida: 9,
        entradaMediaUsd: 5,
        feeMedioClassic: 0.15,
        pctClassic: 0.5,
        noReclamadoArcade: 0.12,
        skinsDia: 6,
        conversionDiaPill: 120000,
        splitTesoreria: 0.5,
    },
    optimista: {
        nombre: 'OPTIMISTA',
        partidasDia: 900,
        jugadoresPartida: 14,
        entradaMediaUsd: 8,
        feeMedioClassic: 0.15,
        pctClassic: 0.5,
        noReclamadoArcade: 0.10,
        skinsDia: 25,
        conversionDiaPill: 600000,
        splitTesoreria: 0.5,
    },
};

// Overrides por CLI: se aplican a los tres escenarios.
for (const e of Object.values(ESCENARIOS)) {
    e.partidasDia = flag('partidas', e.partidasDia);
    e.skinsDia = flag('skins', e.skinsDia);
    e.entradaMediaUsd = flag('entrada', e.entradaMediaUsd);
    e.splitTesoreria = flag('split', e.splitTesoreria);
}

const ANIOS = flag('anios', 4);
const DIAS = Math.round(ANIOS * 365);
const INICIAL = flag('inicial', 30_000_000);     // PILL comprados en el lanzamiento
const BPS_DIA = flag('bps', 5);                  // 0,05 % del saldo por dia
const CAP_ABS = flag('cap', 250_000);            // tope absoluto por dia, en PILL

/* ===================== DATOS REALES ===================== */

/*
 * Lee server/transactions.log y saca los ingresos de tesoreria MEDIDOS, sin
 * hipotesis de por medio. Es la diferencia entre "si pasa esto, aguanta" y "esto es
 * lo que esta pasando", y es lo que decide los caps definitivos.
 *
 * La cuenta es una resta: lo que entra por entradas menos lo que sale por premios,
 * cashouts y reembolsos. Lo que queda es el rake — el exit fee de classic y las
 * partes del bote de arcade que nadie reclamo — y esta contabilizado por el propio
 * servidor, tal y como ocurrio.
 *
 *   entry    negativo, lo que paga el jugador al entrar
 *   cashout  positivo, lo que se lleva al salir vivo (ya con el fee descontado)
 *   prize    positivo, victorias de classic y reparto de arcade
 *   refund   positivo, entrada devuelta (sala que no arranco, o reinicio de admin)
 *   skin     negativo cuando se paga en $PILL, 0 cuando se paga en SP
 */
function analizaLog(fichero) {
    let lineas;
    try { lineas = fs.readFileSync(fichero, 'utf8').split('\n').filter(Boolean); }
    catch (e) { return { error: 'no se puede leer ' + fichero + ': ' + e.message }; }

    const porDia = new Map();
    let malformadas = 0;
    for (const l of lineas) {
        let e;
        try { e = JSON.parse(l); } catch (err) { malformadas++; continue; }
        if (!e || !e.fecha) { malformadas++; continue; }
        const dia = String(e.fecha).slice(0, 10);
        if (!porDia.has(dia)) porDia.set(dia, { entradas: 0, pagado: 0, refunds: 0, tienda: 0, n: 0 });
        const d = porDia.get(dia);
        const cantidad = Math.abs(Number(e.amount) || 0);
        d.n++;
        if (e.type === 'entry') d.entradas += cantidad;
        else if (e.type === 'cashout' || e.type === 'prize') d.pagado += cantidad;
        else if (e.type === 'refund') d.refunds += cantidad;
        else if (e.type === 'skin') d.tienda += cantidad;   // 0 si se pago con SP
    }

    const dias = [...porDia.entries()].sort();
    // Solo cuentan los dias con movimiento de dinero: incluir los dias muertos
    // dividiria la media por dias en los que no habia servidor levantado, y saldria
    // un ingreso "real" mas bajo que el de verdad.
    const activos = dias.filter(([, d]) => d.entradas > 0 || d.tienda > 0);
    if (activos.length === 0) return { error: 'el log no tiene ni una entrada de pago todavia' };

    const total = activos.reduce((a, [, d]) => ({
        entradas: a.entradas + d.entradas,
        pagado: a.pagado + d.pagado,
        refunds: a.refunds + d.refunds,
        tienda: a.tienda + d.tienda,
    }), { entradas: 0, pagado: 0, refunds: 0, tienda: 0 });

    const rake = total.entradas - total.pagado - total.refunds;
    return {
        dias: activos.length,
        primerDia: activos[0][0],
        ultimoDia: activos[activos.length - 1][0],
        malformadas,
        entradasDia: total.entradas / activos.length,
        pagadoDia: total.pagado / activos.length,
        refundsDia: total.refunds / activos.length,
        tiendaDia: total.tienda / activos.length,
        rakeDia: rake / activos.length,
        rakePct: total.entradas > 0 ? rake / total.entradas : 0,
        serie: activos,
    };
}

function informeLog(fichero) {
    const r = analizaLog(fichero);
    console.log('');
    console.log('━'.repeat(78));
    console.log('  DATOS REALES  ' + fichero);
    console.log('━'.repeat(78));
    if (r.error) {
        console.log(`\n  ${r.error}`);
        console.log('  Sin datos no hay calibracion posible: los escenarios de abajo son hipotesis,');
        console.log('  no medidas. NO fijes los caps definitivos con esto.\n');
        return null;
    }

    console.log(`\n  ${r.dias} dias con movimiento (${r.primerDia} → ${r.ultimoDia})`);
    if (r.malformadas) console.log(`  ${r.malformadas} lineas ilegibles, ignoradas`);
    console.log('\n  MEDIA POR DIA ACTIVO');
    console.log(`    Entradas cobradas ......... ${fmt(r.entradasDia).padStart(12)} PILL   ${usd(r.entradasDia)}`);
    console.log(`    Pagado a jugadores ........ ${fmt(r.pagadoDia).padStart(12)} PILL   ${usd(r.pagadoDia)}`);
    console.log(`    Reembolsado ............... ${fmt(r.refundsDia).padStart(12)} PILL   ${usd(r.refundsDia)}`);
    console.log(`    ${'─'.repeat(52)}`);
    console.log(`    RAKE (queda en la casa) ... ${fmt(r.rakeDia).padStart(12)} PILL   ${usd(r.rakeDia)}`);
    console.log(`    Gastado en la tienda ...... ${fmt(r.tiendaDia).padStart(12)} PILL   ${usd(r.tiendaDia)}`);
    console.log(`\n    El rake es el ${(r.rakePct * 100).toFixed(1)} % de lo apostado.`);

    if (r.dias < 14) {
        console.log(`\n  ⚠ Solo ${r.dias} dias de datos. Es poco para fijar nada irreversible:`);
        console.log('    un fin de semana bueno o una racha mala mueven esta media a la mitad.');
    }
    return r;
}

/* ===================== MODELO ===================== */

/** Ingresos diarios de tesoreria, en PILL, desglosados por origen. */
function ingresosDia(e) {
    // Escenario derivado del log: el rake esta MEDIDO, no modelado. Se devuelve tal
    // cual en vez de reconstruirlo a partir de partidas/jugadores/fee, que serian
    // tres suposiciones para llegar a un numero que ya se sabe.
    if (e._ingresosMedidos != null) {
        return {
            rakeClassic: 0, rakeArcade: 0, tienda: 0,
            total: e._ingresosMedidos,
            volumenDia: e._volumenMedido || 0,
            quemadoDia: 0,
            medido: true,
        };
    }
    const entradaPill = e.entradaMediaUsd * PILL_POR_DOLAR;
    const volumenDia = e.partidasDia * e.jugadoresPartida * entradaPill;

    const volClassic = volumenDia * e.pctClassic;
    const volArcade = volumenDia * (1 - e.pctClassic);

    const rakeClassic = volClassic * e.feeMedioClassic;
    const rakeArcade = volArcade * e.noReclamadoArcade;
    const tienda = (e.skinsDia * PRECIO_SKIN_PILL + e.conversionDiaPill) * e.splitTesoreria;

    return {
        rakeClassic, rakeArcade, tienda,
        total: rakeClassic + rakeArcade + tienda,
        volumenDia,
        quemadoDia: (e.skinsDia * PRECIO_SKIN_PILL + e.conversionDiaPill) * (1 - e.splitTesoreria),
    };
}

/**
 * Proyecta dia a dia. El premio de cada dia es lo que el grifo deja salir:
 * min(cap absoluto, saldo x bps). Es lo mismo que valida publish_round().
 */
function proyecta(e, { bpsDia, capAbs, inicial, dias }) {
    const ing = ingresosDia(e);
    let saldo = inicial;
    let repartido = 0;
    const serie = [];
    let diaSeco = -1;

    for (let d = 0; d < dias; d++) {
        saldo += ing.total;
        const premio = Math.min(capAbs, Math.floor(saldo * bpsDia / 10000));
        saldo -= premio;
        repartido += premio;
        if (saldo < capAbs && diaSeco < 0 && d > 30) diaSeco = d;
        if (d % 30 === 0 || d === dias - 1) serie.push({ dia: d, saldo, premio });
    }
    return { ing, saldo, repartido, serie, diaSeco, premioFinal: serie[serie.length - 1].premio };
}

/*
 * El cap "de equilibrio": el premio diario que iguala exactamente lo que entra.
 * Con este cap la tesoreria ni crece ni se drena — el principal del lanzamiento
 * queda intacto hasta que venza el bloqueo y todo lo repartido sale de lo que el
 * juego genera. Es el numero mas honesto para anunciar.
 */
function capEquilibrio(e) { return ingresosDia(e).total; }

/* ===================== SALIDA ===================== */

const fmt = (n) => Math.round(n).toLocaleString('es-ES');
const usd = (pill) => '$' + (pill / PILL_POR_DOLAR).toLocaleString('es-ES', { maximumFractionDigits: 0 });

// Pesos del top 10 (los mismos que arcade ya usa en server/room-loop.js:156).
const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];

function informe(e) {
    const r = proyecta(e, { bpsDia: BPS_DIA, capAbs: CAP_ABS, inicial: INICIAL, dias: DIAS });
    const eq = capEquilibrio(e);

    console.log('');
    console.log('━'.repeat(78));
    console.log(r.ing.medido
        ? `  ESCENARIO ${e.nombre}   ingresos tomados del log de transacciones`
        : `  ESCENARIO ${e.nombre}   ${e.partidasDia} partidas/dia · ${e.jugadoresPartida} jug/partida · entrada ${e.entradaMediaUsd}$`);
    console.log('━'.repeat(78));

    console.log('\n  INGRESOS DE TESORERIA (por dia)');
    if (r.ing.medido) {
        console.log('    (rake y tienda medidos en transactions.log, no modelados)');
    } else {
        console.log(`    Exit fee classic .......... ${fmt(r.ing.rakeClassic).padStart(12)} PILL   ${usd(r.ing.rakeClassic)}`);
        console.log(`    Bote arcade no reclamado .. ${fmt(r.ing.rakeArcade).padStart(12)} PILL   ${usd(r.ing.rakeArcade)}`);
        console.log(`    Tienda + conversor ........ ${fmt(r.ing.tienda).padStart(12)} PILL   ${usd(r.ing.tienda)}`);
    }
    console.log(`    ${'─'.repeat(52)}`);
    console.log(`    TOTAL ..................... ${fmt(r.ing.total).padStart(12)} PILL   ${usd(r.ing.total)}`);
    if (!r.ing.medido) console.log(`    (ademas se queman ${fmt(r.ing.quemadoDia)} PILL/dia, que no entran aqui)`);
    console.log(`    Volumen apostado .......... ${fmt(r.ing.volumenDia).padStart(12)} PILL   ${usd(r.ing.volumenDia)}`);

    console.log(`\n  GRIFO  cap ${fmt(CAP_ABS)} PILL/dia · ${BPS_DIA} bps (${(BPS_DIA / 100).toFixed(2)} %/dia · ~${(BPS_DIA * 365 / 100).toFixed(0)} %/anio)`);
    console.log(`    Saldo inicial ............. ${fmt(INICIAL).padStart(12)} PILL   ${usd(INICIAL)}`);
    console.log(`    Saldo a ${String(ANIOS).padStart(2)} anios ........... ${fmt(r.saldo).padStart(12)} PILL   ${usd(r.saldo)}`);
    console.log(`    Repartido en total ........ ${fmt(r.repartido).padStart(12)} PILL   ${usd(r.repartido)}`);
    console.log(`    Premio diario al final .... ${fmt(r.premioFinal).padStart(12)} PILL   ${usd(r.premioFinal)}`);

    // Cual de los dos frenos aprieta, al principio y al final: son distintos, porque
    // el de bps se mueve con el saldo y el absoluto no.
    const mandaAl = (saldo) => (Math.floor(saldo * BPS_DIA / 10000) >= CAP_ABS ? 'CAP ABSOLUTO' : 'BPS del saldo');
    console.log(`    Manda ..................... ${mandaAl(INICIAL)} al empezar · ${mandaAl(r.saldo)} al final`);

    console.log('\n  QUE COBRA CADA PUESTO (con el premio diario del final)');
    const linea = PESOS.map((p, i) => `#${i + 1} ${fmt(r.premioFinal * p / 100)}`).slice(0, 5).join('   ');
    console.log(`    ${linea}`);
    console.log(`    El #1 se lleva ${usd(r.premioFinal * 0.35)} al dia · el #10, ${usd(r.premioFinal * 0.015)}`);

    console.log('\n  EVOLUCION (saldo de tesoreria, cada 6 meses)');
    const cada = Math.max(1, Math.floor(r.serie.length / 8));
    // La barra se escala al maximo de la propia serie: si se escalara al saldo
    // inicial, cualquier escenario que crezca sale con todas las barras al tope y la
    // grafica no dice nada.
    const techo = Math.max(...r.serie.map(s => s.saldo), 1);
    for (let i = 0; i < r.serie.length; i += cada) {
        const s = r.serie[i];
        const meses = Math.round(s.dia / 30);
        const barra = '█'.repeat(Math.max(1, Math.round(s.saldo / techo * 38)));
        console.log(`    mes ${String(meses).padStart(3)}  ${fmt(s.saldo).padStart(12)} PILL  ${barra}`);
    }

    console.log('\n  VEREDICTO');
    if (r.saldo > INICIAL * 1.5) {
        console.log(`    ✓ La tesoreria CRECE: el grifo se queda corto para lo que entra.`);
        console.log(`      Cap de equilibrio (ni crece ni baja): ${fmt(eq)} PILL/dia (${usd(eq)}).`);
        console.log(`      Con el cap actual sobra dinero bloqueado; considera ${fmt(eq)} como techo.`);
    } else if (r.saldo > INICIAL * 0.8) {
        console.log(`    ✓ SOSTENIBLE: acaba cerca de donde empezo. Los premios salen de lo`);
        console.log(`      que genera el juego, no del principal. Es el punto que buscas.`);
    } else if (r.diaSeco > 0) {
        console.log(`    ✗ SE DRENA: a este ritmo el saldo se queda corto sobre el dia ${r.diaSeco}`);
        console.log(`      (mes ${Math.round(r.diaSeco / 30)}). Baja el cap a ~${fmt(eq)} PILL/dia o los`);
        console.log(`      premios se cortaran en seco.`);
    } else {
        console.log(`    ⚠ BAJA pero aguanta los ${ANIOS} anios. Cap de equilibrio: ${fmt(eq)} PILL/dia.`);
    }
    return { escenario: e.nombre, ingresosDia: r.ing.total, saldoFinal: r.saldo, repartido: r.repartido, capEquilibrio: eq };
}

/* ===================== MAIN ===================== */

/*
 * Los datos reales van primero, si los hay: todo lo demas son hipotesis y esto no.
 * Con --log se apunta a otro fichero (el del VPS, por ejemplo); con --no-log se
 * salta y quedan solo los escenarios modelados.
 */
const LOG = tiene('no-log') ? null : (flagStr('log') || path.join(__dirname, '..', 'server', 'transactions.log'));
const real = LOG ? informeLog(LOG) : null;

// Con datos reales se anade un escenario mas: el que de verdad esta pasando.
if (real) {
    const split = flag('split', 0.5);
    ESCENARIOS.real = {
        nombre: 'REAL (medido)',
        partidasDia: 0, jugadoresPartida: 0, entradaMediaUsd: 0,
        feeMedioClassic: 0, pctClassic: 0.5, noReclamadoArcade: 0,
        skinsDia: 0, conversionDiaPill: 0, splitTesoreria: split,
        _ingresosMedidos: real.rakeDia + real.tiendaDia * split,
        _volumenMedido: real.entradasDia,
    };
}

const resultados = Object.values(ESCENARIOS).map(informe);

if (tiene('json')) {
    console.log('\n' + JSON.stringify(resultados, null, 2));
}

console.log('');
console.log('━'.repeat(78));
console.log('  RECOMENDACION DE CAPS');
console.log('━'.repeat(78));
const eqPes = resultados[0].capEquilibrio;
const eqBase = resultados[1].capEquilibrio;
console.log(`
  El cap tiene que aguantar el escenario MALO, no el bueno: solo se puede bajar.
  Si se pone al nivel del escenario base y luego viene el pesimista, los premios
  se comen el principal y no hay forma de subir el cap otra vez.

    reward_cap_per_epoch  ${fmt(eqPes)} PILL/dia      (equilibrio del PESIMISTA)
    reward_bps_per_epoch  ${BPS_DIA} bps                    (freno de emergencia)
    challenge_secs        172800                     (48 h de impugnacion)

  Los bps son un segundo freno, no el principal: si la tesoreria creciera mucho,
  el ${BPS_DIA} bps dejaria salir ${fmt(INICIAL * 3 * BPS_DIA / 10000)} PILL/dia con 3x el saldo inicial. El cap
  absoluto es el que de verdad manda mientras el saldo sea normal.

  Con el escenario BASE (equilibrio ${fmt(eqBase)} PILL/dia) el cap del pesimista
  deja de ser el limitante y la tesoreria crece: eso no es un problema, es margen.
  Repartir de menos se arregla; repartir de mas, no.
`);
