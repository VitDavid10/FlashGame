/*
 * SKINS DE PAIS — tabla de datos + emblemas pixel generados por codigo.
 *
 * Una skin de pais es SOLO un codigo de dos letras. Con el, cada cliente saca
 * de esta tabla las tres bandas de color y el emblema y se pinta la pildora el
 * solo. Esto importa: la primera version de skins (skinUrl) se quito del online
 * porque era una URL arbitraria que descargaba el navegador del RESTO de
 * jugadores — fuga de IP a un servidor ajeno y hasta 300 B por celda en CADA
 * snapshot (ver game-host.js, handleJoin). Dos bytes en el bloque de identidad,
 * que ya se manda una sola vez por conexion, no tienen ninguno de esos dos
 * problemas.
 *
 * TRES BANDAS y no dos mitades porque la capsula es el doble de alta que de
 * ancha (PILL_RATIO = 2): en horizontal caben tres bandas de ~13px en una
 * pildora recien nacida, mientras que tres franjas verticales serian de 6.6px.
 * Ademas la pildora ROTA (drawPixPillRot hornea 16 angulos) y las bandas
 * horizontales siguen el eje de la capsula.
 *
 * Dejando que las tres bandas sean del MISMO color, el formato cubre tambien
 * banderas que no son tricolores: Japon es blanco/blanco/blanco + disco rojo,
 * Brasil verde/verde/verde + rombo. Un solo modelo de datos para todas.
 *
 * Los emblemas NO son mapas de bits: son funciones (u,v) -> dentro/fuera en
 * coordenadas normalizadas (-1..1), asi que se rasterizan nitidos a CUALQUIER
 * tamano. A 20px de pildora salen siluetas de ~10px; a 200px, el mismo dibujo
 * con mas detalle. Son siluetas reconocibles, no escudos heraldicos: el de
 * Espana con las columnas de Hercules no cabe en 10 pixeles y no hay truco que
 * lo arregle.
 */
'use strict';

/* ===== FORMAS ===== ------------------------------------------------------
 * Cada forma responde "este punto esta dentro?" en coordenadas -1..1 con el
 * origen en el centro. v crece hacia ABAJO (como el canvas).
 */
const PAIS_FORMAS = {
    disco: (u, v) => u * u + v * v <= 1,

    rombo: (u, v) => Math.abs(u) + Math.abs(v) <= 1,

    // Grosor del brazo en 0.34: por debajo la cruz desaparece a tamano pildora.
    cruz: (u, v) => Math.abs(u) <= 0.34 || Math.abs(v) <= 0.34,

    // Cruz nordica: brazo vertical desplazado a la izquierda (Suecia, Noruega).
    cruzNordica: (u, v) => Math.abs(v) <= 0.3 || Math.abs(u + 0.22) <= 0.3,

    // Estrella de 5 puntas por la formula del poligono estrellado en polares.
    estrella: (u, v) => estrellaN(u, v, 5),
    // Estrella de la Commonwealth (Australia): 7 puntas.
    estrella7: (u, v) => estrellaN(u, v, 7),

    // Luna creciente: un disco al que otro disco desplazado le come un trozo.
    luna: (u, v) => {
        const d1 = u * u + v * v <= 1;
        const d2 = (u - 0.42) * (u - 0.42) + v * v <= 0.82 * 0.82;
        return d1 && !d2;
    },

    // Escudo generico: cuadrado arriba que se afila en punta hacia abajo.
    escudo: (u, v) => {
        if (Math.abs(u) > 1 || v < -1 || v > 1) return false;
        if (v <= 0.15) return Math.abs(u) <= 0.86;
        const t = (v - 0.15) / 0.85;              // 0 en el hombro, 1 en la punta
        return Math.abs(u) <= 0.86 * (1 - t * t);
    },

    // Triangulo apuntando a la derecha (Bosnia) o abajo-derecha.
    triangulo: (u, v) => v >= -1 && v <= 1 && u >= -0.9 && u <= 0.9 && (u <= 0.9 - Math.abs(v) * 1.8),

    // Sol con rayos: disco central + 8 rayos triangulares (Argentina).
    sol: (u, v) => {
        const r = Math.sqrt(u * u + v * v);
        if (r <= 0.48) return true;
        if (r > 1) return false;
        const a = Math.atan2(v, u);
        const k = Math.abs(Math.cos(a * 8));      // 8 rayos
        return r <= 0.48 + 0.52 * (k > 0.55 ? 1 : 0);
    },

    // Damero 5x5 (Croacia). Se evalua en la rejilla, no por distancia.
    damero: (u, v) => {
        if (Math.abs(u) > 1 || Math.abs(v) > 1) return false;
        const cx = Math.floor((u + 1) / 0.4), cy = Math.floor((v + 1) / 0.4);
        return (cx + cy) % 2 === 0;
    },

    // Hoja de arce (Canada). La unica que si es una matriz: no hay formula
    // corta que de una silueta reconocible, y a este tamano lo que importa es
    // la silueta. 11x11, se escala con vecino mas cercano.
    hoja: matrizForma([
        '.....#.....',
        '....###....',
        '.#..###..#.',
        '.#########.',
        '..#######..',
        '...#####...',
        '..#######..',
        '.#.#####.#.',
        '.....#.....',
        '....###....',
        '....###....',
    ]),

    // Ave/aguila de perfil, muy simplificada (Egipto, Mexico).
    ave: matrizForma([
        '...........',
        '..##...##..',
        '.####.####.',
        '.#########.',
        '..#######..',
        '...#####...',
        '....###....',
        '...#####...',
        '..##...##..',
        '.#.......#.',
        '...........',
    ]),
};

