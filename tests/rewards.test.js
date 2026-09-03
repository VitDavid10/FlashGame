/*
 * Tests del orquestador de premios: el paso de "el dia se cerro" a "este jugador
 * tiene una prueba de Merkle con la que cobrar".
 *
 * Todo esto corre SIN cadena. Es a proposito: el pipeline entero —cierre, reparto,
 * arbol, JSON publico, pantalla de claims— tiene que funcionar y ser testeable antes
 * de que exista el contrato en devnet, y tiene que seguir generando rondas cuando el
 * RPC este caido.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-rw-'));
process.env.LB_DIR = TMP;
process.env.REWARD_BUDGET_PILL = '50000';
// Factor 1 para que los numeros de aqui sean directos (1 PILL de rake -> 1 de bote).
// El valor real por defecto es 20, y tiene su propio test mas abajo.
process.env.REWARD_FACTOR = '1';
delete process.env.TREASURY_PROGRAM;

const lb = require('../server/leaderboard.js');
const rewards = require('../server/rewards.js');
const merkle = require('../server/merkle.js');

const matches = require('../server/matches.js');
const rake = require('../server/rake.js');

const wallets = Array.from({ length: 12 }, () => Keypair.generate().publicKey.toBase58());
const FECHA = '2026-05-04';

/*
 * Rake de sobra en un dia concreto.
 *
 * El bote esta acotado por lo que la casa se quedo ESE dia. Los tests de aqui miden
 * el reparto, no ese freno, asi que le dan rake suficiente para que no sea el quien
 * mande. Sin esto un dia sin rake no genera ronda — que es el comportamiento
 * correcto, pero no lo que se esta midiendo.
 */
function actividadEn(fecha, pill = 10000000) {
    const t = Date.parse(fecha + 'T12:00:00Z');
    rake.alStaking(pill, 'exit fees del dia', t);
}

test('la epoca de un dia es el numero de dias desde el epoch Unix', () => {
    assert.equal(rewards.epochDeFecha('1970-01-01'), 0);
    assert.equal(rewards.epochDeFecha('1970-01-02'), 1);
    assert.equal(rewards.fechaDeEpoch(rewards.epochDeFecha(FECHA)), FECHA);
    // Es la misma cuenta que hace el contrato con Clock: floor(ts / 86400).
    const ts = Date.UTC(2026, 4, 4) / 1000;
    assert.equal(rewards.epochDeFecha(FECHA), Math.floor(ts / 86400));
});

test('preparar una ronda de un dia cerrado saca reparto, arbol y JSON publico', () => {
    actividadEn(FECHA);
    wallets.forEach((w, i) => {
        for (let k = 0; k < 60 - i * 4; k++) lb.recordKill(w, 'jugador' + i);
        lb.recordPeak(w, 50000 - i * 100, 'jugador' + i);
    });
    lb._setFecha(FECHA);
    const snap = lb.cerrarAhora();
    assert.equal(snap.entries.length, 12);

    const presupuesto = rewards.pillToRaw(50000);
    const r = rewards.prepararRonda(FECHA, presupuesto);
    assert.ok(r, 'deberia haber salido una ronda');
    assert.equal(r.winners, 10, 'solo cobran diez aunque haya doce en la lista');
    assert.equal(r.date, FECHA);
    assert.equal(r.leaderboardHash, snap.hash, 'la ronda tiene que apuntar al dia del que sale');
    assert.equal(r.sig, null, 'sin cadena configurada no se publica');

    const pub = rewards.rondaPublica(r.epoch);
    assert.ok(pub, 'falta el JSON publico');
    assert.equal(pub.root, r.root);
    assert.equal(pub.leaderboardHash, snap.hash);
    assert.equal(pub.entries.length, 10);
});

test('el JSON publico es auditable: la raiz sale de la lista publicada', () => {
    // Esto es lo que haria un tercero: bajarse el JSON, quedarse con {wallet, amount}
    // y comprobar que da la misma raiz que se publico on-chain.
    const epoch = rewards.epochDeFecha(FECHA);
    const pub = rewards.rondaPublica(epoch);
    const soloDatos = pub.entries.map(e => ({ wallet: e.wallet, amountRaw: BigInt(e.amountRaw) }));
    assert.equal(merkle.buildTree(epoch, soloDatos).rootHex, pub.root);
    // Y el total anunciado cuadra con la suma de la lista.
    const suma = soloDatos.reduce((s, e) => s + e.amountRaw, 0n);
    assert.equal(pub.total, suma.toString());
});

