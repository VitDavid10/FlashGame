#!/usr/bin/env node
/*
 * ¿SE PUEDE VER UN CLUSTER POR CON QUIEN JUEGA, Y NO POR CUANTOS CONOCE?
 *
 *   node scripts/detectar-cluster.js
 *   node scripts/detectar-cluster.js 500 20      <- poblacion, tamaño del cluster
 *
 * atacar-leaderboard.js dejo dos preguntas abiertas:
 *
 *   1. ¿Los jugadores reales dentro de la sala estropean el plan del atacante?
 *   2. ¿Se puede detectar "veinte wallets que SIEMPRE coinciden" aunque cada
 *      partida vean caras nuevas?
 *
 * Aqui se simulan PARTIDAS de verdad —cola, salas de 25, emparejamiento— y no solo
 * el recuento final, porque las dos preguntas son sobre lo que pasa dentro de la
 * sala y eso no se ve en la tabla del dia.
 *
 * LA IDEA QUE SE PRUEBA (de David): contar cuantos DISTINTOS conoces no basta,
 * porque el atacante compra distintos jugando cuatro partidas con gente real. Pero
 * la REPETICION no la puede evitar: si sus veinte wallets van siempre juntas, cada
 * una se cruza con las otras diecinueve en TODAS sus partidas. Un jugador de verdad
 * no repite compañero casi nunca, porque la cola lo baraja.
 *
 * Todo esto es un MODELO. Vale para saber si la señal existe y cuanto separa; no
 * dice como se comporta la gente real de este juego, que solo se sabe midiendola.
 */
'use strict';

const path = require('path');
process.env.LB_DIR = process.env.LB_DIR || path.join(__dirname, '..', '.tmp-ataque');

const lb = require('../server/leaderboard.js');

const POBLACION = Number(process.argv[2] || 500);
const CLUSTER = Number(process.argv[3] || 20);
const SALA = Number(process.env.SALA || 25);
const PARTIDAS_POR_WALLET = 10;

const fmt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 0 });
const pct = (n) => (n * 100).toFixed(1) + '%';

/* ===================== LA SIMULACION DE PARTIDAS ===================== */

/*
 * Una tanda de partidas. La cola se baraja para los reales; el cluster entra JUNTO,
 * que es lo unico que tiene que hacer para coincidir consigo mismo.
 *
 * `amigos` son grupos de gente real que tambien juega junta —cinco colegas que se
 * meten a la vez— y estan aqui a proposito: cualquier detector que no los distinga
 * del atacante es inservible, porque castigaria a los jugadores mas fieles.
 */
function juega({ poblacion, cluster, amigos = [], sala = SALA, partidas = PARTIDAS_POR_WALLET }) {
    const reales = Array.from({ length: poblacion }, (_, i) => 'real' + i);
    const atac = Array.from({ length: cluster }, (_, i) => 'atac' + i);

    // Grupos que entran a la vez: el cluster y los grupos de amigos.
    const grupos = [];
    if (cluster > 0) grupos.push(atac);
    let siguiente = 0;
    for (const n of amigos) {
        grupos.push(reales.slice(siguiente, siguiente + n));
        siguiente += n;
    }
    const sueltos = reales.slice(siguiente);

    // wallet -> Map(otro -> veces que han coincidido)
    const cruces = new Map();
    const partidasDe = new Map();
    const todos = [...reales, ...atac];
    for (const w of todos) { cruces.set(w, new Map()); partidasDe.set(w, 0); }

    const anota = (sala) => {
        for (const a of sala) {
            partidasDe.set(a, partidasDe.get(a) + 1);
            const m = cruces.get(a);
            for (const b of sala) if (a !== b) m.set(b, (m.get(b) || 0) + 1);
        }
    };

    for (let ronda = 0; ronda < partidas; ronda++) {
        // La cola de esta ronda: los grupos como bloques y los sueltos barajados.
        const cola = [];
        for (const g of grupos) cola.push({ bloque: g });
        for (const w of sueltos) cola.push({ bloque: [w] });
        // Barajar el orden de llegada. Los bloques siguen siendo bloques: es lo que
        // hace un grupo que entra a la vez, sea de amigos o de un atacante.
        for (let i = cola.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cola[i], cola[j]] = [cola[j], cola[i]];
        }
        let actual = [];
        for (const { bloque } of cola) {
            // Un bloque mas grande que la sala se parte; uno que no cabe en lo que
            // queda abre sala nueva, que es como se comporta un matchmaker real.
            if (actual.length + bloque.length > sala) { if (actual.length) anota(actual); actual = []; }
            for (const w of bloque) {
                actual.push(w);
                if (actual.length === sala) { anota(actual); actual = []; }
            }
        }
        if (actual.length > 1) anota(actual);
    }
    return { cruces, partidasDe, todos, atac, reales };
}

/* ===================== EL DETECTOR ===================== */

