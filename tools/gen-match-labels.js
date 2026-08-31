/*
 * Genera los PNG de MATCH STARTING / MATCH ENDING y los digitos 1-5 del
 * contador, con la MISMA fuente vectorial (SDF) que PILLWARS/ARCADE/CLASSIC
 * del login (ver tools/gen-titulo-placa.js), en los dos colores de modo
 * (arcade #ccff00, classic #00ffaa) - los mismos hex que usa el resto del
 * juego para distinguir modo (ver `currentGameMode === 'classic' ? ...` en
 * game/index.html).
 *
 *   node tools/gen-match-labels.js
 *
 * Escribe en game/img/cartel-hero/*.png. El motor (SDF + bisel) es una copia
 * del de gen-titulo-placa.js: se duplica en vez de compartir modulo porque
 * ese script es standalone y no exporta nada.
 *
 * Glifos nuevos sobre los de gen-titulo-placa.js: M, T, H, N, G y los digitos
 * 1-5 (ese script solo tenia letras de PILLWARS/ARCADE/CLASSIC). El espacio
 * (' ') se trata aparte: hueco sin dibujo.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DESTINO = process.env.DEST || path.join(RAIZ, 'game', 'img', 'cartel-hero');

const CAP = 38, T = 10, KERN = 3, SOLAPE_MAX = 7, MARGEN = 3;
const PX = Number(process.env.PX) || 2;
const R_GRANDE = 13, R_MEDIO = 9;

function sdCaja(px, py, x, y, w, h, r) {
    const cx = x + w / 2, cy = y + h / 2, bx = w / 2, by = h / 2;
    const qx = px - cx, qy = py - cy;
    let rr = (qx > 0) ? (qy < 0 ? r[1] : r[2]) : (qy < 0 ? r[0] : r[3]);
    rr = Math.min(rr, Math.min(bx, by));
    const dx = Math.abs(qx) - bx + rr, dy = Math.abs(qy) - by + rr;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rr;
}
function sdSeg(px, py, x0, y0, x1, y1, r) {
    const vx = x1 - x0, vy = y1 - y0, wx = px - x0, wy = py - y0;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(wx - t * vx, wy - t * vy) - r;
}
function sdElipse(px, py, cx, cy, rx, ry) {
    const x = px - cx, y = py - cy;
    const F = (x * x) / (rx * rx) + (y * y) / (ry * ry) - 1;
    const g = Math.hypot(2 * x / (rx * rx), 2 * y / (ry * ry)) || 1e-6;
    return F / g;
}
function anilloElipse(px, py, cx, cy, rx, ry, grosor) {
    return Math.abs(sdElipse(px, py, cx, cy, rx, ry)) - grosor / 2;
}
const une = (...d) => Math.min(...d);
const quita = (d, hueco) => Math.max(d, -hueco);
function cuna(px, py, vx, vy, dx, dy, gradosSemi) {
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const t = Math.tan(gradosSemi * Math.PI / 180);
    const avance = (px - vx) * dx + (py - vy) * dy;
    const desvio = Math.abs(-(px - vx) * dy + (py - vy) * dx);
    return Math.max(-avance, desvio - t * avance);
}
function anillo(px, py, x, y, w, h, r, g) {
    const ri = r.map(v => Math.max(1, v - g * 0.85));
    return quita(sdCaja(px, py, x, y, w, h, r), sdCaja(px, py, x + g, y + g, w - 2 * g, h - 2 * g, ri));
}

// ===== Glifos: letras de MATCH/STARTING/ENDING + digitos del contador =====
const GLIFOS = {
    'I': { w: T, d: (x, y) => sdCaja(x, y, 0, 0, T, CAP, [2, 2, 2, 2]) },
    'E': {
        w: 26, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [3, 1, 1, 3]),
            sdCaja(x, y, 0, 0, 26, T, [3, 3, 2, 1]),
            sdCaja(x, y, 0, (CAP - T) / 2, 22, T, [1, 3, 3, 1]),
            sdCaja(x, y, 0, CAP - T, 26, T, [1, 2, 3, 3]),
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
    'C': {
        w: 32, d: (x, y) => quita(
            anillo(x, y, 0, 0, 32, CAP, [R_GRANDE, R_GRANDE, R_GRANDE, R_GRANDE], T),
            cuna(x, y, 16, CAP / 2, 1, 0, 26),
        ),
    },
    'S': {
        w: 30, d: (x, y) => {
            const rx = (30 - T) / 2, ry = 6;
            const cyA = ry + T / 2, cyB = CAP - ry - T / 2;
            const arriba = quita(anilloElipse(x, y, rx + T / 2, cyA, rx, ry, T), cuna(x, y, rx + T / 2, cyA, 1, 1, 45));
            const abajo = quita(anilloElipse(x, y, rx + T / 2, cyB, rx, ry, T), cuna(x, y, rx + T / 2, cyB, -1, -1, 45));
            return une(arriba, abajo);
        },
    },
    'A': {
        w: 32, d: (x, y) => {
            const AR = 15;
            const arco = quita(
                anillo(x, y, 0, 0, 32, 2 * AR, [AR, AR, AR, AR], T),
                sdCaja(x, y, -2, AR, 36, 2 * AR, [0, 0, 0, 0]),
            );
            return une(
                arco,
                sdCaja(x, y, 0, AR - 1, T, CAP - AR + 1, [0, 0, 1, 3]),
                sdCaja(x, y, 32 - T, AR - 1, T, CAP - AR + 1, [0, 0, 3, 1]),
                sdCaja(x, y, 0, 22, 32, T - 1, [1, 1, 1, 1]),
            );
        },
    },
    // ---- Nuevas para MATCH / STARTING / ENDING ----
    'M': {
        // Los extremos de sdSeg son capsulas (redondeadas): un extremo puesto
        // justo en y=0 asoma por encima del borde del glifo (el radio del
        // trazo, ~4.5, se le suma hacia arriba) y la M salia mas alta que el
        // resto de letras. Se entra el extremo RDIAG hacia dentro para que el
        // redondeo toque el borde en vez de pasarse.
        w: 38, d: (x, y) => {
            const RDIAG = T / 2 * 0.9;
            return une(
                sdCaja(x, y, 0, 0, T, CAP, [2, 2, 1, 1]),
                sdCaja(x, y, 38 - T, 0, T, CAP, [2, 2, 1, 1]),
                sdSeg(x, y, T / 2, RDIAG, 19, 20, RDIAG),
                sdSeg(x, y, 19, 20, 38 - T / 2, RDIAG, RDIAG),
            );
        },
    },
    'T': {
        w: 28, d: (x, y) => une(
            sdCaja(x, y, 0, 0, 28, T, [2, 2, 2, 2]),
            sdCaja(x, y, (28 - T) / 2, 0, T, CAP, [0, 0, 2, 2]),
        ),
    },
    'H': {
        w: 34, d: (x, y) => une(
            sdCaja(x, y, 0, 0, T, CAP, [2, 2, 1, 1]),
            sdCaja(x, y, 34 - T, 0, T, CAP, [2, 2, 1, 1]),
            sdCaja(x, y, 0, (CAP - T) / 2, 34, T, [1, 1, 1, 1]),
        ),
    },
    'N': {
        // Mismo ajuste que la M: el extremo del trazo diagonal se entra RDIAG
        // hacia dentro en vez de tocar y=0/CAP, para que el redondeo no asome.
        w: 32, d: (x, y) => {
            const RDIAG = T / 2 * 0.9;
            return une(
                sdCaja(x, y, 0, 0, T, CAP, [2, 2, 1, 1]),
                sdCaja(x, y, 32 - T, 0, T, CAP, [2, 2, 1, 1]),
                sdSeg(x, y, T / 2, RDIAG, 32 - T / 2, CAP - RDIAG, RDIAG),
            );
        },
    },
    // Anillo (como la C) con la boca mas cerrada y una barra+espiga que entra
    // por esa boca, un poco por debajo del centro (asi lee como G y no como
    // una C con un palito suelto en medio).
    'G': {
        w: 32, d: (x, y) => {
            const barY = CAP / 2 + 3;
            return une(
                quita(
                    anillo(x, y, 0, 0, 32, CAP, [R_GRANDE, R_GRANDE, R_GRANDE, R_GRANDE], T),
                    cuna(x, y, 15, CAP / 2, 1, 0, 20),
                ),
                sdCaja(x, y, 15, barY - T / 2, 17, T, [0, 1, 1, 0]),
                sdCaja(x, y, 32 - T, barY - T / 2, T, CAP - (barY - T / 2) - 6, [0, 0, 2, 2]),
            );
        },
    },
    // ---- Digitos del contador ----
    '1': {
        // Vastago + bandera diagonal + base ancha. El extremo de la bandera
        // acababa justo en el borde del vastago (stemX) y dejaba una cuna sin
        // pintar en la esquina (el redondeo de la capsula no llega a la
        // esquina cuadrada): se meten 3 unidades DENTRO del vastago para que
        // se solapen de verdad.
        w: 22, d: (x, y) => {
            const RDIAG = T / 2 * 0.85, stemX = 7;
            return une(
                sdCaja(x, y, stemX, 0, T, CAP, [1, 2, 2, 2]),
                sdSeg(x, y, stemX - 7, 12, stemX + 3, RDIAG, RDIAG),
                sdCaja(x, y, 0, CAP - T, 22, T, [2, 2, 2, 2]),
            );
        },
    },
    '2': {
        w: 26, d: (x, y) => {
            const AR = 12;
            const hood = quita(
                anillo(x, y, 0, 0, 26, 2 * AR, [AR, AR, AR, AR], T),
                sdCaja(x, y, -2, AR, 30, 2 * AR, [0, 0, 0, 0]),
            );
            return une(
                hood,
                sdSeg(x, y, 26 - T / 2, AR, T / 2, CAP - T, T / 2 * 0.9),
                sdCaja(x, y, 0, CAP - T, 26, T, [1, 3, 3, 1]),
            );
        },
    },
    // El 3 es la S ESPEJADA: misma pareja de bucles elipticos que ya funciona
    // en el alfabeto, pero quitando los cuadrantes de la IZQUIERDA (abajo-izq
    // arriba, arriba-izq abajo) en vez de los de la diagonal. Asi los dos
    // bucles se encuentran solos en el centro y sale la cintura sin trucos.
    // La cuna va estrecha (35): cuanto menos angulo, mas largos quedan los dos
    // brazos de la izquierda y mas cerrado el digito — es la version que
    // eligio David de las seis que se compararon.
    '3': {
        w: 26, d: (x, y) => {
            const rx = (26 - T) / 2, ry = 6;
            const cyA = ry + T / 2, cyB = CAP - ry - T / 2;
            const arriba = quita(anilloElipse(x, y, rx + T / 2, cyA, rx, ry, T), cuna(x, y, rx + T / 2, cyA, -1, 1, 35));
            const abajo = quita(anilloElipse(x, y, rx + T / 2, cyB, rx, ry, T), cuna(x, y, rx + T / 2, cyB, -1, -1, 35));
            return une(arriba, abajo);
        },
    },
    '4': {
        w: 28, d: (x, y) => {
            const barY = 24;
            return une(
                sdCaja(x, y, 28 - T, 0, T, CAP, [2, 2, 1, 1]),
                sdSeg(x, y, 28 - T - 2, 0, 2, barY + T / 2, T / 2 * 0.9),
                sdCaja(x, y, 0, barY, 28, T, [1, 1, 1, 1]),
            );
        },
    },
    '5': {
        w: 26, d: (x, y) => une(
            sdCaja(x, y, 0, 0, 26, T, [2, 2, 1, 1]),
            sdCaja(x, y, 0, 0, T, 20, [2, 1, 1, 1]),
            anillo(x, y, 0, 16, 26, CAP - 16, [1, R_MEDIO, R_MEDIO, R_MEDIO], T),
        ),
    },
};
const ESPACIO_W = 14;

const TONOS = { ink: 0.12, luz: 1, luzSuave: 0.86, cuerpo: 0.70, base: 0.58, sombra: 0.26 };
const LX = -0.55, LY = -0.83;
const BISEL = 3, INK = 1.6;

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
        if (ch === ' ') return { w: ESPACIO_W, d: () => 1e9 };
        const g = GLIFOS[ch];
        if (!g) throw new Error('Falta el glifo "' + ch + '" en GLIFOS');
        return g;
    });
    const offs = [0];
    for (let i = 1; i < glifos.length; i++) {
        const tope = offs[i - 1] + glifos[i - 1].w + KERN;
        if (chars[i - 1] === ' ' || chars[i] === ' ') { offs.push(tope); continue; }
        const a = perfil(chars[i - 1], glifos[i - 1]), b = perfil(chars[i], glifos[i]);
        let solape = -Infinity;
        for (let y = 0; y < a.H; y++) {
            if (a.der[y] === -Infinity || b.izq[y] === Infinity) continue;
            const v = a.der[y] - b.izq[y];
            if (v > solape) solape = v;
        }
        const cerca = solape === -Infinity ? tope : offs[i - 1] + solape + KERN + 1;
        offs.push(Math.min(tope, Math.max(cerca, tope - SOLAPE_MAX)));
    }
    const ancho = offs[offs.length - 1] + glifos[glifos.length - 1].w;
    const d = (x, y) => {
        let m = 1e9;
        for (let i = 0; i < glifos.length; i++) {
            const gx = x - offs[i];
            if (gx < -4 || gx > glifos[i].w + 4) continue;
            const v = glifos[i].d(gx, y);
            if (v < m) m = v;
        }
        return m;
    };
    return { d, ancho };
}

function campoProfundidad(masc, W, H, radio) {
    const prof = new Float32Array(W * H);
    const dentro = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : masc[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
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

function rasterizar(texto, hex, px) {
    px = px || PX;
    const { d, ancho } = distanciaTexto(texto);
    const W = Math.ceil(ancho) + 2 * MARGEN, H = CAP + 2 * MARGEN;
    const base = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tono = f => base.map(v => Math.min(255, Math.round(v * f)));
    const COL = {
        ink: tono(TONOS.ink), luz: tono(TONOS.luz), luzSuave: tono(TONOS.luzSuave),
        cuerpo: tono(TONOS.cuerpo), sombra: tono(TONOS.sombra), base: tono(TONOS.base),
    };
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

    const rgba = Buffer.alloc(W * H * px * px * 4);
    const pw = W * px;
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        const p = prof[gy * W + gx];
        let col = null;
        if (p <= 0) {
            if (p > -INK - 0.001) col = COL.ink;
        } else if (p < BISEL) {
            let nx = en(gx - 2, gy) - en(gx + 2, gy), ny = en(gx, gy - 2) - en(gx, gy + 2);
            const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
            const ndl = nx * LX + ny * LY;
            col = ndl > 0.35 ? COL.luz : ndl > -0.1 ? COL.luzSuave : ndl < -0.55 ? COL.sombra : COL.base;
        } else col = p < BISEL * 2 ? COL.cuerpo : COL.base;
        if (!col) continue;
        for (let sy = 0; sy < px; sy++) for (let sx = 0; sx < px; sx++) {
            const i = ((gy * px + sy) * pw + gx * px + sx) * 4;
            rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255;
        }
    }
    return { rgba, w: pw, h: H * px };
}

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
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const ARCADE = '#ccff00', CLASSIC = '#00ffaa';
const TRABAJOS = [
    ['match-starting-arcade.png',  'MATCH STARTING', ARCADE,  PX],
    ['match-starting-classic.png', 'MATCH STARTING', CLASSIC, PX],
    ['match-ending-arcade.png',    'MATCH ENDING',    ARCADE,  PX],
    ['match-ending-classic.png',   'MATCH ENDING',    CLASSIC, PX],
];
// PX bajo (igual que las etiquetas) y no PX*4: a mas resolucion nativa, el
// escalado a 190px CSS es un DOWNSCALE con nearest-neighbor (image-rendering:
// pixelated), que en vez de suavizar promedia mal y sale con ruido/muaré — el
// mismo problema que los iconos de skills con downscale bicubico (ver
// PIXELART-PLAN.md F1). Con PX bajo el bitmap nativo es MENOR que 190px y el
// navegador hace un UPSCALE nearest, que es donde ese modo de render luce
// (pixel grande y limpio, ver los iconos ya reprocesados).
// Solo 3·2·1: es lo que dura la cuenta atras del juego (CD_SECS en
// game/index.html) y lo que dura snd/contador.mp3. Los glifos 4 y 5 se quedan
// definidos arriba por si algun dia se alarga.
for (const n of [1, 2, 3]) {
    TRABAJOS.push(['cd-' + n + '-arcade.png',  String(n), ARCADE,  PX]);
    TRABAJOS.push(['cd-' + n + '-classic.png', String(n), CLASSIC, PX]);
}

fs.mkdirSync(DESTINO, { recursive: true });
for (const [nombre, texto, hex, px] of TRABAJOS) {
    const { rgba, w, h } = rasterizar(texto, hex, px);
    const buf = png(w, h, rgba);
    fs.writeFileSync(path.join(DESTINO, nombre), buf);
    console.log(nombre.padEnd(30), w + 'x' + h, '(' + buf.length + ' bytes)');
}
