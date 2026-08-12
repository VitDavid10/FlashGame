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
 * Ademas la pildora ROTA y las bandas horizontales siguen el eje de la capsula.
 *
 * NINGUNA pildora es de un solo color. Las banderas que si lo son (Suiza,
 * Japon, Marruecos, China, Brasil, Suecia, Noruega) llevan dos tonos del mismo
 * color en las bandas de fuera y el centro, que las despega sin dejar de ser
 * su bandera.
 *
 * EMBLEMAS POR CAPAS. Cada pais declara una lista de capas {f: forma, c: color,
 * k: escala, dx/dy: desplazamiento}, que se pintan en orden. Con una sola capa
 * no habia forma de que Estados Unidos pareciera Estados Unidos (necesita el
 * canton azul Y las estrellas blancas encima) ni de que China tuviera su
 * estrella grande con las cuatro pequenas.
 *
 * UMBRAL POR PAIS. `min` = alto minimo de la banda central para que ese emblema
 * aparezca. Es POR PAIS y no global: una cruz o un disco se leen a 8px, un
 * escudo heraldico no. Asi Japon lleva su circulo desde el primer momento y el
 * escudo de Espana espera a que la pildora de de si.
 *
 * Las formas no son mapas de bits: son funciones (u,v) -> dentro/fuera en
 * coordenadas normalizadas (-1..1), asi que se rasterizan nitidas a CUALQUIER
 * tamano y, al evaluarse en coordenadas LOCALES de la capsula, giran con ella
 * de balde.
 */
'use strict';

/* ===== FORMAS ===== ------------------------------------------------------
 * "Este punto esta dentro?" en coordenadas -1..1 con el origen en el centro.
 * v crece hacia ABAJO (como el canvas).
 */
