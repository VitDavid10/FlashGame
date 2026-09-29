import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import arena from "../public/arena/events.json";
import action from "../public/action/events.json";
import deaths from "../public/deaths/events.json";
import { KillGainStack, type Kill } from "./KillGain";
import { ArenaFloor, GAME_ANGLE, H, PX, Pill, W } from "./ui";

/*
 * ~29 s of frantic gameplay: skills, last-second escapes and kills that take
 * the other pill's money, cut on every strong beat and broken up by cards
 * that spell out who ate whom and how much they took.
 *
 * Music: public/snd/chaos-music.wav (scripts/chaos-music.py): a song from
 * 1:00, pitched up and re-EQ'd with stutters, same beat. 180 BPM, so a beat
 * is 10 frames and the strong beats fall every 20 frames (0, 20, 40...). Every
 * cut and every kill lands on one. The energy drops at frame 620: that's where
 * "ICEFOX ATE YOU" hits and the outro starts.
 */
export const CHAOS_FRAMES = 880;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Src =
  | { kind: "video"; file: string; from: number; rate?: number }      // from: seconds
  | { kind: "frames"; dir: string; from: number; rate?: number; zoom?: number };  // from: capture frame
type Card = { eater: string; eaten: string; money: string; colors: [string, string, string, string]; lost?: boolean; top?: string };
type Shot = { at: number; len: number; src?: Src; card?: Card; kills?: Kill[] };

// Pill colours of the names on the cards (top, bottom), as they look in the footage.
const C = {
  pillwars: ["#c9ccd1", "#1fe05a"], bandit: ["#e8352b", "#1e8fe6"], noob: ["#9b30c8", "#86c04a"],
  pump: ["#ff6a1f", "#e8352b"], icefox: ["#3f4fd0", "#3f4fd0"], doge: ["#ffc21a", "#138f86"],
} as const;
const cols = (a: keyof typeof C, b: keyof typeof C): Card["colors"] => [...C[a], ...C[b]] as Card["colors"];

const SHOTS: Shot[] = [
  { at: 0, len: 20, card: { top: "EAT", eater: "", eaten: "", money: "OR BE EATEN", colors: cols("pillwars", "bandit") } },
  // Sprinting through a crowd, then Icefox nearly swallows the hero at the virus.
  { at: 20, len: 40, src: { kind: "video", file: "mobile/k4.mp4", from: 0.2, rate: 1.3 } },
  { at: 60, len: 40, src: { kind: "video", file: "mobile/k9.mp4", from: 0.5, rate: 1.25 } },
  // Kill 1 of the arena capture lands on 120.
  { at: 100, len: 60, src: { kind: "frames", dir: "arena", from: arena.kills[0] - 20, zoom: 1.8 }, kills: [{ at: 20, money: "+$16.40", streak: "FIRST BLOOD" }] },
  { at: 160, len: 40, card: { eater: "PILLWARS", eaten: "BANDIT", money: "+$16.40", colors: cols("pillwars", "bandit") } },
  // ETH's giant half a pill away: sprint (1.6 s into the clip) and out.
  { at: 200, len: 40, src: { kind: "video", file: "guide/survive.mp4", from: 1.1, rate: 1.4 } },
  { at: 240, len: 40, src: { kind: "video", file: "mobile/k2.mp4", from: 0.9, rate: 1.3 } },
  // The action take: a catch on 300.
  { at: 280, len: 40, src: { kind: "frames", dir: "action", from: action.events.catch1 - 20 }, kills: [{ at: 20, money: "+$9.80", streak: "" }] },
  { at: 320, len: 40, card: { eater: "NOOB", eaten: "PUMP", money: "+$23.00", colors: cols("noob", "pump") } },
  // Hide inside the virus while the hunter circles, then it bursts.
  { at: 360, len: 60, src: { kind: "video", file: "guide/hide.mp4", from: 2.2, rate: 1.5 } },
  // One beat each: four ways to die.
  ...(["virus", "outnumbered", "shot", "sprint"] as const).map((n, i): Shot => {
    const s = deaths.shots.find((x) => x.name === n)!;
    return { at: 420 + i * 10, len: 10, src: { kind: "frames", dir: "deaths", from: s.best - 4, zoom: 1.3 } };
  }),
  { at: 460, len: 40, card: { eater: "ICEFOX", eaten: "DOGE", money: "+$31.50", colors: cols("icefox", "doge") } },
  // Sprint key, kill on 520.
  { at: 500, len: 40, src: { kind: "video", file: "guide/skills.mp4", from: 6.09 - (20 * 1.25) / 30, rate: 1.25 }, kills: [{ at: 20, money: "+$12.00", streak: "" }] },
  { at: 540, len: 40, src: { kind: "frames", dir: "arena", from: arena.kills[1] - 20, zoom: 1.8 }, kills: [{ at: 20, money: "+$23.00", streak: "DOUBLE KILL" }] },
  // The hero's luck runs out: Icefox's split swallows it right on the drop.
  { at: 580, len: 40, src: { kind: "video", file: "mobile/k9.mp4", from: 3.25 } },
  { at: 620, len: 80, card: { eater: "ICEFOX", eaten: "YOU", money: "-$42.00", lost: true, colors: cols("icefox", "pillwars") } },
];
const CUTS = SHOTS.map((s) => s.at);
const OUTRO = 700, LOGO = 780;

