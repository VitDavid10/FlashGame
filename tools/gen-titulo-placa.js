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
 * a una rejilla de 38 unidades de alto, que da resolucion de sobra para curvas
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
// CAP sube a 38 al engordar el trazo: con la caja de 34 un trazo de 10 dejaba
// los contadores (el hueco de la P, de la R, de la A) reducidos a una ranura.
// Es el reparto de las tipografias pesadas — trazo del 26% del alto y contador
// estrecho pero abierto.
const CAP = 38;          // alto de la mayuscula, en unidades de rejilla
const T = 10;            // grosor del trazo
const KERN = 3;          // hueco entre letras (el de la fuente vieja, que ya estaba bien)
const SOLAPE_MAX = 7;    // cuanto puede arrimar el kerning optico, como maximo
const MARGEN = 3;        // aire alrededor para el contorno y la sombra
// Lado del pixel final: el PNG sale a PX * rejilla. PX=2 da 80px de alto, que
// es la altura a la que se enseña el titulo — 1:1, sin reescalados raros.
// PX=2 da 88px de alto. PX=6 (variable de entorno) sirve para verlo de cerca:
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
// Sector con el vertice en (vx,vy), abierto en la direccion (dx,dy) y con
// semiangulo en grados. Restado a un anillo, abre la boca de la C o los ganchos
// de la S dejando las puntas en pico, en vez del corte a escuadra de una caja.
function cuna(px, py, vx, vy, dx, dy, gradosSemi) {
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const t = Math.tan(gradosSemi * Math.PI / 180);
    const avance = (px - vx) * dx + (py - vy) * dy;
    const desvio = Math.abs(-(px - vx) * dy + (py - vy) * dx);
    return Math.max(-avance, desvio - t * avance);
}
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
const R_GRANDE = 13, R_MEDIO = 9;
const GLIFOS = {
    'I': { w: T, d: (x, y) => sdCaja(x, y, 0, 0, T, CAP, [2, 2, 2, 2]) },
    'L': {
        w: 26, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [2, 2, 1, 3]),
            sdCaja(x, y, 0, CAP - T, 26, T, [1, 3, 3, 3]),
        ),
    },
    'E': {
        w: 26, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            sdCaja(x, y, 0, 0, 26, T, [3, 3, 2, 1]),
            sdCaja(x, y, 0, (CAP - T) / 2, 22, T, [1, 3, 3, 1]),
            sdCaja(x, y, 0, CAP - T, 26, T, [1, 2, 3, 3]),
        ),
    },
    // Bucle superior de esquinas muy redondeadas montado sobre el asta. Va alto
    // (29 de 38) a proposito: con el trazo a 10, es lo que deja el contador
    // abierto (11x9) en vez de convertido en una raja.
    'P': {
        w: 31, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            anillo(x, y, 0, 0, 31, 29, [3, R_GRANDE, R_GRANDE, 1], T),
        ),
    },
    'R': {
        w: 31, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            anillo(x, y, 0, 0, 31, 29, [3, R_GRANDE, R_GRANDE, 1], T),
            sdSeg(x, y, 13, 25, 26, CAP - T / 2, T / 2),
        ),
    },
    'D': {
        w: 32, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            anillo(x, y, 0, 0, 32, CAP, [3, R_GRANDE + 2, R_GRANDE + 2, 3], T),
        ),
    },
    // C = anillo completo al que se le abre la boca con una CUÑA, no con una
    // caja: la caja cortaba las dos puntas a escuadra y quedaban dos topes
    // romos, mientras el resto del alfabeto va de curvas. Con el vertice metido
    // en el hueco del anillo, las puntas salen en pico y siguiendo la curva.
    'C': {
        w: 32, d: (x, y) => quita(
            anillo(x, y, 0, 0, 32, CAP, [R_GRANDE, R_GRANDE, R_GRANDE, R_GRANDE], T),
            cuna(x, y, 16, CAP / 2, 1, 0, 26),
        ),
    },
    // S: dos medios anillos, cada uno sin el cuadrante que sobra. Aqui los
    // recortes son cajas y NO cuñas como en la C: los dos anillos se solapan por
    // el centro (es lo que forma el trazo diagonal), y una cuña desde el centro
    // de cada uno atraviesa esa zona compartida y parte el trazo de arriba.
    'S': {
        w: 30, d: (x, y) => {
            const alto = 23, medio = CAP - alto;
            const arriba = quita(
                anillo(x, y, 0, 0, 30, alto, [R_MEDIO + 2, R_MEDIO + 2, 2, 2], T),
                sdCaja(x, y, 30 - T, alto / 2, T, alto / 2, [0, 0, 0, 0]),
            );
            const abajo = quita(
                anillo(x, y, 0, medio, 30, alto, [2, 2, R_MEDIO + 2, R_MEDIO + 2], T),
                sdCaja(x, y, 0, medio, T, alto / 2, [0, 0, 0, 0]),
            );
            return une(arriba, abajo);
        },
    },
    // A de hombros: dos astas RECTAS unidas arriba por un arco, y travesaño.
    // Antes eran dos diagonales que convergian en un punto, o sea un triangulo
    // con una ranura — no se leia como letra y ademas no hablaba el mismo
    // idioma que la P, la R o la D, que van de arcos. Con el vertice abierto
    // aparece un contador de verdad (12x10) en vez de la rendija de antes.
    'A': {
        w: 32, d: (x, y) => {
            const AR = 15;          // radio del hombro
            const arco = quita(
                anillo(x, y, 0, 0, 32, 2 * AR, [AR, AR, AR, AR], T),
                sdCaja(x, y, -2, AR, 36, 2 * AR, [0, 0, 0, 0]),   // se queda solo la mitad de arriba
            );
            return une(
                arco,
                sdCaja(x, y, 0, AR - 1, T, CAP - AR + 1, [0, 0, 1, 3]),
                sdCaja(x, y, 32 - T, AR - 1, T, CAP - AR + 1, [0, 0, 3, 1]),
                // El travesaño a 22 y no mas abajo: pegado al pie dejaba unas
                // patas de 4 unidades y la letra tiraba a O con una barra.
                sdCaja(x, y, 0, 22, 32, T - 1, [1, 1, 1, 1]),
            );
        },
    },
    'W': {
        w: 48, d: (x, y) => une(
            sdSeg(x, y, 5, T / 2, 13, CAP - T / 2, T / 2),
            sdSeg(x, y, 13, CAP - T / 2, 24, 15, T / 2),
            sdSeg(x, y, 24, 15, 35, CAP - T / 2, T / 2),
            sdSeg(x, y, 35, CAP - T / 2, 43, T / 2, T / 2),
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

// Silueta lateral de un glifo: para cada fila, hasta donde llega por la derecha
// y desde donde empieza por la izquierda. Es lo que permite ajustar el hueco
// entre dos letras por su FORMA y no por su caja.
const _perfilCache = new Map();
function perfil(ch, glifo) {
    let p = _perfilCache.get(ch);
    if (p) return p;
    const H = CAP + 2, W = Math.ceil(glifo.w) + 2;
    const der = new Float64Array(H).fill(-Infinity), izq = new Float64Array(H).fill(Infinity);
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        const x = gx - 1 + 0.5, y = gy - 1 + 0.5;
        if (glifo.d(x, y) > 0) continue;
        if (x > der[gy]) der[gy] = x;
        if (x < izq[gy]) izq[gy] = x;
    }
    p = { der, izq, H };
    _perfilCache.set(ch, p);
    return p;
}

function distanciaTexto(texto) {
    const chars = [...texto.toUpperCase()];
    const glifos = chars.map(ch => {
        const g = GLIFOS[ch];
        if (!g) throw new Error('Falta el glifo "' + ch + '" en GLIFOS');
        return g;
    });
    // Kerning OPTICO: cada letra se arrima a la anterior hasta que el hueco mas
    // estrecho entre sus siluetas vale KERN. Con un avance fijo (caja + KERN),
    // las letras de lados rectos quedaban bien pero las abiertas se veian
    // sueltas: la W, que se estrecha por abajo, dejaba un agujero contra las LL
    // de PILLWARS aunque sus cajas se tocasen. Solo puede ACERCAR — el avance
    // normal sigue siendo el tope, para que dos letras rectas no se separen.
    const offs = [0];
    for (let i = 1; i < glifos.length; i++) {
        const tope = offs[i - 1] + glifos[i - 1].w + KERN;
        const a = perfil(chars[i - 1], glifos[i - 1]), b = perfil(chars[i], glifos[i]);
        let solape = -Infinity;
        for (let y = 0; y < a.H; y++) {
            if (a.der[y] === -Infinity || b.izq[y] === Infinity) continue;
            const v = a.der[y] - b.izq[y];
            if (v > solape) solape = v;
        }
        // SOLAPE_MAX: el hueco minimo garantizado es KERN, pero eso solo mira la
        // fila mas estrecha. Dos letras curvas que encajan (las SS de CLASSIC)
        // cumplen el minimo en un punto y quedan pegadas en todo lo demas, asi
        // que ademas se limita cuanto puede comerse del avance normal.
        const cerca = solape === -Infinity ? tope : offs[i - 1] + solape + KERN + 1;
        offs.push(Math.min(tope, Math.max(cerca, tope - SOLAPE_MAX)));
    }
    const ancho = offs[offs.length - 1] + glifos[glifos.length - 1].w;
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
