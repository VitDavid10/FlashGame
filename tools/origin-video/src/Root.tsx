import "./index.css";
import { Composition } from "remotion";
import { Origin, TOTAL } from "./Origin";
import { CONCEPTS, GROWTH_FRAMES, Growth, TOUR_FRAMES, Tour } from "./Concepts";
import { ACTION_FRAMES, Action } from "./Action";
import { SOCIALS_FRAMES, Socials } from "./Socials";
import { AIRDROP_FRAMES, Airdrop } from "./Airdrop";
import { H, W } from "./ui";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Origin" component={Origin} durationInFrames={TOTAL} fps={30} width={W} height={H} />
      {/* The pill growing until it wears the gold crown. */}
      <Composition id="Growth" component={Growth} durationInFrames={GROWTH_FRAMES} fps={30} width={W} height={H} />
      {/* The bare map, no pill: a flyover of food and viruses. */}
      <Composition id="Tour" component={Tour} durationInFrames={TOUR_FRAMES} fps={30} width={W} height={H} />
      {/* 10 s of the map in action, on the beat of the game's music. */}
      <Composition id="Action" component={Action} durationInFrames={ACTION_FRAMES} fps={30} width={W} height={H} />
      {/* Announcement: official Discord & Telegram. */}
      <Composition id="Socials" component={Socials} durationInFrames={SOCIALS_FRAMES} fps={30} width={W} height={H} />
      {/* 15 s $PILLY airdrop announcement: 10% of the supply, who gets it, value vs FDV. */}
      <Composition id="Airdrop" component={Airdrop} durationInFrames={AIRDROP_FRAMES} fps={30} width={W} height={H} />
      {/* Posters for the posts, one still each (see src/Concepts.tsx). */}
      {CONCEPTS.map(([id, C]) => (
        <Composition key={id} id={id} component={C} durationInFrames={1} fps={30} width={W} height={H} />
      ))}
    </>
  );
};
