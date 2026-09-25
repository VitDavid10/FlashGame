import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { ArenaFloor, FPS, Food, GAME_ANGLE, H, PIXEL, PX, Pill, VT, W } from "./ui";
import { PALETTE } from "./pill";

/*
 * 15 s airdrop announcement on the game's match music (snd/music.mp3 from
 * 37.21 s, trimmed to public/snd/airdrop-music.wav). The song runs at ~123 BPM:
 * a beat every ~14.6 frames, so every cut and every slam sits on BEAT(n).
 * Scenes: title → 10% of the supply → who gets it → pool value vs FDV → CTA.
 */
export const AIRDROP_FRAMES = 15 * FPS;
const BEAT = (n: number) => Math.round(n * 14.63);
const CUTS = [BEAT(6), BEAT(14), BEAT(20), BEAT(28)]; // 88, 205, 293, 410
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const snap = (v: number, s = PIXEL) => Math.round(v / s) * s;
const GREEN = "#00ff88", LIME = "#ccff00", GOLD = "#ffce3d", RED = "#f62a2d", CYAN = "#00e5ff";

const SUPPLY = 1_000_000_000, AIRDROP_PCT = 10; // same numbers as server/airdrop-admin.js
const POOL = (SUPPLY * AIRDROP_PCT) / 100;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => (n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}K`);

// Frames where the camera takes a hit (shake + flash), all on the beat grid.
const HITS = [0, BEAT(3), BEAT(4), CUTS[0], BEAT(9), CUTS[1], CUTS[1] + BEAT(1), CUTS[1] + BEAT(2), CUTS[1] + BEAT(3), CUTS[1] + BEAT(4), CUTS[2], CUTS[3], CUTS[3] + BEAT(1)];

/** Hard pixel slam: pops in oversized, overshoots in steps, chromatic split that settles. */
const Slam: React.FC<{
  at: number; text: string; y: number; size: number; color?: string; x?: number; out?: number; align?: "center" | "left";
}> = ({ at, text, y, size, color = "#fff", x, out, align = "center" }) => {
  const f = useCurrentFrame(), t = f - at;
  if (t < 0 || (out !== undefined && f >= out)) return null;
  const s = t < 2 ? 1.9 : t < 4 ? 0.88 : t < 6 ? 1.06 : 1;
  const c = snap(Math.max(0, 14 - t * 2));
  const d = Math.round(size / 9);
  return (
    <div style={{
      position: "absolute", left: x ?? 0, right: x === undefined ? 0 : undefined, top: y, textAlign: align,
      fontFamily: PX, fontSize: size, lineHeight: 1.1, color, whiteSpace: "nowrap",
      transform: `scale(${s})`, transformOrigin: align === "center" ? "50% 50%" : "0% 50%",
      textShadow: `${c}px 0 0 ${RED}, ${-c}px 0 0 ${CYAN}, ${d}px ${d}px 0 #000, ${d * 2}px ${d * 2}px 0 rgba(0,0,0,.45)`,
    }}>{text}</div>
  );
};

/** Pixel cells sweeping diagonally over the frame, covering the cut at T. */
const PixelWipe: React.FC<{ T: number; color: string }> = ({ T, color }) => {
  const f = useCurrentFrame();
  if (f < T - 12 || f > T + 14) return null;
  const C = 120, cols = W / C, rows = H / C;
  return (
    <>
      {Array.from({ length: cols * rows }, (_, k) => {
        const i = k % cols, j = Math.floor(k / cols);
        const d = ((i + j) / (cols + rows)) * 8;
        const p = interpolate(f, [T - 11 + d, T - 5 + d], [0, 1], clamp);
        const q = interpolate(f, [T + d, T + 6 + d], [0, 1], clamp);
        const s = snap(C * Math.max(0, p - q), 8);
        if (s <= 0) return null;
        return <div key={k} style={{ position: "absolute", left: i * C + (C - s) / 2, top: j * C + (C - s) / 2, width: s, height: s, background: (i + j) % 3 === 0 ? LIME : color }} />;
      })}
    </>
  );
};

