import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { ArenaFloor, PX } from "./ui";

/* "PillWars is coming to Solana Mobile": real matches recorded on a Saga
   (screenrecord over adb; each clip is its own match, staged by scratchpad
   saga-matches.js), shown in a phone held flat in landscape. No airdrop. */
const SOL_GRAD = "linear-gradient(90deg, #9945ff, #14f195)";
const sec = (s: number) => Math.round(s * 30);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SANS = "'Inter', 'Segoe UI', Arial, sans-serif";

// The clips (public/mobile/cN.mp4, already sped up), what each shows, and the game's sounds on its moments.
const CLIPS: { d: number; tag: string; sfx: [number, string, number][] }[] = [
  { d: 2.43, tag: "PICK YOUR SKILLS", sfx: [[1.9, "snd/money.mp3", 0.5]] },
  { d: 3.2, tag: "EAT TO GROW", sfx: [[0.25, "snd/kill1.mp3", 0.5]] },
  { d: 2.33, tag: "SPLIT", sfx: [[1.2, "snd/split.mp3", 0.7], [1.36, "snd/kill1.mp3", 0.8]] },
  { d: 2.9, tag: "MAGNET", sfx: [[0.6, "snd/kill1.mp3", 0.6], [1.18, "snd/shield.mp3", 0.5], [1.5, "snd/kill1.mp3", 0.7], [2.1, "snd/kill1.mp3", 0.7]] },
  { d: 2.57, tag: "SPRINT", sfx: [[1.15, "snd/sprint.mp3", 0.7], [1.25, "snd/kill1.mp3", 0.8], [2.05, "snd/kill1.mp3", 0.8]] },
  { d: 2.27, tag: "SPLIT", sfx: [[1.25, "snd/split.mp3", 0.7], [1.4, "snd/kill1.mp3", 0.8]] },
  { d: 3.03, tag: "HUNT", sfx: [[2.4, "snd/kill1.mp3", 0.8]] },
  { d: 3.37, tag: "BLINK AWAY", sfx: [[0.9, "snd/death.mp3", 0.5], [2.1, "snd/shield.mp3", 0.8]] },
];
const INTRO = sec(3.0), OUTRO = sec(3.6);
const STARTS: number[] = []; { let t = INTRO; for (const c of CLIPS) { STARTS.push(t); t += sec(c.d); } }
const PLAY_END = STARTS[STARTS.length - 1] + sec(CLIPS[CLIPS.length - 1].d);
export const MOBILE_FRAMES = PLAY_END + OUTRO;

// Solana's three bars.
const SolMark: React.FC<{ h: number }> = ({ h }) => (
  <svg viewBox="0 0 100 80" style={{ height: h, width: h * 1.25 }}>
    <defs><linearGradient id="sg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#9945ff" /><stop offset="1" stopColor="#14f195" /></linearGradient></defs>
    <polygon points="18,0 100,0 82,18 0,18" fill="url(#sg)" />
    <polygon points="0,31 82,31 100,49 18,49" fill="url(#sg)" />
    <polygon points="18,62 100,62 82,80 0,80" fill="url(#sg)" />
  </svg>
);
const SolanaMobile: React.FC<{ h: number }> = ({ h }) => (
  <div style={{ display: "flex", alignItems: "center", gap: h * 0.35 }}>
    <SolMark h={h} />
    <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: h * 0.62, color: "#fff", letterSpacing: h * 0.02, lineHeight: 1 }}>Solana <span style={{ fontWeight: 400 }}>Mobile</span></div>
  </div>
);

// A phone held flat in landscape: metal frame, thin black bezel, punch-hole camera, glass.
const Phone: React.FC<{ w: number; children: React.ReactNode }> = ({ w, children }) => {
  const h = w * 1080 / 2400, bz = w * 0.012, fr = w * 0.007, R = h * 0.075;
  return (
    <div style={{ position: "relative", width: w + (bz + fr) * 2, height: h + (bz + fr) * 2 }}>
      {/* side buttons on the top edge */}
      <div style={{ position: "absolute", left: w * 0.62, top: -fr * 0.9, width: w * 0.07, height: fr * 1.6, borderRadius: fr, background: "linear-gradient(180deg,#8a9096,#3a3f44)" }} />
      <div style={{ position: "absolute", left: w * 0.72, top: -fr * 0.9, width: w * 0.04, height: fr * 1.6, borderRadius: fr, background: "linear-gradient(180deg,#8a9096,#3a3f44)" }} />
      {/* frame */}
      <div style={{ position: "absolute", inset: 0, borderRadius: R + bz + fr, background: "linear-gradient(180deg,#6b7177 0%,#2a2e32 18%,#1a1c1f 55%,#3b4046 100%)",
        boxShadow: "0 50px 90px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.08) inset" }} />
      {/* bezel */}
      <div style={{ position: "absolute", inset: fr, borderRadius: R + bz, background: "#050505" }} />
      {/* screen */}
      <div style={{ position: "absolute", left: fr + bz, top: fr + bz, width: w, height: h, borderRadius: R, overflow: "hidden", background: "#000" }}>
        {children}
        <div style={{ position: "absolute", left: w * 0.018, top: h / 2 - h * 0.022, width: h * 0.044, height: h * 0.044, borderRadius: "50%", background: "#050505", boxShadow: "0 0 0 2px #111" }} />
        <AbsoluteFill style={{ background: "linear-gradient(120deg, rgba(255,255,255,.09) 0%, rgba(255,255,255,.02) 30%, rgba(255,255,255,0) 45%)" }} />
      </div>
    </div>
  );
};

