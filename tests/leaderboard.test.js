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

test('limpieza', () => {
    lb.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
