/*
 * Espaciado de los carteles/pop-ups del juego, editable desde
 * carteles-preview.html (herramienta de desarrollo, solo en local).
 *
 * Como funciona:
 *   - CARTEL_SURFACES describe cada pop-up: donde esta su caja, su titulo, su
 *     texto y su fila de botones. Es la UNICA lista que hay que tocar para
 *     anadir un cartel nuevo al editor.
 *   - carteles-layout.json guarda los valores ya afinados. Es un fichero del
 *     repo: lo escribe el editor via POST /api/carteles-layout (bloqueado a
 *     localhost) y viaja en el commit, asi que lo que afinas en local es lo que
 *     acaba en produccion.
 *   - applyCartelLayout() los aplica como estilos INLINE. Tiene que ser inline
 *     porque el pixel-pack mete su CSS con !important y se generaria una pelea
 *     de especificidad; inline + important gana siempre.
 *
 * Si el JSON no existe o viene vacio, no se toca nada y cada cartel se queda
 * con el espaciado que trae de fabrica en su CSS.
 */
'use strict';

// prop -> a que elemento y que propiedad CSS le toca.
//   padT/padB/padX -> padding de la caja
//   gapTitle       -> margen inferior del titulo (titulo -> texto)
//   gapText        -> margen inferior del texto  (texto  -> botones)
//   fontSize       -> tamano del texto descriptivo
//   titleW         -> ancho en % del titulo, solo si es una imagen horneada
const CARTEL_SURFACES = {
    sysModal: {
        label: 'Aviso de sistema', grupo: 'Sistema',
        box: '#sysModal .exit-box', title: '#sysModalTitle', desc: '#sysModalDesc', actions: '#sysModal .exit-actions',
        // Este tiene 13 variantes de titulo; el editor las lista aparte.
        variantes: true,
    },
    exitModal: {
        label: 'LEAVE ARENA?', grupo: 'Sistema',
        box: '#exitModal .exit-box', title: '#exitModalTitle', desc: '#exitModalDesc', actions: '#exitModal .exit-actions',
    },
    resultOverlay: {
        label: 'Fin de partida (GAME OVER / MATCH FINISHED...)', grupo: 'Fin de partida',
        box: '#resultOverlay .result-box', title: '#resultTitle', desc: '#myResult', actions: '#resultOverlay .btn-spectate',
    },
    prizeModal: {
        label: 'Premio (VICTORY / CASHOUT)', grupo: 'Fin de partida',
        box: '#prizeModal .gameModalBox', title: '#prizeTitle', desc: '#prizeSubtitle', actions: '#prizeModal .gm-btn',
    },
    skillChoiceOverlay: {
        label: 'Eleccion de skill', grupo: 'Fin de partida',
        box: '#skillChoiceOverlay .skill-choice-card', title: '#skillChoiceTitle', desc: '#skillChoiceOverlay .skill-tips', actions: '#skillChoiceOverlay .skill-options',
    },
    gameDepositModal: {
        label: 'DEPOSIT', grupo: 'Wallet',
        box: '#gameDepositModal .gameModalBox', title: '#gameDepositModal h3', desc: '#gameDepositModal label', actions: '#gdConfirm',
    },
    gameWithdrawModal: {
        label: 'WITHDRAW', grupo: 'Wallet',
        box: '#gameWithdrawModal .gameModalBox', title: '#gameWithdrawModal h3', desc: '#gameWithdrawModal label', actions: '#gwdConfirm',
    },
    walletPickerModal: {
        label: 'CONNECT WALLET', grupo: 'Wallet',
        box: '#walletPickerModal .pw-modal-box', title: '#walletPickerModal .wp-title', desc: null, actions: '#walletPickerModal .pw-modal-cancel',
    },
    playChoiceModal: {
        label: 'CHOOSE HOW TO PLAY', grupo: 'Menu',
        box: '#playChoiceModal .pw-modal-box', title: '#playChoiceModal .pw-modal-title', desc: '#playChoiceModal .pw-btn-sub', actions: '#playChoiceModal .pw-modal-cancel',
    },
    roomChoiceModal: {
        label: 'SELECT A ROOM', grupo: 'Menu',
        box: '#roomChoiceModal .pw-modal-box', title: '#roomChoiceModal .wp-title', desc: '#roomChoiceModal .pw-btn-sub', actions: '#roomChoiceModal .wp-cancel',
    },
    settingsModal: {
        label: 'SETTINGS', grupo: 'Menu',
        box: '#settingsModal .pw-modal-box', title: '#settingsModal .pw-modal-title', desc: '#settingsModal .section-title', actions: '#settingsModal .pw-modal-cancel',
    },
    featuresModal: {
        label: 'FEATURES', grupo: 'Menu',
        box: '#featuresModal .pw-modal-box', title: '#featuresModal .pw-modal-title', desc: null, actions: '#featuresModal .pw-modal-cancel',
    },
};

