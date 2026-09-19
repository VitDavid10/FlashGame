import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { FPS, PX } from "./ui";

// The classic-mode kill pop-up (#killGainStack / .kill-gain in game/index.html),
// pixel-pack look: money in bill green, the streak in red under it, floating up
// with the game's killGainFloat keyframes over 2 s. It's HTML over the canvas in
// the game, so it isn't in the captured frames: it's drawn here, on the frames
// the capture logged as kills.
export type Kill = { at: number; money: string; streak: string };

const LIFE = 2 * FPS;
// killGainFloat: [progress, opacity, translateY, scale], eased per segment with
// the same cubic-bezier(0.2,0.7,0.3,1) the CSS animation uses.
const KF: [number, number, number, number][] = [
  [0, 0, 20, 0.7], [0.12, 1, 0, 1.1], [0.22, 1, -4, 1], [0.85, 1, -30, 1], [1, 0, -60, 0.95],
];
const ease = Easing.bezier(0.2, 0.7, 0.3, 1);
const at = (p: number, k: 1 | 2 | 3) => {
  for (let i = 0; i < KF.length - 1; i++) {
    const [a, b] = [KF[i], KF[i + 1]];
    if (p <= b[0]) return interpolate(p, [a[0], b[0]], [a[k], b[k]], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }
  return KF[KF.length - 1][k];
};

// Pixel pack sizes (20px on a 1920 canvas) look small in a video watched on a
// phone, so everything is scaled up by the same factor.
const K = 1.6;

export const KillGainStack: React.FC<{ kills: Kill[] }> = ({ kills }) => {
  const f = useCurrentFrame();
  const live = kills.filter((k) => f >= k.at && f < k.at + LIFE);
  return (
    <div style={{
      position: "absolute", top: "40%", left: "50%", transform: "translateX(-50%)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4 * K,
    }}>
      {live.map((k) => {
        const p = (f - k.at) / LIFE;
        return (
          <div key={k.at} style={{
            fontFamily: PX, fontSize: 20 * K, letterSpacing: 2 * K, color: "#3ddc84", lineHeight: 1.15,
            display: "flex", flexDirection: "column", alignItems: "center", whiteSpace: "nowrap",
            textShadow: `${4 * K}px ${4 * K}px 0 #000, ${8 * K}px ${8 * K}px 0 rgba(0,0,0,0.5)`,
            opacity: at(p, 1), transform: `translateY(${at(p, 2) * K}px) scale(${at(p, 3)})`,
          }}>
            <span>{k.money}</span>
            <span style={{ fontSize: "0.7em", color: "#ff2a2a", marginTop: 10 * K, textShadow: `${3 * K}px ${3 * K}px 0 #000` }}>{k.streak}</span>
          </div>
        );
      })}
    </div>
  );
};
