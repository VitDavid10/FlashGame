import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { FPS, PX, VT } from "./ui";
import { Seeker, SolMark } from "./Mobile";
import voice from "../public/demo/voice/voice.json";
import pcArena1 from "../public/demo/pc-arena1.json";
import pcArena1End from "../public/demo/pc-arena1-end.json";
import pc2v2 from "../public/demo/pc-2v2.json";
import pc2v2End from "../public/demo/pc-2v2-end.json";
import pcMenus from "../public/demo/pc-menus.json";
import pcPenta from "../public/demo/pc-penta.json";
import mArena from "../public/demo/m-arena.json";
import mArenaEnd from "../public/demo/m-arena-end.json";

/* Gameplay demo, about 2:30: the PC game first (ARENAS 1v1 and 2v2 with a
   friend, the menus, a CLASSIC room and a PENTAKILL), then the app inside a
   Seeker (its menu, a CLASSIC match and an ARENAS duel). The app's CLASSIC is
   the offline match of capture/mobile-demo-capture.js (public/mobile-demo/):
   in the phone-sized headless browser the paid room's ROOM INFO overflows the
   screen, so that one is not recorded online.
   Every clip is the real game recorded from a local server (capture/demo-capture.js,
   capture/demo-kit.js): paid rooms with $PILLY, test friends and test rivals.
   The clips carry marks (clicks, the start of the match, kills, the end screen)
   and the edit is cut on them. The voice is short (scripts/demo-voice.py), with
   its subtitles; under it, only the game's own music: the menu track while a
   menu is on screen and the match track from the start of each match. */

type Mark = { label: string; t: number; x?: number; y?: number; name?: string };
type Clip = { secs: number; marks: Mark[] };
const CLIPS: Record<string, Clip> = {
  "pc-arena1": pcArena1, "pc-arena1-end": pcArena1End, "pc-2v2": pc2v2, "pc-2v2-end": pc2v2End,
  "pc-menus": pcMenus, "pc-penta": pcPenta,
  "m-arena": mArena, "m-arena-end": mArenaEnd,
  "md-classic": { secs: 26, marks: [] }, "md-menu": { secs: 3, marks: [] },
};
// Where each clip's file is (the demo ones by default).
const SRC: Record<string, string> = { "md-classic": "mobile-demo/classic.mp4", "md-menu": "mobile-demo/menu.jpg" };
const marks = (c: string, label: string) => CLIPS[c].marks.filter((m) => m.label === label);
const first = (c: string, label: string, dflt = 0) => marks(c, label)[0]?.t ?? dflt;
const last = (c: string, label: string, dflt = 0) => { const l = marks(c, label); return l.length ? l[l.length - 1].t : dflt; };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const fr = (s: number) => Math.round(s * FPS);
const GREEN = "#b6f23c";

