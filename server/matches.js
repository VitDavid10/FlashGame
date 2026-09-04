/*
 * RECIBOS DE PARTIDA — anclar en la cadena lo que pasó, cuando pasó.
 *
 * El leaderboard diario decide quién cobra de la tesorería, y lo escribe el
 * servidor. La cadena de hashes de leaderboard.js impide reescribirlo DESPUÉS, pero
 * no impide escribir mentiras la primera vez: nada me para de anotar hoy que mi
 * wallet hizo 500 kills.
 *
 * Esto tapa un trozo concreto de ese agujero. Al acabar cada partida se guarda un
 * recibo con lo que pasó, y cada pocos minutos se ancla en Solana el hash de un lote
 * de recibos. A partir de ahí:
 *
 *   - NO SE PUEDE INVENTAR EL PASADO. Las partidas de ayer tienen txs de ayer. Si
 *     mañana quiero un historial de cuarenta partidas de anteayer, no lo tengo: las
 *     transacciones de anteayer no existen y las que mande hoy llevan la fecha de hoy.
 *     Fabricar un top 10 deja de ser un bucle sobre un JSON y pasa a exigir semanas
 *     de transacciones a horas creíbles.
 *   - NO SE PUEDE CAMBIAR UNA PARTIDA YA ANCLADA. Cambiar una kill cambia el hash del
 *     recibo, el del lote y el de todos los lotes siguientes.
 *   - NO SE PUEDE METER A UN JUGADOR QUE NO JUGÓ. El recibo lleva la FIRMA con la que
 *     cada jugador pidió entrar a esa sala ("PillWars enter <sala> paying <fee> PILL
 *     @ <ts>", ver authorizeEntry en index.js). Esa firma la hizo su wallet; yo no la
 *     puedo fabricar sin su clave.
 *
 * LO QUE SIGUE SIN TAPAR, y hay que decirlo: partidas entre wallets mías. Nada
 * distingue criptográficamente mi wallet de la de otro. Contra eso está la métrica de
 * oponentes distintos (ver oponentesDe): diez wallets que solo se cruzan entre ellas
 * forman un cluster cerrado, y eso se ve en una tabla.
 *
 * POR QUÉ EN LOTES Y NO UNA TX POR PARTIDA. Una tx cuesta 5.000 lamports, así que 250
 * partidas al día serían 0,00125 SOL — asumible, pero son 250 firmas y 250 esperas de
 * confirmación en un proceso que además está corriendo el juego. Un lote por minuto
 * ancla igual de fino para lo que importa (nadie puede fabricar el pasado) y deja el
 * servidor en paz.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.LB_DIR || __dirname;
const DIR = path.join(BASE, 'matches');
const BATCH_DIR = path.join(BASE, 'matches-batch');
const STATE_FILE = path.join(BASE, 'matches-state.json');

// Los hosts no escriben: es del Director, como el resto de la contabilidad.
const SOLO_LECTURA = process.env.PW_ROLE === 'host';

/** Cada cuánto se cierra un lote y se ancla. Un minuto es fino de sobra. */
const LOTE_CADA_MS = (parseInt(process.env.MATCH_BATCH_MIN, 10) || 1) * 60 * 1000;
/** Programa Memo de Solana: el sitio estándar para escribir 32 bytes sin contrato propio. */
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

/* ===================== ESTADO ===================== */

// pendientes: recibos aún sin anclar. lotes: cadena de lotes ya cerrados.
let data = { pendientes: [], lotes: [], siguienteLote: 0, seq: 0 };
try { data = Object.assign(data, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) {}
try { fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(BATCH_DIR, { recursive: true }); } catch (e) {}

let dirty = false;
function save() {
    if (!dirty || SOLO_LECTURA) return;
    dirty = false;
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(data)); } catch (e) {}
}

/* ===================== EL RECIBO ===================== */

/*
 * JSON canónico del recibo: claves en orden fijo, jugadores ordenados por wallet (o
 * por nombre si no la hay). Es lo que se hashea, así que dos personas con los mismos
 * datos tienen que sacar el mismo hash — si dependiera del orden en que el servidor
 * recorrió un Map, la verificación no valdría para nada.
 *
 * La firma de entrada NO entra en el hash: es un dato de respaldo que se publica al
 * lado. Meterla dentro obligaría a tenerla para poder verificar, y las partidas
 * gratis no la tienen.
 */
function canonico(m) {
    return JSON.stringify({
        seq: m.seq,
        room: m.room,
        mode: m.mode,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        entryFee: m.entryFee,
        pot: m.pot,
        players: m.players
            .slice()
            .sort((a, b) => ((a.wallet || a.name || '') < (b.wallet || b.name || '') ? -1 : 1))
            .map(p => ({ wallet: p.wallet, name: p.name, kills: p.kills, peak: p.peak, paid: p.paid })),
    });
}