const frameFile = (dir: string, n: number) => staticFile(`${dir}/${String(Math.max(0, Math.round(n))).padStart(4, "0")}.jpg`);
const lastFrame = (dir: string) => (dir === "arena" ? arena.frames : dir === "action" ? action.frames : 400) - 1;

const Footage: React.FC<{ src: Src; len: number }> = ({ src, len }) => {
  const f = useCurrentFrame();
  const rate = src.rate ?? 1;
  const style: React.CSSProperties = { width: W, height: H, objectFit: "cover" };
  // The arena capture is framed wide (a small pill on an empty floor): pushed in, it reads on a phone.
  if (src.kind === "frames") return <Img src={frameFile(src.dir, Math.min(lastFrame(src.dir), src.from + f * rate))} style={{ ...style, transform: `scale(${src.zoom ?? 1})` }} />;
  return <Video src={staticFile(src.file)} trimBefore={Math.round(src.from * 30)} playbackRate={rate} muted style={style} durationInFrames={len} />;
};

// The punch on every strong beat: a quick zoom-in that settles, a shake on
// the cut itself.
const Punch: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const sinceBeat = f % 20;
  const cut = Math.min(...CUTS.map((c) => (f >= c ? f - c : 99)));
  const z = interpolate(sinceBeat, [0, 7], [1.09, 1], clamp);
  const shake = cut < 5 ? (5 - cut) * 7 : 0;
  const dx = (random("x" + f) - 0.5) * shake, dy = (random("y" + f) - 0.5) * shake;
  return <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) scale(${z})` }}>{children}</AbsoluteFill>;
};

// White flash + RGB split for the first frames after a cut.
const CutFlash: React.FC = () => {
  const f = useCurrentFrame();
  const cut = Math.min(...CUTS.map((c) => (f >= c ? f - c : 99)));
  if (cut > 3) return null;
  return (
    <>
      <AbsoluteFill style={{ background: "#fff", opacity: interpolate(cut, [0, 3], [0.55, 0], clamp) }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(255,0,60,.25), transparent 30%, transparent 70%, rgba(0,200,255,.25))", mixBlendMode: "screen" }} />
    </>
  );
};

const shadow = (d: number) => `${d}px ${d}px 0 #000, ${d * 2}px ${d * 2}px 0 rgba(0,0,0,.5)`;

