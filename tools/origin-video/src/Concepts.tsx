import React from "react";
import { AbsoluteFill, Img, random, staticFile, useCurrentFrame } from "remotion";
import growthCapture from "../public/growth/events.json";
import { ArenaFloor, Food, GAME_ANGLE, H, PIXEL, PX, Pill, W } from "./ui";
import { PALETTE } from "./pill";

/*
 * Concept art for the posts, drawn with the game's OWN pixel pill and floor
 * (src/pill.ts, the port of the game's pixPillSpriteRot) instead of an image
 * generator, so a poster and a screenshot of the game share the same pixels.
 * Each one is a still: render with `npx remotion still <id> out/<name>.png`.
 */

const GOLD: [string, string] = ["#ffe97a", "#d4a017"];
const rnd = (seed: string) => random(seed);

/** Pixel coins, the same square-pixel look as the food pellets. */
const Gold: React.FC<{ x: number; y: number; n: number; spread: number; seed: string; size?: number }> =
  ({ x, y, n, spread, seed, size = 10 }) => (
    <>
      {Array.from({ length: n }, (_, i) => {
        const a = rnd(`${seed}a${i}`) * 6.28, r = Math.sqrt(rnd(`${seed}r${i}`)) * spread;
        const s = size * (0.6 + rnd(`${seed}s${i}`) * 0.8);
        return (
          <div key={i} style={{
            position: "absolute", left: x + Math.cos(a) * r, top: y + Math.sin(a) * r * 0.55,
            width: s, height: s, background: rnd(`${seed}c${i}`) > 0.45 ? GOLD[0] : GOLD[1],
            boxShadow: `0 ${Math.round(s / 3)}px 0 rgba(0,0,0,0.55)`,
          }} />
        );
      })}
    </>
  );

/* ---------- 1. The arena: an ocean of pills, one of them yours ---------- */
const crowd = (n: number, seed: string, minR: number) =>
  Array.from({ length: n }, (_, i) => {
    let x = 0, y = 0;
    for (let k = 0; k < 24; k++) {
      x = 60 + rnd(`${seed}x${i}.${k}`) * (W - 120);
      y = 60 + rnd(`${seed}y${i}.${k}`) * (H - 120);
      if (Math.hypot(x - W / 2, y - H / 2) > minR) break;
    }
    return { x, y, i };
  });

export const ArenaA: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    <Food seed="ca" n={90} opacity={0.9} />
    {crowd(34, "ca", 360).map(({ x, y, i }) => {
      const [t, b] = PALETTE[(i + 1) % PALETTE.length];
      return <Pill key={i} x={x} y={y} wL={8 + (i % 5) * 2} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} />;
    })}
    <Pill x={W / 2} y={H / 2} wL={30} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.75) 100%)" }} />
  </AbsoluteFill>
);

export const ArenaB: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    <Food seed="cb" n={70} opacity={0.8} />
    {/* A wall of rivals on the right, the player alone on the left. */}
    {Array.from({ length: 28 }, (_, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const [t, b] = PALETTE[(i + 2) % PALETTE.length];
      return (
        <Pill key={i} x={W * 0.62 + col * 130 + (row % 2) * 60} y={90 + row * 145}
          wL={10 + (i % 4) * 2} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} />
      );
    })}
    <Pill x={W * 0.24} y={H * 0.52} wL={26} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 35%)" }} />
  </AbsoluteFill>
);

export const ArenaC: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    <Food seed="cc" n={60} opacity={0.75} />
    {/* A ring closing in: the circle a big pill draws around it in a match. */}
    {Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * 6.28, r = 430 + rnd(`cc${i}`) * 90;
      const [t, b] = PALETTE[(i + 3) % PALETTE.length];
      return (
        <Pill key={i} x={W / 2 + Math.cos(a) * r * 1.35} y={H / 2 + Math.sin(a) * r * 0.85}
          wL={9 + (i % 4) * 3} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} />
      );
    })}
    <Pill x={W / 2} y={H / 2} wL={22} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.8) 100%)" }} />
  </AbsoluteFill>
);