/** Always-on showreel chrome: corner brackets, tag, running timecode, scanlines. */
const Hud: React.FC = () => {
  const f = useCurrentFrame();
  const L = 64, T = 10, M = 36;
  const corner = (l: boolean, t: boolean): React.CSSProperties => ({
    position: "absolute", width: L, height: L, [l ? "left" : "right"]: M, [t ? "top" : "bottom"]: M,
    [`border${t ? "Top" : "Bottom"}`]: `${T}px solid ${GREEN}`, [`border${l ? "Left" : "Right"}`]: `${T}px solid ${GREEN}`,
  });
  const sec = Math.floor(f / FPS), fr = f % FPS;
  return (
    <>
      <div style={corner(true, true)} /><div style={corner(false, true)} />
      <div style={corner(true, false)} /><div style={corner(false, false)} />
      <div style={{ position: "absolute", left: M + 24, top: M + 22, fontFamily: VT, fontSize: 38, color: GREEN, textShadow: "3px 3px 0 #000" }}>
        PILLWARS // SEASON 0
      </div>
      <div style={{ position: "absolute", right: M + 24, top: M + 22, fontFamily: VT, fontSize: 38, color: "#fff", textShadow: "3px 3px 0 #000" }}>
        <span style={{ color: RED, opacity: Math.floor(f / 15) % 2 ? 0.2 : 1 }}>■</span> 00:{String(sec).padStart(2, "0")}:{String(fr).padStart(2, "0")}
      </div>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 2px, transparent 2px 6px)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.7) 100%)" }} />
    </>
  );
};

// ─── 1. Title ────────────────────────────────────────────────────────────────
const WORDS: [number, string, string][] = [[0, "SEASON 0", GREEN], [BEAT(1), "100%", "#fff"], [BEAT(2), "ON-CHAIN", LIME]];

const Title: React.FC = () => {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [BEAT(3), CUTS[0]], [1.12, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: -200, transform: `translateX(${snap(-f * 6)}px) scale(${zoom})` }}>
        <ArenaFloor /><Food seed="drop1" n={90} />
      </div>
      {/* pills rushing across the frame with speed trails */}
      {Array.from({ length: 12 }, (_, i) => {
        const speed = 38 + (i % 4) * 14, y = 120 + ((i * 377) % 860);
        const x = ((f * speed + i * 530) % (W + 700)) - 350;
        const [t, b] = PALETTE[i % PALETTE.length];
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: x - 420, top: y - 6, width: 400, height: 12, background: `linear-gradient(90deg, transparent, ${b})`, opacity: 0.55 }} />
            <Pill x={x} y={y} wL={10 + (i % 3) * 4} scale={PIXEL} top={t} bot={b} ang={-Math.PI / 2} />
          </React.Fragment>
        );
      })}
      {WORDS.map(([at, w, c], i) => (
        <Slam key={w} at={at} out={i < WORDS.length - 1 ? WORDS[i + 1][0] : BEAT(3)} text={w} y={H / 2 - 80} size={150} color={c} />
      ))}
      <Slam at={BEAT(3)} text="$PILLY" y={H / 2 - 230} size={210} color={LIME} />
      <Slam at={BEAT(4)} text="AIRDROP" y={H / 2 + 20} size={170} />
      <Slam at={BEAT(5)} text="PLAY. HUNT. HOLD. GET PAID." y={H * 0.74} size={40} color={GREEN} />
    </AbsoluteFill>
  );
};

