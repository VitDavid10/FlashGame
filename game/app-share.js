// SHARE de los carteles de fin de partida en la app (dApp Store): una card
// 1200x630 por cartel, como la de la arena del airdrop (airdrop.html, drawRun),
// con COPY LINK (sube la imagen y da un enlace /c/<id> que X ensena como card)
// y SAVE IMAGE (a la galeria, por el puente nativo PillAndroid de la APK).
// Las lineas de texto salen de finLineasApp (game/index.html): son las mismas
// que se ven en el cartel.
(() => {
    if (!document.documentElement.classList.contains('pw-app')) return;
    const $ = s => document.querySelector(s);
    const W = 1200, H = 630, PX = '"Press Start 2P", monospace';
    const TONO = { '': '#ffffff', w: '#ffffff', v: '#ffce3d', g: '#00ff88', r: '#f62a2d', d: '#9fc2ad' };

    // ---- dibujo (mismo marco y pantalla que las cards del airdrop) ----
    const FRAME = { K: 3, T: 7, RADIO: 9, RADIO_HUECO: 4, MARGIN: 15, HEX: '#00ffaa', GLOW: 0.38, GLOW_STEPS: 2,
        TONOS: { rim: 0.16, lit: 0.75, mid: 0.45, dim: 0.24, inner: 0.36, body: 0.30, masa: 0.21 }, MASA_DESDE: 4, SUB: 2 };
    const HOLE = (() => { const o = FRAME.MARGIN, t = FRAME.T * FRAME.K; return { x: o + t, y: o + t, w: W - 2 * (o + t), h: H - 2 * (o + t) }; })();
    function text(g, str, x, y, size, color, align, shadow) {
        g.font = size + 'px ' + PX; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic';
        if (shadow) { g.fillStyle = shadow; g.fillText(str, x + size / 8, y + size / 8); }
        g.fillStyle = color; g.fillText(str, x, y);
    }
    const fit = (g, str, size, maxW) => { g.font = size + 'px ' + PX; const w = g.measureText(str).width; return w > maxW ? Math.floor(size * maxW / w) : size; };
    function drawFloor(g) {
        g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,255,255,.03)';
        for (let x = 0; x < W; x += 60) g.fillRect(x, 0, 3, H);
        for (let y = 0; y < H; y += 60) g.fillRect(0, y, W, 3);
    }
    function drawScreenBg(g) {
        const h = HOLE;
        g.fillStyle = 'rgb(14,42,27)'; g.fillRect(h.x, h.y, h.w, h.h);
        g.fillStyle = 'rgba(0,255,136,.035)';
        for (let x = h.x; x < h.x + h.w; x += 48) g.fillRect(x, h.y, 2, h.h);
        for (let y = h.y; y < h.y + h.h; y += 48) g.fillRect(h.x, y, h.w, 2);
    }
    function drawScreenFx(g) {
        const h = HOLE;
        g.save(); g.beginPath(); g.rect(h.x, h.y, h.w, h.h); g.clip();
        const v = g.createRadialGradient(W / 2, H / 2, h.h * .35, W / 2, H / 2, h.w * .7);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
        g.fillStyle = v; g.fillRect(h.x, h.y, h.w, h.h);
        g.fillStyle = 'rgba(0,0,0,.12)';
        for (let y = h.y; y < h.y + h.h; y += 8) g.fillRect(h.x, y, h.w, 4);
        g.restore();
    }
    let marco = null;   // el marco no cambia: se pinta una vez y se reutiliza
    function drawFrame(g) {
        const F = FRAME, K = F.K, SUB = F.SUB;
        const FW = Math.round((W - 2 * F.MARGIN) / K), FH = Math.round((H - 2 * F.MARGIN) / K), T = F.T;
        if (!marco) {
            const corner = (dx, dy, radio) => {
                if (dx >= radio || dy >= radio) return true;
                const ex = radio - dx, ey = radio - dy;
                return ex * ex + ey * ey <= radio * radio;
            };
            const inOuter = (x, y) => x >= 0 && y >= 0 && x < FW && y < FH && corner(Math.min(x, FW - 1 - x), Math.min(y, FH - 1 - y), F.RADIO);
            const inHole = (x, y) => {
                if (x < T || y < T || x >= FW - T || y >= FH - T) return false;
                return corner(Math.min(x - T, FW - T - 1 - x), Math.min(y - T, FH - T - 1 - y), F.RADIO_HUECO);
            };
            const inBand = (x, y) => inOuter(x, y) && !inHole(x, y);
            marco = document.createElement('canvas'); marco.width = FW; marco.height = FH;
            const c = marco.getContext('2d'), img = c.createImageData(FW, FH), px = img.data;
            const rgb = [0, 255, 170], sh = f => rgb.map(v => Math.round(v * f)), TN = F.TONOS;
            const C = { rim: sh(TN.rim), lit: sh(TN.lit), dim: sh(TN.dim), mid: sh(TN.mid), inner: sh(TN.inner), body: sh(TN.body), masa: sh(TN.masa) };
            const LX = -0.6, LY = -0.75, HASTA = Math.max(3, F.MASA_DESDE) * SUB;
            for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
                if (!inBand(x, y)) continue;
                let ring = HASTA;
                for (let r = 1; r <= HASTA && ring === HASTA; r++) {
                    for (let oy = -1; oy <= 1 && ring === HASTA; oy++) for (let ox = -1; ox <= 1; ox++) {
                        if ((!ox && !oy) || inBand(x + ox * r, y + oy * r)) continue;
                        ring = r - 1; break;
                    }
                }
                let col;
                if (ring < SUB) col = C.rim;
                else if (ring < 2 * SUB) {
                    let nx = 0, ny = 0;
                    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
                        if ((!ox && !oy) || inBand(x + ox, y + oy)) continue;
                        const d = Math.hypot(ox, oy); nx += ox / d; ny += oy / d;
                    }
                    const l = Math.hypot(nx, ny) || 1, ndl = (nx / l) * LX + (ny / l) * LY;
                    col = ndl > 0.15 ? C.lit : ndl < -0.15 ? C.dim : C.mid;
                } else if (ring < 3 * SUB) col = C.inner;
                else col = ring >= F.MASA_DESDE * SUB ? C.masa : C.body;
                const t = -(y - FH / 2) / (Math.hypot(FW, FH) / 2);
                const q = Math.round(Math.max(-1, Math.min(1, t)) * F.GLOW_STEPS) / F.GLOW_STEPS, f = 1 + F.GLOW * q;
                const i = (y * FW + x) << 2;
                px[i] = Math.min(255, col[0] * f); px[i + 1] = Math.min(255, col[1] * f); px[i + 2] = Math.min(255, col[2] * f); px[i + 3] = 255;
            }
            c.putImageData(img, 0, 0);
        }
        g.imageSmoothingEnabled = false;
        g.drawImage(marco, F.MARGIN, F.MARGIN, FW * K, FH * K);
    }
    // Una linea de trozos [texto, tono]; devuelve el ancho para poner otra detras.
    function linea(g, trozos, x, y, size) {
        let cx = x;
        for (const [t, c] of trozos) {
            text(g, t, cx, y, size, TONO[c] || '#fff', 'left', '#000');
            g.font = size + 'px ' + PX; cx += g.measureText(t).width;
        }
        return cx - x;
    }
    const anchoLinea = (g, trozos, size) => { g.font = size + 'px ' + PX; return trozos.reduce((a, [t]) => a + g.measureText(t).width, 0); };
    const nombre = () => (((document.getElementById('playerNameInput') || {}).value || '').trim() || 'PLAYER').toUpperCase().slice(0, 16);

    function drawCard(g, d, shot) {
        const h = HOLE;
        drawFloor(g); drawScreenBg(g);
        if (shot && shot.width) {
            const sc = Math.max(h.w / shot.width, h.h / shot.height), dw = shot.width * sc, dh = shot.height * sc;
            g.save(); g.beginPath(); g.rect(h.x, h.y, h.w, h.h); g.clip();
            g.imageSmoothingEnabled = true;
            g.drawImage(shot, h.x + (h.w - dw) / 2, h.y + (h.h - dh) / 2, dw, dh);
            g.restore();
        }
        // Marca arriba a la izquierda: pildora + PILLWARS, sobre una placa oscura
        // para que se lea encima de lo que haya en la foto.
        g.fillStyle = 'rgba(3,12,7,.86)'; g.fillRect(h.x + 14, h.y + 14, 330, 66);
        g.fillStyle = '#1d5a3c'; g.fillRect(h.x + 14, h.y + 77, 330, 3);
        try { const p = pixPillSpriteRot(11, '#c0c8d0', '#00ff44', Math.PI / 5, true); g.imageSmoothingEnabled = false; g.drawImage(p, h.x + 22, h.y + 14, p.width * 3, p.height * 3); } catch (e) {}
        text(g, 'PILLWARS', h.x + 104, h.y + 62, 30, '#ffffff', 'left', '#000');
        // MATCH ENDED: el top 5 del reparto en una caja a la derecha.
        if (d.tipo === 'matchEnded' && d.top && d.top.length) {
            const bw = 400, bx = h.x + h.w - bw - 24, by = h.y + 24, rows = d.top.slice(0, 5), bh = 56 + rows.length * 40;
            g.fillStyle = 'rgba(3,12,7,.86)'; g.fillRect(bx, by, bw, bh);
            g.fillStyle = '#1d5a3c'; g.fillRect(bx, by, bw, 3); g.fillRect(bx, by + bh - 3, bw, 3); g.fillRect(bx, by, 3, bh); g.fillRect(bx + bw - 3, by, 3, bh);
            text(g, 'TOP 10 PRIZES', bx + 20, by + 38, 14, '#9fc2ad');
            rows.forEach((t, i) => {
                const y = by + 82 + i * 40, col = t.mine ? '#ffce3d' : '#ffffff';
                text(g, '#' + t.pos, bx + 20, y, 14, col);
                text(g, String(t.name || '-').toUpperCase().slice(0, 10), bx + 84, y, 14, col);
                text(g, fmtPillShortApp(t.amount), bx + bw - 20, y, 14, '#00ff88', 'right');
            });
        }
        // Banda de abajo: titulo + nombre, y las dos lineas del cartel.
        const by = h.y + h.h - 150;
        g.fillStyle = 'rgba(8,25,15,.92)'; g.fillRect(h.x, by, h.w, 150);
        g.fillStyle = '#00ffaa'; g.fillRect(h.x, by - 4, h.w, 4);
        const L = h.x + 30, R = h.x + h.w - 30;
        const titulo = d.texto || 'PILLWARS';
        text(g, titulo, L, by + 52, fit(g, titulo, 32, 640), d.color || '#ffffff', 'left', '#000');
        text(g, nombre(), R, by + 52, fit(g, nombre(), 18, 380), '#9fc2ad', 'right');
        const l1 = d.l1 || [], l2 = d.l2 || [], sep = [['   ', '']];
        const todo = l1.concat(sep, l2), size = Math.min(22, fit(g, todo.map(t => t[0]).join(''), 22, R - L));
        if (anchoLinea(g, todo, size) <= R - L) linea(g, todo, L, by + 110, size);
        else { linea(g, l1, L, by + 98, 18); linea(g, l2, L, by + 130, 18); }
        drawScreenFx(g); drawFrame(g);
    }
    function fmtPillShortApp(n) {
        try { return fmtPillShort(n); } catch (e) { return String(Math.round(n || 0)); }
    }

    // ---- ventana de SHARE ----
    const m = document.createElement('div');
    m.id = 'ahShare'; m.className = 'gameModal';
    m.innerHTML = '<div class="gameModalBox ah-sh">' +
        '<div class="ah-sh-t">SHARE</div><canvas width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="ah-sh-b"><button class="ah-pb ah-pb-blue" data-a="link">COPY LINK</button>' +
        '<button class="ah-pb ah-pb-green" data-a="save">SAVE IMAGE</button>' +
        '<button class="ah-pb ah-pb-grey" data-a="close">CLOSE</button></div>' +
        '<div class="ah-sh-msg"></div></div>';
    document.body.appendChild(m);
    const st = document.createElement('style');
    st.textContent = `
html.pw-app #ahShare{z-index:400!important;background:rgba(0,0,0,.86)!important}
html.pw-app #ahShare .gameModalBox.ah-sh{background:none!important;border:none!important;box-shadow:none!important;transform:none!important;width:auto!important;max-width:none!important;padding:0!important;
  display:flex;flex-direction:column;align-items:center;gap:10px}
html.pw-app .ah-sh-t{font-family:'Press Start 2P',monospace;font-size:18px;color:#fff;text-shadow:3px 3px 0 #000}
html.pw-app .ah-sh canvas{width:440px;height:231px;image-rendering:auto;box-shadow:0 0 0 2px #1d5a3c}
html.pw-app .ah-sh-b{display:flex;gap:10px}
html.pw-app .ah-pb{--plate:var(--ah-placa-grey);background:none;border:9px solid transparent;border-image:var(--plate) 3 fill / 9px / 0 stretch;image-rendering:pixelated;
  min-height:40px;padding:2px 14px;font-family:'Press Start 2P',monospace;font-size:10px;color:#fff;text-shadow:2px 2px 0 rgba(0,0,0,.7);white-space:nowrap;cursor:pointer;
  filter:drop-shadow(3px 3px 0 rgba(0,0,0,.55))}
html.pw-app .ah-pb:active{transform:translate(2px,2px)}
html.pw-app .ah-pb-blue{--plate:var(--ah-placa-blue)} html.pw-app .ah-pb-green{--plate:var(--ah-placa-green)}
html.pw-app .ah-sh-msg{font-family:'Press Start 2P',monospace;font-size:9px;color:#00ff88;min-height:12px}
`;
    document.head.appendChild(st);
    const cv = m.querySelector('canvas'), msg = m.querySelector('.ah-sh-msg');
    let enlace = null;

    function abrir() {
        const d = window._finData; if (!d) return;
        // Foto de la partida: el canvas del juego tal como esta detras del cartel.
        let shot = null;
        try {
            const src = document.getElementById('gameCanvas');
            shot = document.createElement('canvas'); shot.width = src.width; shot.height = src.height;
            shot.getContext('2d').drawImage(src, 0, 0);
        } catch (e) { shot = null; }
        drawCard(cv.getContext('2d'), d, shot);
        enlace = null; msg.textContent = '';
        m.style.display = 'flex';
    }
    const blob = () => new Promise(res => { try { cv.toBlob(b => res(b), 'image/png'); } catch (e) { res(null); } });
    async function subir() {
        if (enlace) return enlace;
        try {
            const r = await fetch('/api/airdrop/card', { method: 'POST', body: await blob(), headers: { 'Content-Type': 'image/png', 'X-Airdrop-Kind': 'run' } });
            if (r.ok) enlace = (await r.json()).url;
        } catch (e) {}
        return enlace;
    }
    async function copiar(t) {
        try { if (window.PillAndroid && PillAndroid.copyText(t)) return true; } catch (e) {}
        try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
    }
    m.addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'close') { m.style.display = 'none'; return; }
        if (a === 'link') {
            msg.textContent = 'PREPARING YOUR LINK...';
            const l = await subir();
            if (!l) { msg.textContent = 'COULD NOT CREATE THE LINK, TRY AGAIN'; return; }
            msg.textContent = (await copiar(l)) ? 'LINK COPIED - PASTE IT IN YOUR POST' : l;
            return;
        }
        if (a === 'save') {
            const data = cv.toDataURL('image/png');
            try {
                if (window.PillAndroid) { msg.textContent = PillAndroid.saveImage(data.split(',')[1], 'pillwars-' + Date.now() + '.png') ? 'SAVED TO YOUR GALLERY' : 'COULD NOT SAVE THE IMAGE'; return; }
            } catch (e) {}
            const el = document.createElement('a'); el.href = data; el.download = 'pillwars.png';
            document.body.appendChild(el); el.click(); el.remove();
            msg.textContent = 'IMAGE SAVED';
        }
    });

    // SHARE del cartel de premio y uno nuevo en GAME OVER / MATCH FINISHED.
    const ps = document.getElementById('prizeShare');
    if (ps) { ps.onclick = () => { abrir(); return false; }; }
    const acts = document.querySelector('#resultOverlay .result-actions'), back = document.getElementById('btnBackToMenu');
    if (acts && back && !document.getElementById('ahResShare')) {
        const s = document.createElement('button'); s.id = 'ahResShare'; s.className = 'btn-play'; s.textContent = 'SHARE';
        s.onclick = abrir; acts.insertBefore(s, back);
    }
    window._hubShare = abrir;   // pruebas
})();
