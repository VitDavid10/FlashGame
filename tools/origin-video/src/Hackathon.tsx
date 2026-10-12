import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { ArenaFloor, FPS, Food, H, PX, VT, W } from "./ui";

// Colosseum hackathon pitch: silent video to narrate over. The voice is the
// presenter's own; the subtitles only show what to say, one phrase at a time,
// paced like speech (about 2.4 words a second plus a breath between phrases).
// Visuals are the game's real screens (public/hackathon/*.png, captured from
// the local build at 1920x1080) and the clips already rendered in out/.

// Timeline built from the narrator's own recording (public/hackathon/voz.mp3,
// transcribed with word timestamps): seconds on the audio, not estimates.
type Scene = { id: string; from: number; to: number };
type CapT = { s: number; e: number; text: string };

const SCENES: Scene[] = [
  { id: "menu", from: 0, to: 11.2 },
  { id: "free", from: 11.2, to: 21.9 },
  { id: "paid", from: 21.9, to: 31.5 },
  { id: "fight", from: 31.5, to: 42.5 },
  { id: "penta", from: 42.5, to: 54.6 },
  { id: "chain", from: 54.6, to: 61.4 },
  { id: "weeks", from: 61.4, to: 68.1 },
  { id: "app", from: 68.1, to: 75.5 },
  { id: "why1", from: 75.5, to: 81 },
  { id: "why2", from: 81, to: 96 },
  { id: "why3", from: 96, to: 104.5 },
  { id: "why4", from: 104.5, to: 114 },
];

const CAPS: CapT[] = [
  { s: 0.0, e: 3.4, text: "Hello there, I'm David, the dev behind PillWars." },
  { s: 4.1, e: 10.7, text: "PillWars is a real-time arena game inspired by agar.io, with skills, game modes and real prizes." },
  { s: 11.7, e: 14.6, text: "Anyone can play PillWars for free in the free rooms," },
  { s: 15.6, e: 21.4, text: "and you can try these rooms with people before going to the paid rooms." },
  { s: 22.3, e: 24.4, text: "How does a paid room work?" },
  { s: 25.4, e: 31.0, text: "First, you need to choose your entry, from $2 to $20, in tokens." },
  { s: 32.0, e: 38.7, text: "Then you go to fight with other players, and when you kill someone, you get the pot." },
  { s: 39.6, e: 41.3, text: "This is the kill-to-earn system." },
  { s: 43.8, e: 48.9, text: "Then when you kill 5 people, you leave the match with all your tokens." },
  { s: 49.8, e: 53.8, text: "You can claim your tokens here or in your profile." },
  { s: 55.4, e: 60.9, text: "This game is fully on-chain. I don't hold any funds of players." },
  { s: 61.9, e: 67.7, text: "In this hackathon, I made a whole community. I made more than 500 commits." },
  { s: 68.4, e: 75.5, text: "I made the menus, the Arenas mode, the mobile app that will release in Solana Mobile in the next weeks." },
  { s: 75.9, e: 80.9, text: "I hope you like it. To finish, what are my motivations to create this project?" },
  { s: 81.5, e: 91.3, text: "The principal motivation was to create a simple game that could make you compete with other players easily," },
  { s: 91.7, e: 95.7, text: "and get money from them with a token system." },
  { s: 96.5, e: 103.9, text: "I also chose the pill theme, because I like Pump.fun and their devs." },
  { s: 105.2, e: 110.2, text: "I'm a physicist, based in Barcelona, and I hope you like this project." },
];

const END = 114;
export const HACKATHON_FRAMES = Math.round(END * FPS);
const fr = (s: number) => Math.round(s * FPS);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const GREEN = "#b6f23c";

/** Slow push-in on a still, optionally towards a point (0..1). */
const Still: React.FC<{ src: string; dur: number; from?: number; to?: number; ox?: number; oy?: number }> = ({ src, dur, from = 1, to = 1.06, ox = 0.5, oy = 0.5 }) => {
  const f = useCurrentFrame();
  const s = interpolate(f, [0, dur], [from, to], clamp);
  return <Img src={staticFile(src)} style={{ position: "absolute", inset: 0, width: W, height: H, transform: `scale(${s})`, transformOrigin: `${ox * 100}% ${oy * 100}%` }} />;
};

