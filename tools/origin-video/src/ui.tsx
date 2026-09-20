import React from "react";
import { Img, Sequence, interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { loadFont } from "@remotion/fonts";
import { pillSprite } from "./pill";

// The game's own lettering (same files as /fonts on the site).
loadFont({ family: "PressStart", url: staticFile("press-start-2p-latin.woff2") });
loadFont({ family: "VT323", url: staticFile("vt323-latin.woff2") });

export const PX = "PressStart, monospace";
export const VT = "VT323, monospace";
export const W = 1920, H = 1080, FPS = 30;

// Game scale, measured on the captured footage: 1 world unit ≈ 1.05 px on a
// 1920x1080 canvas, and the pixel look draws every sprite pixel as 4 px
// (PIX_SCREEN_PX in game/index.html).
export const ES = 1.05, PIXEL = 4;
export const GAME_ANGLE = -Math.PI / 4; // every pill in the game is drawn at -45°

// Typing sound: drop a short key click at public/type.mp3 and set this to
// "type.mp3"; it plays once per letter of every caption.
const TYPE_SFX: string | null = null;
const CPS = 15; // letters per second
export const typeFrames = (text: string) => Math.ceil((text.length / CPS) * FPS);
/** Frame at which each letter appears. `keys` pins the timing to the action:
 *  [letters shown, frame] pairs, linear in between (e.g. "Eat" done exactly
 *  on the kill). Without keys it types at CPS from `at`. */
export type Keys = [number, number][];
const letterFrames = (text: string, at: number, keys?: Keys) => text.split("").map((_, i) => {
  if (!keys) return at + (i / CPS) * FPS;
  const n = i + 1;
  for (let k = 0; k < keys.length - 1; k++) {
    const [c0, f0] = keys[k], [c1, f1] = keys[k + 1];
    if (n <= c1 && c1 > c0) return f0 + ((n - c0) / (c1 - c0)) * (f1 - f0);
  }
  return keys[keys.length - 1][1];
});

/** One pill, centred on (x, y). `scale` = screen px per sprite px. */
export const Pill: React.FC<{
  x: number; y: number; wL?: number; scale?: number; top: string; bot: string;
  ang?: number; grey?: number; opacity?: number;
}> = ({ x, y, wL = 18, scale = 6, top, bot, ang = 0, grey = 0, opacity = 1 }) => {
  const { url, size } = pillSprite(wL, top, bot, ang);
  const px = size * scale;
  return (
    <Img
      src={url}
      style={{
        position: "absolute", left: x - px / 2, top: y - px / 2, width: px, height: px,
        imageRendering: "pixelated", opacity,
        filter: grey > 0 ? `grayscale(${grey}) brightness(${1 - 0.45 * grey})` : undefined,
      }}
    />
  );
};

const hexRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const shade = (rgb: number[], amt: number) => { const t = amt < 0 ? 0 : 255, a = Math.abs(amt); return `rgb(${rgb.map((v) => Math.round(v + (t - v) * a)).join(",")})`; };

// Port of pixDotSprite(dL, col, 'f'): the game's food pellet.
const dotCache = new Map<string, string>();
const dotSprite = (dL: number, col: string) => {
  const key = dL + col;
  const hit = dotCache.get(key); if (hit) return hit;
  const cv = document.createElement("canvas"); cv.width = dL; cv.height = dL;
  const g = cv.getContext("2d")!, rgb = hexRgb(col), R = dL / 2;
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= dL || y >= dL) return false;
    const dx = x + 0.5 - R, dy = y + 0.5 - R; return dx * dx + dy * dy <= (R - 0.1) * (R - 0.1);
  };
  for (let y = 0; y < dL; y++) for (let x = 0; x < dL; x++) {
    if (!inside(x, y)) continue;
    let c2: string;
    if (dL >= 6 && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) c2 = shade(rgb, -0.5);
    else if (x + y > dL) c2 = shade(rgb, -0.22);
    else c2 = `rgb(${rgb.join(",")})`;
    g.fillStyle = c2; g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = "rgba(255,255,255,0.55)"; const hp = Math.max(1, Math.floor(dL / 5));
  g.fillRect(Math.floor(dL * 0.25), Math.floor(dL * 0.25), hp, hp);
  const url = cv.toDataURL(); dotCache.set(key, url); return url;
};
const FOOD_COLORS = ["#F44336", "#9C27B0", "#3F51B5", "#03A9F4", "#009688", "#8BC34A", "#FFC107", "#FF5722"]; // shared/sim.js

/** The game's food, scattered and fixed per seed. */
export const Food: React.FC<{ seed: string; n?: number; opacity?: number }> = ({ seed, n = 70, opacity = 1 }) => (
  <>
    {Array.from({ length: n }, (_, i) => {
      const r = 5 + random(`${seed}r${i}`) * 4; // world units
      const d = r * 2 * ES;
      const dL = Math.max(4, Math.min(16, Math.round(d / PIXEL / 2) * 2));
      return (
        <Img key={i} src={dotSprite(dL, FOOD_COLORS[Math.floor(random(`${seed}c${i}`) * FOOD_COLORS.length)])}
          style={{ position: "absolute", width: d, height: d, left: random(`${seed}x${i}`) * W, top: random(`${seed}y${i}`) * H, imageRendering: "pixelated", opacity }} />
      );
    })}
  </>
);

