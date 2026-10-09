/*
 * TIENDA DE SKINS — compra, propiedad y quema de $PILLY.
 *
 * Sigue el MISMO modelo que las salas de pago (ver warbank.js): el jugador
 * deposita $PILLY una vez on-chain y a partir de ahi gasta de su saldo interno sin
 * firmar nada. Comprar una skin es instantaneo; lo unico que va a la cadena es la
 * quema, y va en diferido.
 *
 * DOS MONEDAS:
 *   - SP: se gana jugando (daily quests). Va por clientId, sin wallet.
 *   - $PILLY: sale del saldo WAR, que exige wallet conectada y deposito previo.
 * 250 SP o 25.000 $PILLY por skin, y el cambio 1000 $PILLY -> 10 SP sale del mismo
 * ratio (100 $PILLY por SP), no de una segunda constante.
 *
 * A DONDE VA LO GASTADO. Al POZO DEL STAKING, que lo reparte entre quien inmoviliza
 * $PILLY. No se quema: quemar destruye los tokens y ya esta, mientras que mandarlos al
 * staking devuelve ese mismo dinero a la gente que sostiene el token. Con
 * PILL_TREASURY_PCT se puede volver a quemar una parte, pero por defecto no se quema
 * nada. Los premios del top 10 no salen de aqui: esos vienen del principal bloqueado
 * en la tesoreria (ver TESORERIA-PLAN.md).
 *
 * Como las dos son transacciones on-chain (lentas y con gas), NO se hacen dentro de
 * la peticion del jugador: se apuntan en una cola y un temporizador la vacia. Asi
 * comprar sigue siendo instantaneo y un devnet caido no bloquea la tienda — la deuda
 * queda pendiente y se salda cuando vuelva.
 *
 * ANTI DOBLE COBRO. Cada compra lleva un `nonce` del cliente. Si llega repetido
 * (reintento por red, doble clic, F5 a medio camino) se devuelve el resultado de
 * la primera sin volver a cobrar. Es lo mismo que hace warbank con las firmas de
 * deposito, y es lo que separa "cobrar una vez" de "cobrar tres".
 */
'use strict';

const fs = require('fs');
const path = require('path');
const skinpoints = require('./skinpoints.js');
const warbank = require('./warbank.js');

const FILE = path.join(__dirname, 'skinshop.json');

// Precio y cambio. PILL_POR_SP es la unica fuente: el precio en PILL y el ratio
// del conversor salen de el, asi que no pueden descuadrarse entre si.
const PRECIO_SP = 250;
const PILL_POR_SP = 100;
const PRECIO_PILL = PRECIO_SP * PILL_POR_SP;      // 25.000
const CONVERSION_MIN_PILL = PILL_POR_SP;          // no tiene sentido cambiar menos de 1 SP

// Los 32 codigos validos. Se valida contra esta lista y no contra "dos letras":
// sin ella, cualquiera podria comprar la skin "ZZ" y quedarse con una entrada
// basura en su inventario para siempre.
const CODIGOS = ['MX','ZA','CH','CA','BR','MA','IN','AU','PY','DE','CI','EC','NL','JP','SE','BE',
                 'EG','ES','CV','FR','NO','SN','AR','DZ','AT','CO','PT','CD','GB','HR','GH','CN'];
const ES_CODIGO = c => CODIGOS.indexOf(c) !== -1;

let data = { equipped: {}, nonces: {}, quemaPendiente: 0, quemado: 0, quemas: [], tesoreriaPendiente: 0, tesoreria: 0, barridos: [] };
try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data.equipped = j.equipped || {};
    data.nonces = j.nonces || {};
    data.quemaPendiente = j.quemaPendiente || 0;
    data.quemado = j.quemado || 0;
    data.quemas = j.quemas || [];
    // Campos nuevos: un skinshop.json de antes del split no los trae.
    data.tesoreriaPendiente = j.tesoreriaPendiente || 0;
    data.tesoreria = j.tesoreria || 0;
    data.barridos = j.barridos || [];
} catch (e) {}

let dirty = false;
function save() { if (!dirty) return; dirty = false; fs.writeFile(FILE, JSON.stringify(data), () => {}); }
// unref: en el servidor da igual (no termina nunca), pero sin esto un test que solo
// importe el modulo se queda colgado para siempre esperando a un temporizador.
setInterval(save, 3000).unref();
process.on('SIGTERM', save); process.on('SIGINT', () => { save(); process.exit(0); });

