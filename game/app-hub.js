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
        classic: { bg: '#00130c', line: '#0b3326', top: 'rgba(0,10,6,.9)', inner: '#0f2c22', inner2: '#06120d', edge: '#1d4a3b', shade: '2,8,5', mut: '#8fbfae' },
        arcade: { bg: '#0d1200', line: '#28330a', top: 'rgba(8,10,0,.9)', inner: '#232a08', inner2: '#0d1003', edge: '#3d4a14', shade: '7,9,0', mut: '#b7c28a' },
    };
    const PRICES = ['Free', '2$', '5$', '10$', '20$'];
    const SWATCH = ['#ffffff', '#c8ccd2', '#ff2a2a', '#ff8a00', '#ffd23a', '#00e05a', '#00e0b0', '#1e6bff', '#6cc8ff', '#b000ff'];
    // Skills de salida del ARCADE (solo interfaz: la partida aun no las usa).
    const SKILLS = [['clon', 'CLON'], ['shoot', 'SHOOT'], ['sprint', 'SPRINT'], ['tp', 'BLINK'], ['iman', 'MAGNET'], ['inmune', 'SHIELD'], ['big', 'PLUS'], ['random', 'GAMBLE']];
    let mode = 'classic', room = 'Free', rooms = [], _enPartida = false;
    let picks = (() => { try { return JSON.parse(localStorage.getItem('pw_start_skills')) || [null, null]; } catch (e) { return [null, null]; } })();
    let slotSel = 0;

    // Iconos de trazo limpio (no pixel), con la sombra dura del juego.
    const SVG = {
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
    const placa = (box, t) => { if (typeof drawPlacaCaja === 'function') { const cv = box.querySelector(':scope>canvas'); cv._placaKey = ''; drawPlacaCaja(box, cv, MODES[mode], t); } };

    const css = `
#appHub{position:fixed;inset:0;z-index:105;display:none;overflow:hidden;background:var(--bg);color:#fff;font-family:'Press Start 2P',monospace;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#appHub.on{display:block}
body.hub-on #loginOverlay,body.hub-on #modeScreen,body.hub-on #pillPalette,body.hub-on #colorPicker,body.hub-on #soundToggle,body.hub-on #musicToggle,body.hub-on #playChoiceModal,body.hub-on #roomChoiceModal{visibility:hidden!important;pointer-events:none!important}
body.mobile-allowed #appHub{position:absolute;inset:auto;width:var(--pw-largo,100dvh);height:var(--pw-corto,100dvw);top:50%;left:50%;transform:translate(-50%,-50%) rotate(90deg)}
#appHub canvas{image-rendering:pixelated;display:block}
#ahBg{position:absolute;inset:0;width:100%;height:100%}
#ahShade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(var(--sh),.9) 0,rgba(var(--sh),.6) 19em,rgba(var(--sh),0) 32em)}
.ah-top{position:absolute;left:0;right:0;top:0;height:2.6em;background:var(--top)}
.ah-top:after{content:"";position:absolute;left:0;right:0;bottom:0;height:.15em;background:var(--edge);opacity:.7}
.ah-line{position:absolute;left:4.4em;top:2.45em;width:16em;height:.25em;background:var(--ac);box-shadow:0 .12em 0 #000}
.ah-line:after{content:"";position:absolute;right:-.4em;top:-.28em;width:.55em;height:.55em;background:var(--ac);transform:rotate(45deg);box-shadow:.1em .1em 0 #000}
.med{position:relative;flex:none;width:3.2em;height:3.2em;border-radius:50%;box-sizing:border-box;border:.2em solid;
  border-color:var(--acL) var(--acD) var(--acD) var(--acL);background:radial-gradient(circle at 38% 32%,var(--in1) 0,var(--in2) 62%);
  box-shadow:0 0 0 .12em #000,inset 0 0 0 .12em #000,.12em .2em 0 .1em rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#eaf5ef}
.med svg{width:1.45em;height:1.45em;filter:drop-shadow(.08em .1em 0 #000)}
.med canvas{width:2.7em;height:2.7em}
.ah-ava{position:absolute;left:.7em;top:.35em;width:3.8em;height:3.8em;overflow:hidden}
.ah-ava img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.ah-ava .npc{display:flex;color:var(--mut)}.ah-ava .npc svg{width:2.1em;height:2.1em}
.ah-ava{cursor:pointer}
.ah-who{position:absolute;left:5.1em;top:.6em;display:flex;flex-direction:column;gap:.45em;cursor:pointer}
.ah-name{font-size:.72em;letter-spacing:.08em;text-shadow:.15em .15em 0 #000}
.ah-lv{font-size:.45em;color:var(--ac);display:flex;align-items:center;gap:.8em}
.ah-lv i{display:block;width:9em;height:.8em;background:#000;outline:.25em solid var(--edge)}.ah-lv i b{display:block;height:100%;width:62%;background:var(--ac)}
.ah-title{position:absolute;left:21.5em;right:13em;top:.7em;height:1.15em;display:flex;justify-content:center;gap:.5em}
.ah-title img{height:100%;image-rendering:pixelated;filter:drop-shadow(.1em .1em 0 #000)}
.ah-ico{position:absolute;top:.3em;right:.9em;display:flex;gap:.55em;align-items:center}
.ah-btn{position:relative;width:2.3em;height:2.3em;border-radius:50%;box-sizing:border-box;border:.16em solid;border-color:var(--acL) var(--acD) var(--acD) var(--acL);
  background:radial-gradient(circle at 38% 32%,var(--in1) 0,var(--in2) 62%);box-shadow:0 0 0 .1em #000,inset 0 0 0 .1em #000;
  display:flex;align-items:center;justify-content:center;color:#eaf5ef;cursor:pointer}
.ah-btn svg{width:1.05em;height:1.05em;filter:drop-shadow(.06em .08em 0 #000)}
.ah-btn:active{transform:translateY(.1em)}
.ah-btn.off svg{opacity:.35}
.ah-btn.off:after{content:"";position:absolute;left:18%;right:18%;top:50%;height:.16em;background:#ff4a4a;transform:rotate(-45deg);box-shadow:0 0 0 .06em #000}
.ah-sp{display:flex;align-items:center;gap:.5em;margin-right:.5em;font-size:.62em;letter-spacing:.06em;text-shadow:.15em .15em 0 #000}
.ah-sp .u{color:var(--ac)}
.ah-sp[hidden]{display:none}
.ah-it{position:absolute;left:3.6em;display:flex;align-items:center;gap:.9em;cursor:pointer}
.ah-it .t{font-size:.78em;letter-spacing:.06em;text-shadow:.16em .16em 0 #000}
.ah-it .s{font-size:.44em;color:var(--mut);margin-top:.9em;display:flex;align-items:center;gap:.5em;text-shadow:.16em .16em 0 #000}
.ah-it .s img{width:2.6em;height:2.6em;image-rendering:pixelated;background:var(--in2);box-shadow:0 0 0 .25em var(--edge)}
.ah-it .s img[src=""]{display:none}
.ah-it .bar{width:8.5em;height:.4em;background:#000;margin-top:.55em;outline:.12em solid var(--edge)}
.ah-it .bar i{display:block;height:100%;background:var(--ac)}
.ah-it:active .t{color:var(--ac)}
.ah-it:active .med{transform:translateY(.1em)}
.ah-dot{width:.55em;height:.55em;background:#00ff66;animation:ahBl 1s steps(2) infinite}
@keyframes ahBl{50%{opacity:.2}}
.ah-bdg{position:absolute;left:2.3em;top:-.2em;background:#e5302f;font-size:.42em;padding:.35em .45em .25em;box-shadow:0 0 0 .2em #000}
#ahPill{position:absolute;left:28.4em;top:3em;width:13.5em;height:13.5em;cursor:pointer}
.ah-room{position:absolute;right:15.9em;bottom:.62em;width:5em;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:.55em}
.ah-room .med{width:3.8em;height:3.8em}
.ah-room .sw{position:absolute;right:-.45em;top:-.3em;width:1.35em;height:1.35em;border-radius:50%;background:var(--ac);color:#04150c;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 .12em #000}
.ah-room .sw svg{width:.95em;height:.95em;filter:none}
.ah-room .med>svg{width:1.9em;height:1.9em}
.pnl>canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.ah-room .v{font-size:.44em;white-space:nowrap;letter-spacing:.06em;text-shadow:.16em .16em 0 #000}
.ah-room .v b{font-weight:400;color:var(--ac)}.ah-room .v b.usd{color:#ffd23a}
.ah-room:active .med{transform:translateY(.1em)}
.ah-play{position:absolute;right:1em;bottom:1.5em;width:14.6em;height:3.8em;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;
  border-radius:1.9em;background:var(--ac);color:#04150c;border:.2em solid;border-color:var(--acL) var(--acD) var(--acD) var(--acL);
  box-shadow:0 0 0 .14em #000,inset 0 0 0 .12em #000,.15em .25em 0 .12em rgba(0,0,0,.55)}
.ah-play span{font-size:1.3em;letter-spacing:.3em;margin-left:.3em;text-shadow:.1em .1em 0 var(--acL)}
.ah-play:active{transform:translateY(.12em)}
.ov{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,6,4,.9);z-index:5}
.ov.open{display:flex}
.pnl{position:relative;box-sizing:border-box}
.pin{position:relative;padding:1em 1.1em .7em}
.ph{display:flex;align-items:center;gap:.7em}
.ph img{height:1.25em;image-rendering:pixelated;filter:drop-shadow(.08em .08em 0 #000)}
.ph .w{font-family:'Russo One',sans-serif;font-size:.8em;letter-spacing:.14em;color:#fff}
.ph .cnt{margin-left:auto;font-family:'Russo One',sans-serif;font-size:.72em;letter-spacing:.1em;color:var(--ac)}
.px{font-family:'Russo One',sans-serif;font-size:.66em;letter-spacing:.1em;padding:.45em 1em;border:.14em solid #2c3630;color:#7d8a82;background:none}
.ahr-g{display:grid;grid-template-columns:repeat(6,1fr);gap:.5em;margin-top:.9em}
.cell{position:relative;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;cursor:pointer}
.ahr-g .cell{padding:.9em .3em .7em;gap:.55em}
.cell .p{font-size:1em;text-shadow:.16em .16em 0 #000}
.cell .p.usd{color:#ffd23a}
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
.co .sw{flex:1;display:grid;grid-template-columns:repeat(10,1fr);gap:.35em}
.co .sw b{aspect-ratio:1;cursor:pointer;box-shadow:inset -.18em -.18em 0 rgba(0,0,0,.35),inset .18em .18em 0 rgba(255,255,255,.3),0 0 0 .1em #000}
.co .sw b.sel{outline:.16em solid #fff;outline-offset:.12em}
.qg{flex:1;min-width:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:.45em}
.qc{position:relative;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.07);padding:.35em .55em;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.qc .k{font-size:.36em;line-height:1.4;letter-spacing:.1em;color:var(--mut)}
.qc .t{font-size:.44em;line-height:1.5;letter-spacing:.04em;margin-top:.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:.15em .15em 0 #000}
.qc .d{font-family:'VT323',monospace;font-size:.78em;color:#9fb3aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qc .b{display:flex;align-items:center;justify-content:space-between}
.qc .pts{font-size:.46em;color:#ffd23a;text-shadow:.15em .15em 0 #000}
.qc .qp{height:.35em;background:#000;outline:.1em solid var(--edge);margin:.25em 0}
.qc .qp i{display:block;height:100%;background:var(--ac)}
.qc .n{font-size:.4em;color:var(--mut)}
.qc button{font-family:'Russo One',sans-serif;font-size:.6em;letter-spacing:.1em;padding:.3em .9em;border:none;background:var(--ac);color:#04150c;cursor:pointer}
.qc button.v{background:#ffd23a}
.qc.done{opacity:.45}.qc.done .pts{color:var(--ac)}
.ph .qb{font-size:.42em;color:#ffd23a;letter-spacing:.06em;margin-left:1em}
.sn .cell .pr{font-size:.4em;color:#ffd23a}
.sn .cell .pr.own{color:var(--ac)}
.sn .cell.buy{border:.14em solid #ffd23a}
.sn .cell.buy .pr{color:#04150c;background:#ffd23a;padding:.35em .5em}
#ahSv{z-index:7}
#ahAv{z-index:7}#ahUn{z-index:8}
.av-big{width:8em;height:8em}
.av-r{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.55em}
.av-l{display:flex;align-items:center;gap:.6em}
.av-l>span{width:11.5em;flex:none;font-size:.36em;letter-spacing:.06em;color:var(--mut);white-space:nowrap}
.av-l>div{display:flex;gap:.3em;flex-wrap:wrap}
.av-l b{width:1.35em;height:1.35em;cursor:pointer;box-shadow:0 0 0 .1em #000;display:flex;align-items:center;justify-content:center}
.av-l b.on{outline:.14em solid #fff;outline-offset:.08em}
.av-l b svg{width:.95em;height:.95em}
.av-l b canvas{width:100%;height:100%}
.av-l b.no{background:var(--in2);font-size:.36em;color:var(--mut)}
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
        if (!document.body.classList.contains('hub-on') || getComputedStyle(m).display === 'none') return;
        if (m.classList.contains('gameModal') && m.id !== 'gameTopUpModal') return;
        const box = m.querySelector('.pw-modal-box, .gameModalBox'); if (!box || typeof drawPlacaCaja !== 'function') return;
        // CLOSE en vez de la x de la esquina (se montaba encima del titulo).
        const x = box.querySelector(':scope>.close');
        if (x && !box.querySelector(':scope>.hub-close')) { const b = document.createElement('button'); b.className = 'hub-close'; b.textContent = 'CLOSE'; b.onclick = () => x.click(); box.appendChild(b); }
        let cv = box.querySelector(':scope>canvas.hub-placa');
        if (!cv) { cv = document.createElement('canvas'); cv.className = 'hub-placa'; box.prepend(cv); }
        requestAnimationFrame(() => { cv._placaKey = ''; drawPlacaCaja(box, cv, MODES[mode], 1); });
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
    // Tu $PILLY dentro del juego, al lado de los SP (solo con wallet conectada).
    function pintaPilly() {
        const box = document.querySelector('#appHub .ah-py'); if (!box) return;
        const w = typeof GameWallet !== 'undefined' && GameWallet.address;
        box.hidden = !w;
        if (w) document.getElementById('ahPy').textContent = corto(GameWalletUI.gameBalance);
    }
    setInterval(pintaPilly, 3000);
    window._hubCorto = corto;   // pruebas
    const hub = document.createElement('div'); hub.id = 'appHub';
    hub.innerHTML = `
<canvas id="ahBg"></canvas><div id="ahShade"></div>
<div class="ah-top"></div><div class="ah-line"></div>
<div class="ah-ava med" data-a="x"><img alt="" hidden><span class="npc">${svg('npc')}</span></div>
<div class="ah-who" data-a="x"><div class="ah-name">PLAYER</div><div class="ah-lv" id="ahX">TAP TO CONNECT X</div></div>
<div class="ah-ico"><div class="ah-sp ah-py" hidden><span id="ahPy">0</span><span class="u">$PILLY</span></div><div class="ah-sp"><span id="ahSp">0</span><span class="u">SP</span></div>
  <div class="ah-btn" data-a="music">${svg('music')}</div><div class="ah-btn" data-a="back">${svg('back')}</div></div>
<div class="ah-it" data-a="pill" style="top:4.4em"><div class="med"><canvas id="ahPillIco"></canvas></div><div><div class="t">THE PILL</div><div class="s" id="ahPillSub"></div></div></div>
<div class="ah-it" data-a="rooms" style="top:8.9em"><div class="med">${svg('rooms')}</div><div><div class="t">ROOMS</div><div class="s"><span class="ah-dot"></span><span id="ahOnline">0 ONLINE</span></div></div></div>
<div class="ah-it" data-a="store" style="top:13.4em"><div class="med">${svg('store')}</div><div><div class="t">STORE</div><div class="s">NEW SKINS</div></div></div>
<div class="ah-it" data-a="quests" style="top:17.9em"><div class="med">${svg('quests')}</div><div><div class="t">QUESTS</div><div class="bar"><i id="ahQBar" style="width:0"></i></div></div><span class="ah-bdg" id="ahQBdg"></span></div>
<canvas id="ahPill"></canvas>
<div class="ah-room" data-a="rooms"><div class="med">${svg('swords')}<span class="sw">${svg('swap')}</span></div><div class="v" id="ahRoomV"></div></div>
<div class="ah-play"><span>PLAY</span></div>
<div class="ov" id="ahRooms"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><img class="mw" alt=""><span class="w">ROOMS</span><span class="cnt" id="ahrOn"></span><button class="px">CLOSE</button></div>
  <div class="ahr-g" id="ahrG"></div><div class="foot">Paid rooms take the entry from your in-game $PILLY</div></div></div></div>
<div class="ov" id="ahAv"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">AVATAR</button><span class="cnt"></span><button class="px">DONE</button></div>
  <div class="sk-b"><div class="sk-pill"><div class="av-big" id="ahAvBig"></div></div>
  <div class="av-r"><div class="av-l"><span>STYLE</span><div id="ahAvT"></div></div><div class="av-l"><span>BACKGROUND</span><div id="ahAvBg"></div></div>
  <div class="av-l av-p"><span>PILL TOP</span><div id="ahAvTop"></div></div><div class="av-l av-p"><span>PILL BOTTOM</span><div id="ahAvBot"></div></div><div class="av-l av-p"><span>SKIN</span><div id="ahAvSk"></div></div></div></div>
  <div class="foot">Your avatar shows on your profile</div></div></div></div>
<div class="ov" id="ahUn"><div class="pnl" style="width:24em"><canvas></canvas><div class="pin un-b">
  <div class="un-t">SKIN UNLOCKED!</div><div class="un-st"><i class="un-ray"></i><canvas id="ahUnPill"></canvas><b style="left:12%;top:20%"></b><b style="left:82%;top:16%;animation-delay:.35s"></b><b style="left:20%;top:78%;animation-delay:.7s"></b><b style="left:76%;top:74%;animation-delay:1.05s"></b><b style="left:50%;top:6%;animation-delay:.5s"></b></div>
  <div class="un-n" id="ahUnN"></div><div class="sv-bt"><button class="tb" id="ahUnClose">CLOSE</button><button class="tb on" id="ahUnWear">WEAR IT</button></div></div></div></div>
<div class="ov" id="ahSv"><div class="pnl" style="width:22em"><canvas></canvas><div class="pin">
  <div class="sv-b"><canvas id="ahSvPill"></canvas><div class="sv-n" id="ahSvN"></div><div class="sv-p" id="ahSvP"></div>
  <div class="sv-bt"><button class="tb" id="ahSvBack">BACK</button><button class="tb on" id="ahSvGo"></button></div></div></div></div></div>
<div class="ov" id="ahPr"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">PROFILE</button><span class="cnt" id="ahPrSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="sk-pill pr-me"><div class="pr-pic" id="ahPrPic"></div><div class="pr-at" id="ahPrAt"></div><div class="pr-ic" id="ahPrIc"></div><div class="pr-cl" id="ahPrCl"></div></div>
  <div class="pr-r">
    <div class="pr-box"><div class="k">WALLET</div><div class="pr-w" id="ahPrW">NOT CONNECTED</div>
      <div class="k" style="margin-top:.9em">IN-GAME $PILLY</div><div class="pr-bal" id="ahPrBal">0</div>
      <div class="pr-bt"><button class="tb on" id="ahPrCon">CONNECT WALLET</button><button class="tb" id="ahPrDep">DEPOSIT</button><button class="tb" id="ahPrWd">WITHDRAW</button></div></div>
    <div class="pr-st"><div class="cell"><div class="k">MATCHES</div><div class="v" id="ahPrM">0</div></div><div class="cell"><div class="k">BEST KILLS</div><div class="v" id="ahPrK">0</div></div><div class="cell"><div class="k">BEST MASS</div><div class="v" id="ahPrMs">0</div></div></div>
  </div></div>
  <div class="foot">Tap EDIT AVATAR to change your picture</div></div></div></div>
<div class="ov" id="ahSt"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb" data-s="shop">STORE</button><button class="tb" data-s="mine">MY SKINS</button><button class="tb" data-s="conv">CONVERT</button><span class="cnt" id="ahStSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="sn" id="ahStG" style="grid-template-columns:repeat(4,1fr)"></div><div class="cv-b" id="ahCv"></div></div>
  <div class="foot" id="ahStFoot"></div></div></div></div>
<div class="ov" id="ahQ"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb on">QUESTS</button><span class="qb" id="ahQBoost"></span><span class="cnt" id="ahQSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="qg" id="ahQG"></div></div>
  <div class="foot" id="ahQFoot">Airdrop points for the $PILLY Genesis Drop</div></div></div></div>
<div class="ov" id="ahSk"><div class="pnl" style="width:40em"><canvas></canvas><div class="pin">
  <div class="ph"><button class="tb" data-t="skills">SKILLS</button><button class="tb" data-t="color">COLOR</button><button class="tb" data-t="skins">SKIN</button><span class="cnt" id="ahSkSp"></span><button class="px">CLOSE</button></div>
  <div class="sk-b"><div class="sk-pill"><input id="ahName" maxlength="12" placeholder="YOUR NAME" autocomplete="off" spellcheck="false"><canvas id="ahSkPill"></canvas><div class="sk-slots"><div class="sk-slot" data-s="0"></div><div class="sk-slot" data-s="1"></div></div><div class="sk-lab">YOUR 2 SKILLS</div></div>
  <div class="sk-g" id="ahSkG"></div><div class="co" id="ahCo"></div><div class="sn" id="ahSn"></div></div>
  <div class="foot" id="ahSkFoot"></div></div></div></div>`;
    const $ = s => hub.querySelector(s);

    function scale() {
        const girado = document.body.classList.contains('mobile-allowed');
        hub.style.fontSize = ((girado ? Math.min(innerWidth, innerHeight) : innerHeight) / U * 16) + 'px';
    }
    const skIcon = id => id ? 'img/skill-icons-pixel/' + id + '.png' : '';
    function paintStatic() {
        const ac = MODES[mode];
        hub.style.setProperty('--ac', ac);
        hub.style.setProperty('--acL', shade(ac, 0.5));
        hub.style.setProperty('--acD', shade(ac, -0.45));
        document.body.style.setProperty('--hub-ac', ac);
        const th = THEME[mode];
        [['--bg', th.bg], ['--top', th.top], ['--in1', th.inner], ['--in2', th.inner2], ['--edge', th.edge], ['--sh', th.shade], ['--mut', th.mut]].forEach(([k, v]) => hub.style.setProperty(k, v));
        const word = mode === 'classic' ? 'CLASSIC' : 'ARCADE';
        $('#ahRooms .mw').src = 'img/mode-title/' + word + '-word.png';
        drawPill($('#ahPillIco'), 64, 0.78);
        $('#ahPillSub').innerHTML = mode === 'arcade'
            ? '<img src="' + skIcon(picks[0]) + '"><img src="' + skIcon(picks[1]) + '">' + (picks[0] && picks[1] ? '' : 'PICK 2 SKILLS')
            : 'COLOR · SKIN';
        $('#ahRoomV').innerHTML = word + ' · <b class="' + (room === 'Free' || room === 'offline' ? '' : 'usd') + '">' + (room === 'offline' ? 'OFFLINE' : room === 'Free' ? 'FREE' : '$' + room.replace('$', '')) + '</b>';
        try {
            const ms = appMissionsFor(qToday()), hechas = 0, faltan = ms.length - hechas;
            $('#ahQBar').style.width = Math.round(hechas / ms.length * 100) + '%';
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
    function loop(t) {
        if (!hub.classList.contains('on')) return;
        paintBg(); drawPill($('#ahPill'), 96, 0.92, Math.round(Math.sin(t / 380) * 2), true);
        requestAnimationFrame(loop);
    }

    // ---------- ROOMS (solo las del modo) ----------
    async function pullRooms() {
        try { rooms = (await (await fetch('/api/rooms', { cache: 'no-store' })).json()).rooms || []; } catch (e) {}
        const mine = rooms.filter(r => r.mode === mode);
        $('#ahOnline').textContent = mine.reduce((a, r) => a + (r.players || 0), 0) + ' ONLINE';
        if ($('#ahRooms').classList.contains('open')) renderRooms();
    }
    function renderRooms() {
        const g = $('#ahrG'), mine = rooms.filter(r => r.mode === mode);
        $('#ahrOn').textContent = mine.reduce((a, r) => a + (r.players || 0), 0) + ' ONLINE';
        g.innerHTML = '';
        const off = document.createElement('div');
        off.className = 'cell' + (room === 'offline' ? ' sel' : '');
        off.innerHTML = '<div class="p" style="font-size:.62em;line-height:1.6em">OFFLINE</div><div class="f"><i style="width:0"></i></div><div class="n">VS BOTS</div><div class="st">PRACTICE</div>';
        off.onclick = () => { room = 'offline'; renderRooms(); paintStatic(); setTimeout(() => $('#ahRooms').classList.remove('open'), 220); };
        g.appendChild(off);
        PRICES.forEach(p => {
            const r = mine.find(x => x.room === p) || { players: 0, cap: 70, state: 'waiting', needed: 5 };
            const lock = false;
            const est = lock ? 'PC ONLY' : r.state === 'playing' ? 'IN GAME' : r.players >= (r.needed || 5) ? 'STARTING' : 'WAITING';
            const c = document.createElement('div');
            c.className = 'cell' + (p === room ? ' sel' : '') + (lock ? ' lock' : '');
            c.innerHTML = `<div class="p${p === 'Free' ? '' : ' usd'}"${p === 'Free' ? ' style="font-size:.62em;line-height:1.6em"' : ''}>${p === 'Free' ? 'FREE' : '$' + p.replace('$', '')}</div>
              <div class="f"><i style="width:${Math.min(100, Math.round((r.players || 0) / (r.cap || 70) * 100))}%"></i></div>
              <div class="n">${r.players || 0}/${r.cap || 70}</div><div class="st">${est}</div>`;
            c.onclick = () => {
                if (lock) { c.animate([{ transform: 'translateX(-.2em)' }, { transform: 'translateX(.2em)' }, { transform: 'none' }], { duration: 160 }); return; }
                room = p; renderRooms(); paintStatic();
                setTimeout(() => $('#ahRooms').classList.remove('open'), 220);
            };
            g.appendChild(c);
        });
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
        const arc = mode === 'arcade';
        hub.querySelectorAll('#ahSk .tb').forEach(b => { b.classList.toggle('on', b.dataset.t === pillTab); b.style.display = b.dataset.t === 'skills' && !arc ? 'none' : ''; });
        $('#ahSk .sk-slots').style.display = $('#ahSk .sk-lab').style.display = arc ? '' : 'none';
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
                SWATCH.forEach(col => {
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
            SKILLS.forEach(([id, nm]) => {
                const c = document.createElement('div');
                c.className = 'cell' + (picks.includes(id) ? ' used' : '');
                c.innerHTML = '<img src="' + skIcon(id) + '"><div class="nm">' + nm + '</div>';
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
    let skinPage = 0;
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
            const cv = document.createElement('canvas'); cv.width = cv.height = 64;
            const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
            let o = null;
            try { o = code ? paisPillRot(24, code, -Math.PI / 4) : pixPillSpriteRot(24, top, bot, -Math.PI / 4, true); } catch (e) {}
            if (o) { const k = 60 / o.cv.width; g.drawImage(o.cv, 32 - o.cv.width * k / 2, 32 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); }
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
            const cv = document.createElement('canvas'); cv.width = cv.height = 64;
            const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
            try { const o = paisPillRot(24, code, -Math.PI / 4), k = 60 / o.cv.width; g.drawImage(o.cv, 32 - o.cv.width * k / 2, 32 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); } catch (e) {}
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
            if (r && r.ok === false) { try { showSystemMsg(r.error === 'not enough SP' ? 'You need ' + PAIS_PRECIO_SP + ' SP. Earn SP with quests or convert $PILLY in CONVERT.' : (r.error || 'Could not do it.'), 'STORE'); } catch (e) {} return; }
            try { SoundManager.play('select'); } catch (e) {}
            try { renderMenuPill(); } catch (e) {}
            sv.classList.remove('open'); renderStore(); paintStatic();
            if (!tengo) desbloqueada(code);
        };
        sv.classList.add('open'); placa($('#ahSv .pnl'), 1);
    }
    // Cartel de skin desbloqueada: la pildora rebotando con destellos y un halo girando.
    function desbloqueada(code) {
        const un = $('#ahUn');
        const cv = $('#ahUnPill'); cv.width = cv.height = 128;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        try { const o = paisPillRot(48, code, -Math.PI / 4), k = 120 / o.cv.width; g.drawImage(o.cv, 64 - o.cv.width * k / 2, 64 - o.cv.height * k / 2, o.cv.width * k, o.cv.height * k); } catch (e) {}
        try { $('#ahUnN').textContent = skinNombreCelda(code); } catch (e) { $('#ahUnN').textContent = code; }
        $('#ahUnClose').onclick = () => un.classList.remove('open');
        $('#ahUnWear').onclick = async () => { try { await paisPoner(code); renderMenuPill(); } catch (e) {} un.classList.remove('open'); renderStore(); paintStatic(); };
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
    function renderQuests() {
        const g = $('#ahQG'); g.innerHTML = '';
        const dl = adScore && adScore.daily, day = dl && dl.date || qToday();
        const ms = appMissionsFor(day), done = {};
        $('#ahQBoost').textContent = ms.filter(m => done[m.id]).length + '/' + ms.length + ' TODAY';
        $('#ahQSp').textContent = (typeof paisSp === 'function' ? paisSp() : 0) + ' SP';
        $('#ahQFoot').textContent = 'New missions every day at 00:00 UTC';
        const orden = ms.filter(m => !done[m.id]).concat(ms.filter(m => done[m.id]));
        orden.forEach((m, i) => {
            const ok = !!done[m.id];
            let v = 0;
            if (ok) v = m.goal;
            else if (false && dl) v = m.kind === 'd' ? (m.prog ? m.prog({ kills: dl.kills || 0, matches: dl.matches || 0, c: Object.assign({ skill: {}, skillSet: [] }, dl.c || {}) }) : 0) : ((dl.best || {})[m.id] || 0);
            v = Math.min(m.goal, v | 0);
            const c = document.createElement('div');
            c.className = 'qc' + (ok ? ' done' : '');
            c.innerHTML = '<div><div class="k">' + m.tier + ' · ' + (m.kind === 'm' ? 'ONE MATCH' : 'TODAY') + '</div><div class="t"></div></div>' +
                '<div class="qp"><i style="width:' + Math.round(v / m.goal * 100) + '%"></i></div>' +
                '<div class="b"><span class="n">' + fmtN(v) + '/' + fmtN(m.goal) + '</span><span class="pts">' + (ok ? 'DONE' : '+' + m.pts + ' SP') + '</span></div>';
            c.querySelector('.t').textContent = m.t;
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
    function openPill(tab) {
        $('#ahName').value = ((document.getElementById('playerNameInput') || {}).value || '');
        $('#ahSk .pin .pg') && $('#ahSk .pin .pg').remove();
        pillTab = tab || (mode === 'arcade' ? 'skills' : 'color');
        slotSel = picks[0] ? (picks[1] ? 0 : 1) : 0;
        $('#ahSk').classList.add('open'); renderPill();
    }

    // ---------- cuenta: la wallet del movil; avatar elegido por el jugador ----------
    const cidLocal = () => { try { return localStorage.getItem('pw_cid') || ''; } catch (e) { return ''; } };
    const AV_STYLES = ['pill', 'spook', 'bag', 'npc', 'bolt', 'star', 'crown'];
    const AV_BG = ['#ab9ff2', '#0a0a0a', '#ccff00', '#00ffaa', '#1e6bff', '#ff2a55', '#ffd23a', '#8a948f', '#ffffff', '#b000ff'];
    const AV_FG = { bag: '#e5463f', spook: '#fbf7ef' };
    let xWallet = null;
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
    function pintaX() {
        const w = xWallet || (window.GameWallet && GameWallet.address);
        avPon($('.ah-ava'), avatar(), 64);
        $('#ahX').textContent = w ? 'WALLET ' + w.slice(0, 4) + '...' + w.slice(-4) : 'TAP TO CONNECT';
    }
    // Sesion del juego (la firma de wallet del airdrop): este movil pasa a esa cuenta.
    async function syncX() {
        try {
            const j = await (await fetch('/api/airdrop/me', { cache: 'no-store' })).json();
            xWallet = j && j.user && !j.user.walletPasted && j.user.wallet || null;
        } catch (e) {}
        if (xWallet && cidLocal()) {
            try { await fetch('/api/account/link', { method: 'POST', headers: { 'x-client-id': cidLocal() } }); } catch (e) {}
            try { if (typeof paisSync === 'function') await paisSync(); } catch (e) {}
        }
        pintaX(); paintStatic();
    }
    function pintaAvatarEditor() {
        avPon($('#ahPrPic'), avatar(), 96);
        $('#ahPrIc').innerHTML = '<button class="tb" id="ahPrEdit" style="width:auto;padding:.5em 1.2em">EDIT AVATAR</button>';
        $('#ahPrCl').innerHTML = '';
        $('#ahPrEdit').onclick = openAvatar;
    }
    // Editor del avatar: estilo, fondo y, con la pildora, sus colores o una skin tuya.
    function openAvatar() {
        const av = $('#ahAv'), a = avatar();
        const guarda = n => { try { localStorage.setItem('pw_avatar', JSON.stringify(n)); } catch (e) {} try { SoundManager.play('simpleselect'); } catch (e) {} openAvatar(); pintaX(); pintaAvatarEditor(); };
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
            if (!code) { b.className = 'no'; b.textContent = 'NO'; return; }
            const cv = document.createElement('canvas'); avPill(cv, { bg: '#1a3a2e', skin: code }, 48); b.appendChild(cv);
        }, code => (code || null) === (a.skin || null), code => guarda(Object.assign({}, a, { skin: code })));
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
        $('#ahPrDep').style.display = $('#ahPrWd').style.display = conectada ? '' : 'none';
        saldoJuego = 0;
        if (w) try { saldoJuego = (await (await fetch('/api/warbalance?wallet=' + w, { cache: 'no-store' })).json()).pill || 0; } catch (e) {}
        $('#ahPrBal').textContent = Math.floor(saldoJuego).toLocaleString('en-US');
        if (window.GameWalletUI && conectada) GameWalletUI.gameBalance = saldoJuego;
    }
    function conectaX() { openProfile(); }
    // Wallet del movil: la misma firma de entrada que el airdrop (gratis, sin tx).
    // Devuelve true si quedo conectada.
    async function loginWallet() {
        const p = window.GameWallet && GameWallet.getProvider('mwa');
        if (!p) { try { showSystemMsg('The phone wallet is not ready yet. Try again in a moment.', 'WALLET'); } catch (e) {} return false; }
        try {
            const r = await p.connect();
            const addr = r.publicKey.toString();
            const post = (path, body) => fetch('/api/airdrop/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json());
            const { nonce, message } = await post('nonce', {});
            const out = await p.signMessage(new TextEncoder().encode(message));
            const j = await post('wallet', { address: addr, nonce, signature: Array.from(out.signature) });
            if (j.error) throw new Error(j.error);
            GameWallet.address = addr; GameWallet.provider = p;
            try { localStorage.setItem('pw_wallet', 'mwa'); localStorage.setItem('pw_addr', addr); } catch (e) {}
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

    function tap(e) {
        const it = e.target.closest('[data-a]'); if (!it) return;
        const a = it.dataset.a;
        try { SoundManager.play('simpleselect'); } catch (x) {}
        if (a === 'x') { conectaX(); return; }
        if (a === 'rooms') { $('#ahRooms').classList.add('open'); renderRooms(); pullRooms(); }
        else if (a === 'store') openStore('shop');
        else if (a === 'quests') openQuests();
        else if (a === 'pill') {
            openPill();
        }
        else if (a === 'music') { try { toggleMusic(); } catch (x) {} paintStatic(); }
        else if (a === 'back') { hide(); try { goBackToModes(); } catch (x) {} }
    }
    function wire() {
        hub.addEventListener('click', tap);
        $('#ahPill').addEventListener('click', () => { try { SoundManager.play('simpleselect'); } catch (x) {} openPill('color'); });
        const cerrar = o => { o.classList.remove('open');
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
            pillTab = b.dataset.t; renderPill();
        });
        $('.ah-play').onclick = async () => {
            const kind = room === 'offline' ? 'offline' : 'online';
            try { SoundManager.play('select'); } catch (x) {}
            try {
                if (typeof Rejoin !== 'undefined' && Rejoin.get()) { startOnlineGame(); return; }
                if (kind === 'online' && room !== 'Free' && !(await saldoParaSala())) return;
                const nombre = ((document.getElementById('playerNameInput') || {}).value || '').trim();
                // Con nombre ya puesto se entra sin preguntar; si falta, el cartel de nombre de siempre.
                if (kind === 'online' && currentServer !== room && !selectRoom(room)) return;
                if (nombre) continueChoosePlay(kind); else choosePlay(kind);
            } catch (x) {}
        };
    }

    function show(m) {
        mode = m || 'classic'; hub.classList.add('on'); document.body.classList.add('hub-on');
        scale(); paintStatic(); pullRooms(); requestAnimationFrame(loop);
        try { if (typeof paisSync === 'function') Promise.resolve(paisSync()).then(paintStatic); } catch (e) {}
    }
    function hide() { closeQuests(); hub.classList.remove('on'); document.body.classList.remove('hub-on'); hub.querySelectorAll('.ov').forEach(o => o.classList.remove('open')); }

    function start() {
        document.body.appendChild(hub);
        try { const n = localStorage.getItem('pw_app_name'); if (n) guardaNombre(n); } catch (e) {}
        syncX();
        wire(); setInterval(() => { if (hub.classList.contains('on')) pullRooms(); }, 5000);
        addEventListener('resize', () => { if (hub.classList.contains('on')) { scale(); paintStatic(); } });
        // Un menu por modo: se abre al elegir CLASSIC o ARCADE en la rueda.
        const orig = window.selectMode;
        if (typeof orig === 'function') window.selectMode = function (m) { const r = orig.apply(this, arguments); show(m); return r; };
        window._hubShow = show; window._hubSyncX = syncX; window._hubUnlock = desbloqueada;
        // Contenedor de los avisos de MWA: un <div> sin id ni clase que la libreria
        // cuelga de <body> (con shadow DOM cerrado): se marca para poder girarlo.
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
            if (n.nodeType === 1 && n.tagName === 'DIV' && !n.id && !n.className && n.parentElement === document.body) n.classList.add('mwa-host');
        }))).observe(document.body, { childList: true });
        // La partida tapa al hub: se esconde al empezar y vuelve al volver al menu.
        ['startGame', 'startOnlineGame'].forEach(fn => {
            const o = window[fn];
            if (typeof o === 'function') window[fn] = function () { hide(); _enPartida = true; return o.apply(this, arguments); };
        });
        // Vuelta de la partida: el hub sale en el MISMO instante que el menu
        // antiguo (que queda tapado por hub-on), sin que se vea ni un frame.
        const oRet = window.returnToMenu;
        if (typeof oRet === 'function') window.returnToMenu = function () {
            document.body.classList.add('hub-on');
            const r = oRet.apply(this, arguments); _enPartida = false; show(mode); return r;
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
    if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
