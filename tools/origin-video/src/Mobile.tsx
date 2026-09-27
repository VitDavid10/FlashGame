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
export const MOBILE_FRAMES = at(END_BEATS + 20);
void BAR;

// Solana Mobile's mark (the three stacked bars), white as on the Seeker.
const Mark: React.FC<{ h: number }> = ({ h }) => (
  <svg viewBox="0 0 100 86" style={{ height: h, width: h * 1.16 }}>
    <polygon points="0,0 72,0 100,22 28,22" fill="#fff" />
    <polygon points="28,32 100,32 72,54 0,54" fill="#fff" />
    <polygon points="0,64 72,64 100,86 28,86" fill="#fff" />
  </svg>
);
// "Seeker" (their wordmark, public/perks/seeker-word.png) over "SOLANA ▤ MOBILE".
const SeekerLockup: React.FC<{ h: number }> = ({ h }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
    <Img src={staticFile("perks/seeker-word.png")} style={{ height: h, mixBlendMode: "screen" }} />
    <div style={{ marginTop: h * 0.02, display: "flex", alignItems: "center", gap: h * 0.1, fontFamily: SANS, fontWeight: 600, fontSize: h * 0.15, color: "#fff", letterSpacing: h * 0.028 }}>
      <span>SOLANA</span><Mark h={h * 0.16} /><span>MOBILE</span>
    </div>
  </div>
);
// A small push on every beat.
const bump = (f: number) => { const k = (f % (BEAT * 30)) / (BEAT * 30); return 1 + 0.018 * Math.exp(-k * 6); };

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

