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
// The video starts in the song's short pause (15.40 s): the drop (21.84 s) is then at 6.44 s,
// where the gameplay starts; from there every cut sits on a beat (at).
const BEAT = 60 / 105, BAR = BEAT * 4, SONG_FROM = 15.40, DROP = 21.84 - SONG_FROM;
const at = (beats: number) => Math.round((DROP + (beats - 12) * BEAT) * 30);
const bt = (beats: number) => Math.round(beats * BEAT * 30);
const T_LOCK = 30, T_PHONE = 72, T_FLIP = 129;   // 1.0 s, 2.4 s, 4.3 s (picked by ear)
const INTRO_BEATS = 12;
const CLIPS = [1, 1, 1, 1, 1, 1, 1, 1, 2];   // bars per clip (public/mobile/kN.mp4)
const STARTS: number[] = []; { let b = INTRO_BEATS; for (const n of CLIPS) { STARTS.push(at(b)); b += n * 4; } }
const END_BEATS = INTRO_BEATS + CLIPS.reduce((a, n) => a + n * 4, 0);
const INTRO = at(INTRO_BEATS), PLAY_END = at(END_BEATS);
export const MOBILE_FRAMES = at(END_BEATS + 30);
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
    <Img src={staticFile("perks/seeker-word.png")} style={{ height: h }} />
    <div style={{ marginTop: h * 0.02, display: "flex", alignItems: "center", gap: h * 0.1, fontFamily: SANS, fontWeight: 600, fontSize: h * 0.15, color: "#fff", letterSpacing: h * 0.028 }}>
      <span>SOLANA</span><Mark h={h * 0.16} /><span>MOBILE</span>
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