test('preparar dos veces el mismo dia no duplica la ronda', () => {
    const antes = rewards.estado().total;
    assert.equal(rewards.prepararRonda(FECHA, rewards.pillToRaw(50000)), null);
    assert.equal(rewards.estado().total, antes);
});

test('un dia sin nadie por encima del minimo no genera ronda', () => {
    lb._setFecha('2026-05-05');
    lb.cerrarAhora();
    assert.equal(rewards.prepararRonda('2026-05-05', rewards.pillToRaw(50000)), null);
});

test('presupuesto cero no genera ronda (mejor nada que una ronda vacia)', () => {
    wallets.forEach((w, i) => { for (let k = 0; k < 10; k++) lb.recordKill(w, 'j' + i); });
    lb._setFecha('2026-05-06');
    lb.cerrarAhora();
    assert.equal(rewards.prepararRonda('2026-05-06', 0n), null);
});

test('el ganador recibe su prueba y valida contra la raiz publicada', () => {
    const epoch = rewards.epochDeFecha(FECHA);
    const pub = rewards.rondaPublica(epoch);
    const primero = pub.entries[0];

    const mios = rewards.premiosDe(primero.wallet);
    assert.equal(mios.pendientes.length, 1);
    const premio = mios.pendientes[0];
    assert.equal(premio.epoch, epoch);
    assert.equal(premio.rank, 1);
    assert.equal(premio.amountRaw, primero.amountRaw);
    assert.equal(premio.claimable, false, 'sin publicar on-chain no se puede reclamar');

    const root = Buffer.from(pub.root, 'hex');
    const leaf = merkle.leafHash(epoch, premio.wallet, BigInt(premio.amountRaw));
    assert.ok(merkle.verifyProof(premio.proof.map(h => Buffer.from(h, 'hex')), root, leaf));
});

test('quien no salio en la lista no tiene nada que reclamar', () => {
    const forastero = Keypair.generate().publicKey.toBase58();
    assert.equal(rewards.premiosDe(forastero).pendientes.length, 0);
    assert.equal(rewards.premiosDe(null).pendientes.length, 0);
    // El puesto 11 tampoco: hay pesos para diez.
    const undecimo = wallets[10];
    assert.equal(rewards.premiosDe(undecimo).pendientes.length, 0);
});

test('un premio ya cobrado desaparece de los pendientes', () => {
    const epoch = rewards.epochDeFecha(FECHA);
    const pub = rewards.rondaPublica(epoch);
    const w = pub.entries[1].wallet;
    assert.equal(rewards.premiosDe(w).pendientes.length, 1);
    rewards.marcarCobrado(epoch, w, 'firma-de-prueba');
    assert.equal(rewards.premiosDe(w).pendientes.length, 0);
});

test('el reparto respeta los pesos: el #1 se lleva 35 veces mas que... 35/1.5 que el #10', () => {
    const pub = rewards.rondaPublica(rewards.epochDeFecha(FECHA));
    const primero = BigInt(pub.entries[0].amountRaw);
    const decimo = BigInt(pub.entries[9].amountRaw);
    // 35 % y 1,5 %: la proporcion es 70/3.
    assert.equal(primero * 3n, decimo * 70n);
});

test('sin programa configurado, publicar avisa en vez de reventar', async () => {
    const epoch = rewards.epochDeFecha(FECHA);
    const solanaFalso = { canWithdraw: () => true, authorityPubkey: () => Keypair.generate().publicKey.toBase58(), sendInstructions: async () => 'sig' };
    const r = await rewards.publicarRonda({ epoch, root: '00'.repeat(32), totalRaw: '1', winners: 1 }, solanaFalso, null);
    assert.equal(r.ok, false);
    assert.match(r.error, /sin programa/);
});

