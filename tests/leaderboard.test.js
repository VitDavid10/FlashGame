/*
 * Tests del leaderboard diario y su cadena de hashes.
 *
 * Lo que se comprueba es lo que sostiene la promesa "los premios salen de una lista
 * que no se puede reescribir": que el hash dependa del contenido, que encadene con
 * el dia anterior, y que la verificacion se entere si alguien toca un fichero ya
 * cerrado. Si esto se rompe, el reparto vuelve a ser "confia en el servidor".
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Keypair } = require('@solana/web3.js');

// Cada ejecucion en su propio directorio: el modulo persiste en disco al cargarse.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-lb-'));
process.env.LB_DIR = TMP;
const lb = require('../server/leaderboard.js');

const wallets = Array.from({ length: 15 }, () => Keypair.generate().publicKey.toBase58());

/** Mete kills suficientes para que la wallet i quede por delante de la i+1. */
function sembrar() {
    wallets.forEach((w, i) => {
        const kills = 100 - i * 3;
        for (let k = 0; k < kills; k++) lb.recordKill(w, 'jugador' + i);
        lb.recordPeak(w, 10000 + i, 'jugador' + i);
    });
}

test('el orden es kills primero y masa maxima para desempatar', () => {
    const players = {
        A: { kills: 10, peak: 100, name: 'a' },
        B: { kills: 10, peak: 900, name: 'b' },
        C: { kills: 11, peak: 1, name: 'c' },
    };
    const t = lb.tablaDe(players);
    assert.deepEqual(t.map(f => f.wallet), ['C', 'B', 'A']);
});

test('por debajo del minimo de kills no se entra en la lista', () => {
    const players = {
        A: { kills: lb.MIN_KILLS, peak: 1, name: 'a' },
        B: { kills: lb.MIN_KILLS - 1, peak: 999999, name: 'b' },
    };
    assert.deepEqual(lb.tablaDe(players).map(f => f.wallet), ['A']);
});

test('sin datos de oponentes el filtro no se aplica', () => {
    // Importante: si filtrara sin poder comprobar nada, un servidor recien desplegado
    // (todavia sin recibos de partida) dejaria la lista vacia y no habria premios.
    const players = { A: { kills: 50, peak: 100, name: 'a' }, B: { kills: 40, peak: 90, name: 'b' } };
    assert.equal(lb.tablaDe(players).length, 2);
    assert.equal(lb.tablaDe(players, new Map()).length, 2);
});

test('con datos, quien no se cruza con nadie queda fuera aunque juegue mas', () => {
    // El caso que esto ataca: diez wallets propias jugando entre ellas. Juegan mucho,
    // acumulan kills, y siempre contra los mismos.
    const players = {
        cluster: { kills: 500, peak: 9999, name: 'yo' },
        normal: { kills: 20, peak: 100, name: 'jugador' },
    };
    const oponentes = new Map([
        ['cluster', { oponentes: lb.MIN_OPONENTES - 1, partidas: 300 }],
        ['normal', { oponentes: lb.MIN_OPONENTES + 10, partidas: 6 }],
    ]);
    const t = lb.tablaDe(players, oponentes);
    assert.deepEqual(t.map(f => f.wallet), ['normal'], 'el cluster no deberia entrar');
    assert.equal(t[0].oponentes, lb.MIN_OPONENTES + 10, 'la fila dice de donde sale la decision');
});

/* ===================== COHESION: EL GRUPO CERRADO ===================== */

/*
 * Los filtros de arriba miran CUANTOS distintos conoces, y eso se compra: un cluster
 * de 50 wallets que juegue seis partidas con gente real pasa el 10% y copa el top 10
 * (medido en scripts/atacar-leaderboard.js). Estos tests fijan el filtro que mira lo
 * que no se puede comprar — coincidir SIEMPRE con los mismos.
 */

/** Una poblacion suficiente para que el filtro de cohesion se active. */
function poblacionDe(n, extra = {}) {
    const m = new Map(Object.entries(extra));
    for (let i = m.size; i < n; i++) {
        m.set('otro' + i, { oponentes: 40, partidas: 8, cohesion: 0 });
    }
    return m;
}

