import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { FPS, PX, VT } from "./ui";
import voice from "../public/howto/voice.json";
import rects from "../public/howto/rects.json";

/* How to join the airdrop, narrated. Clips of the real page (capture/howto-capture.js),
   voice + word timings (scripts/howto-voice.py), and on top: a slow zoom towards
   what is being talked about, boxes that pop in on the word, and subtitles. */

type Rect = [number, number, number, number];
type Voice = { id: string; text: string; words: { t: number; d: number; w: string }[] };
const V = voice as Voice[];
const R = rects as unknown as Record<string, Record<string, { t: number; r: Rect }>>;
const vo = (id: string) => V.find((s) => s.id === id)!;
const LEAD = 0.25; // s of clip before the voice starts
const TAIL = 0.75; // s after the last word
const sec = (s: number) => Math.round(s * FPS);
/** Time (s, in the scene) at which the word starting with `w` is said. */
const at = (id: string, w: string, nth = 0) => {
  const hits = vo(id).words.filter((x) => x.w.toLowerCase().startsWith(w.toLowerCase()));
  return LEAD + (hits[nth] ?? hits[0]).t;
};
const voiceLen = (id: string) => { const ws = vo(id).words; return ws[ws.length - 1].t + ws[ws.length - 1].d; };
const rect = (scene: string, name: string) => R[scene][name].r;
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};

type Mark = { from: number; to?: number; r: Rect; label?: string; color?: string; below?: boolean };
type Focus = { t: number; r?: Rect; z: number };
type Scene = { id: string; clip: string; clipFrom?: number; step?: string; marks?: Mark[]; focus?: Focus[]; extra?: React.FC };

const GREEN = "#00ff88", GOLD = "#ffce3d";

const SCENES: Scene[] = [
  { id: "intro", clip: "intro" },
  {
    id: "x", clip: "x", step: "STEP 1 · CONNECT X",
    focus: [{ t: 0, z: 1 }, { t: 1.2, r: rect("x", "cx"), z: 1.55 }],
    marks: [{ from: at("x", "connect"), r: rect("x", "xbtn"), label: "CLICK" }, { from: at("x", "followers"), r: rect("x", "cx"), color: GOLD }],
  },
  {
    id: "wallet", clip: "wallet", step: "STEP 2 · ADD YOUR WALLET",
    focus: [{ t: 0, z: 1 }, { t: 6.4, r: rect("wallet", "paste"), z: 1.45 }],
    marks: [
      { from: at("wallet", "signature") - 0.6, to: at("wallet", "Or"), r: rect("wallet", "safe"), label: "NOTHING LEAVES YOUR WALLET", below: true },
      { from: at("wallet", "Connecting"), to: at("wallet", "signature") - 0.6, r: union(rect("wallet", "wallets"), rect("wallet", "last")) },
      { from: at("wallet", "paste"), r: rect("wallet", "paste"), label: "OR PASTE IT", color: GOLD },
    ],
  },
  {
    id: "card", clip: "card", step: "YOUR POINTS",
    focus: [{ t: 0, z: 1 }, { t: 0.8, r: rect("card", "card"), z: 1.2 }],
    marks: [{ from: at("card", "history"), to: at("card", "card", 0) - 0.2, r: rect("card", "cw"), color: GOLD }, { from: at("card", "card"), r: rect("card", "card"), label: "TOTAL + RANK", below: true }],
  },
  {
    id: "boost", clip: "boost", step: "BOOST QUESTS = ×1.5",
    focus: [{ t: 0, r: rect("boost", "banner"), z: 1.45 }, { t: 3.4, r: rect("boost", "once"), z: 1.55 }],
    marks: [
      { from: at("boost", "four"), to: at("boost", "Follow") - 0.3, r: rect("boost", "banner"), label: "ESSENTIAL", color: GOLD },
      { from: at("boost", "Follow"), r: rect("boost", "once"), label: "ALL 4", color: GOLD },
    ],
    extra: () => <Stamp from={sec(at("boost", "multiplied"))} text="×1.5" sub="ALL YOUR POINTS" />,
  },
  {
    id: "arena", clip: "arena", step: "DAILY ARENA",
    focus: [{ t: 0, z: 1 }, { t: 2.2, r: rect("arena", "game"), z: 1.08 }],
    marks: [{ from: 2.3, to: at("arena", "clear"), r: rect("arena", "title") }, { from: at("arena", "clear"), r: rect("arena", "game"), label: "PLAY HERE" }],
  },
  {
    id: "game", clip: "game", step: "WANT MORE INFO?",
    focus: [{ t: 0, r: rect("game", "tab"), z: 1.4 }, { t: 3.3, z: 1 }],
    marks: [{ from: at("game", "game") - 0.1, to: 3.3, r: rect("game", "tab"), label: "THE GAME", color: GOLD }],
  },
  { id: "outro", clip: "intro", clipFrom: 5.5, extra: () => <Outro /> },
];
const lenOf = (s: Scene) => sec(LEAD + voiceLen(s.id) + (s.id === "outro" ? 1.6 : TAIL));
export const HOWTO_FRAMES = SCENES.reduce((a, s) => a + lenOf(s), 0);

