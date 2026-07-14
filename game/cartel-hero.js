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
    'victory', 'cashout', 'continue', 'prize-panel'];
const _cartelImg = new Map();   // id -> HTMLImageElement (solo si cargo bien)

const CARTEL_HERO_READY_PROMISE = Promise.all(CARTEL_IDS.map(id => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { _cartelImg.set(id, img); resolve(); };
    img.onerror = () => resolve();
    img.src = 'img/cartel-hero/' + id + '.png';
})));

function cartelHeroReady(id) { return _cartelImg.has(id); }
function cartelHeroUrl(id) { const img = _cartelImg.get(id); return img ? img.src : null; }
