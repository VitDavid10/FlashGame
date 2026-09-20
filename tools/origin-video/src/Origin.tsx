import React from "react";
import {
  AbsoluteFill, Easing, Img, Sequence, Series, interpolate, random, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { ArenaFloor, Caption, Food, GAME_ANGLE, H, PIXEL, PX, Pill, W } from "./ui";
import { PALETTE } from "./pill";
import { KillGainStack, Kill } from "./KillGain";
// Written by capture/director.js next to the frames it recorded from the game.
import capture from "../public/arena/events.json";
import skillsCapture from "../public/skills/events.json";
import deathsCapture from "../public/deaths/events.json";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* 1 — Birth: one pill appears, then dozens. The line comes in two halves, each
 *     on one line: the whole sentence wrapped and left a lone "o" typing on
 *     the second line. */
const B1 = "Every day, thousands of coins", B2 = "are born on pump.fun";
const BIRTH_DUR = 139;   // 0 -> 4.64 s, the beat where the chart comes in
const Birth: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 11 } });
  // They keep being born until the cut: stopping early left the screen still
  // for a second while the line was still typing.
  const count = Math.floor(interpolate(f, [10, BIRTH_DUR - 6], [0, 78], clamp));
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {Array.from({ length: count }, (_, i) => {
        const born = 10 + (i / 78) * (BIRTH_DUR - 16);
        const s = interpolate(f, [born, born + 7], [0, 1], clamp);
        const [t, b] = PALETTE[i % PALETTE.length];
        return (
          <Pill key={i} x={random(`bx${i}`) * W} y={random(`by${i}`) * H * 0.7 + 40}
            wL={10} scale={4 * s} top={t} bot={b} ang={random(`ba${i}`) * 6.28} opacity={0.55} />
        );
      })}
      <Pill x={W / 2} y={H * 0.42} wL={20} scale={9 * pop} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
      <Caption text={B1} y={H * 0.84} size={42} out={60} keys={[[0, 8], [B1.length, 44]]} />
      <Caption text={B2} y={H * 0.84} size={42} keys={[[0, 70], [B2.length, 100]]} />
    </AbsoluteFill>
  );
};

/* 2 — The chart: pump, then dump. The line is drawn over the whole scene and
 *     the dump lands under "die by morning", the second half of the phrase. */
const C1 = "Most of them", C2 = "die by morning";
const CHART_DUR = 124;   // 4.64 s -> 8.79 s
const DRAW = CHART_DUR - 12;
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
      {/* "Most of them" up to 6.2 s, then "die by morning" to the cut. */}
      <Caption text={C1} y={H * 0.84} size={44} out={42} keys={[[0, 0], [C1.length, 26]]} />
      <Caption text={C2} y={H * 0.84} size={44} keys={[[0, 50], [C2.length, 88]]} />
    </AbsoluteFill>
  );
};

/* 3 — The fall: the screen is already full of grey pills on the first frame,
 *     so the cut from the chart never shows black. */
const FALL_DUR = 100;   // 8.79 s -> 12.11 s, a whole bar of the music
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
      <Caption text="Where do dead coins go?" at={0} y={H * 0.44} size={58} />
    </AbsoluteFill>
  );
};

/* 4 — The arena. The dead pills land at the game's -45°, on the game's floor
 *     and food, and get their colour back. */
const LAND = 100;   // 12.11 s -> 15.43 s
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
      {/* Stays up ~1 s once typed (done at ~50). */}
      <Caption text="They get a second life" at={4} out={84} y={H * 0.84} size={46} />
    </AbsoluteFill>
  );
};

/* 5 — "in PILLWARS": four short clips from the real game (capture/director.js,
 *     mode 'skills'): a different pill in a different spot of the map each
 *     time, centred and running with a skill on: sprint, shield, magnet and
 *     teleport. The line types in fast on the first and stays through all four. */
// 15.5 s -> 17.9 s: 72 frames over the four clips, the teleport one longer
// (it needs the fade out and back in).
const SPAWN_CUT: Record<string, number> = { tp: 30 };
const spawnLen = (name: string) => SPAWN_CUT[name] ?? 15;
const SPAWN_DUR = skillsCapture.shots.reduce((a, s) => a + spawnLen(s.name), 0);
const SkillShot: React.FC<{ from: number }> = ({ from }) => {
  const f = useCurrentFrame();
  return <Img src={staticFile(`skills/${String(from + f).padStart(4, "0")}.jpg`)} style={{ width: W, height: H }} />;
};
const SPAWN_TEXT = "in PILLWARS";
const Spawn: React.FC = () => (
  <AbsoluteFill>
    <Series>
      {skillsCapture.shots.map((s) => (
        <Series.Sequence key={s.name} durationInFrames={spawnLen(s.name)}>
          <SkillShot from={s.from} />
        </Series.Sequence>
      ))}
    </Series>
    <Caption text={SPAWN_TEXT} y={H * 0.84} size={56} color="#00ff88" keys={[[0, 1], [SPAWN_TEXT.length, 9]]} />
  </AbsoluteFill>
);

