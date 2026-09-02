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
 *                inmoviliza $PILL, por goteo.
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
/** En cuánto tiempo se gotea lo que va al staking. */
const GOTEO_SECS = parseInt(process.env.STAKE_DRIP_SECS, 10) || 86400;

let data = { aStake: 0, aTesoreria: 0, stakeado: 0, tesoreria: 0, movimientos: [] };
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
function alStaking(pill, motivo) {
    const n = Math.floor(Number(pill) || 0);
    if (n <= 0) return;
    data.aStake += n;
    dirty = true;
    apunta('stake', n, motivo);
}

/** Lo que sale del bote de los jugadores: va a la bóveda que paga el top 10. */
function aTesoreria(pill, motivo) {
    const n = Math.floor(Number(pill) || 0);
    if (n <= 0) return;
    data.aTesoreria += n;
    dirty = true;
    apunta('tesoreria', n, motivo);
}

// Un historial corto para el panel: de dónde salió cada cosa. No es contabilidad
// —esa está en transactions.log— sino para poder mirar y entender de un vistazo.
function apunta(destino, pill, motivo) {
    data.movimientos.push({ t: Date.now(), destino, pill, motivo: motivo || '' });
    if (data.movimientos.length > 200) data.movimientos = data.movimientos.slice(-200);
}

/* ===================== BARRIDO ===================== */

/*
 * Salda las dos colas. Si una transacción falla, esa cola NO se descuenta: la deuda
 * se queda entera y se reintenta. Perder tokens por un timeout del RPC sería mucho
 * peor que esperar al siguiente ciclo.
 */
async function barre(solana, treasuryClient, programId, log) {
    const hecho = { stake: null, tesoreria: null };
    if (SOLO_LECTURA || !programId) return hecho;
    if (!solana.canWithdraw()) return hecho;

    if (data.aStake >= MINIMO) {
        const cantidad = data.aStake;
        try {
            const ix = treasuryClient.fundStakeRewards(programId, {
                authority: solana.authorityPubkey(),
                amountRaw: solana.pillToRaw(cantidad),
                durationSecs: GOTEO_SECS,
            });
            const sig = await solana.sendInstructions([ix]);
            data.aStake -= cantidad;
            data.stakeado += cantidad;
            dirty = true; save();
            hecho.stake = { pill: cantidad, sig };
            if (log) log(`Rake: ${cantidad} $PILL al pozo del staking (goteo ${GOTEO_SECS / 3600} h) — ${sig}`);
        } catch (e) {
            if (log) log(`Rake al staking FALLIDO (${cantidad} $PILL siguen pendientes): ${e.message}`);
        }
    }

    if (data.aTesoreria >= MINIMO) {
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
            if (log) log(`Rake: ${cantidad} $PILL a la tesoreria — ${sig}`);
        } catch (e) {
            if (log) log(`Rake a tesoreria FALLIDO (${cantidad} $PILL siguen pendientes): ${e.message}`);
        }
    }
    return hecho;
}

function arranca(solana, treasuryClient, programId, log) {
    setInterval(() => { barre(solana, treasuryClient, programId, log).catch(() => {}); }, CADA_MS).unref();
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

module.exports = { alStaking, aTesoreria, barre, arranca, estado, save, MINIMO, GOTEO_SECS };
