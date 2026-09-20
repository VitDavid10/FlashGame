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

/* ---------- The card that closes every thread: there is no token yet ---------- */
const NOTE = "No token. No presale. Nothing to buy.";
const Card: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: "#050505" }}>
    <ArenaFloor />
    {children}
  </AbsoluteFill>
);

export const NoTokenA: React.FC = () => (
  <Card>
    <div style={{
      position: "absolute", left: 180, top: 170, right: 180, bottom: 170,
      border: "10px solid rgba(255,42,42,0.85)", boxShadow: "0 0 60px rgba(255,42,42,0.15) inset",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 46,
    }}>
      <div style={{ fontFamily: PX, fontSize: 92, color: "#ff2a2a", letterSpacing: 6, textShadow: "8px 8px 0 #000" }}>NO TOKEN YET</div>
      <div style={{ fontFamily: PX, fontSize: 30, color: "#e8f5ee", letterSpacing: 3, lineHeight: 2.1, textAlign: "center", textShadow: "4px 4px 0 #000" }}>
        There is no PillWars token in circulation.<br />No presale. No whitelist. Nothing to buy.
      </div>
      <div style={{ fontFamily: PX, fontSize: 24, color: "#8b9199", letterSpacing: 3, textShadow: "3px 3px 0 #000" }}>
        Any contract out there is not ours.
      </div>
    </div>
  </Card>
);

export const NoTokenB: React.FC = () => (
  <Card>
    {/* A coin, crossed out with the game's red. */}
    <div style={{ position: "absolute", left: W / 2 - 150, top: H * 0.16, width: 300, height: 300 }}>
      <Gold x={150} y={150} n={26} spread={92} seed="ntb" size={20} />
      <svg width={300} height={300} style={{ position: "absolute", left: 0, top: 0 }} shapeRendering="crispEdges">
        <line x1={34} y1={34} x2={266} y2={266} stroke="#ff2a2a" strokeWidth={22} />
        <line x1={266} y1={34} x2={34} y2={266} stroke="#ff2a2a" strokeWidth={22} />
      </svg>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: H * 0.62, textAlign: "center" }}>
      <div style={{ fontFamily: PX, fontSize: 64, color: "#ffffff", letterSpacing: 5, textShadow: "7px 7px 0 #000" }}>NOTHING IS LIVE</div>
      <div style={{ fontFamily: PX, fontSize: 28, color: "#8b9199", letterSpacing: 3, marginTop: 40, lineHeight: 2, textShadow: "3px 3px 0 #000" }}>
        {NOTE}<br />If a $PILL contract exists, it is not ours.
      </div>
    </div>
  </Card>
);

export const NoTokenC: React.FC = () => (
  <Card>
    {/* The pill everyone starts with, alone, and the note under it. */}
    <Pill x={W / 2} y={H * 0.36} wL={30} scale={PIXEL} top={PALETTE[0][0]} bot={PALETTE[0][1]} ang={GAME_ANGLE} />
    <div style={{ position: "absolute", left: 0, right: 0, top: H * 0.62, textAlign: "center" }}>
      <div style={{ fontFamily: PX, fontSize: 40, color: "#00ff88", letterSpacing: 5, textShadow: "6px 6px 0 #000" }}>END OF THREAD</div>
      <div style={{ fontFamily: PX, fontSize: 26, color: "#e8f5ee", letterSpacing: 3, marginTop: 42, lineHeight: 2.1, textShadow: "3px 3px 0 #000" }}>
        There is no PillWars token in circulation.<br />No presale, no whitelist, nothing to buy.<br />
        <span style={{ color: "#ff2a2a" }}>Any contract you see is not ours.</span>
      </div>
    </div>
  </Card>
);

export const CONCEPTS: [string, React.FC][] = [
  ["no-token-a", NoTokenA], ["no-token-b", NoTokenB], ["no-token-c", NoTokenC],
  ["concept-arena-a", ArenaA], ["concept-arena-b", ArenaB], ["concept-arena-c", ArenaC],
  ["concept-money-a", MoneyA], ["concept-money-b", MoneyB], ["concept-money-c", MoneyC],
  ["concept-room-a", RoomA], ["concept-room-b", RoomB], ["concept-room-c", RoomC],
];