/*
 * COHESION: con cuanta gente coincides en casi TODAS tus partidas.
 *
 * No es "cuantos distintos conoces" (eso ya lo mira LB_MIN_KNOWN_PCT y se compra
 * jugando un rato con gente real). Es cuantos compañeros se repiten SIEMPRE, que es
 * lo que un cluster no puede evitar sin dejar de ser un cluster: si sus wallets se
 * separan para no repetirse, dejan de controlar la sala y de fabricar kills.
 *
 * Un jugador suelto en una poblacion grande casi nunca repite: la cola lo baraja.
 * Cinco amigos que juegan siempre juntos dan cohesion 4 — la señal los ve, y por eso
 * el umbral no puede ser "mayor que cero" sino del tamaño que hace falta para
 * dominar una sala.
 */
function cohesionDe(cruces, partidasDe, w, umbral = 0.8) {
    const m = cruces.get(w), p = partidasDe.get(w) || 0;
    if (!p) return 0;
    let n = 0;
    for (const veces of m.values()) if (veces / p >= umbral) n++;
    return n;
}

function estadisticas(sim, quienes) {
    const vals = quienes.map(w => cohesionDe(sim.cruces, sim.partidasDe, w));
    vals.sort((a, b) => a - b);
    const media = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    return {
        n: vals.length, media,
        p50: vals[Math.floor(vals.length * 0.5)] || 0,
        p95: vals[Math.floor(vals.length * 0.95)] || 0,
        max: vals[vals.length - 1] || 0,
    };
}

console.log('DETECTAR UN CLUSTER POR REPETICION DE COMPAÑEROS — simulacion');
console.log('');
console.log('Poblacion real :', fmt(POBLACION));
console.log('Cluster        :', fmt(CLUSTER), 'wallets que entran siempre juntas');
console.log('Sala           :', SALA, 'jugadores ·', PARTIDAS_POR_WALLET, 'partidas cada uno');

/* ===== 1. ¿LOS REALES DENTRO DE LA SALA ESTROPEAN EL PLAN? ===== */
console.log('');
console.log('1. ¿ESTORBAN LOS JUGADORES REALES DENTRO DE LA SALA?');
const sim1 = juega({ poblacion: POBLACION, cluster: CLUSTER });
const suyosPorSala = [];
{
    // Cuanta sala controla de media: sus compañeros propios sobre el total.
    for (const w of sim1.atac) {
        const m = sim1.cruces.get(w), p = sim1.partidasDe.get(w) || 1;
        let propios = 0, total = 0;
        for (const [otro, veces] of m) { total += veces; if (otro.startsWith('atac')) propios += veces; }
        if (total) suyosPorSala.push(propios / total);
    }
}
const control = suyosPorSala.reduce((a, b) => a + b, 0) / (suyosPorSala.length || 1);
console.log('   Parte de la sala que es suya, de media:', pct(control));
console.log('   Quedan para reales                    :', pct(1 - control));
console.log('');
console.log('   Las kills NO se las quitan: el cluster se las hace ENTRE SUS PROPIAS');
console.log('   wallets, asi que un real dentro de la sala es un testigo, no un freno.');
console.log('   Lo que si cambia el real es la firma: le rompe la repeticion. Por eso');
console.log('   la defensa no esta en quien gana la partida, sino en el punto 2.');

/* ===== 2. LA SEÑAL: ¿SEPARA A UN CLUSTER DE UN JUGADOR NORMAL? ===== */
console.log('');
console.log('2. COHESION — con cuanta gente coincides en >=80% de tus partidas');
console.log('   grupo                        n    media    p50    p95    max');
const filas = [
    ['jugador suelto', sim1.reales.slice(0, POBLACION)],
    ['wallet del cluster', sim1.atac],
];
for (const [nombre, quienes] of filas) {
    const e = estadisticas(sim1, quienes);
    console.log(`   ${nombre.padEnd(24)} ${String(e.n).padStart(5)}  ${e.media.toFixed(2).padStart(7)}`
        + `  ${String(e.p50).padStart(5)}  ${String(e.p95).padStart(5)}  ${String(e.max).padStart(5)}`);
}

/* ===== 3. LOS FALSOS POSITIVOS: GRUPOS DE AMIGOS ===== */
console.log('');
console.log('3. FALSOS POSITIVOS — gente real que TAMBIEN juega siempre junta');
console.log('   grupo de amigos      cohesion media   ¿lo marcaria un umbral de 8?');
for (const tam of [2, 3, 5, 8, 12]) {
    const sim = juega({ poblacion: POBLACION, cluster: 0, amigos: [tam] });
    const grupo = sim.reales.slice(0, tam);
    const e = estadisticas(sim, grupo);
    console.log(`   ${(tam + ' amigos').padEnd(20)} ${e.media.toFixed(2).padStart(14)}   `
        + `${e.media >= 8 ? 'SI — falso positivo' : 'no'}`);
}

