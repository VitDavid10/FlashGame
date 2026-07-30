#!/usr/bin/env python3
"""Mete en el juego el arte de David generado con fondo magenta.

Quita el croma con el MISMO criterio que usa el canvas de los carteles en
runtime (tono + saturacion, no distancia RGB): el arte viene en jpg y el borde
entre el magenta y la pieza sale mezclado por el subsampling de croma, con un
lila que la distancia RGB no separa del gris real. Ver el comentario largo de
game/index.html, donde esto ya estaba resuelto para el video.

Ademas corta el halo horneado. El glow de estos PNG venia mezclado con el
magenta del fondo, asi que al recortar dejaria un cerco rosa; el halo del
titulo ya lo pone el CSS con el color del modo (drop-shadow), que encima cambia
entre arcade y classic.

Uso:
    python scripts/import-hero-art.py --list
    python scripts/import-hero-art.py --apply
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KEY_HUE, KEY_SAT = 299.0, 0.571     # los mismos que game/index.html

# Dos formas de aislar la pieza del fondo magenta:
#
#   'hue'   los titulos. Se queda con el rango de tono de la letra en vez de
#           quitar el magenta, porque estos PNG traen un halo horneado que es
#           una mezcla suave de la letra CON el magenta: por saturacion cae del
#           lado de la pieza y deja un cerco. Y por saturacion NO se puede
#           separar, porque los brillos de la letra son claros y por tanto poco
#           saturados igual que el halo — subir el umbral empieza a comerse los
#           brillos antes de acabar con el cerco.
#
#           Lo que si separa es el TONO, porque el halo es la letra mezclada
#           con el magenta y eso le desplaza el tono. Medido sobre las cuatro
#           imagenes (nucleo erosionado vs anillo del borde), de forma
#           consistente:
#               dorado  letra 36..54  (media 46)   halo 15..37  (media 23)
#               verde   letra 148..172 (media 157) halo 157..198 (media 182)
#           El magenta empuja el dorado hacia el rojo y el verde hacia el cyan.
#           De ahi los rangos de abajo. El verde se solapa un poco (157..172),
#           asi que ahi el corte deja algo de cerco o se come un pelo de borde;
#           al pasar por la rejilla de 2px deja de notarse.
#
#           El glow lo pone el CSS con el color del modo, que ademas cambia
#           entre arcade y classic.
#
#   'croma' el cartel. Ahi no vale el tono (tiene piedra gris, llamas rojas y
#           pantalla verde), pero tampoco hace falta: viene sin halo, asi que
#           el criterio hue+sat del canvas lo separa limpio.
#
# origen -> (destino, modo, rango de tono, recortar al contenido)
TRABAJOS = [
    ('game/img/mode-title/raw/PILLWARS-arcade-v2.jpg',  'game/img/mode-title/PILLWARS-arcade.png',  'hue', (36, 70), True),
    ('game/img/mode-title/raw/ARCADE-word-v2.jpg',      'game/img/mode-title/ARCADE-word.png',      'hue', (36, 70), True),
    ('game/img/mode-title/raw/PILLWARS-classic-v2.jpg', 'game/img/mode-title/PILLWARS-classic.png', 'hue', (130, 170), True),
    ('game/img/mode-title/raw/CLASSIC-word-v2.jpg',     'game/img/mode-title/CLASSIC-word.png',     'hue', (130, 170), True),
    # El cartel se recorta al contenido pero NO se reencuadra: el CSS situa la
    # pantalla verde con porcentajes del alto total (.cartel-inner).
    ('game/img/cartel-hero/raw/quest-panel-v2.jpg',     'game/img/cartel-hero/quest-panel-v2.png',  'croma', None, True),
]


def keyness(a):
    """0 = nada de croma, 1 = magenta puro. Vectorizado, mismo criterio que el
    canvas del juego."""
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = a[:, :, :3].max(axis=2)
    mn = a[:, :, :3].min(axis=2)
    delta = (mx - mn).astype(float)
    with np.errstate(divide='ignore', invalid='ignore'):
        sat = np.where(mx > 0, delta / np.maximum(mx, 1), 0.0)
    hue = np.zeros_like(delta)
    nz = delta > 0
    esr, esg = (mx == r) & nz, (mx == g) & nz
    esb = nz & ~esr & ~esg
    with np.errstate(divide='ignore', invalid='ignore'):
        hue[esr] = 60 * (((g[esr] - b[esr]) / delta[esr]) % 6)
        hue[esg] = 60 * (((b[esg] - r[esg]) / delta[esg]) + 2)
        hue[esb] = 60 * (((r[esb] - g[esb]) / delta[esb]) + 4)
    hue = np.where(hue < 0, hue + 360, hue)
    hd = np.abs(hue - KEY_HUE)
    hd = np.where(hd > 180, 360 - hd, hd)
    hue_score = np.clip(1 - hd / 45.0, 0, 1)
    sat_score = np.clip((sat - 0.18) / (KEY_SAT - 0.18), 0, 1)
    k = hue_score * sat_score
    return np.where((sat < 0.18) | (delta == 0), 0.0, k)


def descromar(im, corte):
    """RGBA con el magenta fuera. `corte` alto = mas agresivo, se come el borde."""
    a = np.asarray(im.convert('RGB')).astype(int)
    k = keyness(a)
    alpha = np.where(k >= corte, 0, 255).astype(np.uint8)
    out = np.dstack([np.asarray(im.convert('RGB')), alpha])
    return Image.fromarray(out, 'RGBA')


def por_tono(im, lo, hi, sat_min):
    """RGBA quedandose SOLO con el rango de tono de la pieza. Lo que queda fuera
    (fondo magenta y el halo, que es la letra mezclada con el magenta) se va a
    alfa 0 de golpe: borde duro, como pide el pixel art."""
    rgb = np.asarray(im.convert('RGB'))
    a = rgb.astype(float) / 255
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx, mn = a.max(2), a.min(2)
    d = mx - mn
    dd = np.where(d == 0, 1, d)
    hue = np.zeros_like(mx)
    m = d > 0
    ir = m & (mx == r)
    ig = m & (mx == g) & ~ir
    ib = m & ~ir & ~ig
    hue[ir] = (60 * (((g - b) / dd) % 6))[ir]
    hue[ig] = (60 * (((b - r) / dd) + 2))[ig]
    hue[ib] = (60 * (((r - g) / dd) + 4))[ib]
    hue = np.where(hue < 0, hue + 360, hue)
    sat = np.where(mx > 0, d / np.where(mx == 0, 1, mx), 0)
    dentro = (hue >= lo) & (hue <= hi) & (sat >= sat_min)
    alpha = np.where(dentro, 255, 0).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), 'RGBA')


def recortar(im, margen=0):
    a = np.asarray(im)
    ys, xs = np.nonzero(a[:, :, 3] > 128)
    if not len(ys):
        return im
    y0, y1 = max(0, ys.min() - margen), min(im.height - 1, ys.max() + margen)
    x0, x1 = max(0, xs.min() - margen), min(im.width - 1, xs.max() + margen)
    return im.crop((x0, y0, x1 + 1, y1 + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--corte', type=float, default=0.22,
                    help='umbral de croma (modo croma): bajo deja cerco rosa, '
                         'alto se come el borde (default 0.22)')
    ap.add_argument('--sat-min', type=float, default=0.20,
                    help='saturacion minima (modo hue) para no colar grises (default 0.20)')
    ap.add_argument('--list', action='store_true', help='solo informa, no escribe')
    ap.add_argument('--out', default='game/img/_new', help='directorio de prueba')
    ap.add_argument('--apply', action='store_true', help='escribe en el destino real')
    args = ap.parse_args()

    for origen, destino, modo, tono, recorta in TRABAJOS:
        src = os.path.join(REPO, origen)
        if not os.path.exists(src):
            print('FALTA', origen); continue
        im = Image.open(src)
        limpio = por_tono(im, tono[0], tono[1], args.sat_min) if modo == 'hue' \
            else descromar(im, args.corte)
        if recorta:
            limpio = recortar(limpio)
        opacos = (np.asarray(limpio)[:, :, 3] > 128).mean()
        print('%-26s -> %-44s %dx%d  ratio %.3f  opaco %.1f%%' % (
            origen, os.path.basename(destino), limpio.width, limpio.height,
            limpio.width / limpio.height, 100 * opacos))
        if args.list:
            continue
        dst = os.path.join(REPO, destino) if args.apply else os.path.join(REPO, args.out, os.path.basename(destino))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        limpio.save(dst)
    return 0


if __name__ == '__main__':
    sys.exit(main())