// Estrella de n puntas. El contorno es la recta que une la PUNTA (radio 1, en
// los multiplos del paso) con el VALLE (radio RV, a medio paso). En polares esa
// recta es r(a) = r1*r2*sin(a2-a1) / (r1*sin(a-a1) + r2*sin(a2-a)), que con
// a1=0, r1=1, a2=medio, r2=RV se queda en lo de abajo.
// El intento anterior usaba cos(medio)/cos(a-medio), que es el POLIGONO CONVEXO:
// salia un pentagono, no una estrella.
const ESTRELLA_RV = 0.382;   // razon aurea: la proporcion de la estrella de 5 puntas
function estrellaN(u, v, n) {
    const r = Math.sqrt(u * u + v * v);
    if (r > 1) return false;
    if (r < 0.02) return true;
    let a = Math.atan2(v, u) + Math.PI / 2;        // punta hacia arriba
    const paso = Math.PI * 2 / n, medio = paso / 2;
    a = ((a % paso) + paso) % paso;
    if (a > medio) a = paso - a;                   // simetrico respecto al valle
    const borde = (ESTRELLA_RV * Math.sin(medio)) / (Math.sin(a) + ESTRELLA_RV * Math.sin(medio - a));
    return r <= borde;
}

// Convierte un dibujo ASCII en una funcion (u,v) -> dentro. '#' = pintado.
function matrizForma(filas) {
    const h = filas.length, w = filas[0].length;
    return (u, v) => {
        const x = Math.floor((u + 1) / 2 * w), y = Math.floor((v + 1) / 2 * h);
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        return filas[y][x] === '#';
    };
}

/* ===== PAISES ===== ------------------------------------------------------
 * Los 32 que avanzaron de la fase de grupos del Mundial 2026 + China.
 * b = las tres bandas de arriba a abajo. e = forma del emblema. ec = su color.
 * Cuando la bandera real es de franjas VERTICALES (Francia, Belgica, Mexico...)
 * se pasan a horizontales conservando el orden y los colores: a tamano pildora
 * lo que identifica es la terna de colores, no su direccion.
 */
