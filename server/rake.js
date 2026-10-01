/*
 * LO QUE SE QUEDA LA CASA — y a cuál de las dos bolsas va.
 *
 * Hasta ahora este dinero existía pero no se contabilizaba: el exit fee de classic se
 * descontaba del saldo interno y los tokens se quedaban en custodia sin que nadie
 * apuntara de quién eran. Aquí se apunta, se separa por destino y se barre a la cadena.
 *
 * DOS DESTINOS, y no es lo mismo:
 *
 *   AL STAKING   los ingresos corrientes del juego. Se reparten entre quien
 *                inmoviliza $PILLY, por goteo.
 *                  - exit fee de classic (10/20/50 % según kills)
 *                  - tienda de skins y conversor de SP
 *
 *   A TESORERIA  lo que sale del bote de los jugadores. Va a la bóveda bloqueada,
 *                que es la que paga los premios del top 10 diario.
 *                  - 5 % del bote de arcade
 *                  - la entrada de quien se desconecta y no vuelve
 *
 * POR QUE ESTA SEPARACION. El staking se alimenta de lo que el juego factura; los
 * premios de gameplay, del principal y de lo que los propios jugadores dejan en la
 * mesa. Si se mezclaran, un mes flojo de tienda dejaría sin premios al top 10, y un
 * bote grande inflaría el rendimiento del staking sin que nadie hubiera gastado nada.
 *
 * SE BARRE EN DIFERIDO, como la quema: mover tokens es una transacción con gas, y
 * hacerla dentro del tick de una partida sería meter la latencia de Solana en el
 * bucle del juego. Se acumula y un temporizador lo salda. La deuda vive en disco, así
 * que un RPC caído la retrasa pero no la pierde.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.LB_DIR || __dirname, 'rake.json');
const SOLO_LECTURA = process.env.PW_ROLE === 'host';

/** Cada cuánto se intenta saldar. Igual que la quema: pocas transacciones grandes
 *  y legibles en el explorador, en vez de calderilla a todas horas. */
const CADA_MS = (parseInt(process.env.RAKE_SWEEP_MIN, 10) || 360) * 60 * 1000;
/** Por debajo de esto no compensa el gas. */
const MINIMO = parseInt(process.env.RAKE_SWEEP_MIN_PILL, 10) || 1000;
/*
 * EN CUANTO TIEMPO SE GOTEA lo que va al staking. Una semana.
 *
 * Lo que se recauda hoy no se reparte hoy: alimenta la semana siguiente. Asi el
 * rendimiento no da saltos con los dias buenos y malos, y quien entra a stakear ve
 * un APR que se sostiene unos dias en vez de uno que cambia cada mañana.
 *
 * OJO CON LA DIFERENCIA entre esto y CADA_MS, que es la que importa:
 *
 *   CADA_MS     cada cuanto el dinero ENTRA en la boveda   (6 h)
 *   GOTEO_SECS  en cuanto tiempo se REPARTE lo que hay     (7 dias)
 *
 * Son dos cosas distintas y conviene no juntarlas. Barrer una vez por semana daria
 * el mismo reparto pero dejaria SIETE DIAS de recaudacion en la wallet caliente del
 * servidor en vez de seis horas: si esa clave cae en malas manos, la diferencia
 * entre perder lo de una tarde y lo de una semana. Con barridos frecuentes y goteo
 * largo se consigue lo bueno de las dos.
 *
 * Y una consecuencia del acumulador que conviene saber: cada aportacion SUMA lo que
 * quedaba por repartir y reinicia el periodo a siete dias. El pozo se vacia de forma
 * asintotica —siempre queda una cola— que es justo lo que evita el escalon de "hoy
 * se acabo lo de la semana pasada".
 */
const GOTEO_SECS = parseInt(process.env.STAKE_DRIP_SECS, 10) || 604800;

/*
 * `porDia` es el rake de cada dia UTC, y es lo que decide el premio del leaderboard.
 *
 * No vale medirlo por lo que se cobro en entradas: en classic la entrada SE CONVIERTE
 * en tu carry (game-host.js), y quien gana la sala con 5 kills cobra sin fee. Veinte
 * wallets propias entrando juntas, una matando a las otras diecinueve, recuperan las
 * veinte entradas enteras — el ataque cuesta CERO y se lleva el premio de regalo.
 *
 * Lo que no se puede falsear es lo que la casa se queda de verdad: exit fees,
 * comision de arcade, entradas de los que no vuelven, botes sin reclamar. Jugando
 * contra ti mismo eso da cero, porque el que gana no paga fee y los muertos no
 * llevaban nada. Y con jugadores de verdad da mucho, porque casi nadie gana la sala.
 *
 * Se guardan 30 dias: el ciclo de premios mira como mucho 7 atras.
 */
let data = { aStake: 0, aTesoreria: 0, stakeado: 0, tesoreria: 0, movimientos: [], porDia: {} };
try { data = Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}

let dirty = false;
function save() {
    if (!dirty || SOLO_LECTURA) return;
    dirty = false;
    try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch (e) {}
}
setInterval(save, 5000).unref();
process.on('SIGTERM', save);
process.on('SIGINT', () => { save(); process.exit(0); });

/* ===================== APUNTES ===================== */