// ---------- the edit: pieces of clips, in order ----------
// rate > 1 speeds up the menu clicking; `cut` marks a jump in time inside a match.
type Seg = { clip: string; from: number; to: number; rate: number; chip?: string; cut?: boolean; phone?: boolean; menu?: boolean };
const end = (c: string) => CLIPS[c].secs;
const pcSegs: Seg[] = [
  { clip: "pc-arena1", from: 0.3, to: last("pc-arena1", "click") + 0.6, rate: 1.35, chip: "ARENAS · 1V1" },
  { clip: "pc-arena1", from: last("pc-arena1", "click") + 0.6, to: first("pc-arena1", "go") + 4.5, rate: 1.1 },
  { clip: "pc-arena1-end", from: Math.max(0, first("pc-arena1-end", "kill", 3) - 2.6), to: Math.min(end("pc-arena1-end"), last("pc-arena1-end", "click", first("pc-arena1-end", "end") + 3) + 1.4), rate: 1, cut: true },
  { clip: "pc-2v2", from: 0.3, to: last("pc-2v2", "click") + 0.6, rate: 1.5, chip: "FRIENDS · 2V2" },
  { clip: "pc-2v2", from: last("pc-2v2", "click") + 0.6, to: first("pc-2v2", "go") + 4, rate: 1.15 },
  { clip: "pc-2v2-end", from: Math.max(0, first("pc-2v2-end", "kill", 3) - 2.4), to: Math.min(end("pc-2v2-end"), first("pc-2v2-end", "end") + 3.6), rate: 1, cut: true },
  { clip: "pc-menus", from: 0.3, to: last("pc-menus", "click") + 0.5, rate: 1.45, chip: "MENUS · QUESTS · ROOMS" },
  { clip: "pc-menus", from: last("pc-menus", "click") + 0.5, to: first("pc-menus", "go") + 4.5, rate: 1, chip: "CLASSIC · $5 ROOM" },
  { clip: "pc-penta", from: Math.max(0, first("pc-penta", "kill", 3) - 2.2), to: Math.min(end("pc-penta"), first("pc-penta", "end") + 4.8), rate: 1, cut: true },
];
const mSegs: Seg[] = [
  { clip: "md-menu", from: 0, to: 2.6, rate: 1, chip: "THE APP", phone: true, menu: true },
  { clip: "md-classic", from: 0, to: 9, rate: 1, chip: "CLASSIC", phone: true },
  { clip: "md-classic", from: 16, to: 25, rate: 1, cut: true, phone: true },
  { clip: "m-arena", from: Math.max(0, first("m-arena", "click") - 0.4), to: last("m-arena", "click") + 0.5, rate: 1.3, chip: "ARENAS · 1V1", phone: true },
  { clip: "m-arena", from: last("m-arena", "click") + 0.5, to: first("m-arena", "go") + 6, rate: 1.1, phone: true },
  { clip: "m-arena-end", from: Math.max(0, first("m-arena-end", "kill", 3) - 3), to: Math.min(end("m-arena-end"), first("m-arena-end", "end") + 4), rate: 1, cut: true, phone: true },
];
const segLen = (s: Seg) => fr((s.to - s.from) / s.rate);
type Placed = Seg & { at: number; len: number };
const place = (segs: Seg[], at: number): Placed[] => segs.map((s) => { const p = { ...s, at, len: segLen(s) }; at += p.len; return p; });

const PC = place(pcSegs, 0);
const PC_END = PC[PC.length - 1].at + PC[PC.length - 1].len;
const CARD = fr(2.6);                       // "ON YOUR PHONE" card between the two halves
const PHONE_IN = PC_END + CARD;
const M = place(mSegs, PHONE_IN);
const M_END = M[M.length - 1].at + M[M.length - 1].len;
const OUTRO = fr(4.5);
export const DEMO_FRAMES = M_END + OUTRO;

// A clip time (seconds) inside a placed piece -> frame of the video.
const atClip = (segs: Placed[], clip: string, t: number) => {
  const s = segs.find((x) => x.clip === clip && t >= x.from - 0.01 && t <= x.to + 0.01) || segs.find((x) => x.clip === clip)!;
  return s.at + fr((Math.min(Math.max(t, s.from), s.to) - s.from) / s.rate);
};
const segOf = (segs: Placed[], clip: string) => segs.find((x) => x.clip === clip)!;

// Menu or match on screen? Before a clip's 'go' mark it is the menu (and the VS
// screen); from 'go' on, and in the clips that only show a match ending, the match.
const inMatch = (fr_: number) => {
  const s = [...PC, ...M].find((x) => fr_ >= x.at && fr_ < x.at + x.len);
  if (!s || s.menu) return false;   // the phone card, the outro and the menu stills: menu music
  const go = marks(s.clip, "go")[0];
  if (!go) return true;
  return s.at + fr((go.t - s.from) / s.rate) <= fr_;
};
// 0..1 towards the match track, eased over half a second each way.
const MATCH_MIX: number[] = [];
{ let v = 0; for (let i = 0; i < 20000; i++) { v += ((inMatch(i) ? 1 : 0) - v) * 0.12; MATCH_MIX.push(v); } }