/* ---------- 2. The money: what a pill is carrying ---------- */
export const MoneyA: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    <Food seed="ma" n={40} opacity={0.6} />
    <div style={{
      position: "absolute", left: W / 2 - 320, top: H / 2 - 320, width: 640, height: 640,
      background: "radial-gradient(circle, rgba(255,206,61,0.20) 0%, rgba(255,206,61,0) 70%)",
    }} />
    {/* A pill in the gold of the money pop-up, spilling coins. */}
    <Pill x={W / 2} y={H * 0.46} wL={34} scale={PIXEL} top={GOLD[0]} bot={GOLD[1]} ang={GAME_ANGLE} />
    <Gold x={W / 2} y={H * 0.78} n={90} spread={330} seed="ma" size={12} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.8) 100%)" }} />
  </AbsoluteFill>
);

export const MoneyB: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    <Food seed="mb" n={35} opacity={0.5} />
    {/* Empty shells: what is left of the ones that were eaten. */}
    {Array.from({ length: 9 }, (_, i) => {
      const [t, b] = PALETTE[(i + 1) % PALETTE.length];
      const x = 240 + rnd(`mbx${i}`) * (W - 480), y = 200 + rnd(`mby${i}`) * (H - 400);
      return (
        <React.Fragment key={i}>
          <Pill x={x} y={y} wL={12 + (i % 3) * 4} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} grey={0.75} opacity={0.55} />
          <Gold x={x + 30} y={y + 40} n={10} spread={70} seed={`mb${i}`} size={8} />
        </React.Fragment>
      );
    })}
    <Pill x={W * 0.5} y={H * 0.5} wL={26} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <Gold x={W * 0.5} y={H * 0.72} n={60} spread={260} seed="mbc" size={11} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.75) 100%)" }} />
  </AbsoluteFill>
);

export const MoneyC: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    {/* The classic money pop-up, blown up: the game's own green over black. */}
    <Pill x={W * 0.32} y={H * 0.58} wL={28} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <Pill x={W * 0.62} y={H * 0.62} wL={14} scale={PIXEL} top={PALETTE[2][0]} bot={PALETTE[2][1]} ang={GAME_ANGLE} grey={0.8} opacity={0.5} />
    <Gold x={W * 0.62} y={H * 0.7} n={30} spread={150} seed="mc" size={9} />
    <div style={{
      position: "absolute", left: 0, right: 0, top: H * 0.24, textAlign: "center",
      fontFamily: PX, fontSize: 86, color: "#3ddc84", letterSpacing: 4,
      textShadow: "8px 8px 0 #000, 0 0 30px rgba(61,220,132,0.45)",
    }}>+$23.00</div>
    <div style={{
      position: "absolute", left: 0, right: 0, top: H * 0.36, textAlign: "center",
      fontFamily: PX, fontSize: 34, color: "#ff2a2a", letterSpacing: 6, textShadow: "5px 5px 0 #000",
    }}>DOUBLE KILL</div>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.7) 100%)" }} />
  </AbsoluteFill>
);

/* ---------- 3. The room: everyone pays the same to get in ---------- */
const Room: React.FC<{ children?: React.ReactNode; label?: string }> = ({ children, label }) => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    <Food seed={"rm" + (label || "")} n={45} opacity={0.6} />
    <div style={{
      position: "absolute", left: 150, top: 110, right: 150, bottom: 110,
      border: "10px dashed rgba(0,255,136,0.75)", boxShadow: "0 0 40px rgba(0,255,136,0.18) inset",
    }} />
    {children}
  </AbsoluteFill>
);

export const RoomA: React.FC = () => (
  <Room label="a">
    {Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * 6.28, [t, b] = PALETTE[(i + 1) % PALETTE.length];
      return (
        <Pill key={i} x={W / 2 + Math.cos(a) * 560} y={H / 2 + Math.sin(a) * 320}
          wL={14} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} />
      );
    })}
    <Gold x={W / 2} y={H / 2} n={70} spread={190} seed="ra" size={13} />
  </Room>
);

export const RoomB: React.FC = () => (
  <Room label="b">
    {Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * 6.28 + 0.4, [t, b] = PALETTE[(i + 2) % PALETTE.length];
      return (
        <Pill key={i} x={W / 2 + Math.cos(a) * 600} y={H / 2 + Math.sin(a) * 330}
          wL={10} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} grey={0.7} opacity={0.5} />
      );
    })}
    {/* Last pill standing, with the table in front of it. */}
    <Pill x={W / 2} y={H * 0.44} wL={30} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <Gold x={W / 2} y={H * 0.74} n={110} spread={300} seed="rb" size={13} />
  </Room>
);

