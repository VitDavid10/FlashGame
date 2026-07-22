"""Rebuild skill FX sheets: hard chroma + clean frame animation (no muddy blur)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "game" / "img" / "skill-fx"
FRAME = 128
N_FRAMES = 8
PAD = 0.04


def remove_bg_white(im: Image.Image) -> Image.Image:
    """Aggressive near-white / low-sat paper kill with soft edge only near real art."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    # pass 1: hard mask
    alpha = [[255] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            sat = mx - mn
            val = (r + g + b) / 3.0
            # near white / light gray paper (Grok stills)
            if val >= 235 and sat <= 25:
                alpha[y][x] = 0
            elif val >= 220 and sat <= 18:
                alpha[y][x] = 0
            elif val >= 210 and sat <= 12:
                alpha[y][x] = 0
            elif r >= 230 and g >= 230 and b >= 230:
                alpha[y][x] = 0
            else:
                # soft only if very light and low sat (fringe)
                if val >= 200 and sat <= 30:
                    # keep more if has blue/purple tint (art glow)
                    blueish = b > r + 8 or b > g + 8
                    purplish = (r > 100 and b > 100 and g < min(r, b) * 0.85)
                    if blueish or purplish:
                        alpha[y][x] = 255
                    else:
                        t = (val - 200) / 35.0
                        alpha[y][x] = int(max(0, min(255, 255 * (1 - t))))
                else:
                    alpha[y][x] = 255

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            a = alpha[y][x]
            if a <= 0:
                op[x, y] = (0, 0, 0, 0)
            else:
                op[x, y] = (r, g, b, a)
    return out


def remove_bg_magenta(im: Image.Image) -> Image.Image:
    key = (197, 23, 118)
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    kr, kg, kb = key
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            dist = math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2)
            # pink family
            pink = r > 140 and g < 100 and b > 60 and (r - g) > 55 and (b - g) > 20
            if dist < 52 or (pink and g < 80 and dist < 110):
                a = 0
            elif pink and g < 95 and dist < 130:
                a = int(max(0, min(255, (dist - 50) * 4)))
            elif dist < 90:
                a = int(max(0, min(255, (dist - 52) * 6)))
            else:
                a = 255
            if a <= 0:
                op[x, y] = (0, 0, 0, 0)
            elif a < 255:
                fr = a / 255.0
                rr = int(max(0, min(255, (r - kr * (1 - fr)) / max(fr, 0.01))))
                gg = int(max(0, min(255, (g - kg * (1 - fr)) / max(fr, 0.01))))
                bb = int(max(0, min(255, (b - kb * (1 - fr)) / max(fr, 0.01))))
                op[x, y] = (rr, gg, bb, a)
            else:
                op[x, y] = (r, g, b, a)
    return out


def crop_alpha(im: Image.Image, margin: float = 0.04) -> Image.Image:
    bbox = im.split()[-1].getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0
    pad = int(max(bw, bh) * margin)
    return im.crop(
        (
            max(0, x0 - pad),
            max(0, y0 - pad),
            min(im.width, x1 + pad),
            min(im.height, y1 + pad),
        )
    )


def fit_frame(im: Image.Image, size: int, scale: float = 1.0) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    max_inner = max(1, int(size * (1 - 2 * PAD) * scale))
    ratio = min(max_inner / im.width, max_inner / im.height)
    nw = max(1, int(im.width * ratio))
    nh = max(1, int(im.height * ratio))
    # BILINEAR for downscale quality of AI art, then optional
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def mul_alpha(im: Image.Image, m: float) -> Image.Image:
    r, g, b, a = im.split()
    a = a.point(lambda v, mm=m: int(v * mm))
    return Image.merge("RGBA", (r, g, b, a))


def twinkle(im: Image.Image, phase: float, strength: float = 0.45) -> Image.Image:
    out = im.copy()
    px = out.load()
    for y in range(0, out.height, 1):
        for x in range(0, out.width, 1):
            r, g, b, a = px[x, y]
            if a < 80:
                continue
            bright = (r + g + b) / 3
            if bright < 215:
                continue
            hsh = ((x * 73856093) ^ (y * 19349663)) & 255
            local = (math.sin(phase * math.pi * 2 + hsh * 0.15) + 1) * 0.5
            f = 1.0 - strength + strength * local
            px[x, y] = (
                min(255, int(r * f)),
                min(255, int(g * f)),
                min(255, int(b * f)),
                min(255, int(a * (0.65 + 0.35 * local))),
            )
    return out