/** Pulsing pixel frame around something (x, y, w, h in 1920x1080 px). */
const Box: React.FC<{ x: number; y: number; w: number; h: number; at?: number; color?: string }> = ({ x, y, w, h, at = 0, color = "#ffce3d" }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [at, at + 8], [0, 1], clamp);
  const pulse = Math.floor((f - at) / 12) % 2 === 0 ? 1 : 0.55;
  return <div style={{ position: "absolute", left: x - 8, top: y - 8, width: w + 16, height: h + 16, border: `6px solid ${color}`, boxShadow: `0 0 0 4px #000, 6px 6px 0 6px rgba(0,0,0,.45)`, opacity: a * pulse }} />;
};

/** Subtitle: one phrase at a time, on the narrator's own timing, soft in and out. */
const Subs: React.FC = () => {
  const f = useCurrentFrame();
  const cur = CAPS.find((c) => f >= fr(c.s) - 3 && f < fr(c.e) + 8);
  if (!cur) return null;
  const a = interpolate(f, [fr(cur.s) - 3, fr(cur.s) + 3, fr(cur.e), fr(cur.e) + 8], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity: a, transform: `translateY(${(1 - a) * 10}px)` }}>
      <div style={{
        maxWidth: 1560, textAlign: "center", fontFamily: "'DM Sans', Arial, sans-serif", fontWeight: 700, fontSize: 52, lineHeight: 1.25, color: "#fff",
        background: "rgba(5,5,5,0.78)", padding: "16px 32px", borderRadius: 12, border: "2px solid rgba(182,242,60,0.55)",
      }}>{cur.text}</div>
    </div>
  );
};

const Title: React.FC<{ kicker?: string; big: string; sub?: string }> = ({ kicker, big, sub }) => (
  <div style={{ position: "absolute", left: 120, top: 120, right: 120 }}>
    {kicker && <div style={{ fontFamily: VT, fontSize: 44, color: GREEN, letterSpacing: 6, textShadow: "4px 4px 0 #000" }}>{kicker}</div>}
    <div style={{ fontFamily: PX, fontSize: 76, lineHeight: 1.25, color: "#fff", textShadow: "8px 8px 0 #000", marginTop: 12 }}>{big}</div>
    {sub && <div style={{ fontFamily: VT, fontSize: 52, color: "#a9b3c1", marginTop: 14, textShadow: "4px 4px 0 #000" }}>{sub}</div>}
  </div>
);

const Num: React.FC<{ n: string; label: string; x: number; y: number; w?: number }> = ({ n, label, x, y, w = 760 }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w }}>
    <div style={{ fontFamily: PX, fontSize: 120, color: GREEN, textShadow: "8px 8px 0 #000", lineHeight: 1.1 }}>{n}</div>
    <div style={{ fontFamily: VT, fontSize: 54, color: "#fff", marginTop: 8, textShadow: "4px 4px 0 #000" }}>{label}</div>
  </div>
);

const Chip: React.FC<{ t: string; x: number; y: number; at: number; color?: string }> = ({ t, x, y, at, color = GREEN }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [at, at + 8], [0, 1], clamp);
  return <div style={{ position: "absolute", left: x, top: y + (1 - a) * 16, opacity: a, fontFamily: PX, fontSize: 38, color: "#050505", background: color, padding: "16px 24px", boxShadow: "6px 6px 0 #000" }}>{t}</div>;
};

const Backdrop: React.FC<{ seed: string }> = ({ seed }) => (<><ArenaFloor /><Food seed={seed} n={80} opacity={0.9} /></>);

// Chip entry frame, relative to its scene, from an absolute second on the audio.
const rel = (sc: Scene, s: number) => Math.max(0, fr(s - sc.from));

