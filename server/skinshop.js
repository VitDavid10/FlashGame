/*
 * TIENDA DE SKINS — compra, propiedad y quema de $PILL.
 *
 * Sigue el MISMO modelo que las salas de pago (ver warbank.js): el jugador
 * deposita $PILL una vez on-chain y a partir de ahi gasta de su saldo interno sin
 * firmar nada. Comprar una skin es instantaneo; lo unico que va a la cadena es la
 * quema, y va en diferido.
 *
 * DOS MONEDAS:
 *   - SP: se gana jugando (daily quests). Va por clientId, sin wallet.
 *   - $PILL: sale del saldo WAR, que exige wallet conectada y deposito previo.
 * 250 SP o 25.000 $PILL por skin, y el cambio 1000 $PILL -> 10 SP sale del mismo
 * ratio (100 $PILL por SP), no de una segunda constante.
 *
 * QUEMA. Todo el $PILL gastado aqui —comprando o cambiando a SP— se destruye: no
 * va a otra cartera de la que se pudiera sacar despues, se quema del mint y baja
 * el supply. Como quemar es una transaccion on-chain (lenta y con gas), NO se hace
 * dentro de la peticion del jugador: se apunta en una cola y un temporizador la
 * vacia. Asi comprar sigue siendo instantaneo y un devnet caido no bloquea la
 * tienda — la deuda de quema queda pendiente y se salda cuando vuelva.
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

let data = { equipped: {}, nonces: {}, quemaPendiente: 0, quemado: 0, quemas: [] };
try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data.equipped = j.equipped || {};
    data.nonces = j.nonces || {};
    data.quemaPendiente = j.quemaPendiente || 0;
    data.quemado = j.quemado || 0;
    data.quemas = j.quemas || [];
} catch (e) {}

let dirty = false;
function save() { if (!dirty) return; dirty = false; fs.writeFile(FILE, JSON.stringify(data), () => {}); }
setInterval(save, 3000);
process.on('SIGTERM', save); process.on('SIGINT', () => { save(); process.exit(0); });

// Purga de nonces viejos (>24h), igual que warbank con las firmas: si no, el mapa
// crece para siempre y acaba siendo el fichero mas gordo del servidor.
const NONCE_TTL_MS = 24 * 3600 * 1000;
setInterval(() => {
    const corte = Date.now() - NONCE_TTL_MS;
    let n = 0;
    for (const [k, v] of Object.entries(data.nonces)) if (v.t < corte) { delete data.nonces[k]; n++; }
    if (n) dirty = true;
}, 30 * 60 * 1000);

/* ===== ESTADO DEL JUGADOR ===== */
function estado(cid, wallet) {
    return {
        sp: skinpoints.getPoints(cid),
        pill: wallet ? warbank.getBalance(wallet) : 0,
        owned: skinpoints.ownedOf(cid),
        equipped: data.equipped[cid] || null,
        precioSp: PRECIO_SP, precioPill: PRECIO_PILL, pillPorSp: PILL_POR_SP,
    };
}

/* ===== COMPRA ===== */
// moneda: 'sp' | 'pill'. Devuelve { ok, estado } o { ok:false, error }.
function comprar({ cid, wallet, code, moneda, nonce }) {
    if (!cid) return { ok: false, error: 'sin sesion' };
    if (!ES_CODIGO(code)) return { ok: false, error: 'skin desconocida' };

    // Idempotencia: mismo nonce = misma compra. Se responde lo de la primera vez.
    const clave = cid + ':' + nonce;
    if (nonce && data.nonces[clave]) return { ok: true, repetida: true, estado: estado(cid, wallet) };

    if (skinpoints.ownedOf(cid).indexOf(code) !== -1) return { ok: false, error: 'ya la tienes' };

    if (moneda === 'sp') {
        if (skinpoints.spendPoints(cid, PRECIO_SP) === false) return { ok: false, error: 'SP insuficientes' };
    } else if (moneda === 'pill') {
        if (!wallet) return { ok: false, error: 'conecta la wallet' };
        if (warbank.debit(wallet, PRECIO_PILL) === false) return { ok: false, error: '$PILL insuficiente' };
        apuntaQuema(PRECIO_PILL);
    } else {
        return { ok: false, error: 'moneda no valida' };
    }

    skinpoints.addOwned(cid, code);
    // Primera skin: se pone sola. Si no, el jugador compra y no ve ningun cambio
    // hasta que ademas acierta a pulsar ASSIGN.
    if (!data.equipped[cid]) data.equipped[cid] = code;
    if (nonce) data.nonces[clave] = { t: Date.now() };
    dirty = true;
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== EQUIPAR ===== */
function equipar({ cid, wallet, code }) {
    if (!cid) return { ok: false, error: 'sin sesion' };
    if (code !== null && !ES_CODIGO(code)) return { ok: false, error: 'skin desconocida' };
    if (code !== null && skinpoints.ownedOf(cid).indexOf(code) === -1) return { ok: false, error: 'no la tienes' };
    if (code === null) delete data.equipped[cid]; else data.equipped[cid] = code;
    dirty = true;
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== CAMBIO $PILL -> SP ===== */
// Solo en ese sentido: el SP se gana jugando y no deberia poder revenderse por
// tokens, o el juego se convierte en una granja.
function convertir({ cid, wallet, pill, nonce }) {
    if (!cid) return { ok: false, error: 'sin sesion' };
    if (!wallet) return { ok: false, error: 'conecta la wallet' };
    pill = Math.floor(Number(pill) || 0);
    if (pill < CONVERSION_MIN_PILL) return { ok: false, error: 'minimo ' + CONVERSION_MIN_PILL + ' $PILL' };
    // Solo multiplos exactos: con el resto, cambiar 150 daria 1 SP y se comerian
    // 50 $PILL sin contrapartida.
    if (pill % PILL_POR_SP !== 0) return { ok: false, error: 'debe ser multiplo de ' + PILL_POR_SP };

    const clave = cid + ':conv:' + nonce;
    if (nonce && data.nonces[clave]) return { ok: true, repetida: true, estado: estado(cid, wallet) };

    if (warbank.debit(wallet, pill) === false) return { ok: false, error: '$PILL insuficiente' };
    apuntaQuema(pill);
    skinpoints.addPoints(cid, pill / PILL_POR_SP);
    if (nonce) data.nonces[clave] = { t: Date.now() };
    dirty = true;
    return { ok: true, estado: estado(cid, wallet) };
}

/* ===== QUEMA ===== */
function apuntaQuema(pill) { data.quemaPendiente += pill; dirty = true; }

function estadoQuema() {
    return { pendiente: data.quemaPendiente, quemado: data.quemado, ultimas: data.quemas.slice(-10) };
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
        if (log) log(`Quemados ${cantidad} $PILL — ${sig}`);
        return { ok: true, pill: cantidad, sig };
    } catch (e) {
        if (log) log(`Quema FALLIDA (${cantidad} $PILL siguen pendientes): ${e.message}`);
        return { ok: false, error: e.message };
    } finally {
        _quemando = false;
    }
}

function arrancaQuemaPeriodica(solana, log) {
    setInterval(() => { quemarPendiente(solana, log).catch(() => {}); }, QUEMA_CADA_MS);
}

module.exports = {
    estado, comprar, equipar, convertir,
    estadoQuema, quemarPendiente, arrancaQuemaPeriodica,
    PRECIO_SP, PRECIO_PILL, PILL_POR_SP, CODIGOS,
};
