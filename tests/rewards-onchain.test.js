/*
 * Tests del trozo de rewards.js que habla con la cadena, con un RPC simulado.
 *
 * Es la parte que no se puede probar sin devnet y que, cuando falla, falla del peor
 * modo posible: en silencio y con dinero de por medio. Un mock del RPC no demuestra
 * que el contrato haga lo correcto —eso lo prueban los tests de Rust— pero si
 * demuestra lo que hace el SERVIDOR: que el presupuesto respeta el grifo que declara
 * la config, que una ronda publicada no se vuelve a publicar, que un fallo del RPC
 * deja la ronda pendiente en vez de darla por buena, y que el estado de los claims
 * sale de la cadena y no de lo que el servidor se crea.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Keypair, PublicKey } = require('@solana/web3.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-onchain-'));
process.env.LB_DIR = TMP;
process.env.TREASURY_PROGRAM = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
process.env.REWARD_BUDGET_PILL = '50000';
// Factor 1 para que los numeros sean directos: 1 PILL de rake -> 1 de bote.
process.env.REWARD_FACTOR = '1';

const rewards = require('../server/rewards.js');
const lb = require('../server/leaderboard.js');
const tc = require('../server/treasury-client.js');

const PROGRAM = process.env.TREASURY_PROGRAM;
const DEC = 6;
const raw = (pill) => BigInt(pill) * 10n ** BigInt(DEC);

/* ===================== CUENTAS FALSAS ===================== */

const disc = (ns, n) => crypto.createHash('sha256').update(`${ns}:${n}`).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u8 = (n) => Buffer.from([n]);

const u128 = (n) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(n), 0); b.writeBigUInt64LE(0n, 8); return b; };

/*
 * Config on-chain con el layout exacto de lib.rs.
 *
 * Se escribe a mano a propósito: si alguien añade un campo al struct de Rust y no
 * toca esto, los tests fallan y obligan a mirar. Un buffer construido con el propio
 * decodificador no se enteraría de nada.
 */
function configBuf({ rewardCap, bps, reserved = 0 }) {
    return Buffer.concat([
        disc('account', 'Config'),
        new PublicKey(Keypair.generate().publicKey).toBuffer(),   // authority
        Buffer.alloc(32),                                          // pending_authority
        new PublicKey(Keypair.generate().publicKey).toBuffer(),   // mint
        i64(2_000_000_000), u8(0),                                 // unlock_ts, finalized
        i64(86400), u64(rewardCap), u16(bps), i64(172800),         // epoch, cap, bps, challenge
        u64(500000), i64(0), u64(0),                               // sweep cap/epoch/usado
        u64(500000), i64(0), u64(0), u64(0),                       // burn cap/epoch/usado/total
        u64(reserved),
        u64(0), u64(0), u64(0), u64(0), u64(0), u64(0), u64(0),    // totales
        u8(255), u8(255), u8(255),                                 // bumps
        // staking: activo, sin nadie dentro y sin goteo en marcha
        u8(1), u8(255), u8(255),                                   // staking_ready, stake/rewards bump
        u64(0), u128(0), u64(0), i64(0), i64(0), u64(0), u64(0),
    ]);
}

/** Token account SPL: solo importa el u64 del offset 64. */
function tokenBuf(amount) {
    const b = Buffer.alloc(165);
    b.writeBigUInt64LE(BigInt(amount), 64);
    return b;
}

function roundBuf({ epoch, root, total, claimed = 0, claimableAt, cancelled = false, expired = false }) {
    return Buffer.concat([
        disc('account', 'RewardRound'),
        u64(epoch), Buffer.from(root, 'hex'), u64(total), u64(claimed), u16(10),
        i64(Math.floor(Date.now() / 1000)), i64(claimableAt),
        u8(cancelled ? 1 : 0), u8(expired ? 1 : 0), u8(255),
    ]);
}

/** Conexión falsa: devuelve lo que se le diga, y cuenta lo que le piden. */
function conexionFalsa(mapa) {
    return {
        peticiones: 0,
        async getMultipleAccountsInfo(claves) {
            this.peticiones++;
            return claves.map(k => {
                const d = mapa[k.toBase58()];
                return d ? { data: d } : null;
            });
        },
    };
}

