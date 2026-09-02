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

/** Pesos del top 10. Los mismos que el reparto del bote de arcade
 *  (server/room-loop.js:156): ya estan calibrados y la gente los conoce. */
const PESOS = [35, 20, 13, 9, 7, 5, 4, 3, 2.5, 1.5];

const hoyUTC = () => new Date().toISOString().slice(0, 10);
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ===================== ESTADO ===================== */

let hoy = { date: hoyUTC(), players: {} };   // wallet -> { kills, peak, name }
let chain = [];                              // [{ date, prevHash, hash, players, closedAt }]

try { const j = JSON.parse(fs.readFileSync(TODAY_FILE, 'utf8')); if (j && j.date) hoy = j; } catch (e) {}
try { chain = JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf8')) || []; } catch (e) {}
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

let dirty = false;
function save() {
    if (!dirty) return;
    dirty = false;
    fs.writeFile(TODAY_FILE, JSON.stringify(hoy), () => {});
}
// unref: este temporizador no debe ser motivo para que el proceso siga vivo. En el
// servidor da igual (nunca termina), pero sin esto un test que solo importe el
// modulo se queda colgado cinco segundos por nada.
setInterval(save, 5000).unref();
process.on('SIGTERM', save);
process.on('SIGINT', () => { save(); process.exit(0); });

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

/** Filas ordenadas y ya filtradas, tal y como se publican. */
function tablaDe(players) {
    return Object.entries(players)
        .filter(([, p]) => p.kills >= MIN_KILLS)
        .sort(([wa, a], [wb, b]) => (b.kills - a.kills) || (b.peak - a.peak) || (wa < wb ? -1 : 1))
        .slice(0, PUBLICADOS)
        .map(([wallet, p], i) => ({ rank: i + 1, wallet, name: p.name || null, kills: p.kills, peak: p.peak }));
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
    const filas = tablaDe(hoy.players);
    const prevHash = chain.length ? chain[chain.length - 1].hash : GENESIS;
    const cuerpo = canonico(date, filas);
    const hash = sha256hex(prevHash + cuerpo);

    const snapshot = {
        date, prevHash, hash,
        closedAt: new Date().toISOString(),
        minKills: MIN_KILLS,
        criterio: 'kills del dia; desempate por masa maxima del dia',
        entries: filas,
    };
    try { fs.writeFileSync(path.join(DIR, date + '.json'), JSON.stringify(snapshot, null, 1)); } catch (e) {}

    chain.push({ date, prevHash, hash, players: filas.length, closedAt: snapshot.closedAt });
    try { fs.writeFileSync(CHAIN_FILE, JSON.stringify(chain)); } catch (e) {}

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
    return { date: hoy.date, cerrado: false, minKills: MIN_KILLS, entries: tablaDe(hoy.players) };
}

function diaCerrado(date) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, date + '.json'), 'utf8')); } catch (e) { return null; }
}

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
    cerrarAhora, repartoDe, tablaDe,
    save,
    PESOS, MIN_KILLS, PUBLICADOS,
    // Para los tests: la funcion de hash tiene que ser reproducible desde fuera, y
    // hay que poder simular el paso de los dias sin esperar a medianoche.
    _canonico: canonico, _sha256hex: sha256hex, GENESIS,
    _setFecha(date) { hoy.date = date; },
};