// Valores afinados (los del JSON). Vacio = todo de fabrica.
let CARTEL_LAYOUT = {};

// Las tres piezas que se pueden mover/escalar en cada cartel.
const CARTEL_PARTES = ['title', 'desc', 'actions'];

// Aplica un cartel. Cada pieza guarda {x, y, s} — desplazamiento en px y escala,
// el mismo esquema que el editor de layout del menu. Una pieza sin entrada se
// queda exactamente donde la deja su CSS de siempre.
function applyCartelSurface(key, v) {
    const s = CARTEL_SURFACES[key];
    if (!s) return;
    for (const parte of CARTEL_PARTES) {
        const sel = s[parte];
        if (!sel) continue;
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = v && v[parte];
        if (!t) { el.style.removeProperty('transform'); continue; }
        const x = +t.x || 0, y = +t.y || 0, sc = (typeof t.s === 'number' && t.s > 0) ? t.s : 1;
        // translate + scale y no margenes: mover una pieza no debe reflotar a
        // las de al lado, que es justo lo que hace tocar el margin.
        el.style.setProperty('transform', 'translate(' + x + 'px,' + y + 'px) scale(' + sc + ')', 'important');
        el.style.setProperty('transform-origin', 'center', 'important');
    }
}

function applyCartelLayout(layout) {
    if (layout) CARTEL_LAYOUT = layout;
    for (const k of Object.keys(CARTEL_LAYOUT)) applyCartelSurface(k, CARTEL_LAYOUT[k]);
}

// El ancho del titulo horneado ya no se toca aqui: el tamano se ajusta con la
// escala de la pieza `title` (rueda del raton en el editor).
function cartelTitleW() { return null; }

// Carga el JSON afinado. Si no existe (404) o esta vacio se sigue de fabrica.
const CARTEL_LAYOUT_READY = fetch('carteles-layout.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then(j => { CARTEL_LAYOUT = j && typeof j === 'object' ? j : {}; return CARTEL_LAYOUT; });

/* --- Puente para carteles-preview.html -------------------------------------
 * El editor vive fuera del juego (lo carga en un iframe) y necesita llegar a
 * cosas que aqui son `const` de nivel superior. Ojo: un `const` de script NO
 * cuelga de window (solo las `function`), asi que hay que colgarlas a mano.
 * Los cuerpos se evaluan al llamarlos, por eso pueden referirse a cosas del
 * script inline de index.html que aun no existen cuando se define esto. */
window.CARTEL_SURFACES = CARTEL_SURFACES;
window.CARTELES_READY = Promise.all([
    typeof CARTEL_HERO_READY_PROMISE !== 'undefined' ? CARTEL_HERO_READY_PROMISE : null,
    CARTEL_LAYOUT_READY,
]).then(() => CARTEL_LAYOUT);
window.cartelDevShowPrize = msg => EconHUD.showPrize(msg);
