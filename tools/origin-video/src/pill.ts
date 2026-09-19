// Same pixel pill as the game: a port of pixPillSpriteRot (game/index.html),
// "detailed" variant (no cast shadow, with the gloss rhombus). Kept in step
// with the game's constants so a pill here is pixel-identical to one in play.
const PILL_RATIO = 2.0; // shared/sim.js
const BAND_REF = 24;
const BAND_SLOW = 0.4;
const ROT_STEP = (Math.PI * 2) / 16; // the game caches 16 angles, so do we

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const cache = new Map<string, { url: string; size: number }>();

/** Data URL of a pill sprite `wL` pixels wide, plus the square canvas side. */
export function pillSprite(wL: number, cTop: string, cBot: string, ang: number) {
  const qa = Math.round(ang / ROT_STEP) * ROT_STEP;
  const key = `${wL}|${Math.round(qa / ROT_STEP)}|${cTop}|${cBot}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const hL = Math.round(wL * PILL_RATIO);
  const R = wL / 2, seg = hL / 2 - R, RI = R - 0.1;
  const c = Math.cos(qa), s = Math.sin(qa);
  const S = Math.ceil(Math.max(wL * Math.abs(c) + hL * Math.abs(s), wL * Math.abs(s) + hL * Math.abs(c))) + 2;

  const cv = document.createElement("canvas");
  cv.width = S; cv.height = S;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(S, S), px = img.data;
  const rgbT = hexRgb(cTop), rgbB = hexRgb(cBot);

  const sd = (x: number, y: number) => {
    const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const cy = ly < -seg ? -seg : ly > seg ? seg : ly;
    return Math.hypot(lx, ly - cy);
  };
  const inside = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? false : sd(x, y) <= RI);

  const LX = -0.6, LY = -0.8;
  const kR = wL / 38, kB = BAND_REF / 38;
  const kD = kR <= kB ? kR : kB + (kR - kB) * BAND_SLOW;

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inside(x, y)) continue;
    const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const rgb = ly < 0 ? rgbT : rgbB;
    const cy = ly < -seg ? -seg : ly > seg ? seg : ly;
    const rad = Math.hypot(lx, ly - cy);
    let nx = lx, ny = ly - cy;
    const nl = rad || 1; nx /= nl; ny /= nl;
    const ndl = (nx * c - ny * s) * LX + (nx * s + ny * c) * LY;
    const edge = RI - rad;
    const u = Math.max(0, Math.min(1, (1 - ndl) * 0.5));
    const w1 = (1.05 + 1.7 * u) * kD, w2 = (2.6 + 4.2 * u) * kD, w3 = (4.2 + 6.8 * u) * kD;
    let amt: number;
    if (Math.abs(ly) < 1.45 * kD) amt = -0.3;
    else if (edge < w1) amt = -0.44;
    else if (edge < w2) amt = -0.3;
    else if (u > 0.18 && edge < w3) amt = -0.15;
    else amt = 0;
    const t = amt < 0 ? 0 : 255, a = Math.abs(amt), i = (y * S + x) << 2;
    px[i] = rgb[0] + (t - rgb[0]) * a;
    px[i + 1] = rgb[1] + (t - rgb[1]) * a;
    px[i + 2] = rgb[2] + (t - rgb[2]) * a;
    px[i + 3] = 255;
  }
  // Gloss rhombus on the lit end of the top half.
  const glx = -0.4 * R, gly = -0.48 * (seg + R);
  const gx = S / 2 + (glx * c - gly * s), gy = S / 2 + (glx * s + gly * c);
  const gr = Math.max(2, Math.round(wL * 0.145));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inside(x, y)) continue;
    const md = Math.abs(x + 0.5 - gx) + Math.abs(y + 0.5 - gy);
    if (md > gr) continue;
    const a = md <= gr * 0.45 ? 0.95 : md <= gr * 0.75 ? 0.78 : 0.5;
    const i = (y * S + x) << 2;
    px[i] += (255 - px[i]) * a; px[i + 1] += (255 - px[i + 1]) * a; px[i + 2] += (255 - px[i + 2]) * a;
  }
  g.putImageData(img, 0, 0);
  const out = { url: cv.toDataURL(), size: S };
  cache.set(key, out);
  return out;
}

// Colour pairs (top, bottom). The first is the game's default player pill.
export const PALETTE: [string, string][] = [
  ["#c0c8d0", "#00ff44"],
  ["#ffffff", "#1d9bf0"],
  ["#ffce3d", "#f62a2d"],
  ["#ccff00", "#7a3cff"],
  ["#ff7ac8", "#ffffff"],
  ["#00e5ff", "#ff9f1c"],
  ["#f62a2d", "#ffffff"],
  ["#9ee32d", "#2b2b2b"],
];
