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

/* ===================== PARAMETROS ===================== */

const args = process.argv.slice(2);
const flag = (nombre, def) => {
    const i = args.indexOf('--' + nombre);
    return i >= 0 && args[i + 1] != null ? Number(args[i + 1]) : def;
};
const tiene = (nombre) => args.includes('--' + nombre);

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

/* ===================== MODELO ===================== */

/** Ingresos diarios de tesoreria, en PILL, desglosados por origen. */
function ingresosDia(e) {
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
    console.log(`  ESCENARIO ${e.nombre}   ${e.partidasDia} partidas/dia · ${e.jugadoresPartida} jug/partida · entrada ${e.entradaMediaUsd}$`);
    console.log('━'.repeat(78));

    console.log('\n  INGRESOS DE TESORERIA (por dia)');
    console.log(`    Exit fee classic .......... ${fmt(r.ing.rakeClassic).padStart(12)} PILL   ${usd(r.ing.rakeClassic)}`);
    console.log(`    Bote arcade no reclamado .. ${fmt(r.ing.rakeArcade).padStart(12)} PILL   ${usd(r.ing.rakeArcade)}`);
    console.log(`    Tienda + conversor ........ ${fmt(r.ing.tienda).padStart(12)} PILL   ${usd(r.ing.tienda)}`);
    console.log(`    ${'─'.repeat(52)}`);
    console.log(`    TOTAL ..................... ${fmt(r.ing.total).padStart(12)} PILL   ${usd(r.ing.total)}`);
    console.log(`    (ademas se queman ${fmt(r.ing.quemadoDia)} PILL/dia, que no entran aqui)`);
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
