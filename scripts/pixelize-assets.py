#!/usr/bin/env python3
"""Hornea una rejilla de pixel COMUN en los assets del menu.

El problema que resuelve: ninguno de estos PNG es pixel art de verdad — son
ilustraciones a resolucion completa con aspecto pixel (el pixel-unit medido de
todos es 1, o sea que no hay bloques). Encima cada uno se muestra con un factor
de escala distinto y fraccionario (0.66 el PILLWARS, 0.56 el ARCADE, 0.61x0.69
el boton PLAY...), asi que en pantalla el "pixel" de cada pieza acaba midiendo
algo diferente. De ahi que el conjunto no case aunque todo sea del mismo autor.

Lo que hace: para cada asset, calcula cuanto tiene que medir un bloque EN EL
PNG NATIVO para que, tras la escala con la que el juego lo pinta, salga de
UNIT px en pantalla. Reduce a esa rejilla promediando, recorta la paleta y
vuelve a subir con nearest. El PNG conserva su tamano original, asi que el CSS
y MENU_LAYOUT_HORNEADO no se tocan.

Los factores de escala vienen medidos del DOM (getBoundingClientRect / naturalWidth)
con el layout horneado. Si se cambia una escala en EDIT LAYOUT hay que volver a
medirlos, porque el tamano de bloque depende de ellos.

Uso:
    python scripts/pixelize-assets.py                  # previsualiza en img/_pix/
    python scripts/pixelize-assets.py --unit 4         # bloque mas gordo
    python scripts/pixelize-assets.py --apply          # sobrescribe (deja .orig)
"""
import argparse
import os
import shutil
import sys
from collections import deque

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (ruta, escala_x, escala_y) — factor con el que el juego pinta el asset.
# titulo: height inline (24px / 29px sobre PNG de 100 / 120) x scale del layout.
# botones: background-size 100% 100%, que estira cada eje por su cuenta.
ASSETS = [
    ('game/img/mode-title/PILLWARS-arcade.png',   0.6605, 0.6610),
    ('game/img/mode-title/ARCADE-word.png',       0.5646, 0.5650),
    ('game/img/mode-title/PILLWARS-classic.png',  0.6605, 0.6605),
    ('game/img/mode-title/CLASSIC-word.png',      0.5481, 0.5481),
    ('game/img/cartel-hero/btn-plain-red.png',    0.6083, 0.6930),
    ('game/img/cartel-hero/btn-plain-blue.png',   0.6001, 0.6312),
]


def perforar(im, lum_max, area_min):
    """Vacia los agujeros de las letras (la tripa de la P, la A, la D...).

    En estos PNG esos huecos no son transparentes: vienen RELLENOS de un color
    oscuro. En el original colaba porque era un verde-azul casi igual al fondo
    del menu, pero al recortar la paleta se va a negro puro y entonces canta
    como un parche. Vaciarlos es ademas lo correcto: por el hueco de la roca
    tiene que verse el fondo real de la escena.

    Se distinguen de las grietas por area: medido sobre los cuatro titulos, los
    agujeros ocupan de 168 a 2199 px y ninguna grieta pasa de 30, asi que hay
    sitio de sobra para el corte. Solo cuentan las regiones que no tocan el
    borde (fuera de la silueta ya es transparente).
    """
    px = im.load()
    w, h = im.size
    vistos = [[False] * w for _ in range(h)]
    huecos = 0

    def oscuro(x, y):
        r, g, b, a = px[x, y]
        return a > 128 and (r * 299 + g * 587 + b * 114) // 1000 < lum_max

    for y0 in range(h):
        for x0 in range(w):
            if vistos[y0][x0] or not oscuro(x0, y0):
                continue
            cola = deque([(x0, y0)])
            vistos[y0][x0] = True
            region, borde = [], False
            while cola:
                x, y = cola.popleft()
                region.append((x, y))
                if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                    borde = True
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and not vistos[ny][nx] and oscuro(nx, ny):
                        vistos[ny][nx] = True
                        cola.append((nx, ny))
            if not borde and len(region) >= area_min:
                huecos += 1
                for x, y in region:
                    r, g, b, _ = px[x, y]
                    px[x, y] = (r, g, b, 0)
    return huecos


