/*
 * Comprueba que los vectores de prueba compartidos con el programa de Rust siguen
 * cuadrando con server/merkle.js.
 *
 * La otra mitad de este test vive en programs/pill-treasury/src/lib.rs y se ejecuta
 * con `cargo test`. Entre los dos cierran el unico fallo que puede tumbar todos los
 * premios sin que salte nada: que el arbol que construye el servidor y el que
 * verifica el contrato dejen de ser el mismo arbol.
 *
 * Si esto falla, merkle.js ha cambiado. Regenerar los vectores
 * (`node scripts/gen-merkle-vectors.js`) es la respuesta correcta SOLO si el cambio
 * era intencionado — y entonces hay que volver a pasar `cargo test`, porque el
 * contrato desplegado sigue verificando a la manera vieja.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const merkle = require('../server/merkle.js');

const VECTORES = JSON.parse(fs.readFileSync(path.join(__dirname, 'merkle-vectors.json'), 'utf8'));

test('hay vectores, y algunos son de los que tienen que fallar', () => {
    // Una tanda solo de casos validos no probaria nada: verify_proof podria
    // devolver true siempre y pasar igual.
    assert.ok(VECTORES.length >= 20, 'muy pocos vectores');
    assert.ok(VECTORES.some(v => v.valid), 'no hay ni un caso valido');
    assert.ok(VECTORES.filter(v => !v.valid).length >= 5, 'faltan casos que deban fallar');
});

test('cada vector da el mismo resultado con el merkle.js de hoy', () => {
    for (const v of VECTORES) {
        const leaf = merkle.leafHash(v.epoch, v.winner, BigInt(v.amount));
        const proof = v.proof.map(h => Buffer.from(h, 'hex'));
        const ok = merkle.verifyProof(proof, Buffer.from(v.root, 'hex'), leaf);
        assert.equal(ok, v.valid, `"${v.nombre}" deberia dar ${v.valid}`);
    }
});

test('el fichero de Rust generado lleva los mismos vectores', () => {
    // Si alguien regenera el JSON y se olvida del .rs (o al reves), el contrato
    // acabaria verificando contra un arbol distinto del que se le testeo.
    const rs = fs.readFileSync(path.join(__dirname, '..', 'programs', 'pill-treasury', 'src', 'test_vectors.rs'), 'utf8');
    // Solo las instancias indentadas: `pub struct Vector {` no es un vector.
    const enRust = (rs.match(/^ {4}Vector \{$/gm) || []).length;
    assert.equal(enRust, VECTORES.length, 'el .rs y el .json tienen distinto numero de vectores: regenera los dos');

    // Y que las raices coincidan de verdad, no solo el recuento.
    for (const v of VECTORES) {
        const comoRust = '[' + Array.from(Buffer.from(v.root, 'hex')).join(',') + ']';
        assert.ok(rs.includes(comoRust), `la raiz de "${v.nombre}" no esta en el .rs`);
    }
});
