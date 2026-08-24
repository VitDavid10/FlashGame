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
// lobbyBanner y sysModal NO estan en la lista a proposito: su PNG no existe y
// no hace falta. El arte de esos dos carteles ya va bien con su estilo de
// siempre (CSS), asi que pedirlos solo servia para soltar dos 404 por carga.
// Si algun dia se hornean, basta con volver a ponerlos aqui.
const CARTEL_IDS = ['skillPanel', 'button', 'menu-square', 'game-over', 'pill', 'spectate', 'backtomenu', 'try-again',
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
    // ROOM · PRICES / DAILY QUESTS: el marco de piedra ya NO se pide por aqui.
    // Esos dos carteles los pinta el <canvas class="quest-video-bg"> desde
    // quest-panel-v2.png (ver el bucle en index.html), asi que 'quest-panel'
    // se quedaba descargando 851 KB que nadie usaba: no habia ni un
    // cartelUsesAtlas('quest-panel') vivo y el border-image estaba anulado
    // expresamente en buildPixPanelCss.
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
    // Paleta de colores de la pildora del menu: marco de piedra con 10 ventanas
    // TRANSPARENTES (los colores se pintan detras y asoman por ellas) y la placa
    // de abajo como boton de color libre. Arte de David, recortado del mismo
    // fondo magenta.
    'palette',
    // Barra de wallet: el rojo VACIO que comparten CONNECT/DEPOSIT/WITHDRAW/
    // DISCONNECT (el texto va por CSS encima) y el azul de PLAY ONLINE.
    // wallet-connect.png (el rojo con "CONNECT" horneado) ya no se usa: CONNECT
    // pasa a compartir recuadro con DEPOSIT. ingame-bar.png (el recuadro azul
    // del saldo) tampoco: el IN GAME vuelve a su caja oscura de siempre, que se
    // ajusta al ancho del texto — con el recuadro fijo la cifra se salia.
    // wallet-btn-blue = el mismo rojo pero en azul (PLAY ONLINE del popup de
    // PLAY y los botones de calidad de SETTINGS).
    'wallet-btn-red', 'wallet-btn-blue', 'btn-azul',
    // OK gris (arte de David, recortado de un checker de transparencia
    // guardado como jpg): solo para los modales/mensajes de wallet que usan
    // el marco gris (menu-gris) — el resto de OK siguen con el verde.
    'ok-gris'];
const _cartelImg = new Map();   // id -> HTMLImageElement (solo si cargo bien)

/*
 * La descarga NO arranca al parsear el script: son ~9 MB que la pantalla de
 * seleccion ARCADE/CLASSIC no necesita, y pedirlos ahi dejaba el menu esperando.
 * Los dispara cartelHeroLoad() desde index.html (al elegir modo, y como red de
 * seguridad unos segundos despues de que la pagina termine de cargar, para los
 * caminos que no pasan por ahi: bloqueo movil, ?pwlab...).
 * CARTEL_HERO_READY_PROMISE se comporta igual que antes para quien la espera:
 * resuelve cuando estan todas, solo que empieza mas tarde.
 */
let _cartelHeroGo = null;
const CARTEL_HERO_READY_PROMISE = new Promise(r => { _cartelHeroGo = r; }).then(() =>
    Promise.all(CARTEL_IDS.map(id => new Promise(resolve => {
        const img = new Image();
        img.onload = () => { _cartelImg.set(id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = 'img/cartel-hero/' + id + '.png';
    }))));
function cartelHeroLoad() { const go = _cartelHeroGo; if (go) { _cartelHeroGo = null; go(); } }

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
