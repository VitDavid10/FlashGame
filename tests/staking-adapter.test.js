/*
 * Tests del adaptador que decide QUE PROGRAMA lleva el staking.
 *
 * Hay dos implementaciones vivas —pill_staking aparte y el staking de dentro de
 * pill_treasury— y este modulo las normaliza. El riesgo no es que una este mal: es
 * que la eleccion sea la equivocada, o que un campo se mapee cruzado y el panel
 * ensene el `total_funded` de uno en el hueco del otro sin que nada falle.
 *
 * Cada bloque recarga el modulo con otras variables de entorno, porque la eleccion se
 * hace al importarlo.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Keypair } = require('@solana/web3.js');

const RUTA = require.resolve('../server/staking.js');
const APARTE = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const TESORO = 'PiLLBwuaj4eTy9cdFoiChNtbCstHZFSLeKQk13zJwMW';

/** Recarga server/staking.js con el entorno que se le diga. */
function conEntorno(env) {
    const antes = { STAKING_PROGRAM: process.env.STAKING_PROGRAM, TREASURY_PROGRAM: process.env.TREASURY_PROGRAM };
    delete process.env.STAKING_PROGRAM; delete process.env.TREASURY_PROGRAM;
    for (const [k, v] of Object.entries(env)) if (v) process.env[k] = v;
    delete require.cache[RUTA];
    const mod = require('../server/staking.js');
    for (const [k, v] of Object.entries(antes)) { if (v) process.env[k] = v; else delete process.env[k]; }
    return mod;
}

const wallet = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const from = Keypair.generate().publicKey.toBase58();

/* ===================== LA ELECCION ===================== */

test('sin ninguna variable, no hay staking', () => {
    const st = conEntorno({});
    assert.equal(st.PROGRAMA, null);
    assert.equal(st.MODO, null);
    assert.equal(st.pdas(), null);
    assert.equal(st.ix('stake', { wallet, amountRaw: 1n }), null);
    assert.equal(st.ixFund({ authority: wallet, amountRaw: 1n, durationSecs: 3600 }), null);
});

test('con solo TREASURY_PROGRAM, el staking va por la tesoreria', () => {
    const st = conEntorno({ TREASURY_PROGRAM: TESORO });
    assert.equal(st.MODO, 'tesoreria');
    assert.equal(st.PROGRAMA, TESORO);
});

test('con solo STAKING_PROGRAM, va por el contrato aparte', () => {
    const st = conEntorno({ STAKING_PROGRAM: APARTE });
    assert.equal(st.MODO, 'aparte');
    assert.equal(st.PROGRAMA, APARTE);
});

test('con las dos, manda el contrato aparte', () => {
    /*
     * Es lo que hace que desplegarlo baste para pasarse: se pone la variable y el
     * servidor cambia solo, sin tocar el resto de la configuracion. Si ganara la
     * tesoreria, el contrato nuevo estaria desplegado y muerto sin que se notara.
     */
    const st = conEntorno({ STAKING_PROGRAM: APARTE, TREASURY_PROGRAM: TESORO });
    assert.equal(st.MODO, 'aparte');
    assert.equal(st.PROGRAMA, APARTE);
});

/* ===================== LAS INSTRUCCIONES ===================== */

test('cada accion sale con el programa elegido detras', () => {
    const st = conEntorno({ STAKING_PROGRAM: APARTE, TREASURY_PROGRAM: TESORO });
    for (const accion of ['stake', 'request_unstake', 'withdraw_unstaked', 'compound', 'claim']) {
        const ix = st.ix(accion, { wallet, amountRaw: 1n, from, mint });
        assert.ok(ix, `${accion} no devolvio instruccion`);
        assert.equal(ix.programId.toBase58(), APARTE, `${accion} apunta al programa equivocado`);
    }
});

test('las cinco acciones son las mismas en los dos modos', () => {
    // Si una faltara en uno de los dos, la interfaz tendria un boton que solo
    // funciona segun que contrato haya detras — y nadie lo veria hasta migrar.
    const acciones = ['stake', 'request_unstake', 'withdraw_unstaked', 'compound', 'claim'];
    const aparte = conEntorno({ STAKING_PROGRAM: APARTE });
    const tesoro = conEntorno({ TREASURY_PROGRAM: TESORO });
    for (const a of acciones) {
        assert.ok(aparte.ix(a, { wallet, amountRaw: 1n, from, mint }), `falta ${a} en el modo aparte`);
        assert.ok(tesoro.ix(a, { wallet, amountRaw: 1n, from, mint }), `falta ${a} en el modo tesoreria`);
    }
});

test('una accion inventada no devuelve instruccion, en los dos modos', () => {
    for (const env of [{ STAKING_PROGRAM: APARTE }, { TREASURY_PROGRAM: TESORO }]) {
        assert.equal(conEntorno(env).ix('vaciar_la_boveda', { wallet, amountRaw: 1n, mint }), null);
    }
});

