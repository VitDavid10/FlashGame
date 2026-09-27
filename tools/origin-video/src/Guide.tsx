import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { ArenaFloor, FPS, Food, GAME_ANGLE, PX, Pill, VT } from "./ui";
import voice from "../public/guide/voice.json";
import marksJson from "../public/guide/marks.json";

/* "How to play" thread: one short post per mechanic. Clips of a real match
   staged through the game's own controls (capture/guide-capture.js), voice
   (scripts/guide-voice.py), and on top: the step, the key being pressed, the
   game's own sounds and subtitles. */

type Voice = { id: string; text: string; words: { t: number; d: number; w: string }[] };
const V = voice as Voice[];
const M = marksJson as Record<string, Record<string, number>>;
const vo = (id: string) => V.find((s) => s.id === id)!;
const LEAD = 0.25, TAIL = 0.8;
const sec = (s: number) => Math.round(s * FPS);
const voiceLen = (id: string) => { const ws = vo(id).words; return ws[ws.length - 1].t + ws[ws.length - 1].d; };
const GREEN = "#00ff88", GOLD = "#ffce3d";
// When the voice says a word (s, from the post's start).
const at = (id: string, w: string) => { const x = vo(id).words.find((k) => k.w.toLowerCase().startsWith(w.toLowerCase())); return LEAD + (x ? x.t : 0); };

type Key = { at: number; label: string; sub?: string };
type Sfx = { at: number; src: string; vol?: number };
type Post = { id: string; n: number; title: string; keys?: Key[]; sfx?: Sfx[]; tags?: { at: number; to?: number; text: string; color?: string }[]; outro?: boolean };
const mk = (clip: string, name: string) => M[clip]?.[name];
const firstKey = (clip: string, prefix: string) => { const k = Object.keys(M[clip] || {}).find((x) => x.startsWith(prefix)); return k ? { at: M[clip][k], n: k.slice(prefix.length) } : null; };
const sprintK = firstKey("skills", "sprintKey"), blinkK = firstKey("skills", "blinkKey"), escapeK = firstKey("survive", "sprintKey");

export const POSTS: Post[] = [
  { id: "move", n: 1, title: "MOVE & GROW",
    keys: [{ at: at("move", "mouse"), label: "MOUSE", sub: "your pill follows it" }, { at: at("move", "W"), label: "W A S D", sub: "or the keyboard" }],
    sfx: mk("move", "kill") ? [{ at: mk("move", "kill"), src: "snd/kill1.mp3" }] : [] },
  { id: "hide", n: 2, title: "HIDE IN A VIRUS",
    tags: [{ at: mk("hide", "inside") ?? 2, to: mk("hide", "burst") ?? 5, text: "SAFE INSIDE" }, { at: mk("hide", "burst") ?? 5, text: "BURST!", color: GOLD }],
    sfx: [{ at: mk("hide", "burst") ?? 5, src: "snd/virus.mp3" }] },
  { id: "split", n: 3, title: "SPLIT TO HUNT",
    keys: [{ at: mk("split", "space") ?? 1.3, label: "SPACE", sub: "split" }],
    sfx: [{ at: mk("split", "space") ?? 1.3, src: "snd/split.mp3" }, ...(mk("split", "kill") ? [{ at: mk("split", "kill"), src: "snd/kill1.mp3" }] : [])] },
  { id: "skills", n: 4, title: "YOUR FIRST SKILLS",
    keys: [
      ...(sprintK ? [{ at: sprintK.at, label: sprintK.n, sub: "SPRINT" }] : []),
      ...(blinkK ? [{ at: blinkK.at, label: blinkK.n, sub: "BLINK" }] : []),
    ],
    sfx: [...(sprintK ? [{ at: sprintK.at, src: "snd/sprint.mp3" }] : []), ...(mk("skills", "kill") ? [{ at: mk("skills", "kill"), src: "snd/kill1.mp3" }] : []),
      ...(blinkK ? [{ at: blinkK.at, src: "snd/shield.mp3" }] : [])] },
  { id: "survive", n: 5, title: "SURVIVE & EARN",
    keys: escapeK ? [{ at: escapeK.at, label: escapeK.n, sub: "SPRINT" }] : [],
    sfx: escapeK ? [{ at: escapeK.at, src: "snd/sprint.mp3" }] : [], outro: true },
];
const clipLen = (id: string) => Math.max(...Object.values(M[id] || { x: 0 })) + 1.6;
export const postFrames = (p: Post) => sec(Math.max(LEAD + voiceLen(p.id) + TAIL + (p.outro ? 1.8 : 0), clipLen(p.id)));