/** A heap of the game's food pellets: dense in the middle, thinning out, all
 *  drawn with the same sprite the game uses. `size` is the px per texel. */
export const FoodPile: React.FC<{ cx: number; cy: number; n: number; rx: number; ry: number; seed: string; size?: number }> =
  ({ cx, cy, n, rx, ry, seed, size = 7 }) => (
    <>
      {Array.from({ length: n }, (_, i) => {
        const a = random(`${seed}a${i}`) * Math.PI * 2;
        // sqrt spreads them evenly; the extra pow pulls most towards the centre
        const r = Math.pow(random(`${seed}r${i}`), 0.6);
        // The game's pellets are 4-6 texels wide (a food of r 5-9 at 4px per
        // texel), so the sprite stays that coarse and only gets bigger on screen:
        // more texels would read as a glossy ball instead of a pellet.
        const dL = random(`${seed}s${i}`) > 0.55 ? 8 : 6;
        const d = dL * size;
        const col = FOOD_COLORS[Math.floor(random(`${seed}c${i}`) * FOOD_COLORS.length)];
        return (
          <Img key={i} src={dotSprite(dL, col)}
            style={{ position: "absolute", width: d, height: d, left: cx + Math.cos(a) * r * rx - d / 2, top: cy + Math.sin(a) * r * ry - d / 2, imageRendering: "pixelated" }} />
        );
      })}
    </>
  );

// Port of pixBgPattern(): the 100x100 world tile of the arena floor.
let tileUrl: string | null = null;
const bgTile = () => {
  if (tileUrl) return tileUrl;
  const cv = document.createElement("canvas"); cv.width = 100; cv.height = 100;
  const g = cv.getContext("2d")!, rgb = [5, 5, 5];
  g.fillStyle = "#050505"; g.fillRect(0, 0, 100, 100);
  g.fillStyle = shade(rgb, 0.05);
  for (const s of [[12, 20], [52, 8], [80, 44], [28, 68], [64, 84]]) g.fillRect(s[0], s[1], 4, 4);
  g.fillStyle = shade(rgb, 0.028);
  for (const s of [[40, 36], [88, 72], [8, 88], [72, 16]]) g.fillRect(s[0], s[1], 4, 4);
  g.fillStyle = "rgba(255, 255, 255, 0.03)"; g.fillRect(0, 0, 100, 4); g.fillRect(0, 0, 4, 100);
  tileUrl = cv.toDataURL(); return tileUrl;
};

/** The arena floor exactly as the game paints it. */
export const ArenaFloor: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <div style={{
    position: "absolute", inset: 0, opacity, backgroundColor: "#050505",
    backgroundImage: `url(${bgTile()})`, backgroundSize: `${100 * ES}px ${100 * ES}px`, imageRendering: "pixelated",
  }} />
);

/** Big pixel caption typed letter by letter, with the site's hard black shadow.
 *  The untyped part is laid out but invisible, so the line never reflows. */
export const Caption: React.FC<{
  text: string; at?: number; keys?: Keys; out?: number; y?: number; size?: number; color?: string;
}> = ({ text, at = 0, keys, out, y = H * 0.8, size = 46, color = "#ffffff" }) => {
  const f = useCurrentFrame();
  const lf = letterFrames(text, at, keys);
  const start = keys ? keys[0][1] : at, end = lf[lf.length - 1];
  const shown = lf.filter((t) => f >= t).length;
  const typing = shown < text.length;
  const fadeOut = out === undefined ? 1 : interpolate(f, [out, out + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const d = Math.round(size / 8);
  const cursorOn = f >= start && (typing || f < end + 18) && Math.floor(f / 8) % 2 === 0;
  return (
    <>
      <div style={{
        position: "absolute", left: 80, right: 80, top: y, textAlign: "center",
        fontFamily: PX, fontSize: size, lineHeight: 1.35, color, opacity: fadeOut,
        textShadow: `${d}px ${d}px 0 #000, ${d * 2}px ${d * 2}px 0 rgba(0,0,0,.5)`,
      }}>
        {text.slice(0, shown)}
        <span style={{ display: "inline-block", width: "0.6em", height: "0.9em", verticalAlign: "-0.1em", marginLeft: "0.1em", background: cursorOn ? color : "transparent" }} />
        <span style={{ visibility: "hidden" }}>{text.slice(shown)}</span>
      </div>
      {TYPE_SFX && text.split("").map((ch, i) => ch === " " ? null : (
        <Sequence key={i} from={Math.floor(lf[i])} durationInFrames={6} layout="none">
          <Audio src={staticFile(TYPE_SFX)} volume={0.5} />
        </Sequence>
      ))}
    </>
  );
};
