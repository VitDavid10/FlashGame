import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { ArenaFloor, Food, GAME_ANGLE, PX, Pill, VT } from "./ui";

/* Stills for the holder perks in the Genesis Drop (Saga/Seeker Genesis Token,
   Mad Lads): one image per tweet. Text only for the other projects - no logos
   of theirs, it's a perk for their holders, not a partnership. */
const LIME = "#ccff00", RED = "#f62a2d", CYAN = "#00e5ff";
const shadow = (d: number, c = 4) => `${c}px 0 0 ${RED}, ${-c}px 0 0 ${CYAN}, ${d}px ${d}px 0 #000, ${d * 2}px ${d * 2}px 0 rgba(0,0,0,.45)`;

// A pixel phone with a pill on its screen (Saga / Seeker).
const Phone: React.FC = () => (
  <div style={{ position: "absolute", left: 150, top: 250, width: 300, height: 560, background: "#1b1f24", border: "12px solid #3a414a", borderRadius: 36,
    boxShadow: "16px 16px 0 #000", transform: "rotate(-8deg)" }}>
    <div style={{ position: "absolute", inset: 18, background: "#07120a", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 50%, rgba(204,255,0,.35), transparent 70%)" }} />
    </div>
    <div style={{ position: "absolute", left: 125, top: -6, width: 26, height: 26, borderRadius: 13, background: "#000" }} />
  </div>
);

const Perk: React.FC<{ who: string; line: string; phone?: boolean }> = ({ who, line, phone }) => (
  <AbsoluteFill style={{ background: "#050505" }}>
    <ArenaFloor />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 62% 48%, rgba(204,255,0,.33), rgba(0,255,136,.1) 45%, rgba(0,0,0,0) 75%)" }} />
    <Food seed={"perk-" + who} n={80} />
    {phone ? <><Phone /><Pill x={300} y={520} wL={16} scale={8} top="#F44336" bot="#3F51B5" ang={GAME_ANGLE} /></>
      : <>
        <Pill x={290} y={330} wL={20} scale={9} top="#FFC107" bot="#9C27B0" ang={GAME_ANGLE} />
        <Pill x={330} y={760} wL={16} scale={8} top="#c0c8d0" bot="#00ff44" ang={GAME_ANGLE} />
      </>}
    <Pill x={1790} y={170} wL={12} scale={7} top="#03A9F4" bot="#8BC34A" ang={GAME_ANGLE} />
    <Pill x={1780} y={930} wL={14} scale={7} top="#F44336" bot="#3F51B5" ang={GAME_ANGLE} />
    <div style={{ position: "absolute", left: 560, right: 60, top: 150, textAlign: "center" }}>
      <div style={{ fontFamily: PX, fontSize: 30, color: "#fff", letterSpacing: 2, textShadow: shadow(3, 0) }}>PILLWARS GENESIS DROP</div>
      <div style={{ fontFamily: PX, fontSize: 70, color: "#fff", marginTop: 70, lineHeight: 1.3, textShadow: shadow(7, 3) }}>{who}</div>
      <div style={{ fontFamily: PX, fontSize: 44, color: "#fff", marginTop: 26, textShadow: shadow(4, 0) }}>HOLDERS GET</div>
      <div style={{ fontFamily: PX, fontSize: 150, color: LIME, marginTop: 40, textShadow: shadow(14, 6) }}>+10,000</div>
      <div style={{ fontFamily: PX, fontSize: 56, color: LIME, marginTop: 20, textShadow: shadow(5, 0) }}>POINTS</div>
      <div style={{ fontFamily: VT, fontSize: 46, color: "#e8ffe0", marginTop: 50 }}>{line}</div>
    </div>
    <div style={{ position: "absolute", left: 60, right: 60, bottom: 50, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Img src={staticFile("howto/brand.png")} style={{ width: 330, filter: "drop-shadow(6px 6px 0 #000)" }} />
      <div style={{ fontFamily: PX, fontSize: 34, color: "#fff", textShadow: shadow(3, 0) }}>PILLWARS.FUN</div>
    </div>
  </AbsoluteFill>
);

export const PerkSeeker: React.FC = () => <Perk who={"SAGA & SEEKER"} line="Link a wallet holding a Saga or Seeker Genesis Token" phone />;
export const PerkMadLads: React.FC = () => <Perk who="MAD LADS" line="Link a wallet holding a Mad Lad" />;
