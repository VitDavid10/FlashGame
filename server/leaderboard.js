/*
 * LEADERBOARD DIARIO — el criterio de los premios de la tesoreria, publicado ANTES
 * de saber a quien le toca.
 *
 * Esto no es el "Global Elite" (ese vive en playerStats y es historico). Esto cuenta
 * un dia UTC y se cierra a las 00:00, y va indexado por WALLET, no por nombre: el
 * premio se paga on-chain y un nombre no es una direccion. Quien juega sin wallet
 * conectada sale en las stats de siempre pero no en esta lista — no habria donde
 * pagarle.
 *
 * POR QUE UNA CADENA DE HASHES. El reparto lo calcula el servidor, o sea yo. Si la
 * lista del dia se pudiera reescribir despues, meter una wallet mia en el top 10
 * seria invisible. Cada dia se cierra con:
 *
 *     hash_D = sha256( hash_{D-1} || json_canonico(dia_D) )
 *
 * Cambiar cualquier cosa de un dia ya cerrado cambia su hash, y con el todos los
 * siguientes. Como el hash de cada dia se publica al cerrarlo (y la raiz de Merkle
 * del reparto se ancla on-chain al dia siguiente), reescribir el pasado exige romper
 * una cadena que ya vio todo el mundo. No lo hace imposible: lo hace evidente, que
 * es lo maximo que puede dar un servidor centralizado.
 *
 * EL ORDEN. kills del dia, y a igualdad, masa maxima del dia. Es el mismo criterio
 * que ya ordena el ranking global (server/index.js:435), asi que no hay que explicar
 * una metrica nueva. Puntuar por $PILL ganado se descarto a proposito: premiaria
 * apostar fuerte en las salas de 50 $, no jugar bien.
 *
 * SOLO PUNTUAN LAS SALAS DE PAGO, y no es un descuido: `payWallet` solo se rellena
 * cuando se cobro una entrada (game-host.js:362). Sale gratis del diseno que ya
 * habia y es la mejor defensa anti-sybil que tiene todo esto: para salir en la lista
 * que reparte la tesoreria hay que haber pagado por jugar. Montar diez cuentas para
 * cobrarse los premios pasa de ser gratis a costar diez entradas al dia, con cada
 * pago escrito en la cadena. Quien juega gratis sigue apareciendo en el ranking
 * historico de siempre; en este no.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// LB_DIR redirige todo el almacenamiento. Lo usan los tests para no pisar los datos
// reales del servidor, y sirve igual en el VPS para sacar los snapshots a un disco
// aparte: son ficheros publicos, no tienen por que vivir junto al codigo.
const BASE = process.env.LB_DIR || __dirname;
const DIR = path.join(BASE, 'leaderboards');
const CHAIN_FILE = path.join(BASE, 'leaderboard-chain.json');
const TODAY_FILE = path.join(BASE, 'leaderboard-today.json');

/** Cuantas filas se publican y se hashean cada dia. El premio va al top 10; el resto
 *  se publica para que se vea el contexto y para que quien quedo 11 pueda comprobarlo. */
const PUBLICADOS = 100;

/** Minimo para entrar en la lista. Sin el, un dia flojo premia a quien hizo una kill
 *  suelta, y el premio deja de significar nada. */
const MIN_KILLS = parseInt(process.env.LB_MIN_KILLS, 10) || 3;

/*
 * OPONENTES DISTINTOS MINIMOS. Es el filtro contra el fraude que ninguna firma puede
 * impedir: montar diez wallets propias y hacerlas jugar entre ellas.
 *
 * Un jugador de verdad se cruza con decenas de personas sin proponerselo — las salas
 * tienen hasta 35 sitios y no elige con quien le toca. Diez wallets que solo juegan
 * entre ellas forman un cluster cerrado y no llegan al minimo. Para saltarselo hay
 * que meter esas wallets en partidas con gente real, pagando entradas reales y con
 * los reales llevandose su parte: el fraude deja de ser gratis.
 *
 * Es mejor filtro que exigir una fianza porque no cuesta dinero al jugador legitimo.
 * Filtra por comportamiento, no por capital: un chaval sin un euro que juega mucho
 * pasa, y diez wallets con dinero que solo se cruzan entre ellas no.
 *
 * Se aplica SOLO si hay datos de oponentes (recibos de partida). Sin ellos no filtra
 * nada: un filtro que no puede comprobar nada dejaria la lista vacia y sin premios.
 */