export const RoomC: React.FC = () => (
  <Room label="c">
    {/* The entry fee: everyone puts in the same before it starts. */}
    {Array.from({ length: 6 }, (_, i) => {
      const x = 330 + i * 250, [t, b] = PALETTE[(i + 1) % PALETTE.length];
      return (
        <React.Fragment key={i}>
          <Pill x={x} y={H * 0.36} wL={13} scale={PIXEL} top={t} bot={b} ang={GAME_ANGLE} />
          <Gold x={x} y={H * 0.6} n={12} spread={52} seed={`rc${i}`} size={11} />
        </React.Fragment>
      );
    })}
  </Room>
);


/* ---------- The pill from birth to the gold crown (capture mode 'growth') ---------- */
export const GROWTH_FRAMES = growthCapture.frames as number;
export const Growth: React.FC = () => {
  const f = useCurrentFrame();
  const at = Math.min(GROWTH_FRAMES - 1, f);
  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      <Img src={staticFile(`growth/${String(at).padStart(4, "0")}.jpg`)} style={{ width: W, height: H }} />
    </AbsoluteFill>
  );
};

/* ---------- The card that closes every thread, built like the 404 page ----------
 * Everything comes from 404.html: the arena floor grid, the neon of THE CRYPTO
 * ARENA for the big line, white Press Start under it, grey for the note, and
 * its own strip of food and pill (the same PNG the page inlines, pulled out to
 * public/hud/404-food.png). Only the BACK TO HOME button is left out.
 *
 * The page is read on a ~800px wide screen and this is a 1920px image, so the
 * grid and the strip are scaled by the same factor (2.4) to look like it.
 */
const K = 2.4;
const GRID: React.CSSProperties = {
  backgroundColor: "#050505",
  backgroundImage:
    `linear-gradient(rgba(255,255,255,0.03) ${4 * K}px, transparent ${4 * K}px),` +
    `linear-gradient(90deg, rgba(255,255,255,0.03) ${4 * K}px, transparent ${4 * K}px)`,
  backgroundSize: `${100 * K}px ${100 * K}px`,
};
const NEON = "0 0 6px #00ff88, 0 0 14px #00ff88, 0 0 26px rgba(0,255,136,0.7)";

const Card: React.FC<{ code: string; title: string; note: React.ReactNode }> = ({ code, title, note }) => (
  <AbsoluteFill style={{ ...GRID, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
    <div style={{ width: 1720 }}>
      {/* .code */}
      <div style={{ fontFamily: PX, fontSize: 104, lineHeight: 1, letterSpacing: 8, color: "#aaffdd", textShadow: NEON }}>{code}</div>
      {/* h1 */}
      <div style={{ fontFamily: PX, fontSize: 18 * K, letterSpacing: 2 * K, color: "#fff", marginTop: 18 * K, textShadow: `${3 * K}px ${3 * K}px 0 rgba(0,0,0,0.7)` }}>{title}</div>
      {/* p */}
      <div style={{ fontFamily: PX, fontSize: 10 * K, lineHeight: 1.9, color: "#9aa1a9", marginTop: 14 * K, maxWidth: 460 * K, marginLeft: "auto", marginRight: "auto" }}>{note}</div>
      {/* .food */}
      <Img src={staticFile("hud/404-food.png")} style={{ width: 480 * K, height: "auto", marginTop: 22 * K, imageRendering: "pixelated" }} />
    </div>
  </AbsoluteFill>
);

export const NoTokenA: React.FC = () => (
  <Card code="NO TOKEN" title="THERE IS NOTHING TO BUY"
    note={<>PillWars has no token in circulation. Any contract with our name on it is not ours.</>} />
);

export const NoTokenB: React.FC = () => (
  <Card code="0" title="TOKENS IN CIRCULATION"
    note={<>Nothing is for sale. If you find a contract out there, it is not ours.</>} />
);

export const NoTokenC: React.FC = () => (
  <Card code="END OF THREAD" title="COMMENT YOUR THOUGHTS BELOW"
    note={<>There is no PillWars token in circulation. Any contract with our name on it is not ours.</>} />
);

export const CONCEPTS: [string, React.FC][] = [
  ["no-token-a", NoTokenA], ["no-token-b", NoTokenB], ["no-token-c", NoTokenC],
  ["concept-arena-a", ArenaA], ["concept-arena-b", ArenaB], ["concept-arena-c", ArenaC],
  ["concept-money-a", MoneyA], ["concept-money-b", MoneyB], ["concept-money-c", MoneyC],
  ["concept-room-a", RoomA], ["concept-room-b", RoomB], ["concept-room-c", RoomC],
];