test('un grupo cerrado grande queda fuera aunque conozca a mucha gente', () => {
    // Esta es la wallet que se saltaba todo lo demas: 40 oponentes distintos (los
    // ha comprado jugando con gente real) y aun asi coincide siempre con los suyos.
    const players = { cluster: { kills: 500, peak: 9999, name: 'yo' }, normal: { kills: 20, peak: 100, name: 'j' } };
    const oponentes = poblacionDe(60, {
        cluster: { oponentes: 40, partidas: 10, cohesion: lb.MAX_COHESION },
        normal: { oponentes: 40, partidas: 10, cohesion: 0 },
    });
    assert.deepEqual(lb.tablaDe(players, oponentes).map(f => f.wallet), ['normal']);
});

test('un grupo de amigos por debajo del umbral SI entra', () => {
    /*
     * El filtro tiene que dejar pasar a la gente que juega junta de verdad. Ocho
     * colegas dan cohesion 7, y echarlos seria castigar a los jugadores mas fieles
     * — que es peor que dejar pasar a un cluster de ocho, porque con ocho wallets
     * no se copan diez puestos.
     */
    const players = { amigo: { kills: 50, peak: 100, name: 'a' } };
    const oponentes = poblacionDe(60, {
        amigo: { oponentes: 40, partidas: 10, cohesion: lb.MAX_COHESION - 1 },
    });
    assert.deepEqual(lb.tablaDe(players, oponentes).map(f => f.wallet), ['amigo']);
});

test('con poca gente el filtro NO se aplica: ahi la señal no existe', () => {
    /*
     * Medido en scripts/detectar-cluster.js: con 5 jugadores reales, un honrado da
     * cohesion 24 y el atacante tambien 24, porque todos coinciden con todos. Aplicar
     * el filtro ahi no pilla a nadie: solo echa a los honrados.
     */
    const players = { a: { kills: 50, peak: 100, name: 'a' } };
    const oponentes = poblacionDe(lb.MIN_POBLACION_COHESION - 1, {
        a: { oponentes: 20, partidas: 10, cohesion: 99 },
    });
    assert.deepEqual(lb.tablaDe(players, oponentes).map(f => f.wallet), ['a'],
        'por debajo de la poblacion minima no se puede juzgar y no se juzga');
});

test('el suelo de poblacion no puede bajar de 50 sin volver a medirlo', () => {
    /*
     * Estuvo en 30 y era falso: salio de UNA tirada de la simulacion donde el peor
     * honrado daba 4. Repitiendo 40 veces, con poblacion 30 un jugador legitimo
     * llegaba a cohesion 19 — lo mismo que una wallet de un cluster de veinte. El
     * filtro no habria distinguido nada, solo habria echado gente.
     *
     * El peor honrado por poblacion, sobre 40 tiradas:
     *     25 -> 16    30 -> 19    40 -> 9    50 -> 6    60 -> 3
     *
     * Este test no comprueba una implementacion: fija una decision que costo un
     * fallo, para que bajar ese numero obligue a volver a medir en vez de parecer
     * un ajuste inocente.
     */
    assert.ok(lb.MIN_POBLACION_COHESION >= 50,
        `el suelo esta en ${lb.MIN_POBLACION_COHESION}: por debajo de 50 el peor jugador `
        + 'honrado alcanza la cohesion de un cluster y el filtro echa a gente legitima');
});

test('con una sola partida tampoco: todos los de tu sala han estado en el 100%', () => {
    // Sin este guarda, quien juega una vez sale con la cohesion del tamano de la
    // sala entera y el filtro lo echa por haber jugado poco.
    const players = { nuevo: { kills: 50, peak: 100, name: 'n' } };
    const oponentes = poblacionDe(60, {
        nuevo: { oponentes: 24, partidas: lb.MIN_PARTIDAS_COHESION - 1, cohesion: 24 },
    });
    assert.deepEqual(lb.tablaDe(players, oponentes).map(f => f.wallet), ['nuevo']);
});

test('sin el dato de cohesion no se juzga a nadie', () => {
    // Recibos viejos, de antes de que se contara. Un filtro que ante la falta de
    // datos EXCLUYE vaciaria la lista al desplegar, que es la peor forma de fallar.
    const players = { viejo: { kills: 50, peak: 100, name: 'v' } };
    const oponentes = poblacionDe(60, { viejo: { oponentes: 40, partidas: 10 } });
    assert.deepEqual(lb.tablaDe(players, oponentes).map(f => f.wallet), ['viejo']);
});

test('la fila publica la cohesion, para que se vea por que entra o no', () => {
    const players = { a: { kills: 50, peak: 100, name: 'a' } };
    const oponentes = poblacionDe(60, { a: { oponentes: 40, partidas: 10, cohesion: 3 } });
    assert.equal(lb.tablaDe(players, oponentes)[0].cohesion, 3);
});

