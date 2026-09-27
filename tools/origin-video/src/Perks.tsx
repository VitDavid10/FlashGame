import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { PX } from "./ui";

/* Stills for the holder perks in the Genesis Drop (Saga/Seeker Genesis Token,
   Mad Lads): one image per tweet, each in that project's own look. */
const LIME = "#ccff00";

/* Mad Lads perk: all their red, our X account's logo, our lime only for the prize. */
const ML_RED = "#f62038";
const PFP = "perks/pillwars-pfp.png", MLP = "perks/madlads.png";
const Logo: React.FC<{ src: string; x: number; y: number; s: number; border?: string; rot?: number }> = ({ src, x, y, s, border = "#000", rot = 0 }) => (
  <div style={{ position: "absolute", left: x, top: y, width: s, height: s, border: `${Math.round(s / 30)}px solid ${border}`, boxShadow: `${Math.round(s / 18)}px ${Math.round(s / 18)}px 0 #000`, transform: `rotate(${rot}deg)`, overflow: "hidden" }}>
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />
  </div>
);
const T: React.FC<{ y: number; size: number; color: string; children: React.ReactNode; sh?: string; x?: number; w?: number; align?: "center" | "left" }> = ({ y, size, color, children, sh = "#000", x = 0, w = 1920, align = "center" }) => (
  <div style={{ position: "absolute", left: x, width: w, top: y, textAlign: align, fontFamily: PX, fontSize: size, color, lineHeight: 1.25, textShadow: `${Math.round(size / 12)}px ${Math.round(size / 12)}px 0 ${sh}` }}>{children}</div>
);

export const PerkMadLads: React.FC = () => (
  <AbsoluteFill style={{ background: ML_RED }}>
    <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.12) 2px, transparent 2px), linear-gradient(90deg, rgba(0,0,0,.12) 2px, transparent 2px)", backgroundSize: "60px 60px" }} />
    <Logo src={PFP} x={640} y={110} s={260} rot={-5} />
    <T y={190} size={70} color="#000" sh="transparent"><span style={{ marginLeft: 0 }}>🤝</span></T>
    <Logo src={MLP} x={1020} y={110} s={260} rot={5} />
    <T y={470} size={60} color="#000" sh="rgba(255,255,255,.25)">PERK FOR</T>
    <T y={560} size={130} color="#fff" sh="#000">MAD LADS</T>
    {/* "airdrop" spelled out: someone who never heard of PillWars must still get what the points are */}
    <div style={{ position: "absolute", left: 290, right: 290, top: 780, height: 130, background: "#000", boxShadow: "12px 12px 0 rgba(0,0,0,.35)" }} />
    <T y={815} size={58} color={LIME} sh="transparent">+10,000 AIRDROP POINTS</T>
    <T y={990} size={26} color="#000" sh="transparent">PILLWARS GENESIS DROP · PILLWARS.FUN</T>
  </AbsoluteFill>
);


/* Saga & Seeker perk: Solana Mobile's dark teal and purple-to-green, both phones
   lying on their side with PillWars on screen (landscape reads better). */
const SOL = "linear-gradient(90deg, #9945ff, #14f195)";
const Bar: React.FC<{ x: number; y: number; w: number; h: number; o?: number }> = ({ x, y, w, h, o = 1 }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: o, background: SOL, borderRadius: 16,
    clipPath: `polygon(${h}px 0, 100% 0, calc(100% - ${h}px) 100%, 0 100%)` }} />
);
const Phone2: React.FC<{ x: number; y: number; w: number; rot: number; screen: string; body: string; edge: string; buttons?: string; tag: string }> = ({ x, y, w, rot, screen, body, edge, buttons, tag }) => {
  const h = Math.round(w * 1080 / 2400), b = Math.round(w * 0.028);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w + b * 2, height: h + b * 2, transform: `rotate(${rot}deg)` }}>
      {buttons && <>
        <div style={{ position: "absolute", left: w * 0.55, top: -10, width: w * 0.09, height: 14, background: buttons, borderRadius: 6 }} />
        <div style={{ position: "absolute", left: w * 0.67, top: -10, width: w * 0.05, height: 14, background: buttons, borderRadius: 6 }} />
      </>}
      <div style={{ position: "absolute", inset: 0, background: body, borderRadius: b * 3.2, border: `3px solid ${edge}`,
        boxShadow: "0 40px 70px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.06) inset" }} />
      <div style={{ position: "absolute", left: b, top: b, width: w, height: h, borderRadius: b * 2.2, overflow: "hidden", background: "#000" }}>
        <Img src={staticFile(screen)} style={{ width: "100%", height: "100%" }} />
        <AbsoluteFill style={{ background: "linear-gradient(115deg, rgba(255,255,255,.14), rgba(255,255,255,0) 35%)" }} />
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: -66, transform: "translateX(-50%)", padding: "8px 18px", background: "#000", border: "3px solid #14f195",
        fontFamily: PX, fontSize: 22, color: "#fff", whiteSpace: "nowrap" }}>{tag}</div>
    </div>
  );
};
export const PerkSeeker: React.FC = () => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg, #030607 0%, #071413 45%, #1d6b64 100%)" }}>
    <Bar x={-120} y={640} w={620} h={70} o={0.55} />
    <Bar x={-160} y={740} w={620} h={70} o={0.4} />
    <Bar x={1600} y={30} w={420} h={50} o={0.5} />
    <Bar x={1640} y={100} w={420} h={50} o={0.35} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 40, textAlign: "center", fontFamily: PX, fontSize: 38, color: "#fff", textShadow: "4px 4px 0 #000" }}>PERK FOR</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 100, textAlign: "center" }}>
      <span style={{ fontFamily: PX, fontSize: 84, background: SOL, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
        filter: "drop-shadow(7px 7px 0 #000)" }}>SAGA & SEEKER</span>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 222, textAlign: "center", fontFamily: PX, fontSize: 38, color: "#fff", textShadow: "4px 4px 0 #000" }}>HOLDERS</div>
    <div style={{ position: "absolute", left: 400, right: 400, top: 295, height: 100, padding: 5, boxSizing: "border-box", background: SOL, boxShadow: "10px 10px 0 rgba(0,0,0,.5)" }}>
      <div style={{ width: "100%", height: "100%", background: "#050909", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: PX, fontSize: 46, color: LIME, whiteSpace: "nowrap" }}>+10,000 AIRDROP POINTS</div>
    </div>
    <Phone2 x={1010} y={500} w={740} rot={8} screen="perks/screen-arcade.png" body="#0a0a0b" edge="#26292c" buttons="#1fd18a" tag="SAGA" />
    <Phone2 x={150} y={480} w={780} rot={-9} screen="perks/screen-start.png" body="#2e3b3d" edge="#4b5a5c" tag="SEEKER" />
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, textAlign: "center", fontFamily: PX, fontSize: 22, color: "#d8fff4", textShadow: "3px 3px 0 #000" }}>
      HOLD A SAGA OR SEEKER GENESIS TOKEN · PILLWARS.FUN</div>
  </AbsoluteFill>
);