// ---------- voice: where each line starts ----------
type V = { id: string; text: string; len: number };
const VO = voice as V[];
const vo = (id: string) => VO.find((v) => v.id === id)!;
const CUES: { id: string; at: number }[] = [
  { id: "intro", at: fr(0.4) },
  { id: "duel", at: atClip(PC, "pc-arena1", marks("pc-arena1", "click")[2]?.t ?? 5) },
  { id: "win", at: atClip(PC, "pc-arena1-end", first("pc-arena1-end", "end") + 0.4) },
  { id: "friends", at: segOf(PC, "pc-2v2").at + fr(0.4) },
  { id: "menus", at: segOf(PC, "pc-menus").at + fr(0.4) },
  { id: "classic", at: atClip(PC, "pc-menus", first("pc-menus", "go") + 0.6) },
  { id: "penta", at: atClip(PC, "pc-penta", first("pc-penta", "end") - 0.4) },
  { id: "mobile", at: PC_END + fr(0.3) },
  { id: "outro", at: M_END + fr(0.6) },
];

// ---------- pieces ----------
const Chip: React.FC<{ text: string; phone?: boolean }> = ({ text, phone }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 8, fr(3.2), fr(3.2) + 10], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: phone ? 36 : 120, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${(1 - a) * -12}px)` }}>
      <div style={{ fontFamily: PX, fontSize: 30, color: "#050505", background: GREEN, padding: "12px 22px", boxShadow: "6px 6px 0 #000" }}>{text}</div>
    </div>
  );
};

/** Jump in time inside a match: a quick flash and a "LATER" tag. */
const Cut: React.FC<{ phone?: boolean }> = ({ phone }) => {
  const f = useCurrentFrame();
  const flash = interpolate(f, [0, 5], [0.55, 0], clamp);
  const a = interpolate(f, [0, 4, 30, 38], [0, 1, 1, 0], clamp);
  return (
    <>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
      <div style={{ position: "absolute", right: phone ? 160 : 48, top: phone ? 150 : 140, opacity: a, fontFamily: VT, fontSize: 46, color: "#fff", background: "rgba(5,5,5,.8)", border: `3px solid ${GREEN}`, padding: "2px 16px", letterSpacing: 4 }}>
        ▶▶ LATER
      </div>
    </>
  );
};

const ClipVideo: React.FC<{ s: Placed }> = ({ s }) => {
  const src = staticFile(SRC[s.clip] || `demo/${s.clip}.mp4`), st = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } as const;
  return /\.jpg$/.test(src) ? <Img src={src} style={st} /> : <Video src={src} muted trimBefore={fr(s.from)} playbackRate={s.rate} style={st} />;
};

// Mouse pointer for the PC clicks: it glides to each click and pulses there.
type Click = { at: number; x: number; y: number };
const clicksOf = (segs: Placed[]): Click[] => {
  const out: Click[] = [];
  for (const s of segs) for (const m of CLIPS[s.clip].marks) if (m.label === "click" && m.t >= s.from && m.t <= s.to) out.push({ at: s.at + fr((m.t - s.from) / s.rate), x: m.x!, y: m.y! });
  return out.sort((a, b) => a.at - b.at);
};
const PC_CLICKS = clicksOf(PC);
const Pointer: React.FC = () => {
  const f = useCurrentFrame();
  // only around the clicking: from shortly before a run of clicks to shortly after it
  const near = PC_CLICKS.filter((c) => f >= c.at - fr(2.2) && f <= c.at + fr(1.2));
  if (!near.length) return null;
  const nextI = PC_CLICKS.findIndex((c) => c.at >= f);
  const next = nextI >= 0 ? PC_CLICKS[nextI] : PC_CLICKS[PC_CLICKS.length - 1];
  const prev = nextI > 0 ? PC_CLICKS[nextI - 1] : nextI === -1 ? next : { at: next.at - fr(0.6), x: 0.62, y: 0.6 };
  const k = next === prev ? 1 : interpolate(f, [Math.max(prev.at, next.at - fr(0.45)), next.at], [0, 1], clamp);
  const e = 1 - Math.pow(1 - k, 3);
  const x = (prev.x + (next.x - prev.x) * e) * 1920, y = (prev.y + (next.y - prev.y) * e) * 1080;
  const fade = interpolate(f, [near[0].at - fr(2.2), near[0].at - fr(1.9), near[near.length - 1].at + fr(0.9), near[near.length - 1].at + fr(1.2)], [0, 1, 1, 0], clamp);
  const lastClick = [...PC_CLICKS].reverse().find((c) => c.at <= f);
  const since = lastClick ? f - lastClick.at : 99;
  return (
    <>
      {since < 12 && lastClick && (
        <div style={{ position: "absolute", left: lastClick.x * 1920 - 34, top: lastClick.y * 1080 - 34, width: 68, height: 68, borderRadius: "50%", border: `5px solid ${GREEN}`,
          opacity: (1 - since / 12) * fade, transform: `scale(${0.5 + since / 12})` }} />
      )}
      <svg width="44" height="54" viewBox="0 0 22 27" style={{ position: "absolute", left: x - 3, top: y - 2, opacity: fade, filter: "drop-shadow(3px 3px 0 rgba(0,0,0,.6))", transform: `scale(${since < 5 ? 0.88 : 1})`, transformOrigin: "0 0" }}>
        <path d="M1 1 L1 22 L6.5 17 L10.5 26 L14 24.5 L10 15.8 L17.5 15.8 Z" fill="#fff" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </>
  );
};

// Phone taps: a ripple where the finger went (on the Seeker's screen).
const PHONE = { scale: 1.08, y: 548 }, PW = 1560, PH = PW * 1080 / 2400;
const M_CLICKS = clicksOf(M);
const Taps: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      {M_CLICKS.filter((c) => f >= c.at && f < c.at + 16).map((c, i) => {
        const k = (f - c.at) / 16;
        const x = 960 + (c.x - 0.5) * PW * PHONE.scale, y = PHONE.y + (c.y - 0.5) * PH * PHONE.scale;
        return <div key={i} style={{ position: "absolute", left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,.35)", border: "4px solid #fff", opacity: 1 - k, transform: `scale(${0.4 + k})` }} />;
      })}
    </>
  );
};

/** Subtitle: the line being said, whole, soft in and out. */
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

export const Demo: React.FC = () => {
  const f = useCurrentFrame();
  const phoneIn = interpolate(f, [PHONE_IN - 14, PHONE_IN + 10], [0, 1], clamp);
  const phoneOut = interpolate(f, [M_END - 6, M_END + 12], [1, 0], clamp);
  const voiceAt = (fr_: number) => CUES.some((c) => fr_ >= c.at - 6 && fr_ < c.at + fr(vo(c.id).len) + 6);
  const kills = [...PC, ...M].flatMap((s) => CLIPS[s.clip].marks.filter((m) => m.label === "kill" && m.t >= s.from && m.t <= s.to).map((m) => s.at + fr((m.t - s.from) / s.rate)));
  const wins = [...PC, ...M].flatMap((s) => CLIPS[s.clip].marks.filter((m) => m.label === "end" && m.t >= s.from && m.t <= s.to).map((m) => s.at + fr((m.t - s.from) / s.rate)));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* PC: full frame */}
      {PC.map((s, i) => (
        <Sequence key={"pc" + i} from={s.at} durationInFrames={s.len}>
          <ClipVideo s={s} />
          {s.cut && <Cut />}
        </Sequence>
      ))}
      <Pointer />
      {PC.filter((s) => s.chip).map((s, i) => <Sequence key={"pcc" + i} from={s.at} durationInFrames={fr(3.6)}><Chip text={s.chip!} /></Sequence>)}

      {/* card: the same game, on the phone */}
      <Sequence from={PC_END} durationInFrames={CARD + 14}>
        <AbsoluteFill style={{ background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34,
          opacity: interpolate(f - PC_END, [0, 8, CARD, CARD + 14], [0, 1, 1, 0], clamp) }}>
          <div style={{ fontFamily: PX, fontSize: 84, color: "#fff", textShadow: "8px 8px 0 #000" }}>NOW ON</div>
          <div style={{ fontFamily: PX, fontSize: 84, color: GREEN, textShadow: "8px 8px 0 #000" }}>YOUR PHONE</div>
          <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 18, fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 50, fontWeight: 600, color: "#d8f3ee", letterSpacing: 4 }}>
            <SolMark h={56} /><span>SOLANA MOBILE</span>
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* the app, inside a Seeker */}
      {f >= PHONE_IN - 14 && f < M_END + 12 && (
        <AbsoluteFill style={{ background: BG, opacity: phoneIn * phoneOut }}>
          <AbsoluteFill style={{ transform: `translateY(${(1 - phoneIn) * 40}px)` }}>
            <Seeker ry={0} scale={PHONE.scale} y={PHONE.y} screen={
              <>
                {M.map((s, i) => (
                  <Sequence key={"m" + i} from={s.at} durationInFrames={s.len} layout="none">
                    <AbsoluteFill><ClipVideo s={s} /></AbsoluteFill>
                  </Sequence>
                ))}
              </>
            } />
          </AbsoluteFill>
          <Taps />
          {M.filter((s) => s.cut).map((s, i) => <Sequence key={"mc" + i} from={s.at} durationInFrames={40}><Cut phone /></Sequence>)}
          {M.filter((s) => s.chip).map((s, i) => <Sequence key={"mch" + i} from={s.at} durationInFrames={fr(3.6)}><Chip text={s.chip!} phone /></Sequence>)}
        </AbsoluteFill>
      )}

      {/* outro */}
      <Sequence from={M_END + 4}>
        <AbsoluteFill style={{ background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, opacity: interpolate(f, [M_END + 4, M_END + 18], [0, 1], clamp) }}>
          <div style={{ fontFamily: PX, fontSize: 96, color: "#fff", textShadow: "10px 10px 0 #000" }}>PILLWARS</div>
          <div style={{ fontFamily: VT, fontSize: 60, color: "#d8f3ee", letterSpacing: 3 }}>KILL · EARN · CASH OUT</div>
          <div style={{ fontFamily: PX, fontSize: 36, color: GREEN, marginTop: 24 }}>pillwars.fun · @pillwarsdotfun</div>
        </AbsoluteFill>
      </Sequence>

      <Subs />

      {/* sound: voice, the game's music under it (menu / match), a hit on each kill and the coins on each win */}
      {CUES.map((c) => <Sequence key={c.id} from={c.at} layout="none"><Audio src={staticFile(`demo/voice/${c.id}.mp3`)} /></Sequence>)}
      {kills.map((k, i) => <Sequence key={"k" + i} from={k} layout="none"><Audio src={staticFile("snd/kill1.mp3")} volume={0.6} /></Sequence>)}
      {wins.map((k, i) => <Sequence key={"w" + i} from={k} layout="none"><Audio src={staticFile("snd/money.mp3")} volume={0.55} /></Sequence>)}
      <Audio src={staticFile("demo/menu.mp3")} loop
        volume={(v) => (voiceAt(v) ? 0.14 : 0.32) * (1 - (MATCH_MIX[v] ?? 0)) * interpolate(v, [0, 12, DEMO_FRAMES - 40, DEMO_FRAMES], [0, 1, 1, 0], clamp)} />
      <Audio src={staticFile("demo/music.mp3")} loop
        volume={(v) => (voiceAt(v) ? 0.14 : 0.32) * (MATCH_MIX[v] ?? 0) * interpolate(v, [0, 12, DEMO_FRAMES - 40, DEMO_FRAMES], [0, 1, 1, 0], clamp)} />
    </AbsoluteFill>
  );
};
