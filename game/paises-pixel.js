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
 * UNA, DOS O TRES BANDAS. Las banderas de un solo color (Suiza, Japon,
 * Marruecos, China, Brasil, Reino Unido) van con banda UNICA: color plano y sin
 * costura. Antes llevaban dos tonos del mismo color para "despegarlas", pero el
 * resultado era una pildora que seguia leyendose como de tres franjas cuando la
 * bandera no las tiene — y el emblema, que es lo que de verdad las identifica,
 * competia con unas rayas que no pintaban nada. El volumen se lo sigue dando el
 * sombreado del borde, que no depende de las bandas.
 *
 * EMBLEMAS POR CAPAS. Cada pais declara una lista de capas {f: forma, c: color,
 * k: escala, dx/dy: desplazamiento}, que se pintan en orden. Con una sola capa
 * no habia forma de que China tuviera su estrella grande con las cuatro
 * pequenas, ni de que Sudafrica llevara su triangulo negro con filo dorado.
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
    // Chakra de Ashoka (India): llanta, buje y 24 radios. |cos(12a)| tiene 24
    // lobulos en la vuelta completa, que son justo los radios que lleva.
    rueda: (u, v) => {
        const r = Math.sqrt(u * u + v * v);
        if (r > 1) return false;
        if (r >= 0.76 || r <= 0.2) return true;
        return Math.abs(Math.cos(Math.atan2(v, u) * 12)) > 0.86;
    },
    rombo: (u, v) => Math.abs(u) + Math.abs(v) <= 1,

    cruz: (u, v) => Math.abs(u) <= 0.34 || Math.abs(v) <= 0.34,
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

    luna: (u, v) => {
        const d1 = u * u + v * v <= 1;
        const d2 = (u - 0.42) * (u - 0.42) + v * v <= 0.82 * 0.82;
        return d1 && !d2;
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
        lore: 'The eagle on the flag is mid-kill, standing on a cactus with a snake in its beak, and nobody ever asked it to pose politely. Mexico plays the arena the same way: take the middle, hold the middle, and let the rest of the lobby work out what to do about it.'
    },
    ZA: {
        n: 'South Africa', b: ['#DE3831', '#007A4D', '#002395'], min: UMBRAL.pronto,
        e: [{ f: 'triangulo', c: '#FFB612', k: 1 }, { f: 'triangulo', c: '#000000', k: 0.72 }],
        lore: 'Six colours on one flag, which no other nation dared attempt, and a Y that splits and rejoins to say that everything once separate comes back together. You will do a lot of splitting here. The rejoining is the part most players get wrong.'
    },
    CH: {
        n: 'Switzerland', b: ['#DA291C'], min: UMBRAL.siempre,
        e: [{ f: 'cruz', c: '#ffffff', k: 0.82 }],
        lore: 'Neutral in every war of the last two centuries, and the only country on this list that will sit out a fight purely because the arithmetic does not favour it. That is not cowardice. That is a player who has already counted your mass.'
    },
    CA: {
        n: 'Canada', b: ['#D80621', '#ffffff', '#D80621'], min: UMBRAL.tarde,
        e: [{ f: 'hoja', c: '#D80621' }],
        lore: 'Impossibly polite right up to the moment the leaf comes off. Canada holds the second largest territory on the planet and almost nobody lives in it, which is exactly the map control philosophy: own more space than you could possibly need, and dare someone to walk into it.'
    },
    BR: {
        n: 'Brazil', b: ['#009739'], min: UMBRAL.pronto,
        e: [{ f: 'rombo', c: '#FEDD00' }, { f: 'disco', c: '#012169', k: 0.52 }],
        lore: 'Order and progress, in that order, stitched across a sky of stars fixed at the exact moment the republic was born. Five World Cups say the flair is real, but flair alone never held a lobby. Eat in order. Progress follows always.'
    },
    MA: {
        n: 'Morocco', b: ['#C1272D'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#006233', k: 0.92 }],
        lore: 'The green star was drawn as one unbroken line, a single stroke that never lifts and never crosses itself. Play the same way. The runs that end badly here are the ones that hesitated somewhere in the middle of it.'
    },
    IN: {
        n: 'India', b: ['#FF9933', '#ffffff', '#138808'], min: UMBRAL.pronto,
        e: [{ f: 'rueda', c: '#000080', k: 0.95 }],
        lore: 'The wheel in the middle is the Ashoka Chakra, and its twenty-four spokes are the twenty-four hours of a day. The point of it is that it never stops turning. In this arena the ones who stop rolling get eaten by the ones who did not.'
    },
    AU: {
        n: 'Australia', b: ['#00247D', '#001A5C', '#00247D'], min: UMBRAL.pronto,
        e: [{ f: 'cruzDelSur', c: '#ffffff', k: 0.98 }, { f: 'estrella7', c: '#ffffff', k: 0.42, dx: -0.55, dy: 0.45 }],
        lore: 'The Southern Cross only works as a compass if you are below the equator, which is a very Australian way of saying that the rules change depending on where you are standing. Everything here is larger than you and mildly hostile. You will fit right in.'
    },
    PY: {
        n: 'Paraguay', b: ['#D52B1E', '#ffffff', '#0038A8'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#009B3A', k: 0.85 }],
        lore: 'The only national flag on Earth with a different emblem on each face, so what you see depends entirely on which side you are standing. Nobody in this arena knows which Paraguay they are chasing until it has already turned around.'
    },
    DE: {
        n: 'Germany', b: ['#000000', '#DD0000', '#FFCE00'], min: UMBRAL.siempre,
        e: null,
        lore: 'No emblem, no decoration, no flourish anywhere on it. Three bands and a plan that was finalised long before the match started. Germany does not improvise, and that is precisely the thing that should worry you the most.'
    },
    CI: {
        n: 'Ivory Coast', b: ['#F77F00', '#ffffff', '#009E60'], min: UMBRAL.siempre,
        e: null,
        lore: 'Orange for the savannah, white for the peace between, green for the forest and the hope. The hope, in practice, is that you split a fraction of a second before the other one does. Hope and timing are the same here.'
    },
    EC: {
        n: 'Ecuador', b: ['#FFDD00', '#0033A0', '#EF3340'], min: UMBRAL.pronto,
        e: null,
        lore: 'Named after a line that does not physically exist, drawn around the widest part of the planet, and claimed by a country that decided the line was worth being named after. Cross the middle of the map often enough and people start naming things after you too.'
    },
    NL: {
        n: 'Netherlands', b: ['#AE1C28', '#ffffff', '#21468B'], min: UMBRAL.siempre,
        e: null,
        lore: 'They built an entire country below sea level out of sheer refusal to accept the water\'s opinion on the matter. A third of it should not be there. Holding a contested corner of this map should feel like a holiday to someone.'
    },
    JP: {
        n: 'Japan', b: ['#ffffff'], min: UMBRAL.siempre,
        e: [{ f: 'disco', c: '#BC002D', k: 0.72 }],
        lore: 'One circle. No text, no crest, no second idea. Every other flag on this list is trying to tell you something; this one just shows up. The simplest shape on the field is also the hardest to corner or escape from.'
    },
    SE: {
        n: 'Sweden', b: ['#006AA7', '#00518A', '#006AA7'], min: UMBRAL.siempre,
        e: [{ f: 'cruzNordica', c: '#FECC00', k: 0.9 }],
        lore: 'Cold, patient, and already behind you. Sweden spent centuries being the quiet power of the north while everyone was watching somewhere else. The cross points at exactly the place you should have been looking. Look there now.'
    },
    BE: {
        n: 'Belgium', b: ['#000000', '#FDDA24', '#EF3340'], min: UMBRAL.siempre,
        e: null,
        lore: 'A small, dense country that has been the crossroads of every European argument worth having, with no room to run in any direction. You have played this map your entire life. It is called rush hour every moment.'
    },
    EG: {
        n: 'Egypt', b: ['#CE1126', '#ffffff', '#000000'], min: UMBRAL.tarde,
        e: [{ f: 'aguila', c: '#C09300' }],
        lore: 'The Eagle of Saladin has watched empires get eaten, and it was not especially impressed by any of them. Your kill streak is real, and it is also about four thousand years too late to be the most impressive thing that ever happened here.'
    },
    ES: {
        n: 'Spain', b: ['#AA151B', '#F1BF00', '#AA151B'], min: UMBRAL.siempre,
        e: null,
        lore: 'Red, gold, red, and Plus Ultra written across the middle of it: further beyond. It was stamped on the coins of an empire that kept sailing past the edge of its own maps. There is always more mass past the edge of what you can currently hold.'
    },
    CV: {
        n: 'Cape Verde', b: ['#003893', '#ffffff', '#003893'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#CF2027', k: 0.9 }],
        lore: 'Ten islands, no continent, half a million people, and a squad nobody outside the Atlantic had heard of. It walked into the group stage and knocked out a country that had been to two finals. Size is a statistic. It is not a result.'
    },
    FR: {
        n: 'France', b: ['#002395', '#ffffff', '#ED2939'], min: UMBRAL.siempre,
        e: null,
        lore: 'Liberty to roam wherever the map allows, equality of hitboxes at the moment of contact, and fraternity that lasts precisely until one of you is measurably larger than the other. French strategy is always beautiful right up until it is not.'
    },
    NO: {
        n: 'Norway', b: ['#BA0C2F', '#ffffff', '#BA0C2F'], min: UMBRAL.siempre,
        e: [{ f: 'cruzNordica', c: '#00205B', k: 0.86 }],
        lore: 'A coastline so jagged that measuring it depends on the length of your ruler, folded into fjords that hide everything until you are already inside them. Take the long way. Nothing that matters here is reached in a straight line.'
    },
    SN: {
        n: 'Senegal', b: ['#00853F', '#FDEF42', '#E31B23'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#00853F', k: 0.88 }],
        lore: 'The Lions of Teranga, and Teranga is the word for a hospitality so complete that a stranger is fed before the family eats. It is offered without condition, right up until the exact moment that it is not. Hospitality and ferocity are not opposites here.'
    },
    AR: {
        n: 'Argentina', b: ['#74ACDF', '#ffffff', '#74ACDF'], min: UMBRAL.pronto,
        e: [{ f: 'sol', c: '#F6B40E', k: 0.95 }],
        lore: 'The Sun of May broke through the clouds over Buenos Aires during the revolution, and the whole country decided that was a sign rather than weather. It rises whether or not you were ready for it. Grow into it. Argentina has always bet on itself and won.'
    },
    DZ: {
        n: 'Algeria', b: ['#006233', '#ffffff', '#006233'], min: UMBRAL.pronto,
        e: [{ f: 'luna', c: '#D21034', k: 0.92 }],
        lore: 'The largest country in Africa, most of it Sahara, where the crescent opens toward whatever comes next because there is nothing behind you worth turning around for. What comes next is usually somebody smaller than they think they are.'
    },
    AT: {
        n: 'Austria', b: ['#ED2939', '#ffffff', '#ED2939'], min: UMBRAL.siempre,
        e: null,
        lore: 'Legend says the red and white came from a duke\'s tunic after a battle, soaked through except for the strip under his belt. Eight centuries later it is still three bands and no explanation. Some designs never needed a second draft.'
    },
    CO: {
        n: 'Colombia', b: ['#FCD116', '#003893', '#CE1126'], min: UMBRAL.siempre,
        e: null,
        lore: 'Half the flag is gold, and the proportion is deliberate: the top band is as tall as the other two combined because that is what the land was worth. Do not settle for a third of this map. Go and take your half of everything.'
    },
    PT: {
        n: 'Portugal', b: ['#046A38', '#DA291C', '#A8170F'], min: UMBRAL.siempre,
        e: null,
        lore: 'A country that ran out of coastline and kept going anyway, mapping the edges of the world by sailing straight off them and coming back with the edges redrawn. This arena has edges too. Nobody has checked what is past them lately.'
    },
    CD: {
        n: 'DR Congo', b: ['#007FFF', '#F7D618', '#007FFF'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#CE1021', k: 0.88 }],
        lore: 'A river that crosses the equator twice, so somewhere along it the water is always in flood season no matter what month you name. Whatever direction you think you are going, the Congo has already been there and come back.'
    },
    GB: {
        n: 'United Kingdom', b: ['#012169'], min: UMBRAL.siempre,
        e: [
            { f: 'aspa', c: '#ffffff', k: 1 },
            { f: 'cruzGruesa', c: '#ffffff', k: 1 },
            { f: 'aspaFina', c: '#C8102E', k: 1 },
            { f: 'cruz', c: '#C8102E', k: 1 },
        ],
        lore: 'Three crosses from three kingdoms stacked into one flag by countries that have never fully agreed on anything else, layered until the seams stopped showing. It should not work as a design. It has worked for two hundred years.'
    },
    HR: {
        n: 'Croatia', b: ['#FF0000', '#ffffff', '#171796'], min: UMBRAL.medio,
        e: [{ f: 'damero', c: '#FF0000', k: 0.92 }],
        lore: 'Twenty-five red and white squares, and the first one is always red, a detail that has started actual arguments. Count them if you ever get close enough to a Croatian pill, which tends not to be a thing that happens twice.'
    },
    GH: {
        n: 'Ghana', b: ['#CE1126', '#FCD116', '#006B3F'], min: UMBRAL.pronto,
        e: [{ f: 'estrella', c: '#000000', k: 0.88 }],
        lore: 'The Black Star was the first flag raised when the colonial ones came down, and every African independence movement that followed borrowed something from it. First to break free, and still first to the middle of the map always.'
    },
    CN: {
        n: 'China', b: ['#EE1C25'], min: UMBRAL.siempre,
        e: [
            // La grande, desde el primer pixel. Las cuatro pequeñas solo cuando la
            // banda da de si: a tamaño de partida eran manchas de un pixel.
            { f: 'estrella', c: '#FFFF00', k: 0.62, dx: -0.42 },
            { f: 'arcoEstrellas', c: '#FFFF00', k: 1, min: UMBRAL.medio },
        ],
        lore: 'One large star with four smaller ones turned toward it, each facing the same centre. Build the same thing here: every pill you swallow becomes another point of light orbiting whatever it is you are turning into at that moment.'
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
    const minPais = p.min === undefined ? UMBRAL.medio : p.min;
    return {
        code: String(code).toUpperCase(), nombre: p.n, bandas: p.b, lore: p.lore,
        // `min` por CAPA, no solo por pais: China lleva la estrella grande desde el
        // primer pixel pero las cuatro pequeñas necesitan sitio — dibujadas a
        // tamaño de partida eran cuatro manchas de un pixel que ensuciaban la
        // pildora en vez de leerse como estrellas. Sin declararlo, cada capa
        // hereda el umbral del pais y se comporta como antes.
        capas: (p.e || []).map(c => ({ forma: PAIS_FORMAS[c.f], color: c.c, k: c.k || 1, dx: c.dx || 0, dy: c.dy || 0,
                                       min: c.min === undefined ? minPais : c.min })),
        min: minPais,
    };
}

function paisLista() { return Object.keys(PAISES).map(c => Object.assign({ code: c }, PAISES[c])); }

/* ===== PAGINADO DE LA TIENDA ===== ---------------------------------------
 * El orden de las pestañas NO es el de la tabla: abre la TERCERA tanda (la de
 * Egipto, España y compañia) y siguen la segunda, la cuarta y la primera.
 * Vive aqui, y no en cada tienda, para que /game, la landing y el catalogo
 * ampliado no puedan discrepar: es EL orden, no se reordena desde la interfaz.
 */
const PAIS_ORDEN_PAGINAS = [2, 1, 3, 0];
function paisNumPaginas(porPagina) { return Math.ceil(Object.keys(PAISES).length / porPagina); }
function paisPagina(idx, porPagina) {
    const l = paisLista();
    const real = PAIS_ORDEN_PAGINAS[idx] === undefined ? idx : PAIS_ORDEN_PAGINAS[idx];
    return l.slice(real * porPagina, (real + 1) * porPagina);
}

/* ===== SKINS EN PROPIEDAD ===== ------------------------------------------
 * PROVISIONAL: vive en localStorage, o sea SOLO en este navegador. No es una
 * compra de verdad — el ledger de $PILL y de skill points, quien posee que y
 * que eso persista es trabajo de servidor. Esto existe para poder ver el
 * recorrido de la tienda (comprar -> asignar -> llevarla puesta) sin montar la
 * economia antes de tener el diseño cerrado. Cuando exista el endpoint, estas
 * cuatro funciones son lo unico que hay que cambiar.
 */
// Precio unico para las 32. 250 SP o 25.000 $PILL, o sea 100 $PILL por SP: el
// cambio de 1000 $PILL = 10 SP sale de aqui y no de una segunda constante que
// pudiera quedarse descuadrada.
const PAIS_PRECIO_SP = 250;
const PAIS_PILL_POR_SP = 100;
const PAIS_PRECIO_PILL = PAIS_PRECIO_SP * PAIS_PILL_POR_SP;
function paisPrecioTexto(pill) { return pill >= 1000 ? (pill / 1000) + 'K' : String(pill); }

/* La propiedad la manda el SERVIDOR, no el navegador.
 *
 * Antes esto vivia en localStorage, lo que significaba que cualquiera podia
 * escribirse las 32 skins desde la consola sin pagar nada: el cliente se creia
 * a si mismo. Ahora comprar, equipar y el saldo pasan por /api/skins, que cobra
 * de verdad (SP del ledger o $PILL del saldo WAR, con firma de la wallet).
 *
 * El estado se CACHEA porque las funciones de dibujo lo consultan a cada frame
 * (cellPais mira paisPuesta() en cada celda) y no pueden ser asincronas. La
 * cache se refresca con paisSync() al abrir la tienda y despues de cada compra.
 *
 * Cada pagina declara su contexto (quien soy, que wallet y con que firmo) en
 * paisContexto: /game y la landing los tienen en sitios distintos.
 */
let paisContexto = () => ({ cid: null, wallet: null, provider: null });
function paisSetContexto(fn) { paisContexto = fn; }

let _paisEstado = { sp: 0, pill: 0, owned: [], equipped: null };
function paisMias() { return _paisEstado.owned || []; }
function paisTengo(code) { return paisMias().indexOf(code) !== -1; }
function paisPuesta() { return _paisEstado.equipped || null; }
function paisSp() { return _paisEstado.sp | 0; }
function paisPill() { return _paisEstado.pill | 0; }

function _paisCab() {
    const c = paisContexto();
    return { 'Content-Type': 'application/json', 'X-Client-Id': c.cid || '' };
}

async function paisSync() {
    const c = paisContexto();
    try {
        const url = '/api/skins' + (c.wallet ? '?wallet=' + encodeURIComponent(c.wallet) : '');
        const r = await fetch(url, { headers: { 'X-Client-Id': c.cid || '' }, cache: 'no-store' });
        const j = await r.json();
        if (j && Array.isArray(j.owned)) _paisEstado = j;
    } catch (e) {}
    return _paisEstado;
}

// Firma del gasto en $PILL. El mensaje lleva la cantidad DENTRO, asi que la
// firma de una compra no sirve para gastar otra cantidad distinta.
async function _paisFirma(provider, wallet, mensaje, ts) {
    const res = await provider.signMessage(new TextEncoder().encode(mensaje), 'utf8');
    const bytes = res && res.signature ? res.signature : res;
    return { wallet, message: mensaje, ts, signature: Array.from(bytes) };
}

// nonce por intento: si la respuesta se pierde y el jugador reintenta, el
// servidor reconoce el nonce y no cobra dos veces.
function _paisNonce() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

async function paisComprar(code, moneda) {
    const c = paisContexto();
    if (!c.cid) return { ok: false, error: 'no session' };
    const cuerpo = { code, moneda, nonce: _paisNonce(), wallet: c.wallet || null };
    if (moneda === 'pill') {
        if (!c.wallet || !c.provider) return { ok: false, error: 'connect your wallet first' };
        const ts = Date.now();
        try {
            cuerpo.pay = await _paisFirma(c.provider, c.wallet, `PillWars buy skin ${code} for ${PAIS_PRECIO_PILL} PILL @ ${ts}`, ts);
        } catch (e) { return { ok: false, error: 'you must sign the payment' }; }
    }
    try {
        const r = await fetch('/api/skins/buy', { method: 'POST', headers: _paisCab(), body: JSON.stringify(cuerpo) });
        const j = await r.json();
        if (j.estado) _paisEstado = j.estado;
        return j;
    } catch (e) { return { ok: false, error: 'server unreachable' }; }
}

// code = null quita la skin y devuelve la pildora de dos colores de siempre.
async function paisPoner(code) {
    const c = paisContexto();
    if (!c.cid) return { ok: false, error: 'no session' };
    try {
        const r = await fetch('/api/skins/equip', { method: 'POST', headers: _paisCab(), body: JSON.stringify({ code, wallet: c.wallet || null }) });
        const j = await r.json();
        if (j.estado) _paisEstado = j.estado;
        return j;
    } catch (e) { return { ok: false, error: 'server unreachable' }; }
}

async function paisConvertir(pill) {
    const c = paisContexto();
    if (!c.wallet || !c.provider) return { ok: false, error: 'connect your wallet first' };
    const ts = Date.now();
    let pay;
    try {
        pay = await _paisFirma(c.provider, c.wallet, `PillWars convert ${pill} PILL to ${pill / PAIS_PILL_POR_SP} SP @ ${ts}`, ts);
    } catch (e) { return { ok: false, error: 'you must sign the exchange' }; }
    try {
        const r = await fetch('/api/skins/convert', { method: 'POST', headers: _paisCab(), body: JSON.stringify({ pill, nonce: _paisNonce(), wallet: c.wallet, pay }) });
        const j = await r.json();
        if (j.estado) _paisEstado = j.estado;
        return j;
    } catch (e) { return { ok: false, error: 'server unreachable' }; }
}

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
    // Cada capa entra por SU cuenta segun su propio umbral, asi que una pildora
    // puede llevar ya su forma principal y todavia no los detalles pequeños.
    const bandaPx = medio * 2;
    const capas = skin.capas
        .filter(l => forzarEmblema || bandaPx >= l.min)
        .map(l => ({ f: l.forma, c: _rgb(l.color), k: l.k, dx: l.dx, dy: l.dy }));
    const embOn = capas.length > 0;
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

        let base = nBandas === 1 ? rgb[0]
                 : nBandas === 2 ? (ly < 0 ? rgb[0] : rgb[1])
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
        // Costuras: ninguna con una sola banda, una en ly=0 con dos, dos en
        // +-medio con tres. Con banda unica la costura sobra por definicion — no
        // hay dos colores que separar, y la raya oscura era justo lo que hacia
        // que una bandera de un solo color siguiera pareciendo de tres franjas.
        const enCostura = nBandas === 1 ? false
                        : nBandas === 2 ? Math.abs(ly) < 1.45 * kD
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

/* ===== CARTEL DE DETALLE (COMPARTIDO) ===== -------------------------------
 * UNA sola implementacion del cartel que sale al pulsar un pais, usada por la
 * landing y por /game. Antes eran dos copias con su propio marcado, su propio
 * CSS y su propio JS: se veian distintas y cualquier retoque habia que hacerlo
 * dos veces (y una de las dos se quedaba atras). Ahora se toca aqui y cambia en
 * los dos sitios.
 *
 * El cartel se monta una sola vez, la primera vez que se abre, y se queda en el
 * documento. Los precios y los rotulos salen de las constantes de arriba.
 *
 * `onCambio` (opcional) avisa al que lo abrio de que hubo compra o asignacion,
 * para que refresque su rejilla.
 */
const PAIS_MODAL_ID = 'paisModal';
let _paisOnCambio = null, _paisCodeAbierto = null;

function _paisModalCSS() {
    return `
    #${PAIS_MODAL_ID} { display:none; position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.85);
        align-items:center; justify-content:center; padding:24px; }
    #${PAIS_MODAL_ID}.on { display:flex; }
    /* CURSOR DEL SISTEMA, siempre. Se intento esconderlo para que se viera la
       pildora de #custom-cursor, pero en /game esa pildora no existe y en la
       landing el cursor propio solo aparece tras un mousemove real y no siempre
       llegaba: el resultado era una ventana SIN NINGUN cursor justo cuando vas a
       pulsar comprar. El !important es para ganarle al cursor:none que la landing
       pone en el body, que si no lo hereda todo lo de dentro.
       OJO: este bloque es un template literal, asi que aqui dentro NO puede haber
       comillas invertidas — cierran la cadena y parten el fichero entero. */
    #${PAIS_MODAL_ID}, #${PAIS_MODAL_ID} * { cursor: default !important; }
    #${PAIS_MODAL_ID} .pm-x, #${PAIS_MODAL_ID} .pm-btn, #${PAIS_MODAL_ID} .pm-prev, #${PAIS_MODAL_ID} .pm-prevcv { cursor: pointer !important; }
    /* El marco ya NO es un PNG: es el mismo marco "placa" pixel del resto del
       menu (ver _pmFrameDraw mas abajo), pintado en el canvas .pm-frame que
       ocupa toda la caja. .pm-inner reserva el grosor de ese marco como
       padding (fijado por JS, drawFrame) para que el contenido no se meta
       debajo. Las variantes pm-v2/pm-v2g/pm-v3g de antes (comparar marcos PNG)
       ya no aplican: solo hay un marco, asi que esas clases no pintan nada —
       se dejan sin regla para no romper paisModalVariante(), que las sigue
       poniendo desde el editor. */
    #${PAIS_MODAL_ID} .pm-caja { position:relative; width:100%; max-width:var(--pm-ancho,780px); box-sizing:border-box; }
    /* width/height al 100% SI O SI: un canvas es un elemento REEMPLAZADO, asi
       que con solo inset:0 no se estira — se queda a su tamano intrinseco (el
       del atributo width) en la esquina, y el marco salia pequeno arriba a la
       izquierda mientras el contenido seguia a su tamano real. */
    #${PAIS_MODAL_ID} .pm-frame { position:absolute; inset:0; width:100%; height:100%;
        z-index:0; pointer-events:none; image-rendering:pixelated; }
    #${PAIS_MODAL_ID} .pm-inner { position:relative; z-index:1; box-sizing:border-box;
        max-height:92vh; overflow-y:auto; }
    /* El nombre deja hueco a la derecha para la flecha y el CLOSE, que van
       absolutos justo encima de esa esquina. */
    #${PAIS_MODAL_ID} .pm-page1 .pm-nom { padding-right:150px; }
    /* Columna: cabecera arriba (alto fijo) y debajo la pagina. La 2 se queda
       con todo lo que sobra (flex:1) para que el cartel no cambie de tamano al
       pasar de una a otra. */
    #${PAIS_MODAL_ID} .pm-content { box-sizing:border-box; padding:var(--pm-pad,26px 34px 30px);
        display:flex; flex-direction:column; }
    #${PAIS_MODAL_ID} .pm-page1 { flex:none; }
    /* Cabecera DENTRO de la pantalla, no flotando sobre el marco: flecha y
       CLOSE pegados a la derecha, igual que la tienda ampliada lleva su SP y su
       CLOSE dentro del cuadro. La flecha va a la izquierda del CLOSE.
       ABSOLUTA a proposito: en el hueco de arriba a la derecha ya no hay nada
       (el nombre es corto), asi que no hace falta bajar el contenido una fila
       entera para meterlos — caben donde estan. */
    #${PAIS_MODAL_ID} .pm-top { position:absolute; top:var(--pm-top-y,62px); right:var(--pm-top-x,60px);
        z-index:3; display:flex; align-items:center; gap:10px; }
    /* Flecha: la misma forma y hover que .side-tabs-arrow (la del cartel de
       MISSIONS/SKINS), del color del modo, pero mas grande. */
    #${PAIS_MODAL_ID} .pm-prev { width:32px; height:32px; padding:0; border-radius:50%; background:transparent;
        border:1px solid var(--pm-modo,#00ffaa); color:var(--pm-modo,#00ffaa);
        font-family:'Russo One',sans-serif; font-size:19px; line-height:1; }
    #${PAIS_MODAL_ID} .pm-prev:hover { background:var(--pm-modo,#00ffaa); color:#04150c; }
    /* CLOSE: identico al de la tienda ampliada (.sb-close). */
    #${PAIS_MODAL_ID} .pm-x { background:transparent; border:2px solid #2c3630; color:#7d8a82;
        font-family:'Russo One',sans-serif; font-size:12px; padding:6px 14px;
        letter-spacing:1.5px; text-transform:uppercase; line-height:1; }
    #${PAIS_MODAL_ID} .pm-x:hover { border-color:#4a5a52; color:#fff; }
    /* Pagina 2: la partida en pequeno. Ocupa TODO el hueco que dejaba la
       pagina 1 (el alto lo fija paisModalPagina) para que el cartel no cambie
       de tamano al pasar de una a otra; el canvas se estira con el, asi que la
       cuadricula se adapta sola a un marco mas cuadrado. */
    #${PAIS_MODAL_ID} .pm-page2 { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:10px;
        flex:1; min-height:0; }
    #${PAIS_MODAL_ID} .pm-page2 canvas { width:100%; height:430px; image-rendering:pixelated; display:block; }
    #${PAIS_MODAL_ID} .pm-prevnom { display:none; }
    /* Sin margen arriba: el nombre es lo PRIMERO del cartel desde que se quito
       el codigo de dos letras que iba encima. */
    #${PAIS_MODAL_ID} .pm-nom { font-family:'Press Start 2P',monospace; font-size:var(--pm-fs-nom,17px);
        color:#fff; text-shadow:2px 2px 0 #000; margin:0; line-height:1.4; }
    #${PAIS_MODAL_ID} .pm-lore { font-family:'VT323',monospace; font-size:var(--pm-fs-lore,21px); line-height:1.45;
        color:#cfd6d0; text-shadow:1px 1px 0 rgba(0,0,0,.7); margin-top:var(--pm-gap,14px);
        border-left:3px solid rgba(0,255,136,.4); padding-left:14px; }
    #${PAIS_MODAL_ID} .pm-franjas { display:flex; gap:5px; margin-top:var(--pm-gap,14px); }
    #${PAIS_MODAL_ID} .pm-franjas i { flex:1; height:14px; border:1px solid rgba(255,255,255,.16); }
    /* Centrado y no alineado por abajo: cada canvas es un CUADRADO con la
       pildora dentro, asi que por abajo se alinean los cuadrados y las pildoras
       salen descuadradas. */
    /* Fondo = el REAL de la arena, los mismos valores que usa el juego
       (--bg-color #050505 y --grid-line rgba(255,255,255,.03) en game/index.html):
       la gracia de ver la pildora a sus cinco tamaños es ver como quedara en
       partida, asi que el fondo tiene que ser el de partida, no uno tenido del
       color del modo como estaba antes. */
    #${PAIS_MODAL_ID} .pm-crece { display:flex; align-items:center; justify-content:center;
        gap:var(--pm-crece-gap,18px); margin-top:var(--pm-gap,14px); padding:var(--pm-crece-pad,20px 16px);
        background-color:#050505;
        background-image:linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
        background-size:25px 25px;
        border:2px solid rgba(0,0,0,.5); overflow-x:auto; }
    #${PAIS_MODAL_ID} .pm-crece canvas { image-rendering:pixelated; display:block; flex:none; }
    #${PAIS_MODAL_ID} .pm-pie { font-family:'Press Start 2P',monospace; font-size:var(--pm-fs-pie,7px);
        color:#9aa3ac; letter-spacing:.5px; text-align:center; margin-top:12px; line-height:1.7; }
    #${PAIS_MODAL_ID} .pm-btns { display:flex; gap:var(--pm-btn-gap,14px); margin-top:var(--pm-gap-btn,22px); }
    /* Botones: mismo dibujo "placa" macizo que PLAY/SETTINGS y CONNECT/DEPOSIT
       en el menu (ver _pmPlateUrl), no los PNG btn-plain-*.png de antes. El
       fondo lo pone JS (background-image con el dataURL); aqui solo el resto. */
    #${PAIS_MODAL_ID} .pm-btn { flex:1; height:var(--pm-btn-h,50px); padding:0; border:none; box-shadow:none;
        display:flex; align-items:center; justify-content:center; image-rendering:pixelated;
        /* El boton nativo trae su propio fondo gris claro (rgb(240,240,240));
           sin anularlo se cuela por las esquinas transparentes del chaflan de
           la placa y se ven como un reborde blanco. */
        background-color:transparent; background-size:100% 100%; background-repeat:no-repeat;
        font-family:'Press Start 2P',monospace; font-size:var(--pm-fs-btn,10px); color:#fff;
        text-shadow:2px 2px 0 rgba(0,0,0,.75); }
    #${PAIS_MODAL_ID} .pm-btn:hover:not(:disabled) { filter:brightness(1.15); }
    #${PAIS_MODAL_ID} .pm-btn:active:not(:disabled) { transform:translate(2px,2px); }
    #${PAIS_MODAL_ID} .pm-btn:disabled { filter:grayscale(.6) brightness(.85); cursor:default; }
    @media (max-width:620px) { #${PAIS_MODAL_ID} .pm-btns { flex-direction:column; } }
    `;
}
/* ===== Marco "placa" pixel para el cartel de detalle =====
 * Mismo dibujo que el marco del menu (game/index.html: PLACA/placaPixels) —
 * anillo con reborde oscuro del propio color, bisel arriba-izquierda y
 * esquinas en escalon — pero AUTONOMO: esta funcion no depende de nada de
 * game/index.html porque este fichero tambien lo carga la landing sola.
 */
// PM_SUB parte el pixel del marco igual que PLACA.SUB en game/index.html: a un
// pixel por cuadricula el canto solo daba para un chaflan de peldaños. El resto
// de medidas van multiplicadas por el, asi que el marco ocupa lo mismo en
// pantalla y solo cambia el detalle.
const PM_SUB = 2;
const PM_SCALE = 4 / PM_SUB, PM_FRAME_T = 10 * PM_SUB, PM_FRAME_CUT = 5 * PM_SUB;
const PM_RADIO = 9 * PM_SUB;      // esquina redonda exterior
const PM_RADIO_HUECO = 4 * PM_SUB;
// Los MISMOS tonos que el marco del menu (PLACA.TONOS): contorno oscuro que
// recorta la silueta, bisel claro por donde entra la luz y cuerpo macizo. Este
// cartel llevaba todavia el reparto viejo —contorno claro 0.42 y cuerpo casi
// negro 0.12—, asi que al ampliar una skin aparecia el marco de antes.
const PM_TONOS = { rim: 0.16, lit: 0.75, mid: 0.45, dim: 0.24, inner: 0.36, body: 0.30 };
const PM_SCREEN = [9, 20, 15];
const PM_LX = -0.6, PM_LY = -0.75;
function _pmFrameDraw(cv, wCss, hCss, hex) {
    const W = Math.max(24, Math.round(wCss / PM_SCALE)), H = Math.max(18, Math.round(hCss / PM_SCALE));
    const key = W + '|' + H + '|' + hex;
    if (cv._pmKey === key) return PM_FRAME_T * PM_SCALE;
    cv._pmKey = key;
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const rgb = _rgb(hex);
    const sh = f => rgb.map(v => Math.round(v * f));
    const T = PM_FRAME_T;
    // Esquina redonda de verdad (con PM_SUB hay pixeles para ella).
    const esquina = (dx, dy, radio) => {
        if (PM_SUB < 2) { const c = PM_FRAME_CUT; return dx >= c || dy >= c || dx + dy >= c; }
        if (dx >= radio || dy >= radio) return true;
        const ex = radio - dx, ey = radio - dy;
        return ex * ex + ey * ey <= radio * radio;
    };
    const inOuter = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        return esquina(Math.min(x, W - 1 - x), Math.min(y, H - 1 - y), PM_RADIO);
    };
    const inHole = (x, y) => {
        if (x < T || y < T || x >= W - T || y >= H - T) return false;
        return esquina(Math.min(x - T, W - T - 1 - x), Math.min(y - T, H - T - 1 - y), PM_RADIO_HUECO);
    };
    const inBand = (x, y) => inOuter(x, y) && !inHole(x, y);
    const img = g.createImageData(W, H), px = img.data;
    const C_RIM = sh(PM_TONOS.rim), C_LIT = sh(PM_TONOS.lit), C_DIM = sh(PM_TONOS.dim),
          C_MID = sh(PM_TONOS.mid), C_INNER = sh(PM_TONOS.inner), C_BODY = sh(PM_TONOS.body);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = ((y * W + x) << 2);
        if (!inOuter(x, y)) continue;
        if (inHole(x, y)) { px[i] = PM_SCREEN[0]; px[i + 1] = PM_SCREEN[1]; px[i + 2] = PM_SCREEN[2]; px[i + 3] = 255; continue; }
        // Umbrales en pixeles de CUADRICULA: por eso van por PM_SUB. Sin eso,
        // al doblar la resolucion cada banda quedaba a la mitad de grosor.
        const HASTA = 3 * PM_SUB;
        let ring = HASTA;
        for (let r = 1; r <= HASTA && ring === HASTA; r++) {
            for (let oy = -1; oy <= 1 && ring === HASTA; oy++) for (let ox = -1; ox <= 1; ox++) {
                if ((!ox && !oy) || inBand(x + ox * r, y + oy * r)) continue;
                ring = r - 1; break;
            }
        }
        let col;
        if (ring < PM_SUB) col = C_RIM;
        else if (ring < 2 * PM_SUB) {
            let nx = 0, ny = 0;
            for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
                if ((!ox && !oy) || inBand(x + ox, y + oy)) continue;
                const d = Math.hypot(ox, oy); nx += ox / d; ny += oy / d;
            }
            const l = Math.hypot(nx, ny) || 1;
            const ndl = (nx / l) * PM_LX + (ny / l) * PM_LY;
            col = ndl > 0.15 ? C_LIT : ndl < -0.15 ? C_DIM : C_MID;
        } else if (ring < 3 * PM_SUB) col = C_INNER;
        else col = C_BODY;
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return PM_FRAME_T * PM_SCALE;
}
/* Placa MACIZA (sin hueco) para los botones del cartel: mismo dibujo que
 * placaPlateUrl() en game/index.html — reborde oscuro del propio color y
 * bisel claro arriba-izquierda —, autonoma por el mismo motivo de arriba. */
function _pmPlateUrl(wCss, hCss, hex) {
    const W = Math.max(10, Math.round(wCss / PM_SCALE)), H = Math.max(8, Math.round(hCss / PM_SCALE));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const rgb = _rgb(hex);
    const sh = f => rgb.map(v => Math.min(255, Math.round(v * f)));
    const lit = t => rgb.map(v => Math.round(v + (255 - v) * t));
    const CUT = 2 * PM_SUB, RADIO = 5 * PM_SUB;
    const inside = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
        if (PM_SUB < 2) return dx >= CUT || dy >= CUT || dx + dy >= CUT;
        if (dx >= RADIO || dy >= RADIO) return true;
        const ex = RADIO - dx, ey = RADIO - dy;
        return ex * ex + ey * ey <= RADIO * RADIO;
    };
    const img = g.createImageData(W, H), px = img.data;
    const C_RIM = sh(0.38), C_LIT = lit(0.32), C_DIM = sh(0.70);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!inside(x, y)) continue;
        const HASTA = 2 * PM_SUB;
        let ring = HASTA;
        for (let r = 1; r <= HASTA && ring === HASTA; r++) {
            for (let oy = -1; oy <= 1 && ring === HASTA; oy++) for (let ox = -1; ox <= 1; ox++) {
                if ((!ox && !oy) || inside(x + ox * r, y + oy * r)) continue;
                ring = r - 1; break;
            }
        }
        const col = ring < PM_SUB ? C_RIM
            : ring < 2 * PM_SUB ? (Math.min(y, x) <= Math.min(H - 1 - y, W - 1 - x) ? C_LIT : C_DIM)
            : rgb;
        const i = ((y * W + x) << 2);
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL();
}
const PM_ROJO = '#f62a2d', PM_VERDE = '#00d97e';
// Color del modo activo (mismo criterio que usa paisModalAbrir para --pm-grid).
function _pmModoHex() {
    const panelModo = document.getElementById('missionsPanel');
    return panelModo && panelModo.classList.contains('arcade') ? '#ccff00' : '#00ffaa';
}
/* Sonido. SoundManager vive en game/index.html, asi que en la landing (que
 * carga este fichero suelto) no existe: se comprueba antes de cada uso en vez
 * de asumirlo, si no la tienda de la web petaria al pulsar cualquier boton. */
function _pmSnd(nombre) {
    try { if (typeof SoundManager !== 'undefined') SoundManager.play(nombre); } catch (e) {}
}
function _pmSndHover() {
    try { if (typeof SoundManager !== 'undefined') SoundManager.playSimpleHover(); } catch (e) {}
}
// Repinta el marco de la caja abierta a su tamano actual. Se llama al abrir,
// al cambiar de pagina (el contenido cambia de alto) y en resize.
function _pmRedibujaMarco() {
    const caja = document.querySelector('#' + PAIS_MODAL_ID + ' .pm-caja');
    const cv = document.querySelector('#' + PAIS_MODAL_ID + ' .pm-frame');
    const inner = document.querySelector('#' + PAIS_MODAL_ID + ' .pm-inner');
    if (!caja || !cv || !inner || !caja.clientWidth) return;
    const primero = !inner.style.padding;
    const hex = _pmModoHex();
    // La X y la flecha leen este color, asi se tinen solas con el modo.
    caja.style.setProperty('--pm-modo', hex);
    const T = _pmFrameDraw(cv, caja.clientWidth, caja.clientHeight, hex);
    inner.style.padding = T + 'px';
    // La primera vez, el alto se midio SIN el padding que acabamos de poner (el
    // marco crece la caja 2*T mas): se repite una vez para que salga ya del
    // tamano final, no del de antes de aplicar el padding.
    if (primero) _pmRedibujaMarco();
}

// La landing carga este fichero desde game/, asi que las rutas del arte tienen
// que salir del sitio real del <script> y no de la pagina que lo incluye.
function _paisBase() {
    const s = document.currentScript || [...document.querySelectorAll('script[src*="paises-pixel"]')].pop();
    const src = s ? s.getAttribute('src') : '';
    return src.replace(/paises-pixel\.js.*$/, '');
}
const _PAIS_BASE = typeof document !== 'undefined' ? _paisBase() : '';

/*
 * Lo que David afina de este cartel desde el editor: el MARCO ('' = el gris V2
 * por defecto, 'v2' = verde alto, 'v3g' = el otro gris) y el sitio y el tamaño
 * de cada pieza. Todo vive junto en la clave paisModal del layout de carteles.
 *
 * Se resuelve aqui y no en carteles-layout.js porque la LANDING no carga ese
 * fichero — solo este — y el cartel tiene que salir IGUAL en los dos sitios.
 * En el juego, CARTEL_LAYOUT ya esta cargado y no se pide nada; en la landing
 * se pide lo mismo que pide el juego, con el override del servidor por encima
 * de los valores de fabrica del repo.
 *
 * Las piezas son las mismas que declara CARTEL_SURFACES.paisModal en
 * carteles-layout.js (que es lo que lista el editor). Estan repetidas aqui
 * porque la landing no tiene aquel fichero; si se añade una pieza al cartel,
 * hay que darla de alta en los dos sitios.
 */
const PAIS_PARTES = { title: '.pm-nom', desc: '.pm-lore', crece: '.pm-crece', pie: '.pm-pie', actions: '.pm-btns' };

let _paisDescargado = null;  // solo landing: lo que trajo el fetch de aqui abajo
let _paisVarPedida = false;

/*
 * Lo guardado para paisModal, LEIDO EN CADA APERTURA y no cacheado: dentro del
 * juego CARTEL_LAYOUT se rellena de forma asincrona (CARTEL_LAYOUT_READY), asi
 * que una copia tomada al montar el cartel podia ser el {} de antes de que
 * llegara el JSON y se quedaba vieja para siempre.
 */
function _paisAjuste() {
    if (typeof CARTEL_LAYOUT === 'object' && CARTEL_LAYOUT) return CARTEL_LAYOUT.paisModal || null;
    return _paisDescargado;
}
function _paisVarianteActual() { const v = _paisAjuste(); return (v && v.variante) || ''; }

// La landing no carga carteles-layout.js, asi que se descarga lo mismo que el
// juego: fabrica del repo + override del servidor, y manda el override.
function _paisPideVariante() {
    if (_paisVarPedida || typeof CARTEL_LAYOUT === 'object') return;
    _paisVarPedida = true;
    const pide = u => fetch(u, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    Promise.all([pide(_PAIS_BASE + 'carteles-layout.json'), pide('/api/carteles-layout')])
        .then(([fabrica, override]) => {
            _paisDescargado = Object.assign({}, fabrica, override).paisModal || null;
            // Si el cartel ya estaba abierto cuando llego la respuesta, se
            // repinta; si no, lo coge en la proxima apertura.
            paisModalVariante(_paisVarianteActual());
            _paisAplicaAjuste();
        });
}

/*
 * Coloca las piezas donde las dejo el editor. Mismo calculo que
 * applyCartelSurface() en carteles-layout.js — translate + scale y no margenes,
 * para que mover una pieza no reflote a las de al lado.
 *
 * Se llama SIEMPRE, tambien dentro del juego, en vez de tirar de
 * applyCartelSurface() cuando existe: con dos caminos, la landing (que no tiene
 * aquella funcion) se quedaba sin aplicar NADA y el cartel salia distinto en
 * cada sitio, que es justo lo que el editor promete que no pasa.
 */
function _paisAplicaAjuste() {
    const caja = document.getElementById(PAIS_MODAL_ID);
    if (!caja) return;
    const v = _paisAjuste();
    for (const parte of Object.keys(PAIS_PARTES)) {
        const el = caja.querySelector(PAIS_PARTES[parte]);
        if (!el) continue;
        const t = v && v[parte];
        if (!t) { el.style.removeProperty('transform'); continue; }
        const x = +t.x || 0, y = +t.y || 0, s = (typeof t.s === 'number' && t.s > 0) ? t.s : 1;
        el.style.setProperty('transform', 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')', 'important');
        el.style.setProperty('transform-origin', 'center', 'important');
    }
}

function paisModalMontar() {
    if (document.getElementById(PAIS_MODAL_ID)) return;
    _paisPideVariante();
    const st = document.createElement('style'); st.id = 'paisModalCss'; st.textContent = _paisModalCSS();
    document.head.appendChild(st);
    const d = document.createElement('div'); d.id = PAIS_MODAL_ID;
    d.innerHTML =
        '<div class="pm-caja">' +
        '<canvas class="pm-frame"></canvas>' +
        '<div class="pm-inner">' +
        '<div class="pm-content">' +
        '<div class="pm-top">' +
        '<button class="pm-prev" title="See it in action">\u203A</button>' +
        '<button class="pm-x">CLOSE</button>' +
        '</div>' +
        '<div class="pm-nom"></div>' +
        '<div class="pm-page1">' +
        '<div class="pm-lore"></div>' +
        '<div class="pm-franjas"></div><div class="pm-crece"></div><div class="pm-pie"></div>' +
        '<div class="pm-btns"></div>' +
        '</div>' +
        '<div class="pm-page2" style="display:none">' +
        '<canvas class="pm-prevcv"></canvas>' +
        '<div class="pm-prevnom"></div>' +
        '</div>' +
        '</div></div></div>';
    document.body.appendChild(d);
    d.querySelector('.pm-x').addEventListener('click', () => { _pmSnd('simpleselect'); paisModalCerrar(); });
    d.querySelector('.pm-prev').addEventListener('click', e => {
        e.stopPropagation(); _pmSnd('simpleselect');
        paisModalPagina(_pmPagina === 2 ? 1 : 2);
    });
    // Click en la pantallita: congela la simulacion en el frame en el que
    // este. Vuelve a pulsar para seguir. No usa paisModalPagina porque no
    // cambia de pagina, solo pausa.
    d.querySelector('.pm-prevcv').addEventListener('click', e => { e.stopPropagation(); _pmPreviaPausa = !_pmPreviaPausa; });
    [d.querySelector('.pm-x'), d.querySelector('.pm-prev')].forEach(b =>
        b.addEventListener('mouseenter', () => _pmSndHover()));
    d.addEventListener('click', e => { if (e.target === d) paisModalCerrar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') paisModalCerrar(); });
    // El marco depende del tamano REAL de la caja (--pm-ancho, o el hueco que
    // deje la pantalla si es mas estrecha), asi que se repinta en cada resize
    // mientras el cartel este abierto.
    window.addEventListener('resize', () => { if (d.classList.contains('on')) _pmRedibujaMarco(); });
}

/* ===== Pagina 2 del cartel: la skin, en partida =====
 * MISMA tarjeta, mismo marco: la flecha de la derecha da la vuelta al
 * contenido en vez de abrir nada aparte.
 *
 * Esto NO es una animacion inventada: es una partida de verdad en peque\u00F1o.
 * Fondo de la arena real (--bg-color #050505 con su rejilla, los mismos
 * valores que usa pixBgPattern en el juego), comida de verdad repartida por
 * el mapa, y la pildora nadando hacia la comida mas cercana, comiendosela y
 * creciendo con cada bocado. Cuando llega al tamano tope, vuelve a nacer
 * peque\u00F1a y se repite, como un video en bucle.
 *
 * La camara sigue a la pildora igual que en el juego, asi que ella se ve
 * siempre centrada y lo que se desplaza es el mundo. Un click en la
 * pantallita congela la simulacion en el frame en el que este (para poder
 * pararla en la pose que se quiera); otro click la reanuda.
 */
let _pmPagina = 1, _pmPreviaRaf = 0;
let _pmPreviaPausa = false, _pmPreviaUlt = 0, _pmSim = null, _pmAltoP1 = 0;
// Colores de comida del juego (los mismos que la deco del menu).
const PM_COMIDA_COL = ['#ffffff', '#00ffaa', '#ccff00', '#ff5fa2', '#4d9bff', '#ffce3d'];
const PM_ARENA_BG = '#050505', PM_ARENA_GRID = 'rgba(255,255,255,0.06)';
const PM_WL_MIN = 12, PM_WL_MAX = 50;  // de recien nacida a tope del bucle
const PM_MUNDO = 360;                  // radio del trozo de mapa simulado, en px lowres
const PM_ANG = -Math.PI / 4;           // inclinacion FIJA de la capsula (no gira)
const PM_COMIDA_N = 240;               // poblacion de comida del trozo de mapa
const PM_SPRINT_MS = 1100, PM_SPRINT_X = 2.6;   // duracion y multiplicador del aceleron
function paisModalPagina(n) {
    const d = document.getElementById(PAIS_MODAL_ID); if (!d) return;
    const p1 = d.querySelector('.pm-page1'), p2 = d.querySelector('.pm-page2');
    const content = d.querySelector('.pm-content');
    // El alto de la pagina 1 manda: se mide ANTES de esconderla y se le fija al
    // contenedor, para que el cartel (y con el, el marco) mida exactamente lo
    // mismo en las dos paginas. Sin esto el marco encogia al pasar a la 2.
    // Se mide el CONTENEDOR, no .pm-page1: .pm-content es border-box y lleva
    // ~74px de padding propio, asi que darle el alto de la pagina le quitaba
    // justo ese padding y el cartel encogia esos 74px.
    if (_pmPagina === 1 && content.offsetHeight) _pmAltoP1 = content.offsetHeight;
    _pmPagina = n;
    p1.style.display = n === 1 ? '' : 'none';
    p2.style.display = n === 2 ? 'flex' : 'none';
    // El glifo NO cambia: siempre '\u203A'. Es el mismo boton de ida y vuelta, y
    // verlo girar a '\u2039' se leia como si fuera otro control distinto.
    content.style.height = (n === 2 && _pmAltoP1) ? _pmAltoP1 + 'px' : '';
    cancelAnimationFrame(_pmPreviaRaf); _pmPreviaRaf = 0;
    if (n === 2) {
        d.querySelector('.pm-prevnom').textContent = (paisSkin(_paisCodeAbierto) || {}).nombre || _paisCodeAbierto;
        // OJO: aqui NO se reinicia la partida ni la pausa. Ir a la descripcion
        // y volver tiene que dejarlo todo como estaba (incluida la pausa); lo
        // unico que empieza de cero es cerrar el cartel (paisModalCerrar).
        _pmPreviaUlt = 0;
        if (!_pmSim) _pmSimReset();
        _pmPreviaPinta();
    }
    // El marco se repinta igual: el ancho puede cambiar aunque el alto no.
    // Sincrono, no en rAF: leer clientWidth/Height fuerza el reflow con el
    // display ya cambiado, asi que no hay parpadeo del tamano viejo.
    _pmRedibujaMarco();
}
// Estado de la mini-partida. La pildora nace en el centro del trozo de mapa y
// la comida se reparte alrededor, en coordenadas de MUNDO (no de pantalla):
// la camara se encarga de traducirlas luego.
function _pmSimReset() {
    _pmSim = { x: 0, y: 0, wL: PM_WL_MIN, comida: [], virus: [], sprint: 0, sprintUsado: false, t: 0 };
    for (let i = 0; i < PM_COMIDA_N; i++) _pmSim.comida.push(_pmComidaNueva());
    // Virus: decorado de mapa. La pildora los IGNORA (ni los busca ni choca),
    // estan para que la escena se parezca a una partida de verdad.
    for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, r = 90 + Math.sqrt(Math.random()) * (PM_MUNDO - 90);
        _pmSim.virus.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 13 + Math.random() * 5 });
    }
}
function _pmComidaNueva() {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * PM_MUNDO;
    return {
        x: Math.cos(a) * r, y: Math.sin(a) * r,
        r: 2 + Math.random() * 1.5,
        c: PM_COMIDA_COL[(Math.random() * PM_COMIDA_COL.length) | 0]
    };
}
// Un paso de simulacion: buscar la comida mas cercana, ir a por ella,
// comersela si se alcanza y crecer. dt en ms. La pildora NO rota: en el juego
// las pildoras no giran sobre si mismas, solo se desplazan.
function _pmSimPaso(dt) {
    const s = _pmSim;
    // Radio de colision de la pildora: el sprite mide wL de ancho y el doble
    // de largo (PAIS_PILL_RATIO), asi que el semiancho es la medida honesta
    // para "me la he comido".
    const rPill = s.wL * 0.5;
    let mejor = null, mejorD = Infinity;
    for (const f of s.comida) {
        const dx = f.x - s.x, dy = f.y - s.y, d = dx * dx + dy * dy;
        if (d < mejorD) { mejorD = d; mejor = f; }
    }
    s.t += dt;
    // SPRINT: a mitad del bucle pega un aceleron, una vez por vuelta, para que
    // se vea la habilidad y no solo el paseo.
    if (s.sprint > 0) s.sprint -= dt;
    else if (!s.sprintUsado && s.wL > (PM_WL_MIN + PM_WL_MAX) / 2) {
        s.sprint = PM_SPRINT_MS; s.sprintUsado = true;
    }
    if (mejor) {
        const dx = mejor.x - s.x, dy = mejor.y - s.y, d = Math.hypot(dx, dy) || 1;
        // Velocidad: la grande se mueve algo mas lenta que la chica, como en
        // el juego, pero sin llegar a pararse.
        const base = 66 - 24 * (s.wL - PM_WL_MIN) / (PM_WL_MAX - PM_WL_MIN);
        const v = base * (s.sprint > 0 ? PM_SPRINT_X : 1) * (dt / 1000);
        s.x += (dx / d) * v; s.y += (dy / d) * v;
        if (d < rPill + mejor.r) {
            // Bocado: la comida desaparece, la pildora crece y entra otra por
            // el mapa (la poblacion se mantiene, como en partida).
            s.comida.splice(s.comida.indexOf(mejor), 1);
            s.comida.push(_pmComidaNueva());
            s.wL += 1.5;
        }
    }
    if (s.wL >= PM_WL_MAX) _pmSimReset();   // tope: vuelve a empezar el bucle
}
function _pmPreviaPinta() {
    const d = document.getElementById(PAIS_MODAL_ID);
    if (!d || !d.classList.contains('on') || _pmPagina !== 2) return;
    _pmPreviaRaf = requestAnimationFrame(_pmPreviaPinta);
    const cv = d.querySelector('.pm-prevcv');
    if (!cv || !cv.clientWidth) return;
    // El canvas ya tiene su proporcion por CSS (aspect-ratio en
    // _paisModalCSS): la resolucion lowres solo tiene que guardarla.
    const H = 165, W = Math.max(24, Math.round(cv.clientWidth / cv.clientHeight * H));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;

    // dt propio: asi el click puede congelar la simulacion (dt = 0) sin
    // depender de saltarse frames.
    const ahora = performance.now();
    const dt = _pmPreviaPausa ? 0 : Math.min(50, ahora - (_pmPreviaUlt || ahora));
    _pmPreviaUlt = ahora;
    if (!_pmSim) _pmSimReset();
    if (dt) _pmSimPaso(dt);
    const s = _pmSim;

    // Camara centrada en la pildora, igual que en el juego: ella se ve quieta
    // en el centro y lo que se mueve es el mapa.
    const camX = s.x - W / 2, camY = s.y - H / 2;

    // Fondo REAL de la arena: el negro por defecto del juego con su rejilla.
    g.fillStyle = PM_ARENA_BG; g.fillRect(0, 0, W, H);
    const GRID = 25;
    g.fillStyle = PM_ARENA_GRID;
    const gx0 = Math.floor(camX / GRID) * GRID, gy0 = Math.floor(camY / GRID) * GRID;
    for (let x = gx0; x < camX + W + GRID; x += GRID) g.fillRect(Math.round(x - camX), 0, 1, H);
    for (let y = gy0; y < camY + H + GRID; y += GRID) g.fillRect(0, Math.round(y - camY), W, 1);

    // Comida: el MISMO sprite que el juego (pixDotSprite) cuando existe \u2014
    // dentro de /game \u2014; en la landing, que carga este fichero suelto y no lo
    // tiene, un bloque del mismo color y tamano.
    const hayDot = typeof pixDotSprite === 'function';
    for (const f of s.comida) {
        const px = f.x - camX, py = f.y - camY;
        if (px < -8 || py < -8 || px > W + 8 || py > H + 8) continue;
        const dL = Math.max(4, Math.round(f.r * 2));
        if (hayDot) g.drawImage(pixDotSprite(dL, f.c, 'f'), Math.round(px - dL / 2), Math.round(py - dL / 2));
        else { g.fillStyle = f.c; g.fillRect(Math.round(px - f.r), Math.round(py - f.r), Math.round(f.r * 2), Math.round(f.r * 2)); }
    }

    // Virus: tambien el sprite del juego cuando esta (pixVirusSprite), con un
    // dibujo de respaldo para la landing. La pildora ni los busca ni choca.
    const hayVirus = typeof pixVirusSprite === 'function';
    for (const v of s.virus) {
        const px = v.x - camX, py = v.y - camY;
        if (px < -40 || py < -40 || px > W + 40 || py > H + 40) continue;
        const dL = Math.max(8, Math.round(v.r * 2));
        if (hayVirus) g.drawImage(pixVirusSprite(dL, 0), Math.round(px - dL / 2), Math.round(py - dL / 2));
        else _pmDibujaVirus(g, px, py, v.r);
    }

    // La pildora, con su skin, en el centro exacto. Angulo FIJO: en el juego
    // las pildoras no giran sobre si mismas, solo se desplazan.
    const o = paisPillRot(Math.round(s.wL), _paisCodeAbierto, PM_ANG);
    g.drawImage(o.cv, Math.round(W / 2 - o.S / 2), Math.round(H / 2 - o.S / 2));
}
// Virus de respaldo para la landing (alli no existe pixVirusSprite): nucleo
// cuadrado y pinchos en cruz y diagonales, en bloques, para no desentonar con
// el resto del pixel art.
function _pmDibujaVirus(g, cx, cy, r) {
    const s = Math.max(1, Math.round(r * 0.35));
    g.fillStyle = '#3ddc47';
    g.fillRect(Math.round(cx - r * 0.55), Math.round(cy - r * 0.55), Math.round(r * 1.1), Math.round(r * 1.1));
    [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].forEach(([dx, dy]) => {
        g.fillRect(Math.round(cx + dx * r * 0.85 - s / 2), Math.round(cy + dy * r * 0.85 - s / 2), s, s);
    });
}

const PAIS_CRECE = [14, 24, 36, 48, 64];

function paisModalAbrir(code, onCambio) {
    const s = paisSkin(code); if (!s) return;
    paisModalMontar();
    _paisOnCambio = onCambio || null; _paisCodeAbierto = code;
    const d = document.getElementById(PAIS_MODAL_ID);
    d.querySelector('.pm-nom').textContent = s.nombre;
    d.querySelector('.pm-lore').textContent = s.lore;
    const fr = d.querySelector('.pm-franjas'); fr.innerHTML = '';
    s.bandas.forEach(c => { const i = document.createElement('i'); i.style.background = c; fr.appendChild(i); });
    const cr = d.querySelector('.pm-crece'); cr.innerHTML = '';
    // Cuadricula del color del modo en el que se esta jugando. El panel lateral
    // lleva la clase del modo, que es la fuente mas fiable dentro del juego; en
    // la landing no existe y manda el default del CSS.
    cr.style.setProperty('--pm-grid', _pmModoHex() === '#ccff00' ? 'rgba(204,255,0,.13)' : 'rgba(0,255,170,.13)');
    let primera = null;
    PAIS_CRECE.forEach(wL => {
        const o = paisPillRot(wL, code, -Math.PI / 4);
        if (o.conEmblema && primera === null) primera = wL;
        const cv = document.createElement('canvas'); cv.width = o.S; cv.height = o.S;
        cv.getContext('2d').drawImage(o.cv, 0, 0);
        cr.appendChild(cv);
    });
    d.querySelector('.pm-pie').textContent = s.capas.length === 0
        ? 'THE SAME SKIN, AS YOU GROW'
        : (primera === PAIS_CRECE[0] ? 'WEARS ITS EMBLEM FROM THE FIRST BITE' : 'THE EMBLEM SHOWS UP AS YOU GROW');
    _paisPintaBotones(code);
    // Marco y espaciado afinados desde el editor. Se aplican AQUI y no al cargar
    // porque este cartel se monta la primera vez que se abre: al arrancar no
    // existe en el DOM y no habria piezas que colocar.
    _paisAplicaAjuste();
    paisModalVariante(_paisVarianteActual());
    d.classList.add('on');
    paisModalPagina(1);
}

/*
 * Marco del cartel de skin: '' = gris original, 'v2' = verde alto,
 * 'v2g' = v2 gris, 'v3g' = v3 gris.
 * Existe para poder comparar versiones sin tocar codigo, desde el editor de
 * carteles. Se aplica la variante que se guarde desde el editor.
 */
function paisModalVariante(v) {
    const caja = document.querySelector('#' + PAIS_MODAL_ID + ' .pm-caja');
    if (!caja) return;
    caja.classList.remove('pm-v2', 'pm-v2g', 'pm-v3g');
    if (v === 'v2') caja.classList.add('pm-v2');
    else if (v === 'v2g') caja.classList.add('pm-v2g');
    else if (v === 'v3g') caja.classList.add('pm-v3g');
}

function _paisPintaBotones(code) {
    const cont = document.querySelector('#' + PAIS_MODAL_ID + ' .pm-btns'); if (!cont) return;
    cont.innerHTML = '';
    const defs = !paisTengo(code)
        ? [['BUY · ' + paisPrecioTexto(PAIS_PRECIO_PILL) + ' $PILL', PM_ROJO, () => paisComprar(code, 'pill')],
           ['BUY · ' + PAIS_PRECIO_SP + ' SP', PM_VERDE, () => paisComprar(code, 'sp')]]
        : paisPuesta() === code ? [['EQUIPPED', PM_VERDE, null]]
        : [['ASSIGN', PM_ROJO, () => paisPoner(code)]];
    // Los botones llaman al SERVIDOR, asi que son asincronos: mientras la
    // peticion vuela se deshabilitan (un doble clic en COMPRAR llegaria a firmar
    // dos veces) y si el servidor dice que no, el motivo se pinta en el pie.
    const botones = defs.map(([txt, hex, fn]) => {
        const b = document.createElement('button');
        b.className = 'pm-btn'; b.textContent = txt; b._pmHex = hex;
        if (!fn) b.disabled = true;
        else {
            b.addEventListener('mouseenter', () => _pmSndHover());
            b.addEventListener('click', async () => {
                [...cont.children].forEach(x => x.disabled = true);
                b.textContent = '...';
                const r = await fn();
                // Suena SIEMPRE: 'select' si la compra/asignacion salio, y
                // 'alert' si el servidor la rechazo. Antes no sonaba nada en
                // ninguno de los dos casos y no se sabia si habia pasado algo.
                if (r && r.ok === false) { _pmSnd('alert'); _paisAviso(r.error || 'could not complete'); }
                else _pmSnd('select');
                _paisPintaBotones(code);
                if (_paisOnCambio) _paisOnCambio();
            });
        }
        cont.appendChild(b);
        return b;
    });
    // El tamano real de cada boton (repartido por flex entre los que haya) no
    // se conoce hasta que TODOS estan en el DOM: la placa se pinta en una
    // segunda pasada, con el layout ya asentado.
    botones.forEach(b => {
        b.style.backgroundImage = 'url(' + _pmPlateUrl(b.clientWidth || 150, b.clientHeight || 50, b._pmHex) + ')';
    });
}

// El motivo del rechazo va en el pie del cartel, que es donde ya esta mirando el
// jugador. Un alert() cortaria el flujo y aqui el fallo mas comun es "no te llega
// el saldo", que no merece una ventana modal encima de otra.
function _paisAviso(txt) {
    const p = document.querySelector('#' + PAIS_MODAL_ID + ' .pm-pie'); if (!p) return;
    const antes = p.textContent;
    p.textContent = String(txt).toUpperCase();
    p.style.color = '#ff6b5c';
    setTimeout(() => { p.textContent = antes; p.style.color = ''; }, 3500);
}

function paisModalCerrar() {
    const d = document.getElementById(PAIS_MODAL_ID); if (d) d.classList.remove('on');
    cancelAnimationFrame(_pmPreviaRaf); _pmPreviaRaf = 0;
    // CERRAR es lo unico que reinicia: la partida vuelve a empezar y se quita
    // la pausa. Cambiar de pagina dentro del cartel no toca nada de esto.
    _pmSim = null; _pmPreviaPausa = false; _pmAltoP1 = 0;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PAISES, PAIS_FORMAS, UMBRAL, paisSkin, paisLista, paisPillRot, paisPagina, paisNumPaginas, PAIS_ORDEN_PAGINAS, PAIS_PRECIO_SP, PAIS_PRECIO_PILL, PAIS_PILL_POR_SP };
