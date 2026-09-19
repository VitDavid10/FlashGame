import React from "react";
import { interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/fonts";
import { pillSprite } from "./pill";

// The game's own lettering (same files as /fonts on the site).
loadFont({ family: "PressStart", url: staticFile("press-start-2p-latin.woff2") });
loadFont({ family: "VT323", url: staticFile("vt323-latin.woff2") });

export const PX = "PressStart, monospace";
export const VT = "VT323, monospace";
export const W = 1920, H = 1080;

/** One pill, centred on (x, y). `scale` = screen px per sprite px, so the
 *  pixels stay big and square like in the game. `grey` 0..1 drains its colour. */
export const Pill: React.FC<{
  x: number; y: number; wL?: number; scale?: number; top: string; bot: string;
  ang?: number; grey?: number; opacity?: number;
}> = ({ x, y, wL = 18, scale = 6, top, bot, ang = 0, grey = 0, opacity = 1 }) => {
  const { url, size } = pillSprite(wL, top, bot, ang);
  const px = size * scale;
  return (
    <img
      src={url}
      style={{
        position: "absolute", left: x - px / 2, top: y - px / 2, width: px, height: px,
        imageRendering: "pixelated", opacity,
        filter: grey > 0 ? `grayscale(${grey}) brightness(${1 - 0.45 * grey})` : undefined,
      }}
    />
  );
};

/** The arena floor: dark, with the faint grid the game draws. */
export const Grid: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <div
    style={{
      position: "absolute", inset: 0, opacity, backgroundColor: "#07100b",
      backgroundImage:
        "linear-gradient(rgba(0,255,136,.07) 2px, transparent 2px), linear-gradient(90deg, rgba(0,255,136,.07) 2px, transparent 2px)",
      backgroundSize: "72px 72px",
    }}
  />
);

/** Scattered food dots, fixed per seed. */
export const Food: React.FC<{ seed: string; n?: number; opacity?: number }> = ({ seed, n = 90, opacity = 1 }) => {
  const cols = ["#00ff88", "#ffce3d", "#1d9bf0", "#f62a2d", "#ccff00", "#ff7ac8"];
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute", width: 10, height: 10, opacity,
            left: random(`${seed}x${i}`) * W, top: random(`${seed}y${i}`) * H,
            background: cols[Math.floor(random(`${seed}c${i}`) * cols.length)],
          }}
        />
      ))}
    </>
  );
};

/** Big pixel caption with the site's hard black shadow, fading in from `at`. */
export const Caption: React.FC<{
  text: string; at?: number; out?: number; y?: number; size?: number; color?: string;
}> = ({ text, at = 0, out, y = H * 0.8, size = 46, color = "#ffffff" }) => {
  const f = useCurrentFrame();
  const fadeIn = interpolate(f, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = out === undefined ? 1 : interpolate(f, [out, out + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const d = Math.round(size / 8);
  return (
    <div
      style={{
        position: "absolute", left: 80, right: 80, top: y, textAlign: "center",
        fontFamily: PX, fontSize: size, lineHeight: 1.35, color,
        opacity: fadeIn * fadeOut,
        transform: `translateY(${(1 - fadeIn) * 14}px)`,
        textShadow: `${d}px ${d}px 0 #000, ${d * 2}px ${d * 2}px 0 rgba(0,0,0,.5)`,
      }}
    >
      {text}
    </div>
  );
};