test('el estado resume las rondas para el panel', () => {
    const e = rewards.estado();
    assert.equal(e.programa, null);
    assert.ok(e.total >= 1);
    assert.equal(e.sinPublicar, e.total, 'sin cadena, ninguna esta publicada');
    const r = e.rondas.find(x => x.date === FECHA);
    assert.ok(r);
    assert.equal(r.winners, 10);
    // 12 elegibles de los 50 que hacen falta para el bote completo: sale el 24 %.
    // Los pesos suman 100 %, asi que se reparte ese 24 % entero.
    // `estado()` da el resumen del panel, donde el total ya viene en PILL.
    // 12 elegibles de los 50 que hacen falta para el bote completo: sale el 24 %,
    // y con doce en la lista los diez pesos estan ocupados, asi que se reparte entero.
    assert.equal(r.pill, Math.floor(50000 * 12 / 50));
});

/* ===================== EL BOTE SEGUN CUANTA GENTE JUGO ===================== */

/*
 * Con doce jugadores, diez cobran: estar en el top 10 sale casi gratis. El premio
 * tiene que valer lo que cuesta ganarlo, y ganarle a once no vale lo mismo que
 * ganarle a doscientos. Cobran los diez primeros igual — lo que cambia es el tamano
 * del bote, no cuanta gente lo parte.
 */

function diaCon(n, fecha) {
    actividadEn(fecha);
    const ws = Array.from({ length: n }, () => Keypair.generate().publicKey.toBase58());
    ws.forEach((w, i) => {
        for (let k = 0; k < 60 - i; k++) lb.recordKill(w, 'j' + i);
        lb.recordPeak(w, 50000 - i, 'j' + i);
    });
    lb._setFecha(fecha);
    return lb.cerrarAhora();
}

test('con 50 jugadores o mas sale el bote entero', () => {
    const snap = diaCon(50, '2026-05-10');
    assert.equal(snap.entries.length, 50);
    const r = rewards.prepararRonda('2026-05-10', rewards.pillToRaw(50000));
    assert.equal(rewards.rawToPill(r.totalRaw), 50000, 'con 50 elegibles no deberia recortarse nada');
    assert.equal(r.winners, 10, 'siguen cobrando solo diez');
});

test('con 25 sale la mitad; con 5, ademas, los pesos vacios no salen', () => {
    assert.equal(rewards.prepararRonda('2026-05-11', rewards.pillToRaw(50000)), null,
        'un dia sin cerrar no da ronda');

    // 25 de 50 -> bote al 50 %. Y con 25 en la lista los diez pesos estan ocupados.
    diaCon(25, '2026-05-12');
    assert.equal(rewards.rawToPill(rewards.prepararRonda('2026-05-12', rewards.pillToRaw(50000)).totalRaw), 25000);

    // Con 5 se multiplican los dos recortes: el bote baja al 10 % (5 de 50) y ademas
    // solo salen cinco pesos, 35+20+13+9+7 = 84 %. 50.000 x 0,10 x 0,84 = 4.200.
    diaCon(5, '2026-05-13');
    assert.equal(rewards.rawToPill(rewards.prepararRonda('2026-05-13', rewards.pillToRaw(50000)).totalRaw), 4200);
});

test('mas de 50 no sube el bote por encima del tope', () => {
    diaCon(90, '2026-05-14');
    const r = rewards.prepararRonda('2026-05-14', rewards.pillToRaw(50000));
    assert.equal(rewards.rawToPill(r.totalRaw), 50000, 'el tope es el tope: 90 jugadores no dan mas que 50');
});

test('el JSON publico dice por que el bote fue el que fue', () => {
    // Sin estos numeros, "ese dia se repartio menos" hay que creerselo.
    const pub = rewards.rondaPublica(rewards.epochDeFecha('2026-05-12'));
    assert.equal(pub.elegibles, 25);
    assert.equal(pub.potCompletoCon, 50);
    assert.equal(pub.topeRaw, rewards.pillToRaw(50000).toString());
    // Y la cuenta se rehace desde ahi, sin fiarse del total publicado.
    const esperado = BigInt(pub.topeRaw) * BigInt(pub.elegibles) / BigInt(pub.potCompletoCon);
    assert.equal(BigInt(pub.total), esperado);
});