const MIN_OPONENTES = parseInt(process.env.LB_MIN_OPPONENTS, 10) || 5;

/** Lo inyecta index.js con matches.oponentesDe, para no acoplar los dos modulos. */
let _proveedorOponentes = null;
function setProveedorOponentes(fn) { _proveedorOponentes = fn; }

/** Pesos del top 10. Los mismos que el reparto del bote de arcade
 *  (server/room-loop.js:156): ya estan calibrados y la gente los conoce. */
const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];

// El mismo que usa matches.js para anclar los lotes de partidas.
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const hoyUTC = () => new Date().toISOString().slice(0, 10);
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ===================== ESTADO ===================== */

let hoy = { date: hoyUTC(), players: {} };   // wallet -> { kills, peak, name }
let chain = [];                              // [{ date, prevHash, hash, players, closedAt }]

try { const j = JSON.parse(fs.readFileSync(TODAY_FILE, 'utf8')); if (j && j.date) hoy = j; } catch (e) {}
try { chain = JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf8')) || []; } catch (e) {}
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

/*
 * Los hosts no escriben. En el split multiproceso (Fase 4) los hosts reportan los
 * hechos por IPC y es el Director quien lleva la contabilidad; pero el modulo se
 * carga igual en los dos porque el require esta arriba de index.js. Sin esta guarda,
 * cuatro procesos escribirian el mismo leaderboard-today.json a la vez y el ultimo en
 * cerrar el fichero se lleva el dia entero por delante.
 */
const SOLO_LECTURA = process.env.PW_ROLE === 'host';

let dirty = false;
function save() {
    if (!dirty || SOLO_LECTURA) return;
    dirty = false;
    fs.writeFile(TODAY_FILE, JSON.stringify(hoy), () => {});
}
// unref: este temporizador no debe ser motivo para que el proceso siga vivo. En el
// servidor da igual (nunca termina), pero sin esto un test que solo importe el
// modulo se queda colgado cinco segundos por nada.
setInterval(save, 5000).unref();
process.on('SIGTERM', save);
process.on('SIGINT', () => { save(); process.exit(0); });

/*
 * La cadena se escribe sincrona y en cuanto cambia. Son dos escrituras al dia
 * (cerrar y anclar) sobre un fichero pequenio, asi que no hay nada que optimizar,
 * y perderla es caro: un ancla que no llega al disco deja el dia como "sin anclar"
 * despues de un reinicio, y entonces los ganadores que aun no habian cobrado no
 * pueden — pagarUno se niega a pagar un dia sin ancla, con razon.
 */
function guardaCadena() {
    if (SOLO_LECTURA) return;
    try { fs.writeFileSync(CHAIN_FILE, JSON.stringify(chain)); } catch (e) {}
}

/* ===================== REGISTRO ===================== */

function slot(wallet) {
    if (!hoy.players[wallet]) hoy.players[wallet] = { kills: 0, peak: 0, name: null };
    return hoy.players[wallet];
}

/*
 * Si cambio el dia mientras el servidor corre, se cierra el anterior antes de tocar
 * nada. Se comprueba en cada registro y no con un temporizador a medianoche: un
 * setTimeout a 24 h se desincroniza con el reloj, y si el proceso se reinicia a las
 * 23:59 el temporizador se pierde y el dia no se cierra nunca.
 */
function alDia() {
    const d = hoyUTC();
    if (d !== hoy.date) cerrarDia(hoy.date, d);
}

/** Una kill. `wallet` puede ser null (jugador sin wallet): entonces no puntua. */
function recordKill(wallet, name) {
    if (!wallet) return;
    alDia();
    const s = slot(wallet);
    s.kills++;
    if (name) s.name = name;
    dirty = true;
}

/** Masa maxima de una partida. Solo sube el record del dia. */
function recordPeak(wallet, peak, name) {
    if (!wallet || !(peak > 0)) return;
    alDia();
    const s = slot(wallet);
    if (peak > s.peak) s.peak = Math.floor(peak);
    if (name) s.name = name;
    dirty = true;
}

/* ===================== CIERRE DEL DIA ===================== */

/*
 * Filas ordenadas y ya filtradas, tal y como se publican.
 *
 * `oponentes` es el Map de matches.oponentesDe(). Si no llega o viene vacio, el
 * filtro de diversidad NO se aplica: sin recibos de partida no hay con que
 * comprobarlo, y dejar la lista vacia por falta de datos seria peor que no filtrar.
 * La fila lleva el numero de oponentes para que se vea de donde sale la decision.
 */
/*
 * Que fraccion de la gente que jugo ese dia hay que haber conocido.
 *
 * `oponentes >= MIN_OPONENTES` a secas no defiende de nada: veinte wallets propias
 * jugando entre ellas ven diecinueve oponentes distintos cada una y pasan sobradas.
 *
 * La diferencia real es que UN CLUSTER TIENE TECHO Y UN JUGADOR NO. Con veinte
 * wallets nunca conoceras a mas de diecinueve personas, juegues cuatro partidas o
 * cuatro mil. Un jugador de verdad se cruza con gente nueva cada vez que entra.
 *
 *   sobre 500 jugadores activos:
 *     atacante con 20 wallets  ->  19 de 499  =   4 %   (fijo, juegue lo que juegue)
 *     atacante con 50 wallets  ->  49 de 499  =  10 %   (justo en el umbral)
 *     jugador real, 4 partidas -> 130 de 499  =  25 %
 *     jugador real, 20 partidas-> 380 de 499  =  76 %
 *
 * Se mide contra la POBLACION y no contra las partidas jugadas. Dividir por partidas
 * parecia razonable y estaba mal: baja cuanto mas juegas, asi que castigaba al
 * jugador activo (poblacion 30 y 20 partidas daba 1,5, por debajo del umbral) y
 * dejaba pasar al atacante que juega poco (20 wallets en 4 partidas daban 4,75).
 * Contra la poblacion pasa lo correcto: jugar mas solo puede SUBIR tu porcentaje.
 *
 * EL LIMITE, dicho claro: si en el juego hay treinta personas y el atacante controla
 * veinte, ha conocido al 66 % de la comunidad — igual que cualquiera. Con poca
 * poblacion esto no distingue, y no hay filtro que lo arregle. Por eso la defensa
 * principal es economica (jugar contra uno mismo no genera rake, ver rewards.js) y
 * esto es una capa encima, no al reves.
 */
/*
 * El 10 % es deliberadamente conservador: entre "atacante con 50 wallets" (9,8 % de
 * 499) y "jugador que echa dos partidas" (13 %) hay muy poco margen, y ante la duda
 * es mejor dejar pasar a un atacante que echar a un jugador de verdad. Sube el liston
 * a unas 55 wallets, que ya es un coste real — y el rake las deja a cero igualmente.
 */
const MIN_CONOCIDOS_PCT = parseFloat(process.env.LB_MIN_KNOWN_PCT) || 0.10;
const MIN_PARTIDAS = parseInt(process.env.LB_MIN_MATCHES, 10) || 2;

function diversoBastante(o, poblacion) {
    if ((o.partidas || 0) < MIN_PARTIDAS) return false;
    // Con menos de dos jugadores activos no hay nada contra lo que comparar.
    const pob = (poblacion | 0) - 1;
    if (pob < 1) return true;
    return (o.oponentes / pob) >= MIN_CONOCIDOS_PCT;
}

function tablaDe(players, oponentes) {
    const hayDatos = oponentes && oponentes.size > 0;
    return Object.entries(players)
        .filter(([w, p]) => {
            if (p.kills < MIN_KILLS) return false;
            if (!hayDatos) return true;
            const o = oponentes.get(w);
            if (!o || o.oponentes < MIN_OPONENTES) return false;
            return diversoBastante(o, oponentes.size);
        })
        .sort(([wa, a], [wb, b]) => (b.kills - a.kills) || (b.peak - a.peak) || (wa < wb ? -1 : 1))
        .slice(0, PUBLICADOS)
        .map(([wallet, p], i) => {
            const o = hayDatos ? oponentes.get(wallet) : null;
            return {
                rank: i + 1, wallet, name: p.name || null, kills: p.kills, peak: p.peak,
                oponentes: o ? o.oponentes : null,
            };
        });
}

/** Los oponentes del proveedor inyectado, o null si no hay. */
function _oponentes() {
    if (!_proveedorOponentes) return null;
    try { return _proveedorOponentes(); } catch (e) { return null; }
}

/*
 * JSON canonico: claves en orden fijo y sin espacios. Es lo que se hashea.
 *
 * Si se hasheara JSON.stringify() del objeto tal cual, el hash dependeria del orden
 * en que se insertaron las wallets — o sea, del orden en que jugo la gente. Dos
 * personas con los mismos datos sacarian hashes distintos y la cadena no serviria
 * para comprobar nada.
 */
function canonico(date, filas) {
    return JSON.stringify({
        date,
        entries: filas.map(f => ({ rank: f.rank, wallet: f.wallet, kills: f.kills, peak: f.peak })),
    });
}

const GENESIS = '0'.repeat(64);

/*
 * Cierra un dia. IDEMPOTENTE POR FECHA, y no es un detalle: la cadena guarda un
 * eslabon por dia pero los snapshots se guardan en un fichero por fecha. Cerrar dos
 * veces el mismo dia (el admin pulsando el boton, un reintento del cron) metia dos
 * eslabones apuntando al mismo fichero, y a partir de ahi verificarCadena fallaba
 * para siempre sin que nadie hubiera tocado nada. Un dia se cierra una vez.
 */
function cerrarDia(date, nuevaFecha) {
    const yaCerrado = chain.find(e => e.date === date);
    if (yaCerrado) {
        if (nuevaFecha && nuevaFecha !== hoy.date) { hoy = { date: nuevaFecha, players: {} }; dirty = true; save(); }
        return diaCerrado(date);
    }
    const filas = tablaDe(hoy.players, _oponentes());
    const prevHash = chain.length ? chain[chain.length - 1].hash : GENESIS;
    const cuerpo = canonico(date, filas);
    const hash = sha256hex(prevHash + cuerpo);

    const snapshot = {
        date, prevHash, hash,
        closedAt: new Date().toISOString(),
        minKills: MIN_KILLS,
        minOponentes: MIN_OPONENTES,
        criterio: 'kills del dia; desempate por masa maxima del dia; minimo de oponentes distintos',
        entries: filas,
    };
    if (SOLO_LECTURA) return snapshot;   // un host nunca cierra un dia
    try { fs.writeFileSync(path.join(DIR, date + '.json'), JSON.stringify(snapshot, null, 1)); } catch (e) {}

    chain.push({ date, prevHash, hash, players: filas.length, closedAt: snapshot.closedAt });
    guardaCadena();

    hoy = { date: nuevaFecha || hoyUTC(), players: {} };
    dirty = true;
    save();
    return snapshot;
}

/** Fuerza el cierre del dia en curso (admin, o el cron del reparto). */
function cerrarAhora() {
    const d = hoy.date;
    return cerrarDia(d, hoyUTC() === d ? d : hoyUTC());
}

/* ===================== LECTURA ===================== */

/** La tabla de hoy, en vivo. Aun no esta cerrada ni hasheada. */
function estadoHoy() {
    alDia();
    return { date: hoy.date, cerrado: false, minKills: MIN_KILLS, minOponentes: MIN_OPONENTES, entries: tablaDe(hoy.players, _oponentes()) };
}

function diaCerrado(date) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, date + '.json'), 'utf8')); } catch (e) { return null; }
}

