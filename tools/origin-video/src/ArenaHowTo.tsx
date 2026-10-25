import React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { FPS, PX, VT } from "./ui";
import pcArena1 from "../public/demo/pc-arena1.json";

/* ARENAS step by step, for X (~29 s, no voice): the main menu, ARENAS > 1V1 >
   FIND RIVALS > $4 > PAY & READY > CONFIRM, RIVAL FOUND and the VS screen, GO!
   with the spawn protection, a TIME SKIP, the rival eaten and VICTORY. The clips
   are the Demo ones (capture/demo-capture.js); the times of the VS screen, GO!
   and the protection were read off pc-arena1.mp4 (they are not marks).
   pc-arena1-kill.mp4 is a later take of pc-arena1-end where the filmed pill eats
   @nyxie itself (in pc-arena1-end a bot does). Its marks do not match that file
   (it came out ~1.3x longer than the take), so they are read off the video too,
   and it plays at 1.3x. */

type Mark = { label: string; t: number; x?: number; y?: number };
type Clip = { secs: number; marks: Mark[] };
const KILL: Clip = { secs: 22.47, marks: [{ label: "kill", t: 13.5 }, { label: "end", t: 15.3 }, { label: "click", t: 19.4, x: 0.6969, y: 0.6528 }] };
const CLIPS: Record<string, Clip> = { "pc-arena1": pcArena1, "pc-arena1-kill": KILL };
const marks = (c: string, label: string) => CLIPS[c].marks.filter((m) => m.label === label);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const fr = (s: number) => Math.round(s * FPS);
const GREEN = "#b6f23c";

// ---------- the edit ----------
const C = marks("pc-arena1", "click").map((m) => m.t);   // ARENAS, 1V1, FIND RIVALS, $4 FIGHT, PAY & READY, CONFIRM
type Seg = { clip: string; from: number; to: number; rate: number; cut?: boolean; skip?: boolean };
const SEGS: Seg[] = [
  { clip: "pc-arena1", from: 0.8, to: C[5] + 0.6, rate: 1.15 },        // the menu and the six clicks
  { clip: "pc-arena1", from: C[5] + 0.6, to: 14.6, rate: 2.2 },         // RIVAL FOUND, entering in 5..1
  { clip: "pc-arena1", from: 14.6, to: 20, rate: 1.6 },                 // the VS screen
  { clip: "pc-arena1", from: 20, to: 23.6, rate: 1 },                   // GO! and PROTECTED 3s
  { clip: "pc-arena1", from: 23.6, to: 24.6, rate: 1, skip: true },     // TIME SKIP
  { clip: "pc-arena1-kill", from: 11, to: 21, rate: 1.3, cut: true },   // @nyxie comes, gets eaten, VICTORY, CLAIM
];
type Placed = Seg & { at: number; len: number };
const PLACED: Placed[] = [];
{ let at = 0; for (const s of SEGS) { const len = fr((s.to - s.from) / s.rate); PLACED.push({ ...s, at, len }); at += len; } }
const END = PLACED[PLACED.length - 1].at + PLACED[PLACED.length - 1].len;
const OUTRO = fr(2.6);
export const ARENA_HOWTO_FRAMES = END + OUTRO;
// A clip time as a frame of the video (in the first piece that shows it).
const at = (clip: string, t: number) => { const s = PLACED.find((p) => p.clip === clip && t >= p.from && t <= p.to)!; return s.at + fr((t - s.from) / s.rate); };
const framesOf = (label: string) => PLACED.flatMap((s) => CLIPS[s.clip].marks.filter((m) => m.label === label && m.t >= s.from && m.t <= s.to).map((m) => ({ ...m, at: s.at + fr((m.t - s.from) / s.rate) })));

// Captions: [from frame, to frame, text]
const STEPS = ["OPEN ARENAS", "PICK 1V1", "FIND RIVALS", "CHOOSE YOUR ENTRY", "PAY & READY", "CONFIRM"];
const SKIP = PLACED.find((p) => p.skip)!;
const CAPS: [number, number, string][] = [
  ...STEPS.map((t, i): [number, number, string] => [at("pc-arena1", C[i]) - fr(0.35), i < 5 ? at("pc-arena1", C[i + 1]) - fr(0.35) : PLACED[1].at + fr(0.4), `${i + 1} · ${t}`]),
  [PLACED[1].at + fr(0.4), PLACED[2].at, "RIVAL FOUND"],
  [at("pc-arena1", 21), at("pc-arena1", 23.5), "SPAWN PROTECTION · 3S"],
  [SKIP.at, SKIP.at + SKIP.len, "▶▶ TIME SKIP"],
  [at("pc-arena1-kill", 12.2), at("pc-arena1-kill", 15.2), "EAT YOUR RIVAL"],
  [at("pc-arena1-kill", 18.4), END, "CLAIM YOUR PRIZE"],
];

const Caption: React.FC<{ text: string; len: number }> = ({ text, len }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 6, len - 6, len], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 120, bottom: 64, display: "flex", opacity: a, transform: `translateY(${(1 - a) * 12}px)` }}>
      <div style={{ fontFamily: PX, fontSize: 44, color: "#050505", background: GREEN, padding: "16px 28px", border: "5px solid #000", boxShadow: "8px 8px 0 #000" }}>{text}</div>
    </div>
  );
};

/** Jump in time: a quick flash. */
const Flash: React.FC = () => <AbsoluteFill style={{ background: "#fff", opacity: interpolate(useCurrentFrame(), [0, 5], [0.5, 0], clamp) }} />;

