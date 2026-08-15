#!/usr/bin/env python3
"""La PIXFONT 5x7 del juego, leida de game/pixfont.js.

No se copian los glifos aqui a proposito: el alfabeto ya existe en
game/pixfont.js y lo comparten game/index.html y game/comparativa.html. Tener
una segunda copia en Python significaria que tarde o temprano el texto de los
mockups deja de coincidir con el del juego sin que nadie se entere.

Formato en el .js: cada glifo son 7 enteros de 5 bits, y el bit 4 es la columna
de la izquierda.
"""
import os
import re

_JS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'game', 'pixfont.js')

ANCHO, ALTO, ESPACIO = 5, 7, 1


def _cargar():
    with open(_JS, encoding='utf-8') as f:
        src = f.read()
    ini = src.index('const PIXFONT')
    fin = src.index('\n};', ini)
    glifos = {}
    # "'A': [0x0E,0x11,...]" — la clave puede ser una comilla escapada (\')
    for m in re.finditer(r"'((?:\\.|[^'\\])+)'\s*:\s*\[([^\]]+)\]", src[ini:fin]):
        clave = m.group(1).replace('\\', '')
        filas = [int(v.strip(), 0) for v in m.group(2).split(',')]
        if len(filas) == ALTO:
            glifos[clave] = filas
    return glifos


GLIFOS = _cargar()


def medir(texto):
    n = len(texto)
    return 0 if n == 0 else n * ANCHO + (n - 1) * ESPACIO


def escribir(pon, texto, x, y, color):
    """Pinta `texto` llamando a pon(x, y, color) por cada bloque encendido.

    Se pasa la funcion de pintado en vez de un lienzo para que sirva igual con
    la rejilla del arte y con un PNG ya escalado.
    """
    cx = x
    for ch in texto.upper():
        filas = GLIFOS.get(ch)
        if filas is not None:
            for j, bits in enumerate(filas):
                for i in range(ANCHO):
                    if bits & (1 << (ANCHO - 1 - i)):
                        pon(cx + i, y + j, color)
        cx += ANCHO + ESPACIO
    return cx
