/*
 * PRUEBA DE RESERVAS Y DE PASIVO — que no pueda mentir sobre lo que os debo.
 *
 * EL PROBLEMA. server/warbalances.json es un fichero de texto. Puedo abrirlo, poner
 * mi wallet a diez millones, guardarlo, y el servidor se lo cree. Y /api/withdraw me
 * lo manda. Hoy nadie lo notaria.
 *
 * Con el contrato desplegado eso deja un rastro, porque el dinero que sacaria es el
 * que respalda a los demas:
 *
 *     custody 1.000.000   obligaciones 1.000.000   ratio 1,00  ok
 *     me doy 500.000  ->  obligaciones 1.500.000   ratio 0,66  se ve
 *     los retiro      ->  custody   500.000        ratio 0,50  se sigue viendo
 *
 * PERO las obligaciones las sumaba yo. Podia darme saldo, retirar, y reportar menos
 * pasivo para que el ratio siguiera dando 1. Un ratio que calcula el sospechoso no
 * prueba nada.
 *
 * LA SOLUCION. Cada cierto tiempo se publica la lista COMPLETA de saldos, su raiz de
 * Merkle y el total, encadenado con el snapshot anterior, y la raiz se ancla en
 * Solana. A partir de ahi:
 *
 *   - No puedo reportar menos pasivo del que hay sin QUITARLE SALDO A ALGUIEN
 *     CONCRETO, que va a mirar su fila y ver que no cuadra.
 *   - No puedo cambiar un snapshot pasado: cambia su hash y el de todos los
 *     siguientes, y las raices viejas ya estan escritas en la cadena.
 *   - Cualquiera suma la lista y la compara con el saldo del PDA de custodia. Si
 *     falta dinero, se ve sin preguntarme.
 *
 * Es lo que se llama proof of liabilities, y es la mitad que se olvidan casi todos:
 * publicar cuanto tienes es facil, lo dificil es demostrar cuanto DEBES.
 *
 * POR QUE LA LISTA ENTERA Y NO SOLO LA RAIZ. Con solo la raiz, cada jugador puede
 * comprobar su fila pero nadie puede comprobar que no falten filas: podria dejar
 * wallets fuera del arbol para bajar el pasivo, y solo lo notaria el excluido. Los
 * saldos ya son publicos uno a uno (/api/warbalance), asi que publicarlos juntos no
 * revela nada nuevo y hace la verificacion trivial.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const merkle = require('./merkle.js');

const BASE = process.env.LB_DIR || __dirname;
const DIR = path.join(BASE, 'reserves');
const STATE_FILE = path.join(BASE, 'reserves-state.json');

const SOLO_LECTURA = process.env.PW_ROLE === 'host';

/** Cada cuanto se publica un snapshot. Una hora es suficiente: lo que importa es que
 *  no haya huecos largos donde el pasivo pueda moverse sin dejar rastro. */
const CADA_MS = (parseInt(process.env.RESERVES_EVERY_MIN, 10) || 60) * 60 * 1000;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

let data = { snapshots: [], siguiente: 0 };
try { data = Object.assign(data, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) {}
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

let dirty = false;
function save() {
    if (!dirty || SOLO_LECTURA) return;
    dirty = false;
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(data)); } catch (e) {}
}

/* ===================== EL SNAPSHOT ===================== */

/** Lo que se hashea. Ordenado por wallet para que no dependa del orden del objeto. */
function canonico(n, filas, total) {
    return JSON.stringify({ n, total, balances: filas.map(f => [f.wallet, f.saldo]) });
}

/*
 * Construye el snapshot del pasivo a partir de los saldos internos.
 *
 * Los saldos a cero se dejan fuera: no son deuda, y meterlos solo engordaria la lista
 * con wallets que pasaron por aqui una vez. El arbol de Merkle es el MISMO que el de
 * los premios (server/merkle.js) — misma construccion, misma verificacion, un solo
 * algoritmo que auditar en vez de dos.
 */
function construye(balances, n) {
    const filas = Object.entries(balances || {})
        .map(([wallet, saldo]) => ({ wallet, saldo: Math.floor(Number(saldo) || 0) }))
        .filter(f => f.saldo > 0)
        .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));

    const total = filas.reduce((s, f) => s + f.saldo, 0);
    // El arbol necesita al menos una hoja; un servidor sin saldos publica un snapshot
    // vacio igual, porque "no debo nada" tambien es una afirmacion que hay que anclar.
    const arbol = filas.length
        ? merkle.buildTree(n, filas.map(f => ({ wallet: f.wallet, amountRaw: BigInt(f.saldo) })))
        : null;

    return { filas, total, root: arbol ? arbol.rootHex : GENESIS, arbol };
}

/*
 * Publica un snapshot y ancla su hash en la cadena.
 *
 * Si la transaccion falla, el snapshot NO se guarda: prefiero un hueco a una lista
 * "publicada" que nadie puede comprobar contra la cadena. En el siguiente intento se
 * publica con los saldos de ese momento.
 */
