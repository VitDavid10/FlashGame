import React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { FPS, PX, VT } from "./ui";
import voice from "../public/modes/voice.json";
import pcArena1 from "../public/demo/pc-arena1.json";
import pc2v2End from "../public/demo/pc-2v2-end.json";
import pcMenus from "../public/demo/pc-menus.json";
import pcPenta from "../public/demo/pc-penta.json";

/* The two game modes in ~30 s, for X: CLASSIC (the ROOMS menu, a $5 room and a
   PENTAKILL) and then ARENAS, the other menu, for when there are not enough
   players around (1v1 into the VS screen, and a 2v2 won). Arcade is left out:
   it is not official yet. The clips are the Demo ones (capture/demo-capture.js)
   and the edit is cut on their marks; the voice is scripts/modes-voice.py. */

type Mark = { label: string; t: number; x?: number; y?: number };
type Clip = { secs: number; marks: Mark[] };
const CLIPS: Record<string, Clip> = { "pc-arena1": pcArena1, "pc-2v2-end": pc2v2End, "pc-menus": pcMenus, "pc-penta": pcPenta };
const marks = (c: string, label: string) => CLIPS[c].marks.filter((m) => m.label === label);
const first = (c: string, label: string, dflt = 0) => marks(c, label)[0]?.t ?? dflt;
const last = (c: string, label: string, dflt = 0) => { const l = marks(c, label); return l.length ? l[l.length - 1].t : dflt; };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const fr = (s: number) => Math.round(s * FPS);
const GREEN = "#b6f23c";

// ---------- the edit ----------
type Seg = { clip: string; from: number; to: number; rate: number; chip?: string; cut?: boolean };
const ROOMS = marks("pc-menus", "click")[6]?.t ?? 16.5;   // the 7th click: ROOMS (after CORE, THE PILL, QUESTS and 3 quests)
const SEGS: Seg[] = [
  { clip: "pc-menus", from: ROOMS - 0.5, to: first("pc-menus", "go") + 0.5, rate: 1.5, chip: "CLASSIC" },
  { clip: "pc-penta", from: Math.max(0, first("pc-penta", "kill") - 0.7), to: first("pc-penta", "end") + 2.3, rate: 1, cut: true },
  { clip: "pc-arena1", from: first("pc-arena1", "click") - 0.4, to: last("pc-arena1", "click") + 0.6, rate: 1.7, chip: "ARENAS" },
  { clip: "pc-arena1", from: last("pc-arena1", "click") + 0.6, to: first("pc-arena1", "go") + 5.2, rate: 1.25 },   // RIVAL FOUND, the VS screen and GO!
  { clip: "pc-2v2-end", from: last("pc-2v2-end", "kill") - 2, to: first("pc-2v2-end", "end") + 2.5, rate: 1, chip: "2V2", cut: true },
];
type Placed = Seg & { at: number; len: number };
const PLACED: Placed[] = [];
{ let at = 0; for (const s of SEGS) { const len = fr((s.to - s.from) / s.rate); PLACED.push({ ...s, at, len }); at += len; } }
const END = PLACED[PLACED.length - 1].at + PLACED[PLACED.length - 1].len;
const OUTRO = fr(2.6);
export const MODES_FRAMES = END + OUTRO;
// A clip's marks as frames of the video (those inside the pieces shown).
const framesOf = (label: string) => PLACED.flatMap((s) => CLIPS[s.clip].marks.filter((m) => m.label === label && m.t >= s.from && m.t <= s.to).map((m) => ({ ...m, at: s.at + fr((m.t - s.from) / s.rate) })));

// ---------- voice ----------
type V = { id: string; text: string; len: number };
const vo = (id: string) => (voice as V[]).find((v) => v.id === id)!;
const CUES = [
  { id: "intro", at: fr(0.3) },
  { id: "classic", at: fr(0.3) + fr(vo("intro").len) + fr(0.35) },
  { id: "arenas", at: PLACED[2].at + fr(0.2) },
  { id: "teams", at: PLACED[3].at + fr(0.3) },
  { id: "outro", at: END + fr(0.3) },
];