/** Ingresos corrientes del juego: van a repartirse entre quien stakea. */
function alStaking(pill, motivo, ts) {
    const n = Math.floor(Number(pill) || 0);
    if (n <= 0) return;
    data.aStake += n;
    dirty = true;
    apunta('stake', n, motivo, ts);
}

/** Lo que sale del bote de los jugadores: va a la bóveda que paga el top 10. */
function aTesoreria(pill, motivo, ts) {
    const n = Math.floor(Number(pill) || 0);
    if (n <= 0) return;
    data.aTesoreria += n;
    dirty = true;
    apunta('tesoreria', n, motivo, ts);
}

/** El dia UTC de un instante, en YYYY-MM-DD. El mismo corte que el leaderboard. */
function diaDe(ts) { return new Date(ts).toISOString().slice(0, 10); }

/** Lo que la casa se quedo ese dia, en PILL. 0 si no hay nada apuntado. */
function delDia(fecha) { return (data.porDia && data.porDia[fecha]) || 0; }

// Un historial corto para el panel: de dónde salió cada cosa. No es contabilidad
// —esa está en transactions.log— sino para poder mirar y entender de un vistazo.
// `ts` es el momento del EVENTO, no el del apunte. Casi siempre son el mismo, pero
// un exit fee de una partida que acabo a las 23:59:59 tiene que contar en su dia y no
// en el siguiente: el premio de ese dia se calcula sobre ese rake.
function apunta(destino, pill, motivo, ts) {
    const dia = diaDe(ts || Date.now());
    if (!data.porDia) data.porDia = {};
    data.porDia[dia] = (data.porDia[dia] || 0) + pill;
    // Poda: 30 dias es de sobra para un ciclo que mira 7 atras, y evita que el
    // fichero crezca sin limite durante anios.
    const claves = Object.keys(data.porDia);
    if (claves.length > 30) for (const k of claves.sort().slice(0, claves.length - 30)) delete data.porDia[k];

    data.movimientos.push({ t: Date.now(), destino, pill, motivo: motivo || '' });
    if (data.movimientos.length > 200) data.movimientos = data.movimientos.slice(-200);
}

/* ===================== BARRIDO ===================== */

/*
 * Salda las dos colas. Si una transacción falla, esa cola NO se descuenta: la deuda
 * se queda entera y se reintenta. Perder tokens por un timeout del RPC sería mucho
 * peor que esperar al siguiente ciclo.
 */
async function barre(solana, treasuryClient, programId, log, stakingMod, apunta) {
    const staking = stakingMod || require('./staking.js');
    const hecho = { stake: null, tesoreria: null };
    if (SOLO_LECTURA) return hecho;
    // El pozo del staking va por su propio programa, que puede estar desplegado sin
    // que lo este la tesoreria. La cola de tesoreria si necesita `programId`.
    if (!programId && !staking.PROGRAMA) return hecho;
    if (!solana.canWithdraw()) return hecho;

    if (data.aStake >= MINIMO && staking.PROGRAMA) {
        const cantidad = data.aStake;
        try {
            const ix = staking.ixFund({
                // Con el contrato aparte el rake sale de la cuenta de la autoridad
                // —ese no custodia nada mas que el staking— y con el de la tesoreria,
                // de su propia boveda. Cual de las dos, lo decide el adaptador.
                authority: solana.authorityPubkey(),
                amountRaw: solana.pillToRaw(cantidad),
                durationSecs: GOTEO_SECS,
            });
            const sig = await solana.sendInstructions([ix]);
            data.aStake -= cantidad;
            data.stakeado += cantidad;
            dirty = true; save();
            hecho.stake = { pill: cantidad, sig };
            if (apunta) apunta('staking', cantidad, sig);
            if (log) log(`Rake: ${cantidad} $PILLY al pozo del staking (goteo ${GOTEO_SECS / 3600} h) — ${sig}`);
        } catch (e) {
            if (log) log(`Rake al staking FALLIDO (${cantidad} $PILLY siguen pendientes): ${e.message}`);
        }
    }

    if (data.aTesoreria >= MINIMO && programId) {
        const cantidad = data.aTesoreria;
        try {
            const ix = treasuryClient.sweep(programId, {
                authority: solana.authorityPubkey(),
                amountRaw: solana.pillToRaw(cantidad),
            });
            const sig = await solana.sendInstructions([ix]);
            data.aTesoreria -= cantidad;
            data.tesoreria += cantidad;
            dirty = true; save();
            hecho.tesoreria = { pill: cantidad, sig };
            if (apunta) apunta('treasury', cantidad, sig);
            if (log) log(`Rake: ${cantidad} $PILLY a la tesoreria — ${sig}`);
        } catch (e) {
            if (log) log(`Rake a tesoreria FALLIDO (${cantidad} $PILLY siguen pendientes): ${e.message}`);
        }
    }
    return hecho;
}

function arranca(solana, treasuryClient, programId, log, apunta) {
    setInterval(() => {
        barre(solana, treasuryClient, programId, log, null, apunta).catch(() => {});
    }, CADA_MS).unref();
}

function estado() {
    return {
        pendienteStaking: data.aStake,
        pendienteTesoreria: data.aTesoreria,
        totalStaking: data.stakeado,
        totalTesoreria: data.tesoreria,
        minimo: MINIMO,
        ultimos: data.movimientos.slice(-20),
    };
}

module.exports = { alStaking, aTesoreria, barre, arranca, estado, save, delDia, MINIMO, GOTEO_SECS };