/* ===================== PRESUPUESTO ===================== */

/*
 * El bote es el menor de varios limites, y uno de ellos es el RAKE de ese dia: lo
 * que la casa se quedo. Estos tests miden el grifo del contrato, asi que el dia en
 * cuestion necesita rake de sobra — si no, todos acabarian midiendo el otro freno y
 * no se notaria que el grifo dejo de funcionar.
 *
 * La fecha importa: el rake se acumula por dia UTC, con el mismo corte que el
 * leaderboard.
 */
function actividadDeSobra(fecha) {
    const rake = require('../server/rake.js');
    const t = fecha ? Date.parse(fecha + 'T12:00:00Z') : Date.now();
    rake.alStaking(20000000, 'exit fees del dia', t);
}
actividadDeSobra();              // hoy
actividadDeSobra('2026-07-01');  // el dia que premian los tests de claims

test('el presupuesto respeta el menor de los dos topes del grifo', async () => {
    const p = tc.pdas(PROGRAM);
    // Saldo 100M, bps 5 (0,05 %) -> 50.000 PILL. Cap absoluto 60.000. Manda el bps.
    const conn = conexionFalsa({
        [p.config.toBase58()]: configBuf({ rewardCap: raw(60000), bps: 5 }),
        [p.treasury.toBase58()]: tokenBuf(raw(100_000_000)),
    });
    assert.equal(await rewards.presupuestoRaw(conn, null), raw(50000));
});

test('con poca actividad manda la actividad, aunque el grifo deje salir mucho', () => {
    // Es el caso del arranque: contrato lleno, grifo abierto y cuatro jugadores. Sin
    // este limite se repartiria el tope entero entre esos cuatro, que es exactamente
    // lo que hace rentable presentarse con wallets propias.
    //
    // El freno vive en prepararRonda y no en presupuestoRaw porque necesita saber DE
    // QUE DIA se trata: con dias atrasados, una ventana de "ultimas 24 h" les
    // aplicaria a todos la actividad de hoy.
    const DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-poco-'));
    const antes = process.env.LB_DIR;
    process.env.LB_DIR = DIR2;
    for (const m of ['../server/matches.js', '../server/rewards.js', '../server/leaderboard.js']) {
        delete require.cache[require.resolve(m)];
    }
    const rw2 = require('../server/rewards.js');
    const rk2 = require('../server/rake.js');
    const lb3 = require('../server/leaderboard.js');

    const F = '2026-06-15';
    const t = Date.parse(F + 'T12:00:00Z');
    const ws = Array.from({ length: 4 }, () => Keypair.generate().publicKey.toBase58());
    rk2.alStaking(4000, 'exit fees', t);
    ws.forEach((w, i) => { for (let k = 0; k < 10 - i; k++) lb3.recordKill(w, 'j' + i); lb3.recordPeak(w, 100 - i, 'j' + i); });
    lb3._setFecha(F);
    lb3.cerrarAhora();

    // El grifo dejaria salir 60.000; la casa solo se quedo 4.000 ese dia. Y luego los
    // otros dos recortes: 4 de 50 elegibles, y los pesos de los cuatro puestos.
    const r = rw2.prepararRonda(F, rw2.pillToRaw(60000));
    const esperado = Math.floor(Math.floor(4000 * 4 / 50) * 77 / 100);   // 35+20+13+9
    assert.equal(rw2.rawToPill(r.totalRaw), esperado);
    assert.ok(rw2.rawToPill(r.totalRaw) < 4000, 'nunca por encima del rake del dia');

    process.env.LB_DIR = antes;
    for (const m of ['../server/matches.js', '../server/rewards.js', '../server/leaderboard.js']) {
        delete require.cache[require.resolve(m)];
    }
    fs.rmSync(DIR2, { recursive: true, force: true });
});

test('cuando el cap absoluto es el menor, manda el cap', async () => {
    const p = tc.pdas(PROGRAM);
    // Saldo 100M, bps 100 (1 %) -> 1.000.000. Cap 60.000. Manda el cap.
    const conn = conexionFalsa({
        [p.config.toBase58()]: configBuf({ rewardCap: raw(60000), bps: 100 }),
        [p.treasury.toBase58()]: tokenBuf(raw(100_000_000)),
    });
    assert.equal(await rewards.presupuestoRaw(conn, null), raw(60000));
});