const PAISES = {
    // --- Grupo A
    MX: { n: 'México',        b: ['#006847', '#ffffff', '#CE1126'], e: 'ave',         ec: '#8B5A2B' },
    ZA: { n: 'Sudáfrica',     b: ['#007A4D', '#FFB612', '#DE3831'], e: 'triangulo',   ec: '#000000' },
    // --- Grupo B
    CH: { n: 'Suiza',         b: ['#DA291C', '#DA291C', '#DA291C'], e: 'cruz',        ec: '#ffffff' },
    CA: { n: 'Canadá',        b: ['#D80621', '#ffffff', '#D80621'], e: 'hoja',        ec: '#D80621' },
    // Bosnia y Herzegovina fuera a proposito: con ella eran 33 y la tienda va
    // de 8 en 8 (4 pestañas exactas de 8). Su hueco lo pidio David.
    // --- Grupo C
    BR: { n: 'Brasil',        b: ['#009739', '#009739', '#009739'], e: 'rombo',       ec: '#FEDD00' },
    MA: { n: 'Marruecos',     b: ['#C1272D', '#C1272D', '#C1272D'], e: 'estrella',    ec: '#006233' },
    // --- Grupo D
    US: { n: 'Estados Unidos',b: ['#B22234', '#ffffff', '#B22234'], e: 'estrella',    ec: '#3C3B6E' },
    AU: { n: 'Australia',     b: ['#00247D', '#00247D', '#00247D'], e: 'estrella7',   ec: '#ffffff' },
    PY: { n: 'Paraguay',      b: ['#D52B1E', '#ffffff', '#0038A8'], e: 'estrella',    ec: '#009B3A' },
    // --- Grupo E
    DE: { n: 'Alemania',      b: ['#000000', '#DD0000', '#FFCE00'], e: null,          ec: null },
    CI: { n: 'Costa de Marfil', b: ['#F77F00', '#ffffff', '#009E60'], e: null,        ec: null },
    // Escudo en AMARILLO y no en el azul del propio escudo: la banda central de
    // Ecuador ES azul, asi que con el color real el emblema tenia contraste 1.0
    // contra su fondo — literalmente invisible. El amarillo sale de su bandera.
    EC: { n: 'Ecuador',       b: ['#FFDD00', '#0033A0', '#EF3340'], e: 'escudo',      ec: '#FFDD00' },
    // --- Grupo F
    NL: { n: 'Países Bajos',  b: ['#AE1C28', '#ffffff', '#21468B'], e: null,          ec: null },
    JP: { n: 'Japón',         b: ['#ffffff', '#ffffff', '#ffffff'], e: 'disco',       ec: '#BC002D' },
    SE: { n: 'Suecia',        b: ['#006AA7', '#006AA7', '#006AA7'], e: 'cruzNordica', ec: '#FECC00' },
    // --- Grupo G
    BE: { n: 'Bélgica',       b: ['#000000', '#FDDA24', '#EF3340'], e: null,          ec: null },
    EG: { n: 'Egipto',        b: ['#CE1126', '#ffffff', '#000000'], e: 'ave',         ec: '#C09300' },
    // --- Grupo H
    ES: { n: 'España',        b: ['#AA151B', '#F1BF00', '#AA151B'], e: 'escudo',      ec: '#AA151B' },
    CV: { n: 'Cabo Verde',    b: ['#003893', '#ffffff', '#003893'], e: 'estrella',    ec: '#CF2027' },
    // --- Grupo I
    FR: { n: 'Francia',       b: ['#002395', '#ffffff', '#ED2939'], e: null,          ec: null },
    NO: { n: 'Noruega',       b: ['#BA0C2F', '#BA0C2F', '#BA0C2F'], e: 'cruzNordica', ec: '#00205B' },
    SN: { n: 'Senegal',       b: ['#00853F', '#FDEF42', '#E31B23'], e: 'estrella',    ec: '#00853F' },
    // --- Grupo J
    AR: { n: 'Argentina',     b: ['#74ACDF', '#ffffff', '#74ACDF'], e: 'sol',         ec: '#F6B40E' },
    DZ: { n: 'Argelia',       b: ['#006233', '#ffffff', '#006233'], e: 'luna',        ec: '#D21034' },
    AT: { n: 'Austria',       b: ['#ED2939', '#ffffff', '#ED2939'], e: null,          ec: null },
    // --- Grupo K
    CO: { n: 'Colombia',      b: ['#FCD116', '#003893', '#CE1126'], e: null,          ec: null },
    PT: { n: 'Portugal',      b: ['#046A38', '#DA291C', '#DA291C'], e: 'escudo',      ec: '#FFE900' },
    CD: { n: 'RD Congo',      b: ['#007FFF', '#F7D618', '#007FFF'], e: 'estrella',    ec: '#CE1021' },
    // --- Grupo L
    EN: { n: 'Inglaterra',    b: ['#ffffff', '#ffffff', '#ffffff'], e: 'cruz',        ec: '#CE1124' },
    HR: { n: 'Croacia',       b: ['#FF0000', '#ffffff', '#171796'], e: 'damero',      ec: '#FF0000' },
    GH: { n: 'Ghana',         b: ['#CE1126', '#FCD116', '#006B3F'], e: 'estrella',    ec: '#000000' },
    // --- Añadido a mano
    CN: { n: 'China',         b: ['#EE1C25', '#EE1C25', '#EE1C25'], e: 'estrella',    ec: '#FFFF00' },
};