/* ===================== EL TOPE DE UN GRUPO ===================== */

/*
 * El filtro de cohesion echa a los grupos de nueve o mas, pero por debajo no puede
 * echar a nadie: cinco wallets coordinadas son indistinguibles de cinco amigos. El
 * tope no intenta distinguirlos — hace que dominar la lista no compense a ninguno
 * de los dos.
 */

const BOTE = 100000n;   // 1 unidad = 0,001% del bote, comodo para leer porcentajes

/** Un top 10 donde los `g` primeros son del mismo grupo. */
function topConGrupo(g) {
    return Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1, wallet: 'w' + i, name: 'w' + i, kills: 100 - i,
        grupo: i < g ? 'g1' : null,
    }));
}
const suma = (es, f) => es.filter(f).reduce((t, e) => t + e.amountRaw, 0n);

test('un duo no se capa: dos colegas primero y segundo son lo normal', () => {
    const r = lb.repartoDe({ entries: topConGrupo(2) }, BOTE);
    const suyo = suma(r.entries, e => e.grupo === 'g1');
    // 35 + 20 = 55% intactos.
    assert.equal(Number(suyo) / 1000, 55, 'un grupo de dos puestos no deberia tocarse');
    assert.ok(!r.entries.some(e => e.capado), 'y no deberia marcarse como capado');
});

test('a partir de tres puestos, el grupo no pasa del tope entre todos', () => {
    for (const g of [3, 5, 8]) {
        const r = lb.repartoDe({ entries: topConGrupo(g) }, BOTE);
        const suyo = Number(suma(r.entries, e => e.grupo === 'g1')) / 100000;
        assert.ok(suyo <= lb.GRUPO_MAX_PCT + 0.001,
            `un grupo de ${g} se llevo ${(suyo * 100).toFixed(1)}%, por encima del tope`);
        assert.ok(suyo > lb.GRUPO_MAX_PCT - 0.01, `un grupo de ${g} se quedo demasiado corto`);
    }
});

test('lo recortado pasa a quien NO es del grupo', () => {
    const r = lb.repartoDe({ entries: topConGrupo(5) }, BOTE);
    const otros = Number(suma(r.entries, e => !e.grupo)) / 100000;
    // Sin tope se llevarian el 16% (los puestos 6 al 10); con el, casi el 70%.
    assert.ok(otros > 0.65, `los de fuera del grupo se llevaron solo ${(otros * 100).toFixed(1)}%`);
});

test('si el grupo copa la lista entera, el sobrante NO se paga', () => {
    /*
     * Es el caso que decide si el tope sirve de algo. Devolverle el sobrante al
     * propio grupo por no tener a quien darselo deshace el tope entero y el ataque
     * vuelve a cobrar el 100%.
     */
    const r = lb.repartoDe({ entries: topConGrupo(10) }, BOTE);
    const total = Number(r.totalRaw) / 100000;
    assert.ok(total <= lb.GRUPO_MAX_PCT + 0.001,
        `se pago el ${(total * 100).toFixed(1)}% del bote cuando el tope es ${lb.GRUPO_MAX_PCT * 100}%`);
});

test('dentro del grupo capado se respeta el orden: el primero sigue cobrando mas', () => {
    // Aplanarlos a todos por igual castigaria al que de verdad quedo primero, y
    // ademas daria igual jugar bien dentro del grupo.
    const r = lb.repartoDe({ entries: topConGrupo(5) }, BOTE);
    const suyos = r.entries.filter(e => e.grupo === 'g1');
    for (let i = 1; i < suyos.length; i++) {
        assert.ok(suyos[i - 1].amountRaw > suyos[i].amountRaw,
            'el puesto ' + i + ' deberia cobrar mas que el ' + (i + 1));
    }
});

test('sin grupos, el reparto es exactamente el de siempre', () => {
    const r = lb.repartoDe({ entries: topConGrupo(0) }, BOTE);
    assert.deepEqual(r.entries.map(e => Number(e.amountRaw) / 1000), lb.PESOS);
});