/** Fast-forward look over the time skip: tint, scan lines, a streak. */
const Skip: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: "rgba(182,242,60,0.10)", mixBlendMode: "screen" }} />
      <AbsoluteFill style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,.35) 0 3px, transparent 3px 7px)", backgroundPositionY: f * 9 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: ((f * 61) % 1080), height: 26, background: "rgba(255,255,255,.18)" }} />
      <div style={{ position: "absolute", right: 70, top: 60, fontFamily: PX, fontSize: 54, color: "#fff", textShadow: "6px 6px 0 #000" }}>▶▶</div>
    </AbsoluteFill>
  );
};

/** The pointer glides to each click and pulses there. */
const CLICKS = framesOf("click");
const Pointer: React.FC = () => {
  const f = useCurrentFrame();
  const near = CLICKS.filter((c) => f >= c.at - fr(1.6) && f <= c.at + fr(1));
  if (!near.length) return null;
  const nextI = CLICKS.findIndex((c) => c.at >= f);
  const next = nextI >= 0 ? CLICKS[nextI] : CLICKS[CLICKS.length - 1];
  const prev = nextI > 0 ? CLICKS[nextI - 1] : nextI === -1 ? next : { at: next.at - fr(0.6), x: 0.62, y: 0.6 };
  const k = next === prev ? 1 : interpolate(f, [Math.max(prev.at, next.at - fr(0.4)), next.at], [0, 1], clamp);
  const e = 1 - Math.pow(1 - k, 3);
  const x = (prev.x! + (next.x! - prev.x!) * e) * 1920, y = (prev.y! + (next.y! - prev.y!) * e) * 1080;
  const fade = interpolate(f, [near[0].at - fr(1.6), near[0].at - fr(1.3), near[near.length - 1].at + fr(0.7), near[near.length - 1].at + fr(1)], [0, 1, 1, 0], clamp);
  const lastClick = [...CLICKS].reverse().find((c) => c.at <= f);
  const since = lastClick ? f - lastClick.at : 99;
  return (
    <>
      {since < 12 && lastClick && (
        <div style={{ position: "absolute", left: lastClick.x! * 1920 - 34, top: lastClick.y! * 1080 - 34, width: 68, height: 68, borderRadius: "50%", border: `5px solid ${GREEN}`, opacity: (1 - since / 12) * fade, transform: `scale(${0.5 + since / 12})` }} />
      )}
      <svg width="44" height="54" viewBox="0 0 22 27" style={{ position: "absolute", left: x - 3, top: y - 2, opacity: fade, filter: "drop-shadow(3px 3px 0 rgba(0,0,0,.6))", transform: `scale(${since < 5 ? 0.88 : 1})`, transformOrigin: "0 0" }}>
        <path d="M1 1 L1 22 L6.5 17 L10.5 26 L14 24.5 L10 15.8 L17.5 15.8 Z" fill="#fff" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </>
  );
};

const BG = "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)";

export const ArenaHowTo: React.FC = () => {
  const f = useCurrentFrame();
  const inMatch = (v: number) => v >= PLACED[3].at && v < END;
  const fade = (v: number) => interpolate(v, [0, 12, ARENA_HOWTO_FRAMES - 30, ARENA_HOWTO_FRAMES], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {PLACED.map((s, i) => (
        <Sequence key={i} from={s.at} durationInFrames={s.len}>
          <Video src={staticFile(`demo/${s.clip}.mp4`)} muted trimBefore={fr(s.from)} playbackRate={s.rate} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          {s.cut && <Flash />}
          {s.skip && <Skip />}
        </Sequence>
      ))}
      <Pointer />
      {CAPS.map(([a, b, t], i) => <Sequence key={"c" + i} from={a} durationInFrames={b - a}><Caption text={t} len={b - a} /></Sequence>)}

      <Sequence from={END}>
        <AbsoluteFill style={{ background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, opacity: interpolate(f, [END, END + 10], [0, 1], clamp) }}>
          <div style={{ fontFamily: PX, fontSize: 96, color: "#fff", textShadow: "10px 10px 0 #000" }}>ARENAS</div>
          <div style={{ fontFamily: VT, fontSize: 64, color: "#d8f3ee", letterSpacing: 4 }}>1V1 · 2V2 · 3V3</div>
          <div style={{ fontFamily: PX, fontSize: 36, color: GREEN, marginTop: 24 }}>pillwars.fun · @pillwarsdotfun</div>
        </AbsoluteFill>
      </Sequence>

      {CLICKS.map((c, i) => <Sequence key={"t" + i} from={c.at} layout="none"><Audio src={staticFile("snd/type2.wav")} volume={0.5} /></Sequence>)}
      {framesOf("kill").map((k, i) => <Sequence key={"k" + i} from={k.at} layout="none"><Audio src={staticFile("snd/kill1.mp3")} volume={0.6} /></Sequence>)}
      {framesOf("end").map((k, i) => <Sequence key={"w" + i} from={k.at} layout="none"><Audio src={staticFile("snd/money.mp3")} volume={0.55} /></Sequence>)}
      <Audio src={staticFile("demo/menu.mp3")} loop volume={(v) => 0.32 * (inMatch(v) ? 0 : 1) * fade(v)} />
      <Audio src={staticFile("demo/music.mp3")} loop volume={(v) => 0.32 * (inMatch(v) ? 1 : 0) * fade(v)} />
    </AbsoluteFill>
  );
};