def pixelize(path_in, path_out, kx, ky, unit, colors, alpha_cut, hole_lum, hole_area):
    im = Image.open(path_in).convert('RGBA')
    w, h = im.size

    # Lado del bloque en px NATIVOS para que en pantalla mida `unit`.
    bx = max(1, round(unit / kx))
    by = max(1, round(unit / ky))
    gw, gh = max(1, w // bx), max(1, h // by)

    # Reducir promediando (BOX): elige el color representativo del bloque y se
    # come el ruido. NEAREST aqui daria el color de una sola muestra al azar.
    small = im.resize((gw, gh), Image.BOX)

    # Alfa duro: el borde antialiased es lo que mas delata que no es pixel art.
    r, g, b, a = small.split()
    a = a.point(lambda v: 255 if v >= alpha_cut else 0)

    # Paleta recortada sobre el RGB (quantize no traga RGBA).
    rgb = Image.merge('RGB', (r, g, b)).quantize(colors=colors, method=Image.MEDIANCUT)
    rgb = rgb.convert('RGB')
    small = Image.merge('RGBA', (*rgb.split(), a))

    # Los agujeros se vacian AQUI, sobre la rejilla ya cuantizada: si se hiciera
    # antes de reducir, el promediado del BOX mezclaria el color oscuro que hay
    # guardado bajo el alfa 0 (PIL no premultiplica) y dejaria un halo sucio en
    # el borde del hueco. El area minima va escalada al tamano del bloque.
    huecos = perforar(small, hole_lum, max(2, round(hole_area / (bx * by))))

    # Volver al tamano original con bloques duros. Se sube por bx/by (no a w,h
    # directamente) para que el bloque sea exacto, y se recorta lo que sobre.
    big = small.resize((gw * bx, gh * by), Image.NEAREST)
    if big.size != (w, h):
        canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        canvas.paste(big, (0, 0))
        big = canvas

    os.makedirs(os.path.dirname(path_out), exist_ok=True)
    big.save(path_out)
    return bx, by, gw, gh, huecos


def main():
    ap = argparse.ArgumentParser()
    # 2px es el punto en el que la roca del titulo conserva sus grietas y aun
    # asi hay rejilla; con 3 la piedra se aplana y con 4 las letras se
    # emborronan. Tiene que coincidir con PIX_UNIT del canvas de los carteles.
    ap.add_argument('--unit', type=int, default=2, help='lado del bloque en px de PANTALLA (default 2)')
    ap.add_argument('--colors', type=int, default=24, help='colores por asset (default 24)')
    ap.add_argument('--alpha-cut', type=int, default=128, help='umbral de alfa duro (default 128)')
    ap.add_argument('--hole-lum', type=int, default=70, help='luz por debajo de la cual un pixel cuenta como agujero (default 70)')
    ap.add_argument('--hole-area', type=int, default=60, help='area minima en px del ORIGINAL para vaciar un agujero; 0 lo desactiva (default 60)')
    ap.add_argument('--out', default='game/img/_pix', help='directorio de previsualizacion')
    ap.add_argument('--apply', action='store_true', help='sobrescribe el asset (guarda copia .orig)')
    args = ap.parse_args()

    missing = [p for p, _, _ in ASSETS if not os.path.exists(os.path.join(REPO, p))]
    if missing:
        print('No encontrados:\n  ' + '\n  '.join(missing), file=sys.stderr)
        return 1

    for rel, kx, ky in ASSETS:
        src = os.path.join(REPO, rel)
        if args.apply:
            orig = src + '.orig'
            if not os.path.exists(orig):        # nunca pisar un .orig ya guardado
                shutil.copy2(src, orig)
            dst = src
            src_read = orig
        else:
            dst = os.path.join(REPO, args.out, os.path.basename(rel))
            src_read = src

        bx, by, gw, gh, huecos = pixelize(src_read, dst, kx, ky, args.unit, args.colors,
                                          args.alpha_cut, args.hole_lum,
                                          args.hole_area if args.hole_area > 0 else 10 ** 9)
        print('%-42s bloque %dx%d px nativos -> %.1fx%.1f en pantalla   rejilla %dx%d   huecos vaciados: %d'
              % (os.path.basename(rel), bx, by, bx * kx, by * ky, gw, gh, huecos))

    print('\n%s: %s' % ('APLICADO (originales en *.orig)' if args.apply else 'Previsualizacion',
                        os.path.dirname(dst)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