// ─── 2. 10% of the supply ────────────────────────────────────────────────────
const Supply: React.FC = () => {
  const f = useCurrentFrame();
  // 1B supply as a 10x10 block grid; the top row (10%) lights up, then lifts out.
  const GX = 1060, GY = 250, CELL = 52, GAP = 8;
  const lift = interpolate(f, [BEAT(3), BEAT(3) + 8], [0, -70], { ...clamp, easing: Easing.out(Easing.back(3)) });
  const count = interpolate(f, [BEAT(4), BEAT(6)], [0, POOL], { ...clamp, easing: Easing.out(Easing.cubic) });
  const pct = Math.round(interpolate(f, [0, 10], [0, AIRDROP_PCT], clamp));
  return (
    <AbsoluteFill>
      <ArenaFloor /><Food seed="drop2" n={50} opacity={0.6} />
      <Slam at={0} text={`${pct}%`} x={150} y={250} size={250} color={LIME} align="left" />
      <Slam at={BEAT(1)} text="OF THE TOTAL SUPPLY" x={150} y={560} size={40} align="left" />
      {Array.from({ length: 100 }, (_, k) => {
        const i = k % 10, j = Math.floor(k / 10);
        const on = j === 0 && f >= BEAT(1) + i * 2;
        const appear = interpolate(f, [k * 0.25, k * 0.25 + 4], [0, 1], clamp);
        const pop = on && f < BEAT(1) + i * 2 + 3 ? 1.25 : 1;
        const s = CELL * appear * pop;
        return (
          <div key={k} style={{
            position: "absolute", left: GX + i * (CELL + GAP) + (CELL - s) / 2, top: GY + j * (CELL + GAP) + (CELL - s) / 2 + (j === 0 ? lift : 0),
            width: s, height: s, background: on ? LIME : "#1a2a22", border: on ? "none" : "4px solid #2c4a3a",
            boxShadow: on ? `0 0 ${snap(24)}px ${LIME}, inset -8px -8px 0 rgba(0,0,0,.25)` : undefined,
          }} />
        );
      })}
      <div style={{ position: "absolute", left: GX, top: GY + 10 * (CELL + GAP) + 16, fontFamily: VT, fontSize: 36, color: "#9fc2ad" }}>
        TOTAL SUPPLY: {fmt(SUPPLY)} $PILLY
      </div>
      {f >= BEAT(4) && (
        <div style={{
          position: "absolute", left: 150, top: 700, fontFamily: PX, fontSize: 64, color: GOLD,
          textShadow: "7px 7px 0 #000", transform: `scale(${f < BEAT(4) + 3 ? 1.15 : 1})`, transformOrigin: "0 50%",
        }}>
          {fmt(count)}
          <div style={{ fontSize: 30, color: "#fff", marginTop: 18 }}>$PILLY TO THE PLAYERS</div>
        </div>
      )}
      <Sequence from={BEAT(1)} layout="none"><Audio src={staticFile("snd/split.mp3")} volume={0.4} /></Sequence>
      <Sequence from={BEAT(4)} layout="none"><Audio src={staticFile("snd/money.mp3")} volume={0.5} /></Sequence>
    </AbsoluteFill>
  );
};

// ─── 3. Who gets it ──────────────────────────────────────────────────────────
const HUNTED = ["JTO", "PYTH", "W", "BONK", "TNSR", "DRIFT", "ME", "MET", "CLOUD", "GRASS"];
const CARDS: { title: string; sub: string; color: string; pal: number }[] = [
  { title: "AIRDROP\nHUNTERS", sub: "past Solana drops", color: LIME, pal: 3 },
  { title: "SAGA &\nSEEKER", sub: "Genesis Token holders", color: CYAN, pal: 1 },
  { title: "MAD LADS\nHOLDERS", sub: "one NFT, one wallet", color: GOLD, pal: 2 },
  { title: "PLAYERS &\nINVITERS", sub: "arena · invites · X", color: GREEN, pal: 0 },
];

const Card: React.FC<{ i: number }> = ({ i }) => {
  const f = useCurrentFrame();
  const c = CARDS[i], at = BEAT(i) + 6;
  const t = f - at;
  if (t < 0) return null;
  const drop = t < 3 ? -snap(260 - t * 90) : t < 5 ? 16 : 0;
  const cw = 380, ch = 520, x = 150 + i * (cw + 40), y = 330 + drop;
  const [pt, pb] = PALETTE[c.pal];
  return (
    <div style={{ position: "absolute", left: x, top: y, width: cw, height: ch, background: "#07130d", border: `8px solid ${c.color}`, boxShadow: `12px 12px 0 #000, 0 0 40px ${c.color}55` }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 170, background: `repeating-linear-gradient(45deg, ${c.color}22 0 8px, transparent 8px 16px)` }} />
      <Pill x={cw / 2} y={92} wL={18} scale={PIXEL} top={pt} bot={pb} ang={GAME_ANGLE + Math.round(Math.sin((f + i * 9) / 6)) * 0.39} />
      {i === 0 && [0, 1, 2, 3].map((k) => { // crosshair on the hunter's pill
        const a = (k * Math.PI) / 2, r = 70;
        return <div key={k} style={{ position: "absolute", left: cw / 2 + Math.cos(a) * r - (k % 2 ? 4 : 16), top: 92 + Math.sin(a) * r - (k % 2 ? 16 : 4), width: k % 2 ? 8 : 32, height: k % 2 ? 32 : 8, background: RED }} />;
      })}
      <div style={{ position: "absolute", left: 24, right: 24, top: 200, fontFamily: PX, fontSize: 34, lineHeight: 1.4, color: c.color, whiteSpace: "pre", textShadow: "4px 4px 0 #000" }}>{c.title}</div>
      <div style={{ position: "absolute", left: 24, right: 24, top: 318, fontFamily: VT, fontSize: 36, color: "#cfd3d8" }}>{c.sub}</div>
      {i === 0 && (
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 22, height: 50, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 12, transform: `translateX(${-snap(t * 5)}px)` }}>
            {[...HUNTED, ...HUNTED].map((s, k) => (
              <span key={k} style={{ fontFamily: VT, fontSize: 32, color: "#000", background: LIME, padding: "2px 12px" }}>{s}</span>
            ))}
          </div>
        </div>
      )}
      {i > 0 && (
        <div style={{ position: "absolute", left: 24, bottom: 30, fontFamily: PX, fontSize: 22, color: "#000", background: c.color, padding: "10px 14px" }}>ELIGIBLE ✓</div>
      )}
      <Audio src={staticFile("snd/shield.mp3")} volume={0.3} />
    </div>
  );
};

