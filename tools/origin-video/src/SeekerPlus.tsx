import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { PX } from "./ui";
import { BEAT, END_BEATS, Mobile, MOBILE_FRAMES, SONG_FROM, Seeker, SeekerLockup, at } from "./Mobile";
import plus from "../public/saga/plus.json";

/* "PillWars is coming to Seeker" with an extra scene at second 30, where the phone steps back:
   the phone turns to its back, an EXPLORE THE MENU window pops up, the phone turns again to its
   screen, the menu zooms in and, cut to the beat of the song, everything recorded on David's own
   Saga (ARENAS 2v2 and 1v1 starts, a victory, a defeat, a CLASSIC match with each of its kills,
   the close call and the QUADRA KILL). Then the original goes on.
   The clips are cut from public/saga/*.mp4 by scripts/saga-cuts.py (table: public/saga/plus.json).
   The song is one take over the whole thing (the trailer's own audio is switched off). */
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const GREEN = "#b6f23c";
const bf = (beats: number) => Math.round(beats * BEAT * 30);   // beats -> frames

const SPLIT = at(END_BEATS + 2);          // the phone has stepped back (second 30.4): the extra goes in here
const B_TURN = 3, B_WIN = [3.4, 7.6], B_BACK = [8, 11], B_ZOOM = [11, 14], B_END = 66, B_TOTAL = 68;   // in beats, within the extra
const EXTRA = bf(B_TOTAL);
export const SEEKER_PLUS_FRAMES = MOBILE_FRAMES + EXTRA;

type Row = { beats: number; src: string; t: number; chip?: string };
const ROWS = plus as Row[];
let acc = B_ZOOM[1];
const PLACED = ROWS.map((r, i) => { const b0 = acc; acc += r.beats; return { ...r, i, b0 }; });

const PHONE_SMALL = { scale: 1.231 * 0.55, y: 690 }, PHONE_FULL = { scale: 1.231, y: 540 };

const Chip: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 5, bf(3.4), bf(3.4) + 6], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 26, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${(1 - a) * -14}px)` }}>
      <div style={{ fontFamily: PX, fontSize: 38, color: "#050505", background: GREEN, padding: "12px 24px", boxShadow: "6px 6px 0 #000" }}>{text}</div>
    </div>
  );
};

/** The EXPLORE THE MENU window, in the game's pixel look: pops, holds, closes. */
const Window: React.FC = () => {
  const f = useCurrentFrame();
  const a = bf(B_WIN[0]), b = bf(B_WIN[1]);
  const pop = interpolate(f, [a, a + 8], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
  const shut = interpolate(f, [b, b + 7], [1, 0], clamp);
  if (f < a || f > b + 8) return null;
  const s = (0.7 + 0.3 * pop) * (0.85 + 0.15 * shut);
  return (
    <div style={{ position: "absolute", left: 960 - 520, top: 540 - 150, width: 1040, height: 300, opacity: Math.min(pop, shut), transform: `scale(${s})`, background: "#06120d", border: `8px solid ${GREEN}`, boxShadow: "14px 14px 0 #000" }}>
      <div style={{ height: 52, background: GREEN, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px" }}>
        <div style={{ fontFamily: PX, fontSize: 24, color: "#050505" }}>PILLWARS</div>
        <div style={{ display: "flex", gap: 10 }}>{[0, 1, 2].map((k) => <div key={k} style={{ width: 20, height: 20, background: "#050505" }} />)}</div>
      </div>
      <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: PX, fontSize: 62, color: "#fff", textShadow: "6px 6px 0 #000", letterSpacing: 2 }}>
        EXPLORE <span style={{ color: GREEN, marginLeft: 26 }}>THE MENU</span>
      </div>
    </div>
  );
};

/** The extra scene, frame 0 = the moment the phone has stepped back. */
const Extra: React.FC = () => {
  const f = useCurrentFrame();
  const b = f / (BEAT * 30);
  // phone pose
  const turnAway = interpolate(b, [0, B_TURN], [0, 180], { ...clamp, easing: ease });
  const turnBack = interpolate(b, B_BACK, [0, 1], { ...clamp, easing: ease });
  const ry = b < B_BACK[0] ? turnAway : 180 * (1 - turnBack);
  const zoom = interpolate(b, B_ZOOM, [0, 1], { ...clamp, easing: ease });
  const out = interpolate(b, [B_END, B_TOTAL], [0, 1], { ...clamp, easing: ease });
  const k = zoom * (1 - out);
  const scale = PHONE_SMALL.scale + (PHONE_FULL.scale - PHONE_SMALL.scale) * k;
  const y = PHONE_SMALL.y + (PHONE_FULL.y - PHONE_SMALL.y) * k;
  const lockup = interpolate(b, [B_BACK[1], B_ZOOM[0] + 2, B_END, B_TOTAL], [1, 0, 0, 1], clamp);
  const phoneDim = interpolate(b, [B_WIN[0], B_WIN[0] + 0.6, B_WIN[1], B_WIN[1] + 0.4], [1, 0.35, 0.35, 1], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 50, opacity: lockup, display: "flex", justifyContent: "center" }}><SeekerLockup h={200} /></div>
      <AbsoluteFill style={{ opacity: phoneDim }}>
        <Seeker ry={ry} scale={scale} y={y} screen={
          <>
            <AbsoluteFill><Img src={staticFile("saga/hub.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></AbsoluteFill>
            {PLACED.map((r) => (
              <Sequence key={r.i} from={bf(r.b0)} durationInFrames={bf(r.beats)} layout="none">
                <AbsoluteFill><Video src={staticFile(`saga/cuts/${r.i}.mp4`)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /></AbsoluteFill>
              </Sequence>
            ))}
          </>
        } />
      </AbsoluteFill>
      <Window />
      {PLACED.filter((r) => r.chip).map((r) => <Sequence key={"c" + r.i} from={bf(r.b0)} durationInFrames={bf(Math.min(r.beats, 3.4)) + 8}><Chip text={r.chip!} /></Sequence>)}
      <Sequence from={bf(B_BACK[0])} layout="none"><Audio src={staticFile("snd/sprint.mp3")} volume={0.3} /></Sequence>
      <Sequence from={0} layout="none"><Audio src={staticFile("snd/sprint.mp3")} volume={0.3} /></Sequence>
    </AbsoluteFill>
  );
};

/** Hands the trailer over to the extra scene and back, so the music never breaks. */
const Gate: React.FC<{ from: number; children: React.ReactNode }> = ({ from, children }) => {
  const f = useCurrentFrame();
  return f >= from ? <>{children}</> : null;
};

export const SeekerPlus: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    {/* the trailer up to the phone stepping back */}
    <Sequence from={0} durationInFrames={SPLIT}><Mobile music={false} /></Sequence>
    {/* the extra */}
    <Sequence from={SPLIT} durationInFrames={EXTRA}><Extra /></Sequence>
    {/* and the trailer goes on from where it was (its local frame = global - EXTRA) */}
    <Sequence from={EXTRA} layout="none"><Gate from={SPLIT}><Mobile music={false} /></Gate></Sequence>
    {/* one take of the song, over everything, fading out on the last screen */}
    <Audio src={staticFile("mobile/deflector.mp3")} trimBefore={Math.round(SONG_FROM * 30)}
      volume={(v) => interpolate(v, [0, 4, at(END_BEATS + 29) + EXTRA, SEEKER_PLUS_FRAMES], [0, 0.9, 0.9, 0], clamp)} />
  </AbsoluteFill>
);
