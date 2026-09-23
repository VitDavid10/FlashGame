import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import capture from "../public/action/events.json";
import { H, W } from "./ui";

/*
 * 10 s of the map in action, cut to the game's own match music (capture mode
 * 'action' in capture/director.js). The music is snd/music.mp3 from 37.175 s,
 * trimmed to public/snd/action-music.wav: every scene's hit was captured on a
 * kick of it, and it ends where the song cuts. (Cut 35 ms later than the beat
 * grid says: the render delays the audio by about that much.) The effects are
 * the game's own sounds, each on the frame the capture logged it happening —
 * all but the two that ring on for ~2 s (sprint's low rumble, the shield's
 * whine): over the music they came across as a buzz (David).
 */
export const ACTION_FRAMES = capture.frames as number;

const ev = capture.events as {
  catch1?: number; split?: number; catch2?: number; pop?: number; snacks?: (number | null)[];
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const SFX: [string, number | null | undefined, number][] = [
  ["snd/kill1.mp3", ev.catch1, 0.4],
  ["snd/split.mp3", ev.split, 0.45],
  ["snd/kill1.mp3", ev.catch2, 0.4],
  ["snd/virus.mp3", ev.pop, 0.5],
  ...(ev.snacks ?? []).map((f): [string, number | null, number] => ["snd/kill1.mp3", f, 0.35]),
];

export const Action: React.FC = () => {
  const f = useCurrentFrame();
  const at = Math.min(ACTION_FRAMES - 1, f);
  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      <Img src={staticFile(`action/${String(at).padStart(4, "0")}.jpg`)} style={{ width: W, height: H }} />
      <Audio
        src={staticFile("snd/action-music.wav")}
        volume={(v) => interpolate(v, [0, 2, ACTION_FRAMES - 8, ACTION_FRAMES], [0, 0.9, 0.9, 0], clamp)}
      />
      {SFX.filter(([, at]) => at != null).map(([src, at, volume], i) => (
        <Sequence key={i} from={at as number} layout="none">
          <Audio src={staticFile(src)} volume={volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
