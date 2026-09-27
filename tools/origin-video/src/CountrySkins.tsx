import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { PAISES, PAIS_FORMAS, paisPillRot } from "../../../game/paises-pixel.js";
import { ArenaFloor, GAME_ANGLE, H, PX, W } from "./ui";

/* Country skins: 12 of them, one per beat, each pill (drawn by the game's own
   paises-pixel.js) drifting a little sideways over its country's flag, then
   "UP TO 32 COUNTRY SKINS" with the whole set. 8 s, on the drop of "Deflector". */
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const BEAT = (60 / 105) * 30;          // frames per beat (105 BPM)
const SONG_FROM = 21.84;               // the drop: every cut lands on a beat from here
const beat = (n: number) => Math.round(n * BEAT);
export const COUNTRY_SKINS_FRAMES = 240;

const SHOW = ["ES", "BR", "JP", "AR", "MX", "GB", "FR", "CA", "DE", "TR", "PT", "CH"];
const TOTAL = Object.keys(PAISES).length; // 32
const END = beat(SHOW.length);

/* ===== Flags, pixel style: drawn on a 192x108 grid, shown at 10 px per cell. === */
const FW = 192, FH = 108;
type G = CanvasRenderingContext2D;
const rect = (g: G, c: string, x: number, y: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const hBands = (g: G, cols: string[], cuts?: number[]) => {
  const ys = cuts ?? cols.map((_, i) => (i * FH) / cols.length);
  cols.forEach((c, i) => rect(g, c, 0, Math.round(ys[i]), FW, FH));
};
const vBands = (g: G, cols: string[], cuts?: number[]) => {
  const xs = cuts ?? cols.map((_, i) => (i * FW) / cols.length);
  cols.forEach((c, i) => rect(g, c, Math.round(xs[i]), 0, FW, FH));
};
/** One of the game's emblem shapes, centred on (cx, cy), `rx`/`ry` cells wide/tall. */
const stamp = (g: G, forma: string, c: string, cx: number, cy: number, rx: number, ry = rx, rot = 0) => {
  const f = PAIS_FORMAS[forma], co = Math.cos((rot * Math.PI) / 180), si = Math.sin((rot * Math.PI) / 180);
  const r = Math.max(rx, ry);
  g.fillStyle = c;
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = (dx * co + dy * si) / rx, v = (-dx * si + dy * co) / ry;
    if (Math.abs(u) <= 1 && Math.abs(v) <= 1 && f(u, v)) g.fillRect(x, y, 1, 1);
  }
};
const disc = (g: G, c: string, cx: number, cy: number, r: number) => stamp(g, "disco", c, cx, cy, r);

// Spain's arms, cut down to what still reads at this size: crown, the four
// quarters, the pomegranate and the two pillars.
const spainArms = (g: G, cx: number, cy: number) => {
  const x0 = cx - 8, y0 = cy - 11;
  for (const px of [x0 - 6, x0 + 18]) {                      // pillars
    rect(g, "#e8e8e8", px, y0 - 1, 4, 24); rect(g, "#9aa0a6", px + 3, y0 - 1, 1, 24);
    rect(g, "#c8a200", px - 1, y0 - 3, 6, 2); rect(g, "#c8a200", px - 1, y0 + 23, 6, 2);
    rect(g, "#AA151B", px - 1, y0 + 9, 6, 2);                 // the ribbon
  }
  rect(g, "#c8a200", x0 + 1, y0 - 5, 14, 4);                  // crown
  rect(g, "#c8a200", x0 + 3, y0 - 7, 2, 2); rect(g, "#c8a200", x0 + 7, y0 - 8, 2, 3); rect(g, "#c8a200", x0 + 11, y0 - 7, 2, 2);
  rect(g, "#AA151B", x0 + 3, y0 - 4, 10, 2);
  rect(g, "#AA151B", x0, y0, 8, 9); rect(g, "#F1BF00", x0 + 2, y0 + 3, 4, 5); rect(g, "#F1BF00", x0 + 2, y0 + 2, 1, 1); rect(g, "#F1BF00", x0 + 5, y0 + 2, 1, 1);
  rect(g, "#ffffff", x0 + 8, y0, 8, 9); rect(g, "#7b2d8e", x0 + 10, y0 + 2, 4, 5);
  rect(g, "#F1BF00", x0, y0 + 9, 8, 9); for (let i = 0; i < 4; i++) rect(g, "#AA151B", x0 + 1 + i * 2, y0 + 9, 1, 9);
  rect(g, "#AA151B", x0 + 8, y0 + 9, 8, 9); rect(g, "#F1BF00", x0 + 9, y0 + 10, 6, 7); rect(g, "#AA151B", x0 + 10, y0 + 11, 4, 5);
  rect(g, "#ffffff", x0 + 1, y0 + 18, 14, 2); rect(g, "#ffffff", x0 + 3, y0 + 20, 10, 1); rect(g, "#ffffff", x0 + 5, y0 + 21, 6, 1);
  rect(g, "#AA151B", x0 + 7, y0 + 18, 2, 2);
  rect(g, "#1f5fa8", x0 + 6, y0 + 7, 4, 4); rect(g, "#AA151B", x0 + 7, y0 + 8, 2, 2); // the blue oval in the middle
};