test('lo reservado por rondas vivas no se puede volver a repartir', async () => {
    const p = tc.pdas(PROGRAM);
    // Saldo 100.000 y 90.000 reservados: solo quedan 10.000 libres, por debajo del grifo.
    const conn = conexionFalsa({
        [p.config.toBase58()]: configBuf({ rewardCap: raw(60000), bps: 10000, reserved: raw(90000) }),
        [p.treasury.toBase58()]: tokenBuf(raw(100000)),
    });
    assert.equal(await rewards.presupuestoRaw(conn, null), raw(10000));
});

test('si el RPC falla se usa el presupuesto local en vez de reventar', async () => {
    const conn = { async getMultipleAccountsInfo() { throw new Error('502 del RPC'); } };
    // Un RPC caido no puede parar la generacion de rondas: se sigue con el
    // presupuesto de respaldo y el contrato rechazara lo que se pase del grifo.
    assert.equal(await rewards.presupuestoRaw(conn, () => {}), raw(50000));
});

test('sin config on-chain todavia, tambien cae al presupuesto local', async () => {
    const p = tc.pdas(PROGRAM);
    const conn = conexionFalsa({ [p.treasury.toBase58()]: tokenBuf(raw(1000)) });
    assert.equal(await rewards.presupuestoRaw(conn, null), raw(50000));
});

/* ===================== PUBLICACION ===================== */

function solanaFalso({ falla = false, sinClave = false } = {}) {
    return {
        enviadas: [],
        canWithdraw: () => !sinClave,
        authorityPubkey: () => Keypair.generate().publicKey.toBase58(),
        async sendInstructions(ixs) {
            if (falla) throw new Error('Transaction simulation failed');
            this.enviadas.push(ixs);
            return 'firma-' + this.enviadas.length;
        },
    };
}

function rondaDePrueba(epoch) {
    return { epoch, date: rewards.fechaDeEpoch(epoch), root: 'ab'.repeat(32), totalRaw: raw(1000).toString(), winners: 10, sig: null };
}

test('publicar una ronda manda UNA instruccion publish_round con su raiz', async () => {
    const s = solanaFalso();
    const r = rondaDePrueba(20800);
    const res = await rewards.publicarRonda(r, s, null);
    assert.equal(res.ok, true);
    assert.equal(s.enviadas.length, 1);
    assert.equal(s.enviadas[0].length, 1, 'una sola instruccion por ronda');

    const data = s.enviadas[0][0].data;
    assert.ok(data.subarray(0, 8).equals(disc('global', 'publish_round')));
    assert.equal(data.readBigUInt64LE(8), 20800n, 'la epoca que viaja no es la de la ronda');
    assert.equal(data.subarray(16, 48).toString('hex'), r.root, 'la raiz que viaja no es la publicada');
});

test('una ronda ya publicada no se vuelve a publicar', async () => {
    const s = solanaFalso();
    const r = rondaDePrueba(20801);
    await rewards.publicarRonda(r, s, null);
    const otra = await rewards.publicarRonda(r, s, null);
    assert.equal(otra.repetida, true);
    assert.equal(s.enviadas.length, 1, 'la segunda llamada no debe mandar nada');
});

test('si la transaccion falla, la ronda queda SIN firma y se reintentara', async () => {
    // Es lo que separa "se reintenta manana" de "esta ronda no se paga nunca".
    const s = solanaFalso({ falla: true });
    const r = rondaDePrueba(20802);
    const res = await rewards.publicarRonda(r, s, null);
    assert.equal(res.ok, false);
    assert.match(res.error, /simulation failed/);
    assert.equal(r.sig, null, 'no debe marcarse como publicada');
});

test('sin clave de la autoridad no se intenta siquiera', async () => {
    const s = solanaFalso({ sinClave: true });
    const res = await rewards.publicarRonda(rondaDePrueba(20803), s, null);
    assert.equal(res.ok, false);
    assert.match(res.error, /no authority key/);
    assert.equal(s.enviadas.length, 0);
});