// Purga de nonces viejos (>24h), igual que warbank con las firmas: si no, el mapa
// crece para siempre y acaba siendo el fichero mas gordo del servidor.
const NONCE_TTL_MS = 24 * 3600 * 1000;
setInterval(() => {
    const corte = Date.now() - NONCE_TTL_MS;
    let n = 0;
    for (const [k, v] of Object.entries(data.nonces)) if (v.t < corte) { delete data.nonces[k]; n++; }
    if (n) dirty = true;
}, 30 * 60 * 1000).unref();

/* ===== ESTADO DEL JUGADOR ===== */
function estado(cid, wallet) {
    return {
        sp: skinpoints.getPoints(cid),
        pill: wallet ? warbank.getBalance(wallet) : 0,
        owned: skinpoints.ownedOf(cid),
        equipped: data.equipped[skinpoints.cuenta(cid)] || null,
        precioSp: PRECIO_SP, precioPill: PRECIO_PILL, pillPorSp: PILL_POR_SP,
    };
}

/* ===== COMPRA ===== */
// moneda: 'sp' | 'pill'. Devuelve { ok, estado } o { ok:false, error }.
function comprar({ cid, wallet, code, moneda, nonce }) {
    if (!cid) return { ok: false, error: 'no session' };
    if (!ES_CODIGO(code)) return { ok: false, error: 'unknown skin' };

    // Idempotencia: mismo nonce = misma compra. Se responde lo de la primera vez.
    const clave = cid + ':' + nonce;
    if (nonce && data.nonces[clave]) return { ok: true, repetida: true, estado: estado(cid, wallet) };

    if (skinpoints.ownedOf(cid).indexOf(code) !== -1) return { ok: false, error: 'you already own it' };

    if (moneda === 'sp') {
        if (skinpoints.spendPoints(cid, PRECIO_SP) === false) return { ok: false, error: 'not enough SP' };
    } else if (moneda === 'pill') {
        if (!wallet) return { ok: false, error: 'connect your wallet' };
        if (warbank.debit(wallet, PRECIO_PILL) === false) return { ok: false, error: 'not enough $PILLY' };
        apuntaQuema(PRECIO_PILL);
    } else {
        return { ok: false, error: 'invalid currency' };
    }

    skinpoints.addOwned(cid, code);
    // Primera skin: se pone sola. Si no, el jugador compra y no ve ningun cambio
    // hasta que ademas acierta a pulsar ASSIGN.
    const k = skinpoints.cuenta(cid);
    if (!data.equipped[k]) data.equipped[k] = code;
    if (nonce) data.nonces[clave] = { t: Date.now() };
    dirty = true;
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== EQUIPAR ===== */
function equipar({ cid, wallet, code }) {
    if (!cid) return { ok: false, error: 'no session' };
    if (code !== null && !ES_CODIGO(code)) return { ok: false, error: 'unknown skin' };
    if (code !== null && skinpoints.ownedOf(cid).indexOf(code) === -1) return { ok: false, error: "you don't own it" };
    const k = skinpoints.cuenta(cid);
    if (code === null) delete data.equipped[k]; else data.equipped[k] = code;
    dirty = true;
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== ENLAZAR A UNA CUENTA DE X ===== */
// El cid (este movil) pasa a la cuenta 'x_<id>': SP y skins se suman alli y la
// skin puesta, si la cuenta aun no llevaba ninguna, se queda la del movil.
function vincular(cid, acct, wallet) {
    if (!cid) return { ok: false, error: 'no session' };
    const antes = data.equipped[cid] || null;
    if (wallet && skinpoints.migraWallet(acct, wallet)) {
        const w = 'w_' + wallet;
        if (data.equipped[w]) { if (!data.equipped[acct]) data.equipped[acct] = data.equipped[w]; delete data.equipped[w]; }
        dirty = true;
    }
    if (skinpoints.linkCid(cid, acct)) {
        if (antes && !data.equipped[acct]) data.equipped[acct] = antes;
        delete data.equipped[cid];
        dirty = true;
    }
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== CAMBIO $PILLY -> SP ===== */
// Solo en ese sentido: el SP se gana jugando y no deberia poder revenderse por
// tokens, o el juego se convierte en una granja.
function convertir({ cid, wallet, pill, nonce }) {
    if (!cid) return { ok: false, error: 'no session' };
    if (!wallet) return { ok: false, error: 'connect your wallet' };
    pill = Math.floor(Number(pill) || 0);
    if (pill < CONVERSION_MIN_PILL) return { ok: false, error: 'minimum ' + CONVERSION_MIN_PILL + ' $PILLY' };
    // Solo multiplos exactos: con el resto, cambiar 150 daria 1 SP y se comerian
    // 50 $PILLY sin contrapartida.
    if (pill % PILL_POR_SP !== 0) return { ok: false, error: 'must be a multiple of ' + PILL_POR_SP };

    const clave = cid + ':conv:' + nonce;
    if (nonce && data.nonces[clave]) return { ok: true, repetida: true, estado: estado(cid, wallet) };

    if (warbank.debit(wallet, pill) === false) return { ok: false, error: 'not enough $PILLY' };
    apuntaQuema(pill);
    skinpoints.addPoints(cid, pill / PILL_POR_SP);
    if (nonce) data.nonces[clave] = { t: Date.now() };
    dirty = true;
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== SALIDA DEL $PILLY GASTADO: QUEMA Y/O TESORERIA =====
 *
 * Todo lo que se gasta aqui sale del saldo WAR del jugador, o sea que fisicamente
 * sigue en la custodia. Lo que se decide ahora es a donde va:
 *
 *   QUEMA     baja el supply del mint. Es irreversible y comprobable en el
 *             explorador, y es lo que sostiene la narrativa deflacionaria.
 *   TESORERIA sweep de custodia a la boveda bloqueada. No baja el supply, pero
 *             financia los premios diarios del top 10.
 *
 * PILL_TREASURY_PCT decide el reparto. Por defecto 0: TODO se quema, exactamente
 * como hasta ahora. Y tiene que ser 0 por defecto porque sin el programa de
 * tesoreria desplegado no hay a donde barrer — activarlo antes de tener contrato
 * dejaria una deuda de sweep creciendo sin nadie que la salde.
 *
 * El contrato no sabe que es una skin. Solo ve un numero. Por eso se pueden anadir
 * skins, cambiar precios o montar un pase de temporada sin tocarlo, que es lo que
 * permite dejarlo finalizado y con la upgrade authority revocada.
 */
/*
 * Cuanto de lo gastado en la tienda va al POZO DEL STAKING. El resto se quema.
 *
 * Por defecto 100: NO SE QUEMA NADA. La quema destruye tokens y punto; mandarlos al
 * staking los devuelve a la gente que sostiene el token, que es mejor uso del mismo
 * dinero. La instruccion de quema sigue en el contrato por si alguna vez interesa,
 * pero el flujo normal no la toca.
 */
const TESORERIA_PCT = (() => {
    const v = parseInt(process.env.PILL_TREASURY_PCT, 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
})();

/*
 * El reparto, aislado y sin estado, para poder comprobar la invariante que importa:
 * quema + tesoreria == lo gastado, EXACTAMENTE, con cualquier porcentaje y cualquier
 * cantidad. La tesoreria se lleva la parte redondeada a la baja y la quema el resto,
 * asi que el redondeo nunca pierde ni inventa un token.
 */
function repartoSalida(pill, pct) {
    const tesoreria = Math.floor(pill * pct / 100);
    return { tesoreria, quema: pill - tesoreria };
}

function apuntaSalida(pill) {
    const r = repartoSalida(pill, TESORERIA_PCT);
    data.quemaPendiente += r.quema;
    if (r.tesoreria > 0) data.tesoreriaPendiente = (data.tesoreriaPendiente || 0) + r.tesoreria;
    dirty = true;
}
// Nombre viejo: lo llaman comprar() y convertir(). Se deja para no tocar dos sitios
// por un renombrado.
function apuntaQuema(pill) { apuntaSalida(pill); }

function estadoQuema() {
    return {
        pendiente: data.quemaPendiente, quemado: data.quemado, ultimas: data.quemas.slice(-10),
        tesoreriaPct: TESORERIA_PCT,
        tesoreriaPendiente: data.tesoreriaPendiente || 0,
        tesoreria: data.tesoreria || 0,
        ultimosBarridos: (data.barridos || []).slice(-10),
    };
}

// Vacia la cola. Se llama sola cada QUEMA_CADA_MS y tambien desde admin.
// Si la transaccion falla, la deuda se queda entera: no se descuenta hasta que la
// cadena confirma. Perder tokens por un timeout del RPC seria peor que esperar.
/* Cada cuanto se mira la cola y cuanto tiene que haber para que merezca la pena.
 *
 * Una quema es una transaccion de Solana: 5.000 lamports (0,000005 SOL) de
 * comision. Barato, pero a un intervalo corto son transacciones a todas horas
 * por cantidades ridiculas, y el historial de quemas —que es justo lo que un
 * holder va a mirar en el explorador para comprobar que la promesa se cumple—
 * se llena de calderilla en vez de tener pocas quemas grandes y legibles.
 *
 * Por defecto: se revisa cada 6 h y solo se quema si hay al menos el precio de
 * UNA skin acumulado. Con eso son como mucho 4 transacciones al dia, y cada una
 * corresponde a algo que de verdad se compro.
 *
 * Ajustables sin tocar codigo: PILL_BURN_EVERY_MIN y PILL_BURN_MIN.
 * La deuda no se pierde por esperar — vive en skinshop.json y se salda entera
 * cuando toque, asi que alargar el intervalo no cuesta nada.
 */
const QUEMA_CADA_MS = (parseInt(process.env.PILL_BURN_EVERY_MIN, 10) || 360) * 60 * 1000;
const QUEMA_MINIMA = parseInt(process.env.PILL_BURN_MIN, 10) || PRECIO_PILL;
let _quemando = false;

async function quemarPendiente(solana, log) {
    if (_quemando) return { ok: false, error: 'ya hay una quema en curso' };
    const cantidad = data.quemaPendiente;
    if (cantidad < QUEMA_MINIMA) return { ok: false, error: 'pendiente por debajo del minimo' };
    if (!solana.canWithdraw()) return { ok: false, error: 'clave del treasury no disponible' };
    _quemando = true;
    try {
        const sig = await solana.burn(cantidad);
        data.quemaPendiente -= cantidad;
        data.quemado += cantidad;
        data.quemas.push({ pill: cantidad, sig, t: Date.now() });
        if (data.quemas.length > 50) data.quemas = data.quemas.slice(-50);
        dirty = true; save();
        if (log) log(`Quemados ${cantidad} $PILLY — ${sig}`);
        return { ok: true, pill: cantidad, sig };
    } catch (e) {
        if (log) log(`Quema FALLIDA (${cantidad} $PILLY siguen pendientes): ${e.message}`);
        return { ok: false, error: e.message };
    } finally {
        _quemando = false;
    }
}

/*
 * Barre a la tesoreria lo acumulado por la tienda. Mismo patron que la quema: la
 * deuda no se descuenta hasta que la cadena confirma, asi que un RPC caido solo
 * retrasa el barrido, nunca pierde tokens.
 *
 * El sweep va capado por epoca EN EL CONTRATO. Si la deuda acumulada supera el cap
 * de hoy, se barre lo que quepa y el resto espera al dia siguiente — por eso el
 * error del contrato no se trata como un fallo raro: es el funcionamiento normal
 * cuando hay un dia muy bueno de tienda.
 */
async function barrerPendiente(solana, treasuryClient, programId, log) {
    const cantidad = data.tesoreriaPendiente || 0;
    if (cantidad <= 0) return { ok: false, error: 'nada pendiente' };
    if (!programId) return { ok: false, error: 'sin programa de tesoreria configurado' };
    if (!solana.canWithdraw()) return { ok: false, error: 'clave de la autoridad no disponible' };
    try {
        /*
         * Al POZO DEL STAKING, no a la tesoreria bloqueada. Son dos grifos con
         * fuentes distintas: lo que la gente se gasta en el juego va a quien
         * inmoviliza $PILLY, y los premios del top 10 salen del principal de la
         * compra inicial. Si se mezclaran, el rendimiento del staking se comeria
         * el principal bloqueado o los premios dependerian de que el juego facture.
         *
         * Va por goteo (24 h) y no de golpe: si se soltara entero, cualquiera
         * stakearia un segundo antes de cada barrido y saldria despues.
         */
        const ix = require('./staking.js').ixFund({
            authority: solana.authorityPubkey(),
            amountRaw: solana.pillToRaw(cantidad),
            durationSecs: parseInt(process.env.STAKE_DRIP_SECS, 10) || 86400,
        });
        const sig = await solana.sendInstructions([ix]);
        data.tesoreriaPendiente -= cantidad;
        data.tesoreria += cantidad;
        data.barridos.push({ pill: cantidad, sig, t: Date.now() });
        if (data.barridos.length > 50) data.barridos = data.barridos.slice(-50);
        dirty = true; save();
        if (log) log(`Barridos ${cantidad} $PILLY de la tienda al pozo del staking — ${sig}`);
        return { ok: true, pill: cantidad, sig };
    } catch (e) {
        if (log) log(`Barrido FALLIDO (${cantidad} $PILLY siguen pendientes): ${e.message}`);
        return { ok: false, error: e.message };
    }
}

function arrancaQuemaPeriodica(solana, log, treasuryClient, programId) {
    setInterval(() => {
        quemarPendiente(solana, log).catch(() => {});
        if (programId) barrerPendiente(solana, treasuryClient, programId, log).catch(() => {});
    }, QUEMA_CADA_MS);
}

module.exports = {
    vincular,
    estado, comprar, equipar, convertir,
    estadoQuema, quemarPendiente, barrerPendiente, arrancaQuemaPeriodica, repartoSalida,
    PRECIO_SP, PRECIO_PILL, PILL_POR_SP, CODIGOS, TESORERIA_PCT,
};