const Who: React.FC = () => (
  <AbsoluteFill>
    <ArenaFloor /><Food seed="drop3" n={40} opacity={0.5} />
    <Slam at={0} text="WHO GETS PAID?" y={170} size={84} color="#fff" />
    {CARDS.map((_, i) => <Card key={i} i={i} />)}
  </AbsoluteFill>
);

// ─── 4. Pool value vs FDV ────────────────────────────────────────────────────
const FDVS = [5e6, 10e6, 25e6, 50e6, 100e6, 250e6];
const CX0 = 250, CX1 = 1250, BASE = 870, CH = 460, VMAX = 25e6;

const Chart: React.FC = () => {
  const f = useCurrentFrame();
  const bw = 120, step = (CX1 - CX0) / FDVS.length;
  const grow = (i: number) => interpolate(f, [8 + i * 7, 16 + i * 7], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
  const done = FDVS.filter((_, i) => grow(i) >= 1).length;
  const cur = Math.max(0, done - 1);
  const pool = (FDVS[cur] * AIRDROP_PCT) / 100;
  // the pill hops from bar top to bar top as each one lands
  const hopT = interpolate(f, [8 + cur * 7 + 8, 8 + cur * 7 + 14], [0, 1], clamp);
  const barTop = (i: number) => BASE - snap((((FDVS[i] * AIRDROP_PCT) / 100) / VMAX) * CH, 8);
  const px = CX0 + step * (cur + 0.5), py = barTop(cur) - 46 - (done ? Math.sin(hopT * Math.PI) * 60 : 0);
  return (
    <AbsoluteFill>
      <ArenaFloor opacity={0.7} />
      <Slam at={0} text="WHAT COULD YOUR DROP BE WORTH?" y={150} size={46} />
      {/* grid + y axis */}
      {[0, 5e6, 10e6, 15e6, 20e6, 25e6].map((v) => {
        const y = BASE - (v / VMAX) * CH;
        return (
          <React.Fragment key={v}>
            <div style={{ position: "absolute", left: CX0, width: CX1 - CX0, top: y, height: 4, background: v ? "rgba(159,194,173,.14)" : "#9fc2ad", opacity: interpolate(f, [0, 8], [0, 1], clamp) }} />
            <div style={{ position: "absolute", left: CX0 - 150, width: 130, top: y - 20, textAlign: "right", fontFamily: VT, fontSize: 34, color: "#9fc2ad" }}>{v ? usd(v) : "$0"}</div>
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: 70, top: BASE - CH - 70, fontFamily: VT, fontSize: 32, color: GREEN }}>AIRDROP POOL VALUE</div>
      {FDVS.map((fdv, i) => {
        const g = grow(i);
        const h = snap((((fdv * AIRDROP_PCT) / 100) / VMAX) * CH * g, 8);
        const x = CX0 + step * (i + 0.5) - bw / 2;
        const hot = i === cur && done > 0;
        return (
          <React.Fragment key={fdv}>
            <div style={{
              position: "absolute", left: x, top: BASE - h, width: bw, height: h,
              background: `linear-gradient(0deg, ${GREEN}, ${LIME})`, boxShadow: hot ? `0 0 40px ${LIME}` : undefined,
              borderTop: `8px solid #fff`, opacity: g > 0 ? 1 : 0,
            }} />
            <div style={{ position: "absolute", left: x - 30, width: bw + 60, top: BASE + 18, textAlign: "center", fontFamily: VT, fontSize: 34, color: "#cfd3d8" }}>{usd(fdv)}</div>
            {g >= 1 && (
              <div style={{ position: "absolute", left: x - 40, width: bw + 80, top: BASE - h - 150, textAlign: "center", fontFamily: PX, fontSize: 22, color: hot ? GOLD : "#fff", textShadow: "3px 3px 0 #000" }}>
                {usd((fdv * AIRDROP_PCT) / 100)}
              </div>
            )}
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: CX0, width: CX1 - CX0, top: BASE + 62, textAlign: "center", fontFamily: VT, fontSize: 32, color: GREEN }}>FULLY DILUTED VALUATION (FDV) OF $PILLY</div>
      {done > 0 && <Pill x={px} y={py} wL={14} scale={PIXEL} top={PALETTE[2][0]} bot={PALETTE[2][1]} ang={GAME_ANGLE} />}
      {/* live readout */}
      <div style={{ position: "absolute", left: 1370, top: 340, width: 430, padding: 30, background: "#07130d", border: `8px solid ${GOLD}`, boxShadow: "12px 12px 0 #000" }}>
        <div style={{ fontFamily: VT, fontSize: 36, color: "#9fc2ad" }}>IF FDV HITS</div>
        <div style={{ fontFamily: PX, fontSize: 48, color: "#fff", margin: "10px 0 26px" }}>{done ? usd(FDVS[cur]) : "--"}</div>
        <div style={{ fontFamily: VT, fontSize: 36, color: "#9fc2ad" }}>THE {AIRDROP_PCT}% POOL IS</div>
        <div style={{ fontFamily: PX, fontSize: 56, color: GOLD, marginTop: 10, textShadow: "5px 5px 0 #000", transform: `scale(${done && f - (8 + cur * 7 + 8) < 3 ? 1.18 : 1})`, transformOrigin: "0 50%" }}>
          {done ? usd(pool) : "--"}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 58, textAlign: "center", fontFamily: VT, fontSize: 28, color: "#6f8a7b" }}>
        ILLUSTRATIVE ONLY · POOL VALUE = {AIRDROP_PCT}% × FDV · NOT A PRICE PREDICTION · NOT FINANCIAL ADVICE
      </div>
      {FDVS.map((_, i) => (
        <Sequence key={i} from={16 + i * 7} layout="none"><Audio src={staticFile("snd/kill1.mp3")} volume={0.3} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ─── 5. Call to action ───────────────────────────────────────────────────────
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <ArenaFloor /><Food seed="drop5" n={70} />
      {Array.from({ length: 16 }, (_, i) => { // pills bursting out of the centre
        const a = (i / 16) * Math.PI * 2, r = snap(interpolate(f, [0, 30], [40, 900], { ...clamp, easing: Easing.out(Easing.cubic) }));
        const [t, b] = PALETTE[i % PALETTE.length];
        return <Pill key={i} x={W / 2 + Math.cos(a) * r * 1.2} y={H / 2 + Math.sin(a) * r * 0.7} wL={10 + (i % 3) * 4} scale={PIXEL} top={t} bot={b} ang={a + Math.PI / 2} />;
      })}
      <Slam at={0} text="SEASON 0 ENDS OCT 20" y={H / 2 - 170} size={70} color={LIME} />
      <Slam at={BEAT(1)} text="PILLWARS.FUN/AIRDROP" y={H / 2 - 20} size={78} />
      <Slam at={BEAT(2)} text="STACK YOUR POINTS NOW" y={H / 2 + 130} size={36} color={GREEN} />
    </AbsoluteFill>
  );
};

export const Airdrop: React.FC = () => {
  const f = useCurrentFrame();
  // Shake + flash on every hit, decaying over 8 frames, snapped to the pixel grid.
  const last = HITS.filter((h) => h <= f).pop() ?? -99;
  const k = Math.max(0, 1 - (f - last) / 8);
  const sx = snap(Math.sin(f * 2.7) * 22 * k), sy = snap(Math.cos(f * 3.1) * 16 * k);
  const bounds = [0, ...CUTS, AIRDROP_FRAMES];
  const scenes = [Title, Supply, Who, Chart, Outro];
  return (
    <AbsoluteFill style={{ background: "#050505", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
        {scenes.map((S, i) => (
          <Sequence key={i} from={bounds[i]} durationInFrames={bounds[i + 1] - bounds[i]}><S /></Sequence>
        ))}
      </AbsoluteFill>
      {f - last < 3 && <AbsoluteFill style={{ background: "#fff", opacity: 0.28 * (1 - (f - last) / 3) }} />}
      {CUTS.map((T) => <PixelWipe key={T} T={T} color={GREEN} />)}
      <Hud />
      <Audio src={staticFile("snd/airdrop-music.wav")} volume={(v) => interpolate(v, [0, 2, AIRDROP_FRAMES - 20, AIRDROP_FRAMES], [0, 0.9, 0.9, 0], clamp)} />
      {CUTS.map((T) => (
        <Sequence key={T} from={T - 6} layout="none"><Audio src={staticFile("snd/sprint.mp3")} volume={0.3} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
