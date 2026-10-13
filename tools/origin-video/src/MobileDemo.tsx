import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Video } from "@remotion/media";
import { PX } from "./ui";
import { Seeker, SolMark } from "./Mobile";

// Mobile demo: an exclusive-gameplay card, then the app inside a Seeker (the
// same phone as the Solana Mobile trailer): the mobile menu and its panels as
// stills, then one CLASSIC match recorded frame by frame
// (capture/mobile-demo-capture.js -> public/mobile-demo/).
const FPS = 30;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SANS = "'Segoe UI', 'Inter', Arial, sans-serif";
const s = (x: number) => Math.round(x * FPS);

const INTRO = 4.5, MATCH_SECS = 38;
// [file, seconds on screen, label]
const STILLS: [string, number, string][] = [
  ["title.jpg", 2, "PILLWARS ON MOBILE"],
  ["menu.jpg", 3, "THE MOBILE MENU"],
  ["panel-arenas.jpg", 4, "ARENAS · 1v1 · 2v2 · 3v3"],
  ["panel-the-pill.jpg", 3, "THE PILL · COLOURS AND SKILLS"],
  ["panel-store.jpg", 2.5, "STORE · SKINS"],
  ["panel-quests.jpg", 2.5, "QUESTS"],
  ["panel-pillwars-core.jpg", 2.5, "PILLWARS CORE · GUIDES AND VIDEOS"],
];
const MENU_SECS = STILLS.reduce((a, x) => a + x[1], 0);
const OUTRO = 4;
export const MOBILE_DEMO_FRAMES = s(INTRO + MENU_SECS + MATCH_SECS + OUTRO);

const BG = "radial-gradient(ellipse at 50% 115%, #1f7f79 0%, #0b3a40 32%, #050809 62%, #000 100%)";

const Label: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 8], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 44, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${(1 - a) * -12}px)` }}>
      <div style={{ fontFamily: PX, fontSize: 34, color: "#050505", background: "#b6f23c", padding: "14px 26px", boxShadow: "6px 6px 0 #000" }}>{text}</div>
    </div>
  );
};

export const MobileDemo: React.FC = () => {
  const f = useCurrentFrame();
  const T0 = s(INTRO), T1 = T0 + s(MENU_SECS), T2 = T1 + s(MATCH_SECS);
  const phoneIn = interpolate(f, [T0 - 12, T0 + 14], [0, 1], clamp);
  const phoneOut = interpolate(f, [T2 - 8, T2 + 14], [1, 0], clamp);
  let at = 0;
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: SANS }}>
      <AbsoluteFill style={{ background: BG }} />

      {/* exclusive gameplay card */}
      <Sequence from={0} durationInFrames={T0 + 6}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36,
          opacity: interpolate(f, [0, 8, T0 - 10, T0 + 4], [0, 1, 1, 0], clamp) }}>
          <div style={{ fontFamily: PX, fontSize: 92, color: "#fff", textShadow: "8px 8px 0 #000", letterSpacing: 2 }}>EXCLUSIVE</div>
          <div style={{ fontFamily: PX, fontSize: 92, color: "#b6f23c", textShadow: "8px 8px 0 #000", letterSpacing: 2 }}>GAMEPLAY</div>
          <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 24, fontSize: 56, fontWeight: 600, color: "#d8f3ee", letterSpacing: 4 }}>
            <span>ALSO FOR</span><SolMark h={64} /><span>SOLANA MOBILE</span>
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* the Seeker, front, showing the app */}
      {f >= T0 - 12 && f < T2 + 14 && (
        <AbsoluteFill style={{ opacity: phoneIn * phoneOut, transform: `translateY(${(1 - phoneIn) * 40}px)` }}>
          <Seeker ry={0} scale={1.1} y={560} screen={
            <>
              {STILLS.map(([file, secs]) => {
                const from = T0 + s(at); at += secs;
                return (
                  <Sequence key={file} from={from - 0} durationInFrames={s(secs) + 4} layout="none">
                    <AbsoluteFill style={{ opacity: interpolate(f - from, [0, 6], [0, 1], clamp) }}>
                      <Img src={staticFile("mobile-demo/" + file)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </AbsoluteFill>
                  </Sequence>
                );
              })}
              <Sequence from={T1} durationInFrames={s(MATCH_SECS) + 2} layout="none">
                <Video src={staticFile("mobile-demo/classic.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </Sequence>
            </>
          } />
        </AbsoluteFill>
      )}

      {/* labels above the phone */}
      {(() => {
        let t = T0, out: React.ReactNode[] = [];
        for (const [file, secs, label] of STILLS) { out.push(<Sequence key={file} from={t} durationInFrames={s(secs)}><Label text={label} /></Sequence>); t += s(secs); }
        out.push(<Sequence key="m" from={T1} durationInFrames={s(MATCH_SECS)}><Label text="CLASSIC · PRACTICE VS BOTS" /></Sequence>);
        return out;
      })()}

      {/* outro */}
      <Sequence from={T2 + 6}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, opacity: interpolate(f, [T2 + 6, T2 + 20], [0, 1], clamp) }}>
          <div style={{ fontFamily: PX, fontSize: 76, color: "#fff", textShadow: "8px 8px 0 #000" }}>PILLWARS</div>
          <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 48, fontWeight: 600, color: "#d8f3ee" }}>
            <span>COMING TO</span><SolMark h={56} /><span>SOLANA MOBILE</span>
          </div>
          <div style={{ fontFamily: PX, fontSize: 36, color: "#b6f23c", marginTop: 20 }}>pillwars.fun · @pillwarsdotfun</div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