/*
 * Ancla el hash de un dia cerrado en la cadena, con un Memo.
 *
 * Esto es lo que permite repartir premios SIN contrato y que siga siendo
 * comprobable. Cuesta una transaccion (unos 0,000005 SOL) y deja constancia de que
 * la clasificacion de ese dia estaba fijada ANTES de que se pagara a nadie.
 *
 * Con eso, cualquiera puede:
 *   1. coger el hash anclado y su fecha en la cadena
 *   2. bajarse la lista de /api/leaderboard/<fecha> y recalcular el hash
 *   3. mirar las transferencias a los ganadores y ver que coinciden
 *
 * Lo que NO da, y conviene decirlo: no impide pagar a otra wallet. Da que se note
 * — pagar a alguien que no esta en una lista cuyo hash ya estaba publicado es una
 * contradiccion visible. El contrato de premios convierte ese "se nota" en un "no
 * se puede", y por eso vale lo que cuesta desplegarlo; pero mientras no lo haya,
 * esto es mucho mejor que nada.
 */
async function anclarDia(date, solana, log) {
    const eslabon = chain.find(e => e.date === date);
    if (!eslabon) return { ok: false, error: 'that day is not closed' };
    if (eslabon.sig) return { ok: true, sig: eslabon.sig, repetida: true };
    if (!solana || !solana.canWithdraw()) return { ok: false, error: 'no signing key available' };

    try {
        const { PublicKey, TransactionInstruction } = require('@solana/web3.js');
        // Mismo formato que los lotes de partidas: prefijo, identificador y hash.
        const memo = `PWLB${date}:${eslabon.hash}`;
        const sig = await solana.sendInstructions([new TransactionInstruction({
            programId: new PublicKey(MEMO_PROGRAM),
            keys: [],
            data: Buffer.from(memo, 'utf8'),
        })]);
        eslabon.sig = sig;
        eslabon.anchoredAt = new Date().toISOString();
        guardaCadena();
        if (log) log(`Leaderboard del ${date} anclado: ${sig}`);
        return { ok: true, sig };
    } catch (e) {
        if (log) log(`Leaderboard del ${date} NO anclado: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

/** Los dias cerrados que todavia no tienen su hash en la cadena. */
function sinAnclar() { return chain.filter(e => !e.sig).map(e => e.date); }

function cadena(limite = 400) { return chain.slice(-limite); }

/*
 * Recorre la cadena entera recalculando cada eslabon. Es la comprobacion que
 * cualquiera puede repetir con los ficheros publicados, y la que delataria un dia
 * reescrito a posteriori.
 */
function verificarCadena() {
    let prev = GENESIS;
    const fallos = [];
    for (const eslabon of chain) {
        const snap = diaCerrado(eslabon.date);
        if (!snap) { fallos.push({ date: eslabon.date, error: 'falta el snapshot del dia' }); prev = eslabon.hash; continue; }
        if (snap.prevHash !== prev) fallos.push({ date: eslabon.date, error: 'el prevHash no encadena con el dia anterior' });
        const recalculado = sha256hex(prev + canonico(snap.date, snap.entries));
        if (recalculado !== eslabon.hash) fallos.push({ date: eslabon.date, error: 'el hash no cuadra con el contenido publicado' });
        prev = eslabon.hash;
    }
    return { ok: fallos.length === 0, dias: chain.length, ultimoHash: prev, fallos };
}

/* ===================== REPARTO ===================== */

/*
 * Convierte el top 10 de un dia cerrado en la lista de premios.
 *
 * `presupuestoRaw` es lo que el grifo del contrato deja salir ese dia, en unidades
 * RAW del mint. Se reparte con los pesos y SE REDONDEA A LA BAJA: el sobrante (unas
 * pocas unidades minimas por el redondeo) se queda en la tesoreria. Repartir de mas
 * haria que el ultimo claim de la ronda fallara por fondos, que es la peor forma
 * posible de que se entere el jugador.
 *
 * Si un dia hay menos de 10 en la lista, los pesos de los puestos vacios NO se
 * reparten entre los presentes: se quedan sin salir. Que un dia flojo con 3
 * jugadores pague lo mismo que uno con 300 seria un incentivo perverso — bastaria
 * con jugar de madrugada.
 */
function repartoDe(snapshot, presupuestoRaw) {
    const top = (snapshot.entries || []).slice(0, PESOS.length);
    const presupuesto = BigInt(presupuestoRaw);
    const entries = [];
    for (let i = 0; i < top.length; i++) {
        const parte = (presupuesto * BigInt(Math.round(PESOS[i] * 10))) / 1000n;
        if (parte <= 0n) continue;
        entries.push({
            rank: top[i].rank,
            wallet: top[i].wallet,
            amountRaw: parte,
            name: top[i].name,
            score: top[i].kills,
        });
    }
    return { entries, totalRaw: entries.reduce((s, e) => s + e.amountRaw, 0n) };
}

module.exports = {
    recordKill, recordPeak,
    estadoHoy, diaCerrado, cadena, verificarCadena,
    cerrarAhora, repartoDe, tablaDe, setProveedorOponentes,
    anclarDia, sinAnclar,
    save,
    PESOS, MIN_KILLS, MIN_OPONENTES, MIN_CONOCIDOS_PCT, MIN_PARTIDAS, PUBLICADOS,
    _diversoBastante: diversoBastante,
    // Para los tests: la funcion de hash tiene que ser reproducible desde fuera, y
    // hay que poder simular el paso de los dias sin esperar a medianoche.
    _canonico: canonico, _sha256hex: sha256hex, GENESIS,
    _setFecha(date) { hoy.date = date; },
};
