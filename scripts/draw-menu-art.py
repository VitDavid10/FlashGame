#!/usr/bin/env python3
"""Dibuja el marco/fuego del cartel y los botones del MENU en el estilo del JUEGO.

La referencia de estilo NO es este script: es el gameplay. El fondo, la comida,
los virus y las pildoras ya estan bien y no se tocan — lo que se adapta a ellos
es el cartel y los botones, que hoy vienen de otra mano y otra paleta.

Todo lo que hay aqui copia el sistema del pixel pack de game/index.html:

  PIX_SCREEN_PX = 4     el bloque mide 4px en pantalla (index.html:3179)
  pixShade(rgb, amt)    mezcla lineal hacia negro (amt<0) o blanco (amt>0)
  contorno   -0.50      el borde del sprite, como en pixDotSprite/pixVirusSprite
  sombra     -0.22      donde x+y pasa de la diagonal: la luz viene de arriba-izq
  brillo     blanco 55% cuadrado de lado ~1/5, a 1/4 del borde superior-izquierdo

Esas cuatro reglas son lo que hace que la comida, los virus y las pildoras se
lean como el mismo juego. Aplicandolas al marco de piedra y a los botones, el
menu entra en la misma familia sin tocar ni un pixel de la arena.

Uso:
    python scripts/draw-menu-art.py            # escribe en game/img/_draw/
    python scripts/draw-menu-art.py --scale 8  # px por bloque en el PNG
"""
import argparse
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pixfont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------
# El sistema de color del juego, portado tal cual.
# --------------------------------------------------------------------------
BORDE_AMT = -0.50    # index.html:3396 — contorno del sprite
SOMBRA_AMT = -0.22   # index.html:3397 — cara en sombra (diagonal x+y)
BRILLO_A = 0.55      # index.html:3401 — alfa del cuadrado especular


def shade(rgb, amt):
    """pixShade de index.html:3217, identico: mezcla lineal hacia negro/blanco."""
    t = 0 if amt < 0 else 255
    a = abs(amt)
    return tuple(round(v + (t - v) * a) for v in rgb)


# COLORES BASE. Son los unicos valores inventados del script; todo lo demas
# sale de shade(). Los cinco primeros estan copiados del juego, no elegidos.
BASE = {
    'fondo':  (0x05, 0x05, 0x05),   # --bg-color (index.html:29)
    'lime':   (0xcc, 0xff, 0x00),   # neon de arcade (_msV2Tile)
    'green':  (0x00, 0xff, 0xaa),   # neon de classic
    'virus':  (0x9e, 0xe3, 0x2d),   # verde del virus (pixVirusSprite:3411)
    'virusD': (0x3e, 0x8e, 0x11),   # su tono oscuro
    # Piedra y metal: no existen en el gameplay, asi que hay que elegirlos. Van
    # a gris AZULADO y no neutro para caer del lado frio del fondo negro.
    'piedra': (0x54, 0x63, 0x78),
    'metal':  (0x76, 0x84, 0x94),
    # Fuego: la rampa de las llamas, tres notas calidas que son el unico punto
    # caliente de la pantalla.
    'fuego':  (0xd6, 0x2c, 0x14),
    'fuego2': (0xff, 0x6a, 0x10),
    'fuego3': (0xff, 0xb8, 0x24),
    # Botones
    'rojo':   (0xe8, 0x32, 0x2d),
    'azul':   (0x2b, 0x8f, 0xe8),
    'blanco': (0xff, 0xff, 0xff),
    'gris':   (0xc2, 0xcf, 0xdb),
}