const FLAGS: Record<string, (g: G) => void> = {
  ES: (g) => { hBands(g, ["#AA151B", "#F1BF00", "#AA151B"], [0, 27, 81]); spainArms(g, 62, 56); },
  BR: (g) => {
    rect(g, "#009739", 0, 0, FW, FH);
    stamp(g, "rombo", "#FEDD00", 96, 54, 84, 46);
    disc(g, "#012169", 96, 54, 25);
    g.fillStyle = "#ffffff";                                    // "Ordem e Progresso" band
    for (let y = 29; y < 80; y++) for (let x = 71; x < 122; x++) {
      const inD = (x + 0.5 - 96) ** 2 + (y + 0.5 - 54) ** 2 <= 25 * 25;
      const d = Math.hypot(x + 0.5 - 88, y + 0.5 - 118);
      if (inD && d >= 60 && d <= 64) g.fillRect(x, y, 1, 1);
    }
  },
  JP: (g) => { rect(g, "#ffffff", 0, 0, FW, FH); disc(g, "#BC002D", 96, 54, 32); },
  AR: (g) => { hBands(g, ["#74ACDF", "#ffffff", "#74ACDF"]); stamp(g, "sol", "#F6B40E", 96, 54, 15); },
  MX: (g) => { vBands(g, ["#006847", "#ffffff", "#CE1126"]); stamp(g, "aguila", "#6B4A22", 96, 54, 22); },
  GB: (g) => {
    rect(g, "#012169", 0, 0, FW, FH);
    const L = Math.hypot(FW, FH);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d1 = Math.abs(py * FW - px * FH) / L, d2 = Math.abs((FH - py) * FW - px * FH) / L;
      const dx = Math.abs(px - 96), dy = Math.abs(py - 54);
      let c: string | null = null;
      if (Math.min(d1, d2) <= 10.8) c = "#ffffff";
      if (Math.min(d1, d2) <= 3.6) c = "#C8102E";
      if (dx <= 18 || dy <= 18) c = "#ffffff";
      if (dx <= 10.8 || dy <= 10.8) c = "#C8102E";
      if (c) rect(g, c, x, y, 1, 1);
    }
  },
  FR: (g) => vBands(g, ["#002395", "#ffffff", "#ED2939"]),
  CA: (g) => { vBands(g, ["#D80621", "#ffffff", "#D80621"], [0, 48, 144]); stamp(g, "hoja", "#D80621", 96, 54, 30); },
  DE: (g) => hBands(g, ["#000000", "#DD0000", "#FFCE00"]),
  TR: (g) => {
    rect(g, "#E30A17", 0, 0, FW, FH);
    disc(g, "#ffffff", 72, 54, 27); disc(g, "#E30A17", 79, 54, 21.6);
    stamp(g, "estrella", "#ffffff", 103, 54, 13, 13, -90);
  },
  PT: (g) => {
    vBands(g, ["#046A38", "#DA291C"], [0, 77]);
    stamp(g, "aro", "#FFE000", 77, 54, 24);
    rect(g, "#ffffff", 69, 43, 16, 18); rect(g, "#DA291C", 69, 43, 16, 2); rect(g, "#DA291C", 69, 43, 2, 18); rect(g, "#DA291C", 83, 43, 2, 18);
    rect(g, "#DA291C", 69, 59, 16, 2); for (const [x, y] of [[76, 47], [72, 51], [76, 51], [80, 51], [76, 55]]) rect(g, "#002D72", x, y, 2, 3);
  },
  CH: (g) => { rect(g, "#DA291C", 0, 0, FW, FH); rect(g, "#ffffff", 86, 20, 20, 68); rect(g, "#ffffff", 62, 44, 68, 20); },
};

const flagCache = new Map<string, string>();
const flagUrl = (code: string) => {
  const hit = flagCache.get(code); if (hit) return hit;
  const cv = document.createElement("canvas"); cv.width = FW; cv.height = FH;
  FLAGS[code](cv.getContext("2d")!);
  const url = cv.toDataURL(); flagCache.set(code, url); return url;
};
const pillCache = new Map<string, { url: string; S: number }>();
const pillUrl = (code: string, wL: number) => {
  const key = code + wL, hit = pillCache.get(key); if (hit) return hit;
  const o = paisPillRot(wL, code, GAME_ANGLE, true)!;
  const r = { url: o.cv.toDataURL(), S: o.S }; pillCache.set(key, r); return r;
};

