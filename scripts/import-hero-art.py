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
from PIL import Image, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KEY_HUE, KEY_SAT = 299.0, 0.571     # los mismos que game/index.html
ANCHO_BORDE = 3                     # px de franja donde se des-mezcla el croma

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
    # v4, el arte vigente. Vuelve a traer halo horneado (medido, el anillo del
    # borde desplaza el tono: 62->95 en arcade y 159->184 en classic), pero ya no
    # hace falta el corte por tono que tanto contorno se llevaba: la des-mezcla
    # del borde resta el croma en vez de descartar pixeles, asi que el croma
    # normal basta.
    ('game/img/mode-title/raw/PILLWARS-arcade-v4.jpg',  'game/img/mode-title/PILLWARS-arcade.png',  'croma', None, True),
    ('game/img/mode-title/raw/ARCADE-word-v4.jpg',      'game/img/mode-title/ARCADE-word.png',      'croma', None, True),
    # PILLWARS-classic.png (el del LOGIN) tambien vuelve a v3, a peticion de
    # David — igual que CLASSIC.png del selector. CLASSIC-word.png (la palabra
    # de al lado en el mismo login) se queda en v4.
    ('game/img/mode-title/raw/PILLWARS-classic-v3.jpg', 'game/img/mode-title/PILLWARS-classic.png', 'croma', None, True),
    ('game/img/mode-title/raw/CLASSIC-word-v4.jpg',     'game/img/mode-title/CLASSIC-word.png',     'croma', None, True),
    # Titulos del SELECTOR de modo (la pantalla de antes del login). Van en
    # ficheros aparte de los -word porque el CSS los pinta a otro tamano —
    # ancho fijo de 312/332px en vez de alto fijo— y la rejilla de pixel se
    # calcula contra el tamano de render, asi que el mismo PNG no sirve para
    # los dos sitios.
    ('game/img/mode-title/raw/ARCADE-word-v4.jpg',      'game/img/mode-title/ARCADE.png',           'croma', None, True),
    # CLASSIC del selector se queda en v3, a peticion de David — probado el v4
    # ahi y prefiere el v3. El CLASSIC-word.png del LOGIN si sigue en v4; son
    # ficheros distintos a proposito (ver arriba), asi que pueden ir cada uno a
    # su version sin conflicto.
    ('game/img/mode-title/raw/CLASSIC-word-v3.jpg',     'game/img/mode-title/CLASSIC.png',          'croma', None, True),
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


def color_fondo(a):
    """RGB medio del croma. Estos jpg lo traen plano (desviacion de 1 a 5 sobre
    255), asi que la media lo describe bien y se puede usar para des-mezclar."""
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    fondo = (r > g + 40) & (b > g + 30)
    if not fondo.any():
        return None
    return a[fondo].mean(axis=0)


def descromar(im, corte, suprimir=True):
    """RGBA con el magenta fuera, des-mezclando el borde.

    El alfa duro solo decide dentro/fuera, y eso no basta para el borde: ahi el
    pixel es una MEZCLA de letra y fondo, asi que con el corte bajo se pierde
    contorno y con el corte alto queda un anillo rosa. Los dos males que se
    vieron en pantalla, y en jpg es peor porque la compresion promedia el color
    en bloques de 2x2 y ensancha esa franja.

    Asi que en vez de decidir, se des-mezcla. Si el pixel es
        P = L*(1-a) + F*a
    con F el color del croma (conocido y plano en estos jpg), la letra se
    recupera con L = (P - F*a) / (1-a). Es la supresion de derrame de toda la
    vida del chroma key.

    La clave es estimar `a` bien. La keyness NO sirve: esta calibrada con
    KEY_HUE=299 (el magenta del video viejo) y el de estos jpg es 322, asi que
    en el fondo puro se queda en ~0.49 en vez de 1 — usarla como `a` metia mas
    rosa del que quitaba. Se usa la distancia RGB al color del fondo, que si es
    proporcional a la mezcla: 0 en fondo puro, maxima en letra pura.
    """
    rgb = np.asarray(im.convert('RGB')).astype(float)
    F = color_fondo(rgb)
    if F is None:
        k = keyness(rgb.astype(int))
        return Image.fromarray(np.dstack([
            rgb.astype(np.uint8), np.where(k >= corte, 0, 255).astype(np.uint8)]), 'RGBA')

    dist = np.sqrt(((rgb - F) ** 2).sum(axis=2))
    # Escala: la distancia tipica de un pixel de letra al fondo. El percentil 90
    # de las distancias grandes, para no calibrar con un pixel extremo.
    lejos = dist[dist > np.percentile(dist, 60)]
    D = np.percentile(lejos, 90) if len(lejos) else dist.max()
    a_est = np.clip(1 - dist / max(D, 1e-6), 0, 1)

    # Alfa: fuera lo que es mayoritariamente fondo. `corte` es ahora la fraccion
    # de fondo a partir de la cual el pixel se descarta.
    alpha = np.where(a_est >= corte, 0, 255).astype(np.uint8)

    out = rgb.copy()
    if suprimir:
        # Solo la FRANJA del borde, no todo el interior. Aplicandolo a todo
        # pixel con algo de a_est, el dorado perdia su componente roja legitima
        # y se iba a limon: la distancia al fondo no es cero ni en el interior
        # de la letra, asi que ahi restaba magenta que no existia. La mezcla
        # real solo ocurre pegada al recorte, y con morfologia se acota exacto.
        fuera = Image.fromarray(((alpha == 0) * 255).astype(np.uint8), 'L')
        vecino = np.asarray(fuera.filter(ImageFilter.MaxFilter(2 * ANCHO_BORDE + 1))) > 128
        borde = vecino & (alpha > 0) & (a_est > 0.01)
        # Tope 0.9: divide por 0.1 como mucho, si no los pixeles casi-fondo
        # explotan al reescalar.
        av = np.clip(a_est, 0, 0.9)[borde][:, None]
        out[borde] = np.clip((rgb[borde] - F * av) / (1 - av), 0, 255)

    return Image.fromarray(np.dstack([out.astype(np.uint8), alpha]), 'RGBA')


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
    # 0.65 es el valor con el que estan generados los assets del repo: ahora que
    # el borde se des-mezcla en vez de descartarse, conviene el corte ALTO, que
    # es el que conserva mas contorno. Por debajo de 0.35 no cambia el resultado
    # (el rosa ya lo quita la des-mezcla) y por encima de 0.70 deja de recortar
    # el fondo, porque el magenta del jpg no llega a esa fraccion en toda la
    # imagen. El default estaba en 0.22 y hacia que reproducir con el script
    # diera assets distintos a los versionados.
    ap.add_argument('--corte', type=float, default=0.65,
                    help='fraccion de croma a partir de la cual el pixel se '
                         'descarta: bajo se come el borde, muy alto deja de '
                         'recortar el fondo (default 0.65)')
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
