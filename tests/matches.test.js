/*
 * Tests de los recibos de partida.
 *
 * Lo que se comprueba es lo que hace que el leaderboard deje de ser "lo que dice el
 * servidor": que un recibo no se pueda cambiar despues de anclarlo, que los lotes
 * encadenen, y que la metrica de oponentes distintos detecte de verdad un cluster de
 * wallets que solo juegan entre ellas.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-matches-'));
process.env.LB_DIR = TMP;
const matches = require('../server/matches.js');

const W = (n) => 'Wallet' + String(n).padStart(38, '0');

function partidaDe(wallets, opts = {}) {
    return matches.registra({
        room: opts.room || 'classic_5$_L1',
        mode: 'classic',
        startedAt: opts.startedAt || Date.now() - 300000,
        endedAt: opts.endedAt || Date.now(),
        entryFee: 1161,
        pot: 0,
        players: wallets.map((w, i) => ({
            wallet: w, name: 'j' + i, kills: opts.kills ? opts.kills[i] : i, peak: 1000 * (i + 1),
            paid: true, isTester: false,
            entry: { msg: 'PillWars enter classic_5$ paying 1161 PILL @ 1', ts: 1, sig: [1, 2, 3] },
        })),
    });
}

/* ===================== EL RECIBO ===================== */

test('una partida sin nadie con wallet no se ancla', () => {
    // Anclarla seria pagar gas por ruido: sin wallet no hay premios de tesoreria.
    const r = matches.registra({
        room: 'classic_Free', mode: 'classic', endedAt: Date.now(), entryFee: 0, pot: 0,
        players: [{ wallet: null, name: 'anonimo', kills: 9, peak: 5000, paid: false }],
    });
    assert.equal(r, null);
});

test('una partida solo de testers tampoco', () => {
    const r = matches.registra({
        room: 'classic_5$', mode: 'classic', endedAt: Date.now(), entryFee: 1161, pot: 0,
        players: [{ wallet: W(1), name: 'bot', kills: 20, peak: 9999, paid: true, isTester: true }],
    });
    assert.equal(r, null);
});

test('el recibo lleva su hash y se puede volver a leer', () => {
    const m = partidaDe([W(1), W(2), W(3)]);
    assert.ok(m);
    assert.match(m.id, /^[0-9a-f]{16}$/);
    assert.match(m.hash, /^[0-9a-f]{64}$/);
    const leido = matches.partida(m.id);
    assert.equal(leido.hash, m.hash);
    assert.equal(leido.players.length, 3);
});

test('el recibo guarda la firma de entrada de cada jugador', () => {
    // Es lo que impide meter a alguien en una partida que no jugo: esa firma la hizo
    // su wallet y el servidor no la puede fabricar.
    const m = partidaDe([W(4), W(5)]);
    for (const p of matches.partida(m.id).players) {
        assert.ok(p.entry, 'falta la firma de entrada');
        assert.ok(p.entry.msg.startsWith('PillWars enter '));
    }
});

test('el hash NO depende del orden en que llegaron los jugadores', () => {
    // Si dependiera, dos personas con los mismos datos sacarian hashes distintos y la
    // verificacion publica no valdria de nada.
    const base = { room: 'r', mode: 'classic', startedAt: 1, endedAt: 2, entryFee: 10, pot: 0 };
    const jugadores = [
        { wallet: W(7), name: 'a', kills: 3, peak: 100, paid: true },
        { wallet: W(8), name: 'b', kills: 1, peak: 200, paid: true },
    ];
    const a = matches._canonico(Object.assign({ id: 'x' }, base, { players: jugadores }));
    const b = matches._canonico(Object.assign({ id: 'x' }, base, { players: [...jugadores].reverse() }));
    assert.equal(a, b);
});

test('la firma de entrada NO entra en el hash', () => {
    // A proposito: si entrara, verificar un recibo exigiria tener las firmas, y las
    // partidas gratis no las tienen.
    const base = { id: 'x', room: 'r', mode: 'classic', startedAt: 1, endedAt: 2, entryFee: 0, pot: 0 };
    const sin = matches._canonico(Object.assign({}, base, { players: [{ wallet: W(9), name: 'a', kills: 1, peak: 1, paid: true }] }));
    const con = matches._canonico(Object.assign({}, base, { players: [{ wallet: W(9), name: 'a', kills: 1, peak: 1, paid: true, entry: { sig: [9, 9] } }] }));
    assert.equal(sin, con);
});

/* ===================== LOTES Y CADENA ===================== */

test('el primer lote encadena con el genesis', async () => {
    const l = await matches.anclaLote(null, null);   // sin cadena: se cierra igual
    assert.ok(l, 'deberia haberse cerrado un lote');
    assert.equal(l.n, 0);
    assert.equal(l.prevHash, matches.GENESIS);
    assert.equal(l.sig, null, 'sin solana no hay firma, y se dice');
    assert.ok(l.matches > 0);
});

