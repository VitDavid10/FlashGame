/*
 * PREMIOS DIARIOS DE LA TESORERIA — el orquestador.
 *
 * Ata las tres piezas: el leaderboard cierra el dia, merkle construye el arbol y
 * treasury-client publica la raiz en el contrato. Aqui vive el calendario:
 *
 *   dia D, 00:00 UTC   leaderboard.js cierra el dia D-1 y lo hashea
 *   dia D              se calcula el reparto, se construye el arbol y se llama a
 *                      publish_round(). NO se mueve un token. Arrancan las 48 h.
 *   dia D+2            se abre el claim. Cobra el ganador, no el servidor.
 *   dia D+32           expire_round() libera lo que nadie reclamo
 *
 * FUNCIONA SIN CADENA. Si no hay programa configurado (TREASURY_PROGRAM) o no hay
 * clave de autoridad, las rondas se calculan y se guardan igual, marcadas como no
 * publicadas. Eso permite rodar el pipeline entero —cierre, reparto, JSON publico,
 * pantalla de claims— antes de que exista el contrato en devnet, y que un RPC caido
 * no deje de generar rondas: cuando vuelva, se publican las atrasadas.
 *
 * EL PRESUPUESTO no lo decide este modulo. Lo decide el grifo del contrato:
 * min(reward_cap_per_epoch, saldo_tesoreria x bps / 10000). Se lee de la Config
 * on-chain; sin cadena, del env REWARD_BUDGET_PILL. Publicar una ronda por encima
 * del cap la rechaza el programa, asi que el limite es real, no una promesa.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const leaderboard = require('./leaderboard.js');
const merkle = require('./merkle.js');
const tc = require('./treasury-client.js');

const BASE = process.env.LB_DIR || __dirname;
const FILE = path.join(BASE, 'rewards.json');
const DIR = path.join(BASE, 'rewards');

const PROGRAM = process.env.TREASURY_PROGRAM || '';
const DECIMALS = parseInt(process.env.PILL_DECIMALS, 10) || 6;
/** Presupuesto de respaldo mientras no hay contrato, en PILL enteros. */
const BUDGET_FALLBACK = parseInt(process.env.REWARD_BUDGET_PILL, 10) || 50000;

const DIA = 86400;

/*
 * Conexión al RPC, creada la primera vez que hace falta y no al cargar el módulo.
 * Sin programa configurado no se crea nunca: así el servidor arranca igual sin
 * cadena y los tests no abren sockets.
 */
let _conn = null;
function conexion(solana) {
    if (!PROGRAM || !solana) return null;
    if (!_conn) {
        const { Connection } = require('@solana/web3.js');
        _conn = new Connection(solana.RPC, 'confirmed');
    }
    return _conn;
}

const pillToRaw = (pill) => BigInt(Math.floor(pill)) * (10n ** BigInt(DECIMALS));
const rawToPill = (raw) => Number(BigInt(raw) / (10n ** BigInt(DECIMALS)));

/** 'YYYY-MM-DD' -> indice de epoca del contrato (dias desde el epoch Unix). */
function epochDeFecha(date) {
    const [y, m, d] = date.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 1000 / DIA);
}
function fechaDeEpoch(epoch) { return new Date(epoch * DIA * 1000).toISOString().slice(0, 10); }

/* ===================== ESTADO ===================== */

// epoch -> { epoch, date, root, totalRaw, winners, sig, publishedAt, claimableAt,
//            cancelled, expired, claims: { wallet: sig } }
let data = { rounds: {} };
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || { rounds: {} }; } catch (e) {}
if (!data.rounds) data.rounds = {};
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

// Los hosts no escriben ni publican rondas: eso es cosa del Director (ver la misma
// guarda en leaderboard.js). Dos procesos publicando la misma epoca serian dos
// transacciones, y la segunda fallaria con la cuenta de la ronda ya creada.
const SOLO_LECTURA = process.env.PW_ROLE === 'host';