def make_frames(base: Image.Image, kind: str) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for i in range(N_FRAMES):
        t = i / float(N_FRAMES)
        phase = t * math.pi * 2

        if kind == "sprint":
            scale = 0.86 + 0.18 * (0.5 + 0.5 * math.sin(phase * 2))
            rot = -18 + 36 * math.sin(phase)
            alpha_breathe = 0.78 + 0.22 * (0.5 + 0.5 * math.sin(phase * 2 + 0.4))
        elif kind == "iman":
            scale = 0.88 + 0.16 * (0.5 + 0.5 * math.sin(phase))
            rot = 8 * math.sin(phase)
            alpha_breathe = 0.80 + 0.20 * (0.5 + 0.5 * math.sin(phase + 0.5))
        else:  # inmune
            scale = 0.88 + 0.16 * (0.5 + 0.5 * math.sin(phase))
            rot = 0.0
            alpha_breathe = 0.80 + 0.20 * (0.5 + 0.5 * math.sin(phase))

        work = base
        if abs(rot) > 0.3:
            work = base.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
            work = crop_alpha(work, 0.02)

        core = fit_frame(work, FRAME, scale=scale)
        core = twinkle(core, t, 0.55 if kind == "sprint" else 0.4)

        canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))

        # afterimage / pulse ring: draw a slightly larger faded copy under core
        ghost_scale = scale * (1.12 + 0.08 * (0.5 + 0.5 * math.sin(phase + 1.0)))
        ghost = fit_frame(work, FRAME, scale=ghost_scale)
        ghost = mul_alpha(ghost, 0.28 + 0.12 * (0.5 + 0.5 * math.sin(phase)))
        canvas.alpha_composite(ghost, (0, 0))

        # sprint: motion streaks — two faded rotated copies
        if kind == "sprint":
            for sign, sc, am in ((-1, 0.92, 0.22), (1, 0.96, 0.18)):
                streak = base.rotate(
                    rot + sign * 12,
                    resample=Image.Resampling.BICUBIC,
                    expand=True,
                )
                streak = crop_alpha(streak, 0.02)
                streak = fit_frame(streak, FRAME, scale=scale * sc)
                # offset along bolt diagonal
                ox = int(sign * 4 * math.sin(phase))
                oy = int(-sign * 4 * math.cos(phase))
                tmp = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
                tmp.alpha_composite(mul_alpha(streak, am), (ox, oy))
                canvas.alpha_composite(tmp, (0, 0))

        canvas.alpha_composite(core, (0, 0))
        canvas = mul_alpha(canvas, alpha_breathe)
        frames.append(canvas)
    return frames


def pack(frames: list[Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (FRAME * len(frames), FRAME), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.alpha_composite(fr, (i * FRAME, 0))
    return sheet


def process(src: str, kind: str, stem: str, remover) -> None:
    im = Image.open(ROOT / src)
    cut = remover(im)
    cut = crop_alpha(cut)
    OUT.mkdir(parents=True, exist_ok=True)
    cut.save(OUT / f"{stem}-cut.png")
    fit_frame(cut, FRAME, 1.0).save(OUT / f"{stem}-icon.png")
    sheet = pack(make_frames(cut, kind))
    sheet.save(OUT / f"{stem}-sheet.png")
    data = cut.getdata()
    a0 = sum(1 for p in data if p[3] == 0)
    print(
        stem,
        cut.size,
        "transparent%",
        round(100 * a0 / (cut.width * cut.height), 1),
        "sheet",
        sheet.size,
    )


def main() -> None:
    # wipe old muddy intermediates we won't ship
    process("game/img/skill-fx/raw/iman.jpg", "iman", "iman", remove_bg_white)
    process("game/img/skill-fx/raw/inmune.jpg", "inmune", "inmune", remove_bg_white)
    process("game/img/skill-fx/raw/sprint.jpg", "sprint", "sprint", remove_bg_magenta)
    print("OK")


if __name__ == "__main__":
    main()