const Chip: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 8, fr(3.2), fr(3.2) + 10], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 120, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${(1 - a) * -12}px)` }}>
      <div style={{ fontFamily: PX, fontSize: 40, color: "#050505", background: GREEN, padding: "14px 26px", boxShadow: "6px 6px 0 #000" }}>{text}</div>
    </div>
  );
};

/** Jump in time: a quick flash. */
const Flash: React.FC = () => <AbsoluteFill style={{ background: "#fff", opacity: interpolate(useCurrentFrame(), [0, 5], [0.5, 0], clamp) }} />;

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

/** Subtitle: the line being said, whole. */
const Subs: React.FC = () => {
  const f = useCurrentFrame();
  const cur = CUES.find((c) => f >= c.at - 3 && f < c.at + fr(vo(c.id).len) + 10);
  if (!cur) return null;
  const e = cur.at + fr(vo(cur.id).len);
  const a = interpolate(f, [cur.at - 3, cur.at + 3, e + 2, e + 10], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 46, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${(1 - a) * 10}px)` }}>
      <div style={{ maxWidth: 1500, textAlign: "center", fontFamily: "'DM Sans', 'Segoe UI', Arial, sans-serif", fontWeight: 700, fontSize: 46, lineHeight: 1.25, color: "#fff",
        background: "rgba(5,5,5,0.8)", padding: "12px 28px", borderRadius: 12, border: "2px solid rgba(182,242,60,0.55)" }}>{vo(cur.id).text}</div>
    </div>
  );
};

const BG = "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)";

export const Modes: React.FC = () => {
  const f = useCurrentFrame();
  const voiceAt = (v: number) => CUES.some((c) => v >= c.at - 6 && v < c.at + fr(vo(c.id).len) + 6);
  // menu music until the classic match, then the match music
  const inMatch = (v: number) => v >= PLACED[1].at && !(v >= PLACED[2].at && v < PLACED[4].at);
  const fade = (v: number) => interpolate(v, [0, 12, MODES_FRAMES - 30, MODES_FRAMES], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {PLACED.map((s, i) => (
        <Sequence key={i} from={s.at} durationInFrames={s.len}>
          <Video src={staticFile(`demo/${s.clip}.mp4`)} muted trimBefore={fr(s.from)} playbackRate={s.rate} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          {s.cut && <Flash />}
        </Sequence>
      ))}
      <Pointer />
      {PLACED.filter((s) => s.chip).map((s, i) => <Sequence key={"c" + i} from={s.at} durationInFrames={fr(3.6)}><Chip text={s.chip!} /></Sequence>)}

      <Sequence from={END}>
        <AbsoluteFill style={{ background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, opacity: interpolate(f, [END, END + 10], [0, 1], clamp) }}>
          <div style={{ fontFamily: PX, fontSize: 96, color: "#fff", textShadow: "10px 10px 0 #000" }}>PILLWARS</div>
          <div style={{ fontFamily: VT, fontSize: 64, color: "#d8f3ee", letterSpacing: 4 }}>CLASSIC · ARENAS</div>
          <div style={{ fontFamily: PX, fontSize: 36, color: GREEN, marginTop: 24 }}>pillwars.fun · @pillwarsdotfun</div>
        </AbsoluteFill>
      </Sequence>

      <Subs />

      {CUES.map((c) => <Sequence key={c.id} from={c.at} layout="none"><Audio src={staticFile(`modes/${c.id}.mp3`)} /></Sequence>)}
      {framesOf("kill").map((k, i) => <Sequence key={"k" + i} from={k.at} layout="none"><Audio src={staticFile("snd/kill1.mp3")} volume={0.6} /></Sequence>)}
      {framesOf("end").map((k, i) => <Sequence key={"w" + i} from={k.at} layout="none"><Audio src={staticFile("snd/money.mp3")} volume={0.55} /></Sequence>)}
      <Audio src={staticFile("demo/menu.mp3")} loop volume={(v) => (voiceAt(v) ? 0.14 : 0.32) * (inMatch(v) ? 0 : 1) * fade(v)} />
      <Audio src={staticFile("demo/music.mp3")} loop volume={(v) => (voiceAt(v) ? 0.14 : 0.32) * (inMatch(v) ? 1 : 0) * fade(v)} />
    </AbsoluteFill>
  );
};
