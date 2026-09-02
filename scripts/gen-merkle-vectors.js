/*
 * Genera vectores de prueba del arbol de Merkle desde el JS, para que los use el
 * test de Rust del programa.
 *
 * POR QUE HACE FALTA. El arbol se construye en dos sitios: server/merkle.js lo monta
 * y programs/pill-treasury lo verifica. Si los dos dejan de dar lo mismo —un byte de
 * orden distinto, un prefijo de dominio cambiado, sha256 en un lado y keccak en el
 * otro— NINGUN claim funciona, y no se descubre hasta que un jugador intenta cobrar
 * y le rebota `InvalidProof`. No hay ningun test que ejecute los dos a la vez porque
 * uno corre en Node y el otro on-chain.
 *
 * Esto lo cierra: el JS genera los vectores (con sus casos que deben FALLAR), Rust
 * los verifica en `cargo test`, y tests/merkle-vectors.test.js comprueba que los
 * vectores siguen cuadrando con el JS de hoy. Si alguien toca una de las dos
 * implementaciones y no la otra, salta uno de los dos lados.
 *
 *   node scripts/gen-merkle-vectors.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Keypair, PublicKey } = require('@solana/web3.js');
const merkle = require('../server/merkle.js');

// Semilla fija: los vectores tienen que ser los mismos en cada ejecucion o el
// fichero generado cambia en cada commit sin que haya cambiado nada.
function walletDeterminista(i) {
    const semilla = Buffer.alloc(32);
    semilla.write('pillwars-merkle-vector-' + i);
    return Keypair.fromSeed(semilla).publicKey.toBase58();
}

const EPOCH = 20334;
const N = 10;
const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];
const PRESUPUESTO = 1_000_000_000n;   // 1000 PILL con 6 decimales

const entries = Array.from({ length: N }, (_, i) => ({
    wallet: walletDeterminista(i),
    amountRaw: (PRESUPUESTO * BigInt(Math.round(PESOS[i] * 10))) / 1000n,
    rank: i + 1,
}));

const tree = merkle.buildTree(EPOCH, entries);
const hex = (b) => Buffer.from(b).toString('hex');
const rustBytes = (b) => '[' + Array.from(Buffer.from(b)).join(',') + ']';

const casos = [];

// 1) Los diez ganadores, todos validos.
for (const e of entries) {
    casos.push({
        nombre: 'ganador #' + e.rank,
        epoch: EPOCH,
        winner: e.wallet,
        amount: e.amountRaw,
        proof: tree.proofFor(e.wallet),
        root: tree.root,
        valid: true,
    });
}

// 2) Los que TIENEN que fallar. Son los que de verdad prueban algo: que la
//    verificacion rechaza lo que no estaba en la lista.
casos.push({
    nombre: 'la prueba del #2 usada por el #1',
    epoch: EPOCH, winner: entries[0].wallet, amount: entries[0].amountRaw,
    proof: tree.proofFor(entries[1].wallet), root: tree.root, valid: false,
});
casos.push({
    nombre: 'el #3 pidiendo el doble de lo que le toca',
    epoch: EPOCH, winner: entries[2].wallet, amount: entries[2].amountRaw * 2n,
    proof: tree.proofFor(entries[2].wallet), root: tree.root, valid: false,
});
casos.push({
    nombre: 'la prueba del #4 en otra epoca',
    epoch: EPOCH + 1, winner: entries[3].wallet, amount: entries[3].amountRaw,
    proof: tree.proofFor(entries[3].wallet), root: tree.root, valid: false,
});
casos.push({
    nombre: 'una wallet que no estaba en la lista',
    epoch: EPOCH, winner: walletDeterminista(999), amount: entries[4].amountRaw,
    proof: tree.proofFor(entries[4].wallet), root: tree.root, valid: false,
});
casos.push({
    nombre: 'un byte cambiado en la prueba',
    epoch: EPOCH, winner: entries[5].wallet, amount: entries[5].amountRaw,
    proof: tree.proofFor(entries[5].wallet).map((n, i) => {
        if (i !== 0) return n;
        const c = Buffer.from(n); c[0] ^= 0xff; return c;
    }),
    root: tree.root, valid: false,
});
casos.push({
    nombre: 'prueba vacia contra un arbol de diez hojas',
    epoch: EPOCH, winner: entries[6].wallet, amount: entries[6].amountRaw,
    proof: [], root: tree.root, valid: false,
});

// 3) Un arbol de una sola hoja: la raiz es la hoja y la prueba va vacia.
const solo = merkle.buildTree(EPOCH, [{ wallet: entries[0].wallet, amountRaw: 123456n, rank: 1 }]);
casos.push({
    nombre: 'ganador unico (raiz = hoja, prueba vacia)',
    epoch: EPOCH, winner: entries[0].wallet, amount: 123456n,
    proof: [], root: solo.root, valid: true,
});

// 4) Numero impar de hojas: el nodo suelto sube de nivel sin hashearse, y es donde
//    dos implementaciones se separan mas facil.
const impares = Array.from({ length: 7 }, (_, i) => ({ wallet: walletDeterminista(100 + i), amountRaw: BigInt((i + 1) * 1000), rank: i + 1 }));
const arbolImpar = merkle.buildTree(EPOCH, impares);
for (const e of impares) {
    casos.push({
        nombre: 'arbol de 7 hojas, ' + e.rank,
        epoch: EPOCH, winner: e.wallet, amount: e.amountRaw,
        proof: arbolImpar.proofFor(e.wallet), root: arbolImpar.root, valid: true,
    });
}

/* ===================== SALIDA ===================== */

