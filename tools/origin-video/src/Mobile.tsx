import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { PX } from "./ui";

/* "PillWars is coming to Saga & Seeker": real gameplay recorded on a Saga
   (screenrecord over adb, staged by scratchpad saga-play.js), inside a
   phone lying on its side, in Solana Mobile's colours. No airdrop, no perks. */
const SOL = "linear-gradient(90deg, #9945ff, #14f195)";
const BG = "linear-gradient(180deg, #030607 0%, #071413 45%, #1d6b64 100%)";
const sec = (s: number) => Math.round(s * 30);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const INTRO = sec(2.4), PLAY = sec(15.05), OUTRO = sec(3.6);
export const MOBILE_FRAMES = INTRO + PLAY + OUTRO;

const Bar: React.FC<{ x: number; y: number; w: number; h: number; o?: number }> = ({ x, y, w, h, o = 1 }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: o, background: SOL, borderRadius: 16,
    clipPath: `polygon(${h}px 0, 100% 0, calc(100% - ${h}px) 100%, 0 100%)` }} />
);
// A phone on its side; the screen is 2400x1080 like the Saga's.
const Phone: React.FC<{ cx: number; cy: number; w: number; rot: number; body: string; edge: string; buttons?: string; children: React.ReactNode }> = ({ cx, cy, w, rot, body, edge, buttons, children }) => {
  const h = w * 1080 / 2400, b = w * 0.026;
  return (
    <div style={{ position: "absolute", left: cx - w / 2 - b, top: cy - h / 2 - b, width: w + b * 2, height: h + b * 2, transform: `rotate(${rot}deg)` }}>
      {buttons && <>
        <div style={{ position: "absolute", left: w * 0.55, top: -b * 0.35, width: w * 0.09, height: b * 0.5, background: buttons, borderRadius: 6 }} />
        <div style={{ position: "absolute", left: w * 0.67, top: -b * 0.35, width: w * 0.05, height: b * 0.5, background: buttons, borderRadius: 6 }} />
      </>}
      <div style={{ position: "absolute", inset: 0, background: body, borderRadius: b * 3.2, border: `3px solid ${edge}`, boxShadow: "0 40px 80px rgba(0,0,0,.7)" }} />
      <div style={{ position: "absolute", left: b, top: b, width: w, height: h, borderRadius: b * 2.2, overflow: "hidden", background: "#000" }}>
        {children}
        <AbsoluteFill style={{ background: "linear-gradient(115deg, rgba(255,255,255,.10), rgba(255,255,255,0) 32%)" }} />
      </div>
    </div>
  );
};
const Grad: React.FC<{ size: number; children: React.ReactNode }> = ({ size, children }) => (
  <span style={{ fontFamily: PX, fontSize: size, background: SOL, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: `drop-shadow(${size / 12}px ${size / 12}px 0 #000)` }}>{children}</span>
);
const Line: React.FC<{ y: number; size: number; children: React.ReactNode; o?: number }> = ({ y, size, children, o = 1 }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center", opacity: o, fontFamily: PX, fontSize: size, color: "#fff", textShadow: `${size / 12}px ${size / 12}px 0 #000` }}>{children}</div>
);
// What's happening, in a small tag under the phone (times in the gameplay clip).
const TAGS: [number, number, string][] = [[3.9, 5.9, "PICK YOUR SKILLS"], [7.4, 9.3, "SPLIT & EAT"], [9.6, 11.2, "SPRINT"], [12.6, 14.9, "BLINK AWAY"]];
const Tag: React.FC = () => {
  const f = useCurrentFrame(), t = f / 30, cur = TAGS.find(([a, b]) => t >= a && t < b);
  if (!cur) return null;
  const k = Math.min(1, (t - cur[0]) * 6, (cur[1] - t) * 6);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, display: "flex", justifyContent: "center", opacity: k }}>
      <div style={{ padding: "12px 26px", background: "#000", border: "4px solid #14f195", fontFamily: PX, fontSize: 34, color: "#fff", transform: `scale(${0.9 + k * 0.1})` }}>{cur[2]}</div>
    </div>
  );
};
// Sounds of the game, on the moments of the clip.
const SFX: [number, string, number][] = [[5.55, "snd/money.mp3", 0.5], [8.3, "snd/split.mp3", 0.7], [8.5, "snd/kill1.mp3", 0.8], [9.84, "snd/sprint.mp3", 0.7], [13.35, "snd/shield.mp3", 0.7]];