/** The key on screen as it is pressed. */
const KeyCap: React.FC<Key> = ({ at, label, sub }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const a = f - sec(at); if (a < 0 || a > sec(1.8)) return null;
  const s = spring({ frame: a, fps, config: { damping: 12, stiffness: 200 } });
  const out = interpolate(a, [sec(1.4), sec(1.8)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const press = a < 5 ? 6 : 0;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 230, display: "flex", flexDirection: "column", alignItems: "center", opacity: out, transform: `scale(${s})` }}>
      <div style={{ padding: "22px 40px", minWidth: 120, textAlign: "center", fontFamily: PX, fontSize: 44, color: "#03140a", background: GREEN,
        border: "6px solid #000", boxShadow: `0 ${10 - press}px 0 #0a6b3c, 0 ${14 - press}px 0 #000`, transform: `translateY(${press}px)` }}>{label}</div>
      {sub && <div style={{ marginTop: 22, fontFamily: PX, fontSize: 24, color: "#fff", textShadow: "4px 4px 0 #000" }}>{sub}</div>}
    </div>
  );
};

const Tag: React.FC<{ at: number; to?: number; text: string; color?: string }> = ({ at, to, text, color = GREEN }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const a = f - sec(at); if (a < 0 || (to !== undefined && f > sec(to))) return null;
  const s = spring({ frame: a, fps, config: { damping: 11, stiffness: 180 } });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 250, textAlign: "center", transform: `scale(${s})` }}>
      <span style={{ padding: "14px 26px", background: color, color: "#03140a", fontFamily: PX, fontSize: 40, boxShadow: "8px 8px 0 #000" }}>{text}</span>
    </div>
  );
};

/** Step badge: "HOW TO PLAY 2/5" and the mechanic. */
const Step: React.FC<{ n: number; title: string }> = ({ n, title }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16 } });
  return (
    <div style={{ position: "absolute", left: 60, top: 50, transform: `translateX(${(1 - s) * -700}px)`, display: "flex", boxShadow: "6px 6px 0 #000" }}>
      <div style={{ padding: "16px 22px", background: "#000", color: GOLD, fontFamily: PX, fontSize: 26 }}>HOW TO PLAY {n}/5</div>
      <div style={{ padding: "16px 24px", background: GREEN, color: "#03140a", fontFamily: PX, fontSize: 26 }}>{title}</div>
    </div>
  );
};

const SAY_TO_SHOW: [RegExp, string][] = [[/pillwars dot fun/g, "pillwars.fun"]];
const Subs: React.FC<{ id: string }> = ({ id }) => {
  const f = useCurrentFrame(), t = f / FPS - LEAD, s = vo(id);
  const toks = s.text.split(/\s+/);
  const ph: { from: number; to: number; toks: { w: string; t: number }[] }[] = [];
  let cur: { w: string; t: number }[] = [];
  toks.forEach((w, i) => {
    const wd = s.words[Math.min(i, s.words.length - 1)];
    cur.push({ w, t: wd.t });
    if (/[.,:?!]$/.test(w) || cur.length >= 7 || i === toks.length - 1) { ph.push({ from: cur[0].t, to: wd.t + wd.d, toks: cur }); cur = []; }
  });
  const p = ph.find((x, i) => t >= x.from - 0.05 && t < (ph[i + 1] ? ph[i + 1].from - 0.05 : x.to + 0.6));
  if (!p) return null;
  let line = p.toks.map((k) => k.w).join(" ");
  for (const [re, r] of SAY_TO_SHOW) line = line.replace(re, r);
  const shown = line.split(" "), aligned = shown.length === p.toks.length;
  const now = p.toks.reduce((a, k, i) => (t >= k.t - 0.02 ? i : a), 0);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 170, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 1500, padding: "14px 30px 18px", background: "rgba(0,0,0,.82)", boxShadow: "6px 6px 0 #000", fontFamily: VT, fontSize: 68, lineHeight: 1.05, color: "#fff", textAlign: "center" }}>
        {aligned ? shown.map((w, i) => <span key={i} style={{ color: i === now ? GREEN : "#fff" }}>{w}{i < shown.length - 1 ? " " : ""}</span>) : line}
      </div>
    </div>
  );
};

const Outro: React.FC<{ from: number }> = ({ from }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const a = f - from; if (a < 0) return null;
  const s = spring({ frame: a, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: `rgba(3,10,6,${0.88 * s})`, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 36 }}>
      <Img src={staticFile("howto/brand.png")} style={{ width: 820, transform: `scale(${s})`, filter: "drop-shadow(8px 8px 0 #000)" }} />
      <div style={{ fontFamily: PX, fontSize: 60, color: GREEN, textShadow: "6px 6px 0 #003d1f", opacity: s }}>pillwars.fun</div>
    </AbsoluteFill>
  );
};

