/*
 * Espaciado de los carteles/pop-ups del juego, editable desde
 * carteles-preview.html (herramienta de desarrollo, solo en local).
 *
 * Como funciona:
 *   - CARTEL_SURFACES describe cada pop-up: donde esta su caja, su titulo, su
 *     texto y su fila de botones. Es la UNICA lista que hay que tocar para
 *     anadir un cartel nuevo al editor.
 *   - carteles-layout.json (repo) son los valores de fabrica, y encima se aplica
 *     lo que devuelve GET /api/carteles-layout, que es lo ultimo que guardo el
 *     editor (POST con ADMIN_KEY). Ese override lo guarda el servidor en
 *     globalsettings.json, fuera de git, para que deploy/update.sh no se lo
 *     lleve por delante al hacer `git reset --hard`.
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
        box: '#prizeModal .gameModalBox', title: '#prizeTitle', desc: '#prizeSubtitle', actions: '#prizeModal .gm-btn',
    },
    skillChoiceOverlay: {
        label: 'Eleccion de skill', grupo: 'Fin de partida',
        box: '#skillChoiceOverlay .skill-choice-card', title: '#skillChoiceTitle', desc: '#skillChoiceOverlay .skill-tips', actions: '#skillChoiceOverlay .skill-options',
    },
    gameDepositModal: {
            label: 'DEPOSIT', grupo: 'Wallet',
            // desc = .gm-body: "In wallet", "In GAME", Amount e input (escalables
            // juntos en carteles-preview). Antes solo apuntaba a label y no se
            // podia tocar el texto de las filas.
            box: '#gameDepositModal .gameModalBox', title: '#gameDepositModal h3', desc: '#gameDepositModal .gm-body', actions: '#gdConfirm',
        },
        gameWithdrawModal: {
            label: 'WITHDRAW', grupo: 'Wallet',
            box: '#gameWithdrawModal .gameModalBox', title: '#gameWithdrawModal h3', desc: '#gameWithdrawModal .gm-body', actions: '#gwdConfirm',
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
// el mismo esquema que el editor de layout del menu. Una pieza sin entrada se
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
// escala de la pieza `title` (rueda del raton en el editor).
function cartelTitleW() { return null; }

// Carga los valores afinados. Dos fuentes, y el override del servidor manda:
//   carteles-layout.json   -> fabrica, viaja en el repo.
//   GET /api/carteles-layout -> lo ultimo guardado desde el editor, vive en
//                               globalsettings.json (fuera de git) y por eso
//                               sobrevive a `git reset --hard` del update.
// Si cualquiera de las dos falla (404, juego abierto sin servidor...) se usa la
// otra; si fallan las dos, cada cartel se queda con su espaciado de fabrica.
const _cartelJSON = url => fetch(url, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then(j => (j && typeof j === 'object' ? j : {}));

const CARTEL_LAYOUT_READY = Promise.all([
    _cartelJSON('carteles-layout.json'),
    _cartelJSON('/api/carteles-layout'),
]).then(([fabrica, override]) => {
    // Merge por CARTEL (no por pieza): el editor guarda siempre el cartel
    // entero, asi que una entrada del override sustituye a la de fabrica. Los
    // carteles que el override no toca siguen con lo horneado en el repo.
    CARTEL_LAYOUT = Object.assign({}, fabrica, override);
    return CARTEL_LAYOUT;
});

/* --- Puente para carteles-preview.html -------------------------------------
 * El editor vive fuera del juego (lo carga en un iframe) y necesita llegar a
 * cosas que aqui son `const` de nivel superior. Ojo: un `const` de script NO
 * cuelga de window (solo las `function`), asi que hay que colgarlas a mano.
 * Los cuerpos se evaluan al llamarlos, por eso pueden referirse a cosas del
 * script inline de index.html que aun no existen cuando se define esto. */
window.CARTEL_SURFACES = CARTEL_SURFACES;
window.cartelPartesDe = cartelPartesDe;
window.cartelTitleFit = cartelTitleFit;
window.CARTELES_READY = Promise.all([
    typeof CARTEL_HERO_READY_PROMISE !== 'undefined' ? CARTEL_HERO_READY_PROMISE : null,
    CARTEL_LAYOUT_READY,
]).then(() => CARTEL_LAYOUT);
window.cartelDevShowPrize = msg => EconHUD.showPrize(msg);
/*
 * Cartel de skin para el editor: lo pinta el juego con su propia funcion (misma
 * que en partida) y elige marco gris o verde. `v` es '' o 'v2'.
 */
window.cartelDevShowPais = (code, v) => {
    // El marco DESPUES de abrir: el cartel se monta en la primera apertura, asi
    // que antes de eso su caja aun no existe y la clase se perdia.
    paisModalAbrir(code || 'ES');
    paisModalVariante(v || '');
    // El editor apaga todos los carteles con display:none inline antes de pintar
    // el que toca; este se enciende por clase (.on), y el inline le ganaba.
    const d = document.getElementById('paisModal');
    if (d) d.style.removeProperty('display');
};
/*
 * Texto de un cartel de fin de partida TAL CUAL lo pinta el juego. El editor
 * pone el estado (sala, modo, kills, carry/entrada) y llama a la MISMA
 * textoResultado() que corre en partida: asi no hay una copia del markup en el
 * editor que se quede vieja y acabe mintiendo sobre como se ve el cartel.
 * Solo para carteles-preview.html (ahi el juego nunca esta en partida).
 */
window.cartelDevResultText = st => {
    document.getElementById('killsVal').innerText = st.kills | 0;
    currentServer = st.server || 'Free';
    currentGameMode = st.mode || 'classic';
    EconHUD.carry = st.carry | 0;
    EconHUD.entry = st.entry | 0;
    return textoResultado(st.tipo, st.extra);
};
