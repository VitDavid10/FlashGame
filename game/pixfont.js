/*
 * Fuente bitmap pixel del juego (PIXFONT 5x7 + render normal/bold/HD Scale2x
 * + pixFancyText para carteles). Compartida entre game/index.html y
 * game/comparativa.html: cambiar el alfabeto aqui afecta a ambos.
 * Extraida tal cual de game/index.html (sin cambios de logica).
 */
// ===== Fuente bitmap pixel 5×7 (procedural, sin assets) =====
// Cada glifo = 7 filas de 5 bits (bit 4 = columna izquierda). Se dibuja con
// fillRect por píxel; contorno sólido en 8 direcciones. Todo en mayúsculas.
const PIXFONT = {
    ' ': [0,0,0,0,0,0,0],
    '0': [0x0E,0x11,0x13,0x15,0x19,0x11,0x0E], '1': [0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
    '2': [0x0E,0x11,0x01,0x02,0x04,0x08,0x1F], '3': [0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
    '4': [0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], '5': [0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
    '6': [0x06,0x08,0x10,0x1E,0x11,0x11,0x0E], '7': [0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
    '8': [0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E], '9': [0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
    'A': [0x0E,0x11,0x11,0x1F,0x11,0x11,0x11], 'B': [0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
    'C': [0x0E,0x11,0x10,0x10,0x10,0x11,0x0E], 'D': [0x1C,0x12,0x11,0x11,0x11,0x12,0x1C],
    'E': [0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F], 'F': [0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
    'G': [0x0E,0x11,0x10,0x17,0x11,0x11,0x0F], 'H': [0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
    'I': [0x0E,0x04,0x04,0x04,0x04,0x04,0x0E], 'J': [0x07,0x02,0x02,0x02,0x02,0x12,0x0C],
    'K': [0x11,0x12,0x14,0x18,0x14,0x12,0x11], 'L': [0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
    'M': [0x11,0x1B,0x15,0x15,0x11,0x11,0x11], 'N': [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
    'O': [0x0E,0x11,0x11,0x11,0x11,0x11,0x0E], 'P': [0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
    'Q': [0x0E,0x11,0x11,0x11,0x15,0x12,0x0D], 'R': [0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
    'S': [0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E], 'T': [0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
    'U': [0x11,0x11,0x11,0x11,0x11,0x11,0x0E], 'V': [0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
    'W': [0x11,0x11,0x11,0x15,0x15,0x1B,0x11], 'X': [0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
    'Y': [0x11,0x11,0x0A,0x04,0x04,0x04,0x04], 'Z': [0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
    '!': [0x04,0x04,0x04,0x04,0x04,0x00,0x04], '+': [0x00,0x04,0x04,0x1F,0x04,0x04,0x00],
    '-': [0x00,0x00,0x00,0x1F,0x00,0x00,0x00], '(': [0x02,0x04,0x08,0x08,0x08,0x04,0x02],
    ')': [0x08,0x04,0x02,0x02,0x02,0x04,0x08], '/': [0x01,0x02,0x02,0x04,0x08,0x08,0x10],
    ':': [0x00,0x04,0x04,0x00,0x04,0x04,0x00], '.': [0x00,0x00,0x00,0x00,0x00,0x06,0x06],
    ',': [0x00,0x00,0x00,0x00,0x06,0x04,0x08], '?': [0x0E,0x11,0x01,0x02,0x04,0x00,0x04],
    '$': [0x04,0x0F,0x14,0x0E,0x05,0x1E,0x04], '%': [0x18,0x19,0x02,0x04,0x08,0x13,0x03],
    "'": [0x04,0x04,0x04,0x00,0x00,0x00,0x00], '◆': [0x04,0x0E,0x1F,0x0E,0x04,0x00,0x00],
};
// bold = glifo a rejilla doble + dilatación 1 (trazo 3 unidades, huecos interiores
// preservados): glifo 11×15, avance 13. shade = color de las filas inferiores
// (sombreado interno estilo cartel arcade).
function pixTextWidth(text, px, bold) { const n = String(text).length; return n > 0 ? (bold ? (13 * n - 2) : (6 * n - 1)) * px : 0; }
function _pixTextBlocks(g, text, x, y, px, color, bold, shade) {
    const adv = (bold ? 13 : 6) * px; let cx = x;
    for (const ch of String(text).toUpperCase()) {
        const rows = PIXFONT[ch];
        if (rows) for (let r = 0; r < 7; r++) {
            g.fillStyle = (shade && r >= 5) ? shade : color; const bits = rows[r];
            for (let c = 0; c < 5; c++) if (bits & (1 << (4 - c))) {
                if (bold) g.fillRect(cx + 2 * c * px, y + 2 * r * px, 3 * px, 3 * px);
                else g.fillRect(cx + c * px, y + r * px, px, px);
            }
        }
        cx += adv;
    }
}
const _PIX_OUT8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
function drawPixelText(g, text, x, y, px, fill, outline) {
    if (outline) for (const o of _PIX_OUT8) _pixTextBlocks(g, text, x + o[0] * px, y + o[1] * px, px, outline);
    _pixTextBlocks(g, text, x, y, px, fill);
}

// ===== Texto "HD": misma fuente 5×7, más resolución real vía Scale2x =====
// El glifo bold (11×15, ya dilatado) se sube de resolución con la regla
// Scale2x/AdvMAME2x (suaviza escalones diagonales generando esquinas
// intermedias reales) en vez de solo escalar en bloque. Resultado: mismas
// letras, mismo tamaño final, pero con muchos más "píxeles" de detalle en
// las curvas — igual que el pixel art dibujado a mano en vez de bitmap crudo.
function _glyphBoldGrid(ch) {
    const rows = PIXFONT[ch], w = 11, h = 15, bits = new Uint8Array(w * h);
    if (rows) for (let r = 0; r < 7; r++) { const bitrow = rows[r]; for (let c = 0; c < 5; c++) if (bitrow & (1 << (4 - c))) {
        const bx = c * 2, by = r * 2;
        for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) { const gx = bx + xx, gy = by + yy; if (gx < w && gy < h) bits[gy * w + gx] = 1; }
    } }
    return { bits, w, h };
}
function _scale2xBool(bits, w, h) {
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : bits[y * w + x];
    const w2 = w * 2, h2 = h * 2, out = new Uint8Array(w2 * h2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const E = at(x, y), B = at(x, y - 1), D = at(x - 1, y), F = at(x + 1, y), H = at(x, y + 1);
        let e0 = E, e1 = E, e2 = E, e3 = E;
        if (B !== H && D !== F) { e0 = (D === B) ? D : E; e1 = (B === F) ? F : E; e2 = (D === H) ? D : E; e3 = (H === F) ? F : E; }
        const ox = x * 2, oy = y * 2;
        out[oy * w2 + ox] = e0; out[oy * w2 + ox + 1] = e1; out[(oy + 1) * w2 + ox] = e2; out[(oy + 1) * w2 + ox + 1] = e3;
    }
    return { bits: out, w: w2, h: h2 };
}
const _hdGlyphCache = new Map();
function _hdGlyph(ch, levels) {
    const key = ch + '|' + levels; let g = _hdGlyphCache.get(key); if (g) return g;
    let cur = _glyphBoldGrid(ch);
    for (let i = 0; i < levels; i++) cur = _scale2xBool(cur.bits, cur.w, cur.h);
    _hdGlyphCache.set(key, cur); return cur;
}
function _pixTextBlocksHD(g, text, x, y, px, color, shade, levels) {
    const scale = 1 << levels, cellPx = px / scale, adv = 13 * px; let cx = x;
    for (const ch of String(text).toUpperCase()) {
        const { bits, w, h } = _hdGlyph(ch, levels), shadeFrom = Math.floor(h * 5 / 7);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (bits[yy * w + xx]) {
            g.fillStyle = (shade && yy >= shadeFrom) ? shade : color;
            g.fillRect(cx + xx * cellPx, y + yy * cellPx, cellPx + 0.5, cellPx + 0.5);
        }
        cx += adv;
    }
}
// Canvas de texto pixel "premium" (para overlays DOM: GO!, cuenta atrás, títulos).
// Trazo bold + capas de contorno estilo cartel arcade: fill blanco con sombreado
// interno → tinta negra → halo verde brillante → halo verde oscuro. Opciones:
// fill/shade/ink/accent/dark (colores), plain (solo tinta, sin halos),
// thin (sin placa oscura gruesa, solo tinta + línea fina), glow (color de halo
// difuminado real detrás de las letras, estilo cartel de neón), glowBlur (radio),
// sparkles (cruces decorativas en el padding).
function pixFancyText(text, px, o = {}) {
    const fill = o.fill || '#fff', shade = o.shade || '#b9c2cc', ink = o.ink || '#000';
    const accent = o.accent || '#00ff88', dark = o.dark || '#0a4a2a';
    const layers = o.plain ? [[1, ink]] : o.thin ? [[2, accent], [1, ink]] : [[4, dark], [2, accent], [1, ink]];
    const glowBlur = o.glow ? (o.glowBlur || px * 3) : 0;
    const pad = (layers[0][0] + (o.sparkles ? 4 : 0) + Math.ceil(glowBlur / px)) * px;
    const cv = document.createElement('canvas');
    cv.width = pixTextWidth(text, px, true) + pad * 2; cv.height = 15 * px + pad * 2;
    const g = cv.getContext('2d');
    const draw = (gx, gy, col, sh) => { if (o.hd) _pixTextBlocksHD(g, text, gx, gy, px, col, sh, o.hd); else _pixTextBlocks(g, text, gx, gy, px, col, true, sh); };
    if (o.glow) {
        // silueta aparte para no ensuciar de blur el resto de capas (nítidas).
        const sil = document.createElement('canvas'); sil.width = cv.width; sil.height = cv.height;
        if (o.hd) _pixTextBlocksHD(sil.getContext('2d'), text, pad, pad, px, o.glow, false, o.hd); else _pixTextBlocks(sil.getContext('2d'), text, pad, pad, px, o.glow, true);
        g.save(); g.shadowColor = o.glow; g.shadowBlur = glowBlur; g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) g.drawImage(sil, 0, 0);
        g.restore();
    }
    for (const [d, col] of layers)
        for (let dx = -d; dx <= d; dx++) for (let dy = -d; dy <= d; dy++)
            draw(pad + dx * px, pad + dy * px, col);
    draw(pad, pad, fill, shade);
    if (o.sparkles) {
        g.fillStyle = accent;
        const sp = Math.max(2, Math.round(px * 0.75));
        const spots = [[0.10, 0.10], [0.46, 0.04], [0.88, 0.12], [0.16, 0.90], [0.74, 0.94]];
        for (let i = 0; i < Math.min(o.sparkles, spots.length); i++) {
            const sx = Math.round(cv.width * spots[i][0]), sy = Math.round(cv.height * spots[i][1]);
            g.fillRect(sx, sy - sp, sp, sp * 3); g.fillRect(sx - sp, sy, sp * 3, sp);
        }
    }
    cv.style.imageRendering = 'pixelated'; cv.style.display = 'block';
    return cv;
}

// ===== Render unificado con tipo de letra elegible =====
// o.font: 'atlas' (sprites PNG de font-hero), 'normal' (5×7 con contorno),
// 'bold' (11×15), 'boldhd' (Scale2x). Sin o.font = auto: atlas si TODAS las
// letras del texto tienen sprite, si no bold/boldhd según o.hd. Si se pide
// 'atlas' pero faltan letras, cae a bold (el llamador puede avisar con
// pixHeroMissing). px = tamaño en unidades de fuente (altura final ≈ px*15).
function pixResolveFont(text, o = {}) {
    const heroOk = (typeof pixHeroReady === 'function') && pixHeroReady(text);
    const f = o.font;
    if (f === 'atlas') return heroOk ? 'atlas' : (o.hd > 0 ? 'boldhd' : 'bold');
    if (f === 'normal' || f === 'bold' || f === 'boldhd') return f;
    return heroOk ? 'atlas' : (o.hd > 0 ? 'boldhd' : 'bold');
}
// Escala CONTINUA de un canvas de texto pixel (zoom fino): el px de la fuente
// es entero (1→2 dobla el tamaño); esto interpola entre medias escalando el
// canvas por CSS (image-rendering:pixelated ⇒ sigue nítido). Compartido por el
// juego y el laboratorio para que el preview y la partida escalen igual.
function pixApplyScale(cv, scale) {
    if (scale && scale !== 1) { cv.style.width = Math.round(cv.width * scale) + 'px'; cv.style.height = 'auto'; }
    return cv;
}
function pixRenderText(text, px, o = {}) {
    const font = pixResolveFont(text, o);
    if (font === 'atlas') {
        const ho = {};
        if (o.sparkles) ho.sparkles = o.sparkles;
        if (o.glow) { ho.glow = o.glow; if (o.glowBlur != null) ho.glowBlur = o.glowBlur; }
        return { cv: pixHeroText(text, Math.round(px * 15), ho), mode: 'atlas' };
    }
    if (font === 'normal') {
        const ipx = Math.max(1, Math.round(px));
        const w = pixTextWidth(text, ipx) + ipx * 2, h = 7 * ipx + ipx * 2;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        drawPixelText(cv.getContext('2d'), text, ipx, ipx, ipx, o.fill || '#fff', o.ink || '#000');
        cv.style.imageRendering = 'pixelated'; cv.style.display = 'block';
        return { cv, mode: 'normal 5×7' };
    }
    const po = Object.assign({}, o);
    po.hd = (font === 'boldhd') ? Math.max(1, po.hd | 0) : 0;
    return { cv: pixFancyText(text, Math.max(1, Math.round(px)), po), mode: po.hd ? 'bold HD' : 'bold' };
}
