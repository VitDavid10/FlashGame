/*
 * Tests de la prueba de pasivo.
 *
 * Esto existe por una pregunta muy concreta: si el servidor es mio, ¿puedo darme
 * saldo y retirarlo? Hoy si, y nadie lo notaria. Lo que se comprueba aqui es que con
 * el snapshot publicado deje de ser invisible:
 *
 *   - si me doy saldo, el pasivo publicado sube y deja de cuadrar con la custodia
 *   - si oculto ese saldo para que cuadre, tengo que quitarselo a alguien concreto
 *     que lo ve en su propia fila
 *   - si reescribo un snapshot viejo, la cadena se rompe
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
const merkle = require('../server/merkle.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-reserves-'));
process.env.LB_DIR = TMP;
const reserves = require('../server/reserves.js');

const wallets = Array.from({ length: 6 }, (_, i) => {
    const s = Buffer.alloc(32); s.write('reserva-test-' + i);
    return Keypair.fromSeed(s).publicKey.toBase58();
});
const saldos = () => ({
    [wallets[0]]: 500000, [wallets[1]]: 250000, [wallets[2]]: 90000,
    [wallets[3]]: 10000, [wallets[4]]: 1, [wallets[5]]: 0,   // el 0 no es deuda
});

test('el snapshot suma solo los saldos positivos', () => {
    const { filas, total } = reserves.construye(saldos(), 0);
    assert.equal(filas.length, 5, 'la wallet a cero no es pasivo');
    assert.equal(total, 850001);
});

test('la lista va ordenada por wallet, no por el orden del objeto', () => {
    // Si dependiera del orden de inserción, dos personas con los mismos datos
    // sacarían hashes distintos y la verificación pública no valdría de nada.
    const a = reserves.construye(saldos(), 0);
    const alReves = Object.fromEntries(Object.entries(saldos()).reverse());
    const b = reserves.construye(alReves, 0);
    assert.deepEqual(a.filas.map(f => f.wallet), b.filas.map(f => f.wallet));
    assert.equal(a.root, b.root);
});

test('publicar un snapshot deja la lista, la raiz y el total', async () => {
    const s = await reserves.publica(saldos(), null, null);
    assert.ok(s);
    assert.equal(s.n, 0);
    assert.equal(s.prevHash, reserves.GENESIS);
    assert.equal(s.total, 850001);
    assert.equal(s.wallets, 5);
    assert.equal(s.balances.length, 5);
});

test('cada wallet puede comprobar su fila con su prueba', () => {
    const p = reserves.pruebaDe(wallets[1]);
    assert.ok(p.incluida);
    assert.equal(p.saldo, 250000);
    // La misma comprobación que haría el jugador con el JSON público.
    const hoja = merkle.leafHash(p.snapshot, p.wallet, BigInt(p.saldo));
    const proof = p.proof.map(h => Buffer.from(h, 'hex'));
    assert.ok(merkle.verifyProof(proof, Buffer.from(p.root, 'hex'), hoja));
});

test('una wallet que no esta en la lista lo sabe', () => {
    const forastero = Keypair.generate().publicKey.toBase58();
    const p = reserves.pruebaDe(forastero);
    assert.equal(p.incluida, false);
    assert.equal(p.saldo, 0);
});

test('los snapshots encadenan', async () => {
    const b = saldos(); b[wallets[0]] += 1000;
    await reserves.publica(b, null, null);
    const cadena = reserves.cadena();
    assert.equal(cadena.length, 2);
    assert.equal(cadena[1].prevHash, cadena[0].hash);
    assert.ok(reserves.verificar().ok);
});

/* ===================== LOS ATAQUES ===================== */

test('darme saldo sube el pasivo publicado: deja de cuadrar con la custodia', async () => {
    const antes = reserves.ultimo().total;
    const trucado = saldos();
    trucado[wallets[0]] += 5_000_000;        // me regalo cinco millones
    const s = await reserves.publica(trucado, null, null);
    assert.ok(s.total > antes + 4_000_000, 'el pasivo tiene que subir a la vista de todos');
    // Y esa subida es justo lo que no cuadra: la custodia on-chain no se movió.
    const custodiaReal = antes;
    assert.ok(s.total > custodiaReal, 'debo más de lo que hay: eso es lo que se ve en /api/treasury');
});

test('esconderlo obliga a quitarle saldo a alguien, que lo ve en su fila', async () => {
    // El ataque fino: me doy saldo Y bajo el de otro para que el total cuadre.
    const trucado = saldos();
    trucado[wallets[0]] += 200000;
    trucado[wallets[1]] -= 200000;           // se lo quito a este
    const s = await reserves.publica(trucado, null, null);
    assert.equal(s.total, 850001, 'el total cuadra: por eso este ataque es el peligroso');

    // Pero la víctima mira su fila y ve que le faltan 200.000.
    const p = reserves.pruebaDe(wallets[1]);
    assert.equal(p.saldo, 50000);
    assert.notEqual(p.saldo, 250000, 'y ese es exactamente el momento en que se destapa');
});

test('reescribir un snapshot ya publicado rompe la cadena', () => {
    const cadena = reserves.cadena();
    const victima = cadena[0].n;
    const f = path.join(TMP, 'reserves', victima + '.json');
    const original = fs.readFileSync(f, 'utf8');

    const snap = JSON.parse(original);
    snap.balances[0].saldo += 999999;
    snap.total += 999999;
    fs.writeFileSync(f, JSON.stringify(snap));

    const r = reserves.verificar();
    assert.equal(r.ok, false);
    assert.ok(r.fallos.some(x => x.n === victima));

    fs.writeFileSync(f, original);
    assert.ok(reserves.verificar().ok, 'al restaurarlo vuelve a cuadrar');
});

test('una raiz puesta a mano no cuela: tiene que salir de la lista', () => {
    const cadena = reserves.cadena();
    const victima = cadena[1].n;
    const f = path.join(TMP, 'reserves', victima + '.json');
    const original = fs.readFileSync(f, 'utf8');

    const snap = JSON.parse(original);
    snap.root = 'ff'.repeat(32);
    fs.writeFileSync(f, JSON.stringify(snap));

    const r = reserves.verificar();
    assert.equal(r.ok, false);
    assert.ok(r.fallos.some(x => /raiz de Merkle/.test(x.error)));

    fs.writeFileSync(f, original);
    assert.ok(reserves.verificar().ok);
});

test('un total inflado sin cambiar la lista tampoco', () => {
    const cadena = reserves.cadena();
    const victima = cadena[0].n;
    const f = path.join(TMP, 'reserves', victima + '.json');
    const original = fs.readFileSync(f, 'utf8');

    const snap = JSON.parse(original);
    snap.total = 1;
    fs.writeFileSync(f, JSON.stringify(snap));

    const r = reserves.verificar();
    assert.equal(r.ok, false);
    assert.ok(r.fallos.some(x => /el total no es la suma/.test(x.error)));

    fs.writeFileSync(f, original);
    assert.ok(reserves.verificar().ok);
});

test('un servidor que no debe nada tambien publica: "no debo nada" es una afirmacion', async () => {
    const s = await reserves.publica({}, null, null);
    assert.ok(s);
    assert.equal(s.total, 0);
    assert.equal(s.wallets, 0);
    assert.ok(reserves.verificar().ok);
});

test('limpieza', () => {
    reserves.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