let dirty = false;
function save() { if (!dirty || SOLO_LECTURA) return; dirty = false; try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch (e) {} }

/* ===================== PRESUPUESTO ===================== */

/*
 * Lo que el grifo deja salir hoy, en RAW. Se lee del contrato: cap absoluto y
 * porcentaje del saldo, el menor de los dos. Es la MISMA cuenta que hace
 * publish_round(), asi que si aqui sale un numero mas alto la transaccion se
 * rechaza — y mejor que se rechace a que se publique una ronda impagable.
 */
async function presupuestoRaw(conn, log) {
    if (!PROGRAM || !conn) return pillToRaw(BUDGET_FALLBACK);
    try {
        const p = tc.pdas(PROGRAM);
        const [cfgInfo, treInfo] = await conn.getMultipleAccountsInfo([p.config, p.treasury]);
        if (!cfgInfo || !treInfo) return pillToRaw(BUDGET_FALLBACK);
        const cfg = tc.decodeConfig(cfgInfo.data);
        // El saldo de una token account SPL: u64 en el offset 64.
        const saldo = treInfo.data.readBigUInt64LE(64);
        const libre = saldo > cfg.reserved ? saldo - cfg.reserved : 0n;
        const porBps = (saldo * BigInt(cfg.rewardBpsPerEpoch)) / 10000n;
        const tope = porBps < cfg.rewardCapPerEpoch ? porBps : cfg.rewardCapPerEpoch;
        // Nunca por encima de lo que queda libre: lo reservado por rondas vivas ya
        // tiene dueno aunque todavia no lo haya reclamado.
        return tope < libre ? tope : libre;
    } catch (e) {
        if (log) log(`Premios: no pude leer el grifo on-chain (${e.message}); uso el presupuesto local`);
        return pillToRaw(BUDGET_FALLBACK);
    }
}

/* ===================== PUBLICACION ===================== */

/*
 * Prepara la ronda de un dia ya cerrado: reparto, arbol, JSON publico. No toca la
 * cadena. Devuelve null si ese dia no dio para premios (nadie llego al minimo de
 * kills, o el presupuesto es cero).
 */
function prepararRonda(date, presupuesto) {
    if (data.rounds[epochDeFecha(date)]) return null;      // ya existe
    const snap = leaderboard.diaCerrado(date);
    if (!snap || !snap.entries || snap.entries.length === 0) return null;
    if (!(BigInt(presupuesto) > 0n)) return null;

    const epoch = epochDeFecha(date);
    const { entries, totalRaw } = leaderboard.repartoDe(snap, presupuesto);
    if (entries.length === 0 || totalRaw <= 0n) return null;

    const ronda = merkle.buildRound(epoch, entries);

    // El JSON publico lleva el hash del leaderboard del dia: es lo que permite
    // encadenar "esta lista de premios sale de ESE dia" sin fiarse de nadie.
    const publico = Object.assign({}, ronda, {
        date,
        leaderboardHash: snap.hash,
        leaderboardPrevHash: snap.prevHash,
        criterio: snap.criterio,
        decimals: DECIMALS,
        generatedAt: new Date().toISOString(),
    });
    try { fs.writeFileSync(path.join(DIR, epoch + '.json'), JSON.stringify(publico, null, 1)); } catch (e) {}

    data.rounds[epoch] = {
        epoch, date,
        root: ronda.root,
        totalRaw: ronda.total,
        winners: ronda.winners,
        leaderboardHash: snap.hash,
        sig: null,
        publishedAt: null,
        claimableAt: null,
        cancelled: false,
        expired: false,
        claims: {},
    };
    dirty = true; save();
    return data.rounds[epoch];
}

