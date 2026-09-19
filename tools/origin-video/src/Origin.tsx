import React from "react";
import {
  AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, Series, interpolate, random, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { ArenaFloor, Caption, Food, GAME_ANGLE, H, PIXEL, PX, Pill, W, typeFrames } from "./ui";
import { PALETTE } from "./pill";
import { KillGainStack, Kill } from "./KillGain";
// Written by capture/director.js next to the frames it recorded from the game.
import capture from "../public/arena/events.json";

// The three kill clips (1.5 s each) for the "Only the ones / that eat / survive"
// beat: drop the recordings in public/deaths/ and list them here, in order.
// `at` = the second of the recording where its 1.5 s slice starts, so a
// 30 s Instant Replay needs no trimming. Any slot left empty shows a placeholder.
//   e.g. { file: "kill1.mp4", at: 12.4 }
const DEATHS: { file: string; at?: number }[] = [];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* 1 — Birth: one pill appears, then dozens. */
const BIRTH_TEXT = "Every day, thousands of coins are born on pump.fun";
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
      <Pill x={W / 2} y={H * 0.42} wL={20} scale={9 * pop} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
      <Caption text={BIRTH_TEXT} at={10} y={H * 0.74} size={42} />
    </AbsoluteFill>
  );
};

/* 2 — The chart: pump, then dump, in exactly the time the caption takes to type. */
const CHART_TEXT = "Most of them die by morning";
const DRAW = typeFrames(CHART_TEXT);
const CHART_DUR = DRAW + 12;
const N = 70;
const PRICE = Array.from({ length: N }, (_, i) => {
  const noise = (random(`p${i}`) - 0.5) * 4;
  if (i < 30) return 12 + i * 0.45 + noise;
  if (i < 45) return 25 + ((i - 30) / 15) ** 2 * 75 + noise;
  if (i < 49) return 100 + noise;
  if (i < 59) return Math.max(4, 100 - ((i - 48) / 10) * 96) + noise * 0.5;
  return 3 + noise * 0.3;
});
const PEAK = 48;
const frameAt = (i: number) => (i / N) * DRAW;

const Chart: React.FC = () => {
  const f = useCurrentFrame();
  const shown = Math.max(2, Math.min(N, Math.floor(interpolate(f, [0, DRAW], [1, N], clamp))));
  const L = 260, R = 1660, T = 170, B = 780;
  const px = (i: number) => L + (i / (N - 1)) * (R - L);
  const py = (v: number) => B - (v / 110) * (B - T);
  const step = (from: number, to: number) => {
    let d = `M ${px(from)} ${py(PRICE[from])}`;
    for (let i = from + 1; i <= to; i++) d += ` H ${px(i)} V ${py(PRICE[i])}`;
    return d;
  };
  const tip = shown - 1;
  const grey = interpolate(f, [frameAt(50), frameAt(60)], [0, 1], clamp);
  const fall = interpolate(f, [frameAt(58), CHART_DUR], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg width={W} height={H} style={{ position: "absolute" }} shapeRendering="crispEdges">
        <line x1={L} y1={B + 6} x2={R} y2={B + 6} stroke="#1a2a20" strokeWidth={4} />
        <path d={step(0, Math.min(tip, PEAK))} fill="none" stroke="#00ff88" strokeWidth={10} strokeLinecap="square" />
        {tip > PEAK && <path d={step(PEAK, tip)} fill="none" stroke="#f62a2d" strokeWidth={10} strokeLinecap="square" />}
      </svg>
      <Pill x={px(tip)} y={py(PRICE[tip]) - 70 + fall * 320} wL={18} scale={6}
        top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE + fall * 2.4} grey={grey} />
      <Caption text={CHART_TEXT} at={0} y={H * 0.84} size={44} />
    </AbsoluteFill>
  );
};

/* 3 — The fall: the screen is already full of grey pills on the first frame,
 *     so the cut from the chart never shows black. */
const FALL_DUR = 105;
const Fall: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, #0b0b0b 0%, #000 70%)" }}>
      {Array.from({ length: 150 }, (_, i) => {
        const speed = 7 + random(`fs${i}`) * 12;
        const y0 = -H * 1.2 + random(`fy${i}`) * H * 2.0;
        const [t, b] = PALETTE[i % PALETTE.length];
        return (
          <Pill key={i} x={random(`fx${i}`) * W} y={y0 + speed * f}
            wL={10 + Math.floor(random(`fw${i}`) * 7)} scale={5}
            top={t} bot={b} ang={random(`fa${i}`) * 6.28 + f * (random(`fr${i}`) - 0.5) * 0.12}
            grey={1} opacity={0.35 + random(`fo${i}`) * 0.5} />
        );
      })}
      <Caption text="Where do dead coins go?" at={10} y={H * 0.44} size={58} />
    </AbsoluteFill>
  );
};

