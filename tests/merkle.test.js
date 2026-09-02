/*
 * Tests del arbol de Merkle de las rondas de premios.
 *
 * Lo que se comprueba aqui no es "que la funcion devuelva algo": es que las
 * propiedades de las que depende la seguridad del reparto se cumplan. Si alguna de
 * estas cae, alguien puede cobrar un premio que no le tocaba.
 *
 *   node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Keypair } = require('@solana/web3.js');
const merkle = require('../server/merkle.js');

const EPOCH = 20334;
const wallets = (n) => Array.from({ length: n }, () => Keypair.generate().publicKey.toBase58());

function ronda(n, base = 1000n) {
    return wallets(n).map((wallet, i) => ({ wallet, amountRaw: base * BigInt(i + 1), rank: i + 1 }));
}

test('cada ganador tiene una prueba que valida contra la raiz', () => {
    const entries = ronda(10);
    const t = merkle.buildTree(EPOCH, entries);
    for (const e of entries) {
        const proof = t.proofFor(e.wallet);
        const leaf = merkle.leafHash(EPOCH, e.wallet, e.amountRaw);
        assert.ok(merkle.verifyProof(proof, t.root, leaf), 'no valida ' + e.wallet);
    }
});

test('la raiz no depende del orden en que llegue la lista', () => {
    const entries = ronda(10);
    const a = merkle.buildTree(EPOCH, entries).rootHex;
    const b = merkle.buildTree(EPOCH, [...entries].reverse()).rootHex;
    const c = merkle.buildTree(EPOCH, [...entries].sort(() => Math.random() - 0.5)).rootHex;
    assert.equal(a, b);
    assert.equal(a, c);
});

test('la prueba de otro ganador no sirve para cobrar lo tuyo', () => {
    const entries = ronda(10);
    const t = merkle.buildTree(EPOCH, entries);
    const yo = entries[0], otro = entries[1];
    const leafMia = merkle.leafHash(EPOCH, yo.wallet, yo.amountRaw);
    assert.ok(!merkle.verifyProof(t.proofFor(otro.wallet), t.root, leafMia));
});

test('subirse la cantidad rompe la prueba', () => {
    const entries = ronda(10);
    const t = merkle.buildTree(EPOCH, entries);
    const e = entries[3];
    const inflada = merkle.leafHash(EPOCH, e.wallet, e.amountRaw * 1000n);
    assert.ok(!merkle.verifyProof(t.proofFor(e.wallet), t.root, inflada));
});

test('la epoca va dentro de la hoja: una prueba no se reutiliza en otra ronda', () => {
    const entries = ronda(10);
    const t = merkle.buildTree(EPOCH, entries);
    const e = entries[2];
    const otraEpoca = merkle.leafHash(EPOCH + 1, e.wallet, e.amountRaw);
    assert.ok(!merkle.verifyProof(t.proofFor(e.wallet), t.root, otraEpoca));
    // Y la raiz de la misma lista en otra epoca es distinta.
    assert.notEqual(merkle.buildTree(EPOCH + 1, entries).rootHex, t.rootHex);
});

test('cambiar un solo byte de la prueba la invalida', () => {
    const entries = ronda(8);
    const t = merkle.buildTree(EPOCH, entries);
    const e = entries[5];
    const proof = t.proofFor(e.wallet).map(b => Buffer.from(b));
    proof[0][0] ^= 0xff;
    const leaf = merkle.leafHash(EPOCH, e.wallet, e.amountRaw);
    assert.ok(!merkle.verifyProof(proof, t.root, leaf));
});

test('un ganador suelto: prueba vacia y raiz = hoja', () => {
    const entries = ronda(1);
    const t = merkle.buildTree(EPOCH, entries);
    assert.equal(t.proofFor(entries[0].wallet).length, 0);
    const leaf = merkle.leafHash(EPOCH, entries[0].wallet, entries[0].amountRaw);
    assert.equal(t.rootHex, leaf.toString('hex'));
});

test('numeros impares de ganadores (el nodo suelto sube de nivel)', () => {
    for (const n of [3, 5, 7, 9, 11, 13, 17, 33]) {
        const entries = ronda(n);
        const t = merkle.buildTree(EPOCH, entries);
        for (const e of entries) {
            const leaf = merkle.leafHash(EPOCH, e.wallet, e.amountRaw);
            assert.ok(merkle.verifyProof(t.proofFor(e.wallet), t.root, leaf), `n=${n} falla ${e.wallet}`);
        }
    }
});

test('la prueba nunca pasa de 20 niveles (el tope del contrato)', () => {
    const entries = ronda(1000);
    const t = merkle.buildTree(EPOCH, entries);
    for (const e of entries.slice(0, 50)) assert.ok(t.proofFor(e.wallet).length <= 20);
});

test('hoja y nodo viven en dominios distintos: un nodo no puede pasar por hoja', () => {
    // Sin los prefijos 0x00/0x01 se podria coger un nodo interno de 64 bytes y
    // presentarlo como si fuera la concatenacion de una hoja legitima.
    const a = Buffer.alloc(32, 1), b = Buffer.alloc(32, 2);
    const comoNodo = merkle.nodeHash(a, b);
    const crypto = require('node:crypto');
    const sinPrefijo = crypto.createHash('sha256').update(Buffer.concat([a, b])).digest();
    assert.notEqual(comoNodo.toString('hex'), sinPrefijo.toString('hex'));
});

test('una wallet repetida revienta en vez de colarse', () => {
    const w = wallets(1)[0];
    assert.throws(() => merkle.buildTree(EPOCH, [
        { wallet: w, amountRaw: 100n },
        { wallet: w, amountRaw: 200n },
    ]), /repetida/);
});

test('cantidades a cero o negativas no entran en el arbol', () => {
    const w = wallets(2);
    assert.throws(() => merkle.buildTree(EPOCH, [{ wallet: w[0], amountRaw: 0n }]), /no positiva/);
    assert.throws(() => merkle.buildTree(EPOCH, [{ wallet: w[0], amountRaw: -5n }]), /no positiva/);
});

test('buildRound: el total cuadra con la suma y sale ordenado por ranking', () => {
    const entries = ronda(10);
    const r = merkle.buildRound(EPOCH, entries);
    const suma = entries.reduce((s, e) => s + e.amountRaw, 0n);
    assert.equal(r.total, suma.toString());
    assert.equal(r.winners, 10);
    assert.deepEqual(r.entries.map(e => e.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Y cada prueba publicada valida contra la raiz publicada.
    const root = Buffer.from(r.root, 'hex');
    for (const fila of r.entries) {
        const proof = fila.proof.map(h => Buffer.from(h, 'hex'));
        const leaf = merkle.leafHash(EPOCH, fila.wallet, BigInt(fila.amountRaw));
        assert.ok(merkle.verifyProof(proof, root, leaf), 'prueba publicada invalida para ' + fila.wallet);
    }
});

test('un tercero puede reconstruir la raiz solo con {wallet, amount} del JSON', () => {
    // Esto es la auditoria publica: bajarse el JSON, quitarle las pruebas, rehacer el
    // arbol y comprobar que da la misma raiz que hay on-chain. Si no cuadra, la lista
    // publicada no es la que se pago.
    const entries = ronda(10);
    const publicado = merkle.buildRound(EPOCH, entries);
    const soloDatos = publicado.entries.map(e => ({ wallet: e.wallet, amountRaw: BigInt(e.amountRaw) }));
    assert.equal(merkle.buildTree(EPOCH, soloDatos).rootHex, publicado.root);
});
