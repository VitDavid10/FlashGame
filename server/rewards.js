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
/*
 * Cuanto premio se paga por cada PILL que la casa se quedo ese dia.
 *
 * Es lo que impide que crear wallets sea rentable. El grifo del contrato es un
 * techo, pero un techo no sabe cuanta gente hay jugando: en un juego vacio deja
 * salir lo mismo que en uno lleno, y entonces a cualquiera le sale a cuenta meter
 * veinte wallets suyas y cobrar el bote entero.
 *
 * OJO con medirlo por lo COBRADO EN ENTRADAS, que es lo que hacia antes: no sirve.
 * En classic la entrada se convierte en tu carry, y quien gana la sala con 5 kills
 * cobra sin fee — veinte wallets propias, una matando a las otras diecinueve,
 * recuperan las veinte entradas enteras. El ataque cuesta CERO.
 *
 * Lo que no se puede falsear es el RAKE: lo que la casa se queda de verdad. Jugando
 * contra ti mismo da cero (el que gana no paga fee, los muertos no llevaban nada) y
 * con jugadores de verdad da mucho, porque casi nadie gana la sala. Con el factor
 * en 1 o menos, nadie puede cobrar mas de lo que la casa ingreso por su culpa.
 *
 * Un 0 significa lo que parece: no se pagan premios. No es la forma de desactivar
 * este limite — no hay forma, es una proteccion, no una opcion.
 */
/*
 * Cuantos jugadores hacen falta en la lista del dia para que salga el bote entero.
 *
 * Sin esto, con doce jugadores jugando tres partidas ya se reparte el maximo: diez
 * de esos doce cobran, y estar en el top 10 sale gratis. El premio tiene que valer
 * lo que cuesta ganarlo, y ganarle a once personas no vale lo mismo que ganarle a
 * doscientas.
 *
 * OJO: esto cuenta a los ELEGIBLES de la lista (hasta PUBLICADOS=100), no a los que
 * cobran. Siguen cobrando solo los diez primeros — del 11 al 50 no reciben nada, lo
 * unico que hacen es que el bote sea el completo. Es lo que convierte "traer gente"
 * en un interes de los que ya estan.
 *
 * Es el freno que de verdad encarece montar un cluster de wallets: llegar al umbral
 * exige cincuenta wallets con kills y oponentes distintos, no cinco.
 */
const POT_COMPLETO_CON = Math.max(1, parseInt(process.env.LB_FULL_POT_AT, 10) || 50);

/*
 * Cuanto premio se paga por cada PILL que la casa se quedo ese dia (el "rake":
 * exit fees, comision de arcade, entradas de los que no vuelven, botes sin reclamar,
 * tienda). NO por cada PILL cobrado en entradas — eso no defiende de nada, porque en
 * classic la entrada se convierte en tu carry y quien gana la sala cobra sin fee:
 * veinte wallets propias, una matando a las otras diecinueve, recuperan las veinte
 * entradas enteras y el ataque cuesta CERO.
 *
 * El rake si es infalsificable: jugando contra ti mismo da cero, porque el que gana
 * no paga fee y los muertos no llevaban nada.
 *
 * NO esta acotado a 1, y esto es deliberado. Con factor 1 el leaderboard se
 * estrangula: el rake de classic sale solo de quien sobrevive al timer sin ganar la
 * sala, y con 500 jugadores da unos 50 $ al dia frente a los 170 $ del grifo. El
 * factor es el multiplicador que se calibra con datos reales, no una constante de
 * seguridad. Lo que sigue siendo un suelo duro pase lo que pase: cero por cualquier
 * factor sigue siendo cero.
 *
 * El 12 por defecto sale de querer una curva LINEAL: con 20 el bote toca el techo del
 * grifo a los 140 jugadores y a partir de ahi crecer la comunidad ya no paga mas. Con
 * 12 la parte lineal llega hasta los 233:
 *
 *     jugadores   50     100     150     200     233+
 *     factor 20  $61    $122    $170    $170    $170   <- plano desde 140
 *     factor 12  $37     $73    $110    $146    $170   <- lineal hasta 233
 *
 * Un 0 significa lo que parece: no se pagan premios.
 */