const sceneBody = (sc: Scene): React.ReactNode => {
  const dur = fr(sc.to - sc.from);
  switch (sc.id) {
    case "menu":
      return <Still src="hackathon/menu.png" dur={dur} from={1} to={1.05} ox={0.3} oy={0.5} />;
    case "free":
      return (<><Still src="hackathon/rooms.png" dur={dur} from={1} to={1.18} ox={0.52} oy={0.4} /><Box x={932} y={290} w={166} h={296} at={rel(sc, 12)} color="#b6f23c" /></>);
    case "paid":
      return (<><Still src="hackathon/room2.png" dur={dur} from={1.04} to={1.14} ox={0.7} oy={0.4} /><Box x={1112} y={290} w={170} h={296} at={rel(sc, 25.6)} color="#2db6ff" /><Box x={1660} y={290} w={168} h={296} at={rel(sc, 28.5)} color="#ff5a4d" /></>);
    case "fight":
      return <Video src={staticFile("hackathon/chaos.mp4")} muted trimBefore={Math.round(4 * FPS)} style={{ position: "absolute", inset: 0, width: W, height: H, objectFit: "cover" }} />;
    case "penta":
      return <Still src="hackathon/pentakill.png" dur={dur} from={1} to={1.05} ox={0.5} oy={0.5} />;
    case "chain":
      return (
        <AbsoluteFill>
          <Backdrop seed="chain" />
          <Title kicker="WHY SOLANA" big="FULLY ON-CHAIN." />
          <Chip t="FUNDS LIVE ON-CHAIN" x={120} y={420} at={rel(sc, 55.6)} />
          <Chip t="I DON'T HOLD PLAYERS' FUNDS" x={120} y={560} at={rel(sc, 58)} color="#2db6ff" />
        </AbsoluteFill>
      );
    case "weeks":
      return (
        <AbsoluteFill>
          <Backdrop seed="weeks" />
          <Num n="519" label="commits · Sep 14 to Oct 12" x={120} y={150} />
          <Chip t="A WHOLE COMMUNITY" x={120} y={520} at={rel(sc, 62.2)} color="#7289ff" />
          <Chip t="DISCORD · TELEGRAM · X" x={120} y={660} at={rel(sc, 64)} color="#2db6ff" />
          <Chip t="VIDEOS · AIRDROP" x={120} y={800} at={rel(sc, 65.8)} color="#ffce3d" />
          <Video src={staticFile("hackathon/socials.mp4")} muted style={{ position: "absolute", right: 90, top: 150, width: 900, height: 506, objectFit: "cover", border: "6px solid #b6f23c", boxShadow: "10px 10px 0 #000" }} />
        </AbsoluteFill>
      );
    case "app":
      return (
        <>
          <Video src={staticFile("hackathon/seeker.mp4")} muted trimBefore={Math.round(0.5 * FPS)} style={{ position: "absolute", inset: 0, width: W, height: H, objectFit: "cover" }} />
          <Chip t="MENUS" x={80} y={70} at={rel(sc, 68.6)} />
          <Chip t="ARENAS MODE" x={360} y={70} at={rel(sc, 70.4)} color="#2db6ff" />
          <Chip t="MOBILE APP · SOLANA MOBILE" x={820} y={70} at={rel(sc, 72)} color="#ffce3d" />
        </>
      );
    case "why1":
      return (
        <AbsoluteFill>
          <Backdrop seed="why1" />
          <Title kicker="TO FINISH" big="WHY I MADE THIS." />
        </AbsoluteFill>
      );
    case "why2":
      return (
        <AbsoluteFill>
          <Backdrop seed="why2" />
          <Title kicker="THE MOTIVATION" big="AN AGAR.IO THAT PAYS." />
          <Chip t="A SIMPLE GAME TO COMPETE" x={120} y={420} at={rel(sc, 82)} />
          <Chip t="EASILY, AGAINST OTHER PLAYERS" x={120} y={540} at={rel(sc, 87)} color="#2db6ff" />
          <Chip t="GET MONEY FROM THEM WITH A TOKEN SYSTEM" x={120} y={660} at={rel(sc, 91.8)} color="#ffce3d" />
        </AbsoluteFill>
      );
    case "why3":
      return (
        <AbsoluteFill>
          <Backdrop seed="why3" />
          <Title kicker="WHY THE PILL THEME" big="I LIKE PUMP.FUN." />
          <Chip t="I LIKE PUMP.FUN AND THEIR DEVS" x={120} y={460} at={rel(sc, 98)} color="#ffce3d" />
        </AbsoluteFill>
      );
    case "why4":
      return (
        <AbsoluteFill>
          <Backdrop seed="why4" />
          <Title kicker="DAVID · PILLWARS" big="PLAY IT TODAY" sub="pillwars.fun · @pillwarsdotfun" />
          <Chip t="PHYSICIST · BARCELONA" x={120} y={560} at={rel(sc, 105.4)} color="#ff5a4d" />
        </AbsoluteFill>
      );
    default:
      return null;
  }
};

export const Hackathon: React.FC = () => (
  <AbsoluteFill style={{ background: "#050505" }}>
    {SCENES.map((s) => (
      <Sequence key={s.id} from={fr(s.from)} durationInFrames={fr(s.to - s.from)}>
        <AbsoluteFill>{sceneBody(s)}</AbsoluteFill>
      </Sequence>
    ))}
    <Subs />
    <Audio src={staticFile("hackathon/voz.mp3")} />
  </AbsoluteFill>
);
