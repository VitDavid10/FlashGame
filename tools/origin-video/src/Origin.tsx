import React from "react";
import {
  AbsoluteFill, Easing, OffthreadVideo, Series, interpolate, random, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { Caption, Food, Grid, H, PX, Pill, VT, W } from "./ui";
import { PALETTE } from "./pill";

// Drop a clip at public/gameplay.mp4 and set this to "gameplay.mp4" to replace
// the placeholder in the last-but-one scene with real footage.
const GAMEPLAY: string | null = null;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Fades a whole scene in and out so the hard cuts don't jump. */
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(interpolate(f, [0, 8], [0, 1], clamp), interpolate(f, [dur - 8, dur], [1, 0], clamp));
  return <AbsoluteFill style={{ opacity: o, backgroundColor: "#000" }}>{children}</AbsoluteFill>;
};

/* 1 — Birth: one pill appears, then thousands. */
const Birth: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 11 } });
  const count = Math.floor(interpolate(f, [12, 85], [0, 70], clamp));
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {Array.from({ length: count }, (_, i) => {
        const born = 12 + (i / 70) * 73;
        const s = interpolate(f, [born, born + 5], [0, 1], clamp);
        const [t, b] = PALETTE[i % PALETTE.length];
        return (
          <Pill key={i} x={random(`bx${i}`) * W} y={random(`by${i}`) * H * 0.7 + 40}
            wL={10} scale={4 * s} top={t} bot={b} ang={random(`ba${i}`) * 6.28} opacity={0.55} />
        );
      })}
      <Pill x={W / 2} y={H * 0.42} wL={20} scale={9 * pop} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={-Math.PI / 4} />
      <Caption text="Every day, thousands of coins are born on pump.fun." at={15} y={H * 0.74} size={42} />
    </AbsoluteFill>
  );
};

/* 2 — The chart: pump, then dump. The pill rides the tip and dies with it. */
const N = 70;
const PRICE = Array.from({ length: N }, (_, i) => {
  const noise = (random(`p${i}`) - 0.5) * 4;
  if (i < 30) return 12 + i * 0.45 + noise;
  if (i < 45) return 25 + ((i - 30) / 15) ** 2 * 75 + noise;
  if (i < 49) return 100 + noise;
  if (i < 59) return Math.max(4, 100 - ((i - 48) / 10) * 96) + noise * 0.5;
  return 3 + noise * 0.3;
});
const PEAK = 48, DRAW = 150;
const frameAt = (i: number) => (i / N) * DRAW;

const Chart: React.FC = () => {
  const f = useCurrentFrame();
  const shown = Math.max(2, Math.min(N, Math.floor(interpolate(f, [0, DRAW], [1, N], clamp))));
  const L = 260, R = 1660, T = 170, B = 780;
  const px = (i: number) => L + (i / (N - 1)) * (R - L);
  const py = (v: number) => B - (v / 110) * (B - T);
  // Stepped "pixel" line: horizontal then vertical, never diagonal.
  const step = (from: number, to: number) => {
    let d = `M ${px(from)} ${py(PRICE[from])}`;
    for (let i = from + 1; i <= to; i++) d += ` H ${px(i)} V ${py(PRICE[i])}`;
    return d;
  };
  const tip = shown - 1;
  const grey = interpolate(f, [frameAt(52), frameAt(60) + 15], [0, 1], clamp);
  const fall = interpolate(f, [frameAt(58), DRAW + 30], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg width={W} height={H} style={{ position: "absolute" }} shapeRendering="crispEdges">
        <line x1={L} y1={B + 6} x2={R} y2={B + 6} stroke="#1a2a20" strokeWidth={4} />
        <path d={step(0, Math.min(tip, PEAK))} fill="none" stroke="#00ff88" strokeWidth={10} strokeLinecap="square" />
        {tip > PEAK && <path d={step(PEAK, tip)} fill="none" stroke="#f62a2d" strokeWidth={10} strokeLinecap="square" />}
      </svg>
      <Pill x={px(tip)} y={py(PRICE[tip]) - 70 + fall * 260} wL={18} scale={6}
        top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={-Math.PI / 4 + fall * 2.4} grey={grey} />
      <Caption text="Most of them die by morning." at={frameAt(57)} y={H * 0.84} size={44} />
    </AbsoluteFill>
  );
};

/* 3 — The fall: a rain of grey pills into the dark. */
const Fall: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, #0b0b0b 0%, #000 70%)" }}>
      {Array.from({ length: 140 }, (_, i) => {
        const speed = 6 + random(`fs${i}`) * 11;
        const y0 = -random(`fy${i}`) * H * 1.6 - 120;
        const [t, b] = PALETTE[i % PALETTE.length];
        return (
          <Pill key={i} x={random(`fx${i}`) * W} y={y0 + speed * f}
            wL={10 + Math.floor(random(`fw${i}`) * 7)} scale={5}
            top={t} bot={b} ang={random(`fa${i}`) * 6.28 + f * (random(`fr${i}`) - 0.5) * 0.12}
            grey={1} opacity={0.35 + random(`fo${i}`) * 0.5} />
        );
      })}
      <Caption text="Where do dead coins go?" at={45} y={H * 0.44} size={58} />
    </AbsoluteFill>
  );
};

