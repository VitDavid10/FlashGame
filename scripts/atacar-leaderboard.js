#!/usr/bin/env node
/*
 * ATACAR NUESTRO PROPIO LEADERBOARD, PARA SABER SI LAS PUERTAS AGUANTAN.
 *
 *   node scripts/atacar-leaderboard.js
 *   node scripts/atacar-leaderboard.js 120        <- poblacion real de ese dia
 *
 * El leaderboard diario paga al top 10, asi que es un objetivo: montar N wallets,
 * hacerlas jugar entre ellas y copar los diez puestos. Contra eso hay cuatro
 * puertas (LB_MIN_KILLS, LB_MIN_OPPONENTS, LB_MIN_MATCHES, LB_MIN_KNOWN_PCT) y una
 * defensa economica. Nadie las habia atacado, asi que "aguantan" era una opinion.
 *
 * DOS COSAS SE MIDEN, Y NO SON LA MISMA:
 *
 *   1. ¿ENTRA EL CLUSTER EN LA LISTA?  Lo decide tablaDe(), y aqui se usa LA DE
 *      VERDAD, importada de server/leaderboard.js. Si el filtro cambia, este script
 *      cambia con el; una copia del filtro solo probaria la copia.
 *
 *   2. ¿LE SALE A CUENTA?  Eso es un MODELO, no una medida: se calcula con las
 *      formulas de rewards.js (bote = min(rake x REWARD_FACTOR, tope), recortado por
 *      participacion) y con el corte de arcade. Vale para el orden de magnitud y
 *      para ver el signo, no para el ultimo PILL.
 *
 * LO QUE EL ATACANTE CONTROLA. Las kills no son una barrera: dentro de su propia
 * sala decide quien mata a quien, asi que se le suponen las kills que quiera. La
 * unica magnitud que NO puede fabricar es a cuanta gente REAL ha conocido — un
 * cluster de N wallets tiene un techo de N-1 conocidos por mucho que juegue, y para
 * subirlo tiene que jugar contra personas de verdad y pagarles su parte.
 */
'use strict';

const path = require('path');
process.env.LB_DIR = process.env.LB_DIR || path.join(__dirname, '..', '.tmp-ataque');

const lb = require('../server/leaderboard.js');

const POBLACION = Number(process.argv[2] || 500);

/* Los mismos numeros que corren en el VPS. */
const REWARD_FACTOR = parseFloat(process.env.REWARD_FACTOR) || 12;
const TOPE_DIA = parseInt(process.env.REWARD_BUDGET_PILL, 10) || 50000;
const POT_COMPLETO_CON = parseInt(process.env.LB_FULL_POT_AT, 10) || 50;
const ARCADE_RAKE_PCT = parseFloat(process.env.ARCADE_RAKE_PCT) || 5;

const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 0 });
const pct = (n) => (n * 100).toFixed(1) + '%';

/*
 * Un dia con `poblacion` jugadores reales y un cluster de `cluster` wallets.
 *
 * `realesConocidos` es cuanta gente REAL ha conocido cada wallet del cluster: es la
 * palanca que le cuesta dinero, porque solo sube jugando partidas de verdad contra
 * personas que se llevan su parte del bote.
 *
 * A los reales se les da un perfil generoso (muchas kills, mucha gente conocida)
 * para no inflar el resultado: si el cluster gana aqui, gana de sobra en un dia
 * normal.
 */
function simulaDia({ poblacion, cluster, realesConocidos, killsCluster }) {
    const players = {};
    const oponentes = new Map();
    const pobTotal = poblacion + cluster;

    for (let i = 0; i < poblacion; i++) {
        const w = 'real' + i;
        // Kills repartidas: unos pocos arriba y una cola larga, como una tabla real.
        players[w] = { kills: Math.max(0, Math.round(40 / (1 + i * 0.35))), peak: 100 - i, name: w };
        // Un jugador de verdad se cruza con gente nueva cada partida. Se le supone
        // que conoce a un cuarto de la poblacion, que es poco para alguien activo.
        oponentes.set(w, {
            partidas: 6, oponentes: Math.min(pobTotal - 1, Math.round(pobTotal * 0.25)),
            // Un jugador suelto no repite companero: la cola lo baraja. Medido en
            // detectar-cluster.js con 500 jugadores: cohesion 0.
            cohesion: 0,
        });
    }

    for (let i = 0; i < cluster; i++) {
        const w = 'atac' + i;
        // Las kills se las regala: dentro de su sala decide el resultado.
        players[w] = { kills: killsCluster - i, peak: 999 - i, name: w };
        oponentes.set(w, {
            partidas: 10,
            // El techo del cluster: las otras N-1 wallets suyas, mas la gente real
            // que haya pagado por conocer.
            oponentes: Math.min(pobTotal - 1, (cluster - 1) + realesConocidos),
            /*
             * Y la cohesion, que es lo que no puede comprar: si sus wallets entran
             * juntas para controlar la sala, cada una coincide con las otras N-1 en
             * todas sus partidas. Sin este campo el ataque se enfrentaba solo a los
             * filtros viejos y la herramienta habria dicho que gana cuando ya no.
             */
            cohesion: cluster - 1,
        });
    }

    const tabla = lb.tablaDe(players, oponentes);
    const top10 = tabla.slice(0, 10);
    return {
        tabla,
        suyos: top10.filter(f => f.wallet.startsWith('atac')).length,
        entraAlguno: tabla.some(f => f.wallet.startsWith('atac')),
        elegibles: tabla.length,
    };
}

