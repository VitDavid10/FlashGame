/*
 * Genera los PNG del titulo del login (PILLWARS + ARCADE/CLASSIC) con la
 * PIXFONT del juego y el material de la placa: cuerpo del color del modo,
 * las dos filas de abajo en sombra y contorno duro oscuro. Nada de degradados
 * ni halo difuminado — eso es lo que traian horneado los PNG anteriores y lo
 * que hacia que el rotulo no pegase con el resto del menu.
 *
 *   node tools/gen-titulo-placa.js
 *
 * Escribe en game/img/mode-title/*-placa.png. Los PNG originales de David NO
 * se tocan: el codigo elige unos u otros (ver TITULO_PLACA en game/index.html).
 *
 * El alfabeto sale de game/pixfont.js, asi que si cambia la fuente basta con
 * volver a lanzar esto.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'game', 'img', 'mode-title');

// PIXFONT vive en un script plano (sin exports, se comparte por <script>).
// Se evalua tal cual y se recoge la constante.
const PIXFONT = (function () {
    const src = fs.readFileSync(path.join(RAIZ, 'game', 'pixfont.js'), 'utf8');
    return new Function(src + '\nreturn PIXFONT;')();
})();

// ===== Rejilla de unidades de fuente =====
// Glifo bold: cada pixel del 5x7 se dibuja como un bloque 3x3 en una rejilla
// doble, asi que el glifo mide 11x15 y el avance entre letras es 13 (2 de
// hueco). Ese hueco es el que limita el grosor del contorno: con mas de 1
// unidad las letras se tocan y con 4 se funden en un bloque macizo.
const ALTO = 15, AVANCE = 13, BORDE = 1;
const T_INK = 1, T_FILL = 2, T_SHADE = 3;

function anchoTexto(text) { return AVANCE * text.length - 2; }

// Marca en la rejilla los bloques del texto desplazado (dx, dy).
function marca(rej, W, text, dx, dy, tono, conSombra) {
    let cx = 0;
    for (const ch of text.toUpperCase()) {
        const rows = PIXFONT[ch];
        if (rows) for (let r = 0; r < 7; r++) {
            // Sombreado interno: las dos filas de abajo del glifo, igual que
            // hace _pixTextBlocks con su parametro shade.
            const t = (conSombra && r >= 5) ? T_SHADE : tono;
            for (let c = 0; c < 5; c++) {
                if (!(rows[r] & (1 << (4 - c)))) continue;
                for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
                    const x = cx + 2 * c + xx + dx, y = 2 * r + yy + dy;
                    if (x >= 0 && y >= 0 && x < W && y < ALTO + 2 * BORDE) rej[y * W + x] = t;
                }
            }
        }
        cx += AVANCE;
    }
}

function rejillaTexto(text) {
    const W = anchoTexto(text) + 2 * BORDE, H = ALTO + 2 * BORDE;
    const rej = new Uint8Array(W * H);
    // Contorno: el texto en las 8 direcciones, y encima el relleno.
    for (let dy = -BORDE; dy <= BORDE; dy++) for (let dx = -BORDE; dx <= BORDE; dx++)
        marca(rej, W, text, BORDE + dx, BORDE + dy, T_INK, false);
    marca(rej, W, text, BORDE, BORDE, T_FILL, true);
    return { rej, W, H };
}

// ===== PNG RGBA sin dependencias =====
const _CRC = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = _CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}
function chunk(tipo, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([len, cuerpo, crc]);
}
function png(w, h, rgba) {
    // Filtro 0 (None) en cada fila: el dibujo son bloques planos, comprime igual.
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6;   // 8 bits por canal, RGBA
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ===== Render =====
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// Mismos factores que TITULO.TONOS en game/index.html.
const TONOS = { fill: 1, shade: 0.55, ink: 0.14 };

function generar(text, hex, px) {
    const { rej, W, H } = rejillaTexto(text);
    const base = hex2rgb(hex);
    const tono = f => base.map(v => Math.min(255, Math.round(v * f)));
    const col = { [T_FILL]: tono(TONOS.fill), [T_SHADE]: tono(TONOS.shade), [T_INK]: tono(TONOS.ink) };
    const w = W * px, h = H * px;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = rej[((y / px) | 0) * W + ((x / px) | 0)];
        if (!t) continue;               // transparente
        const c = col[t], i = (y * w + x) * 4;
        rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
    }
    return { buf: png(w, h, rgba), w, h };
}

// PX por rotulo elegido para que la proporcion ancho/alto quede casi igual que
// la de los PNG de David (PILLWARS-arcade 880x138, ARCADE-word 800x161): asi
// las <img> con su height fijo salen del mismo tamaño y en el mismo sitio, y
// el ajuste guardado en EDIT LAYOUT sigue valiendo.
const TRABAJOS = [
    ['PILLWARS-arcade-placa.png',  'PILLWARS', '#ccff00', 8],
    ['PILLWARS-classic-placa.png', 'PILLWARS', '#00ffaa', 8],
    ['ARCADE-word-placa.png',      'ARCADE',   '#ccff00', 9],
    ['CLASSIC-word-placa.png',     'CLASSIC',  '#00ffaa', 9],
];

for (const [nombre, texto, hex, px] of TRABAJOS) {
    const { buf, w, h } = generar(texto, hex, px);
    fs.writeFileSync(path.join(DESTINO, nombre), buf);
    console.log(nombre.padEnd(30), w + 'x' + h, '(' + buf.length + ' bytes)');
}