/*
 * Registra una partida terminada. Devuelve el recibo con su hash, o null si no hay
 * nada que anclar.
 *
 * Las partidas SIN NADIE CON WALLET no se anclan: no pueden dar premios de tesorería
 * (el leaderboard va por wallet), así que anclarlas sería pagar gas por ruido. Las
 * partidas de testers tampoco, por lo mismo.
 */
function registra({ room, mode, startedAt, endedAt, entryFee, pot, players }) {
    const conWallet = (players || []).filter(p => p.wallet && !p.isTester);
    if (conWallet.length === 0) return null;

    const m = {
        // Numero de orden. Va DENTRO del hash porque sin el, dos partidas con
        // exactamente el mismo contenido (mismos jugadores, mismos resultados, mismo
        // milisegundo) darian el mismo id y una borraria a la otra al escribirse. Es
        // raro, pero "raro" en un registro que decide premios significa que un dia
        // desaparece una partida y nadie sabe por que.
        seq: ++data.seq,
        room, mode,
        startedAt: startedAt || null,
        endedAt: endedAt || Date.now(),
        entryFee: entryFee | 0,
        pot: pot | 0,
        players: (players || []).map(p => ({
            wallet: p.wallet || null,
            name: p.name || null,
            kills: p.kills | 0,
            peak: p.peak | 0,
            paid: !!p.paid,
            isTester: !!p.isTester,
            entry: p.entry || null,   // firma de entrada; fuera del hash, ver canonico()
        })),
    };
    m.hash = sha256hex(canonico(m));
    // El id es una etiqueta corta para las URLs; la verdad esta en el hash completo.
    m.id = m.hash.slice(0, 16);

    if (!SOLO_LECTURA) {
        try { fs.writeFileSync(path.join(DIR, m.id + '.json'), JSON.stringify(m, null, 1)); } catch (e) {}
        data.pendientes.push({ id: m.id, hash: m.hash, endedAt: m.endedAt, room: m.room });
        dirty = true;
    }
    return m;
}

/* ===================== LOTES ===================== */

/** Contenido canónico de un lote: los recibos que lleva, en el orden en que entraron. */
function canonicoLote(n, recibos) {
    return JSON.stringify({ batch: n, matches: recibos.map(r => ({ id: r.id, hash: r.hash })) });
}

/*
 * Cierra el lote pendiente y lo ancla en la cadena con un memo.
 *
 * Los lotes van encadenados igual que los días del leaderboard:
 *   hash_lote_N = sha256(hash_lote_{N-1} || contenido)
 * Insertar un lote en el pasado obliga a rehacer todos los siguientes, y sus memos
 * ya están escritos en Solana con su fecha.
 *
 * Si la transacción falla, el lote NO se cierra: los recibos siguen pendientes y se
 * anclan en el siguiente intento. Vale más un lote tarde que un hueco en la cadena.
 */
async function anclaLote(solana, log) {
    if (SOLO_LECTURA || data.pendientes.length === 0) return null;

    const recibos = data.pendientes.slice();
    const n = data.siguienteLote;
    const prevHash = data.lotes.length ? data.lotes[data.lotes.length - 1].hash : GENESIS;
    const cuerpo = canonicoLote(n, recibos);
    const hash = sha256hex(prevHash + cuerpo);

    let sig = null;
    if (solana && solana.canWithdraw()) {
        try {
            const { PublicKey, TransactionInstruction } = require('@solana/web3.js');
            const memo = `PW${n}:${hash}`;
            sig = await solana.sendInstructions([new TransactionInstruction({
                programId: new PublicKey(MEMO_PROGRAM),
                keys: [],
                data: Buffer.from(memo, 'utf8'),
            })]);
        } catch (e) {
            if (log) log(`Lote de partidas ${n} NO anclado (${recibos.length} recibos siguen pendientes): ${e.message}`);
            return null;
        }
    } else if (process.env.MATCH_ANCHOR_REQUIRED === '1') {
        // Con esto puesto, sin cadena no se cierran lotes: se prefiere acumular a
        // tener lotes "cerrados" que nadie puede comprobar.
        return null;
    }

    const lote = { n, prevHash, hash, sig, closedAt: new Date().toISOString(), matches: recibos.length };
    try { fs.writeFileSync(path.join(BATCH_DIR, n + '.json'), JSON.stringify(Object.assign({}, lote, { matches: recibos }), null, 1)); } catch (e) {}

    data.lotes.push(lote);
    data.siguienteLote = n + 1;
    data.pendientes = data.pendientes.slice(recibos.length);
    dirty = true; save();

    // El recibo de cada partida apunta a su lote, para poder enlazarlo desde la web.
    for (const r of recibos) {
        try {
            const f = path.join(DIR, r.id + '.json');
            const m = JSON.parse(fs.readFileSync(f, 'utf8'));
            m.batch = n; m.batchSig = sig;
            fs.writeFileSync(f, JSON.stringify(m, null, 1));
        } catch (e) {}
    }

    if (log) log(`Lote de partidas ${n} anclado: ${recibos.length} recibos${sig ? ' — ' + sig : ' (sin cadena)'}`);
    return lote;
}