/* 6 — REAL gameplay captured from the game in classic mode
 *     (capture/director.js), which also does the cinematic push-in with the
 *     game's own camera. One thing at a time, so it can be read and watched:
 *     each phrase is typed once the previous kill's money pop-up is gone,
 *     clears, and only then its event lands:
 *       "Eat pills" · kill 1 · "to get their money!" · split + kill 2 ·
 *       "Eat" · kill 3 · "or be eaten" · the hero dies. */
const [K1, K2, K3] = capture.kills;
const P1 = "Eat pills", P2 = "to get their money!", P3 = "Eat or be eaten";
// Every event lands on a beat of the track (72.3 bpm, 24.9 frames apart,
// first beat at 0.49 s), counted from the cut at 17.92 s: 18.75, 22.07,
// 23.73 and 25.39 s. Each phrase is typed once the previous pop-up has gone
// and clears 4 frames before its own kill.
const OUT = 12;
const vK1 = 25, vK2 = 125, vK3 = 174, vDeath = 224;
const FOOT = 249;   // to 26.22 s, where the clips take over
// The capture is laid out so that lands close to real speed; what's left is
// evened out in stretches: straight lines between these [video, capture] anchors.
// Only a beat of the capture after the death: at 26.5 s the clips start.
const TAIL = FOOT - 1 - vDeath;
const ANCHORS: [number, number][] = [[0, 0], [vK1, K1], [vK2, K2], [vK3, K3], [vDeath, capture.deathFrame], [vDeath + TAIL, capture.frames - 1]];
const toSrc = (f: number) => interpolate(f, ANCHORS.map((a) => a[0]), ANCHORS.map((a) => a[1]), clamp);
const toVideo = (s: number) => interpolate(s, ANCHORS.map((a) => a[1]), ANCHORS.map((a) => a[0]), clamp);
const KILLS = [vK1, vK2, vK3];
const SPLIT = capture.splitFrame == null ? null : Math.round(toVideo(capture.splitFrame));
const DEATH = vDeath;
// What each kill shows, classic style: the money in green, the streak in red.
const STREAK = ["FIRST BLOOD", "DOUBLE KILL", "TRIPLE KILL", "QUADRA KILL", "PENTAKILL"];
const MONEY = ["+$16.40", "+$23.00", "+$31.50", "+$42.00", "+$51.00"];
const POPS: Kill[] = KILLS.map((at, i) => ({ at, money: MONEY[i], streak: STREAK[i] }));
/** A phrase typed between `start` and `done`, gone 4 frames before `event`. */
const lead = (p: string, start: number, done: number, event: number): { keys: [number, number][]; out: number } =>
  ({ keys: [[0, start], [p.length, done]], out: event - OUT });

const Footage: React.FC = () => {
  const f = useCurrentFrame();
  const src = Math.round(toSrc(f));
  return (
    <AbsoluteFill>
      <Img src={staticFile(`arena/${String(src).padStart(4, "0")}.jpg`)} style={{ width: W, height: H }} />
      <KillGainStack kills={POPS} />
      {/* The game's own sounds for a classic kill: the eat, the streak, the till. */}
      {KILLS.map((k) => (
        <React.Fragment key={k}>
          <Sequence from={k} layout="none"><Audio src={staticFile("snd/kill1.mp3")} volume={0.25} /></Sequence>
          <Sequence from={k} layout="none"><Audio src={staticFile("snd/floatkill.mp3")} volume={0.2} /></Sequence>
          <Sequence from={k + 2} layout="none"><Audio src={staticFile("snd/money.mp3")} volume={0.25} /></Sequence>
        </React.Fragment>
      ))}
      {SPLIT !== null && <Sequence from={SPLIT} layout="none"><Audio src={staticFile("snd/split.mp3")} volume={0.2} /></Sequence>}
      <Sequence from={DEATH} layout="none"><Audio src={staticFile("snd/death.mp3")} volume={0.3} /></Sequence>
      {/* "Eat pills" · kill 1 */}
      <Caption text={P1} y={H * 0.84} size={52} {...lead(P1, 1, 12, vK1)} />
      {/* "to get their money!" · kill 2 */}
      <Caption text={P2} y={H * 0.84} size={52} {...lead(P2, 60, 95, vK2)} />
      {/* "Eat or be eaten" · kill 3, and then the death with the screen clear */}
      <Caption text={P3} y={H * 0.84} size={56} color="#00ff88" {...lead(P3, 142, 162, vK3)} />
    </AbsoluteFill>
  );
};