class Lienzo:
    """Rejilla de bloques; cada celda es un RGB o None (transparente).

    Se trabaja en bloques y no en pixeles para que sea imposible dibujar medio
    bloque: la coherencia de rejilla queda garantizada por construccion, no por
    revisarla despues.
    """

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = [[None] * w for _ in range(h)]

    def p(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = c

    def rect(self, x, y, w, h, c):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.p(i, j, c)

    def marco(self, x, y, w, h, c):
        for i in range(x, x + w):
            self.p(i, y, c)
            self.p(i, y + h - 1, c)
        for j in range(y, y + h):
            self.p(x, j, c)
            self.p(x + w - 1, j, c)

    def pegar(self, otro, x, y):
        for j in range(otro.h):
            for i in range(otro.w):
                c = otro.g[j][i]
                if c is not None:
                    self.p(x + i, y + j, c)

    def contorno(self, amt=BORDE_AMT):
        """Traza el contorno OSCURECIENDO cada celda pintada que da al vacio.

        Igual que pixDotSprite: no es una linea negra aparte, es el propio
        color del sprite bajado a shade(-0.5). Por eso el borde de la llama
        sale rojo oscuro y el de la piedra gris oscuro, en vez de un negro
        plano que los aplanaria a los dos por igual.
        """
        cambios = []
        for y in range(self.h):
            for x in range(self.w):
                if self.g[y][x] is None:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if not (0 <= nx < self.w and 0 <= ny < self.h) or self.g[ny][nx] is None:
                        cambios.append((x, y, shade(self.g[y][x], amt)))
                        break
        for x, y, c in cambios:
            self.g[y][x] = c

    def png(self, escala):
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                c = self.g[y][x]
                if c is not None:
                    px[x, y] = c + (255,)
        return im.resize((self.w * escala, self.h * escala), Image.NEAREST)


def volumen(L, x, y, w, h, base, brillo=True):
    """Pieza plana con un canto de luz arriba-izquierda.

    OJO con la sombra: en el juego la diagonal se evalua sobre el SPRITE
    ENTERO (x+y contra el diametro del punto), no sobre cada trocito. Aplicarla
    pieza a pieza — que fue el primer intento — deja la misma raya diagonal
    repetida en cada sillar y el marco entero se lee como un estampado. Aqui
    solo va el canto de luz, y la sombra la da sombra_global() de una pasada
    sobre la silueta completa, que es lo fiel.
    """
    L.rect(x, y, w, h, base)
    if brillo and w >= 3 and h >= 3:
        luz = shade(base, 0.22)
        for i in range(w - 1):
            L.p(x + i, y, luz)
        for j in range(h - 1):
            L.p(x, y + j, luz)


def sombra_global(L, brillo_en=None):
    """Aplica la cara en sombra a TODA la silueta, como pixDotSprite.

    La diagonal se mide contra el tamano del lienzo, asi que la luz entra por
    arriba-izquierda de la PIEZA entera y las piedras de abajo-derecha quedan
    en sombra — igual que el lado oscuro de un punto de comida o de una
    pildora. Es lo que hace que las tres cosas parezcan iluminadas por el mismo
    sol.
    """
    corte = (L.w + L.h) / 2
    for y in range(L.h):
        for x in range(L.w):
            c = L.g[y][x]
            if c is not None and (x + y) > corte:
                L.g[y][x] = shade(c, SOMBRA_AMT)
    if brillo_en:
        bx, by, lado = brillo_en
        for j in range(lado):
            for i in range(lado):
                c = L.g[by + j][bx + i]
                if c is not None:
                    L.g[by + j][bx + i] = tuple(round(v + (255 - v) * BRILLO_A) for v in c)


# --------------------------------------------------------------------------
# CARTEL — 120x114 bloques.
#
# 120 bloques de ancho porque la columna del menu mide 480px y 480/120 = 4px
# por bloque, o sea PIX_SCREEN_PX exacto: el bloque del cartel mide lo mismo
# que el de una pildora o un trozo de comida.
# El alto sale del ratio del cartel actual (812/772 = 1.0518): 120/1.0518 =
# 114.1 -> 114, un 0.08% de diferencia que no se ve.
# --------------------------------------------------------------------------
CW, CH = 120, 114
BORDE = 8
PANT_Y1 = 78


def sillar(L, x, y, w, h):
    volumen(L, x, y, w, h, BASE['piedra'])


def fila_sillares(L, x0, x1, y, alto, anchos, desfase):
    """Rellena de x0 a x1 con sillares de ancho variable y junta de 1 bloque.

    Anchos alternos y desfase distinto por fila: con un ancho unico el marco se
    lee como un tile repetido, que es lo que delata el relleno automatico.
    """
    x = x0
    i = desfase
    while x < x1:
        w = min(anchos[i % len(anchos)], x1 - x)
        if w >= 3:
            sillar(L, x, y, w, alto)
        x += w + 1
        i += 1


def llama(L, cx, top, alto):
    """Llama de cohete: capas concentricas de la rampa de fuego.

    Triangulos isosceles apuntando abajo, cada uno mas corto y estrecho que el
    anterior. Estrechamiento LINEAL, que es la silueta de lados rectos que ya
    tenia dibujada David; con exponente <1 sale concava y con >1 convexa.
    """
    capas = [(shade(BASE['fuego'], -0.25), 1.00, 1.00),
             (BASE['fuego'], 0.74, 0.88),
             (BASE['fuego2'], 0.50, 0.74),
             (BASE['fuego3'], 0.30, 0.56),
             (shade(BASE['fuego3'], 0.55), 0.13, 0.34)]
    ancho_base = 10
    for color, kw, kh in capas:
        w0 = max(1, round(ancho_base * kw))
        h = max(2, round(alto * kh))
        for j in range(h):
            t = j / (h - 1) if h > 1 else 1.0
            w = max(0, round(w0 * (1.0 - t)))
            for i in range(-w, w + 1):
                L.p(cx + i, top + j, color)


def plataforma(L, x, y, w, h):
    """Base metalica del cohete: placa con tres tornillos."""
    volumen(L, x, y, w, h, BASE['metal'], brillo=False)
    for k in range(3):
        tx = x + round((k + 0.5) * w / 3) - 1
        ty = y + h // 2 - 1
        volumen(L, tx, ty, 3, 3, shade(BASE['metal'], -0.35), brillo=False)


def aparato(L, cx, y):
    """El bloque central: caja de mandos, cuello, cuerpo, tobera y patas.

    Unica pieza con derecho a detalle: es pequena, esta en el eje de simetria y
    el ojo la usa de ancla, asi que el resto del cartel puede permitirse ser
    liso.
    """
    m = BASE['metal']
    volumen(L, cx - 15, y, 30, 6, m, brillo=False)
    for k in range(4):                          # pilotos, en los neones del juego
        L.p(cx - 10 + k * 3, y + 2, BASE['lime'])
        L.p(cx + 3 + k * 3, y + 2, BASE['green'])
    volumen(L, cx - 7, y + 6, 14, 3, shade(m, -0.30), brillo=False)
    volumen(L, cx - 5, y + 9, 10, 8, m, brillo=False)
    volumen(L, cx - 3, y + 17, 6, 4, shade(m, 0.12), brillo=False)
    volumen(L, cx - 2, y + 21, 4, 2, shade(m, -0.30), brillo=False)
    for s in (-1, 1):                           # patas, pegadas al cuerpo
        for k in range(6):
            L.p(cx + s * (5 + k), y + 11 + k, m)
            L.p(cx + s * (5 + k), y + 12 + k, shade(m, SOMBRA_AMT))


def cartel(neon):
    """`neon` = color de la pantalla interior: lime en arcade, green en classic."""
    L = Lienzo(CW, CH)
    junta = shade(BASE['piedra'], -0.62)

    # ORDEN IMPORTANTE. Primero se dibuja y se sombrea solo la PIEDRA, y encima
    # van la pantalla y las llamas — que son emisivas y no reciben luz. Si se
    # sombreara todo junto, la mitad inferior-derecha de la pantalla saldria
    # apagada y las llamas, medio grises.

    # 1) Losa de fondo en el tono de junta: los sillares se dibujan encima y lo
    #    que queda visible entre ellos ES la junta, sin dibujarla pieza a pieza.
    L.rect(0, 0, CW, PANT_Y1 + 9, junta)

    # 2) Marco de sillares y cuerpo solido.
    fila_sillares(L, 0, CW, 0, BORDE, (13, 9, 11), 0)
    fila_sillares(L, 0, CW, PANT_Y1, 9, (11, 13, 9), 1)
    y = BORDE + 1
    lado = 0
    while y < PANT_Y1 - 2:
        h = min((10, 8, 12)[lado % 3], PANT_Y1 - 1 - y)
        if h >= 4:
            sillar(L, 0, y, BORDE, h)
            sillar(L, CW - BORDE, y, BORDE, h)
        y += h + 1
        lado += 1
    for cx in (22, CW - 22):
        plataforma(L, cx - 12, PANT_Y1 + 2, 24, 9)
    aparato(L, CW // 2, PANT_Y1 + 1)

    # 3) Chaflan escalonado 3-2-1 en las cuatro esquinas. Sin esto el cartel es
    #    un rectangulo perfecto y pierde lo unico que el original hacia mejor:
    #    la silueta redondeada, que lo hace leerse como pieza colgada y no como
    #    un marco de interfaz. Va antes de sombrear para que el contorno de la
    #    esquina se calcule sobre la silueta definitiva.
    for k, ancho in enumerate((3, 2, 1)):
        for i in range(ancho):
            L.p(i, k, None)
            L.p(CW - 1 - i, k, None)
            L.p(i, PANT_Y1 + 8 - k, None)
            L.p(CW - 1 - i, PANT_Y1 + 8 - k, None)

    # 4) Luz y sombra de la PIEZA ENTERA, no de cada sillar. SIN el cuadrado
    #    especular: el juego lo pone en sprites de 6-40 bloques, donde un punto
    #    de 1/5 del ancho se lee como reflejo. En una pieza de 120 bloques ese
    #    mismo cuadrado no es un reflejo, es una mancha suelta — probado, y
    #    canta. El canto de luz de cada sillar ya cuenta de donde viene la luz.
    sombra_global(L)

    # 5) Pantalla: el negro del juego (--bg-color) con SU grid, no uno nuevo. El
    #    grid de la arena va cada 100 unidades de mundo con 4px de grosor
    #    (pixBgPattern, index.html:3233); a la escala del cartel es 1 bloque
    #    cada 8. Es el mismo suelo visto desde fuera — el unico puente que le
    #    faltaba al menu con la partida.
    px0, py0 = BORDE, BORDE
    pw, ph = CW - BORDE * 2, PANT_Y1 - BORDE
    rejilla = tuple(round(0.03 * 255 + 0.97 * v) for v in BASE['fondo'])
    L.rect(px0, py0, pw, ph, BASE['fondo'])
    for i in range(px0, px0 + pw):
        if (i - px0) % 8 == 0:
            for j in range(py0, py0 + ph):
                L.p(i, j, rejilla)
    for j in range(py0, py0 + ph):
        if (j - py0) % 8 == 0:
            for i in range(px0, px0 + pw):
                L.p(i, j, rejilla)
    # Canto encendido en el neon del modo, muy bajado: marca donde acaba la
    # pantalla sin competir con el contenido que ira dentro.
    L.marco(px0, py0, pw, ph, shade(neon, -0.72))
    for k in range(6):
        for (ex, ey) in ((px0, py0), (px0 + pw - 1, py0),
                         (px0, py0 + ph - 1), (px0 + pw - 1, py0 + ph - 1)):
            L.p(ex + (k if ex == px0 else -k), ey, shade(neon, -0.58))
            L.p(ex, ey + (k if ey == py0 else -k), shade(neon, -0.58))

    # 6) Llamas, tambien despues de sombrear: son la fuente de luz de la escena,
    #    no una superficie que la recibe.
    for cx in (22, CW - 22):
        llama(L, cx, PANT_Y1 + 11, CH - (PANT_Y1 + 11) - 2)

    L.contorno()
    return L


# --------------------------------------------------------------------------
# BOTONES — 78x9 bloques.
#
# 78 bloques porque el boton se pinta a 312.8px (68% de la caja de login):
# 312.8/78 = 4.01px por bloque, otra vez PIX_SCREEN_PX. El alto sale del ratio
# del asset actual (735/86 = 8.547): 78/8.547 = 9.1 -> 9.
# --------------------------------------------------------------------------
BW, BH = 78, 9


def boton(base):
    """Placa con chaflan, en el mismo volumen que cualquier sprite del juego.

    El asset actual es un degradado vertical continuo; al cuantizarlo salian
    ~8 rojos casi identicos y, al escalarlo por 0.61 en x y 0.69 en y, el borde
    quedaba aserrado (ver el comentario de ASSETS en pixelize-assets.py). Aqui
    son tres tonos derivados del mismo base con shade() y un numero entero de
    bloques por banda, asi que no hay nada que redondear.
    """
    L = Lienzo(BW, BH)
    luz = shade(base, 0.42)
    sombra = shade(base, SOMBRA_AMT)
    hondo = shade(base, -0.45)
    ch = 2
    for y in range(BH):
        x0 = ch - y if y < ch else 0                            # esquina sup-izq
        x1 = BW - (ch - (BH - 1 - y)) if y >= BH - ch else BW    # esquina inf-der
        c = luz if y == 0 else sombra if y == BH - 2 else hondo if y == BH - 1 else base
        for x in range(x0, x1):
            L.p(x, y, c)
    L.contorno()
    return L


# --------------------------------------------------------------------------
# MOCKUP — la pantalla entera a 480x270 bloques (1920x1080 a 4px por bloque).
#
# El fondo, la comida y la pildora NO son diseno de este script: se replican
# como los pinta el juego (pixBgPattern, pixDotSprite, la capsula del pixel
# pack). Es la referencia contra la que se juzga el cartel, asi que tocarla
# invalidaria la prueba.
# --------------------------------------------------------------------------
MW, MH = 480, 270


def fondo_arena(L):
    """El tile de fondo del juego: base, moteado y grid (pixBgPattern:3221).

    El tile es de 100x100 unidades con lineas y motas de 4px, o sea 25x25
    bloques con lineas y motas de 1 bloque. Las posiciones del moteado son las
    mismas cinco + cuatro del juego, escaladas de px a bloques.
    """
    bg = BASE['fondo']
    L.rect(0, 0, MW, MH, bg)
    mota1 = shade(bg, 0.05)
    mota2 = shade(bg, 0.028)
    linea = tuple(round(0.03 * 255 + 0.97 * v) for v in bg)
    for ty in range(0, MH, 25):
        for tx in range(0, MW, 25):
            for (sx, sy) in ((3, 5), (13, 2), (20, 11), (7, 17), (16, 21)):
                L.p(tx + sx, ty + sy, mota1)
            for (sx, sy) in ((10, 9), (22, 18), (2, 22), (18, 4)):
                L.p(tx + sx, ty + sy, mota2)
            for k in range(25):
                L.p(tx + k, ty, linea)
                L.p(tx, ty + k, linea)


def punto(L, cx, cy, d, base):
    """Comida: pixDotSprite (index.html:3386) portado bloque a bloque.

    Circulo con contorno a -0.5, cara en sombra pasada la diagonal a -0.22 y
    el cuadrado especular blanco al 55% a un cuarto del borde. Es el sprite mas
    repetido de la pantalla, asi que es EL que define el estilo.
    """
    R = d / 2.0

    def dentro(x, y):
        if x < 0 or y < 0 or x >= d or y >= d:
            return False
        dx, dy = x + 0.5 - R, y + 0.5 - R
        return dx * dx + dy * dy <= (R - 0.1) ** 2

    for y in range(d):
        for x in range(d):
            if not dentro(x, y):
                continue
            if d >= 6 and not all((dentro(x - 1, y), dentro(x + 1, y),
                                   dentro(x, y - 1), dentro(x, y + 1))):
                c = shade(base, BORDE_AMT)
            elif x + y > d:
                c = shade(base, SOMBRA_AMT)
            else:
                c = base
            L.p(cx - d // 2 + x, cy - d // 2 + y, c)
    hp = max(1, d // 5)
    mez = tuple(round(v + (255 - v) * BRILLO_A) for v in base)
    L.rect(cx - d // 2 + d // 4, cy - d // 2 + d // 4, hp, hp, mez)


def pildora(L, cx, cy, largo, grueso, c_a, c_b):
    """La capsula del jugador, con el mismo volumen que el resto de sprites."""
    r = grueso // 2
    recto = largo // 2 - r
    for j in range(-r, r + 1):
        dx = int((r * r - j * j) ** 0.5)
        for i in range(-recto - dx, recto + dx + 1):
            base = c_a if i + j < 0 else c_b
            L.p(cx + i, cy + j, shade(base, SOMBRA_AMT) if i + j > r else base)
    hp = max(1, grueso // 5)
    mez = tuple(round(v + (255 - v) * BRILLO_A) for v in c_a)
    L.rect(cx - recto, cy - r + 3, hp + 1, hp, mez)
    L.contorno()


def mockup(neon):
    L = Lienzo(MW, MH)
    fondo_arena(L)

    # Comida en posiciones FIJAS (nada de random) para que dos ejecuciones den
    # el mismo PNG y se puedan comparar dos versiones del arte sin ruido.
    for (fx, fy, col) in ((38, 30, 'green'), (92, 62, 'rojo'), (163, 24, 'lime'),
                          (207, 235, 'fuego3'), (256, 44, 'green'), (300, 250, 'azul'),
                          (338, 36, 'rojo'), (404, 214, 'lime'), (447, 96, 'fuego3'),
                          (58, 226, 'green'), (128, 244, 'fuego3'), (372, 128, 'azul'),
                          (22, 148, 'rojo'), (462, 172, 'green'), (240, 20, 'lime')):
        punto(L, fx, fy, 6, BASE[col])

    c = cartel(BASE[neon])
    L.pegar(c, 15, 82)
    L.pegar(c, MW - 15 - CW, 82)

    # Huecos de skins del cartel derecho: van DENTRO del area de pantalla, asi
    # que se pegan despues del cartel.
    hx = MW - 15 - CW + BORDE + 3
    for n in range(8):
        gx, gy = hx + (n % 4) * 26, 82 + BORDE + 14 + (n // 4) * 26
        L.rect(gx, gy, 21, 16, shade(BASE[neon], -0.86))
        L.marco(gx, gy, 21, 16, shade(BASE[neon], -0.66))
        pildora(L, gx + 10, gy + 7, 13, 7, BASE['rojo'], BASE['fuego3'])

    pildora(L, MW // 2, 128, 64, 28, BASE['rojo'], BASE['fuego3'])
    L.pegar(boton(BASE['rojo']), (MW - BW) // 2, 190)
    L.pegar(boton(BASE['azul']), (MW - BW) // 2, 205)
    return L


def rotular(im, eb, neon):
    """Escribe los textos sobre el PNG ya montado, a 2px por bloque de glifo.

    La fuente es la PIXFONT 5x7 del propio juego (game/pixfont.js). A 4px por
    bloque el cuerpo minimo saldria de 28px de alto y no cabria ni una fila de
    precios; 2 divide a 4, asi que el texto sigue cayendo en la rejilla del
    arte, solo que en su submultiplo — que es como se resuelve siempre.
    """
    px = im.load()
    F = 2

    def pon(x, y, rgb):
        for j in range(F):
            for i in range(F):
                if 0 <= x * F + i < im.width and 0 <= y * F + j < im.height:
                    px[x * F + i, y * F + j] = rgb + (255,)

    def texto(s, bx, by, rgb, centrado=False):
        fx = int(MW * eb / F / 2 - pixfont.medir(s) / 2) if centrado else bx * eb // F
        pixfont.escribir(pon, s, fx, by * eb // F, rgb)

    N = BASE[neon]
    x0, y0 = 15 + BORDE + 3, 82 + BORDE + 3
    texto('PRICES', x0, y0, N)
    texto('4:52', x0 + 78, y0, N)
    texto('ON-CHAIN ORACLE RE-PRICES', x0, y0 + 8, shade(BASE['gris'], -0.55))
    texto('EVERY ROOM EVERY 5 MINUTES', x0, y0 + 13, shade(BASE['gris'], -0.55))
    for n, (a, b) in enumerate([('FREE', 'FREE'), ('$5', '50,000 $PILL'),
                                ('$10', '100,000 $PILL'), ('$20', '200,000 $PILL'),
                                ('$50', '500,000 $PILL')]):
        texto(a, x0, y0 + 22 + n * 9, BASE['gris'])
        texto(b, x0 + 26, y0 + 22 + n * 9, BASE['fuego3'])

    x1 = MW - 15 - CW + BORDE + 3
    texto('SKINS SHOP', x1, y0, N)
    texto('1,000 SP', x1 + 66, y0, N)
    for n, nb in enumerate(['EGYPT', 'SPAIN', 'CAPE V', 'FRANCE',
                            'NORWAY', 'SENEGAL', 'ARGENT', 'ALGERIA']):
        texto(nb, x1 + (n % 4) * 26, y0 + 28 + (n // 4) * 26, BASE['gris'])

    texto('PLAYER', 0, 92, BASE['blanco'], centrado=True)
    texto('TYPE YOUR NAME', 0, 176, shade(BASE['gris'], -0.62), centrado=True)
    texto('PLAY', 0, 192, BASE['blanco'], centrado=True)
    texto('SETTINGS', 0, 207, BASE['blanco'], centrado=True)
    return im


def pegar_titulo(im, eb):
    """Pega el titulo actual SIN tocarlo (decision de David: el titulo se queda)."""
    for nombre, alto, y in (('PILLWARS-arcade.png', 26, 14), ('ARCADE-word.png', 20, 42)):
        p = os.path.join(REPO, 'game/img/mode-title', nombre)
        if not os.path.exists(p):
            continue
        t = Image.open(p).convert('RGBA')
        h = alto * eb
        w = round(t.width * h / t.height)
        im.alpha_composite(t.resize((w, h), Image.LANCZOS), ((im.width - w) // 2, y * eb))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=int, default=8, help='px por bloque en el PNG (default 8)')
    ap.add_argument('--modo', default='lime', choices=('lime', 'green'),
                    help='neon del modo: lime = arcade, green = classic')
    ap.add_argument('--out', default='game/img/_draw')
    args = ap.parse_args()

    dst = os.path.join(REPO, args.out)
    os.makedirs(dst, exist_ok=True)

    for nombre, L in (('cartel.png', cartel(BASE[args.modo])),
                      ('btn-play.png', boton(BASE['rojo'])),
                      ('btn-settings.png', boton(BASE['azul']))):
        im = L.png(args.scale)
        im.save(os.path.join(dst, nombre))
        print('%-18s rejilla %dx%d  ->  PNG %dx%d' % (nombre, L.w, L.h, im.width, im.height))

    mk = rotular(pegar_titulo(mockup(args.modo).png(4), 4), 4, args.modo)
    mk.save(os.path.join(dst, 'mockup.png'))
    print('%-18s %dx%d' % ('mockup.png', mk.width, mk.height))

    # Cuantos colores distintos ha acabado usando el conjunto. No se fija a
    # mano: sale de las reglas de shade(), como en el juego.
    vistos = set()
    for _, L in (('c', cartel(BASE[args.modo])), ('p', boton(BASE['rojo'])),
                 ('s', boton(BASE['azul']))):
        for fila in L.g:
            vistos.update(c for c in fila if c is not None)
    print('\ncolores distintos en cartel + botones: %d' % len(vistos))
    print('En:', dst)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