const PAIS_FORMAS = {
    disco: (u, v) => u * u + v * v <= 1,
    // Anillo: la esfera armilar de Portugal y la linea del ecuador. Sustituye al
    // escudo heraldico, que a tamano pildora era una mancha con forma de escudo
    // y no se parecia a nada.
    aro: (u, v) => { const r = u * u + v * v; return r <= 1 && r >= 0.34; },
    rombo: (u, v) => Math.abs(u) + Math.abs(v) <= 1,
    cuadrado: (u, v) => Math.abs(u) <= 1 && Math.abs(v) <= 1,

    cruz: (u, v) => Math.abs(u) <= 0.34 || Math.abs(v) <= 0.34,
    cruzFina: (u, v) => Math.abs(u) <= 0.2 || Math.abs(v) <= 0.2,
    cruzGruesa: (u, v) => Math.abs(u) <= 0.46 || Math.abs(v) <= 0.46,
    // Brazo vertical desplazado a la izquierda (Suecia, Noruega).
    cruzNordica: (u, v) => Math.abs(v) <= 0.3 || Math.abs(u + 0.22) <= 0.3,
    // Union Jack: la cruz recta mas las dos diagonales.
    aspa: (u, v) => Math.abs(u - v) <= 0.30 || Math.abs(u + v) <= 0.30,
    aspaFina: (u, v) => Math.abs(u - v) <= 0.17 || Math.abs(u + v) <= 0.17,

    estrella: (u, v) => estrellaN(u, v, 5),
    estrella7: (u, v) => estrellaN(u, v, 7),

    // Cuatro estrellas pequenas en arco a la derecha (China).
    arcoEstrellas: (u, v) => {
        for (let i = 0; i < 4; i++) {
            const a = -0.9 + i * 0.6;                       // reparto vertical
            const cx = 0.52 + (i === 0 || i === 3 ? -0.16 : 0.12);
            const du = (u - cx) / 0.24, dv = (v - a * 0.52) / 0.24;
            if (Math.abs(du) <= 1 && Math.abs(dv) <= 1 && estrellaN(du, dv, 5)) return true;
        }
        return false;
    },

    // Cruz del Sur: cuatro estrellas repartidas (Australia).
    cruzDelSur: (u, v) => {
        const pts = [[0.1, -0.75], [0.62, -0.05], [0.05, 0.62], [-0.42, 0.02]];
        for (const [cx, cy] of pts) {
            const du = (u - cx) / 0.3, dv = (v - cy) / 0.3;
            if (Math.abs(du) <= 1 && Math.abs(dv) <= 1 && estrellaN(du, dv, 5)) return true;
        }
        return false;
    },

    // Tres estrellas en fila (para cantones tipo EE.UU.).
    filaEstrellas: (u, v) => {
        for (let i = -1; i <= 1; i++) {
            const du = (u - i * 0.6) / 0.34, dv = v / 0.55;
            if (Math.abs(du) <= 1 && Math.abs(dv) <= 1 && estrellaN(du, dv, 5)) return true;
        }
        return false;
    },

    luna: (u, v) => {
        const d1 = u * u + v * v <= 1;
        const d2 = (u - 0.42) * (u - 0.42) + v * v <= 0.82 * 0.82;
        return d1 && !d2;
    },

    escudo: (u, v) => {
        if (Math.abs(u) > 1 || v < -1 || v > 1) return false;
        if (v <= 0.15) return Math.abs(u) <= 0.86;
        const t = (v - 0.15) / 0.85;
        return Math.abs(u) <= 0.86 * (1 - t * t);
    },

    triangulo: (u, v) => v >= -1 && v <= 1 && u >= -0.9 && (u <= 0.9 - Math.abs(v) * 1.8),

    sol: (u, v) => {
        const r = Math.sqrt(u * u + v * v);
        if (r <= 0.48) return true;
        if (r > 1) return false;
        const a = Math.atan2(v, u);
        return r <= 0.48 + 0.52 * (Math.abs(Math.cos(a * 8)) > 0.55 ? 1 : 0);
    },

    damero: (u, v) => {
        if (Math.abs(u) > 1 || Math.abs(v) > 1) return false;
        return (Math.floor((u + 1) / 0.4) + Math.floor((v + 1) / 0.4)) % 2 === 0;
    },

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

    aguila: matrizForma([
        '...........',
        '...#####...',
        '..#.###.#..',
        '.##.###.##.',
        '###########',
        '.#########.',
        '..#######..',
        '...#####...',
        '....###....',
        '...##.##...',
        '...........',
    ]),
};

// Estrella de n puntas. El contorno es la recta que une la PUNTA (radio 1) con
// el VALLE (radio RV, a medio paso). En polares esa recta es
// r(a) = r1*r2*sin(a2-a1) / (r1*sin(a-a1) + r2*sin(a2-a)).
// Cuidado: cos(medio)/cos(a-medio) es el POLIGONO CONVEXO — con eso salian
// pentagonos en vez de estrellas.
const ESTRELLA_RV = 0.382;
function estrellaN(u, v, n) {
    const r = Math.sqrt(u * u + v * v);
    if (r > 1) return false;
    if (r < 0.02) return true;
    let a = Math.atan2(v, u) + Math.PI / 2;
    const paso = Math.PI * 2 / n, medio = paso / 2;
    a = ((a % paso) + paso) % paso;
    if (a > medio) a = paso - a;
    return r <= (ESTRELLA_RV * Math.sin(medio)) / (Math.sin(a) + ESTRELLA_RV * Math.sin(medio - a));
}

function matrizForma(filas) {
    const h = filas.length, w = filas[0].length;
    return (u, v) => {
        const x = Math.floor((u + 1) / 2 * w), y = Math.floor((v + 1) / 2 * h);
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        return filas[y][x] === '#';
    };
}

/* ===== UMBRALES ===== ----------------------------------------------------
 * Alto minimo (px) de la banda central para que aparezca el emblema. Cuanto
 * mas simple la silueta, antes se puede ensenar.
 */