const REWARD_FACTOR = (() => {
    const v = parseFloat(process.env.REWARD_FACTOR);
    if (!Number.isFinite(v)) return 12;
    return Math.max(0, v);
})();

/*
 * Modo seco: se calcula todo y no se publica NADA en la cadena.
 *
 * Es la herramienta de calibracion, y hace falta porque con la curva de emision
 * actual el primer mes se reparte un tercio de la tesoreria: esperar treinta dias
 * para ajustar el factor significa haberlo gastado ya.
 *
 * En seco el ciclo prepara las rondas de verdad y escribe los JSON publicos, asi que
 * en 48 h hay datos reales —cuanto rake se genero, cuantos elegibles hubo, que bote
 * habria salido, quien habria cobrado— sin haber movido un solo token. Cuando los
 * numeros convenzan, se quita la variable y las rondas pendientes se publican.
 */
const DRY_RUN = process.env.REWARD_DRY_RUN === '1';

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
/*
 * Acota el techo del contrato a lo que la actividad del dia justifica.
 *
 * El contrato pone el maximo; esto decide cuanto de ese maximo tiene sentido pedir.
 * Con 20 jugadores el bote sale pequeno solo, sin que nadie tenga que ajustar nada,
 * y con 300 llega al tope. Y si el juego no arranca, la tesoreria dura anios en vez
 * de vaciarse repartiendo premios en una sala vacia.
 *
 * La cuenta se puede rehacer desde fuera: las entradas salen de los recibos de
 * partida, que se anclan en la cadena por lotes. Si el bote publicado no cuadra con
 * lo que se jugo ese dia, se ve.
 */
function porActividad(date, topeRaw, log) {
    // El dia es el que se premia, con el mismo corte UTC que usa el leaderboard. Una
    // ventana movil de 24 h le aplicaria a un dia atrasado la actividad de hoy, y el
    // ciclo prepara hasta siete dias de una tirada.
    let rake;
    try {
        rake = require('./rake.js').delDia(date);
    } catch (e) {
        // Sin el dato no se puede acotar. Se deja el techo del contrato antes que
        // bloquear los premios: el techo sigue siendo un limite duro.
        return topeRaw;
    }
    if (!(rake > 0)) return 0n;   // la casa no ingreso nada ese dia: no hay premio
    const porJuego = pillToRaw(Math.floor(rake * REWARD_FACTOR));
    if (porJuego >= topeRaw) return topeRaw;
    if (log) log(`Premios ${date}: la casa ingreso ${rake} PILL -> bote ${rawToPill(porJuego)} (tope ${rawToPill(topeRaw)})`);
    return porJuego;
}

async function presupuestoRaw(conn, log) {
    // Sin contrato el techo es el presupuesto local, pero el acotado por actividad se
    // aplica igual: es la parte que no depende de la cadena, y saltarsela aqui dejaba
    // el bote suelto justo en el modo en el que se prueba todo.
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

    /*
     * Los dos frenos que dependen DEL DIA que se premia, en cadena. Van aqui y no en
     * presupuestoRaw porque los dos necesitan saber de que dia se trata: el tope del
     * contrato es el mismo para todos, pero lo que se jugo no.
     *
     *   presupuesto (grifo del contrato)
     *     -> x lo recaudado ese dia
     *     -> x elegibles / POT_COMPLETO_CON
     *     -> repartoDe() quita ademas los pesos de los puestos vacios
     */
    const trasActividad = porActividad(date, BigInt(presupuesto), null);
    const elegibles = snap.entries.length;
    const bote = elegibles >= POT_COMPLETO_CON
        ? trasActividad
        : (trasActividad * BigInt(elegibles)) / BigInt(POT_COMPLETO_CON);
    if (bote <= 0n) return null;

    const { entries, totalRaw } = leaderboard.repartoDe(snap, bote);
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
        // Por que el bote fue el que fue. Sin estos tres numeros, "ese dia se
        // repartio menos" hay que creerselo; con ellos se rehace la cuenta desde el
        // leaderboard publicado, que ya va encadenado por hash.
        elegibles,
        potCompletoCon: POT_COMPLETO_CON,
        factor: REWARD_FACTOR,
        seco: DRY_RUN || undefined,
        topeRaw: String(presupuesto),
        trasActividadRaw: String(trasActividad),
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
    // El corte del modo seco va aqui y no en el ciclo: asi TODO lo que llame a
    // publicar respeta la calibracion, incluido el boton del panel de admin.
    if (DRY_RUN) {
        if (log) log(`[SECO] Ronda ${ronda.epoch} (${ronda.date}) NO publicada: ${rawToPill(ronda.totalRaw)} PILL para ${ronda.winners} ganadores`);
        return { ok: false, error: 'modo seco (REWARD_DRY_RUN=1): la ronda queda preparada y sin publicar', seco: true };
    }
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
        // Sin esto, en modo seco el panel enseña rondas "sin publicar" y parece que
        // algo falla, cuando es exactamente lo que se le ha pedido que haga.
        seco: DRY_RUN,
        factor: REWARD_FACTOR,
        potCompletoCon: POT_COMPLETO_CON,
    };
}