/* ===== DIBUJO ===== ------------------------------------------------------ */

// Alto minimo de la BANDA CENTRAL para que aparezca el emblema. Por debajo la
// silueta se convierte en una mancha que ensucia mas de lo que identifica, asi
// que la pildora se queda solo con sus tres colores. Con PILL_RATIO = 2 la
// banda central mide 4r/3, asi que 24 equivale a radio >= 18: sobre el triple
// de la masa inicial. El emblema es una recompensa por crecer.
const PAIS_EMBLEMA_MIN = 24;

// Pinta el emblema centrado en la banda central. `bandaY0`/`bandaY1` acotan la
// banda dentro del sprite y `dentro` dice que pixeles caen dentro de la capsula
// (el emblema nunca se sale del contorno).
function paisPintaEmblema(g, forma, color, wL, bandaY0, bandaY1, dentro) {
    const h = bandaY1 - bandaY0;
    if (h < PAIS_EMBLEMA_MIN) return false;
    // 78% de la banda: deja un respiro arriba y abajo para que no toque las
    // costuras, que es donde el sombreado ya mete su linea oscura.
    const lado = Math.floor(Math.min(wL, h) * 0.78);
    const x0 = Math.round((wL - lado) / 2), y0 = Math.round(bandaY0 + (h - lado) / 2);
    g.fillStyle = color;
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
        const u = (x + 0.5) / lado * 2 - 1, v = (y + 0.5) / lado * 2 - 1;
        if (!forma(u, v)) continue;
        const px = x0 + x, py = y0 + y;
        if (dentro && !dentro(px, py)) continue;
        g.fillRect(px, py, 1, 1);
    }
    return true;
}

// Devuelve las tres bandas y el emblema de un codigo, o null si no existe.
function paisSkin(code) {
    const p = PAISES[String(code || '').toUpperCase()];
    if (!p) return null;
    return { code: String(code).toUpperCase(), nombre: p.n, bandas: p.b, forma: p.e ? PAIS_FORMAS[p.e] : null, colorEmblema: p.ec };
}

function paisLista() { return Object.keys(PAISES).map(c => Object.assign({ code: c }, PAISES[c])); }

/* ===== PILDORA INCLINADA ===== -------------------------------------------
 * Port de pixPillSpriteRot (game/index.html) a tres bandas + emblema. Se
 * mantiene su modo `detailed`: luz direccional constante EN PANTALLA, bandas de
 * sombra que engordan hacia la punta oscura, reborde de 1px en todo el contorno
 * y un rombo de brillo duro. Es la version que usa el hero, y la mas bonita de
 * las dos que hay.
 *
 * La capsula se hornea YA GIRADA dentro de un lienzo cuadrado y se dibuja sin
 * ctx.rotate(): rotar el sprite en runtime lo mutila (bordes dentados, contorno
 * roto) porque los pixeles dejan de caer cuadrados sobre la rejilla de pantalla.
 *
 * El emblema se decide en coordenadas LOCALES (lx, ly = el eje de la capsula),
 * asi que gira con la pildora de balde: no hay que rotarlo aparte.
 */
const PAIS_PILL_RATIO = 2.0;
const _paisCache = new Map();
let _paisProbe = null;
function _rgb(col) {
    if (!_paisProbe) { const c = document.createElement('canvas'); c.width = c.height = 1; _paisProbe = c.getContext('2d', { willReadFrequently: true }); }
    _paisProbe.clearRect(0, 0, 1, 1); _paisProbe.fillStyle = col; _paisProbe.fillRect(0, 0, 1, 1);
    const d = _paisProbe.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
}