/** The pill, the game's -45° capsule, with a hard pixel shadow. */
const CountryPill: React.FC<{ code: string; x: number; y: number; wL: number; scale: number; pop?: number }> = ({ code, x, y, wL, scale, pop = 1 }) => {
  const { url, S } = pillUrl(code, wL), px = S * scale * pop;
  return <Img src={url} style={{ position: "absolute", left: x - px / 2, top: y - px / 2, width: px, height: px, imageRendering: "pixelated",
    filter: `drop-shadow(${scale * 2}px ${scale * 2}px 0 rgba(0,0,0,.55))` }} />;
};

const Shot: React.FC<{ code: string; len: number; dir: number }> = ({ code, len, dir }) => {
  const f = useCurrentFrame();
  const t = f / len;
  // The flag waves: soft light and dark bands running across it.
  const wave = (f * 14) % 480;
  const pop = interpolate(f, [0, 4], [1.12, 1], clamp);
  const drift = interpolate(t, [0, 1], [-45, 45]) * dir;          // slow slide to one side
  const bob = Math.sin((f / BEAT) * Math.PI) * 8;
  return (
    <AbsoluteFill>
      <Img src={flagUrl(code)} style={{ position: "absolute", inset: 0, width: W, height: H, imageRendering: "pixelated", filter: "brightness(.8) saturate(1.05)" }} />
      <AbsoluteFill style={{ backgroundImage: "linear-gradient(90deg, rgba(255,255,255,.10), rgba(0,0,0,.14) 50%, rgba(255,255,255,.10))",
        backgroundSize: "480px 100%", backgroundPosition: `${wave}px 0` }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,.55) 100%)" }} />
      <CountryPill code={code} x={W / 2 + drift} y={H / 2 - 30 + bob} wL={38} scale={7} pop={pop} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 900, textAlign: "center", fontFamily: PX, fontSize: 80, color: "#fff",
        textShadow: "8px 8px 0 #000, 16px 16px 0 rgba(0,0,0,.45)" }}>{PAISES[code].n.toUpperCase()}</div>
    </AbsoluteFill>
  );
};

/** End card: the whole set, then the claim. */
const Finale: React.FC = () => {
  const f = useCurrentFrame();
  const codes = Object.keys(PAISES);
  const cols = 16, gx = 112, x0 = W / 2 - ((cols - 1) * gx) / 2;
  return (
    <AbsoluteFill>
      <ArenaFloor />
      {codes.map((c, i) => {
        const row = Math.floor(i / cols), col = i % cols;
        const on = interpolate(f, [i * 0.4, i * 0.4 + 4], [0, 1], clamp);
        const y = (row === 0 ? 210 : 870) + Math.sin(f / 6 + i) * 5;
        return <div key={c} style={{ opacity: on }}><CountryPill code={c} x={x0 + col * gx} y={y} wL={14} scale={4} pop={0.6 + 0.4 * on} /></div>;
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 385, textAlign: "center", fontFamily: PX, color: "#fff",
        transform: `scale(${interpolate(f, [0, 5], [1.25, 1], clamp)})` }}>
        <div style={{ fontSize: 76, textShadow: "8px 8px 0 #000" }}>UP TO <span style={{ color: "#ffcc00" }}>{TOTAL}</span></div>
        <div style={{ fontSize: 76, marginTop: 40, textShadow: "8px 8px 0 #000" }}>COUNTRY SKINS</div>
        <div style={{ fontSize: 30, marginTop: 56, color: "#ccff00", textShadow: "4px 4px 0 #000", opacity: interpolate(f, [8, 12], [0, 1], clamp) }}>PILLWARS.FUN</div>
      </div>
    </AbsoluteFill>
  );
};

export const CountrySkins: React.FC = () => {
  const f = useCurrentFrame();
  return (
  <AbsoluteFill style={{ background: "#050505" }}>
    {SHOW.map((code, i) => (
      <Sequence key={code} from={beat(i)} durationInFrames={beat(i + 1) - beat(i)}>
        <Shot code={code} len={beat(i + 1) - beat(i)} dir={i % 2 ? -1 : 1} />
      </Sequence>
    ))}
    <Sequence from={END}><Finale /></Sequence>
    <div style={{ position: "absolute", left: 60, top: 50, fontFamily: PX, fontSize: 34, color: "#ffcc00", textShadow: "5px 5px 0 #000",
      opacity: f < END ? 1 : 0 }}>COUNTRY SKINS</div>
    <Audio src={staticFile("mobile/deflector.mp3")} trimBefore={Math.round(SONG_FROM * 30)}
      volume={(v) => interpolate(v, [0, COUNTRY_SKINS_FRAMES - 12, COUNTRY_SKINS_FRAMES], [0.9, 0.9, 0], clamp)} />
  </AbsoluteFill>
  );
};