test('llenar el pozo usa la instruccion de cada contrato', () => {
    const crypto = require('node:crypto');
    const d = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);

    // El aparte coge el dinero de una cuenta normal; el de la tesoreria, de su boveda.
    const aparte = conEntorno({ STAKING_PROGRAM: APARTE });
    const ixA = aparte.ixFund({ authority: wallet, from, amountRaw: 1000n, durationSecs: 86400 });
    assert.equal(ixA.programId.toBase58(), APARTE);
    assert.ok(ixA.data.subarray(0, 8).equals(d('fund_rewards')));

    const tesoro = conEntorno({ TREASURY_PROGRAM: TESORO });
    const ixT = tesoro.ixFund({ authority: wallet, amountRaw: 1000n, durationSecs: 86400 });
    assert.equal(ixT.programId.toBase58(), TESORO);
    assert.ok(ixT.data.subarray(0, 8).equals(d('fund_stake_rewards')));
});

test('el contrato aparte necesita cuenta de origen y la deriva si no se la dan', () => {
    /*
     * pill_staking no custodia nada mas que el staking, asi que el rake tiene que
     * salir de una cuenta normal. Quien barre (rake, tienda) no tiene por que saberlo:
     * lo deriva el adaptador.
     */
    const st = conEntorno({ STAKING_PROGRAM: APARTE });
    const conFrom = st.ixFund({ authority: wallet, from, amountRaw: 1n, durationSecs: 3600 });
    assert.equal(conFrom.keys[2].pubkey.toBase58(), from, 'no uso la cuenta que se le dio');

    const sinFrom = st.ixFund({ authority: wallet, amountRaw: 1n, durationSecs: 3600 });
    assert.equal(sinFrom.keys.length, conFrom.keys.length);
    assert.notEqual(sinFrom.keys[2].pubkey.toBase58(), from, 'deberia haber derivado otra');
});

/* ===================== LA NORMALIZACION ===================== */

test('la config sale con los mismos nombres venga del contrato que venga', () => {
    /*
     * Los dos programas guardan lo mismo con nombres distintos (total_funded contra
     * total_stake_funded). Si el mapeo se cruzara, el panel ensenaria un numero por
     * otro sin que nada fallara — que es la peor forma de equivocarse.
     */
    const sc = require('../server/staking-client.js');
    const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
    const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
    const u128 = (n) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(n) & 0xffffffffffffffffn, 0);
        b.writeBigUInt64LE(BigInt(n) >> 64n, 8); return b; };

    const auth = Keypair.generate().publicKey, mnt = Keypair.generate().publicKey;
    const buf = Buffer.concat([
        sc.accDisc('Config'), auth.toBuffer(), Buffer.from([0]), mnt.toBuffer(),
        Buffer.from([255, 254, 253]),
        u64(7_000000), u128(123n), u64(50), i64(1900000000), i64(1800000000),
        u64(999_000000), u64(11_000000),
    ]);
    const cfg = conEntorno({ STAKING_PROGRAM: APARTE }).decodeConfig(buf);
    assert.equal(cfg.activo, true, 'el contrato aparte no sirve para otra cosa: siempre activo');
    assert.equal(cfg.totalStaked, 7000000n);
    assert.equal(cfg.accRewardPerShare, 123n);
    assert.equal(cfg.rewardRate, 50n);
    assert.equal(cfg.periodFinish, 1900000000);
    assert.equal(cfg.lastUpdate, 1800000000);
    assert.equal(cfg.aportado, 999000000n, 'total_funded tiene que caer en aportado');
    assert.equal(cfg.pagado, 11000000n, 'total_paid tiene que caer en pagado');
});

test('la posicion sale con los mismos nombres y en BigInt', () => {
    const sc = require('../server/staking-client.js');
    const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
    const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
    const u128 = (n) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(n), 0); return b; };
    const o = Keypair.generate().publicKey;
    const buf = Buffer.concat([
        sc.accDisc('StakeAccount'), o.toBuffer(), u64(500), u128(9n), u64(3), u64(2),
        i64(1950000000), Buffer.from([250]),
    ]);
    const acc = conEntorno({ STAKING_PROGRAM: APARTE }).decodeStakeAccount(buf);
    // BigInt a proposito: la aritmetica del devengo en index.js es con BigInt, y un
    // Number colandose ahi da NaN en cuanto se mezcla.
    for (const k of ['amount', 'rewardPerSharePaid', 'pending', 'unstaking']) {
        assert.equal(typeof acc[k], 'bigint', `${k} tiene que ser BigInt`);
    }
    assert.equal(acc.amount, 500n);
    assert.equal(acc.unstakeReadyAt, 1950000000);
});

test('la posicion de cada wallet es una PDA distinta en los dos modos', () => {
    const otra = Keypair.generate().publicKey.toBase58();
    for (const env of [{ STAKING_PROGRAM: APARTE }, { TREASURY_PROGRAM: TESORO }]) {
        const st = conEntorno(env);
        assert.notEqual(st.posicionPda(wallet).toBase58(), st.posicionPda(otra).toBase58());
    }
});

test('decodificar sin programa configurado avisa en vez de devolver basura', () => {
    const st = conEntorno({});
    assert.throws(() => st.decodeConfig(Buffer.alloc(200)), /no staking program/);
    assert.throws(() => st.decodeStakeAccount(Buffer.alloc(200)), /no staking program/);
});