/* ===================== EL BOTE SEGUN LA ACTIVIDAD ===================== */

/*
 * El grifo del contrato es un techo, pero un techo no sabe cuanta gente juega: en
 * una sala vacia deja salir lo mismo que en una llena. Esto es lo que baja el bote
 * cuando no hay actividad — y de paso lo que hace que crear wallets no sea rentable,
 * porque el bote no puede pasar de lo que se pago en entradas.
 */

/*
 * El freno vive en prepararRonda y no en presupuestoRaw: necesita saber DE QUE DIA
 * se trata. presupuestoRaw da el techo del contrato, que es el mismo para todos los
 * dias pendientes; lo que se jugo, no.
 */

/** Cierra un dia con `jug` jugadores y `rakePill` de rake generado. */
function diaDe(fecha, jug, rakePill) {
    const t = Date.parse(fecha + 'T12:00:00Z');
    const ws = Array.from({ length: jug }, () => Keypair.generate().publicKey.toBase58());
    rake.alStaking(rakePill, 'exit fees', t);
    matches.registra({
        room: 'classic_5$_L1', mode: 'classic', startedAt: t - 300000, endedAt: t,
        entryFee: 1160, pot: 0,
        players: ws.map((w, i) => ({ wallet: w, name: 'j' + i, kills: 3, peak: 1, paid: true, isTester: false })),
    });
    // Todos por encima de MIN_KILLS y en orden decreciente: si alguno se queda corto
    // deja de ser elegible y el freno de participacion recorta sin que se vea por que.
    ws.forEach((w, i) => { for (let k = 0; k < jug - i + 3; k++) lb.recordKill(w, 'j' + i); lb.recordPeak(w, 9000 - i, 'j' + i); });
    lb._setFecha(fecha);
    const snap = lb.cerrarAhora();
    assert.equal(snap.entries.length, jug, `los ${jug} jugadores tienen que ser elegibles`);
    return snap;
}

test('un dia sin partidas no genera ronda, por mucho que el grifo deje salir', () => {
    // Solo leaderboard, cero entradas cobradas. No puede haber premio: el dinero
    // saldria de la tesoreria sin que nadie hubiera puesto nada.
    const F = '2026-05-20';
    const ws = Array.from({ length: 12 }, () => Keypair.generate().publicKey.toBase58());
    ws.forEach((w, i) => { for (let k = 0; k < 20 - i; k++) lb.recordKill(w, 'x' + i); lb.recordPeak(w, 900 - i, 'x' + i); });
    lb._setFecha(F);
    assert.equal(lb.cerrarAhora().entries.length, 12, 'los doce estan en la lista');
    assert.equal(rewards.prepararRonda(F, rewards.pillToRaw(50000)), null);
});

test('el bote sube con el rake y se para en el techo del contrato', () => {
    // 50 jugadores para que el freno de participacion no recorte, y los 10 pesos
    // ocupados: asi lo unico que se mide aqui es la recaudacion.
    diaDe('2026-05-21', 50, 10000);   // 10.000 de rake
    assert.equal(rewards.rawToPill(rewards.prepararRonda('2026-05-21', rewards.pillToRaw(50000)).totalRaw), 10000);

    diaDe('2026-05-22', 50, 100000);  // 100.000 de rake, por encima del techo
    assert.equal(rewards.rawToPill(rewards.prepararRonda('2026-05-22', rewards.pillToRaw(50000)).totalRaw), 50000,
        'por encima del techo manda el techo, no la actividad');
});

test('el bote nunca puede pasar del rake de ESE dia', () => {
    // Es el invariante que cierra el sybil: da igual cuantas wallets aparezcan en la
    // tabla, el premio sale acotado por el dinero que entro ese dia.
    const F = '2026-05-23';
    diaDe(F, 50, 15000);              // 15.000 de rake
    assert.equal(rake.delDia(F), 15000);
    const r = rewards.prepararRonda(F, rewards.pillToRaw(50000));
    assert.ok(rewards.rawToPill(r.totalRaw) <= 15000,
        `el bote (${rewards.rawToPill(r.totalRaw)}) supera el rake del dia (15000)`);
});