/*
 * El minimo de gente real que tiene que conocer para pasar LB_MIN_KNOWN_PCT.
 *
 * Se mide con `entraAlguno` y no con "copar los diez": un cluster de 5 wallets no
 * puede ocupar 10 puestos por aritmetica, no porque el filtro lo pare, y contarlo
 * como "imposible" hacia parecer defensa lo que era una tabla mal leida.
 */
function realesQueNecesita(poblacion, cluster) {
    for (let r = 0; r <= poblacion; r++) {
        const s = simulaDia({ poblacion, cluster, realesConocidos: r, killsCluster: 200 });
        if (s.entraAlguno) return r;
    }
    return null;
}

/*
 * Si le sale a cuenta. Modelo, no medida.
 *
 * En una sala de arcade llena de los suyos, el cluster recupera todo menos el corte
 * de la casa: ese corte ES el rake. Y el bote del dia se dimensiona con el rake por
 * REWARD_FACTOR, que es donde esta el problema — pierde el 5% y el juego le paga
 * doce veces ese 5% desde la asignacion de premios.
 */
function economia({ cicla, elegibles, puestosSuyos }) {
    const rake = cicla * (ARCADE_RAKE_PCT / 100);
    const coste = rake;                                  // lo unico que no recupera
    const bote = Math.min(rake * REWARD_FACTOR, TOPE_DIA)
        * Math.min(elegibles, POT_COMPLETO_CON) / POT_COMPLETO_CON;
    /*
     * Lo que se lleva. Los pesos de los puestos que ocupa, PERO con el tope de grupo:
     * si ocupa GRUPO_MIN_PUESTOS o mas, entre todos no pasan de GRUPO_MAX_PCT y el
     * resto va a los de fuera. Sin esto la herramienta seguiria diciendo que el
     * ataque cobra el 84% cuando ya no.
     */
    const bruto = lb.PESOS.slice(0, puestosSuyos).reduce((a, b) => a + b, 0) / 100;
    const parte = puestosSuyos >= lb.GRUPO_MIN_PUESTOS ? Math.min(bruto, lb.GRUPO_MAX_PCT) : bruto;
    const gana = bote * parte;
    return { cicla, rake, coste, bote, gana, neto: gana - coste, roi: coste > 0 ? gana / coste : 0 };
}

console.log('ATAQUE AL LEADERBOARD DIARIO — simulacion');
console.log('');
console.log('Filtros vivos :', `kills>=${lb.MIN_KILLS}`, `oponentes>=${lb.MIN_OPONENTES}`,
    `partidas>=${lb.MIN_PARTIDAS}`, `conocidos>=${pct(lb.MIN_CONOCIDOS_PCT)}`);
console.log('Economia      :', `factor ${REWARD_FACTOR}`, `tope ${fmt(TOPE_DIA)}/dia`,
    `bote completo con ${POT_COMPLETO_CON}`, `corte arcade ${ARCADE_RAKE_PCT}%`);
console.log('Tope de grupo :', pct(lb.GRUPO_MAX_PCT), 'entre todos, desde',
    lb.GRUPO_MIN_PUESTOS, 'puestos ocupados');
console.log('Poblacion real:', fmt(POBLACION), 'jugadores ese dia');