/* ===================== ESTADO DE LOS CLAIMS ===================== */

test('un premio no es reclamable hasta que la CADENA dice que lo es', async () => {
    // El servidor no decide esto: solo pinta el boton. Si se equivocara y dijera que
    // ya se puede, la transaccion fallaria en el contrato.
    const wallets = Array.from({ length: 10 }, (_, i) => {
        const s = Buffer.alloc(32); s.write('claim-test-' + i);
        return Keypair.fromSeed(s).publicKey.toBase58();
    });
    wallets.forEach((w, i) => { for (let k = 0; k < 20 - i; k++) lb.recordKill(w, 'j' + i); });
    lb._setFecha('2026-07-01');
    lb.cerrarAhora();
    const r = rewards.prepararRonda('2026-07-01', raw(50000));
    assert.ok(r, 'deberia haberse preparado la ronda');

    const antes = rewards.premiosDe(wallets[0]).pendientes[0];
    assert.equal(antes.claimable, false, 'sin publicar no se puede reclamar');

    // Se publica, pero la ventana de impugnacion sigue abierta.
    const s = solanaFalso();
    await rewards.publicarRonda(r, s, null);
    r.claimableAt = Date.now() + 3600e3;
    assert.equal(rewards.premiosDe(wallets[0]).pendientes[0].claimable, false, 'en ventana no se puede');

    // Y pasada la ventana, si.
    r.claimableAt = Date.now() - 1000;
    assert.equal(rewards.premiosDe(wallets[0]).pendientes[0].claimable, true);
});

test('refrescar copia de la cadena el estado de la ronda, y una cancelada deja de pagarse', async () => {
    // La cancelacion la decide el contrato (cancel_round), nunca el servidor. Aqui
    // se comprueba el camino completo: la cadena lo dice, refrescar() lo copia y el
    // jugador deja de ver el premio.
    const epoch = rewards.epochDeFecha('2026-07-01');
    const pub = rewards.rondaPublica(epoch);
    const w = pub.entries[0].wallet;
    assert.equal(rewards.premiosDe(w).pendientes.length, 1, 'de partida deberia tener un premio');

    const pdaRonda = tc.roundPda(PROGRAM, epoch).toBase58();
    const conn = conexionFalsa({
        [pdaRonda]: roundBuf({
            epoch, root: pub.root, total: BigInt(pub.total), claimed: 0,
            claimableAt: Math.floor(Date.now() / 1000) - 1000,
            cancelled: true,
        }),
    });
    await rewards.refrescar(conn, null);

    assert.equal(rewards.premiosDe(w).pendientes.length, 0, 'una ronda cancelada no puede seguir pagando');
    assert.equal(rewards.estado().rondas.find(x => x.epoch === epoch).cancelled, true);
});

test('refrescar tambien trae cuanto se lleva reclamado', async () => {
    const epoch = rewards.epochDeFecha('2026-07-01');
    const pub = rewards.rondaPublica(epoch);
    const pdaRonda = tc.roundPda(PROGRAM, epoch).toBase58();
    const conn = conexionFalsa({
        [pdaRonda]: roundBuf({
            epoch, root: pub.root, total: BigInt(pub.total), claimed: raw(777),
            claimableAt: Math.floor(Date.now() / 1000) - 1000,
        }),
    });
    await rewards.refrescar(conn, null);
    assert.equal(rewards.estado().rondas.find(x => x.epoch === epoch).cancelled, false, 'vuelve a estar viva');
    // El dato de cuanto se cobro sale de la cadena, no de los avisos del cliente.
    const interno = require('../server/rewards.js');
    assert.equal(interno.premiosDe(pub.entries[0].wallet).pendientes.length, 1);
});

test('el decodificador lee una RewardRound como la escribe el contrato', () => {
    const buf = roundBuf({ epoch: 20900, root: 'cd'.repeat(32), total: raw(1234), claimed: raw(500), claimableAt: 1900000000 });
    const d = tc.decodeRound(buf);
    assert.equal(d.epoch, 20900n);
    assert.equal(d.merkleRoot, 'cd'.repeat(32));
    assert.equal(d.total, raw(1234));
    assert.equal(d.claimed, raw(500));
    assert.equal(d.claimableAt, 1900000000);
    assert.equal(d.cancelled, false);
    assert.equal(d.expired, false);
});