export const Mobile: React.FC = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  // intro -> gameplay: the phone comes forward and fills the frame
  const zoom = interpolate(f, [INTRO - 14, INTRO + 6], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
  const inPop = spring({ frame: f, fps, config: { damping: 14 } });
  const outK = interpolate(f, [INTRO + PLAY - 8, INTRO + PLAY + 10], [0, 1], clamp);
  const w = interpolate(zoom, [0, 1], [1160, 1720]) * interpolate(outK, [0, 1], [1, 0.62]);
  const cy = interpolate(zoom, [0, 1], [610, 555]) + outK * 60;
  const cx = 960 - outK * 330;
  const rot = interpolate(zoom, [0, 1], [-7, -1.5]) + outK * -6;
  const titleO = interpolate(f, [INTRO - 16, INTRO - 4], [1, 0], clamp);
  const outro = f >= INTRO + PLAY - 8;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Bar x={-140} y={700} w={560} h={62} o={0.5} />
      <Bar x={-180} y={790} w={560} h={62} o={0.35} />
      <Bar x={1600} y={40} w={440} h={50} o={0.5} />
      <Bar x={1640} y={110} w={440} h={50} o={0.35} />

      {/* intro: the title over the phone showing the start screen */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 60, display: "flex", justifyContent: "center", opacity: titleO, transform: `scale(${0.8 + inPop * 0.2})` }}>
        <Img src={staticFile("howto/brand.png")} style={{ width: 700, filter: "drop-shadow(8px 8px 0 #000)" }} />
      </div>
      <Line y={225} size={36} o={titleO * interpolate(f, [12, 20], [0, 1], clamp)}>ON YOUR PHONE</Line>

      {/* during the gameplay: a slim title on top */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 18, textAlign: "center", opacity: interpolate(f, [INTRO, INTRO + 10], [0, 1], clamp) * (1 - outK) }}>
        <span style={{ fontFamily: PX, fontSize: 30, color: "#fff", textShadow: "3px 3px 0 #000" }}>COMING TO </span><Grad size={30}>SAGA & SEEKER</Grad>
      </div>

      {outro && <Phone cx={1420} cy={600 - (1 - outK) * 40} w={700 * outK + 1} rot={8} body="#0a0a0b" edge="#26292c" buttons="#1fd18a">
        <Img src={staticFile("perks/screen-arcade.png")} style={{ width: "100%", height: "100%" }} />
      </Phone>}
      <div style={{ opacity: interpolate(f, [0, 8], [0, 1], clamp), transform: `translateY(${(1 - inPop) * 80}px)` }}>
        <Phone cx={cx} cy={cy} w={w} rot={rot} body="#2e3b3d" edge="#4b5a5c">
          <Sequence durationInFrames={INTRO} layout="none"><Video src={staticFile("mobile/start.mp4")} muted style={{ width: "100%", height: "100%" }} /></Sequence>
          <Sequence from={INTRO} layout="none"><Video src={staticFile("mobile/gameplay.mp4")} muted style={{ width: "100%", height: "100%" }} /></Sequence>
        </Phone>
      </div>
      <Sequence from={INTRO} durationInFrames={PLAY} layout="none"><Tag /></Sequence>

      {/* outro */}
      {outro && <>
        <Line y={90 - (1 - outK) * 30} size={78} o={outK}>COMING SOON</Line>
        <div style={{ position: "absolute", left: 0, right: 0, top: 205, textAlign: "center", opacity: outK }}><Grad size={62}>SAGA & SEEKER</Grad></div>
        <Line y={915} size={30} o={interpolate(f, [INTRO + PLAY + 10, INTRO + PLAY + 22], [0, 1], clamp)}>ON THE SOLANA dAPP STORE</Line>
        <Line y={975} size={28} o={interpolate(f, [INTRO + PLAY + 18, INTRO + PLAY + 30], [0, 1], clamp)}><span style={{ color: "#ccff00" }}>PILLWARS.FUN</span></Line>
      </>}

      {/* the game's own music and sounds */}
      <Audio src={staticFile("guide/music.mp3")} volume={(v) => interpolate(v, [0, 12, MOBILE_FRAMES - 30, MOBILE_FRAMES], [0, 0.35, 0.35, 0], clamp)} />
      <Sequence from={INTRO - 10} layout="none"><Audio src={staticFile("snd/split.mp3")} volume={0.4} /></Sequence>
      {SFX.map(([t, src, v]) => <Sequence key={src + t} from={INTRO + sec(t)} layout="none"><Audio src={staticFile(src)} volume={v} /></Sequence>)}
    </AbsoluteFill>
  );
};