/* ============ 1. ¿ENTRA, JUGANDO SOLO CONTRA SI MISMO? ============ */
console.log('');
console.log('1. CLUSTER PURO — solo juegan entre ellos, no conocen a nadie real');
console.log('   cluster   conocidos     %      top10 suyos');
for (const n of [5, 10, 20, 50, 100, 200]) {
    const s = simulaDia({ poblacion: POBLACION, cluster: n, realesConocidos: 0, killsCluster: 200 });
    const conocidos = Math.min(POBLACION + n - 1, n - 1);
    const p = conocidos / (POBLACION + n - 1);
    console.log(`   ${String(n).padStart(7)}   ${String(conocidos).padStart(9)}  ${pct(p).padStart(6)}   `
        + `${String(s.suyos).padStart(11)}${s.suyos >= 10 ? '  <-- COPA EL TOP 10' : ''}`);
}

/* ============ 2. ¿CUANTA GENTE REAL TIENE QUE CONOCER? ============ */
console.log('');
console.log('2. LO QUE LE CUESTA PASAR LA PUERTA — gente real que tiene que conocer');
console.log('   cluster   reales necesarios   % de la poblacion   puestos que puede copar');
for (const n of [5, 10, 20, 50, 100, 200]) {
    const r = realesQueNecesita(POBLACION, n);
    const conR = r == null ? null : simulaDia({ poblacion: POBLACION, cluster: n, realesConocidos: r, killsCluster: 200 });
    console.log(`   ${String(n).padStart(7)}   ${String(r == null ? 'no pasa' : r).padStart(16)}   `
        + `${(r == null ? '—' : pct(r / POBLACION)).padStart(17)}   `
        + `${String(conR ? conR.suyos + ' de 10' : '—').padStart(22)}`);
}

/* ============ 3. SI ENTRA, ¿LE SALE A CUENTA? ============ */
console.log('');
console.log('3. SI CONSIGUE ENTRAR Y COPAR EL TOP 10 — cuentas del dia (modelo)');
console.log('   cicla/dia    rake(coste)      bote      se lleva      neto     x sobre coste');
for (const cicla of [10000, 50000, 83333, 200000, 1000000]) {
    const e = economia({ cicla, elegibles: 20, puestosSuyos: 10 });
    console.log(`   ${fmt(cicla).padStart(9)}   ${fmt(e.coste).padStart(11)}   ${fmt(e.bote).padStart(7)}   `
        + `${fmt(e.gana).padStart(10)}   ${(e.neto >= 0 ? '+' : '') + fmt(e.neto)}`.padEnd(14)
        + `   ${e.roi.toFixed(1)}x`);
}

console.log('');
console.log('   Tope alcanzado a partir de', fmt(TOPE_DIA / REWARD_FACTOR / (ARCADE_RAKE_PCT / 100)),
    'PILL ciclados/dia: por encima el coste sigue');
console.log('   subiendo y el bote no, asi que el ataque se desinfla solo.');

/* ============ 4. DE QUE DEPENDE QUE SALGA A CUENTA ============ */
/*
 * El factor es la palanca, y no es obvio: cada PILL que el cluster pierde de rake
 * le vuelve multiplicado por REWARD_FACTOR desde la asignacion de premios, recortado
 * por participacion. Debajo del factor de equilibrio el ataque pierde dinero solo,
 * sin necesidad de que ningun filtro lo detecte.
 */
console.log('');
console.log('4. LA PALANCA — a partir de que REWARD_FACTOR deja de salir a cuenta');
console.log('   elegibles   recorte   factor de equilibrio   ROI con el factor', REWARD_FACTOR);
for (const eleg of [10, 20, 50, 200]) {
    const recorte = Math.min(eleg, POT_COMPLETO_CON) / POT_COMPLETO_CON;
    // Con el tope de grupo, ocupar los diez puestos ya no vale los diez pesos: el
    // conjunto se queda en GRUPO_MAX_PCT. Sin esto esta tabla contradecia a la de
    // arriba, que si lo aplica.
    const parte = Math.min(lb.PESOS.reduce((a, b) => a + b, 0) / 100, lb.GRUPO_MAX_PCT);
    const equilibrio = 1 / (recorte * parte);
    const roi = REWARD_FACTOR * recorte * parte;
    console.log(`   ${String(eleg).padStart(9)}   ${pct(recorte).padStart(7)}   `
        + `${equilibrio.toFixed(1).padStart(20)}   ${roi.toFixed(1).padStart(17)}x`);
}
console.log('');
console.log('   El tope de grupo ya esta metido en estas cuentas. Baja mucho el ROI');
console.log('   pero NO lo pone en negativo mientras el factor sea alto: para eso');
console.log('   haria falta un tope de', pct(1 / REWARD_FACTOR), 'o bajar el factor.');