/* 4 — The arena: they land, get their colour back, and start eating. */
const HERO_FROM = 380, HERO_TO = 1650, HUNT_START = 110, HUNT_END = 250, HERO_Y = 560;
const VICTIMS = [820, 1120, 1420];
const heroX = (f: number) => interpolate(f, [HUNT_START, HUNT_END], [HERO_FROM, HERO_TO], clamp);
const eatenAt = (vx: number) => HUNT_START + ((vx - 50 - HERO_FROM) / (HERO_TO - HERO_FROM)) * (HUNT_END - HUNT_START);

const Arena: React.FC = () => {
  const f = useCurrentFrame();
  const land = (i: number) => 6 + i * 4;
  const colour = (i: number) => interpolate(f, [45 + i * 3, 75 + i * 3], [1, 0], clamp);
  const eaten = VICTIMS.filter((vx) => f >= eatenAt(vx)).length;
  // Background crowd, kept off the hero's lane.
  const crowd = Array.from({ length: 12 }, (_, i) => {
    const tx = 140 + random(`cx${i}`) * (W - 280);
    const upper = i % 2 === 0;
    const ty = upper ? 150 + random(`cy${i}`) * 230 : 700 + random(`cy${i}`) * 110;
    return { tx, ty, i };
  });
  return (
    <AbsoluteFill>
      <Grid opacity={interpolate(f, [0, 20], [0, 1], clamp)} />
      <Food seed="arena" opacity={interpolate(f, [10, 40], [0, 1], clamp)} />
      {crowd.map(({ tx, ty, i }) => {
        const [t, b] = PALETTE[(i + 1) % PALETTE.length];
        const y = interpolate(f, [land(i), land(i) + 18], [-150, ty], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
        return (
          <Pill key={i} x={tx + Math.sin(f / 28 + i) * 22} y={y + Math.cos(f / 34 + i) * 14}
            wL={12 + (i % 4) * 2} scale={5} top={t} bot={b} ang={Math.sin(f / 40 + i) * 0.6} grey={colour(i)} />
        );
      })}
      {VICTIMS.map((vx, k) => {
        const e = eatenAt(vx);
        const gone = interpolate(f, [e, e + 7], [1, 0], clamp);
        const [t, b] = PALETTE[(k + 3) % PALETTE.length];
        const x = vx + (heroX(f) - vx) * (1 - gone);
        const y = interpolate(f, [land(12 + k), land(12 + k) + 18], [-150, HERO_Y + (k - 1) * 40], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
        return gone > 0 ? (
          <Pill key={`v${k}`} x={x} y={y} wL={12} scale={5 * gone} top={t} bot={b} grey={colour(12 + k)} />
        ) : null;
      })}
      <Pill x={heroX(f)} y={interpolate(f, [land(15), land(15) + 18], [-200, HERO_Y], { ...clamp, easing: Easing.out(Easing.back(1.6)) })}
        wL={18 + eaten * 5} scale={6} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={Math.PI / 2} grey={colour(15)} />
      <Caption text="They get a second life." at={55} out={150} y={H * 0.83} size={46} />
      <Caption text="Eat or be eaten." at={165} y={H * 0.83} size={52} color="#00ff88" />
    </AbsoluteFill>
  );
};

/* 5 — Real gameplay (placeholder until the clip exists). */
const Gameplay: React.FC = () => (
  <AbsoluteFill>
    {GAMEPLAY ? (
      <OffthreadVideo src={staticFile(GAMEPLAY)} muted style={{ width: W, height: H, objectFit: "cover" }} />
    ) : (
      <>
        <Grid />
        <div style={{
          position: "absolute", left: 320, top: 150, width: 1280, height: 680,
          border: "8px dashed #1f4d33", display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 24, fontFamily: PX, color: "#2f6b4a", fontSize: 30,
        }}>
          <div>REAL GAMEPLAY CLIP</div>
          <div style={{ fontFamily: VT, fontSize: 34 }}>public/gameplay.mp4</div>
        </div>
      </>
    )}
    <Caption text="Only the ones that eat survive." at={25} y={H * 0.86} size={44} />
  </AbsoluteFill>
);

/* 6 — Title. */
const Title: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 12 } });
  const s2 = spring({ frame: f - 6, fps, config: { damping: 13 } });
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Grid opacity={0.5} />
      <Pill x={W / 2} y={H * 0.3} wL={20} scale={8 * s} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={-Math.PI / 4} />
      <div style={{
        position: "absolute", left: 0, right: 0, top: H * 0.5, textAlign: "center",
        fontFamily: PX, fontSize: 130, color: "#00ff88", transform: `scale(${s2})`,
        textShadow: "16px 16px 0 #000, 22px 22px 0 rgba(0,0,0,.5)",
      }}>PILLWARS</div>
      <div style={{
        position: "absolute", left: 0, right: 0, top: H * 0.72, textAlign: "center",
        fontFamily: VT, fontSize: 52, color: "#8fa89a", opacity: interpolate(f, [25, 40], [0, 1], clamp),
      }}>pillwars.fun</div>
    </AbsoluteFill>
  );
};

export const SCENES: [React.FC, number][] = [
  [Birth, 90], [Chart, 210], [Fall, 210], [Arena, 270], [Gameplay, 270], [Title, 110],
];
export const TOTAL = SCENES.reduce((a, [, d]) => a + d, 0);

export const Origin: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Series>
      {SCENES.map(([Scene, d], i) => (
        <Series.Sequence key={i} durationInFrames={d} premountFor={30}>
          <Fade dur={d}><Scene /></Fade>
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