/*
 * Lo que se repartiria HOY, con la gente que hay ahora mismo en la lista.
 *
 * Es la misma cadena de frenos que aplica prepararRonda al cerrar el dia, pero
 * mirando el dia en curso: sirve para ensenar en el leaderboard cuanto hay en
 * juego AHORA y como cambia al entrar mas gente. No decide nada — el reparto de
 * verdad se calcula al cerrar, con el rake ya cerrado.
 *
 * Devuelve tambien el desglose por puesto: es lo unico que responde de verdad a
 * "¿y a mi cuanto me tocaria si acabo cuarto?".
 */
async function proyeccionDeHoy(snapshot) {
    const hoy = (snapshot && snapshot.date) || new Date().toISOString().slice(0, 10);
    const elegibles = ((snapshot && snapshot.entries) || []).length;

    // Sin cadena configurada, presupuestoRaw ya cae solo al presupuesto local: la
    // proyeccion sigue siendo util en devnet antes de desplegar el contrato.
    let topeRaw;
    try { topeRaw = await presupuestoRaw(PROGRAM ? conexion(require('./solana.js')) : null, null); }
    catch (e) { topeRaw = pillToRaw(BUDGET_FALLBACK); }

    const trasActividad = porActividad(hoy, BigInt(topeRaw), null);
    const bote = elegibles >= POT_COMPLETO_CON
        ? trasActividad
        : (trasActividad * BigInt(elegibles)) / BigInt(POT_COMPLETO_CON);

    // El desglose sale de los mismos pesos que usa el reparto real, y solo hasta
    // donde hay gente: los puestos vacios no se pagan.
    const pesos = leaderboard.PESOS;
    const puestos = [];
    for (let i = 0; i < Math.min(elegibles, pesos.length); i++) {
        puestos.push({
            rank: i + 1,
            pct: pesos[i],
            pill: rawToPill((bote * BigInt(Math.round(pesos[i] * 100))) / 10000n),
        });
    }

    return {
        fecha: hoy,
        elegibles,
        potCompletoCon: POT_COMPLETO_CON,
        factor: REWARD_FACTOR,
        rakeDelDia: (() => { try { return require('./rake.js').delDia(hoy); } catch (e) { return 0; } })(),
        topePill: rawToPill(topeRaw),
        botePill: rawToPill(bote),
        // Cuanta gente falta para que el bote deje de recortarse por participacion.
        faltanParaCompleto: Math.max(0, POT_COMPLETO_CON - elegibles),
        puestos,
    };
}

module.exports = {
    tick, arranca, estado, premiosDe, marcarCobrado, rondaPublica,
    prepararRonda, publicarRonda, presupuestoRaw, proyeccionDeHoy, refrescar,
    epochDeFecha, fechaDeEpoch, pillToRaw, rawToPill,
    PROGRAM, save, DRY_RUN, REWARD_FACTOR, POT_COMPLETO_CON,
};