test('agrupar es por cadena, no por clique', () => {
    /*
     * Si A siempre juega con B y B siempre con C, los tres estan en la misma sala
     * aunque A y C no aparezcan en la lista del otro. Partirlo en dos grupos seria
     * regalarle el tope al que se coloque en el borde.
     */
    const op = new Map([
        ['A', { fijos: ['B'] }], ['B', { fijos: ['A', 'C'] }], ['C', { fijos: ['B'] }],
        ['solo', { fijos: [] }],
    ]);
    const g = lb._agrupaCerrados(['A', 'B', 'C', 'solo'], op);
    assert.equal(g.get('A'), g.get('C'), 'A y C tienen que caer en el mismo grupo');
    assert.equal(g.get('A'), g.get('B'));
    assert.equal(g.get('solo'), undefined, 'quien no repite con nadie no tiene grupo');
});

test('un fijo que no esta en la lista no arrastra grupo', () => {
    // Si tu companero fijo no puntuo ese dia, tu no formas grupo con nadie.
    const g = lb._agrupaCerrados(['A'], new Map([['A', { fijos: ['fuera'] }]]));
    assert.equal(g.get('A'), undefined);
});

test('una wallet sin ningun recibo tampoco entra si ya hay datos', () => {
    // Si hay recibos de otros pero de esta no, es que sus kills no vienen de ninguna
    // partida anclada. Eso es exactamente lo que hay que dejar fuera.
    const players = { fantasma: { kills: 99, peak: 9999, name: 'x' } };
    const oponentes = new Map([['otra', { oponentes: 30, partidas: 10 }]]);
    assert.equal(lb.tablaDe(players, oponentes).length, 0);
});

test('quien juega sin wallet no puntua (no habria donde pagarle)', () => {
    const antes = lb.estadoHoy().entries.length;
    lb.recordKill(null, 'anonimo');
    lb.recordPeak(null, 999999, 'anonimo');
    assert.equal(lb.estadoHoy().entries.length, antes);
});

test('el primer dia encadena con el hash genesis', () => {
    sembrar();
    lb._setFecha('2026-01-01');
    const snap = lb.cerrarAhora();
    assert.equal(snap.prevHash, lb.GENESIS);
    assert.equal(snap.hash.length, 64);
    assert.equal(snap.entries[0].wallet, wallets[0]);
    assert.equal(snap.entries.length, 15);
});

test('el hash de un dia es reproducible desde el JSON publicado', () => {
    const cadena = lb.cadena();
    const ultimo = cadena[cadena.length - 1];
    const snap = lb.diaCerrado(ultimo.date);
    // Esto es exactamente lo que haria un tercero con los ficheros publicos.
    const recalculado = lb._sha256hex(snap.prevHash + lb._canonico(snap.date, snap.entries));
    assert.equal(recalculado, ultimo.hash);
});

test('cada dia encadena con el anterior', () => {
    const antes = lb.cadena().length;
    for (let d = 0; d < 3; d++) {
        wallets.forEach((w, i) => { for (let k = 0; k < 5 + i; k++) lb.recordKill(w, 'j' + i); });
        lb._setFecha('2026-01-0' + (d + 2));
        lb.cerrarAhora();
    }
    const cadena = lb.cadena();
    assert.equal(cadena.length, antes + 3);
    for (let i = 1; i < cadena.length; i++) {
        assert.equal(cadena[i].prevHash, cadena[i - 1].hash, `el dia ${cadena[i].date} no encadena`);
    }
});

test('cerrar dos veces el mismo dia no duplica el eslabon', () => {
    // El snapshot vive en un fichero por fecha: dos eslabones con la misma fecha
    // dejarian la cadena rota para siempre sin que nadie hubiera tocado un dato.
    const antes = lb.cadena().length;
    const ultimo = lb.cadena()[antes - 1];
    lb._setFecha(ultimo.date);
    const repetido = lb.cerrarAhora();
    assert.equal(lb.cadena().length, antes, 'no deberia haber anadido un eslabon');
    assert.equal(repetido.hash, ultimo.hash, 'deberia devolver el cierre que ya existia');
    assert.ok(lb.verificarCadena().ok);
});

test('verificarCadena pasa con los datos intactos', () => {
    const r = lb.verificarCadena();
    assert.ok(r.ok, 'la cadena deberia estar limpia: ' + JSON.stringify(r.fallos));
    assert.equal(r.dias, lb.cadena().length);
});

test('tocar un dia ya cerrado rompe la verificacion', () => {
    // El ataque que esto detecta: colar una wallet mia en el top 10 de ayer.
    const cadena = lb.cadena();
    const victima = cadena[0].date;
    const fichero = path.join(TMP, 'leaderboards', victima + '.json');
    const snap = JSON.parse(fs.readFileSync(fichero, 'utf8'));
    const original = JSON.stringify(snap);

    snap.entries[0].wallet = Keypair.generate().publicKey.toBase58();
    fs.writeFileSync(fichero, JSON.stringify(snap));

    const r = lb.verificarCadena();
    assert.equal(r.ok, false);
    assert.ok(r.fallos.some(f => f.date === victima && /no cuadra/.test(f.error)));

    fs.writeFileSync(fichero, original);
    assert.ok(lb.verificarCadena().ok, 'al restaurar el fichero deberia volver a cuadrar');
});