function arranca(solana, log) {
    setInterval(() => { anclaLote(solana, log).catch(() => {}); }, LOTE_CADA_MS).unref();
}

/* ===================== LECTURA Y VERIFICACION ===================== */

function partida(id) {
    if (!/^[0-9a-f]{16}$/.test(String(id || ''))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')); } catch (e) { return null; }
}
function lote(n) {
    if (!Number.isFinite(Number(n))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(BATCH_DIR, Number(n) + '.json'), 'utf8')); } catch (e) { return null; }
}
function cadena(limite = 200) { return data.lotes.slice(-limite); }
function pendientes() { return data.pendientes.length; }

/*
 * Recorre la cadena de lotes rehaciendo cada eslabón desde los recibos publicados.
 * Es la comprobación que puede repetir cualquiera con los ficheros públicos, y la que
 * delataría un recibo cambiado después de anclarlo.
 */
function verificar(limite = 200) {
    const fallos = [];
    const trozo = data.lotes.slice(-limite);
    let prev = trozo.length && data.lotes.length > trozo.length
        ? data.lotes[data.lotes.length - trozo.length - 1].hash
        : GENESIS;
    for (const l of trozo) {
        const pub = lote(l.n);
        if (!pub) { fallos.push({ lote: l.n, error: 'falta el fichero del lote' }); prev = l.hash; continue; }
        if (pub.prevHash !== prev) fallos.push({ lote: l.n, error: 'no encadena con el lote anterior' });
        const recalculado = sha256hex(prev + canonicoLote(l.n, pub.matches));
        if (recalculado !== l.hash) fallos.push({ lote: l.n, error: 'el hash no sale de los recibos que publica' });
        // Y cada recibo tiene que seguir dando el hash con el que se ancló.
        for (const r of pub.matches) {
            const m = partida(r.id);
            if (!m) { fallos.push({ lote: l.n, match: r.id, error: 'falta el recibo' }); continue; }
            if (sha256hex(canonico(m)) !== r.hash) fallos.push({ lote: l.n, match: r.id, error: 'the receipt changed after being anchored' });
        }
        prev = l.hash;
    }
    return { ok: fallos.length === 0, lotes: trozo.length, pendientes: data.pendientes.length, ultimoHash: prev, fallos };
}

/* ===================== OPONENTES DISTINTOS ===================== */

/*
 * Con cuántas wallets DISTINTAS se ha cruzado cada una, mirando los recibos.
 *
 * Es lo que hace visible el fraude que ninguna firma puede impedir: si me invento un
 * top 10 con diez wallets mías, esas diez solo juegan entre ellas y forman un cluster
 * cerrado. Un jugador de verdad se cruza con decenas de personas sin proponérselo.
 *
 * `desde` acota la ventana (por defecto los últimos 7 días): un jugador que lleva
 * meses tiene muchos oponentes acumulados, y lo que interesa es si está jugando con
 * gente AHORA.
 */