// wL = ancho logico de la capsula. ang = inclinacion en radianes.
// Devuelve { cv, S } con la capsula centrada en el cuadrado SxS.
function paisPillRot(wL, code, ang, conEmblema) {
    const skin = paisSkin(code); if (!skin) return null;
    if (ang === undefined) ang = -Math.PI / 4;
    const key = wL + '|' + skin.code + '|' + Math.round(ang * 100) + '|' + (conEmblema !== false ? 1 : 0);
    const hit = _paisCache.get(key); if (hit) return hit;
    if (_paisCache.size > 300) _paisCache.clear();

    const hL = Math.round(wL * PAIS_PILL_RATIO), R = wL / 2, seg = hL / 2 - R, RI = R - 0.1;
    const c = Math.cos(ang), s = Math.sin(ang);
    const S = Math.ceil(Math.max(wL * Math.abs(c) + hL * Math.abs(s), wL * Math.abs(s) + hL * Math.abs(c))) + 2;
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const rgb = skin.bandas.map(_rgb);
    const emb = (conEmblema !== false && skin.forma) ? skin.forma : null;
    const embRgb = emb ? _rgb(skin.colorEmblema) : null;

    const img = g.createImageData(S, S), px = img.data;
    const LX = -0.6, LY = -0.8;                    // luz arriba-izquierda
    const kD = wL / 38;                            // grosor de bandas, medido sobre wL~38
    const medio = (seg + R) / 3;                   // media altura de la banda central
    // El emblema ocupa el 78% del lado menor de la banda central: deja aire para
    // no pisar las costuras, que ya llevan su linea oscura.
    const embLado = Math.min(R, medio) * 0.78;
    const embOn = emb && (medio * 2 >= PAIS_EMBLEMA_MIN);

    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        const cy = ly < -seg ? -seg : ly > seg ? seg : ly;
        const rad = Math.hypot(lx, ly - cy);
        if (rad > RI) continue;

        let base = ly < -medio ? rgb[0] : (ly < medio ? rgb[1] : rgb[2]);
        // Emblema: dentro de la banda central y dentro de su cuadrado local.
        if (embOn && Math.abs(ly) < medio && Math.abs(lx) <= embLado && Math.abs(ly) <= embLado) {
            if (emb(lx / embLado, ly / embLado)) base = embRgb;
        }

        let nx = lx, ny = ly - cy; const nl = rad || 1; nx /= nl; ny /= nl;
        const ndl = (nx * c - ny * s) * LX + (nx * s + ny * c) * LY;   // -1 sombra .. 1 luz
        const edge = RI - rad;
        const u = Math.max(0, Math.min(1, (1 - ndl) * 0.5));
        const w1 = (1.05 + 1.7 * u) * kD, w2 = (2.6 + 4.2 * u) * kD, w3 = (4.2 + 6.8 * u) * kD;
        let amt;
        // Dos costuras (los dos cortes entre bandas) en vez de una.
        if (Math.abs(Math.abs(ly) - medio) < 1.45 * kD) amt = -0.30;
        else if (edge < w1) amt = -0.44;
        else if (edge < w2) amt = -0.30;
        else if (u > 0.18 && edge < w3) amt = -0.15;
        else amt = 0;

        const t = amt < 0 ? 0 : 255, a = Math.abs(amt), i = ((y * S + x) << 2);
        px[i] = base[0] + (t - base[0]) * a;
        px[i + 1] = base[1] + (t - base[1]) * a;
        px[i + 2] = base[2] + (t - base[2]) * a;
        px[i + 3] = 255;
    }
    // Rombo de brillo duro en la punta iluminada, en coordenadas locales.
    const glx = -0.40 * R, gly = -0.48 * (seg + R);
    const gx = S / 2 + (glx * c - gly * s), gy = S / 2 + (glx * s + gly * c);
    const gr = Math.max(2, Math.round(wL * 0.145));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = ((y * S + x) << 2); if (!px[i + 3]) continue;
        const md = Math.abs(x + 0.5 - gx) + Math.abs(y + 0.5 - gy);
        if (md > gr) continue;
        const a = md <= gr * 0.45 ? 0.95 : md <= gr * 0.75 ? 0.78 : 0.50;
        px[i] += (255 - px[i]) * a; px[i + 1] += (255 - px[i + 1]) * a; px[i + 2] += (255 - px[i + 2]) * a;
    }
    g.putImageData(img, 0, 0);
    const o = { cv, S, conEmblema: !!embOn };
    _paisCache.set(key, o); return o;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PAISES, PAIS_FORMAS, PAIS_EMBLEMA_MIN, paisSkin, paisLista, paisPintaEmblema, paisPillRot };