test('la actividad de hoy no paga los premios de un dia atrasado', () => {
    // El fallo que esto evita: si la ventana fueran "las ultimas 24 h", un dia flojo
    // premiado con retraso cobraria segun lo que se jugo HOY. Con dias acumulados
    // —el servidor caido, o el ciclo corriendo tarde— todos cobrarian lo mismo.
    diaDe('2026-05-24', 50, 5000);    //   5.000 de rake el dia flojo
    diaDe('2026-05-25', 50, 200000);  // 200.000 de rake el dia bueno

    const flojo = rewards.prepararRonda('2026-05-24', rewards.pillToRaw(50000));
    const bueno = rewards.prepararRonda('2026-05-25', rewards.pillToRaw(50000));

    assert.equal(rewards.rawToPill(flojo.totalRaw), 5000, 'el dia flojo cobra lo suyo');
    assert.equal(rewards.rawToPill(bueno.totalRaw), 50000, 'el bueno topa con el techo');
});

/*
 * ESTE VA EL ULTIMO a proposito: recarga rake/rewards/leaderboard con otro
 * LB_DIR y deja la cache de require tocada. Cualquier test que fuera detras
 * cogeria una instancia de rake recien creada, sin los apuntes en memoria de
 * los tests anteriores, y le saldria un bote de cero sin motivo aparente.
 */
test('el factor multiplica el rake, y por defecto es 20', () => {
    // El rake de classic sale solo de quien sobrevive al timer sin ganar la sala: con
    // factor 1 el leaderboard se estrangula (unos 50 \$/dia con 500 jugadores frente a
    // los 170 \$ del grifo). El factor es el multiplicador que se calibra con datos.
    //
    // Lo que NO cambia por mucho que suba: cero por cualquier factor sigue siendo
    // cero, asi que jugar contra uno mismo nunca paga.
    const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-factor-'));
    const antesDir = process.env.LB_DIR, antesF = process.env.REWARD_FACTOR;
    process.env.LB_DIR = DIR;
    delete process.env.REWARD_FACTOR;          // el default
    for (const m of ['../server/rake.js', '../server/rewards.js', '../server/leaderboard.js']) {
        delete require.cache[require.resolve(m)];
    }
    const rw = require('../server/rewards.js');
    const rk = require('../server/rake.js');
    const lb2 = require('../server/leaderboard.js');
    assert.equal(rw.REWARD_FACTOR, 20, 'el default deberia ser 20');

    const F = '2026-06-01';
    const t = Date.parse(F + 'T12:00:00Z');
    rk.alStaking(1000, 'exit fees', t);        // 1.000 de rake -> 20.000 de bote
    const ws = Array.from({ length: 50 }, () => Keypair.generate().publicKey.toBase58());
    ws.forEach((w, i) => { for (let k = 0; k < 60 - i; k++) lb2.recordKill(w, 'j' + i); lb2.recordPeak(w, 9000 - i, 'j' + i); });
    lb2._setFecha(F);
    lb2.cerrarAhora();
    assert.equal(rw.rawToPill(rw.prepararRonda(F, rw.pillToRaw(500000)).totalRaw), 20000);

    // Y el suelo duro: sin rake no hay premio, valga lo que valga el factor.
    const F2 = '2026-06-02';
    ws.forEach((w, i) => { for (let k = 0; k < 60 - i; k++) lb2.recordKill(w, 'j' + i); lb2.recordPeak(w, 9000 - i, 'j' + i); });
    lb2._setFecha(F2);
    lb2.cerrarAhora();
    assert.equal(rk.delDia(F2), 0);
    assert.equal(rw.prepararRonda(F2, rw.pillToRaw(500000)), null, 'sin rake no hay ronda');

    process.env.LB_DIR = antesDir;
    if (antesF !== undefined) process.env.REWARD_FACTOR = antesF;
    for (const m of ['../server/rake.js', '../server/rewards.js', '../server/leaderboard.js']) {
        delete require.cache[require.resolve(m)];
    }
    fs.rmSync(DIR, { recursive: true, force: true });
});

test('limpieza', () => {
    rewards.save(); lb.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