test('cada lote encadena con el anterior', async () => {
    partidaDe([W(10), W(11)]);
    await matches.anclaLote(null, null);
    partidaDe([W(12), W(13)]);
    await matches.anclaLote(null, null);
    const cadena = matches.cadena();
    assert.ok(cadena.length >= 3);
    for (let i = 1; i < cadena.length; i++) {
        assert.equal(cadena[i].prevHash, cadena[i - 1].hash, `el lote ${cadena[i].n} no encadena`);
    }
});

test('un lote vacio no se cierra', async () => {
    const antes = matches.cadena().length;
    assert.equal(await matches.anclaLote(null, null), null);
    assert.equal(matches.cadena().length, antes);
});

test('verificar pasa con los datos intactos', () => {
    const r = matches.verificar();
    assert.ok(r.ok, 'deberia estar limpio: ' + JSON.stringify(r.fallos));
    assert.equal(r.pendientes, 0);
});

test('cambiar una kill de un recibo ya anclado se detecta', () => {
    // El ataque: subirme las kills de una partida de ayer para colarme en el top 10.
    const cadena = matches.cadena();
    const l = matches.lote(cadena[0].n);
    const id = l.matches[0].id;
    const f = path.join(TMP, 'matches', id + '.json');
    const original = fs.readFileSync(f, 'utf8');

    const m = JSON.parse(original);
    m.players[0].kills += 50;
    fs.writeFileSync(f, JSON.stringify(m));

    const r = matches.verificar();
    assert.equal(r.ok, false);
    assert.ok(r.fallos.some(x => x.match === id && /changed after/.test(x.error)));

    fs.writeFileSync(f, original);
    assert.ok(matches.verificar().ok, 'al restaurarlo deberia volver a cuadrar');
});

test('cambiar la wallet de un jugador tambien se detecta', () => {
    const cadena = matches.cadena();
    const l = matches.lote(cadena[0].n);
    const id = l.matches[0].id;
    const f = path.join(TMP, 'matches', id + '.json');
    const original = fs.readFileSync(f, 'utf8');

    const m = JSON.parse(original);
    m.players[0].wallet = W(999);
    fs.writeFileSync(f, JSON.stringify(m));
    assert.equal(matches.verificar().ok, false);

    fs.writeFileSync(f, original);
    assert.ok(matches.verificar().ok);
});

test('borrar un recibo de un lote se detecta', () => {
    const cadena = matches.cadena();
    const l = matches.lote(cadena[0].n);
    const id = l.matches[0].id;
    const f = path.join(TMP, 'matches', id + '.json');
    const original = fs.readFileSync(f, 'utf8');
    fs.unlinkSync(f);

    const r = matches.verificar();
    assert.equal(r.ok, false);
    assert.ok(r.fallos.some(x => /falta el recibo/.test(x.error)));

    fs.writeFileSync(f, original);
    assert.ok(matches.verificar().ok);
});

/* ===================== OPONENTES DISTINTOS ===================== */

test('un cluster cerrado se distingue de un jugador que se mezcla', () => {
    // Diez wallets que solo juegan entre ellas contra una que juega con todo el mundo.
    const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-cluster-'));
    const antes = process.env.LB_DIR;
    process.env.LB_DIR = TMP2;
    delete require.cache[require.resolve('../server/matches.js')];
    const m2 = require('../server/matches.js');

    const cluster = [0, 1, 2].map(i => 'Cluster' + String(i).padStart(37, '0'));
    const publicos = Array.from({ length: 12 }, (_, i) => 'Publico' + String(i).padStart(37, '0'));

    // El cluster juega 20 partidas solo entre ellos.
    for (let i = 0; i < 20; i++) {
        m2.registra({
            room: 'classic_5$', mode: 'classic', endedAt: Date.now(), entryFee: 1161, pot: 0,
            players: cluster.map((w, k) => ({ wallet: w, name: 'c' + k, kills: 9, peak: 100, paid: true })),
        });
    }
    // Un jugador normal juega 4 partidas con gente distinta cada vez.
    for (let i = 0; i < 4; i++) {
        m2.registra({
            room: 'classic_5$', mode: 'classic', endedAt: Date.now(), entryFee: 1161, pot: 0,
            players: [publicos[0], publicos[i * 2 + 1], publicos[i * 2 + 2], publicos[(i + 5) % 12]]
                .map((w, k) => ({ wallet: w, name: 'p' + k, kills: 5, peak: 100, paid: true })),
        });
    }

    const mapa = m2.oponentesDe();
    const delCluster = mapa.get(cluster[0]);
    const normal = mapa.get(publicos[0]);

    assert.equal(delCluster.partidas, 20, 'el del cluster jugo mucho');
    assert.equal(delCluster.oponentes, 2, 'pero siempre contra los mismos dos');
    assert.equal(normal.partidas, 4, 'el normal jugo poco');
    assert.ok(normal.oponentes >= 8, 'y aun asi se cruzo con mas gente: ' + normal.oponentes);

    // Y ese es justo el criterio: jugar mucho no basta, hay que mezclarse.
    assert.ok(delCluster.oponentes < normal.oponentes,
        'la metrica tiene que separar al cluster del jugador normal');

    process.env.LB_DIR = antes;
    delete require.cache[require.resolve('../server/matches.js')];
    fs.rmSync(TMP2, { recursive: true, force: true });
});