const filas = casos.map(c => `    // ${c.nombre}
    Vector {
        epoch: ${c.epoch},
        winner: ${rustBytes(new PublicKey(c.winner).toBuffer())},
        amount: ${c.amount},
        proof: &[${c.proof.map(p => rustBytes(p)).join(', ')}],
        root: ${rustBytes(c.root)},
        valid: ${c.valid},
    },`).join('\n');

const rs = `//! Vectores de prueba del arbol de Merkle. GENERADO — no editar a mano.
//!
//! Los produce \`node scripts/gen-merkle-vectors.js\` desde server/merkle.js, que es
//! quien construye los arboles de verdad. Sirven para una sola cosa, pero es la que
//! puede tumbar todos los premios sin avisar: comprobar que la verificacion de este
//! programa acepta exactamente lo mismo que el servidor genera, y rechaza lo demas.
//!
//! Si estos tests fallan, NO se toca este fichero: es que las dos implementaciones
//! del arbol se han separado, y hay que averiguar cual de las dos se movio.

#[allow(dead_code)]
pub struct Vector {
    pub epoch: u64,
    pub winner: [u8; 32],
    pub amount: u64,
    pub proof: &'static [[u8; 32]],
    pub root: [u8; 32],
    pub valid: bool,
}

#[allow(dead_code)]
pub const VECTORS: &[Vector] = &[
${filas}
];
`;

const destino = path.join(__dirname, '..', 'programs', 'pill-treasury', 'src', 'test_vectors.rs');
fs.writeFileSync(destino, rs);

// El mismo material en JSON, para que el test de JS compruebe que los vectores
// siguen cuadrando con merkle.js sin tener que parsear Rust.
const json = casos.map(c => ({
    nombre: c.nombre, epoch: c.epoch, winner: c.winner, amount: c.amount.toString(),
    proof: c.proof.map(hex), root: hex(c.root), valid: c.valid,
}));
fs.writeFileSync(path.join(__dirname, '..', 'tests', 'merkle-vectors.json'), JSON.stringify(json, null, 1));

console.log(`${casos.length} vectores (${casos.filter(c => c.valid).length} validos, ${casos.filter(c => !c.valid).length} que deben fallar)`);
console.log('  -> programs/pill-treasury/src/test_vectors.rs');
console.log('  -> tests/merkle-vectors.json');
