/*
 * Atlas de imagenes para los 3 carteles del juego (banner de lobby, modal de
 * sistema, panel de seleccion de skill). Mismo patron que pixfont-hero.js: si
 * el PNG existe en game/img/cartel-hero/<id>.png se usa como marco/fondo
 * completo del cartel; si falta, el cartel sigue con su estilo procedural de
 * siempre (CSS / canvas 9-slice). Ver LEEME.txt en esa carpeta.
 */
'use strict';

// 'button' = skin compartido de los botones pixel (OK del modal, CONTINUE del
// premio, tarjetas de skill, TRY AGAIN/SPECTATE/MENU). Si existe button.png se
// usa como marco+fondo (border-image) de todos ellos; si falta, look de fábrica.
const CARTEL_IDS = ['lobbyBanner', 'sysModal', 'skillPanel', 'button', 'menu-square', 'game-over', 'pill', 'spectate', 'backtomenu', 'try-again',
    'menu-gris', 'warning', 'secure-cashout', 'cancel', 'exit-now', 'start-cashout', 'skill-slot',
    'top-mass', 'kills', 'x', 'song', 'sonido',
    // Contador de inicio (rotulo + digitos con glow) y premio VICTORY/CASHOUT
    // (titulos, panel verde fino y boton CONTINUE horneado).
    'match-starting', 'cd-1', 'cd-2', 'cd-3', 'cd-4', 'cd-5',
    'victory', 'cashout', 'continue', 'prize-panel', 'prize-panel-tall',
    // Titulos de fin de partida y modales de sistema, boton OK, X de cierre
    // de los gameModal y arte del bloqueo movil.
    'match-finished', 'room-restarted', 'match-ended', 'kicked', 'rejoin-expired',
    'deposit', 'ok', 'desktop-block',
    // Banners horneados con texto completo (recortes de David): aviso de
    // pentakill (3/4 kills). El bloom se pone por CSS (drop-shadow del color),
    // no en el PNG. Los del lobby (finding/found/announce) van con fuente
    // pixel + recuadro estilo ranking, sin PNG.
    'pentakill-2', 'one-more-kill',
    // Marco de piedra + fondo de los carteles ROOM · PRICES / DAILY QUESTS del
    // menu (contenido dinamico: solo el marco+fondo va en la imagen, el texto
    // se sigue pintando con HTML/CSS encima).
    'quest-panel',
    // Titulos horneados de los modales de wallet (marco verde del premio) y
    // del selector de wallet (CONNECT WALLET en blanco).
    'wallet-required', 'connect-error', 'deposit-failed', 'connect-wallet', 'payment-cancelled',
    // Resto de avisos de sistema y las 3 variantes de texto del modal de salida
    // (la cuarta, WARNING: FORFEIT?, y SECURE CASHOUT ya estaban arriba).
    'notice', 'wallet', 'withdraw-failed', 'withdraw-complete', 'deposit-complete',
    'insufficient-balance', 'connection-failed',
    'leave-arena', 'leave-lobby', 'stop-spectating',
    // X de cierre roja (arte de David, recortada de fondo magenta).
    'close-x-red',
    // OK gris (arte de David, recortado de un checker de transparencia
    // guardado como jpg): solo para los modales/mensajes de wallet que usan
    // el marco gris (menu-gris) — el resto de OK siguen con el verde.
    'ok-gris'];
const _cartelImg = new Map();   // id -> HTMLImageElement (solo si cargo bien)

const CARTEL_HERO_READY_PROMISE = Promise.all(CARTEL_IDS.map(id => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { _cartelImg.set(id, img); resolve(); };
    img.onerror = () => resolve();
    img.src = 'img/cartel-hero/' + id + '.png';
})));

function cartelHeroReady(id) { return _cartelImg.has(id); }
function cartelHeroUrl(id) { const img = _cartelImg.get(id); return img ? img.src : null; }

/*
 * Ancho de cada titulo horneado, en ancho-de-imagen / altura-de-MAYUSCULA.
 *
 * Sirve para calcular a que % ponerlo dentro de su cartel. El % no puede ser
 * fijo porque es un % del ANCHO de la caja: con el mismo numero, WALLET (6
 * letras) sale con la letra gigante e INSUFICIENT BALANCE (19) con la letra
 * diminuta. Partiendo de esta relacion se calcula el % que hace que la LETRA
 * mida lo mismo en todos.
 *
 * La altura es la de la mayuscula y no la del PNG a proposito: la Q de
 * REQUIRED y la Y de LOBBY cuelgan por debajo de la linea base, y medir el
 * alto total dejaria esos dos titulos mas pequenos que el resto.
 */
const CARTEL_TITLE_RATIO = {
    'notice': 3.90, 'wallet': 3.94, 'withdraw-failed': 8.75, 'withdraw-complete': 10.90,
    'deposit-complete': 10.03, 'insufficient-balance': 10.62, 'connection-failed': 9.84,
    'wallet-required': 8.95, 'connect-error': 8.48, 'deposit-failed': 8.58,
    'payment-cancelled': 10.09, 'kicked': 3.84, 'rejoin-expired': 7.76,
    'leave-arena': 7.41, 'leave-lobby': 7.29, 'stop-spectating': 9.62,
    'warning': 11.67, 'secure-cashout': 11.34,
};

// capPx = altura de mayuscula que se busca; caja = ancho INTERIOR del cartel en
// px (sin su padding). Un titulo que no quepa se topa a maxPct: ese si sale con
// la letra mas pequena que los demas, pero no hay mas sitio donde meterlo.
function cartelTitleFit(id, capPx, caja, maxPct) {
    const r = CARTEL_TITLE_RATIO[id];
    if (!r) return null;
    return Math.min(maxPct, Math.round(capPx * r / caja * 1000) / 10) + '%';
}