/* ===== 4. ¿DONDE PONER EL UMBRAL? ===== */
console.log('');
console.log('4. EL UMBRAL — cuantos marca de cada lado');
console.log('   umbral   wallets del cluster marcadas   jugadores sueltos marcados');
for (const u of [3, 5, 8, 12, 16]) {
    const marcadosAtac = sim1.atac.filter(w => cohesionDe(sim1.cruces, sim1.partidasDe, w) >= u).length;
    const marcadosReal = sim1.reales.filter(w => cohesionDe(sim1.cruces, sim1.partidasDe, w) >= u).length;
    console.log(`   ${String(u).padStart(6)}   ${(pct(marcadosAtac / (CLUSTER || 1)) + ` (${marcadosAtac}/${CLUSTER})`).padStart(28)}   `
        + `${(pct(marcadosReal / POBLACION) + ` (${marcadosReal}/${POBLACION})`).padStart(25)}`);
}

/* ===== 5. LA ESCAPATORIA ===== */
/*
 * Un atacante que lea esto partira el cluster en subgrupos pequeños que rotan. Es la
 * respuesta obvia, asi que hay que medir lo que le cuesta ANTES de proponer nada.
 */
console.log('');
console.log('5. SI EL ATACANTE SE PARTE EN SUBGRUPOS PARA NO REPETIRSE');
console.log('   subgrupos   tamaño   cohesion media   parte de la sala que controla');
for (const trozos of [1, 2, 4, 10]) {
    const tam = Math.floor(CLUSTER / trozos);
    if (tam < 2) continue;
    const sim = juega({ poblacion: POBLACION, cluster: 0, amigos: Array(trozos).fill(tam) });
    const grupo = sim.reales.slice(0, tam);
    const e = estadisticas(sim, grupo);
    console.log(`   ${String(trozos).padStart(9)}   ${String(tam).padStart(6)}   ${e.media.toFixed(2).padStart(14)}   `
        + `${pct(tam / SALA).padStart(29)}`);
}
console.log('');
console.log('   Partirse le baja la cohesion, pero tambien le baja el control de la');
console.log('   sala: con subgrupos de 5 en salas de 25 ya no decide quien gana, y las');
console.log('   kills dejan de ser gratis. Esa es la disyuntiva que crea el detector.');

/* ===== 6. DONDE EL DETECTOR NO SIRVE ===== */
/*
 * Con poca gente, TODOS coinciden con todos y la cohesion de un jugador honrado es
 * tan alta como la del atacante. No es que el detector falle: es que la señal no
 * existe, porque no hay barajado que observar. Ningun umbral arregla eso.
 *
 * Va en el propio script a proposito. Un detector que solo enseña los casos en los
 * que acierta es un argumento, no una medida.
 */
console.log('');
/*
 * VEINTE TIRADAS Y EL PEOR CASO, no una tirada y la mediana.
 *
 * Esta tabla se leia antes de una sola simulacion, y con eso se eligio el suelo de
 * poblacion del servidor. Estaba mal: con poblacion 30 una tirada daba 4 y otra 19.
 * Aqui el peor caso es lo unico que cuenta, porque un falso positivo no es ruido —
 * es un jugador honrado que se queda sin premio.
 */
console.log('6. DONDE DEJA DE HABER SEÑAL — el PEOR honrado de 20 tiradas');
console.log('   poblacion   peor honrado   cluster   ¿seguro con umbral ' + lb.MAX_COHESION + '?');
for (const pob of [15, 25, 30, 40, 50, 60, 100, 500]) {
    let peor = 0, flojo = Infinity;
    for (let v = 0; v < 20; v++) {
        const sim = juega({ poblacion: pob, cluster: CLUSTER });
        for (const w of sim.reales) peor = Math.max(peor, cohesionDe(sim.cruces, sim.partidasDe, w));
        for (const w of sim.atac) flojo = Math.min(flojo, cohesionDe(sim.cruces, sim.partidasDe, w));
    }
    const seguro = peor < lb.MAX_COHESION;
    console.log(`   ${String(pob).padStart(9)}   ${String(peor).padStart(12)}   ${String(flojo).padStart(7)}   `
        + (seguro ? 'si (margen ' + (lb.MAX_COHESION - peor) + ')' : 'NO — echaria a honrados'));
}
console.log('');
console.log('   El servidor no aplica el filtro por debajo de', lb.MIN_POBLACION_COHESION,
    'jugadores, que es de donde');
console.log('   sale esa columna.');
console.log('');
console.log('   Por debajo de una sala llena de gente real no hay nada que medir: si');
console.log('   todos coinciden con todos, coincidir no dice nada. La defensa ahi no es');
console.log('   un detector mejor, es no repartir premios — que es justo lo que hace');
console.log('   falta decidir, porque hoy LB_FULL_POT_AT solo ENCOGE el bote (a 20');
console.log('   elegibles paga el 40%) y nunca lo deja en cero.');
