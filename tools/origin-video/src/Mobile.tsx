import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { PX } from "./ui";

/* "PillWars is coming to Seeker": the Seeker turns from its back to its screen,
   the start screen zooms in, then David's own matches recorded on his Saga
   (4 random skills per life, bigger bots hunting him), hard cuts, no flashes. */
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const SANS = "'Segoe UI', 'Inter', Arial, sans-serif";

// Cut to the music: "Deflector" (Ghostrifter), 105 BPM, played from 14.98 s so its drop
// (21.84 s in the song) lands on the first gameplay cut. Every cut falls on a bar.
const BEAT = 60 / 105, BAR = BEAT * 4, SONG_FROM = 14.98;
const at = (beats: number) => Math.round(beats * BEAT * 30);
const INTRO_BEATS = 12;
const CLIPS = [1, 1, 1, 1, 1, 1, 1, 1, 2];   // bars per clip (public/mobile/kN.mp4)
const STARTS: number[] = []; { let b = INTRO_BEATS; for (const n of CLIPS) { STARTS.push(at(b)); b += n * 4; } }
const END_BEATS = INTRO_BEATS + CLIPS.reduce((a, n) => a + n * 4, 0);
const INTRO = at(INTRO_BEATS), PLAY_END = at(END_BEATS);
export const MOBILE_FRAMES = at(END_BEATS + 8);
void BAR;

// Solana Mobile's mark (the three stacked bars), white as on the Seeker.
const Mark: React.FC<{ h: number }> = ({ h }) => (
  <svg viewBox="0 0 100 86" style={{ height: h, width: h * 1.16 }}>
    <polygon points="0,0 72,0 100,22 28,22" fill="#fff" />
    <polygon points="28,32 100,32 72,54 0,54" fill="#fff" />
    <polygon points="0,64 72,64 100,86 28,86" fill="#fff" />
  </svg>
);
// "Seeker" / "SOLANA ▤ MOBILE", like Solana Mobile's own lockup.
const SeekerLockup: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
    <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: size, color: "#fff", letterSpacing: -size * 0.02, lineHeight: 1 }}>Seeker</div>
    <div style={{ marginTop: size * 0.16, display: "flex", alignItems: "center", gap: size * 0.14, fontFamily: SANS, fontWeight: 600, fontSize: size * 0.2, color: "#fff", letterSpacing: size * 0.035 }}>
      <span>SOLANA</span><Mark h={size * 0.22} /><span>MOBILE</span>
    </div>
  </div>
);

// Seeker, landscape. Two faces: the real back (photo) and the screen.
const PW = 1560, PH = PW * 1080 / 2400;
const Seeker: React.FC<{ ry: number; scale: number; y: number; screen: React.ReactNode }> = ({ ry, scale, y, screen }) => {
  const bz = PW * 0.013, fr = PW * 0.006, R = PH * 0.09;
  const face: React.CSSProperties = { position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" };
  return (
    <div style={{ position: "absolute", left: 960 - PW / 2, top: y - PH / 2, width: PW, height: PH, perspective: 2600 }}>
      <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: `scale(${scale}) rotateY(${ry}deg)` }}>
        {/* screen side */}
        <div style={face}>
          <div style={{ position: "absolute", inset: -(bz + fr), borderRadius: R + bz + fr, background: "linear-gradient(180deg,#56616a,#20272c 30%,#1a1f23 70%,#39434a)", boxShadow: "0 50px 100px rgba(0,0,0,.8)" }} />
          <div style={{ position: "absolute", inset: -bz, borderRadius: R + bz, background: "#040404" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: R, overflow: "hidden", background: "#000" }}>
            {screen}
            <div style={{ position: "absolute", left: PW * 0.017, top: PH / 2 - PH * 0.022, width: PH * 0.044, height: PH * 0.044, borderRadius: "50%", background: "#030303" }} />
          </div>
        </div>
        {/* back: the photo, turned to landscape */}
        <div style={{ ...face, transform: "rotateY(180deg)" }}>
          <div style={{ position: "absolute", left: PW / 2 - (PH + 2 * (bz + fr)) / 2, top: PH / 2 - (PW + 2 * (bz + fr)) / 2, width: PH + 2 * (bz + fr), height: PW + 2 * (bz + fr),
            transform: "rotate(90deg)", borderRadius: R + bz + fr, overflow: "hidden", boxShadow: "0 50px 100px rgba(0,0,0,.8)" }}>
            <Img src={staticFile("perks/seeker-back.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const Mobile: React.FC = () => {
  const f = useCurrentFrame();
  // back, slowly turning -> flips to the screen -> zooms in until the game fills the frame
  const ry = f < at(4) ? interpolate(f, [0, at(4)], [215, 180]) : interpolate(f, [at(4), at(6)], [180, 0], { ...clamp, easing: ease });
  const zoom = interpolate(f, [at(INTRO_BEATS - 2), INTRO], [0, 1], { ...clamp, easing: ease });
  const out = interpolate(f, [PLAY_END, at(END_BEATS + 2)], [0, 1], { ...clamp, easing: ease });
  const scale = interpolate(zoom, [0, 1], [0.62, 1.231]) * interpolate(out, [0, 1], [1, 0.6]);
  const y = interpolate(zoom, [0, 1], [640, 540]) + out * 110;
  const introTxt = interpolate(f, [at(1), at(1) + 8], [0, 1], clamp) * (1 - zoom);
  const endTxt = interpolate(f, [at(END_BEATS + 1), at(END_BEATS + 1) + 8], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)" }}>
      {/* intro text */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, opacity: introTxt, display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <Img src={staticFile("howto/brand.png")} style={{ height: 70, filter: "drop-shadow(5px 5px 0 #000)" }} />
          <span style={{ fontFamily: PX, fontSize: 26, color: "#fff", letterSpacing: 3 }}>IS COMING TO</span>
        </div>
        <SeekerLockup size={120} />
      </div>

      <Seeker ry={ry} scale={scale} y={y} screen={<>
        <Sequence durationInFrames={INTRO} layout="none"><Img src={staticFile("perks/screen-start.png")} style={{ width: "100%", height: "100%" }} /></Sequence>
        {CLIPS.map((_, i) => (
          <Sequence key={i} from={STARTS[i]} durationInFrames={i === CLIPS.length - 1 ? undefined : STARTS[i + 1] - STARTS[i]} layout="none">
            <Video src={staticFile(`mobile/k${i + 1}.mp4`)} muted style={{ width: "100%", height: "100%" }} />
          </Sequence>
        ))}
      </>} />

      {/* outro */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 60, opacity: endTxt, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
        <div style={{ fontFamily: PX, fontSize: 60, color: "#fff", textShadow: "6px 6px 0 #000" }}>COMING SOON</div>
        <SeekerLockup size={92} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 50, opacity: endTxt, textAlign: "center", fontFamily: PX, fontSize: 30, color: "#ccff00", textShadow: "3px 3px 0 #000" }}>PILLWARS.FUN</div>

      <Audio src={staticFile("mobile/deflector.mp3")} trimBefore={Math.round(SONG_FROM * 30)} volume={(v) => interpolate(v, [0, 6, MOBILE_FRAMES - 24, MOBILE_FRAMES], [0, 0.9, 0.9, 0], clamp)} />
      <Sequence from={at(4)} layout="none"><Audio src={staticFile("snd/sprint.mp3")} volume={0.3} /></Sequence>
    </AbsoluteFill>
  );
};