const PostView: React.FC<{ p: Post; music?: boolean }> = ({ p, music = true }) => {
  const total = postFrames(p);
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      {/* The whole game, not zoomed: nothing of it cut off. */}
      <Video src={staticFile(`guide/${p.id}.mp4`)} muted style={{ position: "absolute", inset: 0, width: 1920, height: 1080 }} />
      {(p.tags ?? []).map((t, i) => <Tag key={i} {...t} />)}
      {(p.keys ?? []).map((k, i) => <KeyCap key={i} {...k} />)}
      <Step n={p.n} title={p.title} />
      {p.outro && <Outro from={total - sec(2.2)} />}
      <Sequence from={sec(LEAD)} layout="none"><Audio src={staticFile(`guide/${p.id}.mp3`)} /></Sequence>
      {(p.sfx ?? []).map((s, i) => <Sequence key={i} from={sec(s.at)} layout="none"><Audio src={staticFile(s.src)} volume={s.vol ?? 0.5} /></Sequence>)}
      {music && <Audio src={staticFile("snd/action-music.wav")} loop
        volume={(v) => interpolate(v, [0, 10, total - 20, total], [0, 0.18, 0.18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />}
      <Subs id={p.id} />
    </AbsoluteFill>
  );
};

export const GuidePost: React.FC<{ id: string }> = ({ id }) => <PostView p={POSTS.find((x) => x.id === id)!} />;

/* Intro of the merged video: the airdrop trailer's loud colours. */
const LIME = "#ccff00", RED = "#f62a2d", CYAN = "#00e5ff";
export const INTRO_FRAMES = sec(3.6);
const Slam: React.FC<{ at: number; text: string; y: number; size: number; color: string }> = ({ at: a0, text, y, size, color }) => {
  const f = useCurrentFrame(), t = f - a0;
  if (t < 0) return null;
  const s2 = t < 2 ? 1.9 : t < 4 ? 0.88 : t < 6 ? 1.06 : 1, c = Math.max(0, 14 - t * 2), d = Math.round(size / 9);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center", fontFamily: PX, fontSize: size, color, whiteSpace: "nowrap", transform: `scale(${s2})`,
      textShadow: `${c}px 0 0 ${RED}, ${-c}px 0 0 ${CYAN}, ${d}px ${d}px 0 #000, ${d * 2}px ${d * 2}px 0 rgba(0,0,0,.45)` }}>{text}</div>
  );
};
const Intro: React.FC = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const flash = interpolate(f, [0, 6], [0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const logo = spring({ frame: f - 22, fps, config: { damping: 12 } });
  const drift = f * 1.6;
  return (
    <AbsoluteFill>
      <ArenaFloor />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, rgba(204,255,0,.35), rgba(0,255,136,.12) 45%, rgba(0,0,0,0) 75%)` }} />
      <Food seed="guide-intro" n={90} />
      <Pill x={260 + drift} y={250} wL={20} scale={9} top="#F44336" bot="#3F51B5" ang={GAME_ANGLE} />
      <Pill x={1680 - drift} y={820} wL={24} scale={9} top="#FFC107" bot="#9C27B0" ang={GAME_ANGLE} />
      <Pill x={1560 - drift * 0.6} y={210} wL={14} scale={8} top="#03A9F4" bot="#8BC34A" ang={GAME_ANGLE} />
      <Pill x={330 + drift * 0.6} y={860} wL={16} scale={8} top="#c0c8d0" bot="#00ff44" ang={GAME_ANGLE} />
      <Slam at={4} text="HOW TO PLAY" y={300} size={120} color={LIME} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 500, display: "flex", justifyContent: "center", transform: `scale(${logo})` }}>
        <Img src={staticFile("howto/brand.png")} style={{ width: 900, filter: "drop-shadow(10px 10px 0 #000)" }} />
      </div>
      <Slam at={42} text="IN 5 STEPS" y={720} size={46} color="#fff" />
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
      <Sequence from={sec(0.35)} layout="none"><Audio src={staticFile("guide/intro.mp3")} /></Sequence>
      <Sequence from={0} layout="none"><Audio src={staticFile("snd/split.mp3")} volume={0.5} /></Sequence>
    </AbsoluteFill>
  );
};
export const GUIDE_ALL_FRAMES = INTRO_FRAMES + POSTS.reduce((a, p) => a + postFrames(p), 0);
export const GuideAll: React.FC = () => {
  let from = INTRO_FRAMES;
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      <Sequence durationInFrames={INTRO_FRAMES}><Intro /></Sequence>
      {POSTS.map((p) => { const d = postFrames(p), el = <Sequence key={p.id} from={from} durationInFrames={d}><PostView p={p} music={false} /></Sequence>; from += d; return el; })}
      {/* The game's own match music (snd/music.mp3, 3 min): one continuous take for the whole video. */}
      <Audio src={staticFile("guide/music.mp3")}
        volume={(v) => interpolate(v, [0, 10, GUIDE_ALL_FRAMES - 25, GUIDE_ALL_FRAMES], [0, 0.18, 0.18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};