const Tag: React.FC<{ text: string; d: number }> = ({ text, d }) => {
  const f = useCurrentFrame(), k = Math.min(1, f / 5, (sec(d) - f) / 5);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 30, display: "flex", justifyContent: "center", opacity: Math.max(0, k) }}>
      <div style={{ padding: "12px 28px", background: "rgba(0,0,0,.85)", border: "3px solid #14f195", fontFamily: PX, fontSize: 32, color: "#fff", transform: `translateY(${(1 - Math.max(0, k)) * 14}px)` }}>{text}</div>
    </div>
  );
};

export const Mobile: React.FC = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pop = spring({ frame: f - 3, fps, config: { damping: 13 } });
  // intro lockup -> phone rises and fills the frame
  const rise = interpolate(f, [INTRO - 22, INTRO], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
  const out = interpolate(f, [PLAY_END - 4, PLAY_END + 14], [0, 1], { ...clamp, easing: (x) => x * x * (3 - 2 * x) });
  const phoneW = interpolate(rise, [0, 1], [1050, 1600]) * interpolate(out, [0, 1], [1, 0.62]);
  const phoneY = interpolate(rise, [0, 1], [1010, 560]) + out * 70;
  const lockO = 1 - rise;
  // a quick flash on every cut between matches
  const flash = STARTS.slice(1).reduce((a, s) => Math.max(a, interpolate(f, [s - 1, s, s + 5], [0, 0.55, 0], clamp)), 0);
  const topO = interpolate(f, [INTRO - 6, INTRO + 6], [0, 1], clamp) * (1 - out);
  const endO = interpolate(f, [PLAY_END + 4, PLAY_END + 16], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: "#030504" }}>
      <ArenaFloor opacity={0.55} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 42%, rgba(20,241,149,.22), rgba(153,69,255,.10) 42%, rgba(0,0,0,0) 72%)" }} />

      {/* intro lockup */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 170 - rise * 120, opacity: lockO, display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${0.85 + pop * 0.15})` }}>
        <div style={{ fontFamily: PX, fontSize: 34, color: "#fff", letterSpacing: 4, textShadow: "4px 4px 0 #000", opacity: interpolate(f, [8, 16], [0, 1], clamp) }}>COMING TO</div>
        <div style={{ marginTop: 44, display: "flex", alignItems: "center", gap: 56 }}>
          <Img src={staticFile("howto/brand.png")} style={{ height: 118, filter: "drop-shadow(8px 8px 0 #000)" }} />
          <div style={{ fontFamily: PX, fontSize: 60, color: "#14f195", textShadow: "5px 5px 0 #000" }}>×</div>
          <SolanaMobile h={96} />
        </div>
        <div style={{ marginTop: 46, fontFamily: PX, fontSize: 30, letterSpacing: 6, opacity: interpolate(f, [22, 32], [0, 1], clamp) }}>
          <span style={{ background: SOL_GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>SAGA · SEEKER</span>
        </div>
      </div>

      {/* while playing: a slim line on top */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 26, display: "flex", justifyContent: "center", alignItems: "center", gap: 22, opacity: topO }}>
        <span style={{ fontFamily: PX, fontSize: 26, color: "#fff", textShadow: "3px 3px 0 #000" }}>COMING TO</span>
        <SolanaMobile h={44} />
      </div>

      {/* the phone */}
      <div style={{ position: "absolute", left: 0, right: 0, top: phoneY, display: "flex", justifyContent: "center", transform: "translateY(-50%)" }}>
        <Phone w={phoneW}>
          <Sequence durationInFrames={INTRO} layout="none"><Img src={staticFile("perks/screen-start.png")} style={{ width: "100%", height: "100%" }} /></Sequence>
          {CLIPS.map((c, i) => (
            <Sequence key={i} from={STARTS[i]} durationInFrames={i === CLIPS.length - 1 ? undefined : sec(c.d)} layout="none">
              <Video src={staticFile(`mobile/c${i + 1}.mp4`)} muted style={{ width: "100%", height: "100%" }} />
            </Sequence>
          ))}
          <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
        </Phone>
      </div>
      {CLIPS.map((c, i) => <Sequence key={"t" + i} from={STARTS[i]} durationInFrames={sec(c.d)} layout="none"><Tag text={c.tag} d={c.d} /></Sequence>)}

      {/* outro */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, opacity: endO, display: "flex", flexDirection: "column", alignItems: "center", transform: `translateY(${(1 - endO) * -20}px)` }}>
        <div style={{ fontFamily: PX, fontSize: 76, color: "#fff", textShadow: "7px 7px 0 #000" }}>COMING SOON</div>
        <div style={{ marginTop: 34 }}><SolanaMobile h={70} /></div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, opacity: interpolate(f, [PLAY_END + 12, PLAY_END + 24], [0, 1], clamp), display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <div style={{ fontFamily: PX, fontSize: 28, letterSpacing: 3 }}><span style={{ background: SOL_GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>SAGA · SEEKER · SOLANA dAPP STORE</span></div>
        <div style={{ fontFamily: PX, fontSize: 30, color: "#ccff00", textShadow: "3px 3px 0 #000" }}>PILLWARS.FUN</div>
      </div>

      {/* the game's own music and sounds */}
      <Audio src={staticFile("guide/music.mp3")} volume={(v) => interpolate(v, [0, 12, MOBILE_FRAMES - 30, MOBILE_FRAMES], [0, 0.4, 0.4, 0], clamp)} />
      <Sequence from={INTRO - 12} layout="none"><Audio src={staticFile("snd/split.mp3")} volume={0.45} /></Sequence>
      {CLIPS.flatMap((c, i) => c.sfx.map(([t, src, v], j) => (
        <Sequence key={`s${i}-${j}`} from={STARTS[i] + sec(t)} layout="none"><Audio src={staticFile(src)} volume={v} /></Sequence>
      )))}
    </AbsoluteFill>
  );
};