/** Pops in on its word: a pulsing frame with an optional tag above. */
const Box: React.FC<Mark & { f: number }> = ({ from, to, r, label, color = GREEN, below, f }) => {
  const { fps } = useVideoConfig();
  const a = f - sec(from);
  if (a < 0 || (to !== undefined && f > sec(to) + 6)) return null;
  const inS = spring({ frame: a, fps, config: { damping: 14, stiffness: 180 } });
  const out = to === undefined ? 1 : interpolate(f, [sec(to), sec(to) + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pad = 10, pulse = 0.5 + 0.5 * Math.sin(a / 5);
  const [x, y, w, h] = r;
  return (
    <div style={{ position: "absolute", left: x - pad, top: y - pad, width: w + pad * 2, height: h + pad * 2, opacity: out,
      transform: `scale(${interpolate(inS, [0, 1], [1.25, 1])})`, transformOrigin: "center" }}>
      <div style={{ position: "absolute", inset: 0, border: `6px solid ${color}`, boxShadow: `0 0 ${18 + 16 * pulse}px ${color}, inset 0 0 ${10 + 8 * pulse}px ${color}66` }} />
      {label && (
        <div style={{ position: "absolute", left: -6, ...(below ? { bottom: -58 } : { top: -58 }), padding: "10px 14px", background: color, color: "#03140a",
          fontFamily: PX, fontSize: 22, whiteSpace: "nowrap", boxShadow: "4px 4px 0 #000" }}>{label}</div>
      )}
    </div>
  );
};

/** The big "×1.5" stamp when the voice says it. */
const Stamp: React.FC<{ from: number; text: string; sub: string }> = ({ from, text, sub }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const a = f - from; if (a < 0) return null;
  const s = spring({ frame: a, fps, config: { damping: 10, stiffness: 160 } });
  return (
    <div style={{ position: "absolute", left: 120, top: 330, transform: `scale(${s}) rotate(-6deg)`, textAlign: "center",
      padding: "26px 40px", background: "#0a1f14", border: `8px solid ${GOLD}`, boxShadow: `8px 8px 0 #000, 0 0 60px ${GOLD}88` }}>
      <div style={{ fontFamily: PX, fontSize: 120, color: GOLD, textShadow: "8px 8px 0 #5c3d00" }}>{text}</div>
      <div style={{ fontFamily: PX, fontSize: 26, color: "#fff", marginTop: 12 }}>{sub}</div>
    </div>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: `rgba(3,10,6,${0.9 * s})`, backdropFilter: `blur(${10 * s}px)`, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40 }}>
      <Img src={staticFile("howto/brand.png")} style={{ width: 900, transform: `scale(${s})`, filter: "drop-shadow(8px 8px 0 #000)" }} />
      <div style={{ fontFamily: PX, fontSize: 64, color: GREEN, textShadow: "6px 6px 0 #003d1f", opacity: s }}>pillwars.fun</div>
    </AbsoluteFill>
  );
};

/** Current step, top left. */
const Step: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16 } });
  return (
    <div style={{ position: "absolute", left: 60, top: 50, transform: `translateX(${(1 - s) * -600}px)`, padding: "16px 24px",
      background: "#00ff88", color: "#03140a", fontFamily: PX, fontSize: 30, boxShadow: "6px 6px 0 #000" }}>{text}</div>
  );
};