test('cambiar una sola kill de un dia cerrado tambien se nota', () => {
    const cadena = lb.cadena();
    const victima = cadena[1].date;
    const fichero = path.join(TMP, 'leaderboards', victima + '.json');
    const snap = JSON.parse(fs.readFileSync(fichero, 'utf8'));
    const original = JSON.stringify(snap);

    snap.entries[3].kills += 1;
    fs.writeFileSync(fichero, JSON.stringify(snap));
    assert.equal(lb.verificarCadena().ok, false);

    fs.writeFileSync(fichero, original);
    assert.ok(lb.verificarCadena().ok);
});

test('el json canonico no depende del orden de insercion', () => {
    const filas = [
        { rank: 1, wallet: 'B', kills: 9, peak: 2 },
        { rank: 2, wallet: 'A', kills: 8, peak: 1 },
    ];
    const a = lb._canonico('2026-01-01', filas);
    const b = lb._canonico('2026-01-01', filas.map(f => ({ peak: f.peak, kills: f.kills, wallet: f.wallet, rank: f.rank })));
    assert.equal(a, b, 'el hash cambiaria segun como se construyo el objeto');
});

/* ===================== REPARTO ===================== */

test('el reparto usa los pesos del top 10 y nunca pasa del presupuesto', () => {
    const snap = { entries: Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, wallet: wallets[i % 15], kills: 50 - i, peak: 1, name: 'j' })) };
    const presupuesto = 1_000_000n;
    const r = lb.repartoDe(snap, presupuesto);
    assert.equal(r.entries.length, 10, 'solo cobran diez');
    assert.ok(r.totalRaw <= presupuesto, 'el reparto no puede pasarse del presupuesto');
    // Con los pesos actuales suman 100 %, asi que el sobrante es solo el redondeo.
    assert.ok(presupuesto - r.totalRaw < 10n, 'el sobrante deberia ser calderilla del redondeo');
    assert.equal(r.entries[0].amountRaw, 350000n);
    assert.equal(r.entries[9].amountRaw, 15000n);
});

test('con menos de diez en la lista, los puestos vacios NO se reparten', () => {
    const snap = { entries: [0, 1, 2].map(i => ({ rank: i + 1, wallet: wallets[i], kills: 9 - i, peak: 1, name: 'j' })) };
    const r = lb.repartoDe(snap, 1_000_000n);
    assert.equal(r.entries.length, 3);
    // 35 + 20 + 13 = 68 %. El 32 % restante se queda en la tesoreria.
    assert.equal(r.totalRaw, 680000n);
});

test('un presupuesto ridiculo no genera premios de cero', () => {
    const snap = { entries: [0, 1].map(i => ({ rank: i + 1, wallet: wallets[i], kills: 5, peak: 1, name: 'j' })) };
    const r = lb.repartoDe(snap, 2n);
    for (const e of r.entries) assert.ok(e.amountRaw > 0n, 'una entrada a cero rompe el merkle');
});

test('el reparto encaja con el arbol de merkle sin retoques', () => {
    // Las dos piezas tienen que hablarse: lo que sale de repartoDe entra en buildRound.
    const merkle = require('../server/merkle.js');
    const snap = { entries: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, wallet: wallets[i], kills: 50 - i, peak: 1, name: 'j' + i })) };
    const r = lb.repartoDe(snap, 1_000_000n);
    const ronda = merkle.buildRound(20334, r.entries);
    assert.equal(ronda.total, r.totalRaw.toString());
    assert.equal(ronda.winners, 10);
    const root = Buffer.from(ronda.root, 'hex');
    for (const fila of ronda.entries) {
        const leaf = merkle.leafHash(20334, fila.wallet, BigInt(fila.amountRaw));
        assert.ok(merkle.verifyProof(fila.proof.map(h => Buffer.from(h, 'hex')), root, leaf));
    }
});

/* ===================== EL CLUSTER CERRADO ===================== */