async function publica(balances, solana, log) {
    if (SOLO_LECTURA) return null;
    const n = data.siguiente;
    const { filas, total, root, arbol } = construye(balances, n);
    const prevHash = data.snapshots.length ? data.snapshots[data.snapshots.length - 1].hash : GENESIS;
    const hash = sha256hex(prevHash + canonico(n, filas, total));

    let sig = null;
    if (solana && solana.canWithdraw()) {
        try {
            const { PublicKey, TransactionInstruction } = require('@solana/web3.js');
            sig = await solana.sendInstructions([new TransactionInstruction({
                programId: new PublicKey(MEMO_PROGRAM),
                keys: [],
                data: Buffer.from(`PWR${n}:${hash}`, 'utf8'),
            })]);
        } catch (e) {
            if (log) log(`Snapshot de reservas ${n} NO anclado: ${e.message}`);
            return null;
        }
    }

    const publico = {
        n, prevHash, hash, root, total,
        wallets: filas.length,
        at: new Date().toISOString(),
        sig,
        // La prueba de cada wallet va incluida: asi comprobar tu saldo es abrir el
        // fichero y no montar un arbol de Merkle a mano.
        balances: filas.map(f => ({
            wallet: f.wallet,
            saldo: f.saldo,
            proof: arbol ? arbol.proofFor(f.wallet).map(b => b.toString('hex')) : [],
        })),
    };
    try { fs.writeFileSync(path.join(DIR, n + '.json'), JSON.stringify(publico, null, 1)); } catch (e) {}

    data.snapshots.push({ n, prevHash, hash, root, total, wallets: filas.length, at: publico.at, sig });
    data.siguiente = n + 1;
    dirty = true; save();
    if (log) log(`Reservas: snapshot ${n} — ${filas.length} wallets, pasivo ${total} PILL${sig ? ' — ' + sig : ' (sin cadena)'}`);
    return publico;
}

function arranca(getBalances, solana, log) {
    setInterval(() => { publica(getBalances(), solana, log).catch(() => {}); }, CADA_MS).unref();
    setTimeout(() => { publica(getBalances(), solana, log).catch(() => {}); }, 20000).unref();
}

/* ===================== LECTURA Y VERIFICACION ===================== */

function snapshot(n) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, Number(n) + '.json'), 'utf8')); } catch (e) { return null; }
}
function ultimo() { return data.snapshots.length ? data.snapshots[data.snapshots.length - 1] : null; }
function cadena(limite = 200) { return data.snapshots.slice(-limite); }

/** La fila de una wallet en el ultimo snapshot, con su prueba. Es lo que un jugador
 *  mira para comprobar que su saldo esta bien contado en lo que publico. */
function pruebaDe(wallet) {
    const u = ultimo();
    if (!u) return null;
    const snap = snapshot(u.n);
    if (!snap) return null;
    const fila = snap.balances.find(b => b.wallet === wallet);
    return {
        snapshot: u.n, root: snap.root, total: snap.total, at: snap.at, sig: snap.sig,
        wallet, saldo: fila ? fila.saldo : 0,
        proof: fila ? fila.proof : null,
        incluida: !!fila,
    };
}

/*
 * Rehace la cadena entera desde los ficheros publicados. Detecta tanto un snapshot
 * reescrito como una raiz que no sale de la lista que la acompana.
 */
function verificar(limite = 200) {
    const fallos = [];
    const trozo = data.snapshots.slice(-limite);
    let prev = trozo.length && data.snapshots.length > trozo.length
        ? data.snapshots[data.snapshots.length - trozo.length - 1].hash
        : GENESIS;
    for (const s of trozo) {
        const pub = snapshot(s.n);
        if (!pub) { fallos.push({ n: s.n, error: 'falta el fichero del snapshot' }); prev = s.hash; continue; }
        if (pub.prevHash !== prev) fallos.push({ n: s.n, error: 'no encadena con el anterior' });

        const filas = pub.balances.map(b => ({ wallet: b.wallet, saldo: b.saldo }));
        const total = filas.reduce((a, f) => a + f.saldo, 0);
        if (total !== pub.total) fallos.push({ n: s.n, error: 'el total no es la suma de la lista' });
        if (sha256hex(prev + canonico(s.n, filas, total)) !== s.hash) fallos.push({ n: s.n, error: 'el hash no sale de lo que publica' });

        // Y la raiz tiene que salir de la lista, no ser un numero puesto a mano.
        if (filas.length) {
            const root = merkle.buildTree(s.n, filas.map(f => ({ wallet: f.wallet, amountRaw: BigInt(f.saldo) }))).rootHex;
            if (root !== pub.root) fallos.push({ n: s.n, error: 'la raiz de Merkle no sale de la lista publicada' });
        }
        prev = s.hash;
    }
    return { ok: fallos.length === 0, snapshots: trozo.length, ultimoHash: prev, fallos };
}

module.exports = {
    publica, arranca, save, construye,
    snapshot, ultimo, cadena, pruebaDe, verificar,
    _canonico: canonico, GENESIS, MEMO_PROGRAM,
};
