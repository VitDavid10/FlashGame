/*
 * Atlas de letras "hero" para carteles grandes (GO!, contador). Cada glifo es
 * un PNG dibujado/generado a mano en game/img/font-hero/<CARACTER>.png (ver
 * LEEME.txt en esa carpeta). Mientras falte una letra, pixHeroReady() devuelve
 * false para ese texto y el llamador debe usar el fallback procedural de
 * pixfont.js (pixFancyText) — así el juego nunca depende de que el atlas esté
 * completo.
 */
'use strict';

const HERO_CANDIDATES = ['0','1','2','3','4','5','6','7','8','9','G','O','!'];
const _heroImg = new Map(); // char -> HTMLImageElement (solo si cargó bien)

const HERO_READY_PROMISE = Promise.all(HERO_CANDIDATES.map(ch => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { _heroImg.set(ch, img); resolve(); };
    img.onerror = () => resolve();
    img.src = 'img/font-hero/' + ch + '.png';
})));

function pixHeroMissing(text) {
    const seen = new Set(), missing = [];
    for (const ch of String(text).toUpperCase()) {
        if (ch === ' ' || seen.has(ch)) continue; seen.add(ch);
        if (!_heroImg.has(ch)) missing.push(ch);
    }
    return missing;
}
function pixHeroReady(text) { return pixHeroMissing(text).length === 0; }

// Dibuja el texto con las imágenes del atlas (glifos ausentes = hueco del
// ancho de un espacio, para no romper la composición mientras el atlas está
// incompleto). Mismo estilo de opciones que pixFancyText: glow/glowBlur,
// sparkles. targetH = altura en px a la que se escala cada glifo (conserva
// su proporción original, sin suavizado).
function pixHeroText(text, targetH, o = {}) {
    const chars = String(text).toUpperCase().split('');
    const gap = Math.round(targetH * 0.14), spaceW = Math.round(targetH * 0.5);
    const glyphs = chars.map(ch => (ch === ' ' ? null : _heroImg.get(ch) || null));
    let contentW = 0;
    for (const img of glyphs) contentW += (img ? Math.round(img.naturalWidth / img.naturalHeight * targetH) : spaceW) + gap;
    contentW = Math.max(0, contentW - gap);

    const glowBlur = o.glow ? (o.glowBlur || targetH * 0.3) : 0;
    const pad = (o.sparkles ? Math.round(targetH * 0.3) : 0) + Math.ceil(glowBlur);
    const cv = document.createElement('canvas');
    cv.width = contentW + pad * 2; cv.height = targetH + pad * 2;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;

    const drawRow = (ctx2, tint) => {
        let cx = pad;
        for (const img of glyphs) {
            if (!img) { cx += spaceW + gap; continue; }
            const w = Math.round(img.naturalWidth / img.naturalHeight * targetH);
            if (tint) {
                const t = document.createElement('canvas'); t.width = w; t.height = targetH;
                const tg = t.getContext('2d'); tg.imageSmoothingEnabled = false;
                tg.drawImage(img, 0, 0, w, targetH);
                tg.globalCompositeOperation = 'source-in'; tg.fillStyle = tint; tg.fillRect(0, 0, w, targetH);
                ctx2.drawImage(t, cx, pad);
            } else ctx2.drawImage(img, cx, pad, w, targetH);
            cx += w + gap;
        }
    };
    if (o.glow) {
        const sil = document.createElement('canvas'); sil.width = cv.width; sil.height = cv.height;
        drawRow(sil.getContext('2d'), o.glow);
        g.save(); g.shadowColor = o.glow; g.shadowBlur = glowBlur; g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) g.drawImage(sil, 0, 0);
        g.restore();
    }
    drawRow(g, null);
    if (o.sparkles) {
        g.fillStyle = o.glow || '#00ff88';
        const sp = Math.max(2, Math.round(targetH * 0.05));
        const spots = [[0.10, 0.10], [0.46, 0.04], [0.88, 0.12], [0.16, 0.90], [0.74, 0.94]];
        for (let i = 0; i < Math.min(o.sparkles, spots.length); i++) {
            const sx = Math.round(cv.width * spots[i][0]), sy = Math.round(cv.height * spots[i][1]);
            g.fillRect(sx, sy - sp, sp, sp * 3); g.fillRect(sx - sp, sy, sp * 3, sp);
        }
    }
    cv.style.imageRendering = 'pixelated'; cv.style.display = 'block';
    return cv;
}