// The dApp Store (their promo image) with PillWars in the first row instead of Orca.
const Store: React.FC = () => {
  const f = useCurrentFrame(), row = interpolate(f, [at(2), at(2) + 8], [0, 1], { ...clamp, easing: ease });
  const T: React.CSSProperties = { position: "absolute", fontFamily: SANS, color: "#fff" };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 675, transformOrigin: "0 0", transform: `scale(${1.6 * interpolate(f, [0, at(8)], [1, 1.03])})` }}>
        <Img src={staticFile("perks/dappstore.png")} style={{ width: 1200, height: 675 }} />
        <div style={{ position: "absolute", left: 795, top: 274, width: 110, height: 32, background: "#000" }} />
        <div style={{ ...T, left: 800, top: 276, fontSize: 21, fontWeight: 600 }}>Ecosystem</div>
        <div style={{ position: "absolute", left: 796, top: 316, width: 268, height: 62, background: "#000" }} />
        <div style={{ position: "absolute", left: 796, top: 316, width: 268, height: 62, opacity: row, transform: `translateX(${(1 - row) * 30}px)` }}>
          <Img src={staticFile("perks/pw-icon.png")} style={{ position: "absolute", left: 4, top: 5, width: 46, height: 46, borderRadius: 10 }} />
          <div style={{ ...T, left: 60, top: 10, fontSize: 15, fontWeight: 500 }}>PillWars</div>
          <div style={{ ...T, left: 60, top: 32, fontSize: 12.5, color: "#c8c8cc" }}>Eat, grow and outplay rival pills</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Mobile: React.FC = () => {
  const f = useCurrentFrame();
  // 0-4 beats: their Seeker banner, 4-6: Seeker × PillWars, 6-12: the phone alone turns and zooms in.
  const ry = f < at(7) ? interpolate(f, [at(6), at(7)], [215, 180], clamp) : interpolate(f, [at(7), at(9)], [180, 0], { ...clamp, easing: ease });
  const zoom = interpolate(f, [at(INTRO_BEATS - 2), INTRO], [0, 1], { ...clamp, easing: ease });
  const out = interpolate(f, [PLAY_END, at(END_BEATS + 2)], [0, 1], { ...clamp, easing: ease });
  const scale = interpolate(zoom, [0, 1], [0.7, 1.231]) * interpolate(out, [0, 1], [1, 0.55]);
  const y = interpolate(zoom, [0, 1], [560, 540]) + out * 150;
  const endLock = interpolate(f, [at(END_BEATS + 1), at(END_BEATS + 1) + 8], [0, 1], clamp);
  const b = bump(f);
  const E = END_BEATS;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)" }}>
      {/* 1. their banner, moving on the beat */}
      <Sequence durationInFrames={at(4)}>
        <AbsoluteFill style={{ background: "#000", opacity: interpolate(f, [0, 6], [0, 1], clamp) }}>
          <Img src={staticFile("perks/seeker-banner.png")} style={{ position: "absolute", left: 0, top: 540 - 491, width: 1920, height: 982,
            transform: `scale(${interpolate(f, [0, at(4)], [1.1, 1.0]) * b}) translateX(${interpolate(f, [0, at(4)], [-20, 10])}px)` }} />
        </AbsoluteFill>
      </Sequence>
      {/* 2. Seeker × PillWars */}
      <Sequence from={at(4)} durationInFrames={at(2)}>
        <AbsoluteFill style={{ background: "#000", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 70 }}>
          <div style={{ transform: `scale(${b})` }}><SeekerLockup h={220} /></div>
          <div style={{ fontFamily: SANS, fontSize: 90, fontWeight: 300, color: "#fff" }}>×</div>
          <Img src={staticFile("perks/pillwars-pfp.png")} style={{ width: 250, height: 250, borderRadius: 40, transform: `scale(${b})` }} />
        </AbsoluteFill>
      </Sequence>

      {/* 3. the phone, no text: turns, zooms into the game, and at the end steps back */}
      <Sequence from={at(6)} durationInFrames={at(E + 4) - at(6)}>
        <AbsoluteFill>
          <div style={{ position: "absolute", left: 0, right: 0, top: 50, opacity: endLock, display: "flex", justifyContent: "center" }}><SeekerLockup h={200} /></div>
          <Seeker ry={ry} scale={scale} y={y} screen={<>
            <Sequence durationInFrames={INTRO - at(6)} layout="none"><Img src={staticFile("perks/screen-start.png")} style={{ width: "100%", height: "100%" }} /></Sequence>
            {CLIPS.map((_, i) => (
              <Sequence key={i} from={STARTS[i] - at(6)} durationInFrames={i === CLIPS.length - 1 ? undefined : STARTS[i + 1] - STARTS[i]} layout="none">
                <Video src={staticFile(`mobile/k${i + 1}.mp4`)} muted style={{ width: "100%", height: "100%" }} />
              </Sequence>
            ))}
          </>} />
        </AbsoluteFill>
      </Sequence>

      {/* 4. the dApp Store, PillWars in it */}
      <Sequence from={at(E + 4)} durationInFrames={at(8)}><Store /></Sequence>
      {/* 5. coming soon */}
      <Sequence from={at(E + 12)} durationInFrames={at(4)}>
        <AbsoluteFill style={{ background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40 }}>
          <div style={{ fontFamily: PX, fontSize: 96, color: "#fff", textShadow: "8px 8px 0 #1d6b64", transform: `scale(${b})` }}>COMING SOON</div>
          <div style={{ fontFamily: SANS, fontSize: 44, fontWeight: 600, color: "#fff" }}>on the Solana dApp Store</div>
        </AbsoluteFill>
      </Sequence>
      {/* 6. our usual ending */}
      <Sequence from={at(E + 16)}>
        <AbsoluteFill style={{ background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 50 }}>
          <Img src={staticFile("howto/brand.png")} style={{ width: 1000, filter: "drop-shadow(10px 10px 0 #1d6b64)", transform: `scale(${b})` }} />
          <div style={{ fontFamily: PX, fontSize: 44, color: "#ccff00", textShadow: "4px 4px 0 #000" }}>PILLWARS.FUN</div>
        </AbsoluteFill>
      </Sequence>

      <Audio src={staticFile("mobile/deflector.mp3")} trimBefore={Math.round(SONG_FROM * 30)} volume={(v) => interpolate(v, [0, 4, MOBILE_FRAMES - 20, MOBILE_FRAMES], [0, 0.9, 0.9, 0], clamp)} />
      <Sequence from={at(7)} layout="none"><Audio src={staticFile("snd/sprint.mp3")} volume={0.3} /></Sequence>
    </AbsoluteFill>
  );
};