// Subtitles: phrases cut at punctuation (or 7 words), the word being said in green.
const SAY_TO_SHOW: [RegExp, string][] = [[/\bPilly\b/g, "$PILLY"], [/pillwars dot fun/g, "pillwars.fun"], [/one point five/g, "×1.5"]];
const phrasesOf = (s: Voice) => {
  const toks = s.text.split(/\s+/);
  const out: { from: number; to: number; toks: { w: string; t: number }[] }[] = [];
  let cur: { w: string; t: number }[] = [];
  toks.forEach((w, i) => {
    const t = (s.words[i] ?? s.words[s.words.length - 1]).t;
    cur.push({ w, t });
    if (/[.,:?!]$/.test(w) || cur.length >= 7 || i === toks.length - 1) {
      const last = s.words[Math.min(i, s.words.length - 1)];
      out.push({ from: cur[0].t, to: last.t + last.d, toks: cur }); cur = [];
    }
  });
  return out;
};
const Subs: React.FC<{ id: string }> = ({ id }) => {
  const f = useCurrentFrame(), t = f / FPS - LEAD;
  const ps = phrasesOf(vo(id));
  const p = ps.find((x, i) => t >= x.from - 0.05 && t < (ps[i + 1] ? ps[i + 1].from - 0.05 : x.to + 0.6));
  if (!p) return null;
  let line = p.toks.map((k) => k.w).join(" ");
  for (const [re, s] of SAY_TO_SHOW) line = line.replace(re, s);
  // Word by word colouring only when the replacements left the words aligned.
  const shown = line.split(" "), aligned = shown.length === p.toks.length;
  const nowIdx = p.toks.reduce((a, k, i) => (t >= k.t - 0.02 ? i : a), 0);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 1500, padding: "14px 30px 18px", background: "rgba(0,0,0,.82)", boxShadow: "6px 6px 0 #000",
        fontFamily: VT, fontSize: 68, lineHeight: 1.05, color: "#fff", textAlign: "center" }}>
        {aligned ? shown.map((w, i) => <span key={i} style={{ color: i === nowIdx ? GREEN : "#fff" }}>{w}{i < shown.length - 1 ? " " : ""}</span>) : line}
      </div>
    </div>
  );
};

/** Camera: eases between focus points (a rect to centre on, and a zoom). */
const camera = (focus: Focus[] | undefined, t: number) => {
  if (!focus) return { s: 1, x: 0, y: 0 };
  const val = (fc: Focus) => {
    if (!fc.r || fc.z === 1) return { s: fc.z, cx: 960, cy: 540 };
    return { s: fc.z, cx: fc.r[0] + fc.r[2] / 2, cy: fc.r[1] + fc.r[3] / 2 };
  };
  // Each focus point is reached over 1.1 s starting at its own time.
  let i = 0;
  for (let j = 0; j < focus.length; j++) if (t >= focus[j].t) i = j;
  const a = focus[Math.max(0, i - 1)], b = focus[i];
  const k = a === b ? 1 : Math.min(1, Math.max(0, (t - b.t) / 1.1));
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const va = val(a), vb = val(b);
  const s = va.s + (vb.s - va.s) * e, cx = va.cx + (vb.cx - va.cx) * e, cy = va.cy + (vb.cy - va.cy) * e;
  // Keep the zoomed frame inside the picture.
  const x = Math.min((s - 1) * 960, Math.max(-(s - 1) * 960, (960 - cx) * s));
  const y = Math.min((s - 1) * 540, Math.max(-(s - 1) * 540, (540 - cy) * s));
  return { s, x, y };
};

const SceneView: React.FC<{ sc: Scene }> = ({ sc }) => {
  const f = useCurrentFrame();
  const cam = camera(sc.focus, f / FPS);
  const Extra = sc.extra;
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      <AbsoluteFill style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`, transformOrigin: "center" }}>
        <Video src={staticFile(`howto/${sc.clip}.mp4`)} trimBefore={sec(sc.clipFrom ?? 0)} muted style={{ width: "100%", height: "100%" }} />
        {(sc.marks ?? []).map((m, i) => <Box key={i} {...m} f={f} />)}
      </AbsoluteFill>
      {Extra && <Extra />}
      {sc.step && <Step text={sc.step} />}
      <Sequence from={sec(LEAD)} layout="none"><Audio src={staticFile(`howto/${sc.id}.mp3`)} /></Sequence>
      <Subs id={sc.id} />
    </AbsoluteFill>
  );
};

export const HowTo: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      {SCENES.map((sc) => {
        const d = lenOf(sc), el = <Sequence key={sc.id} from={from} durationInFrames={d}><SceneView sc={sc} /></Sequence>;
        from += d; return el;
      })}
      <Audio src={staticFile("snd/airdrop-music.wav")} loop
        volume={(v) => interpolate(v, [0, 15, HOWTO_FRAMES - 45, HOWTO_FRAMES], [0, 0.1, 0.1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};
