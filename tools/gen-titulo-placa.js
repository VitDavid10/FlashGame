/*
 * Genera los PNG del titulo del login (PILLWARS + ARCADE/CLASSIC).
 *
 *   node tools/gen-titulo-placa.js
 *
 * Escribe en game/img/mode-title/*-placa.png. Los PNG originales de David NO
 * se tocan: el codigo elige unos u otros (ver tituloPlaca() en game/index.html).
 *
 * ===== Como se dibujan las letras =====
 * NO se usa la PIXFONT 5x7 del juego: a ese tamaño la P es un cuadrado con un
 * agujero y no hay sitio para una sola curva. Cada glifo se define aqui como
 * GEOMETRIA (astas, cajas de esquinas redondeadas y segmentos) y se rasteriza
 * a una rejilla de 34 unidades de alto, que da resolucion de sobra para curvas
 * de verdad.
 *
 * La forma se describe con una funcion de distancia: para cada punto se sabe
 * cuanto falta para el borde de la letra (negativo dentro, positivo fuera). De
 * ahi salen tres cosas a la vez:
 *   - la silueta (dentro = distancia negativa),
 *   - el contorno (la franja de fuera pegada al borde),
 *   - y el volumen: con el gradiente de esa distancia se tiene la NORMAL del
 *     borde en cada pixel, se compara con la direccion de la luz y se elige
 *     tono. Es la misma iluminacion que usa el marco de la placa
 *     (placaPixels en game/index.html), aplicada a las letras y siguiendo las
 *     curvas en vez de solo los lados rectos.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DESTINO = process.env.DEST || path.join(RAIZ, 'game', 'img', 'mode-title');

// ===== Metrica =====
const CAP = 34;          // alto de la mayuscula, en unidades de rejilla
const T = 7;             // grosor del trazo
const KERN = 3;          // hueco entre letras (el de la fuente vieja, que ya estaba bien)
const MARGEN = 3;        // aire alrededor para el contorno y la sombra
// Lado del pixel final: el PNG sale a PX * rejilla. PX=2 da 80px de alto, que
// es la altura a la que se enseña el titulo — 1:1, sin reescalados raros.
// PX=6 (variable de entorno) sirve para mirar el dibujo de cerca:
//   PX=6 DEST=/tmp node tools/gen-titulo-placa.js
const PX = Number(process.env.PX) || 2;

// ===== Distancias =====
// Caja con un radio por esquina: [arriba-izq, arriba-der, abajo-der, abajo-izq].
function sdCaja(px, py, x, y, w, h, r) {
    const cx = x + w / 2, cy = y + h / 2, bx = w / 2, by = h / 2;
    const qx = px - cx, qy = py - cy;
    let rr = (qx > 0) ? (qy < 0 ? r[1] : r[2]) : (qy < 0 ? r[0] : r[3]);
    rr = Math.min(rr, Math.min(bx, by));
    const dx = Math.abs(qx) - bx + rr, dy = Math.abs(qy) - by + rr;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rr;
}
// Trazo recto de punta redondeada (para diagonales: A, W, R, X...).
function sdSeg(px, py, x0, y0, x1, y1, r) {
    const vx = x1 - x0, vy = y1 - y0, wx = px - x0, wy = py - y0;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(wx - t * vx, wy - t * vy) - r;
}
const une = (...d) => Math.min(...d);
const quita = (d, hueco) => Math.max(d, -hueco);
// Anillo: caja hueca. El hueco lleva los mismos radios encogidos, asi el trazo
// mantiene el grosor tambien en las curvas.
function anillo(px, py, x, y, w, h, r, g) {
    const ri = r.map(v => Math.max(1, v - g * 0.85));
    return quita(sdCaja(px, py, x, y, w, h, r), sdCaja(px, py, x + g, y + g, w - 2 * g, h - 2 * g, ri));
}

// ===== Glifos =====
// Cada uno: ancho en unidades y su funcion de distancia. Los radios grandes en
// las esquinas exteriores son lo que da la curva; los pequeños (1-2) mantienen
// rectos los cantos que deben serlo (el pie de la P contra su asta, p.ej.).
const R_GRANDE = 11, R_MEDIO = 7;
const GLIFOS = {
    'I': { w: T, d: (x, y) => sdCaja(x, y, 0, 0, T, CAP, [2, 2, 2, 2]) },
    'L': {
        w: 22, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [2, 2, 1, 3]),
            sdCaja(x, y, 0, CAP - T, 22, T, [1, 3, 3, 3]),
        ),
    },
    'E': {
        w: 22, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            sdCaja(x, y, 0, 0, 22, T, [3, 3, 2, 1]),
            sdCaja(x, y, 0, (CAP - T) / 2, 19, T, [1, 3, 3, 1]),
            sdCaja(x, y, 0, CAP - T, 22, T, [1, 2, 3, 3]),
        ),
    },
    // Bucle superior de esquinas muy redondeadas montado sobre el asta. El
    // bucle es alto (23 de 34) para que el contador quede redondo y no una
    // ranura: con el trazo a 7, deja un hueco de 12x9.
    'P': {
        w: 26, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            anillo(x, y, 0, 0, 26, 23, [3, R_GRANDE, R_GRANDE, 1], T),
        ),
    },
    'R': {
        w: 26, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            anillo(x, y, 0, 0, 26, 23, [3, R_GRANDE, R_GRANDE, 1], T),
            sdSeg(x, y, 11, 20, 22, CAP - T / 2, T / 2),
        ),
    },
    'D': {
        w: 27, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            anillo(x, y, 0, 0, 27, CAP, [3, R_GRANDE + 2, R_GRANDE + 2, 3], T),
        ),
    },
    // C = anillo completo al que se le quita la boca de la derecha. El recorte
    // se queda DENTRO del ancho del glifo: si sobresale, el borde del recorte
    // cae donde ya no hay letra y aparece un canto suelto.
    'C': {
        w: 27, d: (x, y) => quita(
            anillo(x, y, 0, 0, 27, CAP, [R_GRANDE, R_GRANDE, R_GRANDE, R_GRANDE], T),
            sdCaja(x, y, 15, 8, 12, CAP - 16, [0, 0, 0, 0]),
        ),
    },
    // S: dos medios anillos, cada uno sin el cuadrante que sobra. Los recortes
    // son cajas rectas por el mismo motivo que en la C.
    'S': {
        w: 25, d: (x, y) => {
            const alto = 20, medio = CAP - alto;
            const arriba = quita(
                anillo(x, y, 0, 0, 25, alto, [R_MEDIO + 2, R_MEDIO + 2, 2, 2], T),
                sdCaja(x, y, 25 - T, alto / 2, T, alto / 2, [0, 0, 0, 0]),
            );
            const abajo = quita(
                anillo(x, y, 0, medio, 25, alto, [2, 2, R_MEDIO + 2, R_MEDIO + 2], T),
                sdCaja(x, y, 0, medio, T, alto / 2, [0, 0, 0, 0]),
            );
            return une(arriba, abajo);
        },
    },
    // Travesaño bajo y contador amplio: con el travesaño alto la A se cerraba
    // casi del todo.
    'A': {
        w: 28, d: (x, y) => une(
            sdSeg(x, y, 14, T / 2, 4, CAP - T / 2, T / 2),
            sdSeg(x, y, 14, T / 2, 24, CAP - T / 2, T / 2),
            sdCaja(x, y, 7, 24, 14, T - 1, [1, 1, 1, 1]),
        ),
    },
    'W': {
        w: 40, d: (x, y) => une(
            sdSeg(x, y, 4, T / 2, 11, CAP - T / 2, T / 2),
            sdSeg(x, y, 11, CAP - T / 2, 20, 13, T / 2),
            sdSeg(x, y, 20, 13, 29, CAP - T / 2, T / 2),
            sdSeg(x, y, 29, CAP - T / 2, 36, T / 2, T / 2),
        ),
    },
};

// ===== Rasterizado con volumen =====
// Tonos como factor sobre el color del modo. Mismo reparto que PLACA.TONOS:
// contorno oscuro que recorta la silueta contra el fondo, bisel claro por donde
// entra la luz, sombra por el lado opuesto y cuerpo macizo en medio.
// La CARA de la letra va clara (cuerpo/base) y solo el canto de abajo-derecha
// se va a sombra: al reves — cara oscura con los bordes encendidos — la letra
// se leia como un tubo hueco en vez de como una pieza maciza.
const TONOS = { ink: 0.12, luz: 1, luzSuave: 0.86, cuerpo: 0.70, base: 0.58, sombra: 0.26 };
// Luz arriba-izquierda, la misma que el sprite de la pildora y el marco.
const LX = -0.55, LY = -0.83;
const BISEL = 3;     // grosor de la banda biselada, en unidades
const INK = 1.6;     // grosor del contorno

function distanciaTexto(texto) {
    const glifos = [...texto.toUpperCase()].map(ch => {
        const g = GLIFOS[ch];
        if (!g) throw new Error('Falta el glifo "' + ch + '" en GLIFOS');
        return g;
    });
    const ancho = glifos.reduce((a, g) => a + g.w, 0) + KERN * (glifos.length - 1);
    // Desplazamiento acumulado de cada glifo.
    const offs = [];
    let cx = 0;
    for (const g of glifos) { offs.push(cx); cx += g.w + KERN; }
    const d = (x, y) => {
        let m = 1e9;
        for (let i = 0; i < glifos.length; i++) {
            const gx = x - offs[i];
            // Solo el glifo que cae cerca: sin esto cada pixel evalua el texto
            // entero y el coste se dispara con palabras largas.
            if (gx < -4 || gx > glifos[i].w + 4) continue;
            const v = glifos[i].d(gx, y);
            if (v < m) m = v;
        }
        return m;
    };
    return { d, ancho };
}

// Profundidad de cada celda dentro de la letra, medida sobre la MASCARA ya
// rasterizada y no sobre la funcion de distancia. Las restas (la boca de la C,
// los cuadrantes de la S) hacen que esa funcion deje de valer como distancia
// real, y sombrear con ella dejaba cantos sueltos donde el recorte pasaba por
// fuera del trazo. Con la mascara eso no puede pasar: lo que se ve es lo que se
// mide. Busqueda a fuerza bruta en un radio corto — la rejilla es diminuta.
function campoProfundidad(masc, W, H, radio) {
    const prof = new Float32Array(W * H);
    const dentro = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : masc[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        // Fuera de la letra la profundidad es negativa: -distancia al borde.
        // Sirve para el contorno con el mismo campo.
        let mejor = radio + 1;
        const soy = masc[i];
        for (let oy = -radio; oy <= radio; oy++) for (let ox = -radio; ox <= radio; ox++) {
            if (dentro(x + ox, y + oy) === soy) continue;
            const d = Math.hypot(ox, oy);
            if (d < mejor) mejor = d;
        }
        prof[i] = soy ? mejor : -mejor;
    }
    return prof;
}

function rasterizar(texto, hex) {
    const { d, ancho } = distanciaTexto(texto);
    const W = Math.ceil(ancho) + 2 * MARGEN, H = CAP + 2 * MARGEN;
    const base = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tono = f => base.map(v => Math.min(255, Math.round(v * f)));
    const COL = {
        ink: tono(TONOS.ink), luz: tono(TONOS.luz), luzSuave: tono(TONOS.luzSuave),
        cuerpo: tono(TONOS.cuerpo), sombra: tono(TONOS.sombra), base: tono(TONOS.base),
    };
    // Mascara con supermuestreo 3x3: la celda se enciende si la geometria cubre
    // al menos la mitad. Es lo que hace que las curvas caigan donde deben en vez
    // de depender de un unico punto en el centro.
    const masc = new Uint8Array(W * H);
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        let cubierto = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
            const x = gx - MARGEN + (sx + 0.5) / 3, y = gy - MARGEN + (sy + 0.5) / 3;
            if (d(x, y) <= 0) cubierto++;
        }
        masc[gy * W + gx] = cubierto >= 5 ? 1 : 0;
    }
    const prof = campoProfundidad(masc, W, H, Math.ceil(BISEL * 2) + 1);
    const en = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -99 : prof[y * W + x];

    const rgba = Buffer.alloc(W * H * PX * PX * 4);
    const pw = W * PX;
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        const p = prof[gy * W + gx];
        let col = null;
        if (p <= 0) {                                  // fuera
            if (p > -INK - 0.001) col = COL.ink;       // ...pero pegado al borde
        } else if (p < BISEL) {
            // Normal del borde: gradiente del campo de profundidad, que crece
            // hacia dentro — se invierte para que apunte hacia fuera. Al salir
            // de la mascara sigue las curvas, no solo los lados rectos. Se mide
            // a 2 celdas y no a 1: en las diagonales (W, A) el gradiente corto
            // saltaba de una celda a la siguiente y el bisel salia moteado.
            let nx = en(gx - 2, gy) - en(gx + 2, gy), ny = en(gx, gy - 2) - en(gx, gy + 2);
            const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
            const ndl = nx * LX + ny * LY;
            col = ndl > 0.35 ? COL.luz : ndl > -0.1 ? COL.luzSuave : ndl < -0.55 ? COL.sombra : COL.base;
        } else col = p < BISEL * 2 ? COL.cuerpo : COL.base;
        if (!col) continue;
        for (let sy = 0; sy < PX; sy++) for (let sx = 0; sx < PX; sx++) {
            const i = ((gy * PX + sy) * pw + gx * PX + sx) * 4;
            rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255;
        }
    }
    return { rgba, w: pw, h: H * PX };
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
    const raw = Buffer.alloc((w * 4 + 1) * h);   // filtro 0 (None) por fila
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

// Los cuatro salen con el MISMO alto, asi que puestos a la misma altura CSS las
// letras miden igual en PILLWARS y en ARCADE/CLASSIC. Solo cambia el ancho, que
// es lo que obliga a centrar cada modo por separado (lo hace centrarTitulo()).
const TRABAJOS = [
    ['PILLWARS-arcade-placa.png',  'PILLWARS', '#ccff00'],
    ['PILLWARS-classic-placa.png', 'PILLWARS', '#00ffaa'],
    ['ARCADE-word-placa.png',      'ARCADE',   '#ccff00'],
    ['CLASSIC-word-placa.png',     'CLASSIC',  '#00ffaa'],
];

for (const [nombre, texto, hex] of TRABAJOS) {
    const { rgba, w, h } = rasterizar(texto, hex);
    const buf = png(w, h, rgba);
    fs.writeFileSync(path.join(DESTINO, nombre), buf);
    console.log(nombre.padEnd(30), w + 'x' + h, '(' + buf.length + ' bytes)');
}
