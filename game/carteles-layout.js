/*
 * Espaciado de los carteles/pop-ups del juego.
 *
 * Como funciona:
 *   - CARTEL_SURFACES describe cada pop-up: donde esta su caja, su titulo, su
 *     texto y su fila de botones.
 *   - carteles-layout.json (repo) tiene el sitio y la escala de cada pieza. Es
 *     la UNICA fuente: el editor que guardaba ajustes en el servidor se quito
 *     el 11-sep-2026, y lo que tenia guardado produccion paso a este JSON.
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
        // Este tiene 13 variantes de titulo (claves sysModal#TITULO en el JSON).
        variantes: true,
    },
    exitModal: {
        label: 'LEAVE ARENA?', grupo: 'Sistema',
        box: '#exitModal .exit-box', title: '#exitModalTitle', desc: '#exitModalDesc', actions: '#exitModal .exit-actions',
    },
    resultOverlay: {
        label: 'Fin de partida (GAME OVER / MATCH FINISHED...)', grupo: 'Fin de partida',
        box: '#resultOverlay .result-box', title: '#resultTitle', desc: '#myResult',
        // `actions` mueve el BLOQUE de los tres botones; tryAgain/spectate/
        // backToMenu afinan cada uno por separado dentro del bloque (se suman:
        // el boton lleva el desplazamiento del bloque mas el suyo).
        actions: '#resultOverlay .result-actions',
        tryAgain: '#btnTryAgainOnline', spectate: '#resultOverlay .btn-spectate', backToMenu: '#btnBackToMenu',
        partes: ['title', 'desc', 'actions', 'tryAgain', 'spectate', 'backToMenu'],
    },
    prizeModal: {
        label: 'Premio (VICTORY / CASHOUT)', grupo: 'Fin de partida',
        box: '#prizeModal .gameModalBox', title: '#prizeTitle', desc: '#prizeSubtitle',
        // `actions` mueve el BLOQUE de los dos botones; share/continuar afinan
        // cada uno dentro del bloque (se suman), igual que en resultOverlay.
        actions: '#prizeModal .prize-actions',
        share: '#prizeShare', continuar: '#prizeContinue',
        partes: ['title', 'desc', 'actions', 'share', 'continuar'],
    },
    skillChoiceOverlay: {
        label: 'Eleccion de skill', grupo: 'Fin de partida',
        box: '#skillChoiceOverlay .skill-choice-card', title: '#skillChoiceTitle', desc: '#skillChoiceOverlay .skill-tips', actions: '#skillChoiceOverlay .skill-options',
    },
    gameDepositModal: {
            label: 'DEPOSIT', grupo: 'Wallet',
            // desc = .gm-body: "In wallet", "In GAME", Amount e input (se
            // escalan juntos).
            box: '#gameDepositModal .gameModalBox', title: '#gameDepositModal h3', desc: '#gameDepositModal .gm-body', actions: '#gdConfirm',
        },
        gameWithdrawModal: {
            label: 'WITHDRAW', grupo: 'Wallet',
            box: '#gameWithdrawModal .gameModalBox', title: '#gameWithdrawModal h3', desc: '#gameWithdrawModal .gm-body', actions: '#gwdConfirm',
        },
        /* STAKING. Es un gameModal como el deposito, pero mucho mas alto: la
           tarjeta del pozo, la de tu posicion, el campo y tres botones. `desc`
           apunta a la primera .stk-card (el pozo), que es el bloque que decide
           cuanto ocupa todo lo demas. */
        gameStakeModal: {
            label: 'STAKING', grupo: 'Wallet',
            box: '#gameStakeModal .gameModalBox', title: '#gameStakeModal h3',
            desc: '#gameStakeModal .stk-card', actions: '#gameStakeModal .stk-actions',
        },
        /* DAILY REWARDS. El unico de la lista que NO lleva marco de imagen: se
           dibuja en un canvas (_pmFrameDraw), el mismo de HOW TO PLAY. */
        rwOverlay: {
            label: 'DAILY REWARDS', grupo: 'Wallet',
            box: '#rwCard', title: '#rwOverlay .gc-title', desc: '#rwLista',
            // `actions` es la fila entera de YOUR REWARDS + CLAIM: el numero y el
            // boton se leen juntos, y moverlos por separado los descuadra.
            actions: '#rwOverlay .rw-mine', pie: '#rwNota',
            partes: ['title', 'desc', 'actions', 'pie'],
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
        roomInfoModal: {
            label: 'ROOM INFO', grupo: 'Menu',
            // desc = #riBody: las lineas (OPEN FOR / MATCH / PLAYERS / ENTRY /
            // WORTH NOW) mas el aviso del precio, que se escalan juntas.
            box: '#roomInfoModal .pw-modal-box', title: '#roomInfoModal .pw-modal-title',
            desc: '#riBody', actions: '#roomInfoModal .ri-actions',
        },
        settingsModal: {
            label: 'SETTINGS', grupo: 'Menu',
            box: '#settingsModal .pw-modal-box', title: '#settingsModal .pw-modal-title', desc: '#settingsModal .section-title', actions: '#settingsModal .pw-modal-cancel',
        },
        featuresModal: {
            label: 'FEATURES', grupo: 'Menu',
            box: '#featuresModal .pw-modal-box', title: '#featuresModal .pw-modal-title', desc: null, actions: '#featuresModal .pw-modal-cancel',
        },
        /* Cartel de la skin de pais (paises-pixel.js). Se afina UNA vez y vale
           para las 32: el contenido es siempre el mismo (codigo, nombre, lore,
           franjas, las cuatro pildoras y los botones), solo cambian los textos.
           `desc` apunta al lore, que es la pieza larga y la que descuadra el
           resto si se queda corta o se pasa. */
        paisModal: {
            label: 'Skin de pais (descripcion)', grupo: 'Skins',
            box: '#paisModal .pm-caja', title: '#paisModal .pm-nom', desc: '#paisModal .pm-lore',
            actions: '#paisModal .pm-btns',
            // Las cuatro pildoras y el pie se colocan aparte del lore: son lo
            // que mas sitio ocupa y lo que hay que cuadrar con el marco.
            crece: '#paisModal .pm-crece', pie: '#paisModal .pm-pie',
            partes: ['title', 'desc', 'crece', 'pie', 'actions'],
        },
    };

// Valores afinados (los del JSON). Vacio = todo de fabrica.
let CARTEL_LAYOUT = {};

// Las piezas que se pueden mover/escalar en un cartel. Un cartel puede declarar
// su propia lista en `partes` (el de fin de partida parte los botones en tres).
const CARTEL_PARTES = ['title', 'desc', 'actions'];
function cartelPartesDe(s) { return (s && s.partes) || CARTEL_PARTES; }

// Aplica un cartel. Cada pieza guarda {x, y, s} — desplazamiento en px y escala,
// el mismo esquema que el layout del menu. Una pieza sin entrada se
// queda exactamente donde la deja su CSS de siempre.
function applyCartelSurface(key, v) {
    const s = CARTEL_SURFACES[key];
    if (!s) return;
    for (const parte of cartelPartesDe(s)) {
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
// escala de la pieza `title`.
function cartelTitleW() { return null; }

// Carga los valores afinados de carteles-layout.json. Si falla (404, juego
// abierto sin servidor...), cada cartel se queda con su espaciado de fabrica.
const CARTEL_LAYOUT_READY = fetch('carteles-layout.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then(j => {
        CARTEL_LAYOUT = (j && typeof j === 'object') ? j : {};
        return CARTEL_LAYOUT;
    });
