// MENU DE LA APP (dApp Store, horizontal): un hub por modo al estilo de los
// juegos de movil. Solo en la APK (html.pw-app, ver la cabecera de index.html);
// la web de PC y la de movil siguen con su menu de siempre.
// Se entra desde la pantalla de modos (selectMode) y cada modo lleva su tema;
// ROOMS solo enseña las salas de ese modo. Los paneles reutilizan el marco
// placa (drawPlacaCaja), la comida del menu (drawMenuDeco) y los datos del juego.
(function () {
    'use strict';
    if (!document.documentElement.classList.contains('pw-app')) return;

    const U = 360;                      // 1em = 16px con 360 de alto
    const MODES = { classic: '#00ffaa', arcade: '#ccff00' };
    const THEME = {
        classic: { bg: '#00130c', line: '#0b3326', top: 'rgba(0,10,6,.9)', inner: '#0f2c22', inner2: '#06120d', edge: '#1d4a3b', shade: '2,8,5', mut: '#8fbfae', bar: '#255f4c', p1: '#0a1a13', p2: '#04100b' },
        arcade: { bg: '#0d1200', line: '#28330a', top: 'rgba(8,10,0,.9)', inner: '#232a08', inner2: '#0d1003', edge: '#3d4a14', shade: '7,9,0', mut: '#b7c28a', bar: '#4d5f17', p1: '#0b0e01', p2: '#050700' },
    };
    const PRICES = ['Free', '2$', '5$', '10$', '20$'];
    const SWATCH = ['#ffffff', '#c8ccd2', '#ff2a2a', '#ff8a00', '#ffd23a', '#00e05a', '#00e0b0', '#1e6bff', '#6cc8ff', '#b000ff'];
    // Colores de THE PILL: 9 tonos en 3 filas (normal, oscuro, claro), para arriba y para abajo.
    const PILL_COLS = [
        ['#ffffff', '#ff2a2a', '#ff8a00', '#ffd23a', '#c8ff00', '#00e05a', '#00e0b0', '#00cfff', '#1e6bff', '#5a5aff', '#b000ff', '#ff4fd8', '#ff2a80'],
        ['#7a7a7a', '#931c1c', '#8f4d00', '#8e7a26', '#6b8a00', '#00803a', '#008a6e', '#007a99', '#153f9a', '#2a2a8a', '#66009e', '#9a2a86', '#8a1048'],
        ['#c8ccd2', '#ff8f8f', '#ffc27a', '#ffe39a', '#e2ff7a', '#7aeea6', '#7aefd6', '#9be8ff', '#82a8ff', '#a6a6ff', '#d27aff', '#ffa6ec', '#ff8fb8']
    ];
    // Skills de salida del ARCADE (solo interfaz: la partida aun no las usa).
    const SKILLS = [['clon', 'CLON'], ['shoot', 'SHOOT'], ['sprint', 'SPRINT'], ['tp', 'BLINK'], ['iman', 'MAGNET'], ['inmune', 'SHIELD'], ['big', 'PLUS'], ['random', 'GAMBLE']];
    let mode = 'classic', room = 'Free', rooms = [], _enPartida = false;
    let picks = (() => { try { return JSON.parse(localStorage.getItem('pw_start_skills')) || [null, null]; } catch (e) { return [null, null]; } })();
    let slotSel = 0;

    // Iconos de trazo limpio (no pixel), con la sombra dura del juego.
    const SVG = {
        friends: '<circle cx="9" cy="7.6" r="3.8"/><path d="M2.2 21c0-4 3.1-7 6.8-7s6.8 3 6.8 7z"/><path d="M18.6 5v7M15.1 8.5h7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
        rooms: '<circle cx="9" cy="7.6" r="3.6"/><path d="M2.4 20.5c0-3.8 3-6.8 6.6-6.8s6.6 3 6.6 6.8z"/><circle cx="16.8" cy="8.6" r="3"/><path d="M15 14.1c.6-.2 1.2-.3 1.9-.3 3.1 0 5.6 2.6 5.6 5.8v.9h-5.2c0-2.5-.9-4.7-2.3-6.4z"/>',
        store: '<path d="M4.6 8.2h14.8l-1.1 12.3H5.7z"/><path d="M8.6 10V6.6a3.4 3.4 0 016.8 0V10" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
        quests: '<rect x="4.8" y="2.8" width="14.4" height="18.4" rx="2.2"/><path d="M8.4 8.6h7.2M8.4 12.4h7.2M8.4 16.2h4.2" stroke="#07140f" stroke-width="1.9" stroke-linecap="round"/>',
        swords: '<path d="M3.2 3.2h2.6l9.4 9.4-2.6 2.6-9.4-9.4z"/><path d="M20.8 3.2h-2.6l-9.4 9.4 2.6 2.6 9.4-9.4z"/><path d="M7.4 12.2l4.4 4.4M16.6 12.2l-4.4 4.4M14.6 16.4l4.2 4.2M9.4 16.4l-4.2 4.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
        swap: '<path d="M5.5 8.5h12l-3.2-3.2M18.5 15.5h-12l3.2 3.2" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
        npc: '<circle cx="12" cy="8.2" r="4.4"/><path d="M3.6 21.5c0-4.9 3.8-8.4 8.4-8.4s8.4 3.5 8.4 8.4z"/>',
        xlogo: '<path d="M4 3.5h4.6l3.9 5.4 4.6-5.4h2.4l-6 7 6.9 9.5h-4.6l-4.2-5.8-5 5.8H4.2l6.4-7.5z"/>',
        wallet: '<rect x="2.8" y="6" width="18.4" height="13" rx="2"/><path d="M5 6l11-2.6V6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="12.5" r="1.6" fill="#07140f"/>',
        bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z"/>',
        star: '<path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z"/>',
        crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.8 10.5H4.8z"/>',
        spook: '<path d="M12 3.2c-4.7 0-8.3 3.8-8.3 8.6 0 3.3 1.4 6.6 3.9 8.4.9.7 2 .2 2.3-.8.3-.8 1.1-1.2 2-1.2s1.7.4 2 1.2c.3 1 1.4 1.5 2.3.8 2.5-1.8 3.9-5.1 3.9-8.4 0-4.8-3.6-8.6-8.1-8.6z"/><ellipse cx="10.4" cy="11" rx="1.15" ry="1.6" fill="#ab9ff2"/><ellipse cx="14.4" cy="11" rx="1.15" ry="1.6" fill="#ab9ff2"/>',
        bag: '<path d="M9 3.6h6c.6 0 1 .5.8 1.1-.2.6-.7 1-1.3 1H9.5c-.6 0-1.1-.4-1.3-1-.2-.6.2-1.1.8-1.1z"/><path d="M6.2 9.6c0-1.9 1.6-3.4 3.5-3.4h4.6c1.9 0 3.5 1.5 3.5 3.4v4.2H6.2z"/><circle cx="12" cy="9.8" r="1.7" fill="#000"/><rect x="6.2" y="14.9" width="11.6" height="5.6" rx="1.4"/>',
        ghost: '<path d="M12 2.8a7.2 7.2 0 00-7.2 7.2v11l2.4-1.8 2.4 1.8 2.4-1.8 2.4 1.8 2.4-1.8 2.4 1.8V10A7.2 7.2 0 0012 2.8z"/><circle cx="9.3" cy="10.2" r="1.4" fill="#07140f"/><circle cx="14.7" cy="10.2" r="1.4" fill="#07140f"/>',
        back: '<path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>',
        core: '<path d="M3.2 4.6h17.6v11.2H3.2z"/><path d="M10 7.6v5.2l4.6-2.6z" fill="#07140f"/><path d="M7 19.4h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        gear: '<path fill-rule="evenodd" d="M19.64,9.64 L22.45,10.21 L22.45,13.79 L19.64,14.36 L19.08,15.73 L20.66,18.12 L18.12,20.66 L15.73,19.08 L14.36,19.64 L13.79,22.45 L10.21,22.45 L9.64,19.64 L8.27,19.08 L5.88,20.66 L3.34,18.12 L4.92,15.73 L4.36,14.36 L1.55,13.79 L1.55,10.21 L4.36,9.64 L4.92,8.27 L3.34,5.88 L5.88,3.34 L8.27,4.92 L9.64,4.36 L10.21,1.55 L13.79,1.55 L14.36,4.36 L15.73,4.92 L18.12,3.34 L20.66,5.88 L19.08,8.27Z M12,8.6 a3.4,3.4 0 1,0 .01,0Z"/>',
        music: '<path d="M9 17.5V5.2l10-2v11.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6.6" cy="17.6" r="2.6"/><circle cx="16.6" cy="15" r="2.6"/>',
        sound: '<path d="M3.5 9h4l5-4v14l-5-4h-4z"/><path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    };
    const svg = n => '<svg viewBox="0 0 24 24" fill="currentColor">' + SVG[n] + '</svg>';

    function shade(hex, k) {
        const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
        const f = v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
        return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
    }
    function pillSprite(size, sinSombra) {
        const top = (document.getElementById('colTop') || {}).value || '#dcdcdc';
        const bot = (document.getElementById('colBot') || {}).value || '#00e05a';
        const skin = typeof paisPuesta === 'function' ? paisPuesta() : null;
        try { return skin ? paisPillRot(size, skin, -Math.PI / 4) : pixPillSpriteRot(size, top, bot, -Math.PI / 4, true); }
        catch (e) { return null; }
    }
    function drawPill(cv, res, fill, bobPx, sinSombra) {
        cv.width = res; cv.height = res;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        const o = pillSprite(48); if (!o) return;
        // Sin sombra: solo el cuadrado S de la pildora, sin el faldon (SH) que el sprite añade debajo.
        const sw = sinSombra && o.S ? o.S : o.cv.width, sh = sinSombra && o.S ? o.S : o.cv.height;
        const k = res * fill / sw;
        g.drawImage(o.cv, 0, 0, sw, sh, res / 2 - sw * k / 2, res / 2 - sh * k / 2 + (bobPx || 0), sw * k, sh * k);
    }
    const placa = (box, t) => { if (typeof drawPlacaCaja === 'function') { const cv = box.querySelector(':scope>canvas'); cv._placaKey = ''; drawPlacaCaja(box, cv, MODES[mode], (t || 1) * (hub.classList.contains('pc') ? 0.5 : 1)); } };

    const css = `
#appHub{position:fixed;inset:0;z-index:105;display:none;overflow:hidden;background:var(--bg);color:#fff;font-family:'Press Start 2P',monospace;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#appHub.on{display:block}
body.hub-on #loginOverlay,body.hub-on #modeScreen,body.hub-on #pillPalette,body.hub-on #colorPicker,body.hub-on #soundToggle,body.hub-on #musicToggle,body.hub-on #playChoiceModal,body.hub-on #roomChoiceModal{visibility:hidden!important;pointer-events:none!important}
body.mobile-allowed #appHub{position:absolute;inset:auto;width:var(--pw-largo,100dvh);height:var(--pw-corto,100dvw);top:50%;left:50%;transform:translate(-50%,-50%) rotate(90deg)}
#appHub canvas{image-rendering:pixelated;display:block}
#ahBg{position:absolute;inset:0;width:100%;height:100%}
#ahShade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(var(--sh),.9) 0,rgba(var(--sh),.6) 19em,rgba(var(--sh),0) 32em)}
.ah-top{position:absolute;left:0;right:0;top:0;height:3.4em;background:var(--top)}
.ah-top:after{content:"";position:absolute;left:0;right:0;bottom:0;height:.15em;background:var(--edge);opacity:.7}
.ah-line{position:absolute;left:5.1em;top:3.25em;width:15.3em;height:.25em;background:var(--ac);box-shadow:0 .12em 0 #000}
.ah-line:after{content:"";position:absolute;right:-.4em;top:-.28em;width:.55em;height:.55em;background:var(--ac);transform:rotate(45deg);box-shadow:.1em .1em 0 #000}
.med{position:relative;flex:none;width:3.2em;height:3.2em;border-radius:50%;box-sizing:border-box;border:.2em solid;
  border-color:var(--acL) var(--acD) var(--acD) var(--acL);background:radial-gradient(circle at 38% 32%,var(--in1) 0,var(--in2) 62%);
  box-shadow:0 0 0 .12em #000,inset 0 0 0 .12em #000,.12em .2em 0 .1em rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#eaf5ef}
.med svg{width:1.45em;height:1.45em;filter:drop-shadow(.08em .1em 0 #000)}
.med canvas{width:2.7em;height:2.7em}
.ah-ava{position:absolute;left:.5em;top:.1em;width:4.5em;height:4.5em;overflow:hidden}
.ah-ava img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.ah-ava .npc{display:flex;color:var(--mut)}.ah-ava .npc svg{width:2.8em;height:2.8em}
.ah-ava{cursor:pointer}
.ah-who{position:absolute;left:5.6em;top:1.3em;display:flex;flex-direction:column;gap:.45em;cursor:pointer}
.ah-name{font-size:.72em;letter-spacing:.08em;text-shadow:.15em .15em 0 #000}
.ah-lv{font-size:.45em;color:var(--ac);display:flex;align-items:center;gap:.8em}
.ah-lv i{display:block;width:9em;height:.8em;background:#000;outline:.25em solid var(--edge)}.ah-lv i b{display:block;height:100%;width:62%;background:var(--ac)}
.ah-title{position:absolute;left:21.5em;right:13em;top:.7em;height:1.15em;display:flex;justify-content:center;gap:.5em}
.ah-title img{height:100%;image-rendering:pixelated;filter:drop-shadow(.1em .1em 0 #000)}
.ah-ico{position:absolute;top:1em;right:.9em;display:flex;gap:.55em;align-items:center}
.ah-btn{position:relative;width:2.3em;height:2.3em;border-radius:50%;box-sizing:border-box;border:.16em solid;border-color:var(--acL) var(--acD) var(--acD) var(--acL);
  background:radial-gradient(circle at 38% 32%,var(--in1) 0,var(--in2) 62%);box-shadow:0 0 0 .1em #000,inset 0 0 0 .1em #000;
  display:flex;align-items:center;justify-content:center;color:#eaf5ef;cursor:pointer}
.ah-btn svg{width:1.05em;height:1.05em;filter:drop-shadow(.06em .08em 0 #000)}
.ah-btn:active{transform:translateY(.1em)}
.ah-btn.off svg{opacity:.35}
.ah-btn.off:after{content:"";position:absolute;left:18%;right:18%;top:50%;height:.16em;background:#ff4a4a;transform:rotate(-45deg);box-shadow:0 0 0 .06em #000}
.ah-sp{display:flex;align-items:center;gap:.5em;margin-right:.5em;font-size:.62em;letter-spacing:.06em;text-shadow:.15em .15em 0 #000}
.ah-sp .u{color:var(--ac)}
.ah-sp .pu{color:var(--mut);margin-left:.1em}
.ah-sp[hidden]{display:none}
.ah-it{position:absolute;left:3.6em;z-index:0;display:flex;align-items:center;gap:.9em;cursor:pointer}
.ah-it:before{content:"";position:absolute;z-index:-1;left:1.6em;top:-.35em;width:18.5em;height:3.9em;box-sizing:border-box;background:linear-gradient(180deg,var(--p1),var(--p2));border:.14em solid var(--bar);box-shadow:.2em .3em 0 rgba(0,0,0,.6)}
.ah-it .med{box-shadow:inset 0 0 0 .12em #000}
.ah-it[data-a=pill]{--c:#c8ff00}.ah-it[data-a=arenas]{--c:#ff5a4a}.ah-it[data-a=store]{--c:#ffc83a}.ah-it[data-a=quests]{--c:#3fc4ff}
.ah-it:before{width:18.5em;background:linear-gradient(90deg,var(--p1) 0,var(--p1) 45%,color-mix(in srgb,var(--c) 24%,#000) 100%)}
.ah-it:after{content:"";position:absolute;z-index:-1;left:20.1em;top:-.35em;width:.5em;height:3.9em;background:var(--c)}
.ah-it:not([data-a=pill]) .med svg{color:var(--c)}
.ah-it .t{font-size:.78em;letter-spacing:.06em;text-shadow:.16em .16em 0 #000}
.ah-it .s{font-size:.44em;color:var(--mut);margin-top:.9em;display:flex;align-items:center;gap:.5em;text-shadow:.16em .16em 0 #000}
.ah-it .s img{width:3.1em;height:3.1em;image-rendering:pixelated;background:var(--in2);box-shadow:0 0 0 .25em var(--edge)}
.ah-it .s img[src=""]{display:none}
#ahPillSub{gap:1.15em;margin-left:.3em}
.ah-it .bar{width:8.5em;height:.4em;background:#000;margin-top:.55em;outline:.12em solid var(--edge)}
.ah-it .bar i{display:block;height:100%;background:var(--ac)}
.ah-it:active .t{color:var(--ac)}
.ah-it:active .med{transform:translateY(.1em)}
.ah-dot{width:.55em;height:.55em;background:#00ff66;animation:ahBl 1s steps(2) infinite}
@keyframes ahBl{50%{opacity:.2}}
.ah-bdg{position:absolute;left:2.4em;top:-.1em;background:#e5302f;font-size:.3em;padding:.35em .45em .25em;box-shadow:0 0 0 .2em #000}
#ahPill{position:absolute;left:24.15em;top:3.2em;width:22em;height:14.2em;cursor:pointer}
.ah-room{position:absolute;right:15.9em;bottom:.6em;width:5em;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:.4em}
.ah-room .sw{position:absolute;right:-.45em;top:-.3em;width:1.35em;height:1.35em;border-radius:50%;background:var(--ac);color:#04150c;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 .12em #000}
.ah-room .sw svg{width:.95em;height:.95em;filter:none}
.ah-room .med>svg{width:1.45em;height:1.45em}
.pnl>canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.ah-room .v{font-size:.44em;white-space:nowrap;letter-spacing:.06em;text-shadow:.16em .16em 0 #000}
.ah-room .v b{font-weight:400;color:var(--ac)}.ah-room .v b.usd{color:#ffd23a}
.ah-room:active .med{transform:translateY(.1em)}
.ah-play{position:absolute;right:1em;bottom:2.3em;width:14.6em;height:3.8em;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;
  border-radius:1.9em;background:var(--ac);color:#04150c;border:.2em solid;border-color:var(--acL) var(--acD) var(--acD) var(--acL);
  box-shadow:0 0 0 .14em #000,inset 0 0 0 .12em #000,.15em .25em 0 .12em rgba(0,0,0,.55)}
.ah-play span{font-size:1.3em;letter-spacing:.3em;margin-left:.3em;text-shadow:.1em .1em 0 var(--acL)}
.ah-play:active{transform:translateY(.12em)}
.ah-sys{position:absolute;left:21.5em;right:13.5em;top:.85em;z-index:4;display:none;padding:.85em 1em .5em;box-sizing:border-box;background:linear-gradient(180deg,#0b0e01,#050700);border:.1em solid #4d5f17;box-shadow:.15em .22em 0 rgba(0,0,0,.6);pointer-events:none}
.ah-sys.on{display:block}
#appHub:not(.pc):has(.ov.open) .ah-sys{visibility:hidden}
.ah-sys b{position:absolute;left:.8em;top:0;transform:translateY(-62%);font-size:.42em;letter-spacing:.12em;font-weight:400;background:var(--ac);color:#0b0f05;padding:.55em .9em .45em;box-shadow:0 0 0 .2em #000}
.ah-sys span{display:block;flex:1;min-width:0;font-size:.5em;line-height:1.6;letter-spacing:.03em;text-transform:uppercase}
.ah-sys.on{display:flex;align-items:center;gap:1em;animation:ahSysIn .4s cubic-bezier(.2,.9,.3,1) both}
.ah-sys.on.out{animation:ahSysOut .35s ease-in both}
@keyframes ahSysIn{from{opacity:0;transform:translateY(.9em)}to{opacity:1;transform:none}}
@keyframes ahSysOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(.5em)}}
.ah-fb.ah-avb{left:14.3em;top:1.8em;right:auto;z-index:4}
#appHub:not(.pc):has(.ov.open) .ah-fb,#appHub:not(.pc):has(.ov.open) .ah-bdg{visibility:hidden}
#appHub.pc .ah-avb{left:15.7em;top:2.3em}
.ah-sys .pic{display:none;flex:none;width:2.4em;height:2.4em;border-radius:50%;background:#2c3630 center/cover;box-shadow:0 0 0 .12em #000;align-self:center;transform:translateY(-.17em)}
.ah-sys.pic .pic{display:block}
.ah-sys .acts{display:none;flex:none;gap:.6em;align-self:center;transform:translateY(-.17em)}
.ah-sys.act{pointer-events:auto}.ah-sys.act .acts{display:flex}
.ah-sys .acts button{font-family:'Russo One',sans-serif;font-size:.45em;letter-spacing:.1em;padding:.5em 1.1em;margin:0;background:var(--kb,#c8ff00);color:#050505;border:none;cursor:pointer}
.ah-sys .acts button.n{background:none;border:.15em solid var(--kd,#4d5f17);color:var(--kb,#c8ff00)}
.ah-sys.k-whisper{--kb:#3fa0ff;--kd:#2d6fb5;border-color:#2d6fb5;background:linear-gradient(180deg,#050b14,#02060c)}
.ah-sys.k-whisper b{background:#3fa0ff}
.ah-sys.k-friend{--kb:#b57bff;--kd:#7a55b0;border-color:#7a55b0;background:linear-gradient(180deg,#0d0814,#06030a)}
.ah-sys.k-friend b{background:#b57bff}
.ah-sys.k-arena{--kb:#ffb02e;--kd:#a8741a;border-color:#a8741a;background:linear-gradient(180deg,#140d02,#0a0601)}
.ah-sys.k-arena b{background:#ffb02e}
.ah-sys.k-invite{--kb:#ff5a4a;--kd:#a8453a;border-color:#a8453a;background:linear-gradient(180deg,#140706,#0a0302)}
.ah-sys.k-invite b{background:#ff5a4a}
.ov{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,6,4,.9);z-index:5}
.ov.open{display:flex}
.pnl{position:relative;box-sizing:border-box}
.pin{position:relative;padding:1em 1.1em .7em}
.ph{display:flex;align-items:center;gap:.7em}
.ph img{height:1.25em;image-rendering:pixelated;filter:drop-shadow(.08em .08em 0 #000)}
.ph .w{font-family:'Russo One',sans-serif;font-size:.8em;letter-spacing:.14em;color:#fff}
.ph .cnt{margin-left:auto;font-family:'Russo One',sans-serif;font-size:.72em;letter-spacing:.1em;color:var(--ac)}
.px{font-family:'Russo One',sans-serif;font-size:.66em;letter-spacing:.1em;padding:.45em 1em;border:.14em solid #2c3630;color:#7d8a82;background:none}
.ahr-g{display:grid;grid-template-columns:repeat(6,1fr);gap:.5em;margin-top:.8em}
.ahr-g .cell{padding:0 0 .45em;gap:.25em;min-width:0;overflow:hidden;border:.12em solid color-mix(in srgb,var(--k) 45%,#000)}
.ahr-g .cell.sel{border-color:var(--k);box-shadow:0 0 0 .1em #000,0 0 .9em color-mix(in srgb,var(--k) 50%,transparent);background:rgba(0,0,0,.28)}
.ahr-g .cell .p{align-self:stretch;margin:0 -.12em;min-height:2em;display:flex;align-items:center;justify-content:center;background:var(--k);color:#0b0f05;text-shadow:none;font-size:1em}
.ahr-g .cell .p.sm{font-size:.62em;min-height:3.2em}
.ahr-g .cell{background:linear-gradient(180deg,color-mix(in srgb,var(--k) 20%,#06100a),color-mix(in srgb,var(--k) 7%,#06100a))}
.ahr-g .cell .p{border-bottom:.16em solid color-mix(in srgb,var(--k) 55%,#000)}
.ahr-g .cell .ly b,.ahr-g .cell .n{color:color-mix(in srgb,var(--k) 62%,#fff)}
.ahr-g .cell .more{color:color-mix(in srgb,var(--k) 45%,#9fb0a6)}
.ahr-box{background:linear-gradient(180deg,color-mix(in srgb,var(--k,#c8ff00) 13%,#06100a),color-mix(in srgb,var(--k,#c8ff00) 5%,#06100a))}
.ahr-r{color:color-mix(in srgb,var(--k,#c8ff00) 60%,#fff);border-bottom-color:color-mix(in srgb,var(--k,#c8ff00) 35%,#000)}
.k0{--k:#8a948e}.k1{--k:#c8ff00}.k2{--k:#3fc4ff}.k3{--k:#b57bff}.k4{--k:#ffc83a}.k5{--k:#ff5a4a}
.ahr-g .cell .ly{display:flex;align-items:center;justify-content:center;gap:.35em;width:100%;font-family:'VT323',monospace;font-size:.78em;line-height:1;color:#b6c4bc}
.ahr-g .cell .ly b{font-weight:400;color:var(--mut)}
.ahr-g .cell .ly i{width:.42em;height:.42em;background:#56635b;flex:none}
.ahr-g .cell .ly i.g{background:#00ff88}.ahr-g .cell .ly i.y{background:#ffce3d}.ahr-g .cell .ly i.r{background:#ff5a4e}
.ahr-g .cell>*:not(.p){box-sizing:border-box;max-width:100%;padding:0 .55em}
.ahr-g .cell .more{font-size:.28em;letter-spacing:.06em;line-height:1.7;color:var(--mut);text-align:center;padding:0 1.6em}
.ahr-lt{position:absolute;right:.7em;top:0;transform:translateY(-58%);display:flex;gap:.35em}
.ahr-lt button{font-family:'Press Start 2P',monospace;font-size:.4em;padding:.55em .8em .45em;background:#050c09;color:var(--mut);border:.2em solid #2f3d35;cursor:pointer}
.ahr-lt button.on{background:var(--k,#c8ff00);border-color:var(--k,#c8ff00);color:#0b0f05}
.ahr-g .cell .st.live{color:#00ff88}.ahr-g .cell .st.wait{color:#ffd23a}
#ahRooms .ph .cnt{margin-left:.3em}
.ahr-b{display:grid;grid-template-columns:1fr 1.18fr;gap:.9em;margin-top:.95em}
.ahr-box{position:relative;box-sizing:border-box;border:.12em solid color-mix(in srgb,var(--k,#c8ff00) 55%,#000);background:rgba(0,0,0,.22);padding:.95em .8em .35em;min-width:0}
.ahr-box>b{position:absolute;left:.7em;top:0;transform:translateY(-58%);font-weight:400;font-size:.4em;letter-spacing:.1em;background:var(--k,#c8ff00);color:#0b0f05;padding:.5em .8em .4em;box-shadow:0 0 0 .2em #000;white-space:nowrap}
.ahr-r{display:flex;justify-content:space-between;align-items:baseline;gap:.6em;font-size:.46em;letter-spacing:.06em;padding:.5em 0;border-bottom:.08em dashed rgba(255,255,255,.12);color:var(--mut)}
.ahr-r:last-child{border-bottom:0}
.ahr-r span{color:#fff;text-align:right}.ahr-r span.usd{color:#ffd23a}.ahr-r span.live{color:#00ff88}.ahr-r span.wait{color:#ffd23a}
.ahr-n{display:flex;align-items:center;gap:.7em;font-size:.44em;line-height:1.35;letter-spacing:.05em;padding:.42em 0;color:#fff}
.ahr-n i{font-style:normal;flex:none;background:var(--k,#c8ff00);color:#0b0f05;padding:.3em .5em .2em;min-width:2em;text-align:center}
.cell{position:relative;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;cursor:pointer}
.cell .p{font-size:1em;text-shadow:.16em .16em 0 #000}
.cell .n{font-size:.42em;color:var(--mut)}
.cell .f{width:80%;height:.35em;background:#000;outline:.1em solid var(--edge)}
.cell .f i{display:block;height:100%;background:var(--ac)}
.cell .st{font-family:'VT323',monospace;font-size:.8em;color:#6f7a73;height:1em}
.cell.sel{border:.14em solid var(--ac);background:rgba(255,255,255,.04)}
.cell.lock{opacity:.55}
.cell.lock .st{color:#ff6a5a}
.foot{text-align:center;margin-top:.7em;font-family:'VT323',monospace;font-size:.95em;color:#6f7a73}
/* THE PILL del arcade: dos huecos de skill */
.sk-b{display:flex;gap:1em;margin-top:.8em;align-items:stretch;height:12.6em}
.sk-pill{width:9em;flex:none;box-sizing:border-box;padding:.5em .3em .7em;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;gap:.3em;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07)}
.sk-pill canvas{width:5.4em;height:5.4em}
#ahName{width:100%;box-sizing:border-box;font-family:'Press Start 2P',monospace;font-size:.5em;text-align:center;color:#fff;background:#050c09;border:.2em solid var(--edge);padding:.7em .3em;outline:none;text-transform:uppercase}
#ahName:focus{border-color:var(--ac)}
#ahName::placeholder{color:var(--mut)}
.sk-slots{display:flex;gap:.6em}
.sk-slot{width:3em;height:3em;box-sizing:border-box;background:#050c09;border:.14em dashed #2c4a3f;display:flex;align-items:center;justify-content:center;cursor:pointer}
.sk-slot img{width:100%;height:100%;image-rendering:pixelated}
.sk-slot.act{border:.16em solid var(--ac)}
.sk-slot.full{border-style:solid;border-color:#2c4a3f}
.sk-slot.full.act{border-color:var(--ac)}
.sk-lab{font-size:.38em;color:var(--mut);letter-spacing:.08em;white-space:nowrap;line-height:1.4}
.tb{width:7.4em;box-sizing:border-box;text-align:center;font-family:'Russo One',sans-serif;font-size:.72em;letter-spacing:.1em;padding:.5em 0;border:.14em solid #2c3630;color:#7d8a82;background:none}
.tb.on{background:var(--ac);border-color:var(--ac);color:#04150c}
.co,.sn{flex:1;min-width:0;}
.co{display:flex;flex-direction:column;justify-content:center;gap:.9em}
.co .rw{display:flex;align-items:center;gap:.8em}
.co .lb{width:5.6em;font-size:.44em;color:var(--mut);letter-spacing:.1em;flex:none}
.co .sw{display:grid;grid-template-columns:repeat(13,1.4em);gap:.25em}
.co .sw b{aspect-ratio:1;cursor:pointer;box-shadow:inset -.18em -.18em 0 rgba(0,0,0,.35),inset .18em .18em 0 rgba(255,255,255,.3),0 0 0 .1em #000}
.co .sw b.sel{outline:.16em solid #fff;outline-offset:.12em}
.qg{flex:1;min-width:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:.45em}
.qc{position:relative;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07);padding:.35em .55em;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.qc .k{font-size:.36em;line-height:1.4;letter-spacing:.1em;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qc .t{font-size:.44em;line-height:1.5;letter-spacing:.04em;margin-top:.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:.15em .15em 0 #000}
.qc .d{font-family:'VT323',monospace;font-size:.78em;color:#9fb3aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qc .b{display:flex;align-items:center;justify-content:space-between}
.qc .pts{font-size:.46em;color:#ffd23a;text-shadow:.15em .15em 0 #000}
.qc .qp{height:.35em;background:#000;outline:.1em solid var(--edge);margin:.25em 0}
.qc .qp i{display:block;height:100%;background:var(--ac)}
.qc .n{font-size:.4em;color:var(--mut)}
.qc button{font-family:'Russo One',sans-serif;font-size:.6em;letter-spacing:.1em;padding:.3em .9em;border:none;background:var(--ac);color:#04150c;cursor:pointer}
.qc button.v{background:#ffd23a}
.qc{cursor:pointer}.qc.qpin{outline:.16em solid var(--ac);outline-offset:-.16em;background:rgba(255,255,255,.05)}
.qc.done{opacity:.45}.qc.done .pts{color:var(--ac)}.qc.done:not(.x){cursor:default}
.ph .qb{font-size:.42em;color:#ffd23a;letter-spacing:.06em;margin-left:1em}
.sn .cell .pr{font-size:.4em;color:#ffd23a}
.sn .cell .pr.own{color:var(--ac)}
.sn .cell.buy{border:.14em solid #ffd23a}
.sn .cell.buy .pr{color:#04150c;background:#ffd23a;padding:.35em .5em}
#ahSv,#ahIc,#ahUn{z-index:9}
/* Gente jugando en el modo: punto animado + numero sobre las espadas (sin texto). */
.ah-pl{position:absolute;right:calc(100% + .45em);top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:.3em;font-size:.78em;text-shadow:.12em .12em 0 #000}
.ah-pl b{font-weight:400;color:#fff;font-size:.8em}
.ah-on{display:inline-flex;align-items:center;gap:.5em;margin-left:1.1em;font-size:.7em;vertical-align:.1em;text-shadow:.15em .15em 0 #000}
.ah-on b{font-weight:400;color:#fff}
/* $PILLY tras la partida: verde con + si ganaste, rojo con - si perdiste, parpadeando unos segundos */
.ah-py.py-up #ahPy,.ah-py.py-dn #ahPy{animation:pyBlink .5s steps(2) 12}
.ah-py.py-up #ahPy{color:#00ff88}.ah-py.py-dn #ahPy{color:#ff4d6d}
.ah-py.py-up #ahPy:before{content:'+'}.ah-py.py-dn #ahPy:before{content:'-'}
@keyframes pyBlink{50%{opacity:.25}}
#ahAr,#ahFr{z-index:7}
.ah-btn{position:relative}
.ah-fb{position:absolute;right:-.35em;top:-.35em;min-width:1.4em;background:#e5302f;color:#fff;font-style:normal;font-size:.3em;line-height:1;text-align:center;padding:.4em .35em .25em;box-shadow:0 0 0 .2em #000}
.ah-fb:empty{display:none}
#ahAv{z-index:7}#ahUn{z-index:8}#ahIc{z-index:9}
/* ICON UNLOCKED: el icono de perfil nuevo en una tarjeta cuadrada que entra
   girando sobre si misma, flota y le pasa un brillo de vez en cuando. */
.ic-card{position:relative;width:8em;height:8em;padding:.35em;margin:1.2em 0 .5em;background:var(--ac);box-shadow:.25em .25em 0 #000;
  animation:icFlip .7s steps(7) both,icFloat 2.4s steps(6) .7s infinite}
.ic-card:before{content:"";position:absolute;inset:.35em;border:.14em solid #000;z-index:2;pointer-events:none}
.ic-card canvas{width:100%;height:100%;display:block}
.ic-card i{position:absolute;inset:.35em;overflow:hidden;z-index:3;pointer-events:none}
.ic-card i:after{content:"";position:absolute;top:-20%;bottom:-20%;width:35%;left:-60%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);
  transform:skewX(-20deg);animation:icShine 2.6s steps(10) 1s infinite}
.ic-s{font-size:.42em;letter-spacing:.08em;color:var(--mut)}
@keyframes icFlip{0%{transform:perspective(40em) rotateY(90deg) scale(.6)}60%{transform:perspective(40em) rotateY(-12deg) scale(1.08)}100%{transform:perspective(40em) rotateY(0) scale(1)}}
@keyframes icFloat{50%{transform:translateY(-.3em)}}
@keyframes icShine{0%{left:-60%}40%,100%{left:130%}}
.av-big{width:8em;height:8em}
.av-r{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.55em}
.av-l{display:flex;align-items:center;gap:.6em}
.av-l>span{width:11.5em;flex:none;font-size:.36em;letter-spacing:.06em;color:var(--mut);white-space:nowrap}
.av-l>div{display:flex;gap:.3em;flex-wrap:wrap}
.av-l b{width:1.35em;height:1.35em;cursor:pointer;box-shadow:0 0 0 .1em #000;display:flex;align-items:center;justify-content:center}
.av-l b.on{outline:.14em solid #fff;outline-offset:.08em}
.av-l b svg{width:.95em;height:.95em}
.av-l b canvas{width:100%;height:100%}
.av-l b.no{background:var(--in2);color:var(--mut)}
.av-p{display:none}#ahAv.pill .av-p{display:flex}
.un-b{display:flex;flex-direction:column;align-items:center;gap:.5em;overflow:hidden}
.un-t{font-size:.95em;color:var(--ac);text-shadow:.12em .12em 0 #000,0 0 .01em #fff;animation:unPop .5s steps(5) both}
.un-st{position:relative;width:10em;height:10em;display:flex;align-items:center;justify-content:center}
.un-st canvas{width:8em;height:8em;position:relative;z-index:1;animation:unBob 1.2s steps(4) infinite}
.un-ray{position:absolute;inset:-2em;background:repeating-conic-gradient(var(--ac) 0 10deg,transparent 10deg 30deg);opacity:.16;border-radius:50%;animation:unSpin 8s linear infinite}
.un-st b{position:absolute;width:.5em;height:.5em;background:#fff;box-shadow:0 0 0 .12em var(--ac);animation:unTw 1.4s steps(3) infinite;z-index:2}
.un-n{font-size:.55em;letter-spacing:.08em}
@keyframes unSpin{to{transform:rotate(360deg)}}
@keyframes unBob{50%{transform:translateY(-.3em)}}
@keyframes unTw{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}
@keyframes unPop{0%{transform:scale(.3)}70%{transform:scale(1.15)}100%{transform:scale(1)}}
.sv-b{display:flex;flex-direction:column;align-items:center;gap:.6em;padding:.4em 0 .2em}
.sv-b canvas{width:9em;height:9em}
.sv-n{font-size:.6em;letter-spacing:.06em;text-shadow:.15em .15em 0 #000}
.sv-p{font-size:.48em;color:#ffd23a}.sv-p.own{color:var(--ac)}
.sv-bt{display:flex;gap:.6em;width:100%;margin-top:.3em}.sv-bt .tb{flex:1;width:auto}
.cv-b{flex:1;display:flex;flex-direction:column;justify-content:center;gap:.8em;padding:0 1em}
.cv-r{display:flex;justify-content:space-between;font-size:.5em;color:var(--mut)}.cv-r b{font-weight:400;color:#fff}
.cv-in{display:flex;gap:.5em;align-items:center}
.cv-in input{flex:1;min-width:0;font-family:'Press Start 2P',monospace;font-size:.6em;padding:.8em;background:#050c09;color:#fff;border:.18em solid var(--edge);outline:none;text-align:center}
.cv-in .tb{width:auto;padding:.6em 1em}
.cv-out{font-size:.6em;text-align:center;color:#ffd23a}
.cn-b{display:flex;gap:.8em;margin-top:.9em}
.cn-o{flex:1;height:5.4em;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7em;background:rgba(0,0,0,.28);border:.14em solid var(--edge);color:#fff;font-family:'Russo One',sans-serif;font-size:.72em;letter-spacing:.12em;cursor:pointer}
.cn-o .i{width:2.6em;height:2.6em;border-radius:50%;background:var(--ac);color:#04150c;display:flex;align-items:center;justify-content:center}
.cn-o .i svg{width:1.4em;height:1.4em}
.cn-o:active{border-color:var(--ac)}
.pr-me{justify-content:center!important;gap:.6em!important}
.pr-pic canvas,.av-big canvas{width:100%;height:100%;border-radius:50%;image-rendering:pixelated}
.ah-ava canvas{width:100%;height:100%;border-radius:50%;image-rendering:pixelated}
.pr-pic{width:5em;height:5em;flex:none;border-radius:50%;overflow:hidden;box-shadow:0 0 0 .22em var(--ac),0 0 0 .38em #000}
.pr-pic img{width:100%;height:100%;object-fit:cover}
.pr-pic .npc{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--in2);color:var(--ac)}.pr-pic .npc svg{width:3.2em;height:3.2em}
.pr-at{font-size:.46em;color:var(--ac);letter-spacing:.06em}
.pr-ic,.pr-cl{display:flex;gap:.25em;justify-content:center}
.pr-box{position:relative}
#ahPrAddX{position:absolute;right:.7em;top:.6em;width:auto;padding:.4em .8em;font-size:.5em}
#ahPrAddX.red,#ahPrUnW{color:#ff8a7a;border-color:#7a2a26}
#ahPrUnW{position:absolute;right:.7em;top:3.9em;width:auto;padding:.4em .8em;font-size:.5em}   /* separado del de X */
.pr-fc{display:flex;flex-direction:column;align-items:center;gap:.5em;cursor:pointer}
.pr-fc .k{font-size:.32em;color:var(--mut);letter-spacing:.12em}
.pr-fc b{font-size:.58em;font-weight:400;color:#ffd23a;letter-spacing:.14em;text-shadow:.12em .12em 0 #000}
.pr-ic b{width:1.15em;height:1.15em;display:flex;align-items:center;justify-content:center;background:var(--in2);color:#eaf5ef;box-shadow:0 0 0 .1em var(--edge);cursor:pointer}
.pr-ic b svg{width:.8em;height:.8em}.pr-ic b.on{box-shadow:0 0 0 .14em var(--ac)}
.pr-cl b{width:.95em;height:.95em;cursor:pointer;box-shadow:0 0 0 .1em #000}.pr-cl b.on{outline:.14em solid #fff;outline-offset:.08em}
.av{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#07140f}
.av svg{width:58%;height:58%}
.pr-r{flex:1;min-width:0;display:flex;flex-direction:column;gap:.5em}
.pr-box{flex:1;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07);padding:.7em .9em}
.pr-box .k,.pr-st .k{font-size:.38em;color:var(--mut);letter-spacing:.1em}
.pr-w{font-size:.48em;margin-top:.5em;letter-spacing:.04em;cursor:pointer;word-break:break-all}
.pr-bal{font-size:1em;color:#ffd23a;margin-top:.35em;text-shadow:.12em .12em 0 #000}
#ahPr .pr-bt{margin-top:1.2em}#ahPr .pr-w{margin-top:.35em}
.tb .pz-dot{display:inline-block;min-width:1.4em;box-sizing:border-box;padding:.3em .4em .2em;background:#e5302f;color:#fff;font-style:normal;font-size:.7em;line-height:1;text-align:center;margin-left:.6em;vertical-align:.2em;box-shadow:0 0 0 .18em #000}
#ahPz .ph .tb{white-space:nowrap;width:auto;padding:.5em 1.4em}
.pz-l{display:flex;flex-direction:column;gap:0;box-sizing:border-box;height:calc(4 * 2.7em + 1.6em);overflow-y:auto;overflow-x:hidden;margin:1.2em 0 .5em;padding:.8em .8em;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07);scrollbar-width:thin;scrollbar-color:var(--edge) transparent}
.pz-l .pz-r{flex:none}
.pz-r{display:flex;align-items:center;gap:1em;padding:.85em .4em;border-bottom:.07em dashed rgba(255,255,255,.12)}
.pz-r:last-child{border-bottom:0}
.pz-r .m{font-size:.5em;color:#fff;width:12.5em;flex:none;white-space:nowrap}.pz-r .d{font-size:.38em;color:var(--mut);flex:1}
.pz-r .a{font-size:.55em;color:#ffd23a;text-align:right}.pz-r .s{font-size:.36em;min-width:6.5em;text-align:right;letter-spacing:.08em}
.pz-r .s.ok{color:var(--mut)}.pz-r .s.no{color:#ffd23a}.pz-r.done .a{color:var(--mut)}
.pz-e{font-size:.45em;color:var(--mut);text-align:center;margin:auto;line-height:2}
.pz-f{display:flex;align-items:center;justify-content:space-between;gap:1em;margin-top:.9em}.pz-f .k{font-size:.45em;color:var(--mut)}.pz-f b{color:#ffd23a;font-weight:400}.pz-f .tb{width:auto;padding-left:1.4em;padding-right:1.4em}
.ph>.px:not(.bk){margin-left:auto}   /* CLOSE siempre en la esquina de arriba a la derecha, en todos los paneles */
#ahAr .ph .bk{color:#fff;border-color:#4a5850}   /* mismo tamano que CLOSE */
.pr-bt{display:flex;gap:.5em;margin-top:.8em}.pr-bt .tb{width:auto;flex:1}
.pr-st{display:grid;grid-template-columns:repeat(3,1fr);gap:.5em;height:3.6em}
.pr-st .cell{justify-content:center;gap:.4em}.pr-st .v{font-size:.62em;text-shadow:.12em .12em 0 #000}
.sn{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:.45em}
.sn .cell{justify-content:center;gap:.35em;padding:.3em}
.sn .cell canvas{width:3.6em;height:3.6em}
.sn .cell .nm{font-size:.36em;letter-spacing:.04em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sn .cell .eq{position:absolute;right:.3em;top:.3em;width:1.2em;height:1.2em;background:var(--ac);color:#04150c;font-size:.45em;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 .2em #000}
.sn .none{grid-column:1/-1;grid-row:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1em;font-size:.45em;color:var(--mut);text-align:center;line-height:1.6}
.sn .none button{font-family:'Russo One',sans-serif;font-size:1.6em;letter-spacing:.1em;padding:.5em 1.4em;border:none;background:var(--ac);color:#04150c;cursor:pointer}
.pin .pg{position:absolute;right:1.4em;bottom:.8em;display:flex;align-items:center;gap:.6em;font-size:.45em;color:var(--mut)}
.pin .pg b{width:2em;height:2em;border-radius:50%;border:.15em solid var(--ac);color:var(--ac);display:flex;align-items:center;justify-content:center;cursor:pointer}
.sk-g{flex:1;min-width:0;grid-template-rows:repeat(2,1fr);display:grid;grid-template-columns:repeat(4,1fr);gap:.45em}
.sk-g .cell{padding:.55em .2em .45em;gap:.4em}
.sk-g .cell img{width:2.6em;height:2.6em;image-rendering:pixelated}
.sk-g .cell .nm{font-size:.4em;letter-spacing:.06em}
.sk-g .cell.used{opacity:.35}
#ahSkSp,#ahStSp,#ahQSp,#ahPrSp{display:none!important}
.ah-btn[data-a=htp],.ah-it[data-a=friends],.ah-it[data-a=core]{display:none}
.ah-it[data-a=core]{--c:#ff7ad9}
.ah-it[data-a=friends]{--c:#b57bff}
.htp{height:14.4em;display:flex;flex-direction:column;gap:.6em;margin-top:.8em}
.htp-g{display:grid;grid-template-columns:repeat(4,1fr);gap:.5em;flex:1}
.htp-g .cell{justify-content:center;gap:.4em;padding:.4em}
.htp-g .cell img{width:3em;height:3em;image-rendering:pixelated}
.htp-g .cell .nm{font-size:.4em;letter-spacing:.06em}
.htp .hh{font-size:.62em;letter-spacing:.08em;text-align:center;color:#fff}
.htp .ht{font-size:.82em;letter-spacing:.06em;text-shadow:.12em .12em 0 #000}
.htp .hd{font-size:.42em;line-height:1.8;color:var(--mut)}
.htp video{flex:1;min-height:0;width:100%;background:#000;object-fit:contain;box-shadow:0 0 0 .15em var(--edge)}
.htp .hb{align-self:flex-end;font-family:'Russo One',sans-serif;font-size:.4em;letter-spacing:.08em;padding:.5em 1.2em;background:var(--in2);border:.15em solid var(--edge);color:var(--mut);cursor:pointer}
.htp-n{display:flex;align-items:center;justify-content:space-between;margin-top:.5em;border-top:.07em solid rgba(255,255,255,.07);padding-top:.5em}
.hn{font-family:'Russo One',sans-serif;font-size:.66em;letter-spacing:.1em;padding:.45em 1em;border:.14em solid #2c3630;color:#7d8a82;background:none;cursor:pointer}.hn:active{color:var(--ac)}
.htp-n span{display:flex;gap:.7em}.htp-n i{width:.6em;height:.6em;border-radius:50%;background:#2c3630}.htp-n i.on{background:var(--ac)}

/* ===== MOVIL: barras mas bajas para dejar el hueco de la placa SYSTEM debajo ===== */
#appHub:not(.pc) .ah-it:before{left:1.4em;top:-.15em;width:18.5em;height:3em}
#appHub:not(.pc) .ah-it:after{left:19.9em;top:-.15em;height:3em}
#appHub:not(.pc) .ah-it .med{width:2.7em;height:2.7em}
#appHub:not(.pc) .ah-it .med svg{width:1.25em;height:1.25em}
#appHub:not(.pc) .ah-it .med canvas{width:2.3em;height:2.3em}
#appHub:not(.pc) .ah-it .t{font-size:.62em}
#appHub:not(.pc) .ah-it .s{font-size:.4em;margin-top:.7em}
#appHub:not(.pc) #ahPillSub{margin-top:.5em}
#appHub:not(.pc) #ahPillSub img{width:3.4em;height:3.4em}
#appHub:not(.pc) .ah-it .bar{width:7em}
#appHub:not(.pc) .ah-sys{left:3.6em;right:auto;width:20.8em;top:auto;bottom:.9em;padding:.62em .9em .3em}
#appHub:not(.pc) .ah-sys span{font-size:.38em;line-height:1.5}
#appHub:not(.pc) .ah-sys b{font-size:.32em}
#appHub:not(.pc) .ah-sys .pic{width:2.1em;height:2.1em}
#appHub:not(.pc) .ah-sys .acts,#appHub:not(.pc) .ah-sys .pic{transform:translateY(-.16em)}
#appHub:not(.pc) .ah-sys .acts button{font-size:.36em;padding:.4em .9em}
#appHub:not(.pc) #ahAr .sq-side:not(.n3) .sq-grp.big{gap:1.1em}
#appHub:not(.pc) #ahAr .sq-side:not(.n3) .sq-grp.big .sq-av{width:9em}
#appHub:not(.pc) #ahAr .sq-side:not(.n3) .sq-grp.big .sq-av .sq-pic{font-size:1.6em}
#appHub:not(.pc) #ahAr .sq-pbox .sq-near{font-size:.42em;white-space:nowrap}
#appHub:not(.pc) #ahAr .sq.find .sq-q{position:relative;top:-.9em}


/* ===== PILLWARS CORE (solo PC): guias y videos ===== */
.cr-b{display:flex;gap:1em;margin-top:.9em;min-height:0}
.cr-b>*{animation:crIn .35s ease both}.cr-b>*:nth-child(2){animation-delay:.07s}.cr-b>*:nth-child(3){animation-delay:.14s}
@keyframes crIn{from{opacity:0;transform:translateY(.7em)}to{opacity:1;transform:none}}
.cr-main{flex:1.75;min-width:0;display:flex;flex-direction:column;gap:.7em}
.cr-vid{position:relative;flex:1;min-height:0;background:#000;border:.12em solid var(--edge);overflow:hidden}
.cr-vid video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.cr-poster{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7em;cursor:pointer;background:radial-gradient(circle at 50% 42%,color-mix(in srgb,var(--ac) 24%,#06100a),#020503 75%)}
.cr-poster .pl{width:3.6em;height:3.6em;border-radius:50%;border:.18em solid var(--ac);position:relative;transition:transform .2s,background .2s}
.cr-poster .pl:after{content:"";position:absolute;left:1.3em;top:.9em;border-left:1.2em solid var(--ac);border-top:.9em solid transparent;border-bottom:.9em solid transparent}
.cr-poster:hover .pl{transform:scale(1.1);background:rgba(255,255,255,.07)}
.cr-poster .k{font-size:.42em;letter-spacing:.14em;color:var(--mut)}
.cr-ti{font-size:.74em;letter-spacing:.06em;text-shadow:.12em .12em 0 #000}
.cr-de{font-size:.46em;color:var(--mut);line-height:1.7;letter-spacing:.03em}
.cr-list{flex:1;min-width:0;display:flex;flex-direction:column;gap:.55em;overflow-y:auto;padding-right:.2em}.cr-list .cr-card{flex:1 1 0;min-height:0}.cr-card>div:last-child{flex:1;min-width:0}.cr-card .cr-c1{line-height:1.25}.cr-card .cr-c2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cr-card{display:flex;align-items:center;gap:.8em;padding:.5em .7em .5em .5em;background:rgba(0,0,0,.28);border:.12em solid rgba(255,255,255,.07);cursor:pointer;transition:border-color .18s,background .18s,box-shadow .18s;flex:none}
.cr-card.off{cursor:default;opacity:.55}.cr-card.off:hover{border-color:rgba(255,255,255,.07);box-shadow:none}
.cr-num{font-size:.7em;color:var(--ac);width:1.4em;text-align:center;flex:none}
.cr-card:hover{border-color:color-mix(in srgb,var(--ac) 70%,#000);box-shadow:0 0 .8em color-mix(in srgb,var(--ac) 30%,transparent)}
.cr-card.on{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 8%,rgba(0,0,0,.28))}
.cr-th{width:5.4em;aspect-ratio:16/9;flex:none;background:#000;position:relative;overflow:hidden;box-shadow:0 0 0 .1em #000}
.cr-th video,.cr-th img{width:100%;height:100%;object-fit:cover;display:block}
.cr-th i{position:absolute;right:.25em;bottom:.2em;font-size:.4em;font-style:normal;background:rgba(0,0,0,.75);padding:.2em .5em}
.cr-c1{font-size:.56em;letter-spacing:.05em}.cr-c2{font-size:.38em;color:var(--mut);margin-top:.5em;line-height:1.5}
.cr-grid{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:.8em;min-height:0}
.cr-mode{position:relative;display:flex;flex-direction:column;gap:.7em;padding:.9em;background:linear-gradient(180deg,color-mix(in srgb,var(--k) 18%,#06100a),color-mix(in srgb,var(--k) 5%,#06100a));border:.12em solid color-mix(in srgb,var(--k) 55%,#000);overflow:hidden;transition:border-color .2s,box-shadow .2s}
.cr-mode:hover{border-color:var(--k);box-shadow:0 0 1em color-mix(in srgb,var(--k) 35%,transparent)}
.cr-mode:before{content:"";position:absolute;left:0;top:0;right:0;height:.35em;background:var(--k)}
.cr-mode h3{margin:.3em 0 0;font-size:.95em;letter-spacing:.08em;font-weight:400;color:var(--k);text-shadow:.12em .12em 0 #000}
.cr-mode .tg{font-size:.4em;color:var(--mut);letter-spacing:.1em}
.cr-mode ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.7em;font-size:.46em;line-height:1.6;color:#cfe0d6}
.cr-mode li{padding-left:1.3em;position:relative}.cr-mode li:before{content:"";position:absolute;left:0;top:.5em;width:.55em;height:.55em;background:var(--k)}
.cr-two{flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:1em;min-height:0;align-content:start}.cr-two .cr-th img{object-fit:contain;background:#000}.cr-two .cr-c1{font-size:.7em;margin-top:.3em}.cr-two .cr-c2{font-size:.46em;line-height:1.7}
.cr-bas{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:.8em;min-height:0;overflow:hidden}
.cr-bc{display:flex;flex-direction:column;gap:.5em;padding:.6em;background:rgba(0,0,0,.28);border:.12em solid rgba(255,255,255,.07);min-height:0;transition:border-color .2s,box-shadow .2s}
.cr-bc:hover{border-color:var(--ac);box-shadow:0 0 1em color-mix(in srgb,var(--ac) 30%,transparent)}
.cr-bc{overflow:hidden}.cr-bc .cr-th{width:100%;aspect-ratio:4/3}
.cr-keys{display:flex;flex-wrap:wrap;gap:.5em .9em;font-size:.46em;color:#cfe0d6;align-items:center}
.cr-keys b{background:#0d1a13;border:.14em solid #2c3630;padding:.3em .7em;font-weight:400;color:var(--ac);margin-right:.5em;letter-spacing:.08em}
.cr-sk{flex:0 0 40%;align-self:center;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55em}.cr-sk .cell{aspect-ratio:1;min-width:0}
.cr-sk .cell{justify-content:center;gap:.4em;transition:border-color .18s,box-shadow .18s}.cr-sk .cell:hover{border-color:color-mix(in srgb,var(--ac) 70%,#000);box-shadow:0 0 .8em color-mix(in srgb,var(--ac) 30%,transparent)}.cr-sk .cell img{width:3.2em;height:3.2em;image-rendering:pixelated}.cr-sk .cell.on{border-color:var(--ac);box-shadow:0 0 .8em color-mix(in srgb,var(--ac) 35%,transparent)}
.cr-img{flex:1;min-height:0;background:#000 center/contain no-repeat;border:.12em solid var(--edge)}
.cr-sk .cell .nm{font-size:.4em;letter-spacing:.06em}
/* ===== PC: el mismo hub repartido para pantalla ancha (48em x 27em; 1em = 40px a 1920x1080) ===== */
#appHub.pc .ah-btn[data-a=htp]{display:none}
#appHub.pc .ah-btn[data-a=friends]{display:none}
#appHub.pc .ah-it[data-a=friends]{display:flex}
#appHub.pc .ah-top{height:2.8em}
#appHub.pc .ah-top:after{height:.07em}
#appHub.pc .ah-ava{left:.5em;top:.2em;width:3.7em;height:3.7em;z-index:5}
#appHub.pc .ah-who{left:4.8em;top:.95em;gap:.22em}
#appHub.pc .ah-name{font-size:.62em}
#appHub.pc .ah-lv{font-size:.38em}
#appHub.pc .ah-line{left:4.8em;top:2.55em;width:18em;height:.11em;box-shadow:0 .05em 0 #000}
#appHub.pc .ah-line:after{width:.3em;height:.3em;top:-.1em;right:-.2em}
#appHub.pc .ah-ico{top:.68em;right:1.1em;gap:.4em}
#appHub.pc .ah-btn{width:1.45em;height:1.45em;border-width:2px}
#appHub.pc .tb,#appHub.pc .px{border-width:2px}
#appHub.pc .ah-btn svg{width:.75em;height:.75em}
#appHub.pc .ah-sp{font-size:.4em}
#appHub.pc .ah-it{left:3.2em}
#appHub.pc .ah-it[data-a=pill]{top:4.35em!important}
#appHub.pc .ah-it[data-a=arenas]{top:7.45em!important}
#appHub.pc .ah-it[data-a=friends]{top:10.55em!important}
#appHub.pc .ah-it[data-a=store]{top:13.65em!important}
#appHub.pc .ah-it[data-a=quests]{top:16.75em!important}
#appHub.pc .ah-it[data-a=core]{top:19.85em!important;display:flex}
#appHub.pc{--bw:17em}
#appHub.pc:has(.ov.open:not(#ahIc):not(#ahUn):not(#ahSv)){--bw:12em}
#appHub.pc .ah-it:before{left:1.4em;top:-.05em;width:var(--bw);height:2.8em;transition:width .45s cubic-bezier(.3,1.25,.4,1)}
#appHub.pc .ah-it:after{left:calc(1.4em + var(--bw));top:-.05em;width:.5em;height:2.8em;transition:left .45s cubic-bezier(.3,1.25,.4,1)}
#appHub.pc .ah-it .med{width:2.7em;height:2.7em}
#appHub.pc .ah-it .med svg{width:1.25em;height:1.25em}
#appHub.pc .ah-it .med canvas{width:2.3em;height:2.3em}
#appHub.pc .ah-it .t{font-size:.6em}
#appHub.pc .ah-it .s{font-size:.4em;margin-top:.8em}
#appHub.pc .ah-it .bar{width:7em}
#appHub.pc #ahPillSub{position:absolute;left:23em;top:1.45em;margin:0;gap:1.2em}
#appHub.pc #ahPillSub img,#appHub.pc #ahPillSub .hk{width:3.9em;height:3.9em}
#ahPillSub .hk{display:inline-block;box-sizing:border-box;width:3.4em;height:3.4em;border:.25em solid #3b4a40;background:rgba(0,0,0,.45);box-shadow:inset 0 0 0 .2em rgba(0,0,0,.6)}
#appHub.pc .ah-it.sel:before{border-color:var(--ac);background:linear-gradient(180deg,#0b0e01,#050700)}
#appHub.pc .ah-it.sel:after{background:#1d2913;left:calc(1.54em + var(--bw))}
#appHub.pc .ah-it.sel .t{color:var(--ac)}
#appHub.pc .ah-it.sel:not([data-a=pill]) .med svg{color:#eaf5ef}
#appHub.pc #ahPill{left:27.5em;top:5.6em;width:16em;height:10.32em}
#appHub.pc .ah-play{right:2.2em;bottom:.75em;width:14.6em;height:3.8em;z-index:6}
#appHub.pc .ah-room{right:16.2em;bottom:.73em;z-index:6;gap:.3em}
#appHub.pc .ah-room .med{width:2.2em;height:2.2em}
#appHub.pc .ah-room .med>svg{width:1.05em;height:1.05em}
#appHub.pc .ah-room .sw{width:1.1em;height:1.1em}#appHub.pc .ah-room .sw svg{width:.78em;height:.78em}
#appHub.pc .ah-room .v{font-size:.36em}
#appHub.pc .ah-sys{font-size:.6em;left:5.5em;right:auto;width:max-content;min-width:min(28.7em,100%);max-width:clamp(28.7em,calc((var(--hw,48) - 30.2) / .6 * 1em),43.3em);top:39em;bottom:auto}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv){background:transparent;justify-content:flex-start;align-items:flex-start;padding:4.3em 0 0 17.5em;pointer-events:none}
#appHub.pc .ov.open .pnl{pointer-events:auto}
.ph>.px.pmax{margin-left:auto}.ph>.pmax+.px{margin-left:.5em}.ph>.cnt+.pmax{margin-left:.7em}
#ahSkSp+.pmax,#ahStSp+.pmax,#ahQSp+.pmax,#ahPrSp+.pmax{margin-left:auto}
#appHub:not(.pc) .ph>.px:last-child{margin-left:auto}
#appHub:not(.pc) .pmax{display:none}
#appHub.pc .ov.full:not(#ahIc):not(#ahUn):not(#ahSv){background:rgba(3,6,4,.9);justify-content:center;align-items:center;padding:0;pointer-events:auto;z-index:8}
#appHub.pc .ov.full:not(#ahIc):not(#ahUn):not(#ahSv) .pnl{width:40em!important;height:24em;font-size:1em}
#appHub.pc #ahAr,#appHub.pc #ahFr{z-index:5}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv) .pnl{width:calc((var(--hw,48) - 18.6) / .765 * 1em)!important;height:24em;font-size:.765em}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv) .pin{padding-bottom:2.8em}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv) .pin{display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding-bottom:1.1em}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv) .pin>:is(.sk-b,.pz-l,.ahr-g,.htp,.cr-b,#ahArBody,#ahFrBody){flex:1 1 0;min-height:0;height:auto}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv) .pin>.foot{margin-top:auto;padding-top:.5em}
#appHub.pc .ov:not(#ahIc):not(#ahUn):not(#ahSv) .pin>.pz-f{margin-top:.6em}
#appHub.pc .ov .sk-b>.sn,#appHub.pc .ov .sk-b>.qg,#appHub.pc .ov .sk-b>.sk-g{align-self:stretch}
#appHub.pc .sk-g:not(.sk-inf) .cell{justify-content:center;gap:.5em}#appHub.pc .sk-g .cell img{width:4.6em;height:4.6em}#appHub.pc .sk-g .cell .nm{font-size:.48em}#appHub.pc .sk-g .cell .inf{font-size:.42em}
#appHub.pc #ahSt .sn .cell canvas,#appHub.pc #ahSk .sn .cell canvas{width:6em;height:6em}
#appHub.pc .co{gap:1.3em}#appHub.pc .co .sw{flex:1;grid-template-columns:repeat(13,1fr);gap:.4em}
#appHub.pc #ahSt .sn,#appHub.pc #ahSk .sn{gap:.6em}
#appHub.pc #ahSt .foot,#appHub.pc #ahSk .foot{margin-top:1.8em}
.sk-g .cell .inf{font-family:'Russo One',sans-serif;font-size:.36em;letter-spacing:.08em;padding:.35em .9em;margin-top:.15em;background:var(--in2);border:.15em solid var(--edge);color:var(--mut);cursor:pointer}
.sk-g .cell .inf:active{color:var(--ac)}
.sk-g.sk-inf{display:flex;flex-direction:column;gap:.5em;padding:.2em .3em}
.sk-inf .ih{display:flex;align-items:center;gap:.8em}
.sk-inf .ih img{width:3.4em;height:3.4em;image-rendering:pixelated;box-shadow:0 0 0 .15em var(--edge);background:#000}
.sk-inf .ih b{font-weight:400;font-size:.7em;letter-spacing:.08em;flex:1;text-shadow:.15em .15em 0 #000}
.sk-inf .ih button{font-family:'Russo One',sans-serif;font-size:.4em;letter-spacing:.08em;padding:.5em 1.2em;background:var(--in2);border:.15em solid var(--edge);color:var(--mut);cursor:pointer}
.sk-inf .id{font-size:.44em;line-height:1.7;color:#cfe0d6;flex:none}
.sk-inf video{flex:1;min-height:0;width:100%;background:#000;object-fit:contain;box-shadow:0 0 0 .15em var(--edge)}
`;
    const cssModales = `
body.hub-on .pw-modal{background:rgba(3,6,4,.9)!important}
/* Los avisos propios de la wallet (Mobile Wallet Adapter) cuelgan de <body>, que
   en horizontal va girado: se gira su contenedor igual que los carteles. */
body > .mwa-host{display:none!important}
/* Avisos del juego (sysModal) en la app: la caja es la misma que la de LEAVE LOBBY
   (#exitModal y #sysModal comparten la regla de ancho de movil). */
html:not([data-hero]) body.mobile-allowed #sysModal .exit-desc{font-size:9px!important;line-height:2!important;margin-bottom:14px!important}
html:not([data-hero]) body.mobile-allowed #sysModal .btn-sys{font-size:11px!important;padding:9px 18px!important}
html:not([data-hero]) body.mobile-allowed > .mwa-host{position:fixed!important;z-index:30000!important;width:var(--pw-largo,100dvh);height:var(--pw-corto,100dvw);
  top:50%;left:50%;transform:translate(-50%,-50%) rotate(90deg);transform-origin:center;pointer-events:auto}
body.hub-on .pw-modal-box{position:relative;background:none!important;border:none!important;border-image:none!important;box-shadow:none!important;outline:none!important;min-width:20em}
body.hub-on .pw-modal-box:before,body.hub-on .pw-modal-box:after{display:none!important}
body.hub-on .pw-modal-box>canvas.hub-placa{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;image-rendering:pixelated}
body.hub-on .pw-modal-box>*:not(.hub-placa){position:relative;z-index:1;margin-left:14px!important;margin-right:14px!important}
body.hub-on .pw-modal-box>.pw-modal-title{margin-top:10px!important}
body.hub-on .pw-modal-box>:last-child{margin-bottom:10px!important}
body.hub-on .room-info .pw-modal-title{font-size:15px!important}
body.hub-on #riBody,body.hub-on #riBody *{font-size:12px!important;line-height:1.7!important}
body.hub-on .room-info .pw-big-btn{font-size:12px!important;padding:11px 8px!important}
body.hub-on .room-info .pw-modal-cancel{font-size:11px!important}
body.hub-on .pw-modal-title{font-family:'Russo One',sans-serif!important;letter-spacing:.16em!important;color:#fff!important;text-shadow:none!important}
body.hub-on .pw-big-btn{background:var(--hub-ac)!important;background-image:none!important;border:none!important;border-image:none!important;box-shadow:none!important;color:#04150c!important;
  font-family:'Russo One',sans-serif!important;letter-spacing:.12em!important;text-shadow:none!important;border-radius:0!important}
body.hub-on .pw-modal-cancel{background:none!important;background-image:none!important;border:2px solid #2c3630!important;border-image:none!important;color:#7d8a82!important;
  font-family:'Russo One',sans-serif!important;letter-spacing:.12em!important;text-shadow:none!important;box-shadow:none!important;border-radius:0!important}
body.hub-on .name-choice .nc-title{font-family:'Russo One',sans-serif!important;letter-spacing:.16em!important;color:#fff!important;text-shadow:none!important;text-align:center;margin-top:10px!important}
body.hub-on .name-choice .nc-btn{display:block!important;margin:12px auto!important;background:none!important;background-image:none!important;border:2px solid #2c3630!important;border-image:none!important;color:#cfd8d3!important;
  font-family:'Russo One',sans-serif!important;letter-spacing:.12em!important;text-shadow:none!important;box-shadow:none!important;border-radius:0!important;padding:8px 22px!important;width:auto!important}
body.hub-on .name-choice .nc-close{color:#7d8a82!important}
body.hub-on .name-choice .nc-field{display:block!important;box-sizing:border-box!important;width:calc(100% - 28px)!important;text-align:center!important}
body.hub-on #gameTopUpModal{background:rgba(3,6,4,.9)!important}
body.hub-on #gameTopUpModal .gameModalBox{position:relative;background:none!important;border:none!important;box-shadow:none!important;transform:none!important;width:380px!important;max-width:none!important;padding:18px 24px 14px!important;text-align:center}
body.hub-on #gameTopUpModal .gameModalBox>canvas.hub-placa{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;image-rendering:pixelated}
body.hub-on #gameTopUpModal .gameModalBox>*:not(.hub-placa){position:relative;z-index:1}
body.hub-on #gameTopUpModal .close{display:none!important}
body.hub-on #gameTopUpModal h3{font-family:'Russo One',sans-serif!important;font-size:15px!important;letter-spacing:.16em!important;color:#fff!important;text-shadow:none!important;margin:4px 0 14px!important}
body.hub-on #gameTopUpModal .gm-row{font-family:'Russo One',sans-serif!important;font-size:12px!important;line-height:1.7!important;color:#cfd8d3!important;display:flex;justify-content:space-between}
body.hub-on #gameTopUpModal label{font-family:'Russo One',sans-serif!important;font-size:11px!important;letter-spacing:.1em;color:var(--hub-ac)!important;display:block;text-align:left;margin-top:4px}
body.hub-on #gameTopUpModal input{background:#050c09!important;border:2px solid #2c4a3f!important;color:#fff!important;border-radius:0!important;font-size:13px!important}
body.hub-on #gameTopUpModal #tuWallet{font-size:11px!important}
body.hub-on #gameTopUpModal .gm-btn{width:100%!important;background:var(--hub-ac)!important;background-image:none!important;border:none!important;border-radius:0!important;box-shadow:none!important;color:#04150c!important;
  font-family:'Russo One',sans-serif!important;font-size:12px!important;letter-spacing:.12em!important;padding:11px 8px!important;margin-top:12px!important}
body.hub-on #gameTopUpModal .hub-close{display:block;margin:10px auto 0;background:none;border:2px solid #2c3630;color:#7d8a82;font-family:'Russo One',sans-serif;font-size:11px;letter-spacing:.12em;padding:6px 18px;cursor:pointer}
body.hub-on .pw-modal input{background:#050c09!important;border:2px solid #2c4a3f!important;color:#fff!important;border-radius:0!important}
/* ---- Fin de partida en la app: estilo de la arena del airdrop (sin marco) ---- */
html.pw-app #resultOverlay,html.pw-app #prizeModal{background:rgba(0,0,0,.78)!important}
html.pw-app body #resultOverlay .result-box.result-box.result-box,html.pw-app body #prizeModal .gameModalBox.gameModalBox.gameModalBox{background:none!important;border:none!important;border-image:none!important;box-shadow:none!important;
  transform:none!important;animation:none!important;width:auto!important;max-width:none!important;min-height:0!important;padding:0!important;
  display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:12px!important;text-align:center}
html.pw-app #resultOverlay .result-box:before,html.pw-app #resultOverlay .result-box:after,html.pw-app #prizeModal .gameModalBox:before,html.pw-app #prizeModal .gameModalBox:after{display:none!important}
html.pw-app .ah-go{font-family:'Press Start 2P',monospace!important;font-size:40px!important;line-height:1.2!important;letter-spacing:0!important;white-space:nowrap;
  text-shadow:5px 5px 0 #000!important;margin:0!important;filter:none!important}
html.pw-app #prizeModal .ah-go{font-size:30px!important}
html.pw-app #myResult,html.pw-app #prizeSubtitle{font-family:'Press Start 2P',monospace!important;font-size:12px!important;line-height:2!important;color:#fff!important;margin:0!important}
html.pw-app #prizeAmount{margin:0!important}
html.pw-app #resultOverlay .result-actions,html.pw-app #prizeModal .prize-actions{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;gap:12px!important;
  justify-content:center!important;align-items:center!important;margin:6px 0 0!important;width:auto!important}
html.pw-app #resultOverlay .result-actions>button,html.pw-app #prizeModal .prize-actions>button{
  --plate:var(--ah-placa-red);background:none!important;background-image:none!important;border:9px solid transparent!important;border-image:var(--plate) 3 fill / 9px / 0 stretch!important;
  border-radius:0!important;clip-path:none!important;box-shadow:none!important;aspect-ratio:auto!important;width:auto!important;min-width:0!important;height:auto!important;
  min-height:46px!important;padding:2px 18px!important;margin:0!important;font-family:'Press Start 2P',monospace!important;font-size:12px!important;color:#fff!important;
  text-shadow:2px 2px 0 rgba(0,0,0,.7)!important;white-space:nowrap!important;filter:drop-shadow(3px 3px 0 rgba(0,0,0,.55))!important;transform:none!important;image-rendering:pixelated}
html.pw-app #btnTryAgainOnline,html.pw-app #prizeContinue{--plate:var(--ah-placa-green)!important}
html.pw-app #resultOverlay .btn-spectate,html.pw-app #prizeShare{--plate:var(--ah-placa-blue)!important}
html.pw-app #btnBackToMenu{--plate:var(--ah-placa-grey)!important}
html.pw-app #ahResShare{--plate:var(--ah-placa-gold)!important}
/* Marcador de KILLS en el HUD: solo en la app (en la web ya estan en el ranking). */
html.pw-app #hudKills{display:inline-block!important}
/* DEPOSIT / WITHDRAW en la app: sin la X; el boton de confirmar mas pequeno y
   un CLOSE al lado, los dos en la misma fila. */
html.pw-app :is(#gameDepositModal,#gameWithdrawModal) .gameModalBox>.close{display:none!important}
html.pw-app .ah-gm-acts{display:flex;gap:10px;justify-content:center;margin-top:12px}
html.pw-app body :is(#gameDepositModal,#gameWithdrawModal) .ah-gm-acts>.gm-btn{--plate:var(--ah-placa-green);flex:1 1 0;min-width:0;margin:0!important;width:auto!important;height:auto!important;aspect-ratio:auto!important;transform:none!important;background:none!important;background-image:none!important;border:9px solid transparent!important;border-image:var(--plate) 3 fill / 9px / 0 stretch!important;border-radius:0!important;box-shadow:none!important;min-height:42px!important;padding:2px 8px!important;font-family:'Press Start 2P',monospace!important;font-size:11px!important;letter-spacing:0!important;color:#fff!important;text-shadow:2px 2px 0 rgba(0,0,0,.7)!important;white-space:nowrap;image-rendering:pixelated;filter:drop-shadow(3px 3px 0 rgba(0,0,0,.55))}
html.pw-app body :is(#gameDepositModal,#gameWithdrawModal) .ah-gm-acts>.gm-btn.ah-gm-close{--plate:var(--ah-placa-grey)}
/* Variante B (html.ah-wal-hub): DEPOSIT y WITHDRAW con el marco de los menus del
   hub, como NOT ENOUGH $PILLY, en vez del gris de los avisos. */
html:not(.ah-wal-hub) :is(#gameDepositModal,#gameWithdrawModal) canvas.hub-placa{display:none!important}
/* DEPOSIT solo dice lo que hay en la wallet; WITHDRAW, lo que hay en el juego. */
html.pw-app #gameDepositModal .gm-row:has(#gdGame){display:none!important}
html.pw-app #gameDepositModal .gm-row:has(#gdWallet){margin-bottom:14px!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal){background:rgba(3,6,4,.9)!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gameModalBox{position:relative;background:none!important;border:none!important;border-image:none!important;box-shadow:none!important;transform:none!important;width:380px!important;max-width:none!important;padding:18px 24px 14px!important;text-align:center}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gameModalBox:before,html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gameModalBox:after{display:none!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gameModalBox>canvas.hub-placa{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;image-rendering:pixelated}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gameModalBox>*:not(.hub-placa){position:relative;z-index:1}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) h3{font-family:'Russo One',sans-serif!important;font-size:15px!important;letter-spacing:.16em!important;color:#fff!important;text-shadow:none!important;margin:4px 0 14px!important;background:none!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gm-row{font-family:'Russo One',sans-serif!important;font-size:12px!important;line-height:1.7!important;color:#cfd8d3!important;display:flex;justify-content:space-between}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .gm-row b{color:#fff!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) label{font-family:'Russo One',sans-serif!important;font-size:11px!important;letter-spacing:.1em;color:var(--hub-ac)!important;display:block;text-align:left;margin-top:4px}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) input{background:#050c09!important;border:2px solid #2c4a3f!important;color:#fff!important;border-radius:0!important;font-size:13px!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .ah-gm-acts>.gm-btn{background:var(--hub-ac)!important;background-image:none!important;border:none!important;border-image:none!important;filter:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;color:#04150c!important;
  font-family:'Russo One',sans-serif!important;font-size:11px!important;letter-spacing:.12em!important;padding:9px 6px!important;text-shadow:none!important;flex:none!important;width:118px!important}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .ah-gm-acts{gap:12px;margin-top:16px}
html.ah-wal-hub body.hub-on :is(#gameDepositModal,#gameWithdrawModal) .ah-gm-acts>.gm-btn.ah-gm-close{background:none!important;border:2px solid #2c3630!important;color:#7d8a82!important}
/* SKIN del editor de avatar: "sin skin" es una casilla del mismo tamano que las demas. */

/* DEPOSIT, NOT ENOUGH $PILLY...: la animacion de entrada (fadeIn) mueve con
   transform y durante sus 0,2 s pisaba el giro del cartel, que asomaba un
   instante como un recuadro oscuro sin girar. */
html.pw-app body.mobile-allowed .gameModal{animation:none!important}
/* CHOOSE SKILL y los carteles de salir de partida, un 15 % mas grandes. */
html.pw-app .skill-choice-card,html.pw-app #exitModal .exit-box{scale:1.15}
html.pw-app #resultOverlay .btn-spectate{display:none!important}
/* Las dos lineas bajo el titulo (kills y $PILLY): una sola letra y tamano. */
html.pw-app .ah-l{font-family:'Press Start 2P',monospace;font-size:12px;line-height:2.1;color:#fff;white-space:nowrap}
html.pw-app .ah-l .ah-w{color:#fff} html.pw-app .ah-l .ah-v{color:#ffce3d} html.pw-app .ah-l .ah-g{color:#00ff88}
html.pw-app .ah-l .ah-r{color:#f62a2d} html.pw-app .ah-l .ah-d{color:#9fc2ad}
html.pw-app #prizeAmount,html.pw-app #prizeAmount *{font-family:'Press Start 2P',monospace!important;font-size:16px!important;text-shadow:3px 3px 0 #000!important}
html.pw-app #prizeAmount img{width:14px!important;height:auto!important}
/* MATCH ENDED: el top 10 en dos columnas de cinco para que quepa en horizontal. */
html.pw-app #prizeTable{grid-template-columns:1fr 1fr;grid-template-rows:repeat(5,auto);grid-auto-flow:column;column-gap:22px;row-gap:2px;margin:0!important;width:640px;max-width:92vw}
html.pw-app #prizeTable[style*="block"]{display:grid!important}
html.pw-app .prizeRow{grid-template-columns:34px 1fr 40px 96px!important;padding:3px 8px!important;font-family:'Press Start 2P',monospace!important;font-size:9px!important;border-bottom:1px solid #1d2420!important;color:#cfd8d3}
html.pw-app .prizeRow .pos,html.pw-app .prizeRow .amt{font-family:'Press Start 2P',monospace!important}
html.pw-app .prizeRow .name{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html.pw-app .prizeRow .amt .pw-unit{font-size:7px}
html.pw-app .prizeRow.mine{border:1px solid rgba(255,206,61,.6)!important;border-radius:0!important}
`;
    const st = document.createElement('style'); st.textContent = css + cssModales; document.head.appendChild(st);
    // Placas pixel de los botones (el mismo generador que el CONNECT del airdrop).
    (function () {
        const W = 48, H = 11, CUT = 2;
        function placa(RGB) {
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const g = cv.getContext('2d');
            const sh = f => RGB.map(v => Math.min(255, Math.round(v * f)));
            const lit = t => RGB.map(v => Math.round(v + (255 - v) * t));
            const inside = (x, y) => {
                if (x < 0 || y < 0 || x >= W || y >= H) return false;
                const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
                return dx >= CUT || dy >= CUT || dx + dy >= CUT;
            };
            const img = g.createImageData(W, H), px = img.data;
            const C_RIM = sh(0.38), C_LIT = lit(0.32), C_DIM = sh(0.70);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                if (!inside(x, y)) continue;
                let ring = 2;
                for (let r = 1; r <= 2 && ring === 2; r++) {
                    for (let oy = -1; oy <= 1 && ring === 2; oy++) for (let ox = -1; ox <= 1; ox++) {
                        if ((!ox && !oy) || inside(x + ox * r, y + oy * r)) continue;
                        ring = r - 1; break;
                    }
                }
                const col = ring === 0 ? C_RIM : ring === 1 ? (Math.min(y, x) <= Math.min(H - 1 - y, W - 1 - x) ? C_LIT : C_DIM) : RGB;
                const i = (y * W + x) << 2;
                px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
            }
            g.putImageData(img, 0, 0);
            return 'url(' + cv.toDataURL() + ')';
        }
        const s = document.documentElement.style;
        s.setProperty('--ah-placa-red', placa([246, 42, 45]));
        s.setProperty('--ah-placa-green', placa([28, 196, 72]));
        s.setProperty('--ah-placa-blue', placa([29, 120, 220]));
        s.setProperty('--ah-placa-grey', placa([88, 100, 104]));
        s.setProperty('--ah-placa-gold', placa([222, 150, 16]));
    })();
    // Cuando sale un cartel del juego con el hub puesto, se le pinta el marco placa del modo.
    function visteModal(m) {
        // La pieza "actions" de carteles-layout.json escala el boton de confirmar
        // (pensado para cuando iba solo): en la fila con CLOSE se salia de la caja.
        ['gdConfirm', 'gwdConfirm'].forEach(id => { const e = document.getElementById(id); if (e) e.style.removeProperty('transform'); });
        if (!document.body.classList.contains('hub-on') || getComputedStyle(m).display === 'none') return;
        if (m.id === 'walletPickerModal') return;   // el selector de wallet conserva su cartel de siempre (el marco placa lo descuadraba)
        const walHub = document.documentElement.classList.contains('ah-wal-hub') && (m.id === 'gameDepositModal' || m.id === 'gameWithdrawModal');
        if (m.classList.contains('gameModal') && m.id !== 'gameTopUpModal' && !walHub) return;
        const box = m.querySelector('.pw-modal-box, .gameModalBox'); if (!box || typeof drawPlacaCaja !== 'function') return;
        // CLOSE en vez de la x de la esquina (se montaba encima del titulo).
        const x = box.querySelector(':scope>.close');
        if (x && !walHub && !box.querySelector(':scope>.hub-close')) { const b = document.createElement('button'); b.className = 'hub-close'; b.textContent = 'CLOSE'; b.onclick = () => x.click(); box.appendChild(b); }
        let cv = box.querySelector(':scope>canvas.hub-placa');
        if (!cv) { cv = document.createElement('canvas'); cv.className = 'hub-placa'; box.prepend(cv); }
        requestAnimationFrame(() => {
            cv._placaKey = ''; drawPlacaCaja(box, cv, MODES[mode], 1);
            // drawPlacaCaja deja el relleno igual al grosor del marco: se le suma el mismo aire por los cuatro lados.
            if (walHub && box._placaPad) box.style.setProperty('padding', (box._placaPad + 16) + 'px ' + (box._placaPad + 18) + 'px ' + (box._placaPad + 18) + 'px', 'important');
        });
    }
    // Mismo alto de caja en todos los carteles de cada tipo: lo que falte se
    // le da al hueco del texto (que va centrado), no a los margenes.
    function igualaAlto(m, descId, alto) {
        const d = document.getElementById(descId), box = m.querySelector('.exit-box');
        if (!d || !box || m.style.display !== 'flex') return;
        d.style.removeProperty('min-height');
        const falta = alto - box.offsetHeight;
        if (falta > 0) d.style.setProperty('min-height', (d.offsetHeight + falta) + 'px', 'important');
    }
    const sysM = document.getElementById('sysModal');
    if (sysM) new MutationObserver(() => {
        const d = document.getElementById('sysModalDesc');
        if (d) { d.style.setProperty('display', 'flex', 'important'); d.style.setProperty('flex-direction', 'column', 'important'); d.style.setProperty('justify-content', 'center', 'important'); }
        igualaAlto(sysM, 'sysModalDesc', 163);
    }).observe(sysM, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(ms => ms.forEach(r => { if (r.target.classList && (r.target.classList.contains('pw-modal') || r.target.classList.contains('gameModal'))) visteModal(r.target); }))
        .observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style'] });

    // Cifra corta, como mucho 4 digitos y sin redondear hacia arriba:
    // 12345 -> 12.34K, 230000 -> 230K, 1542000 -> 1.542M.
    function corto(n) {
        n = Math.max(0, Math.floor(Number(n) || 0));
        if (n < 1000) return String(n);
        const u = ['K', 'M', 'B', 'T']; let i = -1, v = n;
        while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
        const dec = Math.max(0, 4 - String(Math.floor(v)).length), f = Math.pow(10, dec);
        return String(Math.floor(v * f) / f) + u[i];
    }
    // Dolares cortos, como mucho 3 digitos y sin redondear hacia arriba: 1.9 -> $1.90, 12.34 -> $12.3, 1321 -> $1.32K.
    function cortoUsd(u) {
        u = Math.max(0, Number(u) || 0);
        const un = ['K', 'M', 'B', 'T']; let i = -1, v = u;
        while (v >= 1000 && i < un.length - 1) { v /= 1000; i++; }
        const ent = Math.floor(v) > 0 ? String(Math.floor(v)).length : 1, dec = Math.max(0, 3 - ent), f = Math.pow(10, dec);
        const t = (Math.floor(v * f + 1e-9) / f).toFixed(dec);
        return '$' + (i >= 0 ? String(parseFloat(t)) + un[i] : t);
    }
    // Precio de 1 $PILLY en dolares (lo manda el servidor con /api/rooms); 0 si aun no se sabe.
    const pillUsd = () => { try { return (typeof _lastRoomsData !== 'undefined' && _lastRoomsData && Number(_lastRoomsData.pillUsd)) || 0; } catch (e) { return 0; } };
    const conUsd = v => { const u = pillUsd(); return u > 0 ? ' (' + cortoUsd(v * u) + ')' : ''; };
    // Tu $PILLY dentro del juego, al lado de los SP (solo con wallet conectada).
    function pintaPilly() {
        const box = document.querySelector('#appHub .ah-py'); if (!box) return;
        const w = typeof GameWallet !== 'undefined' && GameWallet.address;
        box.hidden = !w;
        if (!w) return;
        const v = Number(GameWalletUI.gameBalance) || 0, el = document.getElementById('ahPy');
        el.textContent = corto(v);
        const pu = document.getElementById('ahPyU'); if (pu) pu.textContent = conUsd(v).trim();
        if (pyPrev != null && v !== pyPrev && !_enPartida && pyTras) {
            pyTras = false;
            box.classList.remove('py-up', 'py-dn'); void box.offsetWidth;
            box.classList.add(v > pyPrev ? 'py-up' : 'py-dn');
            clearTimeout(pyT); pyT = setTimeout(() => box.classList.remove('py-up', 'py-dn'), 6000);
        }
        if (!_enPartida) pyPrev = v;
    }
    let pyPrev = null, pyT = null, pyTras = false;   // pyTras: se acaba de volver de una partida
    setInterval(pintaPilly, 3000);

    window._hubCorto = corto;   // pruebas
    // DEPOSIT y WITHDRAW con el marco de los menus (la variante B que eligio David).
    document.documentElement.classList.add('ah-wal-hub');
    // La cantidad empieza vacia (sin 50000 ni texto de ejemplo) y con el campo
    // vacio el boton no hace nada: antes se depositaba 1 $PILLY.
    [['gameDepositModal', 'gdAmount', 'gdConfirm'], ['gameWithdrawModal', 'gwdAmount', 'gwdConfirm']].forEach(([mid, iid, bid]) => {
        const m = document.getElementById(mid), inp = document.getElementById(iid);
        if (!m || !inp) return;
        inp.placeholder = ''; inp.value = '';
        let abierto = false;
        new MutationObserver(() => { const a = m.style.display === 'flex'; if (a && !abierto) inp.value = ''; abierto = a; })
            .observe(m, { attributes: true, attributeFilter: ['style'] });
        document.addEventListener('click', e => {
            if (e.target.id !== bid || inp.value) return;
            e.stopImmediatePropagation(); e.preventDefault(); inp.focus();
        }, true);
    });
    // DEPOSIT / WITHDRAW: el boton de confirmar y un CLOSE en la misma fila.
    [['gameDepositModal', 'gdConfirm', 'DEPOSIT', () => GameWalletUI.closeDeposit()],
     ['gameWithdrawModal', 'gwdConfirm', 'WITHDRAW', () => GameWalletUI.closeWithdraw()]].forEach(([mid, bid, txt, cerrar]) => {
        const ok = document.getElementById(bid); if (!ok || ok.parentElement.classList.contains('ah-gm-acts')) return;
        const fila = document.createElement('div'); fila.className = 'ah-gm-acts';
        ok.parentElement.insertBefore(fila, ok); fila.appendChild(ok); ok.textContent = txt;
        const c = document.createElement('button'); c.className = 'gm-btn ah-gm-close'; c.textContent = 'CLOSE'; c.onclick = cerrar;
        fila.appendChild(c);
    });
    // Teclado del movil: en horizontal tapa media pantalla y el campo de la
    // cantidad quedaba debajo. Al escribir, el cartel sube lo justo para que el
    // campo quede a la vista; al soltar el teclado vuelve a su sitio.
    function subeCampo(inp) {
        const box = inp.closest('.gameModalBox, .pw-modal-box, #ahFr .pnl, #ahAr .pnl'); if (!box) return;
        const vv = window.visualViewport, alto = window.innerHeight;
        const visible = vv && vv.height < alto - 60 ? vv.height : alto * 0.5;
        box.style.removeProperty('translate');
        const r = inp.getBoundingClientRect(), falta = r.bottom + 10 - visible;
        if (falta > 0) box.style.setProperty('translate', '0 ' + (-falta) + 'px');
    }
    document.addEventListener('focusin', e => {
        const t = e.target; if (!t || t.tagName !== 'INPUT') return;
        if (t.closest('.gameModal, .pw-modal, #ahFr, #ahAr')) setTimeout(() => subeCampo(t), 250);
    });
    document.addEventListener('focusout', e => {
        const box = e.target && e.target.closest && e.target.closest('.gameModalBox, .pw-modal-box, #ahFr .pnl, #ahAr .pnl');
        if (box) box.style.removeProperty('translate');
    });
    const hub = document.createElement('div'); hub.id = 'appHub';
    hub.innerHTML = `
<canvas id="ahBg"></canvas><div id="ahShade"></div>
<div class="ah-top"></div><div class="ah-line"></div>
<div class="ah-ava med" data-a="x"><img alt="" hidden><span class="npc">${svg('npc')}</span></div><i class="ah-fb ah-avb" id="ahAvB"></i>
<div class="ah-who" data-a="x"><div class="ah-name">PLAYER</div><div class="ah-lv" id="ahX">TAP TO CONNECT X</div></div>
<div class="ah-ico"><div class="ah-sp ah-py" hidden><span id="ahPy">0</span><span class="u">$PILLY</span><span class="pu" id="ahPyU"></span></div><div class="ah-sp"><span id="ahSp">0</span><span class="u">SP</span></div>
  <div class="ah-btn" data-a="htp">${svg('gear')}</div><div class="ah-btn" data-a="friends">${svg('friends')}<i class="ah-fb" id="ahFrB"></i></div><div class="ah-btn" data-a="music">${svg('music')}</div><div class="ah-btn" data-a="back">${svg('back')}</div></div>
<div class="ah-it" data-a="pill" style="top:4.7em"><div class="med"><canvas id="ahPillIco"></canvas></div><div><div class="t">THE PILL</div><div class="s" id="ahPillSub"></div></div></div>
<div class="ah-it" data-a="arenas" style="top:8.3em"><div class="med">${svg('swords')}</div><div><div class="t">ARENAS<span class="ah-on"><span class="ah-dot"></span><b id="ahOnline">0</b></span></div><div class="s">1V1 · 2V2 · 3V3</div></div></div>
<div class="ah-it" data-a="friends" style="top:12.6em"><div class="med">${svg('friends')}<i class="ah-fb" id="ahFrB2"></i></div><div><div class="t">FRIENDS</div><div class="s" id="ahFrSub">0 ONLINE</div></div></div>
<div class="ah-it" data-a="store" style="top:11.9em"><div class="med">${svg('store')}</div><div><div class="t">STORE</div><div class="s">NEW SKINS</div></div></div>
<div class="ah-it" data-a="quests" style="top:15.5em"><div class="med">${svg('quests')}</div><div><div class="t">QUESTS</div><div class="bar"><i id="ahQBar" style="width:0"></i></div></div><span class="ah-bdg" id="ahQBdg"></span></div>
<div class="ah-it" data-a="core" style="top:0"><div class="med">${svg('core')}</div><div><div class="t">PILLWARS CORE</div><div class="s">GUIDES · VIDEOS</div></div></div>
<canvas id="ahPill"></canvas>
<div class="ah-sys" id="ahSys"><b>SYSTEM</b><i class="pic"></i><span></span><div class="acts"></div></div>
<div class="ah-room" data-a="rooms"><div class="med">${svg('rooms')}<span class="sw">${svg('swap')}</span></div><div class="v" id="ahRoomV"></div></div>
<div class="ah-play"><span>PLAY</span></div>
<div class="ov" id="ahRooms"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><img class="mw" alt=""><span class="w">ROOMS</span><span class="cnt" id="ahrOn"></span><button class="px">CLOSE</button></div>
  <div class="ahr-g" id="ahrG"></div>
  <div class="ahr-b"><div class="ahr-box" id="ahrInfo"></div><div class="ahr-box" id="ahrRules"></div></div></div></div></div>
<div class="ov" id="ahAv"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">AVATAR</button><span class="cnt"></span><button class="px">DONE</button></div>
  <div class="sk-b"><div class="sk-pill"><div class="av-big" id="ahAvBig"></div></div>
  <div class="av-r"><div class="av-l"><span>STYLE</span><div id="ahAvT"></div></div><div class="av-l"><span>BACKGROUND</span><div id="ahAvBg"></div></div>
  <div class="av-l av-p"><span>PILL TOP</span><div id="ahAvTop"></div></div><div class="av-l av-p"><span>PILL BOTTOM</span><div id="ahAvBot"></div></div><div class="av-l av-p"><span>SKIN</span><div id="ahAvSk"></div></div></div></div>
  <div class="foot">Your avatar shows on your profile</div></div></div></div>
<div class="ov" id="ahIc"><div class="pnl" style="width:22em"><canvas></canvas><div class="pin un-b">
  <div class="un-t">ICON UNLOCKED!</div><div class="ic-card"><canvas id="ahIcCv"></canvas><i></i></div>
  <div class="ic-s">NEW PICTURE FOR YOUR PROFILE</div><div class="sv-bt"><button class="tb" id="ahIcClose">CLOSE</button><button class="tb on" id="ahIcUse">USE IT</button></div></div></div></div>
<div class="ov" id="ahUn"><div class="pnl" style="width:24em"><canvas></canvas><div class="pin un-b">
  <div class="un-t">SKIN UNLOCKED!</div><div class="un-st"><canvas id="ahUnPill"></canvas><b style="left:12%;top:20%"></b><b style="left:82%;top:16%;animation-delay:.35s"></b><b style="left:20%;top:78%;animation-delay:.7s"></b><b style="left:76%;top:74%;animation-delay:1.05s"></b><b style="left:50%;top:6%;animation-delay:.5s"></b></div>
  <div class="un-n" id="ahUnN"></div><div class="sv-bt"><button class="tb" id="ahUnClose">CLOSE</button><button class="tb on" id="ahUnWear">WEAR IT</button></div></div></div></div>
<div class="ov" id="ahHtp"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><span class="w">HOW TO PLAY</span><button class="px">CLOSE</button></div>
  <div class="htp" id="ahHtpB"></div>
  <div class="htp-n"><button class="hn" id="ahHtpP">&lt;</button><span id="ahHtpD"></span><button class="hn" id="ahHtpN">&gt;</button></div></div></div></div>
<div class="ov" id="ahAr"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><span class="w">ARENAS</span><button class="px">CLOSE</button></div>
  <div id="ahArBody"></div></div></div></div>
<div class="ov" id="ahFr"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><span class="w">FRIENDS</span><span class="cnt"></span><button class="px">CLOSE</button></div>
  <div id="ahFrBody"></div></div></div></div>
<div class="ov" id="ahSv"><div class="pnl" style="width:22em"><canvas></canvas><div class="pin">
  <div class="sv-b"><canvas id="ahSvPill"></canvas><div class="sv-n" id="ahSvN"></div><div class="sv-p" id="ahSvP"></div>
  <div class="sv-bt"><button class="tb" id="ahSvBack">BACK</button><button class="tb on" id="ahSvGo"></button></div></div></div></div></div>
<div class="ov" id="ahPr"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">PROFILE</button><span class="cnt" id="ahPrSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="sk-pill pr-me"><div class="pr-pic" id="ahPrPic"></div><div class="pr-at" id="ahPrAt"></div><div class="pr-ic" id="ahPrIc"></div><div class="pr-cl" id="ahPrCl"></div><div class="pr-fc" id="ahPrFc"></div></div>
  <div class="pr-r">
    <div class="pr-box"><button class="tb" id="ahPrAddX" style="display:none">+ CONNECT X</button><div class="k">WALLET</div><div class="pr-w" id="ahPrW">NOT CONNECTED</div><button class="tb red" id="ahPrUnW" style="display:none">UNLINK WALLET</button>
      <div class="k" style="margin-top:1.1em">IN-GAME $PILLY</div><div class="pr-bal" id="ahPrBal">0</div>
      <div class="pr-bt"><button class="tb on" id="ahPrCon">CONNECT WALLET</button><button class="tb" id="ahPrDep">DEPOSIT</button><button class="tb" id="ahPrWd">WITHDRAW</button><button class="tb" id="ahPrPzC">CLAIM<i class="pz-dot" id="ahPrPzDot"></i></button></div></div>
    <div class="pr-st"><div class="cell"><div class="k">MATCHES</div><div class="v" id="ahPrM">0</div></div><div class="cell"><div class="k">BEST KILLS</div><div class="v" id="ahPrK">0</div></div><div class="cell"><div class="k">BEST MASS</div><div class="v" id="ahPrMs">0</div></div></div>
  </div></div>
  <div class="foot">Tap EDIT AVATAR to change your picture</div></div></div></div>
<div class="ov" id="ahPz"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">ARENA PRIZES</button><span class="cnt" id="ahPzSp"></span><button class="px">CLOSE</button></div>
  <div class="pz-l" id="ahPzL"></div>
  <div class="pz-f"><div class="k">TO CLAIM <b id="ahPzT">0 $PILLY</b></div><button class="tb on" id="ahPzAll">CLAIM ALL</button></div></div></div></div>
<div class="ov" id="ahSt"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb" data-s="shop">STORE</button><button class="tb" data-s="mine">MY SKINS</button><button class="tb" data-s="conv">CONVERT</button><span class="cnt" id="ahStSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="sn" id="ahStG" style="grid-template-columns:repeat(4,1fr)"></div><div class="cv-b" id="ahCv"></div></div>
  <div class="foot" id="ahStFoot"></div></div></div></div>
<div class="ov" id="ahQ"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">QUESTS</button><span class="qb" id="ahQBoost"></span><span class="cnt" id="ahQSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="qg" id="ahQG"></div></div>
  <div class="foot" id="ahQFoot">Airdrop points for the $PILLY Genesis Drop</div></div></div></div>
<div class="ov" id="ahCore"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on" data-c="watch">WATCH</button><button class="tb" data-c="core">CORE</button><button class="tb" data-c="basics">BASICS</button><button class="tb" data-c="modes">MODES</button><button class="tb" data-c="skills">SKILLS</button><span class="cnt" id="ahCoreSp"></span><button class="px">CLOSE</button></div>
  <div class="cr-b" id="ahCoreB"></div></div></div></div>
<div class="ov" id="ahSk"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb" data-t="skills">SKILLS</button><button class="tb" data-t="color">COLOR</button><button class="tb" data-t="skins">SKIN</button><span class="cnt" id="ahSkSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="sk-pill"><input id="ahName" maxlength="12" placeholder="YOUR NAME" autocomplete="off" spellcheck="false"><canvas id="ahSkPill"></canvas><div class="sk-slots"><div class="sk-slot" data-s="0"></div><div class="sk-slot" data-s="1"></div></div><div class="sk-lab">YOUR 2 SKILLS</div></div>
  <div class="sk-g" id="ahSkG"></div><div class="co" id="ahCo"></div><div class="sn" id="ahSn"></div></div>
  <div class="foot" id="ahSkFoot"></div></div></div></div>`;
    const $ = s => hub.querySelector(s);

    function scale() {
        const girado = document.body.classList.contains('mobile-allowed');
        // PC (ventana ancha, sin girar): el mismo hub repartido en 48em x 27em (1em = 40px a 1920x1080).
        hub.classList.toggle('pc', !girado);
        const fs = girado ? Math.min(innerWidth, innerHeight) / U * 16 : Math.min(innerHeight / 27, innerWidth / 48);
        hub.style.fontSize = fs + 'px';
        hub.style.setProperty('--hw', (innerWidth / fs).toFixed(2));   // ancho de la ventana en em del hub (>= 48): los paneles de PC se estiran hasta el borde derecho

    }
    const skIcon = id => id ? 'img/skill-icons-pixel/' + id + '.png' : '';
    function paintStatic() {
        const ac = MODES[mode];
        hub.style.setProperty('--ac', ac);
        hub.style.setProperty('--acL', shade(ac, 0.5));
        hub.style.setProperty('--acD', shade(ac, -0.45));
        document.body.style.setProperty('--hub-ac', ac);
        const th = THEME[mode];
        [['--bg', th.bg], ['--top', th.top], ['--in1', th.inner], ['--in2', th.inner2], ['--edge', th.edge], ['--sh', th.shade], ['--mut', th.mut], ['--bar', th.bar], ['--p1', th.p1], ['--p2', th.p2]].forEach(([k, v]) => hub.style.setProperty(k, v));
        const word = mode === 'classic' ? 'CLASSIC' : 'ARCADE';
        $('#ahRooms .mw').src = 'img/mode-title/' + word + '-word.png';
        drawPill($('#ahPillIco'), 64, 0.78);
        // Skill elegida: su icono; sin elegir: el hueco vacio (antes un texto PICK 2 SKILLS).
        $('#ahPillSub').innerHTML = [0, 1].map(i => picks[i] ? '<img src="' + skIcon(picks[i]) + '">' : '<span class="hk"></span>').join('');
        $('#ahRoomV').innerHTML = word + ' · <b class="' + (room === 'Free' || room === 'offline' ? '' : 'usd') + '">' + (room === 'offline' ? 'OFFLINE' : room === 'Free' ? 'FREE' : '$' + room.replace('$', '')) + '</b>';
        try {
            // Barra = misiones hechas hoy sobre las 3 que se pueden marcar; la insignia = todas las misiones del dia que aun no estan hechas.
            const q = aqLoad(), hechas = Object.keys(q.done).length, faltan = Math.max(0, aqList().length - hechas);
            $('#ahQBar').style.width = Math.round(Math.min(1, hechas / AQ_MAX) * 100) + '%';
            $('#ahQBdg').textContent = faltan; $('#ahQBdg').style.display = faltan ? '' : 'none';
        } catch (e) {}
        try { $('#ahSp').textContent = typeof paisSp === 'function' ? paisSp() : '0'; } catch (e) {}
        pintaPilly();
        const n = (document.getElementById('playerNameInput') || {}).value; if (n) $('.ah-name').textContent = n.toUpperCase().slice(0, 12);
        try {
            $('[data-a=music]').classList.toggle('off', !!SoundManager.menuMusicMuted);
                } catch (e) {}
    }

    // Fondo: el MISMO de los menus de modo (paintLoginBg): tile de cuadricula
    // del color del modo y la comida del juego (stepMenuDeco/drawMenuDeco).
    function paintBg() {
        const cv = $('#ahBg');
        let gs = 24; try { gs = Math.max(6, menuDecoSettings.gridSize | 0); } catch (e) {}
        const vw = hub.clientWidth || 800, vh = hub.clientHeight || 360;
        const H = Math.max(gs, Math.round(270 / gs) * gs), W = Math.max(gs, Math.round((vw / vh * H) / gs) * gs);
        if (cv.width !== W) cv.width = W;
        if (cv.height !== H) cv.height = H;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        const hex = MODES[mode];
        try {
            const tile = _msV2Tile(hex);
            if (!tile.pat) tile.pat = g.createPattern(tile.cv, 'repeat');
            g.fillStyle = tile.pat; g.fillRect(0, 0, W, H);
            const rgb = pixRgb(hex); g.fillStyle = 'rgb(' + rgb.map(v => Math.round(v * 0.30)).join(',') + ')'; g.fillRect(W - 1, 0, 1, H); g.fillRect(0, H - 1, W, 1);
            // Si el login sigue pintando por detras ya mueve la comida (mismo estado): aqui solo se dibuja.
            const lo = document.getElementById('loginOverlay');
            if (!(lo && lo.style.display === 'flex')) stepMenuDeco(W, H, performance.now(), true, []);
            drawMenuDeco(g, W, H, true);
        } catch (e) { g.fillStyle = THEME[mode].bg; g.fillRect(0, 0, W, H); }
    }
    // La pildora grande del menu se divide de vez en cuando, como el SPLIT de la
    // partida: salen dos mitades en diagonal, se quedan un momento y se vuelven
    // a juntar con un rebote. Asi se ve como queda tu pildora dividida.
    // Pildora grande del menu: cada 30 s se divide en 2 a 8 copias, rapido y
    // vistoso (salen, se quedan un momento y se vuelven a
    // unir con un rebote). El lienzo es mas ancho que la pildora para que las
    // copias quepan sin cortarse; la pildora entera se ve igual que antes
    // (96 px de lienzo = 13.5em, mismo centro).
    const SPLIT_CICLO = 30000, PILL_W = 157, PILL_H = 101;
    const splitTrozos = () => 2;   // el menu se divide siempre en 2 (antes de 2 a 8)
    // El corro se abre a lo ancho (sobra sitio a los lados; arriba esta la barra).
    const sale = x => 1 - Math.pow(1 - x, 3), suave = x => x * x * (3 - 2 * x);
    function splitEstado(t) {
        const s = (t % SPLIT_CICLO) / 1000;
        if (s < 27) return { d: 0, k: 1 };
        if (s < 27.35) return { d: sale((s - 27) / .35), k: 1 };
        if (s < 28.9) return { d: 1, k: 1 };
        if (s < 29.3) return { d: 1 - suave((s - 28.9) / .4), k: 1 };
        const r = (s - 29.3) / .7;
        return { d: 0, k: 1 + .07 * Math.sin(r * Math.PI) * (1 - r) };
    }
    // Donde va cada copia (en px de una pildora de 96): con dos, de lado; hasta
    // 6, en corro; con 7 u 8, una en medio y el resto alrededor.
    function splitSitios(n, w) {
        const paso = w * 0.62;
        if (n === 2) return [[paso * .6, Math.PI * 3 / 4], [paso * .6, -Math.PI / 4]];
        const corro = n >= 7 ? n - 1 : n, r = Math.max(paso, paso / (2 * Math.sin(Math.PI / corro)));
        const out = []; if (n >= 7) out.push([0, 0]);
        for (let i = 0; i < corro; i++) out.push([r, Math.PI * 3 / 4 + i * 2 * Math.PI / corro]);
        return out;
    }
    function drawPillSplit(cv, t) {
        cv.width = PILL_W; cv.height = PILL_H;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        const o = pillSprite(48); if (!o) return;
        const sw = o.S || o.cv.width, sh = o.S || o.cv.height, cx0 = PILL_W / 2, cy0 = PILL_H / 2;
        const e = splitEstado(t), bob = Math.round(Math.sin(t / 380) * 2);
        const pinta = (x, y, w) => g.drawImage(o.cv, 0, 0, sw, sh, Math.round(x - w / 2), Math.round(y - w * sh / sw / 2), w, w * sh / sw);
        if (e.d <= 0) { pinta(cx0, cy0 + bob, 96 * 0.92 * e.k); return; }
        const n = splitTrozos(Math.floor(t / SPLIT_CICLO));
        const chico = Math.min(0.6, 0.92 / Math.sqrt(n) * 1.15), w = 96 * (0.92 + (chico - 0.92) * e.d);
        splitSitios(n, 96 * chico).forEach(([r, a]) => pinta(cx0 + Math.cos(a) * r * e.d * 1.25, cy0 + Math.sin(a) * r * e.d * 0.78 + bob, w));
    }
    window._hubSplit = (cv, t) => drawPillSplit(cv, t);   // pruebas
    function loop(t) {
        if (!hub.classList.contains('on')) return;
        paintBg(); drawPillSplit($('#ahPill'), t);
        requestAnimationFrame(loop);
    }

    // ---------- ROOMS (solo las del modo) ----------
    // Sin conexion (no contesta /api/rooms) PLAY entra en offline contra bots.
    let sinRed = false;
    async function pullRooms() {
        try { rooms = (await (await fetch('/api/rooms', { cache: 'no-store' })).json()).rooms || []; sinRed = false; } catch (e) { sinRed = true; }
        const mine = rooms.filter(r => r.mode === mode);
        $('#ahOnline').textContent = mine.reduce((a, r) => a + (r.players || 0), 0);
        if ($('#ahRooms').classList.contains('open')) renderRooms();
    }
    // Salas: cada tarjeta enseña sus layers con su aforo; debajo, ROOM INFO de la elegida y las reglas del modo.
    const ROOM_RULES = {
        arcade: ['3 min · starts with 6 players · a new skill every 30s', 'Every 30s an event · good ones and bad ones', 'From min 1 the zone shrinks · outside it you shrink', '6 to 9 players top 3 win · 10 to 19 top 5 · 20+ top 10 · last 3 standing end it'],
        classic: ['Eat cells, split and farm viruses', 'Kill 5 players (pentakill) for the max profit', 'Leaving early costs a penalty up to 20%', 'Paid rooms take the entry from your in-game $PILLY']
    };
    function renderRooms() {
        const g = $('#ahrG'), mine = rooms.filter(r => r.mode === mode);
        $('#ahrOn').textContent = mine.reduce((a, r) => a + (r.players || 0), 0) + ' ONLINE';
        g.innerHTML = '';
        const dot = (l, cap) => l.players >= cap ? 'r' : l.state === 'playing' ? 'g' : l.players > 0 ? 'y' : '';
        const off = document.createElement('div');
        off.className = 'cell k0' + (room === 'offline' ? ' sel' : '');
        off.innerHTML = '<div class="p sm">OFFLINE</div><div class="n">VS BOTS</div><div class="st">PRACTICE</div>';
        off.onclick = () => { room = 'offline'; window._riLayer = null; renderRooms(); paintStatic(); };
        g.appendChild(off);
        const info = { offline: { t: 'OFFLINE', rows: [['ENTRY', 'FREE'], ['PLAYERS', 'VS BOTS'], ['STATUS', 'PRACTICE'], ['PRIZE', 'NONE']] } };
        PRICES.forEach((p, pi) => {
            const r = mine.find(x => x.room === p) || { players: 0, cap: 70, state: 'waiting', needed: 5, layers: [] };
            const cap = r.maxPlayers || 35, lys = (r.layers || []).filter(l => !l.disabled).slice(0, 3);
            const live = (r.players || 0) > 0 || r.state === 'playing';
            const free = p === 'Free', lbl = free ? 'FREE' : '$' + p.replace('$', '');
            const c = document.createElement('div');
            c.className = 'cell k' + (pi + 1) + (p === room ? ' sel' : '');
            c.innerHTML = '<div class="p' + (free ? ' sm' : '') + '">' + lbl + '</div>' +
                (lys.length ? lys.map(l => '<div class="ly"><b>L' + l.layerIdx + '</b><i class="' + dot(l, cap) + '"></i>' + l.players + '/' + (l.maxPlayers || cap) + '</div>').join('') : '<div class="ly"><b>L1</b><i></i>0/' + cap + '</div>') +
                ((r.layers || []).length > lys.length || (r.layers || []).length < 2 ? '<div class="more">UP TO ' + Math.max(4, (r.layers || []).length) + ' LAYERS</div>' : '') +
                '<div class="st ' + (live ? 'live' : 'wait') + '">' + (live ? 'LIVE' : 'WAITING') + '</div>';
            c.onclick = () => { if (room !== p) window._riLayer = null; room = p; renderRooms(); paintStatic(); };
            g.appendChild(c);
            const auto = lys.slice().sort((x, y) => (y.players >= cap ? -1 : y.players) - (x.players >= cap ? -1 : x.players))[0];
            const best = (p === room && window._riLayer && lys.find(l => l.layerIdx === window._riLayer)) || auto;
            if (p === room && !lys.some(l => l.layerIdx === window._riLayer)) window._riLayer = null;
            const fee = best && Number(best.pillFee) > 0 ? Number(best.pillFee) : Number(r.pillFee) || 0;
            const bl = best ? best.state : r.state, bn = best ? best.players : 0;
            info[p] = { t: lbl + (lys.length > 1 ? '' : ' · L' + (best ? best.layerIdx : 1)), lys, sel: best ? best.layerIdx : 1, rows: [
                ['ENTRY', free ? 'FREE' : '<span class="usd">' + lbl + ' · ' + (fee ? fee.toLocaleString('en-US') + ' $PILLY' : '') + '</span>'],
                ['PLAYERS', bn + '/' + (best ? best.maxPlayers || cap : cap)],
                ['STATUS', '<span class="' + (bn > 0 || bl === 'playing' ? 'live' : 'wait') + '">' + (bl === 'playing' ? 'IN GAME' : bn > 0 ? 'LIVE' : 'WAITING') + '</span>'],
                ['PRIZE', mode === 'classic' ? 'KILL LOOT' : 'TOP 3 / 5 / 10']] };
        });
        const cur = info[room] || info.offline, kc = 'k' + (room === 'offline' ? 0 : PRICES.indexOf(room) + 1);
        $('#ahrInfo').className = $('#ahrRules').className = 'ahr-box ' + kc;
        $('#ahrInfo').innerHTML = '<b>ROOM INFO · ' + cur.t + '</b>' + (cur.lys && cur.lys.length > 1 ? '<div class="ahr-lt">' + cur.lys.map(l => '<button data-l="' + l.layerIdx + '"' + (l.layerIdx === cur.sel ? ' class="on"' : '') + '>L' + l.layerIdx + '</button>').join('') + '</div>' : '') + cur.rows.map(x => '<div class="ahr-r">' + x[0] + (/^<span/.test(x[1]) ? x[1] : '<span>' + x[1] + '</span>') + '</div>').join('');
        $('#ahrInfo').querySelectorAll('[data-l]').forEach(b => b.onclick = () => { window._riLayer = +b.dataset.l; try { SoundManager.play('simpleselect'); } catch (e) {} renderRooms(); });
        $('#ahrRules').innerHTML = '<b>RULES</b>' + (ROOM_RULES[mode] || ROOM_RULES.arcade).map((t, k) => '<div class="ahr-n"><i>0' + (k + 1) + '</i>' + t.toUpperCase() + '</div>').join('');
        placa($('#ahRooms .pnl'), 1);
    }

    // ---------- THE PILL: color, skins y (arcade) las dos skills ----------
    let pillTab = 'color';
    function setColor(half, col) {
        const inp = document.getElementById(half);
        if (inp) { inp.value = col; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
        try { SoundManager.play('simpleselect'); } catch (e) {}
        renderPill(); paintStatic();
    }
    function renderPill() {
        // Las 2 skills de salida: en arcade valen siempre; en classic se eligen igual pero solo cuentan en ARENAS.
        hub.querySelectorAll('#ahSk .tb').forEach(b => { b.classList.toggle('on', b.dataset.t === pillTab); b.style.display = ''; });
        $('#ahSk .sk-slots').style.display = $('#ahSk .sk-lab').style.display = '';
        $('#ahSkG').style.display = pillTab === 'skills' ? '' : 'none';
        $('#ahCo').style.display = pillTab === 'color' ? '' : 'none';
        $('#ahSn').style.display = pillTab === 'skins' ? '' : 'none';
        $('#ahSkFoot').textContent = pillTab === 'skills' ? 'You start the match with these two skills' : pillTab === 'color' ? 'Tap a color to paint that half' : 'Tap a skin to wear it';
        $('#ahSkSp').textContent = $('#ahSp').textContent + ' SP';
        drawPill($('#ahSkPill'), 96, 0.92);
        hub.querySelectorAll('.sk-slot').forEach(sl => {
            const i = +sl.dataset.s, id = picks[i];
            sl.className = 'sk-slot' + (id ? ' full' : '') + (i === slotSel && pillTab === 'skills' ? ' act' : '');
            sl.innerHTML = id ? '<img src="' + skIcon(id) + '">' : '';
        });
        if (pillTab === 'color') {
            const co = $('#ahCo'); co.innerHTML = '';
            [['colTop', 'TOP'], ['colBot', 'BOTTOM']].forEach(([half, lb]) => {
                const cur = ((document.getElementById(half) || {}).value || '').toLowerCase();
                const rw = document.createElement('div'); rw.className = 'rw';
                rw.innerHTML = '<div class="lb">' + lb + '</div><div class="sw"></div>';
                PILL_COLS.flat().forEach(col => {
                    const b = document.createElement('b'); b.style.background = col;
                    if (col === cur) b.className = 'sel';
                    b.onclick = () => setColor(half, col);
                    rw.lastChild.appendChild(b);
                });
                co.appendChild(rw);
            });
        }
        if (pillTab === 'skills') {
            const g = $('#ahSkG'); g.innerHTML = '';
            g.classList.toggle('sk-inf', !!skInfo);
            const SID = { clon: 1, shoot: 2, sprint: 3, tp: 4, iman: 5, inmune: 6, big: 7, random: 8 };
            const dat = id => (typeof SKILL_DESCRIPTIONS !== 'undefined' && SKILL_DESCRIPTIONS[SID[id]]) || null;
            if (skInfo && dat(skInfo)) {
                const d = dat(skInfo), nm = (SKILLS.find(x => x[0] === skInfo) || [0, d.name])[1];
                g.innerHTML = '<div class="ih"><b>' + nm + '</b><button>BACK</button></div><video autoplay loop muted playsinline></video><div class="id"></div>';
                g.querySelector('.id').textContent = d.desc;
                g.querySelector('video').src = d.video;
                g.querySelector('button').onclick = () => { skInfo = null; try { SoundManager.play('simpleselect'); } catch (e) {} renderPill(); };
                return placa($('#ahSk .pnl'), 1);
            }
            SKILLS.forEach(([id, nm]) => {
                const c = document.createElement('div');
                c.className = 'cell' + (picks.includes(id) ? ' used' : '');
                c.innerHTML = '<img src="' + skIcon(id) + '"><div class="nm">' + nm + '</div>' + (dat(id) ? '<button class="inf">INFO</button>' : '');
                const bi = c.querySelector('.inf');
                if (bi) bi.onclick = ev => { ev.stopPropagation(); skInfo = id; try { SoundManager.play('simpleselect'); } catch (e) {} renderPill(); };
                c.onclick = () => {
                    const was = picks.indexOf(id);
                    if (was !== -1) { picks[was] = null; slotSel = was; }
                    else { picks[slotSel] = id; slotSel = picks[0] && picks[1] ? slotSel : (picks[0] ? 1 : 0); }
                    try { localStorage.setItem('pw_start_skills', JSON.stringify(picks)); } catch (e) {}
                    try { SoundManager.play('simpleselect'); } catch (e) {}
                    renderPill(); paintStatic();
                };
                g.appendChild(c);
            });
        }
        if (pillTab === 'skins') renderSkins();
        placa($('#ahSk .pnl'), 1);
    }
    let skinPage = 0, skInfo = null;
    function renderSkins(sn, pgHost) {
        sn = sn || $('#ahSn'); pgHost = pgHost || $('#ahSk .pin'); sn.innerHTML = '';
        let mias = [];
        try { mias = skinMiasOrdenadas(); } catch (e) {}
        if (!mias.length) {
            sn.innerHTML = '<div class="none">NO SKINS YET<br>GET COUNTRY SKINS WITH SP<button>OPEN STORE</button></div>';
            sn.querySelector('button').onclick = () => { $('#ahSk').classList.remove('open'); openStore('shop'); };
            return;
        }
        const todas = [null].concat(mias), porPag = 8, pags = Math.ceil(todas.length / porPag);
        skinPage = Math.min(skinPage, pags - 1);
        const puesta = typeof paisPuesta === 'function' ? paisPuesta() : null;
        const top = (document.getElementById('colTop') || {}).value || '#dcdcdc';
        const bot = (document.getElementById('colBot') || {}).value || '#00e05a';
        todas.slice(skinPage * porPag, skinPage * porPag + porPag).forEach(code => {
            const c = document.createElement('div'); c.className = 'cell' + ((code || null) === (puesta || null) ? ' sel' : '');
            const cv = document.createElement('canvas'); cv.width = cv.height = 128;
            const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
            let o = null;
            try { o = code ? paisPillRot(44, code, -Math.PI / 4) : pixPillSpriteRot(44, top, bot, -Math.PI / 4, true); } catch (e) {}
            if (o) { const k = 120 / o.cv.width; g.drawImage(o.cv, 64 - o.cv.width * k / 2, 64 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); }
            const nm = document.createElement('div'); nm.className = 'nm';
            try { nm.textContent = code ? skinNombreCelda(code) : 'YOUR COLORS'; } catch (e) { nm.textContent = code || 'YOUR COLORS'; }
            c.append(cv, nm);
            if ((code || null) === (puesta || null)) c.insertAdjacentHTML('beforeend', '<span class="eq">E</span>');
            c.onclick = async () => {
                try { const r = await paisPoner(code); if (r && r.ok === false) return; } catch (e) { return; }
                try { renderMenuPill(); } catch (e) {}
                try { SoundManager.play('select'); } catch (e) {}
                if ($('#ahSk').classList.contains('open')) renderPill(); else renderStore();
                paintStatic();
            };
            sn.appendChild(c);
        });
        if (pags > 1) {
            const pg = document.createElement('div'); pg.className = 'pg';
            pg.innerHTML = (skinPage + 1) + '/' + pags + ' <b>&rsaquo;</b>';
            pg.querySelector('b').onclick = e => { e.stopPropagation(); skinPage = (skinPage + 1) % pags; renderSkins(sn, pgHost); };
            pgHost.appendChild(pg);
        }
    }
    // ---------- STORE: tienda y tus skins, nada mas ----------
    let storeTab = 'shop', shopPage = 0, buying = null;
    function renderStore() {
        const old = $('#ahSt .pin .pg'); if (old) old.remove();
        hub.querySelectorAll('#ahSt .tb').forEach(b => b.classList.toggle('on', b.dataset.s === storeTab));
        $('#ahStSp').textContent = (typeof paisSp === 'function' ? paisSp() : 0) + ' SP';
        const sn = $('#ahStG');
        sn.style.display = storeTab === 'conv' ? 'none' : ''; $('#ahCv').style.display = storeTab === 'conv' ? '' : 'none';
        if (storeTab === 'conv') { renderConvert(); placa($('#ahSt .pnl'), 1); return; }
        if (storeTab === 'mine') { $('#ahStFoot').textContent = 'Tap a skin to wear it'; renderSkins(sn, $('#ahSt .pin')); placa($('#ahSt .pnl'), 1); return; }
        $('#ahStFoot').textContent = 'You can get SP with daily quests';
        sn.innerHTML = '';
        let todos = []; try { todos = skinTodosCodes(); } catch (e) {}
        const porPag = 8, pags = Math.max(1, Math.ceil(todos.length / porPag));
        shopPage = Math.min(shopPage, pags - 1);
        const puesta = typeof paisPuesta === 'function' ? paisPuesta() : null;
        todos.slice(shopPage * porPag, shopPage * porPag + porPag).forEach(code => {
            const tengo = typeof paisTengo === 'function' && paisTengo(code);
            const c = document.createElement('div'); c.className = 'cell' + (buying === code ? ' buy' : '');
            const cv = document.createElement('canvas'); cv.width = cv.height = 128;
            const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
            try { const o = paisPillRot(44, code, -Math.PI / 4), k = 120 / o.cv.width; g.drawImage(o.cv, 64 - o.cv.width * k / 2, 64 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); } catch (e) {}
            const nm = document.createElement('div'); nm.className = 'nm';
            try { nm.textContent = skinNombreCelda(code); } catch (e) { nm.textContent = code; }
            const pr = document.createElement('div');
            pr.className = 'pr' + (tengo ? ' own' : '');
            pr.textContent = puesta === code ? 'ON' : tengo ? 'OWNED' : buying === code ? 'BUY ' + PAIS_PRECIO_SP + ' SP' : PAIS_PRECIO_SP + ' SP';
            c.append(cv, nm, pr);
            c.onclick = () => { try { SoundManager.play('simpleselect'); } catch (e) {} verSkin(code); };
            sn.appendChild(c);
        });
        if (pags > 1) {
            const pg = document.createElement('div'); pg.className = 'pg';
            pg.innerHTML = (shopPage + 1) + '/' + pags + ' <b>&rsaquo;</b>';
            pg.querySelector('b').onclick = e => { e.stopPropagation(); shopPage = (shopPage + 1) % pags; buying = null; renderStore(); };
            $('#ahSt .pin').appendChild(pg);
        }
        placa($('#ahSt .pnl'), 1);
    }
    // Vista grande de una skin: la pildora en grande y COMPRAR (o PONER si ya es tuya).
    function verSkin(code) {
        const sv = $('#ahSv'), tengo = typeof paisTengo === 'function' && paisTengo(code);
        const puesta = typeof paisPuesta === 'function' ? paisPuesta() : null;
        const cv = $('#ahSvPill'); cv.width = cv.height = 128;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        try { const o = paisPillRot(48, code, -Math.PI / 4), k = 120 / o.cv.width; g.drawImage(o.cv, 64 - o.cv.width * k / 2, 64 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); } catch (e) {}
        try { $('#ahSvN').textContent = skinNombreCelda(code); } catch (e) { $('#ahSvN').textContent = code; }
        const p = $('#ahSvP'), go = $('#ahSvGo');
        p.className = 'sv-p' + (tengo ? ' own' : '');
        p.textContent = puesta === code ? 'WEARING IT' : tengo ? 'YOU OWN IT' : PAIS_PRECIO_SP + ' SP';
        go.textContent = puesta === code ? 'TAKE OFF' : tengo ? 'WEAR IT' : 'BUY';
        go.onclick = async () => {
            go.disabled = true;
            let r = null;
            try { r = tengo ? await paisPoner(puesta === code ? null : code) : await paisComprar(code, 'sp'); } catch (e) {}
            go.disabled = false;
            if (r && r.ok === false) {
                if (r.error === 'not enough SP') { SysQ.push('You need ' + PAIS_PRECIO_SP + ' SP. Earn SP with quests or convert $PILLY in CONVERT.', 12000, 1); return; }
                try { showSystemMsg(r.error || 'Could not do it.', 'STORE'); } catch (e) {} return;
            }
            try { SoundManager.play('select'); } catch (e) {}
            try { renderMenuPill(); } catch (e) {}
            sv.classList.remove('open'); renderStore(); paintStatic();
            if (!tengo) desbloqueada(code);
        };
        sv.classList.add('open'); placa($('#ahSv .pnl'), 1);
    }
    // Con cada skin llega tambien su icono de perfil (la pildora con esa skin):
    // se ensena en una tarjeta y se puede poner ya como foto.
    function iconoNuevo(code) {
        const ic = $('#ahIc'), a = avatar();
        const nuevo = { t: 'pill', skin: code, bg: a.t === 'pill' && a.bg ? a.bg : '#ffd23a' };
        const card = ic.querySelector('.ic-card'), cv = $('#ahIcCv');
        avPill(cv, nuevo, 96);
        // La animacion de entrada vuelve a empezar cada vez que se abre.
        card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
        $('#ahIcClose').onclick = () => ic.classList.remove('open');
        $('#ahIcUse').onclick = () => {
            try { localStorage.setItem('pw_avatar', JSON.stringify(nuevo)); } catch (e) {} avatarCambiado();
            try { SoundManager.play('simpleselect'); } catch (e) {}
            ic.classList.remove('open'); pintaX(); paintStatic();
        };
        ic.classList.add('open'); placa($('#ahIc .pnl'), 1);
        try { SoundManager.play('select'); } catch (e) {}
    }
    window._hubIcon = iconoNuevo;   // pruebas
    // Cartel de skin desbloqueada: la pildora rebotando con destellos.
    function desbloqueada(code) {
        const un = $('#ahUn');
        const cv = $('#ahUnPill'); cv.width = cv.height = 128;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        try { const o = paisPillRot(48, code, -Math.PI / 4), k = 120 / o.cv.width; g.drawImage(o.cv, 64 - o.cv.width * k / 2, 64 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); } catch (e) {}
        try { $('#ahUnN').textContent = skinNombreCelda(code); } catch (e) { $('#ahUnN').textContent = code; }
        $('#ahUnClose').onclick = () => { un.classList.remove('open'); iconoNuevo(code); };
        $('#ahUnWear').onclick = async () => { try { await paisPoner(code); renderMenuPill(); } catch (e) {} un.classList.remove('open'); renderStore(); paintStatic(); iconoNuevo(code); };
        un.classList.add('open'); placa($('#ahUn .pnl'), 1);
        try { SoundManager.play('money'); } catch (e) {}
    }
    // CONVERT: $PILLY del saldo del juego -> SP (100 $PILLY = 1 SP), firmado con la wallet.
    async function renderConvert() {
        const cv = $('#ahCv');
        $('#ahStFoot').textContent = '100 $PILLY = 1 SP. It comes out of your in-game $PILLY';
        const w = window.GameWallet && GameWallet.address;
        if (!w) { cv.innerHTML = '<div class="cv-out" style="color:var(--mut)">CONNECT YOUR WALLET TO CONVERT</div><button class="tb on" id="ahCvCon" style="width:auto;align-self:center;padding:.6em 1.6em">CONNECT WALLET</button>';
            $('#ahCvCon').onclick = async () => { await loginWallet(); renderConvert(); }; return; }
        cv.innerHTML = '<div class="cv-r"><span>IN-GAME $PILLY</span><b id="ahCvBal">...</b></div><div class="cv-r"><span>YOUR SP</span><b>' + (typeof paisSp === 'function' ? paisSp() : 0) + '</b></div>' +
            '<div class="cv-in"><input id="ahCvIn" inputmode="numeric" value="1000"><button class="tb" id="ahCvMax">MAX</button></div><div class="cv-out" id="ahCvOut"></div><button class="tb on" id="ahCvGo" style="width:auto;align-self:center;padding:.6em 2em">CONVERT</button>';
        let bal = 0;
        try { bal = (await (await fetch('/api/warbalance?wallet=' + w, { cache: 'no-store' })).json()).pill || 0; } catch (e) {}
        $('#ahCvBal').textContent = Math.floor(bal).toLocaleString('en-US');
        const inp = $('#ahCvIn'), out = $('#ahCvOut');
        const calc = () => { inp.value = inp.value.replace(/[^0-9]/g, ''); const n = Math.floor((+inp.value || 0) / 100) * 100; out.textContent = '= ' + (n / 100) + ' SP' + (n !== (+inp.value || 0) ? '  (MULTIPLES OF 100)' : ''); return n; };
        inp.oninput = calc; calc();
        $('#ahCvMax').onclick = () => { inp.value = String(Math.floor(bal / 100) * 100); calc(); };
        $('#ahCvGo').onclick = async () => {
            const n = calc();
            if (n < 100) { try { showSystemMsg('Convert at least 100 $PILLY.', 'CONVERT'); } catch (e) {} return; }
            if (n > bal) { try { showSystemMsg('You only have ' + Math.floor(bal).toLocaleString('en-US') + ' $PILLY in the game. Deposit more from your PROFILE.', 'CONVERT'); } catch (e) {} return; }
            let r = null; try { r = await paisConvertir(n); } catch (e) {}
            if (r && r.ok === false) { try { showSystemMsg(r.error || 'Could not convert.', 'CONVERT'); } catch (e) {} return; }
            try { SoundManager.play('select'); } catch (e) {}
            renderStore(); paintStatic();
        };
    }
    function openStore(tab) { storeTab = tab || 'shop'; buying = null; shopPage = 0; skinPage = 0; $('#ahSt').classList.add('open'); renderStore(); }

    // ---------- QUESTS: las misiones jugables del DAILY ARENA del airdrop ----------
    // Copia de QUEST_POOLS de airdrop.html / server/airdrop-score.js (mismos ids,
    // puntos y sorteo por dia UTC): el servidor es quien las da por hechas.
    const QP = [
        { tier: 'EASY', pts: 40, q: [['e-kill1', 'KILL 1 ENEMY', 1, 'd', d => d.kills], ['e-pieces5', 'EAT 5 ENEMY PIECES', 5, 'd', d => d.c.pieces], ['e-skills2', 'USE 2 SKILLS', 2, 'd', d => d.c.skills], ['e-mass3k', 'REACH 3,000 MASS', 3000, 'm'], ['e-survive60', 'SURVIVE 60 SECONDS', 60, 'm']] },
        { tier: 'MEDIUM', pts: 120, q: [['m-kill3', 'KILL 3 ENEMIES', 3, 'd', d => d.kills], ['m-splitkill', 'SPLIT KILL', 1, 'd', d => d.c.splitKills], ['m-pieces15', 'EAT 15 ENEMY PIECES', 15, 'd', d => d.c.pieces], ['m-mass8k', 'REACH 8,000 MASS', 8000, 'm'], ['m-skills3', 'USE 3 DIFFERENT SKILLS', 3, 'd', d => (d.c.skillSet || []).length]] },
        { tier: 'HARD', pts: 260, q: [['h-kill5', 'KILL 5 ENEMIES', 5, 'd', d => d.kills], ['h-kill3match', 'KILL 3 IN ONE MATCH', 3, 'm'], ['h-mass20k', 'REACH 20,000 MASS', 20000, 'm'], ['h-finish', 'SURVIVE THE CLOCK', 1, 'm'], ['h-top5', 'FINISH TOP 5', 1, 'm']] },
        { tier: 'SKILL', pts: 90, q: [['s-sprint', 'USE SPRINT', 1, 'd', d => d.c.skill[3] || 0], ['s-blink', 'USE BLINK', 1, 'd', d => d.c.skill[4] || 0], ['s-magnet', 'USE MAGNET', 1, 'd', d => d.c.skill[5] || 0], ['s-shield', 'USE SHIELD', 1, 'd', d => d.c.skill[6] || 0], ['s-shot', 'USE SHOT', 1, 'd', d => d.c.skill[2] || 0], ['s-gamble', 'WIN A GAMBLE', 1, 'd', d => d.c.gambleWins]] },
        { tier: 'GRIND', pts: 90, q: [['g-play3', 'PLAY 3 MATCHES', 3, 'd', d => d.matches], ['g-survive90', 'SURVIVE 90 SECONDS', 90, 'm'], ['g-split10', 'SPLIT 10 TIMES', 10, 'd', d => d.c.splits], ['g-picks5', 'PICK 5 SKILLS', 5, 'd', d => d.c.picks], ['g-virus', 'BURST ON A VIRUS', 1, 'd', d => d.c.virusPops]] },
    ];
    function qRng(seed) {
        let h = 2166136261;
        for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
        return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
    }
    const qToday = () => new Date().toISOString().slice(0, 10);
    function missionsFor(day) {
        const r = qRng('quests:' + day);
        return QP.map(p => { const q = p.q[Math.floor(r() * p.q.length)]; return { id: q[0], t: q[1], goal: q[2], kind: q[3], prog: q[4], pts: p.pts, tier: p.tier }; });
    }
    // SP por tier (las del airdrop dan puntos de airdrop; estas dan SP del juego).
    const SP_TIER = { EASY: 5, MEDIUM: 10, HARD: 20, SKILL: 10, GRIND: 10 };
    const ORDEN_TIER = ['EASY', 'MEDIUM', 'HARD', 'SKILL', 'GRIND', 'EASY', 'MEDIUM', 'SKILL', 'GRIND'];
    function appMissionsFor(day) {
        const fuera = new Set(missionsFor(day).map(m => m.id));
        const r = qRng('app:' + day), bolsa = {};
        QP.forEach(p => {
            const lista = p.q.filter(q => !fuera.has(q[0]));
            for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]]; }
            bolsa[p.tier] = lista;
        });
        return ORDEN_TIER.map(t => { const q = bolsa[t].shift(); return q && { id: q[0], t: q[1], goal: q[2], kind: q[3], prog: q[4], pts: SP_TIER[t], tier: t }; }).filter(Boolean);
    }
    let adUser = null, adScore = null;
    async function loadAirdrop() {
        try { const j = await (await fetch('/api/airdrop/me', { cache: 'no-store' })).json(); adUser = j.user; adScore = j.score; } catch (e) {}
        renderQuests();
    }
    const fmtN = n => n >= 1000 ? Math.round(n).toLocaleString('en-US') : String(n);
    // ---------- MISIONES de la app: cuentan TODAS en TODOS los modos; marcar (hasta 3) es para verlas en la partida ----------
    // Offline, practica, arenas u online: el juego avisa de lo que pasa (window.pwAq, ver index.html) y aqui se cuenta para
    // las 9 del dia. Las 3 marcadas salen en pantalla mientras juegas. El progreso vive en el movil (por eso vale sin
    // conexion); al completar una se cobra en el servidor (ver server/appquests.js: hace falta cuenta y que el servidor te
    // haya visto jugar hoy, practica de arenas incluida) y si no hay red, cuenta o prueba de juego se cobra al volver.
    const AQ_MAX = 3;
    const AQ_STAT = {
        'e-kill1': 'kills', 'm-kill3': 'kills', 'h-kill5': 'kills', 'e-pieces5': 'pieces', 'm-pieces15': 'pieces', 'e-skills2': 'skills', 'm-skills3': 'skillsDiff',
        'm-splitkill': 'splitKills', 's-sprint': 'sk3', 's-blink': 'sk4', 's-magnet': 'sk5', 's-shield': 'sk6', 's-shot': 'sk2', 's-gamble': 'gambleWin',
        'g-play3': 'matches', 'g-split10': 'splits', 'g-picks5': 'picks', 'g-virus': 'virus', 'e-mass3k': 'mass', 'm-mass8k': 'mass', 'h-mass20k': 'mass',
        'e-survive60': 'alive', 'g-survive90': 'alive', 'h-kill3match': 'killsLife', 'h-finish': 'finish', 'h-top5': 'top5',
    };
    let aq = null, aqMsg = '';
    function aqLoad() {
        const day = qToday();
        if (aq && aq.day === day) return aq;
        try { aq = JSON.parse(localStorage.getItem('pw_aq')); } catch (e) { aq = null; }
        if (!aq || aq.day !== day) aq = { day, pins: [], prog: {}, done: {}, claimed: {}, sk: [] };
        return aq;
    }
    // Colores de la pastilla: antes solo vivian en los selectores ocultos y se perdian al recargar. Se guardan al cambiar y se vuelven a poner al arrancar.
    function aplicaColores() {
        let c = null; try { c = JSON.parse(localStorage.getItem('pw_pillcols')); } catch (e) {}
        if (!Array.isArray(c) || c.length !== 2) return;
        ['colTop', 'colBot'].forEach((id, i) => { const el = document.getElementById(id); if (el && /^#[0-9a-f]{6}$/i.test(c[i])) el.value = c[i]; });
        try { paintStatic(); if ($('#ahSk').classList.contains('open')) renderPill(); } catch (e) {}
    }
    function guardaColores() {
        const t = document.getElementById('colTop'), b = document.getElementById('colBot'); if (!t || !b) return;
        try { const nuevo = JSON.stringify([t.value, b.value]); if (localStorage.getItem('pw_pillcols') !== nuevo) localStorage.setItem('pw_pillcols', nuevo); } catch (e) {}
    }
    document.addEventListener('input', e => { if (e.target && (e.target.id === 'colTop' || e.target.id === 'colBot')) guardaColores(); }, true);
    document.addEventListener('change', e => { if (e.target && (e.target.id === 'colTop' || e.target.id === 'colBot')) guardaColores(); }, true);
    // Cualquier cambio de un ajuste de la cuenta (lo escriba quien lo escriba) adelanta la sincronizacion.
    try {
        const _set = Storage.prototype.setItem, _PK = ['pw_wmute', 'pw_nicks', 'pw_fwatch', 'pw_start_skills', 'pw_app_name', 'pw_pillcols'];
        Storage.prototype.setItem = function (k, v) { const r = _set.apply(this, arguments); if (this === window.localStorage && _PK.indexOf(k) >= 0) { try { cuentaSyncPronto(); } catch (e) {} } return r; };
    } catch (e) {}
    function aqSave() { try { localStorage.setItem('pw_aq', JSON.stringify(aq)); } catch (e) {} cuentaSyncPronto(); }
    // ---- Foto de perfil y misiones iguales en todos los dispositivos de la cuenta (server/accountsync.js) ----
    let csTimer = null, csBusy = false;
    function avatarCambiado() { try { localStorage.setItem('pw_avatar_at', String(Date.now())); localStorage.setItem('pw_avatar_dirty', '1'); } catch (e) {} cuentaSyncPronto(); }
    function cuentaSyncPronto() { clearTimeout(csTimer); csTimer = setTimeout(cuentaSync, 4000); }
    async function cuentaSync() {
        if (csBusy || !(xWallet || xUser)) return;
        csBusy = true;
        try {
            const a = aqLoad(), body = { aq: { day: a.day, pins: a.pins, prog: a.prog, done: a.done, claimed: a.claimed, pt: a.pt || 0 } };
            // ajustes de la cuenta (avisos de amigos, apodos, skills de salida, nombre): cada clave lleva su hora de cambio
            const PK = ['pw_wmute', 'pw_nicks', 'pw_fwatch', 'pw_start_skills', 'pw_app_name', 'pw_pillcols'];
            let snap = {}; try { snap = JSON.parse(localStorage.getItem('pw_pref_t')) || {}; } catch (e) {}
            body.prefs = {};
            PK.forEach(k => {
                let v = null; try { v = localStorage.getItem(k); } catch (e) {}
                if (v == null) return;
                if (!snap[k] || snap[k].v !== v) snap[k] = { v, t: Date.now() };
                body.prefs[k] = snap[k];
            });
            try { localStorage.setItem('pw_pref_t', JSON.stringify(snap)); } catch (e) {}
            // rejoin: lo que se guardo en este dispositivo (o su borrado) para poder seguir desde otro
            let rj = null, rjt = 0, rjc = 0; try { rj = JSON.parse(localStorage.getItem('pw_resume')); rjt = parseInt(localStorage.getItem('pw_resume_t'), 10) || 0; rjc = parseInt(localStorage.getItem('pw_resume_clr'), 10) || 0; } catch (e) {}
            if (rj && rj.expiresAt > Date.now() && rjt >= rjc) { body.resume = rj; body.rt = rjt; }
            else if (rjc) { body.resumeClear = true; body.rt = rjc; }
            let at = 0, sucio = false;
            try { at = parseInt(localStorage.getItem('pw_avatar_at'), 10) || 0; sucio = localStorage.getItem('pw_avatar_dirty') === '1'; } catch (e) {}
            if (sucio) { const av = localStorage.getItem('pw_avatar'); if (av) body.avatar = av; else body.clear = true; body.at = at; }
            const r = await (await fetch('/api/account/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })).json();
            if (!r || !r.ok) return;
            try { if (sucio) localStorage.removeItem('pw_avatar_dirty'); } catch (e) {}
            let cambio = false;
            // foto: gana la mas reciente
            if ((r.at | 0) > at) {
                try {
                    if (r.avatar) localStorage.setItem('pw_avatar', r.avatar); else localStorage.removeItem('pw_avatar');
                    localStorage.setItem('pw_avatar_at', String(r.at));
                } catch (e) {}
                cambio = true;
            }
            // ajustes: si en otro dispositivo se cambiaron mas tarde, aqui se aplican
            const cambiadas = [];
            Object.keys(r.prefs || {}).forEach(k => {
                const p = r.prefs[k]; if (!p || !PK.includes(k) || typeof p.v !== 'string') return;
                if (p.t > ((snap[k] && snap[k].t) || 0) && p.v !== (snap[k] && snap[k].v)) {
                    try { localStorage.setItem(k, p.v); } catch (e) {}
                    snap[k] = { v: p.v, t: p.t }; cambiadas.push(k);
                }
            });
            if (cambiadas.length) {
                try { localStorage.setItem('pw_pref_t', JSON.stringify(snap)); } catch (e) {}
                if (cambiadas.includes('pw_start_skills')) { try { picks = JSON.parse(localStorage.getItem('pw_start_skills')) || [null, null]; } catch (e) {} }
                if (cambiadas.includes('pw_pillcols')) { aplicaColores(); }
                if (cambiadas.includes('pw_app_name')) { try { guardaNombre(localStorage.getItem('pw_app_name')); } catch (e) {} }
                try { if (window.PWSquad && PWSquad.reloadPrefs) PWSquad.reloadPrefs(); } catch (e) {}
                cambio = true;
            }
            // rejoin de otro dispositivo: el boton REJOIN aparece tambien aqui mientras dure la ventana
            if (r.resume && (r.rt | 0) > Math.max(rjt, rjc) && r.resume.expiresAt > Date.now()) {
                let mismoHost = false; try { mismoHost = new URL(r.resume.url).host === location.host || /^(localhost|127\.0\.0\.1)/.test(location.host); } catch (e) {}
                if (mismoHost) {
                    try { localStorage.setItem('pw_resume', JSON.stringify(r.resume)); localStorage.setItem('pw_resume_t', String(r.rt)); localStorage.removeItem('pw_resume_clr'); } catch (e) {}
                    try { Rejoin.refreshButton(); } catch (e) {}
                    cambio = true;
                }
            } else if (!r.resume && rjc === 0 && rj && (r.rt | 0) > rjt) {
                try { localStorage.removeItem('pw_resume'); } catch (e) {}   // la partida ya se cerro en otro dispositivo
                try { Rejoin.refreshButton(); } catch (e) {}
            }
            // misiones de hoy: lo que ya hay en la cuenta se junta con lo de este dispositivo
            const q = r.aq;
            if (q && q.day === a.day) {
                const antes = JSON.stringify([a.pins, a.prog, a.done, a.claimed]);
                if ((q.pt | 0) > (a.pt | 0)) { a.pins = q.pins.slice(0, AQ_MAX); a.pt = q.pt; }
                Object.keys(q.prog || {}).forEach(k => { a.prog[k] = Math.max(a.prog[k] | 0, q.prog[k] | 0); });
                Object.keys(q.done || {}).forEach(k => { a.done[k] = 1; });
                Object.keys(q.claimed || {}).forEach(k => { a.claimed[k] = 1; });
                if (JSON.stringify([a.pins, a.prog, a.done, a.claimed]) !== antes) { try { localStorage.setItem('pw_aq', JSON.stringify(aq)); } catch (e) {} cambio = true; }
            }
            if (cambio) { try { pintaX(); paintStatic(); aqHud(); if ($('#ahQ').classList.contains('open')) renderQuests(); try { PWSquad.refreshAv(); } catch (e) {} } catch (e) {} }
        } catch (e) {} finally { csBusy = false; }
    }
    setInterval(() => { if (hub.classList.contains('on')) cuentaSync(); }, 90000);
    window.pwCuentaSync = () => { clearTimeout(csTimer); csTimer = setTimeout(cuentaSync, 300); };
    // El sorteo del dia se calcula una vez (aqStat se llama muchas veces por segundo).
    let aqCache = null;
    const aqList = () => { const d = aqLoad().day; if (!aqCache || aqCache.d !== d) aqCache = { d, l: appMissionsFor(d) }; return aqCache.l; };
    function aqStat(stat, n, abs) {
        const a = aqLoad(); let cambio = false;
        for (const m of aqList()) {
            const id = m.id;
            if (a.done[id] || AQ_STAT[id] !== stat) continue;
            const prev = a.prog[id] | 0, v = Math.min(m.goal, abs ? Math.max(prev, n | 0) : prev + (n | 0));
            if (v === prev) continue;
            a.prog[id] = v; cambio = true;
            if (v >= m.goal) { a.done[id] = 1; a.pins = a.pins.filter(x => x !== id); aqClaim(m); }   // en silencio, y deja sitio a otra en el menu
        }
        if (cambio) { aqSave(); aqHud(); if ($('#ahQ').classList.contains('open')) renderQuests(); }
    }
    async function aqClaim(m) {
        const a = aqLoad();
        if (a.claimed[m.id]) return;
        try {
            const r = await (await fetch('/api/appquests/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': cidLocal() }, body: JSON.stringify({ id: m.id }) })).json();
            if (r.ok || r.error === 'limit' || r.error === 'not_today') {
                a.claimed[m.id] = r.ok ? 1 : 2; aqSave();
                if (r.ok && !r.already) { aqMsg = ''; try { if (typeof paisSync === 'function') await paisSync(); } catch (e) {} try { $('#ahSp').textContent = paisSp(); } catch (e) {} }
                if (r.error === 'limit') aqMsg = 'DAILY LIMIT: 3 PAID MISSIONS PER DAY';
            } else if (r.error === 'no_account') { aqMsg = 'CONNECT YOUR WALLET TO CLAIM YOUR SP'; }
            else if (r.error === 'no_proof') { aqMsg = 'PLAY ONE ONLINE MATCH TODAY TO CLAIM · ARENA PRACTICE COUNTS'; }
        } catch (e) { /* sin red: se cobra al volver */ }
        if ($('#ahQ').classList.contains('open')) renderQuests();
    }
    function aqRetry() { const a = aqLoad(); aqList().filter(m => a.done[m.id] && !a.claimed[m.id]).forEach(aqClaim); }
    function aqToggle(m) {
        const a = aqLoad();
        if (a.done[m.id] && !a.pins.includes(m.id)) { if (!a.claimed[m.id]) aqClaim(m); return; }
        const k = a.pins.indexOf(m.id);
        if (k >= 0) { a.pins.splice(k, 1); aqMsg = ''; a.pt = Date.now(); }
        else if (a.pins.length >= AQ_MAX) { aqMsg = 'MAX 3 SHOWN IN GAME · TAP ONE OF THEM TO REPLACE IT'; setTimeout(() => { aqMsg = ''; if ($('#ahQ').classList.contains('open')) renderQuests(); }, 2500); }
        else { a.pins.push(m.id); aqMsg = ''; }
        a.pt = Date.now();
        aqSave(); renderQuests(); aqHud();
    }
    // Lo que ve el juego: cada hecho pasa por aqui, en cualquier modo.
    const aqLife = { mass: 0, alive: 0, kills: 0 };
    window.pwAq = {
        matchStart() { aqLife.mass = 0; aqLife.alive = 0; aqLife.kills = 0; aqStat('matches', 1); },
        tick(dt, mass) { aqLife.alive += dt / 1000; if ((aqLife.n = (aqLife.n | 0) + 1) % 15) { if (mass > aqLife.mass) aqLife.mass = mass; return; } if (mass > aqLife.mass) aqLife.mass = mass; aqStat('mass', Math.floor(aqLife.mass), true); aqStat('alive', Math.floor(aqLife.alive), true); },
        kill(split) { aqLife.kills++; aqStat('kills', 1); aqStat('killsLife', aqLife.kills, true); if (split) aqStat('splitKills', 1); },
        piece() { aqStat('pieces', 1); },
        split() { aqStat('splits', 1); },
        virus() { aqStat('virus', 1); },
        pick() { aqStat('picks', 1); },
        skill(id, win) {
            aqStat('skills', 1); aqStat('sk' + id, 1);
            if (id === 8 && win) aqStat('gambleWin', 1);
            const a = aqLoad();
            if (!a.sk.includes(id)) { a.sk.push(id); aqSave(); }
            aqStat('skillsDiff', a.sk.length, true);
        },
        // Fin de la vida o de la partida: sobrevivir al reloj y acabar en el top 5 solo valen si sigues vivo / en el ranking al acabar.
        lifeEnd(aliveAtEnd, rank, clock) {
            if (clock && aliveAtEnd) { aqStat('finish', 1, true); if (rank && rank <= 5) aqStat('top5', 1, true); }
            aqLife.mass = 0; aqLife.alive = 0; aqLife.kills = 0;
        },
    };
    // Las marcadas salen en la partida, como en el Daily Arena del airdrop: asi es mas facil hacerlas.
    let aqHudOn = false;
    function aqHud(on) {
        if (typeof on === 'boolean') aqHudOn = on;
        let el = document.getElementById('aqHud');
        if (!el) {
            const st = document.createElement('style');
            st.textContent = '#aqHud{position:absolute;right:8px;top:90px;z-index:55;display:none;max-width:52vw;text-align:right;font-family:\'Press Start 2P\',monospace;font-size:7px;line-height:1.5;pointer-events:none;text-shadow:1px 1px 0 #000}' +
                '#aqHud.show{display:block}#aqHud .h{color:#8aa096;margin-bottom:3px}' +
                '#aqHud .r{background:rgba(6,10,8,.55);border-right:3px solid #ccff00;padding:3px 7px;margin-bottom:3px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
                '#aqHud .r b{font-weight:400;color:#ccff00;margin-left:6px}#aqHud .r.ok{border-right-color:#00ff66;color:#00ff66}#aqHud .r.ok b{color:#00ff66}' +
                // PC: a la izquierda de todo y con la MISMA caja de TOP MASS (mismo PNG, mismo tamaño, mismas letras); el cuadro de BUFFS baja debajo.
                'html.pw-app body:not(.mobile-allowed) #aqHud{right:auto;left:15px;top:75px;width:210px;height:auto;max-width:none;text-align:left;box-sizing:border-box;border-style:solid;border-width:42px 10px 10px;' +
                'border-image:url(' + (typeof cartelHeroUrl === 'function' ? cartelHeroUrl('top-mass') : 'img/cartel-hero/top-mass.png') + ') 120 30 30 30 fill stretch;background:none;padding:6px 6px 4px;min-height:142px;image-rendering:pixelated;font-family:\'Press Start 2P\',monospace;overflow:visible}' +
                // el titulo TOP MASS viene dibujado en el PNG: se tapa con el color del fondo y se escribe MISSIONS con el mismo verde
                'html.pw-app body:not(.mobile-allowed) #aqHud .h{position:absolute;left:-1px;right:-1px;top:-33px;height:27px;margin:0;padding:0;background:#0c0d12;color:#9cfe87;text-align:center;font-size:17px;line-height:27px;letter-spacing:0;text-shadow:2px 2px 0 #0d4a2a}' +
                'html.pw-app body:not(.mobile-allowed) #aqHud .r{display:flex;justify-content:space-between;gap:6px;background:none;border:none;padding:0;margin:0 0 4px;font-size:8px;line-height:2;color:#fff;white-space:nowrap;text-overflow:clip;overflow:hidden}' +
                'html.pw-app body:not(.mobile-allowed) #aqHud .r b{margin:0;color:#ffe97a;flex:none}' +
                'html.pw-app body:not(.mobile-allowed) #aqHud .r.ok,html.pw-app body:not(.mobile-allowed) #aqHud .r.ok b{color:#00ff66}';
            document.head.appendChild(st);
            el = document.createElement('div'); el.id = 'aqHud';
            (window.pwSquadFrame ? window.pwSquadFrame() : document.body).appendChild(el);
        }
        const a = aqLoad(), rows = a.pins.map(id => aqList().find(m => m.id === id)).filter(Boolean);
        if (!aqHudOn || !rows.length) { el.classList.remove('show'); aqBuffs(); return; }
        el.innerHTML = '<div class="h">MISSIONS</div>' + rows.map(m => {
            const ok = !!a.done[m.id], v = Math.min(m.goal, ok ? m.goal : (a.prog[m.id] | 0));
            return '<div class="r' + (ok ? ' ok' : '') + '">' + (ok ? '✓ ' : '') + m.t + '<b>' + fmtN(v) + '/' + fmtN(m.goal) + '</b></div>';
        }).join('');
        el.classList.add('show');
        aqBuffs();
    }
    function aqBuffs() {
        const el = document.getElementById('aqHud'), bt = document.getElementById('buffTable');
        if (!bt) return;
        const pc = document.documentElement.classList.contains('pw-app') && !document.body.classList.contains('mobile-allowed');
        bt.style.top = (pc && el && el.classList.contains('show')) ? Math.round(el.getBoundingClientRect().bottom + 10) + 'px' : '';
    }
    function renderQuests() {
        const g = $('#ahQG'); g.innerHTML = '';
        const a = aqLoad(), ms = aqList();
        const hechas = ms.filter(m => a.done[m.id]).length;
        $('#ahQBoost').textContent = hechas + '/' + ms.length + ' DONE · ' + a.pins.length + '/' + AQ_MAX + ' IN GAME';
        $('#ahQSp').textContent = (typeof paisSp === 'function' ? paisSp() : 0) + ' SP';
        $('#ahQFoot').textContent = aqMsg || 'All 9 count in every mode, offline too · tap up to 3 to show them in game · reset 00:00 UTC';
        $('#ahQFoot').style.color = aqMsg ? '#ffb347' : '';
        const orden = ms.filter(m => a.pins.includes(m.id) && !a.done[m.id]).concat(ms.filter(m => !a.pins.includes(m.id) && !a.done[m.id]), ms.filter(m => a.done[m.id]));
        orden.forEach(m => {
            const ok = !!a.done[m.id], pin = a.pins.includes(m.id);
            const v = Math.min(m.goal, ok ? m.goal : (a.prog[m.id] | 0));
            const c = document.createElement('div');
            c.className = 'qc' + (ok ? ' done' : '') + (pin ? ' qpin' : '');
            const estado = ok ? (a.claimed[m.id] ? 'DONE' : 'CLAIM') : '+' + m.pts + ' SP';
            c.innerHTML = '<div><div class="k">' + m.tier + ' · ' + (m.kind === 'm' ? 'ONE MATCH' : 'TODAY') + '</div><div class="t"></div></div>' +
                '<div class="qp"><i style="width:' + Math.round(v / m.goal * 100) + '%"></i></div>' +
                '<div class="b"><span class="n">' + fmtN(v) + '/' + fmtN(m.goal) + '</span><span class="pts">' + estado + '</span></div>';
            c.querySelector('.t').textContent = m.t;
            c.onclick = () => aqToggle(m);
            g.appendChild(c);
        });
        placa($('#ahQ .pnl'), 1);
    }
    function openQuests() { $('#ahQ').classList.add('open'); renderQuests(); loadAirdrop(); }
    function closeQuests() {}

    function guardaNombre(v) {
        v = String(v || '').slice(0, 12);
        const inp = document.getElementById('playerNameInput');
        if (inp) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        try { localStorage.setItem('pw_app_name', v); } catch (e) {}
        $('.ah-name').textContent = (v || 'PLAYER').toUpperCase();
    }
    window._hubNombre = guardaNombre;
    // Nombre escrito a mano en el menu antiguo: tambien se guarda en la cuenta.
    document.addEventListener('input', e => { if (e.isTrusted && e.target && e.target.id === 'playerNameInput') { try { localStorage.setItem('pw_app_name', String(e.target.value || '').slice(0, 12)); } catch (x) {} } }, true);
    function openPill(tab) {
        $('#ahName').value = ((document.getElementById('playerNameInput') || {}).value || '');
        $('#ahSk .pin .pg') && $('#ahSk .pin .pg').remove();
        skInfo = null;
        pillTab = tab || (mode === 'arcade' ? 'skills' : 'color');
        slotSel = picks[0] ? (picks[1] ? 0 : 1) : 0;
        $('#ahSk').classList.add('open'); renderPill();
    }

    // ---------- cuenta: la wallet del movil; avatar elegido por el jugador ----------
    const cidLocal = () => { try { return localStorage.getItem('pw_cid') || ''; } catch (e) { return ''; } };
    const AV_STYLES = ['pill', 'spook', 'bag', 'npc'];
    const AV_BG = ['#ab9ff2', '#0a0a0a', '#ccff00', '#00ffaa', '#1e6bff', '#ff2a55', '#ffd23a', '#8a948f', '#ffffff', '#b000ff'];
    const AV_FG = { bag: '#e5463f', spook: '#fbf7ef' };
    let xWallet = null;
    let xCode = null;   // codigo de amigo de la cuenta (el que otros escriben para agregarte)
    let xUser = null;   // cuenta de X vinculada a la wallet: { u, pic } (la misma cuenta del airdrop en PC)
    function avatar() {
        let a = null; try { a = JSON.parse(localStorage.getItem('pw_avatar')); } catch (e) {}
        // Sin elegir: gris de jugador sin conectar; con wallet, el fantasma en morado.
        if (!a || AV_STYLES.indexOf(a.t) === -1) a = (xWallet || (window.GameWallet && GameWallet.address)) ? { t: 'spook', bg: '#ab9ff2' } : { t: 'npc', bg: '#8a948f' };
        return a;
    }
    // La pildora del avatar: sprite del juego (tus colores o la skin) sobre el fondo con su cuadricula.
    function avPill(cv, a, px) {
        cv.width = cv.height = px;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        g.fillStyle = a.bg; g.fillRect(0, 0, px, px);
        g.fillStyle = 'rgba(0,0,0,.14)';
        const paso = px / 4; for (let i = 1; i < 4; i++) { g.fillRect(Math.round(i * paso), 0, Math.max(1, px / 100), px); g.fillRect(0, Math.round(i * paso), px, Math.max(1, px / 100)); }
        const top = a.top || ((document.getElementById('colTop') || {}).value) || '#c8ccd2';
        const bot = a.bot || ((document.getElementById('colBot') || {}).value) || '#00e05a';
        let o = null;
        try { o = a.skin ? paisPillRot(40, a.skin, -Math.PI / 4) : pixPillSpriteRot(40, top, bot, -Math.PI / 4, true); } catch (e) {}
        if (o) { const sw = o.S || o.cv.width, k = px * 0.86 / sw; g.drawImage(o.cv, 0, 0, sw, sw, px / 2 - sw * k / 2, px / 2 - sw * k / 2, sw * k, sw * k); }
    }
    function avEl(a, px) {
        if (a.t === 'pill') { const cv = document.createElement('canvas'); avPill(cv, a, px || 96); cv.className = 'av-cv'; return cv; }
        const sp = document.createElement('span'); sp.className = 'av';
        sp.style.background = a.bg; sp.style.color = AV_FG[a.t] || '#07140f';
        sp.innerHTML = svg(a.t); return sp;
    }
    const avPon = (host, a, px) => { host.innerHTML = ''; host.appendChild(avEl(a, px)); };
    // Con X vinculado la foto de X es el icono por defecto; si el jugador eligio avatar propio, manda el suyo.
    function avPonX(host, a, px) {
        let propio = false; try { propio = !!localStorage.getItem('pw_avatar'); } catch (e) {}
        if (xUser && xUser.pic && !propio) { host.innerHTML = ''; const im = new Image(); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = xUser.pic; im.onerror = () => avPon(host, a, px); host.appendChild(im); return; }
        avPon(host, a, px);
    }
    function pintaX() {
        const w = xWallet || (window.GameWallet && GameWallet.address);
        avPonX($('.ah-ava'), avatar(), 64);
        $('#ahX').textContent = xUser ? '@' + xUser.u : (w ? 'CONNECT X' : 'TAP TO CONNECT');
    }
    // Sesion del juego (la firma de wallet del airdrop): este movil pasa a esa cuenta.
    async function syncX() {
        try {
            const j = await (await fetch('/api/airdrop/me', { cache: 'no-store' })).json();
            xWallet = j && j.user && !j.user.walletPasted && j.user.wallet || null;
            xCode = j && j.user && j.user.code || null;
            const x = j && j.user && j.user.x;
            xUser = x && x.username && /^https:\/\/pbs\.twimg\.com\//.test(x.pic || '') ? { u: String(x.username).replace(/[^\w]/g, ''), pic: x.pic.replace('_normal', '_200x200') } : null;
        } catch (e) {}
        if (xWallet && cidLocal()) {
            try { await fetch('/api/account/link', { method: 'POST', headers: { 'x-client-id': cidLocal() } }); } catch (e) {}
            try { if (typeof paisSync === 'function') await paisSync(); } catch (e) {}
        }
        pintaX(); paintStatic();
        cuentaSync();
    }
    function pintaAvatarEditor() {
        avPonX($('#ahPrPic'), avatar(), 96);
        $('#ahPrIc').innerHTML = '<button class="tb" id="ahPrEdit" style="width:auto;padding:.5em 1.2em">EDIT AVATAR</button>';
        $('#ahPrCl').innerHTML = '';
        $('#ahPrEdit').onclick = openAvatar;
        // Codigo de amigo: debajo de EDIT AVATAR. Tocarlo lo copia.
        const fc = $('#ahPrFc');
        fc.innerHTML = xCode ? '<span class="k">FRIEND CODE</span><b>' + xCode.toUpperCase() + '</b>' : '';
        // Sin X vinculado: el boton para conectarlo (la cuenta de la wallet se queda, se le suma la X).
        // Con X vinculado: el mismo sitio para desvincularlo y poder conectar otra cuenta.
        const ax = $('#ahPrAddX');
        if (ax) {
            ax.style.display = '';
            ax.classList.toggle('red', !!xUser);
            ax.textContent = xUser ? 'UNLINK @' + xUser.u : '+ CONNECT X';
            ax.onclick = xUser ? () => {
                const quita = async () => {
                    try { await fetch('/api/airdrop/unlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what: 'x' }) }); } catch (e) {}
                    await syncX(); pintaAvatarEditor();
                };
                if (typeof window.pwConfirm === 'function') window.pwConfirm('UNLINK X', 'Disconnect @' + xUser.u + ' from this account? You can connect another X account after.', 'UNLINK', 'CANCEL', quita);
                else quita();
            } : () => loginX();
        }
        fc.onclick = () => { if (!xCode) return; try { navigator.clipboard.writeText(xCode); } catch (e) {} const b = fc.querySelector('b'); if (b) { b.textContent = 'COPIED'; setTimeout(() => { b.textContent = xCode.toUpperCase(); }, 1200); } };
    }
    // Editor del avatar: estilo, fondo y, con la pildora, sus colores o una skin tuya.
    function openAvatar() {
        const av = $('#ahAv'), a = avatar();
        const guarda = n => { try { localStorage.setItem('pw_avatar', JSON.stringify(n)); } catch (e) {} avatarCambiado(); try { SoundManager.play('simpleselect'); } catch (e) {} openAvatar(); pintaX(); pintaAvatarEditor(); try { PWSquad.refreshAv(); } catch (e) {} };
        av.classList.toggle('pill', a.t === 'pill');
        avPon($('#ahAvBig'), a, 160);
        const fila = (id, items, pinta, on, elige) => {
            const box = $(id); box.innerHTML = '';
            items.forEach(v => { const b = document.createElement('b'); pinta(b, v); if (on(v)) b.className = (b.className + ' on').trim(); b.onclick = () => elige(v); box.appendChild(b); });
        };
        fila('#ahAvT', AV_STYLES, (b, t) => { if (t === 'pill') { const cv = document.createElement('canvas'); avPill(cv, Object.assign({}, a, { bg: '#1a3a2e' }), 48); b.appendChild(cv); } else { b.style.background = '#1a3a2e'; b.style.color = AV_FG[t] || '#eaf5ef'; b.innerHTML = svg(t); } },
            t => t === a.t, t => guarda(Object.assign({}, a, { t })));
        fila('#ahAvBg', AV_BG, (b, c) => { b.style.background = c; }, c => c === a.bg, c => guarda(Object.assign({}, a, { bg: c })));
        fila('#ahAvTop', SWATCH, (b, c) => { b.style.background = c; }, c => !a.skin && c === a.top, c => guarda(Object.assign({}, a, { top: c, skin: null })));
        fila('#ahAvBot', SWATCH, (b, c) => { b.style.background = c; }, c => !a.skin && c === a.bot, c => guarda(Object.assign({}, a, { bot: c, skin: null })));
        let mias = []; try { mias = skinMiasOrdenadas(); } catch (e) {}
        fila('#ahAvSk', [null].concat(mias.slice(0, 9)), (b, code) => {
            if (!code) { b.className = 'no'; b.title = 'NO SKIN'; b.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.2 11.8 11.8 4.2" stroke="currentColor" stroke-width="2"/></svg>'; return; }
            const cv = document.createElement('canvas'); avPill(cv, { bg: '#1a3a2e', skin: code }, 48); b.appendChild(cv);
        }, code => (code || null) === (a.skin || null), code => guarda(Object.assign({}, a, { skin: code })));
        // Tu foto de X como un icono mas: elegirla quita el icono propio y vuelve a salir la foto.
        const tx = $('#ahAvT');
        if (xUser && tx) {
            const b = document.createElement('b'); b.className = 'xpic' + (localStorage.getItem('pw_avatar') ? '' : ' on'); b.title = 'X PHOTO';
            const im = new Image(); im.src = xUser.pic; im.referrerPolicy = 'no-referrer'; im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; b.appendChild(im);
            b.onclick = () => { try { localStorage.removeItem('pw_avatar'); } catch (e) {} avatarCambiado(); try { SoundManager.play('simpleselect'); } catch (e) {} openAvatar(); pintaX(); pintaAvatarEditor(); try { PWSquad.refreshAv(); } catch (e) {} };
            tx.insertBefore(b, tx.firstChild);
            if (!localStorage.getItem('pw_avatar')) { tx.querySelectorAll('b.on').forEach(x => { if (x !== b) x.classList.remove('on'); }); const big = $('#ahAvBig'); if (big) { big.innerHTML = ''; const bi = new Image(); bi.src = xUser.pic; bi.referrerPolicy = 'no-referrer'; bi.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; big.appendChild(bi); } }
        }
        av.classList.add('open'); placa($('#ahAv .pnl'), 1);
    }
    async function openProfile() {
        const pr = $('#ahPr'), w = xWallet || (window.GameWallet && GameWallet.address);
        $('#ahPrAt').textContent = ((document.getElementById('playerNameInput') || {}).value || 'PLAYER').toUpperCase().slice(0, 12);
        $('#ahPrSp').textContent = (typeof paisSp === 'function' ? paisSp() : 0) + ' SP';
        pintaAvatarEditor();
        pr.classList.add('open'); placa($('#ahPr .pnl'), 1);
        pintaWallet();
        if (w) try {
            const st = await (await fetch('/api/airdrop/arena/stats', { cache: 'no-store' })).json();
            $('#ahPrM').textContent = st.matches || 0;
            $('#ahPrK').textContent = (st.best && st.best.kills) || 0;
            $('#ahPrMs').textContent = ((st.best && st.best.mass) || 0).toLocaleString('en-US');
        } catch (e) {}
    }
    let saldoJuego = 0;
    async function pintaWallet() {
        const conectada = window.GameWallet && GameWallet.address;
        const w = conectada || xWallet;
        $('#ahPrW').textContent = w ? w.slice(0, 6) + '...' + w.slice(-6) + '  (TAP TO COPY)' : 'NOT CONNECTED';
        // Tocar la direccion la copia entera (para pegarla donde haga falta).
        $('#ahPrW').onclick = w ? async () => {
            try { await navigator.clipboard.writeText(w); $('#ahPrW').textContent = 'ADDRESS COPIED'; } catch (e) { $('#ahPrW').textContent = w; }
            setTimeout(pintaWallet, 1500);
        } : null;
        $('#ahPrCon').style.display = conectada ? 'none' : '';
        // Desvincular la wallet (para conectar otra). El saldo del juego se queda con esa wallet.
        $('#ahPrUnW').style.display = conectada ? '' : 'none';
        $('#ahPrUnW').onclick = () => {
            const quita = async () => {
                try { await fetch('/api/airdrop/unlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what: 'wallet' }) }); } catch (e) {}
                try { if (window.GameWalletUI) GameWalletUI.disconnect(); } catch (e) {}
                await syncX(); pintaWallet(); pintaAvatarEditor();
            };
            const w0 = conectada;
            if (typeof window.pwConfirm === 'function') window.pwConfirm('UNLINK WALLET', 'Disconnect ' + w0.slice(0, 4) + '...' + w0.slice(-4) + ' from this account? Its in-game $PILLY stays with that wallet. You can connect another one after.', 'UNLINK', 'CANCEL', quita);
            else quita();
        };
        $('#ahPrDep').style.display = $('#ahPrWd').style.display = conectada ? '' : 'none';
        saldoJuego = 0;
        if (w) try { saldoJuego = (await (await fetch('/api/warbalance?wallet=' + w, { cache: 'no-store' })).json()).pill || 0; } catch (e) {}
        $('#ahPrBal').textContent = Math.floor(saldoJuego).toLocaleString('en-US') + conUsd(saldoJuego);
        // CLAIM: premios de arenas (historial con lo cobrado y lo pendiente). El punto avisa si hay algo por cobrar.
        $('#ahPrPzC').style.display = conectada ? '' : 'none';
        $('#ahPrPzC').onclick = abrePremios;
        $('#ahPrPzDot').style.display = 'none';
        if (w && window.PWSquad) airStatus().then(air => PWSquad.prizes(w, (total, list) => { const d = $('#ahPrPzDot'), n = (list || []).length + (air && air.available ? 1 : 0); d.textContent = n ? String(Math.min(n, 99)) : ''; d.style.display = (total > 0 || n) ? '' : 'none'; }));
        if (window.GameWalletUI && conectada) GameWalletUI.gameBalance = saldoJuego;
    }
    // Historial de premios de arenas: los cobrados salen CLAIMED; lo pendiente se cobra todo con CLAIM ALL.
    function abrePremios() {
        const ov = $('#ahPz'), w = window.GameWallet && GameWallet.address;
        ov.classList.add('open'); placa($('#ahPz .pnl'), 1);
        $('#ahPzL').innerHTML = '<div class="pz-e">LOADING...</div>';
        const fmt = corto;
        let air = null;
        const pinta = (total, list, usd, hist) => {
            const totArena = total;
            if (air) { hist = [{ air: true, claimed: air.claimed, amount: air.amount, at: air.at || Date.now() }].concat(hist || []); if (air.available) total += air.amount; }
            const fecha = t => { const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() + ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
            $('#ahPzL').innerHTML = hist.length ? hist.map(h => '<div class="pz-r' + (h.claimed ? ' done' : '') + '"><div class="m">' + (h.air ? 'AIRDROP' : (h.size || 1) + 'V' + (h.size || 1) + ' · ' + (h.cents ? '$' + h.cents / 100 : 'FREE')) + '</div><div class="d">' + fecha(h.at) + '</div><div class="a">+' + fmt(h.amount) + ' $PILLY' + (h.usd != null ? ' (' + cortoUsd(h.usd) + ')' : '') + '</div><div class="s ' + (h.claimed ? 'ok' : 'no') + '">' + (h.claimed ? 'CLAIMED' : 'TO CLAIM') + '</div></div>').join('')
                : '<div class="pz-e">EMPTY<br>WIN A PAID ARENA MATCH TO GET PRIZES</div>';
            const fl = $('#ahPzL'), f0 = fl.firstElementChild;   // alto exacto de 4 filas, haya las que haya
            if (f0 && f0.classList.contains('pz-r')) { const cs = getComputedStyle(fl); fl.style.height = (4 * f0.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)) + 'px'; }
            $('#ahPzT').textContent = fmt(total) + ' $PILLY' + (usd != null ? ' (' + cortoUsd(usd) + ')' : '');
            $('#ahPzAll').disabled = !(total > 0);
            $('#ahPzAll').onclick = async () => {
                if (air && air.available) await airCobra();
                if (totArena > 0 && window.PWSquad) PWSquad.claimAll(() => { abrePremios(); pintaWallet(); refreshClaims(false); });
                else { abrePremios(); pintaWallet(); }
            };
        };
        if (!w || !window.PWSquad) return pinta(0, [], null, []);
        airStatus().then(a => { air = a; PWSquad.prizes(w, pinta); });
    }
    // Claim del airdrop (solo devnet): 10K $PILLY una vez, para quien tenga wallet firmada + X vinculado.
    // Sale en la lista de CLAIM como un premio mas, con AIRDROP donde las arenas ponen 2V2.
    async function airStatus() {
        try { const j = await (await fetch('/api/airdrop-claim', { cache: 'no-store' })).json(); return j && j.ok && j.devnet && (j.available || j.claimed) ? j : null; } catch (e) { return null; }
    }
    async function airCobra() {
        let j = null;
        try { j = await (await fetch('/api/airdrop-claim', { method: 'POST' })).json(); } catch (e) {}
        try { showSystemMsg(j && j.ok ? 'Airdrop claimed: +' + j.amount.toLocaleString('en-US') + ' $PILLY added to your in-game balance (' + String(j.wallet || '').slice(0, 4) + '...' + String(j.wallet || '').slice(-4) + ').' : 'Airdrop claim failed: ' + ((j && j.reason) || 'try again'), 'AIRDROP'); } catch (e) {}
        return !!(j && j.ok);
    }
    function conectaX() { openProfile(); }
    const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Login de X por el NAVEGADOR del movil (dentro del WebView X acababa en su propia app y no volvia). Antes de
    // salir se guarda un secreto; el servidor devuelve a la app por pillwars://xlogin y solo con ese secreto se canjea.
    async function loginX() {
        // PC: no hay app ni intent://; login normal en esta misma pestaña (la cookie de sesion ya es la de la wallet) y vuelve a /game/.
        if (hub.classList.contains('pc') || !/Android/i.test(navigator.userAgent)) {
            const ret = /^\/[A-Za-z0-9_\-\/]{0,120}$/.test(location.pathname) ? location.pathname : '/game/';
            location.href = '/airdrop-auth/x/login?ret=' + encodeURIComponent(ret);
            return;
        }
        const sec = b64u(crypto.getRandomValues(new Uint8Array(32)));
        try { localStorage.setItem('pw_xs', sec); } catch (e) {}
        const h = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sec)));
        // Codigo atado a la sesion de ESTA app (la wallet): asi X se vincula a tu cuenta y no a una nueva del navegador.
        let k = ''; try { k = (await (await fetch('/airdrop-auth/x/prep', { cache: 'no-store' })).json()).k || ''; } catch (e) {}
        const url = location.host + '/airdrop-auth/x/login?app=1&h=' + h + (k ? '&k=' + encodeURIComponent(k) : '') + '&ret=' + encodeURIComponent(location.pathname);
        location.href = 'intent://' + url + '#Intent;scheme=' + location.protocol.replace(':', '') + ';action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end';
    }
    // Wallet del movil: la misma firma de entrada que el airdrop (gratis, sin tx).
    // Devuelve true si quedo conectada.
    async function loginWallet() {
        // Movil: Mobile Wallet Adapter. PC: el selector de wallets de siempre (Phantom / Backpack / Solflare).
        const pc = hub.classList.contains('pc');
        let wname = 'mwa', p = null;
        if (pc) {
            if (!(GameWallet.address && GameWallet.provider)) {
                GameWalletUI.connect();   // abre el selector; connectWith deja GameWallet.address y .provider
                const t0 = Date.now();
                // Espera a que el selector termine (elegir wallet + firmar en la extension); si se cierra y no pasa nada en 30 s, se da por cancelado.
                let cerradoDesde = 0;
                while (!(GameWallet.address && GameWallet.provider) && Date.now() - t0 < 120000) {
                    const m = document.getElementById('walletPickerModal');
                    if (m && m.style.display !== 'none') cerradoDesde = 0; else if (!cerradoDesde) cerradoDesde = Date.now();
                    if (cerradoDesde && Date.now() - cerradoDesde > 30000) break;
                    await new Promise(r => setTimeout(r, 300));
                }
                if (!(GameWallet.address && GameWallet.provider)) return false;
            }
            p = GameWallet.provider; try { wname = localStorage.getItem('pw_wallet') || 'phantom'; } catch (e) {}
        } else if (window.GameWallet) p = GameWallet.getProvider('mwa');
        if (!p) { try { showSystemMsg('The phone wallet is not ready yet. Try again in a moment.', 'WALLET'); } catch (e) {} return false; }
        try {
            const r = pc ? { publicKey: p.publicKey || { toString: () => GameWallet.address } } : await p.connect();
            const addr = pc ? GameWallet.address : r.publicKey.toString();
            const post = (path, body) => fetch('/api/airdrop/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json());
            const { nonce, message } = await post('nonce', {});
            const out = await p.signMessage(new TextEncoder().encode(message));
            const j = await post('wallet', { address: addr, nonce, signature: Array.from(out.signature) });
            if (j.error) throw new Error(j.error);
            GameWallet.address = addr; GameWallet.provider = p;
            try { localStorage.setItem('pw_wallet', wname); localStorage.setItem('pw_addr', addr); } catch (e) {}
            await syncX();
            return true;
        } catch (e) { try { showSystemMsg('The wallet did not sign in. Please try again.', 'WALLET'); } catch (x) {} return false; }
    }
    // Sala de pago: antes de nada (ROOM INFO, firma...) se mira si llega el saldo;
    // si no, solo sale el cartel de depositar. Devuelve true si se puede seguir.
    async function saldoParaSala() {
        if (!(window.GameWallet && GameWallet.address) && !(await loginWallet())) return false;
        const r = rooms.find(x => x.mode === mode && x.room === room) || {};
        const fee = Math.ceil(r.pillFeeLive || r.pillFee || 0);
        let bal = 0;
        try { bal = (await (await fetch('/api/warbalance?wallet=' + GameWallet.address, { cache: 'no-store' })).json()).pill || 0; } catch (e) {}
        if (bal >= fee) return true;
        return !!(await GameWalletUI.pedirDeposito(fee, bal));
    }

    // PC: los paneles salen a la derecha de las barras, uno a la vez (los pequeños IC/UN/SV son avisos y no cuentan).
    const PANELES = '.ov:not(#ahIc):not(#ahUn):not(#ahSv)';
    function cierraPaneles() {
        hub.querySelectorAll(PANELES + '.open').forEach(o => {
            o.classList.remove('open'); o.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} });
            if (o.id === 'ahPr') pintaWallet(); if (o.id === 'ahQ') closeQuests();
            const pg = o.querySelector('.pg'); if (pg) pg.remove();
        });
    }
    // Pagina de HOW TO PLAY: 0 = las 8 skills (tocar una enseña su INFO), 1.. = las guias del juego (guideSlides).
    let htpPag = 0, htpSk = null;
    function renderHtp() {
        const slides = typeof guideSlides !== 'undefined' ? guideSlides : [];
        const body = $('#ahHtpB'); body.innerHTML = '';
        const SID = { clon: 1, shoot: 2, sprint: 3, tp: 4, iman: 5, inmune: 6, big: 7, random: 8 };
        const dat = id => (typeof SKILL_DESCRIPTIONS !== 'undefined' && SKILL_DESCRIPTIONS[SID[id]]) || null;
        if (htpPag === 0 && htpSk && dat(htpSk)) {
            const d = dat(htpSk), nm = (SKILLS.find(x => x[0] === htpSk) || [0, d.name])[1];
            body.innerHTML = '<div class="ih"><img src="' + skIcon(htpSk) + '" style="width:3.4em;height:3.4em;image-rendering:pixelated"><span class="ht" style="flex:1"></span><button class="hb">BACK</button></div><div class="hd"></div><video autoplay loop muted playsinline></video>';
            body.querySelector('.ih').style.cssText = 'display:flex;align-items:center;gap:.8em';
            body.querySelector('.ht').textContent = nm; body.querySelector('.hd').textContent = d.desc; body.querySelector('video').src = d.video;
            body.querySelector('.hb').onclick = () => { htpSk = null; renderHtp(); };
        } else if (htpPag === 0) {
            body.innerHTML = '<div class="hh">SKILL ARSENAL - TAP A SKILL</div><div class="htp-g"></div><div class="hd" style="text-align:center">8 skills, drafted every 30s in a match</div>';
            const g = body.querySelector('.htp-g');
            SKILLS.forEach(([id, nm]) => {
                const c = document.createElement('div'); c.className = 'cell';
                c.innerHTML = '<img src="' + skIcon(id) + '"><div class="nm">' + nm + '</div>';
                c.onclick = () => { htpSk = id; try { SoundManager.play('simpleselect'); } catch (e) {} renderHtp(); };
                g.appendChild(c);
            });
        } else {
            const sl = slides[htpPag - 1];
            if (sl) {
                body.innerHTML = '<div class="ht"></div><div class="hd"></div><video autoplay loop muted playsinline></video>';
                body.querySelector('.ht').textContent = sl.title; body.querySelector('.hd').textContent = sl.desc; body.querySelector('video').src = sl.video;
            }
        }
        const n = slides.length + 1;
        $('#ahHtpD').innerHTML = Array.from({ length: n }, (_, i) => '<i class="' + (i === htpPag ? 'on' : '') + '"></i>').join('');
        placa($('#ahHtp .pnl'), 1);
    }

    // ---------- PILLWARS CORE: guias y videos (solo PC) ----------
    // WATCH: los videos, en orden. off = aun no esta hecho (sale, pero no se abre).
    // Videos en video/social/1.mp4, 2.mp4, 4.mp4 y 5.mp4 (el 3, GAME MODES, aun no esta hecho).
    // Si un archivo no esta en el servidor su tarjeta no sale; ORIGIN usa el video antiguo mientras falte el 1.
    const CORE_VIDEOS = [
        { src: '../video/social/1.mp4', alt: '../video/pillwars-origin.mp4', t: 'PILLWARS ORIGIN', d: 'Where PillWars comes from.', tag: 'STORY' },
        { src: '../video/social/2.mp4', t: 'HOW TO PLAY PILLWARS', d: 'Everything you need for your first match.', tag: 'GUIDE' },
        { off: true, t: 'GAME MODES', d: 'Classic, Arcade and Arenas explained. Coming soon.', tag: 'SOON' },
        { src: '../video/social/4.mp4', t: 'PILLWARS ON SEEKER', d: 'Play PillWars on the Solana Seeker.', tag: 'SEEKER' },
        { src: '../video/social/5.mp4', t: 'JOIN THE PILLWARS COMMUNITY', d: 'Meet the players and follow the news.', tag: 'COMMUNITY' }
    ];
    // Que videos existen de verdad (se mira una vez con HEAD).
    let coreHay = null;
    async function coreMira() {
        if (coreHay) return;
        coreHay = {};
        await Promise.all(CORE_VIDEOS.filter(c => c.src).map(async c => { try { coreHay[c.src] = (await fetch(c.src, { method: 'HEAD', cache: 'no-store' })).ok; } catch (e) { coreHay[c.src] = false; } }));
        CORE_VIDEOS.forEach(c => { if (c.src && !coreHay[c.src]) { if (c.alt) c.src = c.alt; else c.falta = true; } });
        if ($('#ahCore').classList.contains('open') && coreTab === 'watch') renderCore();
    }
    // CORE: las dos imagenes que explican el juego, con su texto.
    const CORE_IMGS = [
        { img: 'img/core/agar.png', t: 'INSPIRED BY AGAR.IO', d: 'PillWars takes the classic cell-eating formula (eat, grow, split) and adds skills, game modes and real prizes.' },
        { img: 'img/core/basics.png', t: 'EAT · HUNT · SURVIVE', d: 'Eat the food to grow. Bigger eats smaller, so swallow other players whole. Someone is always bigger: split, dodge, hide. And 8 skills to outplay everyone.' }
    ];
    let coreTab = 'watch', coreVid = 0, coreSk = 'clon';
    const crVideo = (src, extra) => '<video ' + (extra || '') + ' playsinline src="' + src + '"></video>';
    function renderCore() {
        const b = $('#ahCoreB'); b.innerHTML = '';
        hub.querySelectorAll('#ahCore .tb').forEach(t => t.classList.toggle('on', t.dataset.c === coreTab));
        if (coreTab === 'watch') {
            coreMira();
            if (!CORE_VIDEOS[coreVid] || CORE_VIDEOS[coreVid].off || CORE_VIDEOS[coreVid].falta) coreVid = 0;
            const v = CORE_VIDEOS[coreVid];
            b.innerHTML = '<div class="cr-main"><div class="cr-vid"></div><div><div class="cr-ti"></div><div class="cr-de"></div></div></div><div class="cr-list"></div>';
            b.querySelector('.cr-ti').textContent = v.t; b.querySelector('.cr-de').textContent = v.d;
            // El video empieza solo y sin sonido (los controles dejan activarlo); al cambiar de pestaña o cerrar se para.
            b.querySelector('.cr-vid').innerHTML = v.src ? crVideo(v.src, 'controls autoplay muted loop') : '<div class="cr-img" style="position:absolute;inset:0;border:none;background-image:url(' + v.img + ')"></div>';
            const l = b.querySelector('.cr-list');
            CORE_VIDEOS.forEach((c, i) => {
                if (c.falta) return;
                const k = document.createElement('div'); k.className = 'cr-card' + (i === coreVid ? ' on' : '') + (c.off ? ' off' : '');
                const th = c.src ? '<video muted preload="metadata" playsinline src="' + c.src + '#t=0.8"></video>' : c.img ? '<img alt="" src="' + c.img + '">' : '';
                k.innerHTML = '<div class="cr-th">' + th + '<i>' + c.tag + '</i></div><div><div class="cr-c1"></div><div class="cr-c2"></div></div>';
                k.querySelector('.cr-c1').textContent = c.t; k.querySelector('.cr-c2').textContent = c.d;
                if (!c.off) k.onclick = () => { coreVid = i; try { SoundManager.play('simpleselect'); } catch (x) {} renderCore(); };
                l.appendChild(k);
            });
        } else if (coreTab === 'core') {
            b.innerHTML = '<div class="cr-two"></div>';
            CORE_IMGS.forEach(c => {
                const k = document.createElement('div'); k.className = 'cr-bc';
                k.innerHTML = '<div class="cr-th" style="aspect-ratio:16/9"><img alt="" src="' + c.img + '"></div><div class="cr-c1"></div><div class="cr-c2"></div>';
                k.querySelector('.cr-c1').textContent = c.t; k.querySelector('.cr-c2').textContent = c.d;
                b.querySelector('.cr-two').appendChild(k);
            });
        } else if (coreTab === 'basics') {
            const sl = typeof guideSlides !== 'undefined' ? guideSlides : [];
            const keys = hub.classList.contains('pc')
                ? '<span><b>MOUSE</b>STEER</span><span><b>SPACE</b>SPLIT</span><span><b>1 · 2 · 3 · 4</b>USE YOUR SKILLS</span>'
                : '<span><b>JOYSTICK</b>MOVE</span><span><b>SPLIT</b>BUTTON</span><span><b>TAP A SKILL</b>USE IT</span>';
            b.innerHTML = '<div class="cr-main"><div class="cr-bas"></div><div class="cr-keys">' + keys + '</div></div>';
            const g = b.querySelector('.cr-bas');
            sl.forEach(c => {
                const k = document.createElement('div'); k.className = 'cr-bc';
                k.innerHTML = '<div class="cr-th">' + crVideo(c.video, 'autoplay muted loop') + '</div><div class="cr-c1"></div><div class="cr-c2"></div>';
                k.querySelector('.cr-c1').textContent = c.title.replace(/:$/, ''); k.querySelector('.cr-c2').textContent = c.desc;
                g.appendChild(k);
            });
        } else if (coreTab === 'modes') {
            const M = [
                { k: '#00ffaa', n: 'CLASSIC', tg: 'THE ORIGINAL', li: ['15 minute matches on a huge map.', 'All 8 skills are in play.', 'Reach 5 kills (a pentakill) and the match ends.', 'Leaving early costs a fee: 50% with no kills, 20% with 1, 10% with 2 or more.', 'When you eat someone you take everything they were carrying.'] },
                { k: '#c8ff00', n: 'ARCADE', tg: 'ROGUELIKE MECHANICS', li: ['Matches last 3:00 and the safe zone keeps shrinking.', 'Random events: FOOD RAIN, GOLDEN VIRUS, NO SPLIT, TAX ON THE TOP and HEAVY.', 'You start empty and pick a new skill every 30 seconds.', 'Out of the zone you lose mass, and eating gives you much less.', 'The ranking goes by score: every kill adds 10% to your mass, up to x2.', 'Reach the Top 10 to win.'] },
                { k: '#ff5a4a', n: 'ARENAS', tg: '1V1 · 2V2 · 3V3', li: ['Team matches: play solo or with up to 3 friends.', 'FREE rooms and paid rooms with real prizes.', 'Pick your 2 skills in THE PILL before each match.', 'If a bot eats an enemy you still receive 90% of the tokens they carried.', 'Prizes are collected from CLAIM in your profile.'] }
            ];
            b.innerHTML = '<div class="cr-grid"></div>';
            M.forEach(m => { const c = document.createElement('div'); c.className = 'cr-mode'; c.style.setProperty('--k', m.k); c.innerHTML = '<div class="tg">' + m.tg + '</div><h3>' + m.n + '</h3><ul>' + m.li.map(x => '<li>' + x + '</li>').join('') + '</ul>'; b.querySelector('.cr-grid').appendChild(c); });
        } else {
            const SID = { clon: 1, shoot: 2, sprint: 3, tp: 4, iman: 5, inmune: 6, big: 7, random: 8 };
            const dat = id => (typeof SKILL_DESCRIPTIONS !== 'undefined' && SKILL_DESCRIPTIONS[SID[id]]) || null;
            b.innerHTML = '<div class="cr-main"><div class="cr-vid"></div><div><div class="cr-ti"></div><div class="cr-de"></div></div></div><div class="cr-sk"></div>';
            const d = dat(coreSk);
            if (d) { b.querySelector('.cr-vid').innerHTML = crVideo(d.video, 'autoplay loop muted'); b.querySelector('.cr-ti').textContent = d.name; b.querySelector('.cr-de').textContent = d.desc; }
            const g = b.querySelector('.cr-sk');
            SKILLS.forEach(([id, nm]) => {
                const c = document.createElement('div'); c.className = 'cell' + (id === coreSk ? ' on' : '');
                c.innerHTML = '<img src="' + skIcon(id) + '"><div class="nm">' + nm + '</div>';
                c.onclick = () => { coreSk = id; try { SoundManager.play('simpleselect'); } catch (x) {} renderCore(); };
                g.appendChild(c);
            });
        }
        placa($('#ahCore .pnl'), 1);
    }
    function openCore() { $('#ahCore').classList.add('open'); renderCore(); }
    // La barra del menu abierto se marca (contorno lima, interior oscuro).
    const BARRA_DE = { ahCore: 'core', ahSk: 'pill', ahAr: 'arenas', ahFr: 'friends', ahSt: 'store', ahQ: 'quests' };
    function marcaBarra() {
        const abierto = Object.keys(BARRA_DE).find(id => $('#' + id) && $('#' + id).classList.contains('open'));
        hub.querySelectorAll('.ah-it').forEach(b => b.classList.toggle('sel', !!abierto && b.dataset.a === BARRA_DE[abierto]));
    }
    function tap(e) {
        const it = e.target.closest('[data-a]'); if (!it) return;
        const a = it.dataset.a;
        try { SoundManager.play('simpleselect'); } catch (x) {}
        if (a === 'x') { if (hub.classList.contains('pc')) cierraPaneles(); conectaX(); return; }
        if (hub.classList.contains('pc') && ['rooms', 'arenas', 'friends', 'store', 'quests', 'pill', 'htp', 'core'].includes(a)) cierraPaneles();
        if (a === 'htp') { htpPag = 0; htpSk = null; $('#ahHtp').classList.add('open'); renderHtp(); return; }
        if (a === 'rooms') { $('#ahRooms').classList.add('open'); renderRooms(); pullRooms(); }
        if (a === 'arenas') { const ar = $('#ahAr'); ar.classList.add('open'); if (window.PWSquad) PWSquad.mountIn('rooms', $('#ahArBody')); placa($('#ahAr .pnl'), 1); }
        else if (a === 'friends') { const fr = $('#ahFr'); fr.classList.add('open'); if (window.PWSquad) PWSquad.mountIn('friends', $('#ahFrBody')); placa($('#ahFr .pnl'), 1); }
        else if (a === 'store') openStore('shop');
        else if (a === 'quests') openQuests();
        else if (a === 'core') openCore();
        else if (a === 'pill') {
            openPill();
        }
        else if (a === 'music') { try { toggleMusic(); } catch (x) {} paintStatic(); }
        else if (a === 'back') { hide(); try { goBackToModes(); } catch (x) {} }
    }
    function wire() {
        hub.addEventListener('click', tap);
        hub.querySelectorAll('#ahCore .tb').forEach(t => t.onclick = () => { coreTab = t.dataset.c; try { SoundManager.play('simpleselect'); } catch (x) {} renderCore(); });
        $('#ahHtpP').onclick = () => { const n = (typeof guideSlides !== 'undefined' ? guideSlides.length : 0) + 1; htpPag = (htpPag + n - 1) % n; htpSk = null; renderHtp(); };
        $('#ahHtpN').onclick = () => { const n = (typeof guideSlides !== 'undefined' ? guideSlides.length : 0) + 1; htpPag = (htpPag + 1) % n; htpSk = null; renderHtp(); };
        new MutationObserver(marcaBarra).observe(hub, { subtree: true, attributes: true, attributeFilter: ['class'] });
        $('#ahPill').addEventListener('click', () => { try { SoundManager.play('simpleselect'); } catch (x) {} openPill('color'); });
        const cerrar = o => { o.classList.remove('open'); o.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} });
            if (o.id === 'ahPr') pintaWallet(); if (o.id === 'ahQ') closeQuests(); if (o.id === 'ahSk' || o.id === 'ahSt') { const pg = o.querySelector('.pg'); if (pg) pg.remove(); } };
        hub.querySelectorAll('.px').forEach(b => b.onclick = () => cerrar(b.closest('.ov')));
        hub.querySelectorAll('.ov').forEach(o => o.addEventListener('click', e => { if (e.target === o) cerrar(o); }));
        hub.querySelectorAll('#ahSt .tb').forEach(b => b.onclick = () => { storeTab = b.dataset.s; buying = null; skinPage = 0; try { SoundManager.play('simpleselect'); } catch (x) {} renderStore(); });
        // X dentro de la app: el WebView mantiene a X dentro durante el login
        // (ver WebShellViewClient.kt) y vuelve aqui con la cookie puesta.
        $('#ahPrCon').onclick = async () => { await loginWallet(); pintaWallet(); pintaAvatarEditor(); };
        $('#ahPrDep').onclick = () => { try { GameWalletUI.openDeposit(); } catch (e) {} };
        // Sin nada en el juego no se abre el cartel de retirar: se dice y ya.
        $('#ahPrWd').onclick = async () => {
            await pintaWallet();
            if (saldoJuego <= 0) { try { showSystemMsg('You have no $PILLY in the game to withdraw.', 'WITHDRAW'); } catch (e) {} return; }
            try { GameWalletUI.openWithdraw(); } catch (e) {}
        };
        $('#ahSvBack').onclick = () => $('#ahSv').classList.remove('open');
        $('#ahName').addEventListener('input', e => guardaNombre(e.target.value));
        $('#ahName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
        hub.querySelectorAll('.sk-slot').forEach(sl => sl.onclick = () => { slotSel = +sl.dataset.s; pillTab = 'skills'; renderPill(); });
        hub.querySelectorAll('#ahSk .tb').forEach(b => b.onclick = () => {
            const pg = $('#ahSk .pin .pg'); if (pg) pg.remove();
            pillTab = b.dataset.t; skInfo = null; renderPill();
        });
        hub.querySelectorAll('.ov .ph>.px').forEach(px => {
            const ov = px.closest('.ov'); if (!ov || ov.querySelector('.pmax') || px.textContent.trim() !== 'CLOSE') return;
            const b = document.createElement('button'); b.className = 'px pmax'; b.textContent = 'FULL';
            const repinta = () => requestAnimationFrame(() => { try { placa(ov.querySelector('.pnl'), 1); } catch (x) {} });
            b.onclick = () => { const f = ov.classList.toggle('full'); b.textContent = f ? 'SMALL' : 'FULL'; repinta(); };
            px.addEventListener('click', () => { if (ov.classList.contains('full')) { ov.classList.remove('full'); b.textContent = 'FULL'; } });
            px.before(b);
        });
        $('.ah-play').onclick = async () => {
            const kind = room === 'offline' || sinRed || !navigator.onLine ? 'offline' : 'online';
            try { SoundManager.play('select'); } catch (x) {}
            if (kind === 'online' && mode === 'arcade' && !esperarIgual && !(await arcadeAbierta())) return;
            esperarIgual = false;
            try {
                // Volver a la partida en curso solo si es la sala elegida: antes cualquier sala de pago te devolvia a la FREE que dejaste.
                if (typeof Rejoin !== 'undefined' && Rejoin.get()) {
                    const rj = Rejoin.get();
                    if (kind === 'online' && (!rj.room || rj.room === room)) { startOnlineGame(); return; }
                    Rejoin.clear();
                }
                if (kind === 'online' && room !== 'Free' && !(await saldoParaSala())) return;
                const nombre = ((document.getElementById('playerNameInput') || {}).value || '').trim();
                // Con nombre ya puesto se entra sin preguntar; si falta, el cartel de nombre de siempre.
                if (kind === 'online' && currentServer !== room && !selectRoom(room)) return;
                if (nombre) continueChoosePlay(kind); else choosePlay(kind);
            } catch (x) {}
        };
    }

    // ARCADE: pasado el primer minuto nadie entra en esa partida. Si la sala elegida no tiene ninguna layer abierta
    // (esperando gente, o jugando y aun en el primer minuto) se avisa y se recomienda otra: primero donde se esta
    // jugando, luego donde se espera gente; con casi nadie, ARENAS. Si hay otra layer abierta, se entra sin decir nada.
    let esperarIgual = false;
    const ARC_ENTRADA = (window.PillSim && PillSim.ARCADE && PillSim.ARCADE.entradaMs) || 60000;
    const capaAbierta = l => !l.disabled && l.players < (l.maxPlayers || 35) && (l.state === 'waiting' || (l.state === 'playing' && (l.openMs || 0) < ARC_ENTRADA));
    const salaTxt = p => p === 'Free' ? 'FREE' : '$' + String(p).replace('$', '');
    async function arcadeAbierta() {
        await pullRooms();
        const mias = rooms.filter(r => r.mode === 'arcade'), r = mias.find(x => x.room === room);
        if (!r || !(r.layers || []).length || (r.layers || []).some(capaAbierta)) return true;
        const jugando = [], esperando = [];
        for (const x of mias) {
            if (x.room === room) continue;
            for (const l of x.layers || []) {
                if (!capaAbierta(l)) continue;
                (l.state === 'playing' ? jugando : esperando).push({ room: x.room, players: l.players });
            }
        }
        jugando.sort((a, b) => b.players - a.players); esperando.sort((a, b) => b.players - a.players);
        const total = mias.reduce((a, x) => a + (x.players || 0), 0), mejor = jugando[0] || esperando.find(e => e.players > 0);
        const ir = p => { room = p; renderRooms(); paintStatic(); $('.ah-play').onclick(); };
        const quedar = () => { esperarIgual = true; $('.ah-play').onclick(); };
        const cab = 'MATCH ALREADY STARTED', base = 'The ' + salaTxt(room) + ' match started more than 1 minute ago and no one can join it now.';
        if (typeof pwConfirm !== 'function') return true;
        if (mejor && total >= 4) {
            const lista = jugando.slice(0, 2).map(j => salaTxt(j.room) + ' · playing · ' + j.players + ' in').concat(esperando.slice(0, 2).map(e => salaTxt(e.room) + ' · waiting · ' + e.players + ' in'));
            pwConfirm(cab, base + '\n\n' + lista.join('\n'), 'GO TO ' + salaTxt(mejor.room), 'WAIT HERE', () => ir(mejor.room), quedar);
        } else {
            pwConfirm(cab, base + '\n\nFew people are playing ARCADE right now. ARENAS has players and quick matches are easier to find.', 'OPEN ARENAS', 'WAIT HERE', () => { const b = $('[data-a=arenas]'); if (b) b.click(); }, quedar);
        }
        return false;
    }
    // Placa SYSTEM: avisos del juego en cola, uno a la vez, cada uno el tiempo que se le da.
    // prio 0 = importante (pasa delante), 1 = normal, 2 = consejo. Solo corre con el hub a la vista.
    // Consejos que rotan en la placa cuando no hay avisos. Los que dependen de datos del dia se calculan al sacarlos.
    const TIPS = [
        () => 'Tip: in ARENAS you can play solo or with up to 3 friends against other players.',
        () => 'Tip: in ARENAS, if a bot eats an enemy you still receive 90% of the tokens they were carrying.',
        () => { const l = aqList(); return 'Tip: complete the ' + l.length + ' daily quests to earn up to ' + l.reduce((a, m) => a + (m.pts || 0), 0) + ' SP.'; },
        () => 'Tip: tap up to 3 quests in QUESTS to follow them during the match.',
        () => 'Tip: quests reset every day at 00:00 UTC.',
        () => 'Tip: you choose 2 skills at the start of every ARENAS and ARCADE match. Pick them in THE PILL.',
        () => hub.classList.contains('pc') ? 'Tip: tap INFO in THE PILL or open HOW TO PLAY (the gear) to see how each skill works.' : 'Tip: tap INFO in THE PILL to see how each skill works.',
        () => 'Tip: add friends in FRIENDS to form a group for 2v2 and 3v3.',
        () => 'Tip: mute a friend in FRIENDS to stop their popups. Their whispers and invites pile up there instead.',
        () => 'Tip: in ARCADE the prize depends on how many played: 6 to 9 the top 3 win, 10 to 19 the top 5, 20 or more the top 10.',
        () => 'Tip: in ARCADE only the players still alive at the end get paid. Every paid place gets back more than its entry.',
        () => 'Tip: an ARCADE match needs at least 6 players to start.',
        () => 'Tip: in ARCADE the safe zone starts closing at minute 1. Outside it you lose mass every second, and the last phase is brutal.',
        () => 'Tip: in ARCADE nobody can join after the first minute. Be there from the start.',
        () => 'Tip: every 30 seconds ARCADE has an event. Good ones: food rain, golden virus, no split. Bad ones: tax on the top, heavy.',
        () => 'Tip: TAX ON THE TOP takes 20% of the mass of the top 3. Being first has its price.',
        () => 'Tip: during HEAVY the biggest pill moves slower. Time to hunt it.',
        () => 'Tip: in ARCADE, when only 3 players are left the match ends and those 3 win.',
        () => 'Tip: the GOLDEN VIRUS gives +25% mass to the first one who touches it.',
        () => 'Tip: in ARCADE the ranking goes by score: every kill adds 10% to your mass, up to x2.',
        () => 'Tip: in ARCADE the top 3 wear a crown. Eat one for +30%, +20% or +10% mass (the king also counts as a double kill).',
        () => 'Tip: in CLASSIC, when you eat someone you take everything they were carrying.',
        () => 'Tip: leaving CLASSIC early costs a penalty: 20% with no kills, 10% with one kill, none from 2 kills.',
        () => 'Tip: in CLASSIC your match ends when you reach 5 kills (pentakill), when you leave, or at the 15 minute limit.',
        () => 'Tip: split launches half your mass forward to eat enemies. You can split into up to 16 pieces.',
        () => 'Tip: touching a virus splits you in three but gives a mass bonus.',
        () => 'Tip: paid rooms take the entry from your in-game $PILLY.',
        () => 'Tip: spend your SP in STORE on new skins.',
        () => 'Tip: change your pill color and skin in THE PILL.',
        () => 'Tip: customize your profile and connect it to X.'
    ];
    const TAGS = { sys: 'SYSTEM', arena: 'ARENA', whisper: 'WHISPER', friend: 'FRIEND', invite: 'GROUP' };
    // Movil: la placa se centra en el hueco entre QUESTS y el borde de abajo, sea cual sea su numero de lineas.
    function colocaPlaca(e) {
        if (hub.classList.contains('pc')) { e.style.bottom = ''; return; }
        requestAnimationFrame(() => {
            const q = $('.ah-it[data-a=quests]'), fs = parseFloat(hub.style.fontSize) || 16; if (!q) return;
            const sup = q.offsetTop + 2.9 * fs, alto = hub.offsetHeight, h = e.offsetHeight;
            e.style.bottom = Math.max(.2 * fs, (alto - sup - h) / 2) + 'px';
        });
    }
    const SysQ = (() => {
        const q = []; let cur = null, n = 0, tm = null, tipN = Math.floor(Math.random() * TIPS.length);
        const el = () => $('#ahSys');
        function pinta(m) {
            const e = el(); if (!e) return;
            e.className = 'ah-sys on k-' + (m.kind || 'sys') + (m.pic ? ' pic' : '') + (m.actions ? ' act' : '');
            e.querySelector('b').textContent = TAGS[m.kind || 'sys'];
            e.querySelector('span').textContent = m.text;
            e.querySelector('.pic').style.backgroundImage = m.pic ? 'url("' + String(m.pic).replace(/"/g, '') + '")' : '';
            const ac = e.querySelector('.acts'); ac.innerHTML = '';
            colocaPlaca(e);
            (m.actions || []).forEach(a => { const b = document.createElement('button'); b.textContent = a[0]; if (!a[2]) b.className = 'n'; b.onclick = ev => { ev.stopPropagation(); try { SoundManager.play('simpleselect'); } catch (x) {} fin(); if (a[1]) a[1](); }; ac.appendChild(b); });
        }
        // Al acabar un aviso se funde; si hay otro esperando sale enseguida, y si no, la placa descansa 5 s antes del siguiente consejo.
        function fin() {
            clearTimeout(tm); const e = el(); if (e) e.classList.add('out');
            cur = null;
            tm = setTimeout(() => { if (e && !cur) e.classList.remove('on', 'act', 'out'); if (!cur) tm = setTimeout(next, q.length ? 150 : 5000); }, 350);
        }
        function next() {
            if (cur || !hub.classList.contains('on')) return;
            if (!q.length) { cur = { text: TIPS[tipN++ % TIPS.length](), ms: 12000, kind: 'sys', tip: true }; }
            else { q.sort((a, b) => a.prio - b.prio || a.n - b.n); cur = q.shift(); }
            pinta(cur); tm = setTimeout(fin, cur.ms);
        }
        return {
            next,
            push(text, ms, prio, o) {
                if (!text) return;
                q.push(Object.assign({ text: String(text), ms: ms || 8000, prio: prio == null ? 1 : prio, n: n++ }, o || {}));
                if (cur && cur.tip) { clearTimeout(tm); const e = el(); if (e) e.classList.add('out'); cur = null; tm = setTimeout(() => { if (e && !cur) e.classList.remove('on', 'act', 'out'); next(); }, 350); } else next();   // un aviso de verdad corta el consejo que haya
            }
        };
    })();
    window.PWSys = { push: SysQ.push };
    // Avisos que escribe el admin: se piden al servidor mientras el menu esta abierto; el ultimo visto se recuerda.
    let sysLast = 0; try { sysLast = parseInt(localStorage.getItem('pw_sys_seen'), 10) || 0; } catch (e) {}
    async function sysPoll() {
        try {
            const j = await (await fetch('/api/sysmsg?after=' + sysLast, { cache: 'no-store' })).json();
            if (!j || !Array.isArray(j.msgs)) return;
            j.msgs.forEach(m => { if (m.id > sysLast) sysLast = m.id; SysQ.push(m.text, m.ms, 0); });
            if (j.last > sysLast) sysLast = j.last;
            try { localStorage.setItem('pw_sys_seen', String(sysLast)); } catch (e) {}
        } catch (e) {}
    }
    setInterval(() => { if (hub.classList.contains('on')) sysPoll(); }, 20000);
    // Una sola vez por sesion al entrar al menu: consejo del dia (una vez al dia) y premios sin cobrar.
    // Premios de arenas por cobrar: el numerito del avatar (perfil) y, una vez por sesion, el aviso en la placa.
    let claimAvisado = false;
    function refreshClaims(avisa) {
        const w = xWallet || (window.GameWallet && GameWallet.address);
        if (!w || !window.PWSquad) return;
        try {
            PWSquad.prizes(w, (total, list, usd) => {
                const n = (list || []).length, b = $('#ahAvB');
                if (b) b.textContent = n ? String(Math.min(n, 99)) : '';
                if (avisa && total > 0 && !claimAvisado) { claimAvisado = true; SysQ.push('You have ' + corto(total) + ' $PILLY' + (usd != null ? ' (' + cortoUsd(usd) + ')' : '') + ' waiting to be claimed.', 12000, 0, { kind: 'arena' }); }
            });
        } catch (e) {}
    }
    setInterval(() => { if (hub.classList.contains('on')) refreshClaims(false); }, 120000);
    let sysEntro = false, postPartida = false;
    function sysEntrada() {
        sysPoll(); SysQ.next();
        // Primera vez en el menu tras una partida: el premio ya esta apuntado (o lo estara en unos segundos).
        if (postPartida && sysEntro) { postPartida = false; claimAvisado = false; try { PWSquad.resetAlerts(); } catch (e) {} setTimeout(() => refreshClaims(true), 3000); setTimeout(() => refreshClaims(true), 9000); }
        if (sysEntro) return; sysEntro = true;
        setTimeout(() => {
            const w = xWallet || (window.GameWallet && GameWallet.address);
            refreshClaims(true);
        }, 2500);
    }

    function show(m) {
        mode = m || 'classic'; hub.classList.add('on'); document.body.classList.add('hub-on');
        sysEntrada();
        scale(); paintStatic(); pullRooms(); requestAnimationFrame(loop);
        try { if (window.PWSquad) PWSquad.boot(); } catch (e) {}   // amigos: invitaciones y susurros aunque el panel este cerrado
        try { aqRetry(); } catch (e) {}   // misiones hechas sin red o sin cuenta: se cobran al volver
        try { if (typeof paisSync === 'function') Promise.resolve(paisSync()).then(paintStatic); } catch (e) {}
    }
    function hide() { closeQuests(); hub.classList.remove('on'); document.body.classList.remove('hub-on'); hub.querySelectorAll('.ov').forEach(o => o.classList.remove('open')); }

    function start() {
        document.body.appendChild(hub);
        try { const n = localStorage.getItem('pw_app_name'); if (n) guardaNombre(n); } catch (e) {}
        aplicaColores();
        syncX();
        // Vuelta del login de X por el navegador (#xhandoff=...): se canjea dentro del WebView, que es donde tiene que quedar la cookie.
        // La app nativa vuelve cargando la MISMA pagina con otro #: eso no recarga, solo cambia el hash. Por eso tambien se
        // escucha hashchange (antes solo se miraba al arrancar y el canje no se hacia nunca: volvias sin X conectado).
        const canje = () => {
            const ho = /^#xhandoff=([A-Za-z0-9_-]{16,64})$/.exec(location.hash);
            if (!ho) return false;
            let sec = ''; try { sec = localStorage.getItem('pw_xs') || ''; localStorage.removeItem('pw_xs'); } catch (e) {}
            location.replace('/airdrop-auth/x/handoff?t=' + ho[1] + '&s=' + encodeURIComponent(sec));
            return true;
        };
        addEventListener('hashchange', () => { if (!canje() && /^#xerr=/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); try { showSystemMsg('Could not connect X. Try again.', 'X'); } catch (e) {} } });
        if (canje()) return;
        if (/^#x(err)?=/.test(location.hash)) { const err = /xerr/.test(location.hash); history.replaceState(null, '', location.pathname + location.search); if (err) try { showSystemMsg('Could not connect X. Try again.', 'X'); } catch (e) {} }
        wire(); setInterval(() => { if (hub.classList.contains('on')) pullRooms(); }, 5000);
        addEventListener('resize', () => { if (hub.classList.contains('on')) { scale(); paintStatic(); } });
        // Un menu por modo: se abre al elegir CLASSIC o ARCADE en la rueda.
        const orig = window.selectMode;
        if (typeof orig === 'function') window.selectMode = function (m) { const r = orig.apply(this, arguments); show(m); return r; };
        window._hubShow = show; window._hubSyncX = syncX; window._hubUnlock = desbloqueada; window._hubConnectX = conectaX; window._hubAvatar = avatar; window._hubAvatarEl = avEl;
        // Arenas por equipos (squad.js): repinta la placa del panel cada vez que cambia su contenido.
        window.pwHubMode = () => mode;
        window.pwHubEnter = () => entra();
        window.pwAqShow = on => aqHud(!!on);
        window.PWSquadHooks = {
            afterRender() {
                try { const fl = (PWSquad.state.friends && PWSquad.state.friends.friends) || []; const on = fl.filter(f => f.st && f.st !== 'off').length; const el = $('#ahFrSub'); if (el) el.textContent = on + ' ONLINE'; } catch (e) {}
                ['#ahAr', '#ahFr'].forEach(id => { const o = $(id); if (o && o.classList.contains('open')) requestAnimationFrame(() => placa($(id + ' .pnl'), 1)); }); },
            badge(n) { ['#ahFrB', '#ahFrB2'].forEach(id => { const b = $(id); if (b) b.textContent = n ? String(Math.min(n, 99)) : ''; }); },
        };
        // Contenedor de los avisos de MWA: un <div> sin id ni clase que la libreria
        // cuelga de <body> (con shadow DOM cerrado): se marca para poder girarlo.
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
            if (n.nodeType === 1 && n.tagName === 'DIV' && !n.id && !n.className && n.parentElement === document.body) n.classList.add('mwa-host');
        }))).observe(document.body, { childList: true });
        // La partida tapa al hub: se esconde al empezar y vuelve al volver al menu.
        // startOnlineGame en sala de pago pasa por popup + firma de la wallet ANTES de entrar: si el hub se esconde ya, el
        // menu antiguo queda a la vista (popup raro) y al entrar el vigilante lo daba por perdido y volvia a tapar la partida.
        // Por eso en online el hub solo se esconde cuando la partida corre de verdad; si el pago se cancela no se toca.
        const entra = () => { hide(); _enPartida = true; postPartida = true; pyTras = true; aqHud(true); };
        let esperando = false;
        const alEntrar = () => {
            if (esperando) return; esperando = true;
            const t0 = Date.now();
            const iv = setInterval(() => {
                const corre = typeof gameRunning !== 'undefined' && gameRunning;
                const firmando = typeof _joinInFlight !== 'undefined' && _joinInFlight;
                if (corre) { clearInterval(iv); esperando = false; entra(); }
                else if (!firmando || Date.now() - t0 > 120000) { clearInterval(iv); esperando = false; }
            }, 100);
        };
        ['startGame', 'startOnlineGame'].forEach(fn => {
            const o = window[fn];
            if (typeof o !== 'function') return;
            window[fn] = function () {
                if (fn === 'startOnlineGame' && !window._squadTicket && window.pwSquadGuard && !window._sqGuardOk) {
                    // Buscando arena: avisa y, si confirma, sale del grupo y repite esta llamada.
                    const args = arguments;
                    window.pwSquadGuard(() => { window._sqGuardOk = true; try { window.startOnlineGame.apply(window, args); } finally { window._sqGuardOk = false; } });
                    return;
                }
                // Practica de arenas: el menu se queda hasta que la partida ya se ve (index.html llama a pwHubEnter); si no, se veia negro mientras cargaba.
                if (fn === 'startGame' || (window._squadTicket && window._squadKind !== 'practice')) entra(); else if (!window._squadTicket) alEntrar();
                return o.apply(this, arguments);
            };
        });
        // Vuelta de la partida: el hub sale en el MISMO instante que el menu
        // antiguo (que queda tapado por hub-on), sin que se vea ni un frame.
        const oRet = window.returnToMenu;
        if (typeof oRet === 'function') window.returnToMenu = function () {
            document.body.classList.add('hub-on');
            const r = oRet.apply(this, arguments); _enPartida = false; aqHud(false); show(mode); return r;
        };
        // selectMode deja pendiente mostrar el menu antiguo (showLogin, tras cargar
        // las skins): si se vuelve atras antes, llegaba despues y tapaba la rueda.
        const lo = document.getElementById('loginOverlay');
        if (lo) new MutationObserver(() => {
            if (lo.style.display === 'flex' && !hub.classList.contains('on') && !_enPartida && typeof currentGameMode !== 'undefined' && currentGameMode === null) lo.style.display = 'none';
        }).observe(lo, { attributes: true, attributeFilter: ['style'] });
        setInterval(() => {
            if (!_enPartida) return;
            const lo = document.getElementById('loginOverlay');
            if (lo && getComputedStyle(lo).display !== 'none' && !(typeof gameRunning !== 'undefined' && gameRunning)) { _enPartida = false; show(mode); }
        }, 500);
    }
    // El menu se monta en cuanto hay DOM (antes esperaba al 'load' y, si se tocaba rapido, salia el menu antiguo en medio).
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