/* 7 — Six takes from the real game (capture/director.js, mode 'deaths'),
 *     inside the frame the placeholder used to draw, with ACTUAL GAMEPLAY
 *     FOOTAGE under it. Each cut lands on a beat of the track and the takes
 *     are played at 1.6x, so the whole run is as quick as the music. One
 *     single line runs under all six. */
const BEAT = 25;                                   // 72.3 bpm at 30 fps
const CUTS = [BEAT, BEAT, BEAT, BEAT, BEAT, BEAT, BEAT, BEAT - 1];
const RATE = 1.6;                                  // the takes, sped up as far as they stretch
const DEATHS_DUR = CUTS.reduce((a, b) => a + b, 0);
const DEATHS_LINE = "Only the ones that eat survive";
const BOX = { left: 320, top: 150, width: 1280, height: 640 };
// The game's HUD is HTML over its canvas, so it isn't in the capture: the
// director logs what it said on every frame (public/deaths/events.json) and it
// is drawn back here inside the box, with the game's OWN art — the TOP MASS
// panel, the KILLS box and the skill slots are the same PNGs the pixel pack
// uses (game/img/cartel-hero), copied to public/hud.
type Hud = { mass: string; alive: string; time: string; kills: string; lb: { n: string; m: string; me?: boolean }[] };
const chip = {
  fontFamily: PX, fontSize: 11, color: "#e8f5ee", background: "rgba(0,0,0,0.5)",
  border: "1px solid rgba(0,255,136,0.55)", padding: "5px 8px", letterSpacing: 1,
  textShadow: "0 0 6px rgba(0,255,136,0.85), 1px 1px 0 #000",
  boxShadow: "0 0 10px rgba(0,255,136,.5), 3px 3px 0 rgba(0,0,0,.6)",
} as const;
const val = { color: "#ffe97a", textShadow: "0 0 6px rgba(255,206,61,0.8), 1px 1px 0 #000" } as const;
// The four slots of the action bar. Every pill carries its own hand, so each
// take shows a different one instead of the same icon over and over.
const SLOTS: Record<string, (string | null)[]> = {
  virus: ["shoot.png", null, null, null],
  outnumbered: ["shoot.png", "sprint.png", null, null],
  milestone: ["big.png", "shoot.png", "iman.png", null],
  flags: ["sprint.png", "inmune.png", null, null],
  shot: ["shoot.png", "clon.png", null, null],
  sprint: ["sprint.png", "iman.png", null, null],
  shield: ["inmune.png", "tp.png", "shoot.png", null],
  tp: ["tp.png", "clon.png", "sprint.png", null],
};
const SLOTS_DEFAULT = ["shoot.png", null, null, null];
const PANEL_W = 168, PANEL_H = Math.round(PANEL_W * 808 / 601);
const GameHud: React.FC<{ hud?: Hud; shot: string }> = ({ hud, shot }) => {
  if (!hud) return null;
  const slots = SLOTS[shot] ?? SLOTS_DEFAULT;
  return (
    <>
      <div style={{ position: "absolute", left: 14, top: 12, display: "flex", gap: 10 }}>
        <div style={chip}>MASS: <span style={val}>{hud.mass}</span></div>
        <div style={chip}>ALIVE: <span style={val}>{hud.alive}</span></div>
      </div>
      <div style={{
        position: "absolute", left: 0, right: 0, top: 12, textAlign: "center",
        fontFamily: PX, fontSize: 13, color: "#fff", textShadow: "2px 2px 0 #000",
      }}>{hud.time}</div>
      {/* TOP MASS: the panel is the game's PNG, the list is drawn on it. */}
      <div style={{
        position: "absolute", right: 12, top: 10, width: PANEL_W, height: PANEL_H, boxSizing: "border-box",
        padding: `${Math.round(PANEL_W * 44 / 210)}px ${Math.round(PANEL_W * 16 / 210)}px 10px`,
        backgroundImage: `url(${staticFile("hud/top-mass.png")})`, backgroundSize: "100% 100%",
        imageRendering: "pixelated", textShadow: "1px 1px 0 #000",
      }}>
        {hud.lb.slice(0, 10).map((r, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", gap: 8, whiteSpace: "nowrap",
            fontFamily: PX, fontSize: 7, lineHeight: 1.85, color: r.me ? "#00ff88" : "#e6e9ec",
          }}>
            {/* The capture plays with no name, so its own row reads YOU. */}
            <span>{r.me ? r.n.replace(/\s*$/, " YOU") : r.n}</span><span style={{ color: "#ffe97a" }}>{r.m}</span>
          </div>
        ))}
      </div>
      {/* KILLS, in its own box under the panel, same as the game. */}
      <div style={{
        position: "absolute", right: 12 + PANEL_W * 0.15, top: 10 + PANEL_H + 10,
        width: PANEL_W * 0.7, height: PANEL_W * 0.7 * 206 / 326,
        backgroundImage: `url(${staticFile("hud/kills.png")})`, backgroundSize: "100% 100%", imageRendering: "pixelated",
      }}>
        <div style={{
          position: "absolute", left: 0, right: 0, top: "56%", transform: "translateY(-50%)", textAlign: "center",
          fontFamily: PX, fontSize: 16, color: "#ff3b30", textShadow: "0 0 10px rgba(255,60,45,.75), 2px 2px 0 #000",
        }}>{hud.kills || "0"}</div>
      </div>
      {/* The four skill slots, bottom centre. */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 14, display: "flex", justifyContent: "center", gap: 8 }}>
        {slots.map((icon, i) => (
          <div key={i} style={{
            width: 46, height: 46, backgroundImage: `url(${staticFile("hud/skill-slot.png")})`,
            backgroundSize: "100% 100%", imageRendering: "pixelated",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {icon && <Img src={staticFile(`hud/${icon}`)} style={{ width: "68%", height: "68%", imageRendering: "pixelated" }} />}
          </div>
        ))}
      </div>
    </>
  );
};
const DeathClip: React.FC<{ from: number; rate: number; shot: string }> = ({ from, rate, shot }) => {
  const f = useCurrentFrame();
  const at = from + Math.round(f * rate);
  return (
    <div style={{ position: "absolute", ...BOX, overflow: "hidden", border: "8px solid #1f4d33" }}>
      <Img src={staticFile(`deaths/${String(at).padStart(4, "0")}.jpg`)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <GameHud hud={(deathsCapture.hud as Hud[])[at]} shot={shot} />
    </div>
  );
};
const Deaths: React.FC = () => (
  <AbsoluteFill>
    <Series>
      {deathsCapture.shots.map((shot, i) => {
        const len = CUTS[i] ?? BEAT;
        // As fast as the take allows, and cut on its liveliest stretch, which
        // capture/pick-windows.py measures (frame-to-frame change) and writes
        // into the capture as `best`; without it, the end of the take.
        const rate = Math.min(RATE, (shot.frames - 1) / len);
        const from = shot.best ?? shot.from + Math.max(0, shot.frames - 1 - Math.round(len * rate));
        return (
          <Series.Sequence key={shot.name} durationInFrames={len}>
            <DeathClip from={from} rate={rate} shot={shot.name} />
            {/* Right under the box, as on the placeholder: it's the real game. */}
            <div style={{
              position: "absolute", left: 0, right: 0, top: BOX.top + BOX.height + 18, textAlign: "center",
              fontFamily: PX, fontSize: 16, letterSpacing: 3, color: "rgba(232,245,238,0.75)",
              textShadow: "2px 2px 0 #000",
            }}>ACTUAL GAMEPLAY FOOTAGE</div>
          </Series.Sequence>
        );
      })}
    </Series>
    {/* One line for the whole run: the eye stays on the gameplay. */}
    <Caption text={DEATHS_LINE} keys={[[0, 0], [DEATHS_LINE.length, 0]]} y={H * 0.84} size={48} />
  </AbsoluteFill>
);

/* 8 — The title exactly as the game's loading screen shows it: the PILLWARS
 *     image (img/pixel-hero/hero-title.png) and THE CRYPTO ARENA in the pixel
 *     font with the same green neon (.ls-sub in game/index.html). */
const TITLE_DUR = 105;   // the logo holds while the music fades out
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
  [Birth, BIRTH_DUR], [Chart, CHART_DUR], [Fall, FALL_DUR], [Arena, LAND], [Spawn, SPAWN_DUR], [Footage, FOOT], [Deaths, DEATHS_DUR], [Title, TITLE_DUR],
];
export const TOTAL = SCENES.reduce((a, [, d]) => a + d, 0);

// The music the cuts are timed to: the game's own snd/hyoks.mp3, copied to
// public/snd/ (it is not committed twice). The track is 80 s long and the
// video is not: it plays from its first frame, where the sound already
// starts, and fades out over the last 1.5 s.
const MUSIC = "snd/hyoks.mp3";

// Hard cuts, no fades through black between scenes.
export const Origin: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    {MUSIC && <Audio src={staticFile(MUSIC)} volume={(f) => interpolate(f, [TOTAL - 75, TOTAL], [1, 0], clamp)} />}
    <Series>
      {SCENES.map(([Scene, d], i) => (
        <Series.Sequence key={i} durationInFrames={d} premountFor={30}>
          <Scene />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