/*
 * `oponentes >= MIN_OPONENTES` a secas no defiende de nada: veinte wallets propias
 * jugando entre ellas ven diecinueve oponentes distintos cada una y pasan sobradas.
 *
 * Lo que las separa es que UN CLUSTER TIENE TECHO Y UN JUGADOR NO: con veinte
 * wallets nunca conoceras a mas de diecinueve personas, juegues cuatro partidas o
 * cuatro mil. Por eso se mide contra la POBLACION y no contra las partidas.
 */

test('el cluster se queda en su techo por muchas partidas que juegue', () => {
    // 20 wallets propias sobre 500 activos: 19 de 499 = 3,8 %. Y jugar mas no lo
    // cambia, porque no hay a quien mas conocer.
    for (const partidas of [4, 20, 200, 2000]) {
        assert.equal(lb._diversoBastante({ oponentes: 19, partidas }, 500), false,
            `con ${partidas} partidas entre las mismas 19 wallets sigue sin pasar`);
    }
});

test('a un jugador real, jugar mas solo puede SUBIRLE el porcentaje', () => {
    // Es la propiedad que la metrica anterior (oponentes/partidas) tenia al reves:
    // aquella bajaba cuanto mas jugabas, asi que castigaba al jugador activo.
    const pob = 500;
    let anterior = 0;
    for (const [op, partidas] of [[65, 2], [130, 4], [250, 10], [380, 20]]) {
        const pct = op / (pob - 1);
        assert.ok(pct >= anterior, 'el porcentaje no deberia bajar al jugar mas');
        anterior = pct;
        assert.equal(lb._diversoBastante({ oponentes: op, partidas }, pob), true);
    }
});

test('ni 50 wallets propias llegan a donde llega un jugador ocasional', () => {
    // 49 de 499 = 9,8 %, justo por debajo del 10 %. Un jugador con dos partidas ya
    // va por 13 %, y con cuatro por 25 %. El margen es estrecho a proposito: entre
    // dejar pasar a un atacante y echar a un jugador real, se prefiere lo primero.
    assert.equal(lb._diversoBastante({ oponentes: 49, partidas: 30 }, 500), false);
    assert.equal(lb._diversoBastante({ oponentes: 65, partidas: 2 }, 500), true);
    assert.equal(lb._diversoBastante({ oponentes: 130, partidas: 4 }, 500), true);
});

test('una sola partida no cuenta', () => {
    assert.equal(lb._diversoBastante({ oponentes: 34, partidas: 1 }, 500), false);
});

test('con el juego pequeño no se puede distinguir, y se deja pasar', () => {
    // Treinta jugadores en total: todos se cruzan con todos. Un cluster de veinte
    // conoce al 66 % de la comunidad, igual que cualquiera. No hay filtro que
    // arregle esto — la defensa ahi es economica (el rake), no de deteccion.
    // Se deja pasar a proposito: mejor eso que echar a jugadores de verdad.
    assert.equal(lb._diversoBastante({ oponentes: 19, partidas: 30 }, 30), true);
    assert.equal(lb._diversoBastante({ oponentes: 25, partidas: 6 }, 30), true);
});

test('sin poblacion con la que comparar, no se filtra', () => {
    assert.equal(lb._diversoBastante({ oponentes: 5, partidas: 5 }, 1), true);
    assert.equal(lb._diversoBastante({ oponentes: 5, partidas: 5 }, 0), true);
});

test('el filtro completo deja fuera al cluster y dentro al jugador normal', () => {
    // 200 wallets activas ese dia. El cluster tiene MAS kills que nadie: sin el
    // filtro copaba el podio entero.
    const cluster = wallets.slice(0, 3);
    const normal = wallets.slice(3, 6);
    const players = {};
    const op = new Map();
    for (const w of cluster) { players[w] = { kills: 500, peak: 9999, name: 'c' }; op.set(w, { oponentes: 19, partidas: 40 }); }
    for (const w of normal) { players[w] = { kills: 10, peak: 100, name: 'n' }; op.set(w, { oponentes: 120, partidas: 5 }); }
    // Relleno hasta 200 activos, que es la poblacion contra la que se compara.
    for (let i = 0; i < 194; i++) op.set('relleno' + i, { oponentes: 100, partidas: 5 });

    const dentro = lb.tablaDe(players, op).map(f => f.wallet);
    for (const w of cluster) assert.ok(!dentro.includes(w), 'una wallet del cluster se ha colado');
    for (const w of normal) assert.ok(dentro.includes(w), 'un jugador normal se ha quedado fuera');
    assert.equal(dentro.length, 3);
});

test('limpieza', () => {
    lb.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