// The dApp Store, rebuilt in HTML after their promo image (1200x675 layout, x1.6) so it
// stays sharp when we zoom in: the cube and the phone come in together, the title
// writes itself in, then we zoom into the phone and PillWars (with its Install) slides
// into the first row of "Ecosystem" (Orca's place in the original).
const DS = "'Segoe UI', 'Inter', Arial, sans-serif";
const Row: React.FC<{ y: number; icon: string; name: string; desc: string; style?: React.CSSProperties; line?: boolean; soon?: boolean }> = ({ y, icon, name, desc, style, line = true, soon }) => (
  <div style={{ position: "absolute", left: 800, top: y, width: 321, height: 64, ...style }}>
    <Img src={staticFile(icon)} style={{ position: "absolute", left: 0, top: 0, width: 47, height: 47, borderRadius: 10, maxWidth: "none" }} />
    <div style={{ position: "absolute", left: 57, top: 3, fontFamily: DS, fontSize: 15.5, color: "#f2f2f2" }}>{name}</div>
    <div style={{ position: "absolute", left: 57, top: 25, fontFamily: DS, fontSize: 12.5, color: "#bdbdc2" }}>{desc}</div>
    <div style={{ position: "absolute", right: 0, top: 10, width: 52, height: 27, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DS, fontSize: 12.5, fontWeight: 700,
      ...(soon ? { background: "#ccff00", color: "#000", letterSpacing: 1 } : { background: "#7d2ff0", color: "#fff" }) }}>{soon ? "SOON" : "Install"}</div>
    {line && <div style={{ position: "absolute", left: 0, right: 0, top: 64, height: 1, background: "#2a2a2c" }} />}
  </div>
);
const Store: React.FC = () => {
  const f = useCurrentFrame();
  const inK = interpolate(f, [0, 12], [0, 1], { ...clamp, easing: ease });
  const zoom = interpolate(f, [bt(4), bt(6)], [0, 1], { ...clamp, easing: ease });
  const row = interpolate(f, [bt(6.5), bt(6.5) + 9], [0, 1], { ...clamp, easing: ease });
  const T: React.CSSProperties = { position: "absolute", fontFamily: DS, color: "#fff" };
  const title: React.CSSProperties = { ...T, left: 36, fontSize: 124, fontWeight: 500, letterSpacing: -3, lineHeight: 1, whiteSpace: "nowrap" };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 675, transformOrigin: "0 0", transform: "scale(1.6)" }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: "965px 346px", transform: `translate(${-365 * zoom}px, ${-8 * zoom}px) scale(${1 + zoom * 0.9})` }}>
          <Img src={staticFile("perks/ds-cube.png")} style={{ position: "absolute", left: 48, top: 37, width: 86, height: 88, maxWidth: "none", mixBlendMode: "screen",
            opacity: inK * (1 - zoom), transform: `scale(${0.4 + inK * 0.6}) rotate(${(1 - inK) * -40}deg)` }} />
          <div style={{ ...title, top: 150, opacity: inK * (1 - zoom), transform: `translateY(${(1 - inK) * 40}px)` }}>Solana</div>
          <div style={{ ...title, top: 272, opacity: inK * (1 - zoom), transform: `translateY(${(1 - inK) * 40}px)` }}>dApp Store</div>
          {/* the phone */}
          <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 675, transform: `translateY(${(1 - inK) * 420}px)` }}>
            {[[252, 43], [324, 56], [425, 30]].map(([y, h]) => <div key={y} style={{ position: "absolute", left: 1147, top: y, width: 4, height: h, borderRadius: 2, background: "#7fd99a" }} />)}
            <div style={{ position: "absolute", left: 770, top: 36, width: 380, height: 700, borderRadius: 40, background: "#0d0d0e", border: "3px solid #2c2c2e" }} />
            <div style={{ position: "absolute", left: 779, top: 45, width: 362, height: 690, borderRadius: 33, background: "#000" }} />
            <div style={{ ...T, left: 801, top: 66, fontSize: 12.5, fontWeight: 500 }}>2:33</div>
            <div style={{ position: "absolute", left: 953, top: 68, width: 14, height: 14, borderRadius: 7, background: "#111", boxShadow: "0 0 0 2px #070707" }} />
            <svg style={{ position: "absolute", left: 1090, top: 68, width: 30, height: 14 }} viewBox="0 0 30 14">
              <path d="M1 5 A10 10 0 0 1 17 5 L9 13 Z" fill="#fff" /><rect x="22" y="1" width="6" height="12" rx="1.5" fill="#fff" />
            </svg>
            <div style={{ position: "absolute", left: 800, top: 107, width: 270, height: 41, borderRadius: 21, background: "#333336" }} />
            <svg style={{ position: "absolute", left: 813, top: 117, width: 20, height: 20 }} viewBox="0 0 20 20"><circle cx="8" cy="8" r="6" stroke="#fff" strokeWidth="2.2" fill="none" /><path d="M12.5 12.5 L18 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
            <div style={{ ...T, left: 850, top: 118, fontSize: 14, color: "#9a9aa0" }}>Search for dapps or games</div>
            <div style={{ position: "absolute", left: 1080, top: 107, width: 41, height: 41, borderRadius: 21, background: "#333336" }} />
            <svg style={{ position: "absolute", left: 1090, top: 117, width: 22, height: 20 }} viewBox="0 0 22 20"><circle cx="8" cy="6" r="4" stroke="#fff" strokeWidth="1.8" fill="none" /><path d="M1 18 C1 12 15 12 15 18" stroke="#fff" strokeWidth="1.8" fill="none" /><circle cx="17" cy="14" r="3" stroke="#fff" strokeWidth="1.6" fill="none" /></svg>
            <div style={{ ...T, left: 799, top: 196, fontSize: 29, fontWeight: 500, letterSpacing: -0.3 }}>Solana dApp Store</div>
            <div style={{ ...T, left: 800, top: 275, fontSize: 20, fontWeight: 600 }}>Ecosystem</div>
            <div style={{ ...T, left: 1066, top: 281, fontSize: 14, fontWeight: 500, color: "#cdb6ff" }}>See all</div>
            <Row y={321} icon="perks/pw-icon.png" name="PillWars" desc="Eat, grow and outplay rival pills" soon style={{ opacity: row, transform: `translateX(${(1 - row) * 40}px)` }} />
            <Row y={400} icon="perks/ds-jup.png" name="Jupiter" desc="Liquidity aggregator & swaps" />
            <Row y={481} icon="perks/ds-mar.png" name="Marinade" desc="Stake without locking your funds" />
            <div style={{ ...T, left: 800, top: 593, fontSize: 20, fontWeight: 600 }}>Top categories</div>
            {[[800, "Wallets"], [968, "NFTs"]].map(([x, t]) => (
              <div key={t as string} style={{ position: "absolute", left: x as number, top: 639, width: 154, height: 60, borderRadius: 9, border: "1px solid #333", }}>
                <div style={{ ...T, left: 44, top: 14, fontSize: 14 }}>{t}</div>
                <div style={{ position: "absolute", left: 16, top: 15, width: 16, height: 16, borderRadius: 3, border: "2px solid #b999ff" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
// The Solana mark in its colours.
const SolMark: React.FC<{ h: number }> = ({ h }) => (
  <svg viewBox="0 0 100 86" style={{ height: h, width: h * 1.16 }}>
    <defs><linearGradient id="solg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#9945ff" /><stop offset="1" stopColor="#14f195" /></linearGradient></defs>
    <polygon points="18,0 100,0 82,20 0,20" fill="url(#solg)" /><polygon points="0,33 82,33 100,53 18,53" fill="url(#solg)" /><polygon points="18,66 100,66 82,86 0,86" fill="url(#solg)" />
  </svg>
);

// Scene 7: one word per beat on black, the game's pixel font, between two matches.
const Card: React.FC = () => {
  const f = useCurrentFrame();
  const words = ["EAT.", "SPLIT.", "SURVIVE."];
  return (
    <AbsoluteFill style={{ background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34 }}>
      {words.map((w, i) => {
        const t = f - bt(i);
        if (t < 0) return <div key={w} style={{ height: 118 }} />;
        const k = interpolate(t, [0, 5], [1.35, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
        return <div key={w} style={{ fontFamily: PX, fontSize: 104, lineHeight: "118px", color: i === 2 ? "#ccff00" : "#fff", transform: `scale(${k})`, opacity: interpolate(t, [0, 3], [0, 1], clamp),
          textShadow: "8px 8px 0 #1d6b64" }}>{w}</div>;
      })}
    </AbsoluteFill>
  );
};
// The ending on the phone's screen (same look as the full-screen ending once it fills the frame).
const EndCard: React.FC = () => (
  <AbsoluteFill style={{ background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32 }}>
    <Img src={staticFile("howto/brand.png")} style={{ width: 645, filter: "drop-shadow(6px 6px 0 #1d6b64)" }} />
    <div style={{ fontFamily: PX, fontSize: 28, color: "#ccff00", textShadow: "2px 2px 0 #000" }}>PILLWARS.FUN</div>
  </AbsoluteFill>
);

export const Mobile: React.FC = () => {
  const f = useCurrentFrame();
  // beats 0-2: built on Solana, 2-7: Seeker × PillWars, 7-12: the phone alone turns and zooms into the game (drop).
  const ry = f < T_FLIP ? interpolate(f, [T_PHONE, T_FLIP], [200, 180], clamp) : interpolate(f, [T_FLIP, T_FLIP + 22], [180, 0], { ...clamp, easing: ease });
  const zoom = interpolate(f, [T_FLIP + 22, INTRO], [0, 1], { ...clamp, easing: ease });
  const out = interpolate(f, [PLAY_END, at(END_BEATS + 2)], [0, 1], { ...clamp, easing: ease });
  const scale = interpolate(zoom, [0, 1], [0.7, 1.231]) * interpolate(out, [0, 1], [1, 0.55]);
  const y = interpolate(zoom, [0, 1], [560, 540]) + out * 150;
  const endLock = interpolate(f, [at(END_BEATS + 1), at(END_BEATS + 1) + 8], [0, 1], clamp);
  const E = END_BEATS, R = E + 16;
  const rIn = interpolate(f, [at(R), at(R) + 12], [0, 1], { ...clamp, easing: ease });
  const rOut = interpolate(f, [at(R + 6), at(R + 7)], [0, 1], clamp);
  const rTurn = interpolate(f, [at(R + 6), at(R + 8)], [0, 1], { ...clamp, easing: ease });
  const rFlip = interpolate(f, [at(R + 8), at(R + 9)], [0, 1], { ...clamp, easing: ease });
  const rZoom = interpolate(f, [at(R + 9), at(R + 10.5)], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* 1. built on Solana */}
      <Sequence durationInFrames={T_LOCK}>
        <AbsoluteFill style={{ background: "#000", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 40, opacity: interpolate(f, [0, 6], [0, 1], clamp), transform: `scale(${interpolate(f, [0, T_LOCK], [0.94, 1.02])})` }}>
          <div style={{ fontFamily: SANS, fontSize: 64, fontWeight: 600, color: "#fff", letterSpacing: 6 }}>BUILT ON</div>
          <SolMark h={86} />
          <div style={{ fontFamily: SANS, fontSize: 96, fontWeight: 700, color: "#fff", letterSpacing: 2 }}>SOLANA</div>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* 2. Seeker × PillWars, zooming in */}
      <Sequence from={T_LOCK} durationInFrames={T_PHONE - T_LOCK}>
        <AbsoluteFill style={{ background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 70, opacity: interpolate(f, [T_LOCK, T_LOCK + 5], [0, 1], clamp),
            transform: `scale(${interpolate(f, [T_LOCK, T_PHONE], [0.88, 1.06], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 2) })})` }}>
          <SeekerLockup h={220} />
          <div style={{ fontFamily: SANS, fontSize: 90, fontWeight: 300, color: "#fff" }}>×</div>
          <Img src={staticFile("perks/pillwars-pfp.png")} style={{ width: 250, height: 250, borderRadius: 40 }} />
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* 3. the phone, no text: turns, zooms into the game, and at the end steps back */}
      <Sequence from={T_PHONE} durationInFrames={at(E + 4) - T_PHONE}>
        <AbsoluteFill>
          <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)", opacity: interpolate(f, [T_PHONE, T_PHONE + 10], [0, 1], clamp) }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 50, opacity: endLock, display: "flex", justifyContent: "center" }}><SeekerLockup h={200} /></div>
          <Seeker ry={ry} scale={scale} y={y} screen={<>
            <Sequence durationInFrames={INTRO - T_PHONE} layout="none"><Img src={staticFile("perks/screen-start.png")} style={{ width: "100%", height: "100%" }} /></Sequence>
            {CLIPS.map((_, i) => (
              <Sequence key={i} from={STARTS[i] - T_PHONE} durationInFrames={i === CLIPS.length - 1 ? undefined : STARTS[i + 1] - STARTS[i]} layout="none">
                {i === 6 ? <Card /> : <Video src={staticFile(`mobile/k${i + 1}.mp4`)} muted style={{ width: "100%", height: "100%" }} />}
              </Sequence>
            ))}
          </>} />
        </AbsoluteFill>
      </Sequence>

      {/* 4. the dApp Store, PillWars in it */}
      <Sequence from={at(E + 4)} durationInFrames={at(E + 16) - at(E + 4)}><Store /></Sequence>
      {/* 5. only on Seeker: the Seeker (back), text beside it; then it turns to landscape, flips over and
          its screen, showing our ending, zooms in until it is the whole frame */}
      <Sequence from={at(E + 16)}>
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 120%, #1f7f79 0%, #0b3a40 30%, #030607 62%, #000 100%)", fontFamily: SANS }}>
          <div style={{ position: "absolute", left: 150, top: 300, opacity: rIn * (1 - rOut), transform: `translateY(${(1 - rIn) * 30}px)` }}>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: 10, color: "#9fe8dc" }}>ONLY ON SEEKER</div>
            <div style={{ marginTop: 22, fontSize: 132, fontWeight: 600, letterSpacing: -4, color: "#fff", lineHeight: 1.02 }}>Exclusive<br />rewards</div>
            <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 22, fontSize: 38, fontWeight: 500, color: "#d8f3ee" }}>
              <span>for</span><Img src={staticFile("perks/seeker-word.png")} style={{ height: 78 }} /><span>holders</span>
            </div>
          </div>
          <AbsoluteFill style={{ transformOrigin: "960px 540px", transform: `translate(${585 * (1 - rTurn)}px, ${(1 - rIn) * 60}px) rotate(${-104 * (1 - rTurn)}deg)`, opacity: rIn }}>
            <Seeker ry={180 * (1 - rFlip)} scale={0.55 + rTurn * 0.15 + rZoom * 0.85} y={540} screen={<EndCard />} />
          </AbsoluteFill>
        </AbsoluteFill>
      </Sequence>

      {/* music: one take of the song from 14.98 s to the very end, fading out on the last screen */}
      <Audio src={staticFile("mobile/deflector.mp3")} trimBefore={Math.round(SONG_FROM * 30)} volume={(v) => interpolate(v, [0, 4, at(END_BEATS + 29), MOBILE_FRAMES], [0, 0.9, 0.9, 0], clamp)} />
      <Sequence from={T_FLIP} layout="none"><Audio src={staticFile("snd/sprint.mp3")} volume={0.3} /></Sequence>
    </AbsoluteFill>
  );
};
