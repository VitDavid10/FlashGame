// Boceto del menu de la app con el estilo de la VS / VICTORY. Se inyecta en la pagina del juego.
window._mk = (function (variante, abajo) {
    document.getElementById('mkMenu')?.remove();
    const css = document.getElementById('mkMenuCss') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'mkMenuCss' }));
    css.textContent = `
#mkMenu{position:fixed;inset:0;z-index:999999;overflow:hidden;font-family:'Press Start 2P',monospace;color:#fff;font-size:10px}
#mkMenu.dark{background:#06100b;background-image:linear-gradient(rgba(0,255,136,.07) 2px,transparent 2px),linear-gradient(90deg,rgba(0,255,136,.07) 2px,transparent 2px);background-size:40px 40px}
#mkMenu.lime{background:#ccff00;background-image:linear-gradient(rgba(11,15,5,.12) 2px,transparent 2px),linear-gradient(90deg,rgba(11,15,5,.12) 2px,transparent 2px);background-size:40px 40px}
/* barra de arriba: franja negra inclinada como las de la VS */
#mkMenu .top{position:absolute;left:-3%;right:-3%;top:-4%;height:19%;background:#0b0f05;transform:rotate(-2deg);border-bottom:.6em solid #ccff00}
#mkMenu .who{position:absolute;left:3%;top:3.2%;display:flex;align-items:center;gap:1.4em}
#mkMenu .av{width:5.4em;height:5.4em;background:#ccff00;box-shadow:0 0 0 .4em #0b0f05,.5em .5em 0 .4em #000;display:flex;align-items:center;justify-content:center}
#mkMenu .nm{font-size:1.5em;text-shadow:.15em .15em 0 #000}
#mkMenu .hd{font-size:.8em;color:#ccff00;margin-top:.7em}
#mkMenu .bal{position:absolute;right:24%;top:5.5%;font-size:1.3em;text-shadow:.15em .15em 0 #000}#mkMenu .bal b{color:#ffd23a;font-weight:400}#mkMenu .bal i{font-style:normal;color:#ccff00;margin-left:1em}
#mkMenu .ic{position:absolute;top:3%;width:4.4em;height:4.4em;background:#0b0f05;border:.3em solid #ccff00;box-shadow:.35em .35em 0 #000;display:flex;align-items:center;justify-content:center}#mkMenu .ic span{font-size:2.2em;line-height:1;color:#ccff00;filter:drop-shadow(.08em .08em 0 #000)}
/* menu: losas negras inclinadas con borde de color, icono en marco como las fotos de la VS */
#mkMenu .it{position:absolute;left:-2%;width:46%;height:15%;background:#0b0f05;transform:rotate(-4deg);display:flex;align-items:center;gap:1.6em;padding-left:6%;box-sizing:border-box;box-shadow:.5em .5em 0 rgba(0,0,0,.35)}
#mkMenu .it .fr{flex:none;overflow:hidden;margin-top:2.6em;width:5.2em;height:5.2em;background:#141a10;box-shadow:0 0 0 .35em var(--c),.4em .4em 0 .35em #000;display:flex;align-items:center;justify-content:center}
#mkMenu .it .t{font-size:1.7em;text-shadow:.15em .15em 0 #000}
#mkMenu .it .s{font-size:.75em;color:var(--c);margin-top:.8em;letter-spacing:.08em}
#mkMenu .it .bar{width:14em;height:.8em;background:#1b2414;margin-top:.8em}#mkMenu .it .bar i{display:block;height:100%;width:62%;background:var(--c)}
#mkMenu .it{border-left:.7em solid var(--c)}
/* derecha: la pildora grande y PLAY como los botones de VICTORY */
#mkMenu .pill{position:absolute;right:9%;top:22%;width:30%;height:52%;display:flex;align-items:center;justify-content:center}
#mkMenu .pill canvas{height:100%;image-rendering:pixelated;filter:drop-shadow(.8em .8em 0 rgba(0,0,0,.35))}
#mkMenu .play{position:absolute;right:4%;bottom:7%;width:36%;height:15%;background:#ccff00;border:.45em solid #0b0f05;box-shadow:.6em .6em 0 rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:3.2em;color:#0b0f05;letter-spacing:.2em}
#mkMenu.lime .play{background:#0b0f05;color:#ccff00;border-color:#0b0f05}
#mkMenu .mode{position:absolute;right:13%;bottom:1.8%;font-size:.9em;color:#e8e8e8}#mkMenu .mode b{color:#00ff88;font-weight:400}
#mkMenu.lime .mode{color:#0b0f05}
#mkMenu .grp{position:absolute;right:42%;bottom:8%;width:6em;height:6em;background:#0b0f05;border:.35em solid #ccff00;box-shadow:.4em .4em 0 #000;display:flex;align-items:center;justify-content:center;font-size:1.4em}
#mkMenu .ic .pxc{width:2.6em;height:2.6em}
#mkMenu .grp .pxc{width:3.2em;height:3.2em}
#mkMenu .tab .pxc,#mkMenu .chips .pxc{width:1.5em;height:1.5em;vertical-align:middle}
#mkMenu .sw .pxc{width:1.7em;height:1.7em}
#mkMenu .sw{background:#0b0f05!important;border-color:#ccff00!important}
#mkMenu .grp.g1{right:45%;bottom:7%;width:5.4em;height:5.4em}
#mkMenu .tab{position:absolute;right:4%;bottom:24.5%;display:flex;align-items:center;gap:1em;background:#0b0f05;padding:.7em 1.2em;box-shadow:.4em .4em 0 rgba(0,0,0,.35);font-size:1.15em}
#mkMenu .tab span{color:#fff}#mkMenu .tab b{color:#00ff88;font-weight:400}#mkMenu .tab i{font-style:normal;color:#ccff00;margin-left:.3em}
#mkMenu .grp.g2{right:45%;bottom:7%;width:6.4em;height:6.8em;flex-direction:column;gap:.5em}#mkMenu .grp.g2 small{font-size:.75em;color:#ccff00}
#mkMenu .play.p2{flex-direction:column;gap:.35em;font-size:2.6em}#mkMenu .play.p2 small{font-size:.32em;letter-spacing:.12em;color:#ccff00}
#mkMenu .sw{position:absolute;right:2.6%;bottom:19.5%;width:2.6em;height:2.6em;background:#ccff00;border:.25em solid #0b0f05;display:flex;align-items:center;justify-content:center;font-size:1.3em;color:#0b0f05;box-shadow:.25em .25em 0 rgba(0,0,0,.4)}
#mkMenu .chips{position:absolute;right:4%;bottom:25.5%;display:flex;gap:.8em;z-index:2}#mkMenu .chips span{font-size:1.1em;padding:.7em 1em;box-shadow:.35em .35em 0 rgba(0,0,0,.35)}
#mkMenu .chips .c1{background:#0b0f05;color:#ccff00}#mkMenu .chips .c2{background:#00ff88;color:#0b0f05}
#mkMenu .grp.g3{right:45%;bottom:7%;width:5.4em;height:5.4em}
#mkMenu .mode{display:none}
#mkMenu .lbl{position:absolute;left:1.5%;bottom:1.5%;font-size:.8em;color:#9fb0a6}
#mkMenu.lime .lbl{color:#0b0f05}`;
    const spr = window.pwPillSprite;
    const pill = (r, top, bot) => { const o = spr(r, top, bot, -Math.PI / 4, true), src = o.cv || o; const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; };
    const el = document.createElement('div'); el.id = 'mkMenu'; el.className = variante;
    const items = [
        ['THE PILL', '#ccff00', '<span style="display:flex;gap:.4em;margin-top:.7em"><img src="img/skill-icons-pixel/big.png" style="width:2.2em;image-rendering:pixelated"><img src="img/skill-icons-pixel/iman.png" style="width:2.2em;image-rendering:pixelated"></span>', 'p'],
        ['ARENAS', '#1d9bf0', '<div class="s">1V1 · 2V2 · 3V3</div>', 'x'],
        ['STORE', '#ffd23a', '<div class="s">NEW SKINS</div>', 's'],
        ['QUESTS', '#ff4d6d', '<div class="bar"><i></i></div>', 'q'],
    ];
    const icon = { x: ['swords', '#1d9bf0', '#0f5f99'], s: ['bag', '#ffd23a', '#c99a12'], q: ['quests', '#ff4d6d', '#a3172e'] };
    el.innerHTML = '<div class="top"></div>' +
        '<div class="who"><div class="av" id="mkAv"></div><div><div class="nm">PILLWARS</div><div class="hd">@pillwarsdotfun · AjGQ...qX6k</div></div></div>' +
        '<div class="bal"><b>894.1K</b> $PILLY<i>0 SP</i></div>' +
        '<div class="ic" style="right:17%"><i class="pxi" data-i="addfriend" data-a="#ccff00" data-ad="#8fb300"></i></div><div class="ic" style="right:10%"><i class="pxi" data-i="music" data-a="#ccff00" data-ad="#8fb300"></i></div><div class="ic" style="right:3%"><i class="pxi" data-i="back" data-a="#ccff00" data-ad="#8fb300"></i></div>' +
        items.map((x, i) => '<div class="it" style="--c:' + x[1] + ';top:' + (21 + i * 18.5) + '%"><div class="fr" data-k="' + x[3] + '"></div><div><div class="t">' + x[0] + '</div>' + x[2] + '</div></div>').join('') +
        '<div class="pill" id="mkPill"></div>' +
        (abajo === 1 ? '<div class="grp g1"><i class="pxi" data-i="group" data-a="#ccff00" data-ad="#8fb300"></i></div><div class="play">PLAY</div><div class="tab t1"><span>ARCADE</span><b>FREE</b><i class="pxi" data-i="swap" data-a="" data-ad=""></i></div>'
        : abajo === 2 ? '<div class="grp g2"><i class="pxi" data-i="group" data-a="#ccff00" data-ad="#8fb300"></i><small>GROUP</small></div><div class="play p2">PLAY<small>ARCADE · FREE</small></div><div class="sw"><i class="pxi" data-i="swap" data-a="" data-ad=""></i></div>'
        : '<div class="chips"><span class="c1">ARCADE <i class="pxi" data-i="swap" data-a="" data-ad=""></i></span><span class="c2">FREE</span></div><div class="grp g3"><i class="pxi" data-i="group" data-a="#ccff00" data-ad="#8fb300"></i></div><div class="play">PLAY</div>') +
        '<div class="lbl">BOCETO B' + abajo + '</div>';
    document.body.appendChild(el);
    el.style.fontSize = Math.round(Math.min(innerWidth * 0.0105, innerHeight * 0.024)) + 'px';
    if (spr) {
        document.getElementById('mkPill').appendChild(pill(56, '#c8cdd2', '#00e64d'));
        document.getElementById('mkAv').appendChild(pill(10, '#c8cdd2', '#00e64d')).style.height = '4em';
        el.querySelectorAll('.fr').forEach(f => { const k = f.dataset.k; if (k === 'p') { const c = f.appendChild(pill(10, '#c8cdd2', '#00e64d')); c.style.height = '4.4em'; c.style.imageRendering = 'pixelated'; } else { const c = window.pwPixIcon(icon[k][0], icon[k][1], icon[k][2]); c.style.width = c.style.height = '3.8em'; f.appendChild(c); } });
        el.querySelectorAll('i.pxi').forEach(t => { const c = window.pwPixIcon(t.dataset.i, t.dataset.a || undefined, t.dataset.ad || undefined); t.replaceWith(c); c.className = 'pxc'; });
        const c = el.querySelector('#mkAv canvas'); if (c) c.style.imageRendering = 'pixelated';
    }
})