function oponentesDe(desde) {
    // `desde == null` y no `desde ||`: pasar 0 significa "desde el principio", y con
    // el || se convertia silenciosamente en la ventana por defecto — el filtro se
    // desactivaba sin que nadie se enterara, que es la peor forma de fallar aqui.
    const corte = desde == null ? Date.now() - 7 * 86400e3 : desde;
    const mapa = new Map();   // wallet -> Set(oponentes)
    const partidas = new Map();
    let ficheros = [];
    try { ficheros = fs.readdirSync(DIR); } catch (e) { return mapa; }
    for (const f of ficheros) {
        if (!f.endsWith('.json')) continue;
        let m;
        try { m = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { continue; }
        if (!m || (m.endedAt || 0) < corte) continue;
        const wallets = m.players.map(p => p.wallet).filter(Boolean);
        for (const w of wallets) {
            if (!mapa.has(w)) mapa.set(w, new Set());
            partidas.set(w, (partidas.get(w) || 0) + 1);
            for (const otro of wallets) if (otro !== w) mapa.get(w).add(otro);
        }
    }
    const salida = new Map();
    for (const [w, set] of mapa) salida.set(w, { oponentes: set.size, partidas: partidas.get(w) || 0 });
    return salida;
}

/*
 * Lo que se cobro en entradas dentro de una ventana, en PILL.
 *
 * Es el dato que ata el premio del dia a lo que de verdad se jugo. Sin el, el bote
 * depende de contar wallets — y las wallets son gratis de crear, asi que a quien le
 * salga a cuenta las creara. Las entradas no son gratis: por eso el bote se calcula
 * sobre esto y no sobre cuanta gente aparezca en la lista.
 *
 * Solo cuenta a los que PAGARON (`paid`) y no son testers: un jugador de una sala
 * gratis no ha metido nada al sistema, asi que no puede subir el premio de nadie.
 *
 * Sale de los mismos recibos que se anclan en la cadena por lotes, o sea que
 * cualquiera puede rehacer esta suma desde /api/matches y comprobar que el bote
 * publicado cuadra. No es un numero que yo declare.
 */
function recaudadoEntre(desde, hasta) {
    const ini = desde == null ? 0 : desde;
    const fin = hasta == null ? Date.now() : hasta;
    let total = 0, partidas = 0, entradas = 0;
    let ficheros = [];
    try { ficheros = fs.readdirSync(DIR); } catch (e) { return { pill: 0, partidas: 0, entradas: 0 }; }
    for (const f of ficheros) {
        if (!f.endsWith('.json')) continue;
        let m;
        try { m = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { continue; }
        if (!m || !m.players) continue;
        const t = m.endedAt || 0;
        if (t < ini || t >= fin) continue;
        const fee = m.entryFee | 0;
        if (fee <= 0) continue;
        const pagaron = m.players.filter(p => p.paid && !p.isTester && p.wallet).length;
        if (pagaron === 0) continue;
        total += fee * pagaron;
        entradas += pagaron;
        partidas++;
    }
    return { pill: total, partidas, entradas };
}

/*
 * Las ultimas partidas de una wallet, con lo que hace falta para seguirlas hasta
 * la cadena: el id del recibo, su hash y el lote en el que se anclo.
 *
 * Es lo que hay detras de cada nombre del top 10. Sin esto, "ese jugador hizo 40
 * kills" es una linea de mi servidor; con esto, cada partida lleva su hash dentro
 * de un lote anclado por Memo, asi que se puede comprobar que existia antes de
 * que se repartieran los premios.
 */
function historialDe(wallet, limite = 40) {
    let ficheros = [];
    try { ficheros = fs.readdirSync(DIR); } catch (e) { return { wallet, partidas: [], stats: null }; }

    // Que lote ancla cada recibo, para poder dar el enlace a la transaccion.
    const loteDe = new Map();
    for (const l of (data.lotes || [])) {
        for (const r of (l.recibos || [])) loteDe.set(r.id, { n: l.n, sig: l.sig });
    }

    const partidas = [];
    let kills = 0, muertes = 0, pagado = 0, picoMax = 0;
    const rivales = new Set();

    for (const f of ficheros) {
        if (!f.endsWith('.json')) continue;
        let m;
        try { m = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { continue; }
        if (!m || !m.players) continue;
        const yo = m.players.find(x => x.wallet === wallet);
        if (!yo) continue;

        kills += yo.kills | 0;
        if (!yo.gano) muertes++;
        if ((yo.peak | 0) > picoMax) picoMax = yo.peak | 0;
        if (yo.paid) pagado += m.entryFee | 0;
        for (const o of m.players) if (o.wallet && o.wallet !== wallet) rivales.add(o.wallet);

        const anclado = loteDe.get(m.id) || null;
        partidas.push({
            id: m.id, hash: m.hash, room: m.room, mode: m.mode,
            endedAt: m.endedAt, entryFee: m.entryFee | 0,
            kills: yo.kills | 0, peak: yo.peak | 0, pago: !!yo.paid,
            jugadores: m.players.filter(x => x.wallet).length,
            lote: anclado ? anclado.n : null,
            sig: anclado ? anclado.sig : null,
        });
    }

    partidas.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
    return {
        wallet,
        stats: {
            partidas: partidas.length,
            kills,
            killsPorPartida: partidas.length ? kills / partidas.length : 0,
            picoMax,
            // Los dos numeros del filtro anti-cluster, para que se vea POR QUE
            // alguien entra o no en la lista del dia.
            oponentesDistintos: rivales.size,
            pagadoEnEntradas: pagado,
            ancladas: partidas.filter(x => x.sig).length,
        },
        partidas: partidas.slice(0, limite),
    };
}

module.exports = {
    registra, anclaLote, arranca, save,
    partida, lote, cadena, pendientes, verificar, oponentesDe, recaudadoEntre, historialDe,
    _canonico: canonico, _canonicoLote: canonicoLote, GENESIS, MEMO_PROGRAM,
};