// "NOOB ATE PUMP / +$23.00": the eater's pill, the eaten one greyed out, and
// the money slamming in in the game's kill-pop green (red when it's yours).
const CardScene: React.FC<{ card: Card }> = ({ card }) => {
  const f = useCurrentFrame();
  const slam = interpolate(f, [0, 4], [1.7, 1], clamp);
  const moneyIn = interpolate(f, [5, 9], [2.2, 1], clamp);
  const moneyOp = interpolate(f, [5, 7], [0, 1], clamp);
  const jit = f < 10 ? (random("c" + f) - 0.5) * 16 : 0;
  const green = card.lost ? "#ff2a2a" : "#3ddc84";
  const pulse = card.lost ? 0.5 + 0.5 * Math.sin(f / 3) : 0;
  // The eaten pill shrinks into the eater over the first beat, and the eater
  // ends up alone in the middle.
  const gone = interpolate(f, [2, 10], [1, 0], clamp);
  const plain = !card.eater;
  return (
    <AbsoluteFill>
      <ArenaFloor />
      {card.lost && <AbsoluteFill style={{ background: `radial-gradient(circle, rgba(255,0,0,${0.12 + 0.18 * pulse}) 0%, transparent 70%)` }} />}
      <AbsoluteFill style={{ transform: `translateX(${jit}px) scale(${slam})`, alignItems: "center", justifyContent: "center" }}>
        {plain ? (
          <>
            <div style={{ fontFamily: PX, fontSize: 150, color: "#fff", textShadow: shadow(14) }}>{card.top}</div>
            <div style={{ fontFamily: PX, fontSize: 64, color: "#ff2a2a", marginTop: 40, textShadow: shadow(7), opacity: moneyOp, transform: `scale(${moneyIn})` }}>{card.money}</div>
          </>
        ) : (
          <>
            <div style={{ position: "relative", width: W, height: 300 }}>
              <Pill x={W / 2 - 330 * gone} y={150} wL={22} scale={9} top={card.colors[0]} bot={card.colors[1]} ang={GAME_ANGLE} />
              <Pill x={W / 2 + 330 * gone} y={150} wL={14} scale={9 * (0.3 + 0.7 * gone)} top={card.colors[2]} bot={card.colors[3]} ang={GAME_ANGLE} grey={1 - gone} opacity={gone} />
            </div>
            <div style={{ fontFamily: PX, fontSize: 72, color: "#fff", textShadow: shadow(8), letterSpacing: 4, whiteSpace: "nowrap" }}>
              {card.eater} <span style={{ color: "#ff2a2a" }}>ATE</span> {card.eaten}
            </div>
            <div style={{ fontFamily: PX, fontSize: 120, color: green, marginTop: 50, textShadow: shadow(12), opacity: moneyOp, transform: `scale(${moneyIn})` }}>{card.money}</div>
            <div style={{ fontFamily: PX, fontSize: 30, color: "#fff", marginTop: 40, opacity: interpolate(f, [10, 13], [0, 0.9], clamp), textShadow: shadow(4) }}>
              {card.lost ? "EVERYTHING YOU CARRIED. GONE." : `TAKEN FROM ${card.eaten}`}
            </div>
          </>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// The outro, over the quiet end of the song: the rule of the game, then the logo.
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const bgOp = interpolate(f, [LOGO - OUTRO - 10, LOGO - OUTRO], [0.35, 0.15], clamp);
  const l1 = interpolate(f, [0, 4], [0, 1], clamp), l2 = interpolate(f, [30, 34], [0, 1], clamp);
  const toLogo = interpolate(f, [LOGO - OUTRO - 6, LOGO - OUTRO], [1, 0], clamp);
  const logo = f - (LOGO - OUTRO);
  const end = interpolate(f, [CHAOS_FRAMES - OUTRO - 20, CHAOS_FRAMES - OUTRO], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: end }}>
      <AbsoluteFill style={{ opacity: bgOp, filter: "saturate(1.3)" }}>
        <Video src={staticFile("mobile/k3.mp4")} playbackRate={0.6} loop muted style={{ width: W, height: H, objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: toLogo }}>
        <div style={{ fontFamily: PX, fontSize: 64, color: "#fff", textShadow: shadow(7), opacity: l1, transform: `scale(${interpolate(f, [0, 4], [1.4, 1], clamp)})` }}>EVERY PILL CARRIES MONEY</div>
        <div style={{ fontFamily: PX, fontSize: 84, color: "#3ddc84", marginTop: 70, textShadow: shadow(9), opacity: l2, transform: `scale(${interpolate(f, [30, 34], [1.6, 1], clamp)})` }}>EAT THEM. TAKE IT.</div>
      </AbsoluteFill>
      {logo >= 0 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Img src={staticFile("hero-title.png")} style={{ width: 1100, imageRendering: "pixelated", opacity: interpolate(logo, [0, 6], [0, 1], clamp), transform: `scale(${interpolate(logo, [0, 8], [1.25, 1], clamp)})` }} />
          <div style={{ fontFamily: PX, fontSize: 48, color: "#fff", marginTop: 40, textShadow: shadow(5), opacity: interpolate(logo, [14, 20], [0, 1], clamp) }}>PILLWARS.FUN</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// The game's own sounds, on the frames the picture has them.
const SFX: [string, number, number][] = [
  ...SHOTS.flatMap((s) => (s.kills ?? []).flatMap((k): [string, number, number][] => [["snd/kill1.mp3", s.at + k.at, 0.7], ["snd/money.mp3", s.at + k.at + 2, 0.6]])),
  ...SHOTS.filter((s) => s.card).map((s): [string, number, number] => ["snd/floatkill.mp3", s.at, 0.5]),
  ["snd/money.mp3", 166, 0.5], ["snd/money.mp3", 326, 0.5], ["snd/money.mp3", 466, 0.5],
  ["snd/sprint.mp3", 204, 0.35],
  ["snd/virus.mp3", 414, 0.45],
  ["snd/death.mp3", 604, 0.5],
];

export const Chaos: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <Punch>
      {SHOTS.map((s) => (
        <Sequence key={s.at} from={s.at} durationInFrames={s.len}>
          {s.src && <Footage src={s.src} len={s.len} />}
          {s.card && <CardScene card={s.card} />}
          {/* Twice the game's size (this is the line the video is about), lifted above the pill. */}
          {s.kills && <AbsoluteFill style={{ transform: "scale(2)", transformOrigin: "50% 58%" }}><KillGainStack kills={s.kills} /></AbsoluteFill>}
        </Sequence>
      ))}
    </Punch>
    <Sequence from={OUTRO}><Outro /></Sequence>
    <CutFlash />
    <Audio src={staticFile("snd/chaos-music.wav")} />
    {SFX.map(([src, at, volume], i) => (
      <Sequence key={i} from={at} layout="none"><Audio src={staticFile(src)} volume={volume} /></Sequence>
    ))}
  </AbsoluteFill>
);
