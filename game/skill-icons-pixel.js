/*
 * Atlas de iconos pixel-art para las 8 skills. Mismo patron que cartel-hero.js:
 * si el PNG existe en game/img/skill-icons-pixel/<key>.png se usa en vez del
 * icono clasico de siempre (game/img/<key>.png via .icon-xxx); si falta, la
 * skill sigue con su icono clasico — el juego nunca se rompe por un icono
 * ausente. Ver LEEME.txt en esa carpeta.
 */
'use strict';

// key -> clase CSS .icon-xxx que ya usan la barra de habilidades, la rejilla
// de seleccion y las tarjetas de skill (ver SKILL_ICONS en index.html).
const SKILL_ICON_CLASS = { clon: 'icon-clon', shoot: 'icon-shot', sprint: 'icon-sprint', tp: 'icon-tp', iman: 'icon-magnet', inmune: 'icon-shield', big: 'icon-big', random: 'icon-random' };
// id de skill (SKILL_DESCRIPTIONS/SKILL_ICONS) -> misma key, para el tooltip y
// los iconos de buff activo (que usan <img src> directo, no la clase CSS).
const SKILL_ICON_KEY_BY_ID = { 1: 'clon', 2: 'shoot', 3: 'sprint', 4: 'tp', 5: 'iman', 6: 'inmune', 7: 'big', 8: 'random' };
const _skillIconImg = new Map(); // key -> HTMLImageElement (solo si cargo bien)

// Igual que cartel-hero.js: ~5.9 MB que solo hacen falta dentro de la partida,
// asi que la descarga no arranca al parsear — la dispara skillIconLoad().
let _skillIconGo = null;
const SKILL_ICON_READY_PROMISE = new Promise(r => { _skillIconGo = r; }).then(() =>
    Promise.all(Object.keys(SKILL_ICON_CLASS).map(key => new Promise(resolve => {
        const img = new Image();
        img.onload = () => { _skillIconImg.set(key, img); resolve(); };
        img.onerror = () => resolve();
        img.src = 'img/skill-icons-pixel/' + key + '.png';
    }))));
function skillIconLoad() { const go = _skillIconGo; if (go) { _skillIconGo = null; go(); } }

// URL a usar para el <img>/background-image de un icono de skill (tooltip,
// buffs activos): pixel si estamos en pixel-pack y el PNG cargo, si no el
// classicUrl de siempre que ya vale para los dos modos.
function skillIconUrl(id, classicUrl) {
    const key = SKILL_ICON_KEY_BY_ID[id];
    const img = key && _skillIconImg.get(key);
    return (typeof pixelMode !== 'undefined' && pixelMode && img) ? img.src : classicUrl;
}

function buildSkillIconPixelCss() {
    let css = '';
    for (const [key, cls] of Object.entries(SKILL_ICON_CLASS)) {
        const img = _skillIconImg.get(key);
        if (img) css += 'body.pixel-pack .' + cls + '{background-image:url(\'' + img.src + '\')!important}';
    }
    if (!css) return;
    const old = document.getElementById('skillIconPixelCss'); if (old) old.remove();
    const st = document.createElement('style'); st.id = 'skillIconPixelCss'; st.textContent = css;
    document.head.appendChild(st);
}
SKILL_ICON_READY_PROMISE.then(buildSkillIconPixelCss);