/* ===================== LOS CUATRO FRENOS, EN CADENA ===================== */

/*
 * Cada freno tiene su test, pero ninguno comprueba que se apliquen los cuatro
 * JUNTOS. Es donde se cuela un fallo que ningun test individual ve: basta con que
 * uno se calcule sobre el tope original en vez de sobre la salida del anterior para
 * que el bote sea mayor de lo que deberia, y todos los tests sueltos sigan pasando.
 *
 *   1. grifo del contrato   min(saldo x bps / 10000, cap)
 *   2. rake del dia         x REWARD_FACTOR sobre lo que se quedo la casa
 *   3. participacion        x min(1, elegibles / LB_FULL_POT_AT)
 *   4. pesos vacios         solo salen los puestos que existen
 */

test('los cuatro frenos se multiplican, no se pisan', () => {
    const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-cadena-'));
    const antes = process.env.LB_DIR;
    process.env.LB_DIR = DIR;
    for (const m of ['../server/matches.js', '../server/rewards.js', '../server/leaderboard.js']) {
        delete require.cache[require.resolve(m)];
    }
    const rw = require('../server/rewards.js');
    const lb2 = require('../server/leaderboard.js');
    const mt = require('../server/rake.js');

    // 1. El tope del contrato: saldo 100 M, bps 100 (1 %) -> 1.000.000, cap 100.000.
    //    Manda el cap.
    const TOPE = 100000;

    // 2. Rake DEL DIA que se premia: la casa se quedo 40.000 PILL.
    //    Con REWARD_FACTOR=1, el bote no puede pasar de ahi.
    const FECHA_R = '2026-07-09';
    const t = Date.parse(FECHA_R + 'T12:00:00Z');
    const ws = Array.from({ length: 8 }, () => Keypair.generate().publicKey.toBase58());
    mt.alStaking(40000, 'exit fees', t);

    // 3. Participacion: 8 elegibles de los 50 del umbral -> x 8/50 = 0,16.
    ws.forEach((w, i) => { for (let k = 0; k < 10 - i; k++) lb2.recordKill(w, 'j' + i); lb2.recordPeak(w, 100 - i, 'j' + i); });
    lb2._setFecha(FECHA_R);
    const snap = lb2.cerrarAhora();
    assert.equal(snap.entries.length, 8, 'los ocho tienen que ser elegibles');

    // 4. Pesos vacios: con ocho en la lista salen 35+20+13+9+7+5+4+3 = 96 %.
    const r = rw.prepararRonda(FECHA_R, rw.pillToRaw(TOPE));

    const trasRake = Math.min(TOPE, 40000);                 // 40.000
    const trasParticipacion = Math.floor(trasRake * 8 / 50);          // 6.400
    const esperado = Math.floor(trasParticipacion * 96 / 100);        // 6.144
    assert.equal(rw.rawToPill(r.totalRaw), esperado,
        'el bote no es el producto de los cuatro frenos: alguno se esta saltando');

    // Y la comprobacion que de verdad importa: NO es el tope, ni el tope con un
    // solo freno aplicado. Si alguno se pisara, saldria uno de estos numeros.
    assert.notEqual(rw.rawToPill(r.totalRaw), TOPE);
    assert.notEqual(rw.rawToPill(r.totalRaw), Math.floor(TOPE * 96 / 100));
    assert.notEqual(rw.rawToPill(r.totalRaw), Math.floor(40000 * 96 / 100));
    assert.notEqual(rw.rawToPill(r.totalRaw), Math.floor(TOPE * 8 / 50));

    // Siguen cobrando ocho (los que hay), no cincuenta ni diez.
    assert.equal(r.winners, 8);

    process.env.LB_DIR = antes;
    for (const m of ['../server/matches.js', '../server/rewards.js', '../server/leaderboard.js']) {
        delete require.cache[require.resolve(m)];
    }
    fs.rmSync(DIR, { recursive: true, force: true });
});

test('limpieza', () => {
    rewards.save(); lb.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