/* 4 — The arena. The dead pills land at the game's -45°, on the game's floor
 *     and food, get their colour back, and then the video cuts into REAL
 *     gameplay captured from the game in classic mode (capture/director.js),
 *     which also does the cinematic push-in with the game's own camera.
 *     The text is split in phrases and each event lands in the pause after
 *     its phrase:
 *       "Eat pills" · kill 1 · "to get their money!" · split + kill 2 ·
 *       "Eat" · kill 3 · "or be eaten" · the hero dies. */
const LAND = 72, XFADE = 10;
const [K1, K2, K3] = capture.kills;
// Kills 2 s apart on screen, the life of the classic money pop-up, so two
// never stack. The capture is retimed in stretches to hit that: straight
// lines between these [video, capture] anchors, each kept near real speed.
const GAP = 64;
const vK1 = K1, vK2 = vK1 + GAP;
// The third kill can come much sooner after the second: stretching that to 2 s
// would be obvious slow motion, so it only eases to ~0.8x there and the older
// pop-up clears out when the new one arrives (see KillGainStack).
const vK3 = vK2 + Math.min(GAP, Math.max(36, Math.round((K3 - K2) / 0.8)));
const vDeath = vK3 + Math.min(45, Math.max(30, capture.deathFrame - K3));
const TAIL = capture.frames - 1 - capture.deathFrame;
const ANCHORS: [number, number][] = [[0, 0], [vK1, K1], [vK2, K2], [vK3, K3], [vDeath, capture.deathFrame], [vDeath + TAIL, capture.frames - 1]];
const toSrc = (f: number) => interpolate(f, ANCHORS.map((a) => a[0]), ANCHORS.map((a) => a[1]), clamp);
const toVideo = (s: number) => interpolate(s, ANCHORS.map((a) => a[1]), ANCHORS.map((a) => a[0]), clamp);
const KILLS = [vK1, vK2, vK3];
const SPLIT = capture.splitFrame == null ? null : Math.round(toVideo(capture.splitFrame));
const DEATH = vDeath;
const FOOT = vDeath + TAIL + 1;
const ARENA_DUR = LAND - XFADE + FOOT;
// What each kill shows, classic style: the money in green, the streak in red.
const STREAK = ["FIRST BLOOD", "DOUBLE KILL", "TRIPLE KILL", "QUADRA KILL", "PENTAKILL"];
const MONEY = ["+$16.40", "+$23.00", "+$31.50", "+$42.00", "+$51.00"];
const POPS: Kill[] = KILLS.map((at, i) => ({ at, money: MONEY[i], streak: STREAK[i] }));

// Each phrase on its own: typed, its event lands in the pause, then it clears
// before the next one starts.
const P1 = "Eat pills", P2 = "to get their money!", P3 = "Eat", P4 = "or be eaten";

const Footage: React.FC = () => {
  const f = useCurrentFrame();
  const src = Math.round(toSrc(f));
  const opacity = interpolate(f, [0, XFADE], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={staticFile(`arena/${String(src).padStart(4, "0")}.jpg`)} style={{ width: W, height: H }} />
      <KillGainStack kills={POPS} />
      {/* The game's own sounds for a classic kill: the eat, the streak, the till. */}
      {KILLS.map((k) => (
        <React.Fragment key={k}>
          <Sequence from={k} layout="none"><Audio src={staticFile("snd/kill1.mp3")} /></Sequence>
          <Sequence from={k} layout="none"><Audio src={staticFile("snd/floatkill.mp3")} volume={0.8} /></Sequence>
          <Sequence from={k + 2} layout="none"><Audio src={staticFile("snd/money.mp3")} volume={0.8} /></Sequence>
        </React.Fragment>
      ))}
      {SPLIT !== null && <Sequence from={SPLIT} layout="none"><Audio src={staticFile("snd/split.mp3")} /></Sequence>}
      <Sequence from={DEATH} layout="none"><Audio src={staticFile("snd/death.mp3")} /></Sequence>
      {/* "Eat pills" · kill 1 */}
      <Caption text={P1} y={H * 0.84} size={52} out={vK1 + 6} keys={[[0, 4], [P1.length, vK1 - 5]]} />
      {/* "to get their money!" · kill 2 */}
      <Caption text={P2} y={H * 0.84} size={52} out={vK3 - 20} keys={[[0, vK1 + 14], [P2.length, vK2 - 5]]} />
      {/* "Eat" · kill 3 */}
      <Caption text={P3} y={H * 0.84} size={56} color="#00ff88" out={vK3 + 6} keys={[[0, vK3 - 12], [P3.length, vK3 - 4]]} />
      {/* "or be eaten" · death */}
      <Caption text={P4} y={H * 0.84} size={56} color="#00ff88" keys={[[0, vK3 + 14], [P4.length, DEATH - 3]]} />
    </AbsoluteFill>
  );
};

