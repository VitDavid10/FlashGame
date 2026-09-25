import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { ArenaFloor, Caption, FPS, Food, H, VT, W, typeFrames } from "./ui";

// Announcement: the arena floor, then the Discord and Telegram logos appear on
// the map with a flash, then the caption. Logos are 24x24 pixel art
// (public/social/*.png), drawn at LOGO_SCALE screen px per sprite px.
const LOGO_SCALE = 12;
const LOGO = 24 * LOGO_SCALE;
const FLASH_A = 25, FLASH_B = 60;      // frames where each logo appears
const TEXT_AT = 100;
const LINKS_AT = TEXT_AT + 125;
export const SOCIALS_FRAMES = LINKS_AT + 10 + 10 * FPS; // everything on screen, then 10 s still
const KEYS = ["snd/type1.wav", "snd/type2.wav", "snd/type3.wav"];

/** Pixel cross burst (no white box), then the logo pops in (1.25 → 0.92 → 1) and bobs. */
const LogoFlash: React.FC<{ src: string; cx: number; cy: number }> = ({ src, cx, cy }) => {
  const f = useCurrentFrame();
  // Pixel-snapped pop: steps instead of a smooth tween, like the game's sprites.
  const pop = f < 3 ? 1.25 : f < 6 ? 0.92 : 1;
  const bob = f > 10 ? Math.round(Math.sin((f - 10) / 14) * 2) * 4 : 0;
  const s = LOGO * pop;
  const flash = interpolate(f, [0, 8], [1, 0], { extrapolateRight: "clamp" });
  const ray = interpolate(f, [0, 8], [LOGO * 0.6, LOGO * 1.6], { extrapolateRight: "clamp" });
  const px = 12; // burst thickness, a multiple of the pixel size
  return (
    <>
      {flash > 0 && (
        <>
          <div style={{ position: "absolute", left: cx - ray, top: cy - px / 2, width: ray * 2, height: px, background: "#fff", opacity: flash }} />
          <div style={{ position: "absolute", left: cx - px / 2, top: cy - ray, width: px, height: ray * 2, background: "#fff", opacity: flash }} />
        </>
      )}
      <Img src={staticFile(src)} style={{ position: "absolute", left: cx - s / 2, top: cy - s / 2 + bob, width: s, height: s, imageRendering: "pixelated" }} />
      <Audio src={staticFile("snd/shield.mp3")} volume={0.35} />
    </>
  );
};

export const Socials: React.FC = () => {
  const f = useCurrentFrame();
  const links = interpolate(f, [LINKS_AT, LINKS_AT + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cy = H * 0.33;           // logos + text block centred on screen
  return (
    <AbsoluteFill style={{ background: "#050505", overflow: "hidden" }}>
      <ArenaFloor />
      <Food seed="socials" n={60} />
      <Sequence from={FLASH_A} layout="none"><LogoFlash src="social/discord.png" cx={W / 2 - 260} cy={cy} /></Sequence>
      <Sequence from={FLASH_B} layout="none"><LogoFlash src="social/telegram.png" cx={W / 2 + 260} cy={cy} /></Sequence>
      <Caption text="OFFICIAL DISCORD & TELEGRAM" at={TEXT_AT} y={H * 0.57} size={52} sfx={KEYS} />
      <Caption text="JOIN THE PILLWARS COMMUNITY!" at={TEXT_AT + typeFrames("OFFICIAL DISCORD & TELEGRAM") + 6} y={H * 0.66} size={40} color="#00ff88" sfx={KEYS} />
      <div style={{
        position: "absolute", left: 0, right: 0, top: H * 0.77, textAlign: "center", opacity: links,
        fontFamily: VT, fontSize: 44, color: "#cfd3d8", textShadow: "4px 4px 0 #000",
      }}>
        discord.gg/rfZK7fQ32E &nbsp;·&nbsp; t.me/pillwars_fun
      </div>
    </AbsoluteFill>
  );
};
