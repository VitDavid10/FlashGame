/*
 * Arbol de Merkle de una ronda de premios. Tiene que dar EXACTAMENTE lo mismo que
 * `verify_proof` del programa (programs/pill-treasury/src/lib.rs) o los claims no
 * validan. Las tres reglas que lo definen:
 *
 *   hoja  = sha256( 0x00 || epoch_u64_le || wallet_32b || amount_u64_le )
 *   nodo  = sha256( 0x01 || min(a,b) || max(a,b) )        <- pares ORDENADOS
 *   impar = el ultimo nodo de un nivel impar sube al siguiente sin hashear
 *
 * POR QUE PREFIJOS 0x00 / 0x01. Sin ellos, un nodo interno (64 bytes de hash) podria
 * hacerse pasar por una hoja y alguien fabricaria una prueba de un premio que nunca
 * estuvo en la lista. Con dominios separados, una hoja no puede ser nunca un nodo.
 *
 * POR QUE PARES ORDENADOS. La prueba no necesita decir si cada hermano va a izquierda
 * o derecha: se ordenan los dos hashes antes de combinarlos. Menos bytes en la
 * transaccion y una implementacion menos que pueda desviarse de la otra.
 *
 * POR QUE SE ORDENAN LAS ENTRADAS POR WALLET. La raiz depende del orden de las hojas.
 * Si dependiera del orden en que el servidor las escribio, dos personas con la MISMA
 * lista sacarian raices distintas y la verificacion publica no valdria para nada.
 * Ordenando por direccion, la lista {wallet, amount} determina la raiz y punto.
 */
'use strict';

const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

const sha256 = (...bufs) => crypto.createHash('sha256').update(Buffer.concat(bufs)).digest();

function u64le(n) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
}

/** Hoja de un ganador. `amount` va en unidades RAW del mint, no en PILL. */
function leafHash(epoch, wallet, amountRaw) {
    return sha256(LEAF_PREFIX, u64le(epoch), new PublicKey(wallet).toBuffer(), u64le(amountRaw));
}

function nodeHash(a, b) {
    return Buffer.compare(a, b) <= 0 ? sha256(NODE_PREFIX, a, b) : sha256(NODE_PREFIX, b, a);
}

/*
 * Construye el arbol de una ronda.
 *
 *   entries: [{ wallet, amountRaw }]
 *   -> { root: Buffer(32), rootHex, total: BigInt, leaves, proofFor(wallet) }
 *
 * Una wallet repetida es un error, no algo que fusionar: si la misma direccion sale
 * dos veces solo podria cobrar una (el recibo on-chain es un PDA por wallet y ronda),
 * asi que la segunda hoja seria dinero reservado que nadie puede sacar. Mejor que
 * reviente aqui, donde se ve, que descuadrar la tesoreria en silencio.
 */
function buildTree(epoch, entries) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('merkle: lista vacia');

    const vistas = new Set();
    for (const e of entries) {
        if (vistas.has(e.wallet)) throw new Error('merkle: wallet repetida ' + e.wallet);
        vistas.add(e.wallet);
        if (!(BigInt(e.amountRaw) > 0n)) throw new Error('merkle: cantidad no positiva para ' + e.wallet);
    }

    const orden = [...entries].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
    const hojas = orden.map(e => leafHash(epoch, e.wallet, e.amountRaw));

    // Se guardan todos los niveles para poder sacar la prueba de cualquier hoja sin
    // reconstruir el arbol una vez por ganador.
    const niveles = [hojas];
    while (niveles[niveles.length - 1].length > 1) {
        const abajo = niveles[niveles.length - 1];
        const arriba = [];
        for (let i = 0; i < abajo.length; i += 2) {
            arriba.push(i + 1 < abajo.length ? nodeHash(abajo[i], abajo[i + 1]) : abajo[i]);
        }
        niveles.push(arriba);
    }
    const root = niveles[niveles.length - 1][0];

    const indiceDe = new Map(orden.map((e, i) => [e.wallet, i]));

    function proofFor(wallet) {
        let idx = indiceDe.get(wallet);
        if (idx === undefined) return null;
        const prueba = [];
        for (let n = 0; n < niveles.length - 1; n++) {
            const nivel = niveles[n];
            const hermano = idx % 2 === 0 ? idx + 1 : idx - 1;
            // Sin hermano = nodo impar promocionado: no aporta nada a la prueba.
            if (hermano < nivel.length) prueba.push(nivel[hermano]);
            idx = Math.floor(idx / 2);
        }
        return prueba;
    }

    return {
        root,
        rootHex: root.toString('hex'),
        total: orden.reduce((s, e) => s + BigInt(e.amountRaw), 0n),
        leaves: orden.length,
        entries: orden,
        proofFor,
    };
}

/** La misma comprobacion que hace el contrato, para poder validar antes de publicar. */
function verifyProof(proof, root, leaf) {
    let acc = leaf;
    for (const nodo of proof) acc = nodeHash(acc, nodo);
    return Buffer.compare(acc, root) === 0;
}

/*
 * Ronda completa lista para publicar y para servir por HTTP.
 *
 * Devuelve el JSON publico tal cual se sirve en /api/rewards/<epoch>.json: lleva la
 * prueba de cada ganador ya calculada, para que reclamar no exija que el cliente
 * sepa construir arboles de Merkle. Y lleva la lista entera aunque el jugador solo
 * necesite su fila, porque el objetivo de publicarla es que se pueda AUDITAR: con la
 * lista completa cualquiera recalcula la raiz y la compara con la que hay on-chain.
 */
function buildRound(epoch, entries) {
    const tree = buildTree(epoch, entries);
    // Se publican por RANKING, no por el orden alfabetico con el que se hashea: el
    // JSON lo lee gente, y "quien quedo primero" es justo lo que se va a contrastar
    // con el leaderboard del dia. El orden de las hojas es un detalle interno.
    const filas = tree.entries
        .map(e => ({
            rank: e.rank != null ? e.rank : null,
            wallet: e.wallet,
            amountRaw: String(e.amountRaw),
            name: e.name || null,
            score: e.score != null ? e.score : null,
            proof: tree.proofFor(e.wallet).map(b => b.toString('hex')),
        }))
        .sort((a, b) => (a.rank || 999) - (b.rank || 999));
    return {
        epoch,
        root: tree.rootHex,
        total: tree.total.toString(),
        winners: tree.leaves,
        entries: filas,
    };
}

module.exports = { leafHash, nodeHash, buildTree, buildRound, verifyProof, LEAF_PREFIX, NODE_PREFIX };