const Arena: React.FC = () => {
  const f = useCurrentFrame();
  const heroWL = 22; // r 40 at the game's zoom, same size as in the first captured frame
  const crowd = Array.from({ length: 14 }, (_, i) => {
    let x = 0, y = 0;
    for (let k = 0; k < 20; k++) {
      x = 120 + random(`lx${i}.${k}`) * (W - 240); y = 120 + random(`ly${i}.${k}`) * (H - 240);
      if (Math.hypot(x - W / 2, y - H / 2) > 320) break;
    }
    return { x, y, i };
  });
  const land = (i: number, to: number) =>
    interpolate(f, [2 + i * 2, 16 + i * 2], [-160, to], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const colour = (i: number) => interpolate(f, [22 + i * 1.5, 44 + i * 1.5], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <ArenaFloor opacity={interpolate(f, [0, 12], [0, 1], clamp)} />
      <Food seed="land" opacity={interpolate(f, [6, 24], [0, 1], clamp)} />
      {crowd.map(({ x, y, i }) => {
        const [t, b] = PALETTE[(i + 1) % PALETTE.length];
        return <Pill key={i} x={x} y={land(i, y)} wL={10 + (i % 5) * 2} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} grey={colour(i)} />;
      })}
      <Pill x={W / 2} y={land(8, H / 2)} wL={heroWL} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} grey={colour(8)} />
      <Caption text="They get a second life" at={6} out={LAND - XFADE - 6} y={H * 0.84} size={46} />
      <Sequence from={LAND - XFADE} durationInFrames={FOOT}>
        <Footage />
      </Sequence>
    </AbsoluteFill>
  );
};

/* 5 — Real kills: three 1.5 s clips (placeholder for any still missing).
 *     The line is split over them: each chunk is typed across a full second
 *     and then stays up for half a second before the next one. */
const CHUNKS = ["Only the ones", "that eat", "survive"];
const HOLD = 15; // each chunk stays up half a second once typed
const DEATHS_DUR = CHUNKS.length * (30 + HOLD);
const Deaths: React.FC = () => (
  <AbsoluteFill>
    <Series>
      {CHUNKS.map((chunk, i) => (
        <Series.Sequence key={i} durationInFrames={30 + HOLD}>
          {DEATHS[i] ? (
            <OffthreadVideo src={staticFile(`deaths/${DEATHS[i].file}`)} trimBefore={Math.round((DEATHS[i].at ?? 0) * 30)} style={{ width: W, height: H, objectFit: "cover" }} />
          ) : (
            <>
              <ArenaFloor />
              <div style={{
                position: "absolute", left: 320, top: 150, width: 1280, height: 640,
                border: "8px dashed #1f4d33", display: "flex", alignItems: "center", justifyContent: "center",
                flexDirection: "column", gap: 24, fontFamily: PX, color: "#2f6b4a", fontSize: 30,
              }}>
                <div>KILL CLIP {i + 1}</div>
                <div style={{ fontSize: 18 }}>public/deaths/</div>
              </div>
            </>
          )}
          {/* Footnote right under where the gameplay box sits: it's the real game. */}
          <div style={{
            position: "absolute", left: 0, right: 0, top: 150 + 640 + 18, textAlign: "center",
            fontFamily: PX, fontSize: 16, letterSpacing: 3, color: "rgba(232,245,238,0.75)",
            textShadow: "2px 2px 0 #000",
          }}>ACTUAL GAMEPLAY FOOTAGE</div>
          <Caption text={chunk} keys={[[0, 0], [chunk.length, 29]]} y={H * 0.84} size={56} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

/* 6 — The title exactly as the game's loading screen shows it: the PILLWARS
 *     image (img/pixel-hero/hero-title.png) and THE CRYPTO ARENA in the pixel
 *     font with the same green neon (.ls-sub in game/index.html). */
const TITLE_DUR = 110;
const Title: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 12 } });
  const sub = interpolate(f, [14, 26], [0, 1], clamp);
  const tw = 1150, th = Math.round((tw * 243) / 1200);
  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      <ArenaFloor opacity={0.7} />
      <Food seed="title" n={45} opacity={0.6} />
      <Img src={staticFile("hero-title.png")} style={{
        position: "absolute", width: tw, height: th, left: (W - tw) / 2, top: H * 0.29,
        transform: `scale(${s})`,
      }} />
      <div style={{
        position: "absolute", left: 0, right: 0, top: H * 0.29 + th + 44, textAlign: "center",
        fontFamily: PX, fontSize: 40, letterSpacing: 14, color: "#aaffdd", whiteSpace: "nowrap", opacity: sub,
        textShadow: "0 0 6px #00ff88, 0 0 14px #00ff88, 0 0 26px rgba(0,255,136,0.7)",
      }}>THE CRYPTO ARENA</div>
    </AbsoluteFill>
  );
};

export const SCENES: [React.FC, number][] = [
  [Birth, 90], [Chart, CHART_DUR], [Fall, FALL_DUR], [Arena, ARENA_DUR], [Deaths, DEATHS_DUR], [Title, TITLE_DUR],
];
export const TOTAL = SCENES.reduce((a, [, d]) => a + d, 0);

// Hard cuts, no fades through black between scenes.
export const Origin: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Series>
      {SCENES.map(([Scene, d], i) => (
        <Series.Sequence key={i} durationInFrames={d} premountFor={30}>
          <Scene />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