const UMBRAL = {
    siempre: 0,    // disco, cruz: se leen desde el primer pixel
    pronto: 12,    // estrella suelta, luna, triangulo
    medio: 20,     // varias estrellas, damero, sol
    tarde: 30,     // escudo heraldico, hoja, aguila
};

/* ===== PAISES ===== ------------------------------------------------------
 * b = las tres bandas de arriba a abajo.
 * e = capas del emblema, en orden de pintado. f=forma, c=color, k=escala,
 *     dx/dy=desplazamiento (en unidades normalizadas).
 * min = umbral propio.
 * lore = texto de sabor, en ingles.
 */
const PAISES = {
    MX: {
        n: 'Mexico', b: ['#006847', '#ffffff', '#CE1126'], min: UMBRAL.tarde,
        e: [{ f: 'aguila', c: '#6B4A22' }],
        lore: 'The eagle never asked permission. Neither should you — take the center of the map and dare anyone to come get it.'
    },
    ZA: {
        n: 'South Africa', b: ['#DE3831', '#007A4D', '#002395'], min: UMBRAL.pronto,
        e: [{ f: 'triangulo', c: '#FFB612', k: 1 }, { f: 'triangulo', c: '#000000', k: 0.72 }],
        lore: 'Six colors, one flag. Six enemies, one mouth. The arithmetic works out in your favor.'
    },
    CH: {
        n: 'Switzerland', b: ['#DA291C', '#B81C11', '#DA291C'], min: UMBRAL.siempre,
        e: [{ f: 'cruz', c: '#ffffff', k: 0.82 }],
        lore: 'Neutral in every war except this one. The cross marks where the mass gets stored.'
    },
    CA: {
        n: 'Canada', b: ['#D80621', '#ffffff', '#D80621'], min: UMBRAL.tarde,
        e: [{ f: 'hoja', c: '#D80621' }],
        lore: 'Polite until the split. Then the leaf comes off and something with teeth arrives.'
    },
    BR: {
        n: 'Brazil', b: ['#009739', '#007C2F', '#009739'], min: UMBRAL.pronto,
        e: [{ f: 'rombo', c: '#FEDD00' }, { f: 'disco', c: '#012169', k: 0.52 }],
        lore: 'Order and progress, in that order. First you eat in order, then you progress through the leaderboard.'
    },
    MA: {
        n: 'Morocco', b: ['#C1272D', '#A31E24', '#C1272D'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#006233', k: 0.92 }],
        lore: 'The green star was drawn with one unbroken line. Your run should be too.'
    },
    US: {
        n: 'United States', b: ['#B22234', '#ffffff', '#B22234'], min: UMBRAL.pronto,
        e: [{ f: 'cuadrado', c: '#3C3B6E', k: 0.96 }, { f: 'filaEstrellas', c: '#ffffff', k: 0.9 }],
        lore: 'Loud, oversized and impossible to ignore on the minimap. Exactly the plan.'
    },
    AU: {
        n: 'Australia', b: ['#00247D', '#001A5C', '#00247D'], min: UMBRAL.pronto,
        e: [{ f: 'cruzDelSur', c: '#ffffff', k: 0.98 }, { f: 'estrella7', c: '#ffffff', k: 0.42, dx: -0.55, dy: 0.45 }],
        lore: 'Everything here is bigger than you and mildly hostile. You will fit right in.'
    },
    PY: {
        n: 'Paraguay', b: ['#D52B1E', '#ffffff', '#0038A8'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#009B3A', k: 0.85 }],
        lore: 'The only flag with a different face on each side. Nobody knows which one you are until it is too late.'
    },
    DE: {
        n: 'Germany', b: ['#000000', '#DD0000', '#FFCE00'], min: UMBRAL.siempre,
        e: null,
        lore: 'No emblem. No decoration. Three bands and a plan that was drafted before the match started.'
    },
    CI: {
        n: 'Ivory Coast', b: ['#F77F00', '#ffffff', '#009E60'], min: UMBRAL.siempre,
        e: null,
        lore: 'Orange for the land, white for the peace, green for the hope. The hope is that you split before they do.'
    },
    EC: {
        n: 'Ecuador', b: ['#FFDD00', '#0033A0', '#EF3340'], min: UMBRAL.pronto,
        e: [{ f: 'aro', c: '#FFDD00', k: 0.9 }],
        lore: 'The line the whole country is named after. Cross it enough times and someone notices.'
    },
    NL: {
        n: 'Netherlands', b: ['#AE1C28', '#ffffff', '#21468B'], min: UMBRAL.siempre,
        e: null,
        lore: 'They built a country below sea level out of pure stubbornness. Holding a corner should be easy.'
    },
    JP: {
        n: 'Japan', b: ['#ffffff', '#F0F0F0', '#ffffff'], min: UMBRAL.siempre,
        e: [{ f: 'disco', c: '#BC002D', k: 0.72 }],
        lore: 'One circle. Nothing else needed. The simplest shape on the field and the hardest to corner.'
    },
    SE: {
        n: 'Sweden', b: ['#006AA7', '#00518A', '#006AA7'], min: UMBRAL.siempre,
        e: [{ f: 'cruzNordica', c: '#FECC00', k: 0.9 }],
        lore: 'Cold, patient, and already behind you. The cross points where you should have looked.'
    },
    BE: {
        n: 'Belgium', b: ['#000000', '#FDDA24', '#EF3340'], min: UMBRAL.siempre,
        e: null,
        lore: 'Small country, dense population, no room to run. You have played this map your whole life.'
    },
    EG: {
        n: 'Egypt', b: ['#CE1126', '#ffffff', '#000000'], min: UMBRAL.tarde,
        e: [{ f: 'aguila', c: '#C09300' }],
        lore: 'The eagle of Saladin has watched empires get eaten. It is unimpressed by your kill streak.'
    },
    ES: {
        n: 'Spain', b: ['#AA151B', '#F1BF00', '#AA151B'], min: UMBRAL.siempre,
        e: null,
        lore: 'Plus ultra — further beyond. There is always more mass past the edge of what you can currently hold.'
    },
    CV: {
        n: 'Cape Verde', b: ['#003893', '#ffffff', '#003893'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#CF2027', k: 0.9 }],
        lore: 'Ten islands, no continent, no excuses. Showed up and knocked out someone who was supposed to win.'
    },
    FR: {
        n: 'France', b: ['#002395', '#ffffff', '#ED2939'], min: UMBRAL.siempre,
        e: null,
        lore: 'Liberty to roam, equality of hitboxes, fraternity until one of you is bigger.'
    },
    NO: {
        n: 'Norway', b: ['#BA0C2F', '#ffffff', '#BA0C2F'], min: UMBRAL.siempre,
        e: [{ f: 'cruzNordica', c: '#00205B', k: 0.86 }],
        lore: 'Carved out of a coastline that refuses to be simple. Your path through the map should be just as jagged.'
    },
    SN: {
        n: 'Senegal', b: ['#00853F', '#FDEF42', '#E31B23'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#00853F', k: 0.88 }],
        lore: 'The Lions of Teranga. Teranga means hospitality — offered right up until the moment it is not.'
    },
    AR: {
        n: 'Argentina', b: ['#74ACDF', '#ffffff', '#74ACDF'], min: UMBRAL.pronto,
        e: [{ f: 'sol', c: '#F6B40E', k: 0.95 }],
        lore: 'The Sun of May rises whether or not you were ready. Grow into it.'
    },
    DZ: {
        n: 'Algeria', b: ['#006233', '#ffffff', '#006233'], min: UMBRAL.pronto,
        e: [{ f: 'luna', c: '#D21034', k: 0.92 }],
        lore: 'The crescent opens toward whatever is next. Usually that is someone smaller.'
    },
    AT: {
        n: 'Austria', b: ['#ED2939', '#ffffff', '#ED2939'], min: UMBRAL.siempre,
        e: null,
        lore: 'One of the oldest flags still flying. Red, white, red — the same three bands for eight centuries.'
    },
    CO: {
        n: 'Colombia', b: ['#FCD116', '#003893', '#CE1126'], min: UMBRAL.siempre,
        e: null,
        lore: 'Half the flag is gold, because half the flag is what the country is worth. Go take your half of the map.'
    },
    PT: {
        n: 'Portugal', b: ['#046A38', '#DA291C'], min: UMBRAL.siempre,
        e: [{ f: 'aro', c: '#FFE900', k: 0.95 }],
        lore: 'The armillary sphere was a tool for finding your way home. Nobody here is going home.'
    },
    CD: {
        n: 'DR Congo', b: ['#007FFF', '#F7D618', '#007FFF'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#CE1021', k: 0.88 }],
        lore: 'A river that runs both sides of the equator. Whatever direction you are going, it has been there.'
    },
    GB: {
        n: 'United Kingdom', b: ['#012169', '#001640'], min: UMBRAL.siempre,
        e: [
            { f: 'aspa', c: '#ffffff', k: 1 },
            { f: 'cruzGruesa', c: '#ffffff', k: 1 },
            { f: 'aspaFina', c: '#C8102E', k: 1 },
            { f: 'cruz', c: '#C8102E', k: 1 },
        ],
        lore: 'Three crosses stacked into one flag by countries that could not agree on much else. Somehow it works.'
    },
    HR: {
        n: 'Croatia', b: ['#FF0000', '#ffffff', '#171796'], min: UMBRAL.medio,
        e: [{ f: 'damero', c: '#FF0000', k: 0.92 }],
        lore: 'Twenty-five red and white squares. Count them if you get close enough, which you will not.'
    },
    GH: {
        n: 'Ghana', b: ['#CE1126', '#FCD116', '#006B3F'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#000000', k: 0.88 }],
        lore: 'The Black Star. First to break free, and still first to the middle of the map.'
    },
    CN: {
        n: 'China', b: ['#EE1C25', '#D4141B'], min: UMBRAL.siempre,
        e: [
            { f: 'estrella', c: '#FFFF00', k: 0.62, dx: -0.42 },
            { f: 'arcoEstrellas', c: '#FFFF00', k: 1 },
        ],
        lore: 'One large star, four small ones following. Build your own constellation out of everyone you swallow.'
    },
};

/* ===== DIBUJO ===== ------------------------------------------------------ */

const PAIS_PILL_RATIO = 2.0;
const _paisCache = new Map();
let _paisProbe = null;
function _rgb(col) {
    if (!_paisProbe) { const c = document.createElement('canvas'); c.width = c.height = 1; _paisProbe = c.getContext('2d', { willReadFrequently: true }); }
    _paisProbe.clearRect(0, 0, 1, 1); _paisProbe.fillStyle = col; _paisProbe.fillRect(0, 0, 1, 1);
    const d = _paisProbe.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
}

function paisSkin(code) {
    const p = PAISES[String(code || '').toUpperCase()];
    if (!p) return null;
    return {
        code: String(code).toUpperCase(), nombre: p.n, bandas: p.b, lore: p.lore,
        capas: (p.e || []).map(c => ({ forma: PAIS_FORMAS[c.f], color: c.c, k: c.k || 1, dx: c.dx || 0, dy: c.dy || 0 })),
        min: p.min === undefined ? UMBRAL.medio : p.min,
    };
}

function paisLista() { return Object.keys(PAISES).map(c => Object.assign({ code: c }, PAISES[c])); }

/* Pildora INCLINADA. Port de pixPillSpriteRot (game/index.html) a tres bandas +
 * emblema por capas. Mantiene su modo `detailed`: luz direccional constante EN
 * PANTALLA, bandas de sombra que engordan hacia la punta oscura, reborde de 1px
 * en todo el contorno y un rombo de brillo duro.
 * La capsula se hornea YA GIRADA: rotar el sprite en runtime lo mutila porque
 * los pixeles dejan de caer cuadrados sobre la rejilla de pantalla.
 */
function paisPillRot(wL, code, ang, forzarEmblema) {
    const skin = paisSkin(code); if (!skin) return null;
    if (ang === undefined) ang = -Math.PI / 4;
    const key = wL + '|' + skin.code + '|' + Math.round(ang * 100) + '|' + (forzarEmblema ? 1 : 0);
    const hit = _paisCache.get(key); if (hit) return hit;
    if (_paisCache.size > 300) _paisCache.clear();

    const hL = Math.round(wL * PAIS_PILL_RATIO), R = wL / 2, seg = hL / 2 - R, RI = R - 0.1;
    const c = Math.cos(ang), s = Math.sin(ang);
    const S = Math.ceil(Math.max(wL * Math.abs(c) + hL * Math.abs(s), wL * Math.abs(s) + hL * Math.abs(c))) + 2;
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const rgb = skin.bandas.map(_rgb);

    // medio = media altura de la banda CENTRAL en las de tres bandas, y la
    // referencia de tamano del emblema en todas.
    // Con DOS bandas no hay banda central: el corte cae en ly=0 y el emblema se
    // va a la banda de ABAJO (embCy), centrado en ella. Puesto sobre la costura
    // quedaba partido entre los dos colores y no se leia ninguno.
    const nBandas = rgb.length;
    const medio = (seg + R) / 3;
    const embCy = nBandas === 2 ? (seg + R) / 2 : 0;
    const embOn = skin.capas.length > 0 && (forzarEmblema || medio * 2 >= skin.min);
    const capas = embOn ? skin.capas.map(l => ({ f: l.forma, c: _rgb(l.color), k: l.k, dx: l.dx, dy: l.dy })) : [];
    const lado = Math.min(R, medio) * 0.80;

    const img = g.createImageData(S, S), px = img.data;
    const LX = -0.6, LY = -0.8;
    const kD = wL / 38;

    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        const cy = ly < -seg ? -seg : ly > seg ? seg : ly;
        const rad = Math.hypot(lx, ly - cy);
        if (rad > RI) continue;

        let base = nBandas === 2 ? (ly < 0 ? rgb[0] : rgb[1])
                                 : (ly < -medio ? rgb[0] : (ly < medio ? rgb[1] : rgb[2]));
        // Capas del emblema, en orden: la ultima que acierta manda.
        if (capas.length && Math.abs(ly - embCy) < medio) {
            for (const l of capas) {
                const L = lado * l.k;
                const eu = (lx - l.dx * lado) / L, ev = (ly - embCy - l.dy * lado) / L;
                if (Math.abs(eu) <= 1 && Math.abs(ev) <= 1 && l.f(eu, ev)) base = l.c;
            }
        }

        let nx = lx, ny = ly - cy; const nl = rad || 1; nx /= nl; ny /= nl;
        const ndl = (nx * c - ny * s) * LX + (nx * s + ny * c) * LY;
        const edge = RI - rad;
        const u = Math.max(0, Math.min(1, (1 - ndl) * 0.5));
        const w1 = (1.05 + 1.7 * u) * kD, w2 = (2.6 + 4.2 * u) * kD, w3 = (4.2 + 6.8 * u) * kD;
        let amt;
        // Costuras: una sola en ly=0 con dos bandas, dos en +-medio con tres.
        const enCostura = nBandas === 2 ? Math.abs(ly) < 1.45 * kD
                                        : Math.abs(Math.abs(ly) - medio) < 1.45 * kD;
        if (enCostura) amt = -0.30;
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
    const o = { cv, S, conEmblema: embOn };
    _paisCache.set(key, o); return o;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PAISES, PAIS_FORMAS, UMBRAL, paisSkin, paisLista, paisPillRot };