/* ===================== RECAUDADO DEL DIA ===================== */

/*
 * Es el numero que ata el premio a lo que de verdad se jugo. Si se cuenta de mas,
 * el bote del dia sube por encima de lo que entro y crear wallets vuelve a salir a
 * cuenta — que es justo el ataque que este dato existe para cerrar.
 */

// Los otros tests dejan partidas con endedAt = ahora en el mismo directorio, asi que
// estas se fechan hace meses: la ventana de cada test solo ve lo suyo.
const VIEJO = Date.now() - 100 * 86400e3;

test('el recaudado suma entrada x jugadores que pagaron', () => {
    const t = VIEJO;
    partidaDe([W(80), W(81), W(82)], { endedAt: t });
    const r = matches.recaudadoEntre(t - 1000, t + 1000);
    assert.equal(r.pill, 1161 * 3);
    assert.equal(r.entradas, 3);
    assert.equal(r.partidas, 1);
});

test('los que NO pagaron no suben el bote de nadie', () => {
    const t = VIEJO + 10 * 86400e3;
    matches.registra({
        room: 'free_L1', mode: 'classic', startedAt: t - 300000, endedAt: t,
        entryFee: 1161, pot: 0,
        players: [
            { wallet: W(90), name: 'a', kills: 3, peak: 1, paid: true, isTester: false },
            { wallet: W(91), name: 'b', kills: 2, peak: 1, paid: false, isTester: false },
            { wallet: W(92), name: 'c', kills: 1, peak: 1, paid: true, isTester: true },
        ],
    });
    const r = matches.recaudadoEntre(t - 1000, t + 1000);
    assert.equal(r.entradas, 1, 'solo cuenta el que pago y no es tester');
    assert.equal(r.pill, 1161);
});

test('una sala gratis no recauda nada', () => {
    const t = VIEJO + 20 * 86400e3;
    matches.registra({
        room: 'free_L1', mode: 'classic', startedAt: t - 300000, endedAt: t,
        entryFee: 0, pot: 0,
        players: [{ wallet: W(95), name: 'a', kills: 3, peak: 1, paid: true, isTester: false }],
    });
    assert.equal(matches.recaudadoEntre(t - 1000, t + 1000).pill, 0);
});

test('la ventana acota: lo de ayer no paga el premio de hoy', () => {
    const ayer = VIEJO + 30 * 86400e3;
    const hoy = ayer + 86400e3;
    partidaDe([W(70), W(71)], { endedAt: ayer });
    assert.equal(matches.recaudadoEntre(hoy - 1000, hoy + 1000).entradas, 0, 'entro algo de fuera de la ventana');
    assert.equal(matches.recaudadoEntre(ayer - 1000, ayer + 1000).entradas, 2, 'no encuentra lo que si esta dentro');
});

test('EL ATAQUE: con factor 1 no se puede sacar mas de lo que se metio', () => {
    // Juego vacio. Meto K wallets mias, juegan entre ellas y copan la tabla entera.
    // Aunque me lleve el bote completo, el bote no puede pasar de lo que pague.
    const t = Date.now();
    const DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-sybil-'));
    const antes = process.env.LB_DIR;
    process.env.LB_DIR = DIR2;
    delete require.cache[require.resolve('../server/matches.js')];
    const m2 = require('../server/matches.js');

    const K = 40;
    const mias = Array.from({ length: K }, (_, i) => W(500 + i));
    for (let i = 0; i < K; i += 4) {
        m2.registra({
            room: 'classic_5$_L1', mode: 'classic', startedAt: t - 300000, endedAt: t - 1000,
            entryFee: 1161, pot: 0,
            players: mias.slice(i, i + 4).map((w, j) => ({
                wallet: w, name: 'bot' + j, kills: 5, peak: 1, paid: true, isTester: false,
            })),
        });
    }
    const rec = m2.recaudadoEntre(t - 5000, t);
    const coste = K * 1161;
    assert.equal(rec.pill, coste, 'el recaudado tiene que ser exactamente lo que pague');
    for (const factor of [0.5, 1]) {
        const bote = Math.floor(rec.pill * factor);
        assert.ok(bote <= coste, `con factor ${factor} el bote (${bote}) supera el coste (${coste})`);
    }
    // Y el que lo haria rentable:
    assert.ok(Math.floor(rec.pill * 2) > coste, 'con factor 2 el ataque SI seria rentable — por eso se acota a 1');

    process.env.LB_DIR = antes;
    delete require.cache[require.resolve('../server/matches.js')];
    fs.rmSync(DIR2, { recursive: true, force: true });
});

test('limpieza', () => {
    matches.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