/** Publica on-chain una ronda ya preparada. Sin cadena configurada, no hace nada. */
async function publicarRonda(ronda, solana, log) {
    if (!PROGRAM) return { ok: false, error: 'sin programa de tesoreria configurado' };
    if (!solana.canWithdraw()) return { ok: false, error: 'clave de la autoridad no disponible' };
    if (ronda.sig) return { ok: true, sig: ronda.sig, repetida: true };
    try {
        const ix = tc.publishRound(PROGRAM, {
            epoch: ronda.epoch,
            merkleRoot: ronda.root,
            totalRaw: BigInt(ronda.totalRaw),
            winners: ronda.winners,
            authority: solana.authorityPubkey(),
        });
        const sig = await solana.sendInstructions([ix]);
        ronda.sig = sig;
        ronda.publishedAt = Date.now();
        dirty = true; save();
        if (log) log(`Ronda ${ronda.epoch} (${ronda.date}) publicada: ${rawToPill(ronda.totalRaw)} PILL a ${ronda.winners} ganadores — ${sig}`);
        return { ok: true, sig };
    } catch (e) {
        if (log) log(`Ronda ${ronda.epoch} NO publicada: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

/*
 * Refresca el estado on-chain de las rondas publicadas: cuando se abre el claim,
 * cuanto se lleva reclamado y si alguna se cancelo. El contrato es la fuente de la
 * verdad; este fichero es solo una cache para no consultar el RPC en cada peticion
 * de un jugador.
 */
async function refrescar(conn, log) {
    if (!PROGRAM || !conn) return;
    const vivas = Object.values(data.rounds).filter(r => r.sig && !r.expired);
    if (vivas.length === 0) return;
    try {
        const cuentas = await conn.getMultipleAccountsInfo(vivas.map(r => tc.roundPda(PROGRAM, r.epoch)));
        cuentas.forEach((info, i) => {
            if (!info) return;
            const on = tc.decodeRound(info.data);
            const r = vivas[i];
            r.claimableAt = on.claimableAt * 1000;
            r.claimedRaw = on.claimed.toString();
            r.cancelled = on.cancelled;
            r.expired = on.expired;
            dirty = true;
        });
        save();
    } catch (e) {
        if (log) log(`Premios: no pude refrescar las rondas (${e.message})`);
    }
}

/* ===================== EL BUCLE ===================== */

/*
 * Un paso del calendario. Se llama sola cada TICK_MS y tambien desde el panel.
 *
 * Es idempotente a proposito: cerrar un dia ya cerrado no hace nada, preparar una
 * ronda que ya existe no hace nada, publicar una ya publicada no hace nada. Asi da
 * igual si se llama de mas, si el proceso se reinicia a media faena o si dos ticks
 * se solapan tras un RPC lento.
 */
async function tick(solana, log, connOverride) {
    const conn = connOverride !== undefined ? connOverride : conexion(solana);
    const hecho = { cerrado: null, preparadas: [], publicadas: [] };

    // 1. Cerrar el dia anterior si aun no se cerro.
    const ayer = new Date(Date.now() - DIA * 1000).toISOString().slice(0, 10);
    const hoy = new Date().toISOString().slice(0, 10);
    if (leaderboard.estadoHoy().date !== hoy) {
        const snap = leaderboard.cerrarAhora();
        hecho.cerrado = snap && snap.date;
        if (log && hecho.cerrado) log(`Leaderboard del ${hecho.cerrado} cerrado: hash ${snap.hash.slice(0, 12)}…`);
    }

    // 2. Preparar rondas de los dias cerrados que aun no la tienen (ultimos 7).
    const presupuesto = await presupuestoRaw(conn, log);
    for (const eslabon of leaderboard.cadena(7)) {
        if (eslabon.date === hoy) continue;
        const r = prepararRonda(eslabon.date, presupuesto);
        if (r) {
            hecho.preparadas.push(r.epoch);
            if (log) log(`Ronda ${r.epoch} (${r.date}) preparada: ${rawToPill(r.totalRaw)} PILL para ${r.winners} ganadores, raiz ${r.root.slice(0, 12)}…`);
        }
    }

    // 3. Publicar las que estan sin publicar.
    for (const r of Object.values(data.rounds)) {
        if (r.sig || r.cancelled) continue;
        const res = await publicarRonda(r, solana, log);
        if (res.ok && !res.repetida) hecho.publicadas.push(r.epoch);
    }

    // 4. Refrescar el estado de las vivas.
    await refrescar(conn, log);
    return hecho;
}

const TICK_MS = (parseInt(process.env.REWARDS_TICK_MIN, 10) || 20) * 60 * 1000;
function arranca(solana, log) {
    setInterval(() => { tick(solana, log).catch(e => log && log('Premios: tick fallido — ' + e.message)); }, TICK_MS).unref();
    // Un tick al arrancar, sin bloquear el arranque del servidor.
    setTimeout(() => { tick(solana, log).catch(() => {}); }, 15000).unref();
}

/* ===================== CONSULTA (lo que ve el jugador) ===================== */

function rondaPublica(epoch) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, epoch + '.json'), 'utf8')); } catch (e) { return null; }
}

/*
 * Premios de una wallet: los que puede cobrar ahora, los que estan en ventana y los
 * que ya cobro. La prueba de Merkle va incluida — el jugador no tiene que saber
 * construir arboles, solo firmar.
 *
 * `claimable` sale de la fecha on-chain (claimableAt), no de una cuenta local: si el
 * servidor se equivoca y dice que ya se puede, la transaccion falla en el contrato.
 * Aqui solo se decide que boton se pinta.
 */
function premiosDe(wallet) {
    if (!wallet) return { pendientes: [], total: 0 };
    const ahora = Date.now();
    const pendientes = [];
    for (const r of Object.values(data.rounds)) {
        if (r.cancelled || r.expired) continue;
        if (r.claims && r.claims[wallet]) continue;
        const pub = rondaPublica(r.epoch);
        if (!pub) continue;
        const fila = pub.entries.find(e => e.wallet === wallet);
        if (!fila) continue;
        pendientes.push({
            epoch: r.epoch,
            date: r.date,
            // La wallet viaja de vuelta aunque la haya pedido el propio jugador: es
            // el dato con el que se construye la hoja, y el cliente tiene que poder
            // comprobar su prueba sin dar por hecho de que peticion vino.
            wallet,
            rank: fila.rank,
            amountRaw: fila.amountRaw,
            pill: rawToPill(fila.amountRaw),
            proof: fila.proof,
            publicado: !!r.sig,
            claimableAt: r.claimableAt,
            claimable: !!r.sig && !!r.claimableAt && ahora >= r.claimableAt,
        });
    }
    pendientes.sort((a, b) => a.epoch - b.epoch);
    return { pendientes, total: pendientes.reduce((s, p) => s + p.pill, 0) };
}

/** Marca un premio como cobrado (el servidor lo ve al confirmar la tx del jugador). */
function marcarCobrado(epoch, wallet, sig) {
    const r = data.rounds[epoch];
    if (!r) return false;
    if (!r.claims) r.claims = {};
    r.claims[wallet] = sig || true;
    dirty = true; save();
    return true;
}

/** Resumen para el panel y para /api/treasury. */
function estado() {
    const rondas = Object.values(data.rounds).sort((a, b) => b.epoch - a.epoch);
    return {
        programa: PROGRAM || null,
        rondas: rondas.slice(0, 30).map(r => ({
            epoch: r.epoch, date: r.date, root: r.root,
            pill: rawToPill(r.totalRaw), winners: r.winners,
            publicada: !!r.sig, sig: r.sig,
            claimableAt: r.claimableAt, cancelled: r.cancelled, expired: r.expired,
            cobrados: Object.keys(r.claims || {}).length,
            leaderboardHash: r.leaderboardHash,
        })),
        total: rondas.length,
        sinPublicar: rondas.filter(r => !r.sig && !r.cancelled).length,
    };
}

module.exports = {
    tick, arranca, estado, premiosDe, marcarCobrado, rondaPublica,
    prepararRonda, publicarRonda, presupuestoRaw, refrescar,
    epochDeFecha, fechaDeEpoch, pillToRaw, rawToPill,
    PROGRAM, save,
};
