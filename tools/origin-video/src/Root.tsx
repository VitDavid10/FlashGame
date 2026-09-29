import { MOBILE_FRAMES, Mobile } from "./Mobile";
import { PerkJumper, PerkMadLads, PerkSeeker } from "./Perks";
import "./index.css";
import { Composition } from "remotion";
import { Origin, TOTAL } from "./Origin";
import { CONCEPTS, GROWTH_FRAMES, Growth, TOUR_FRAMES, Tour } from "./Concepts";
import { ACTION_FRAMES, Action } from "./Action";
import { SOCIALS_FRAMES, SOCIALS_X_FRAMES, Socials, SocialsX } from "./Socials";
import { AIRDROP_FRAMES, Airdrop } from "./Airdrop";
import { HOWTO_FRAMES, HowTo } from "./HowTo";
import { GUIDE_ALL_FRAMES, GuideAll, GuidePost, POSTS, postFrames } from "./Guide";
import { H, W } from "./ui";
import { COUNTRY_SKINS_FRAMES, CountrySkins } from "./CountrySkins";
import { CHAOS_FRAMES, Chaos } from "./Chaos";

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
      <Composition id="SocialsX" component={SocialsX} durationInFrames={SOCIALS_X_FRAMES} fps={30} width={W} height={H} />
      {/* 15 s $PILLY airdrop announcement: 10% of the supply, who gets it, value vs FDV. */}
      <Composition id="Airdrop" component={Airdrop} durationInFrames={AIRDROP_FRAMES} fps={30} width={W} height={H} />
      {/* Narrated how-to: connect X, wallet (or paste it), boost quests, Daily Arena, THE GAME tab. */}
      <Composition id="HowTo" component={HowTo} durationInFrames={HOWTO_FRAMES} fps={30} width={W} height={H} />
      {/* "How to play" thread: one post per mechanic (Guide-move, Guide-hide, ...). */}
      {POSTS.map((p) => (
        <Composition key={p.id} id={"Guide-" + p.id} component={GuidePost} defaultProps={{ id: p.id }} durationInFrames={postFrames(p)} fps={30} width={W} height={H} />
      ))}
      {/* The whole thread in one video, with its intro. */}
      <Composition id="Guide-all" component={GuideAll} durationInFrames={GUIDE_ALL_FRAMES} fps={30} width={W} height={H} />
      {/* Holder perks of the Genesis Drop, one still per tweet. */}
      {/* "Coming to Saga & Seeker": gameplay recorded on the phone. */}
      <Composition id="Mobile" component={Mobile} durationInFrames={MOBILE_FRAMES} fps={30} width={W} height={H} />
      {/* 8 s: 12 country skins over their flags, then "UP TO 32 COUNTRY SKINS". */}
      <Composition id="CountrySkins" component={CountrySkins} durationInFrames={COUNTRY_SKINS_FRAMES} fps={30} width={W} height={H} />
      {/* ~29 s of frantic gameplay on a reworked song: skills, escapes, kills that take money. */}
      <Composition id="Chaos" component={Chaos} durationInFrames={CHAOS_FRAMES} fps={30} width={W} height={H} />
      <Composition id="Perk-seeker" component={PerkSeeker} durationInFrames={1} fps={30} width={W} height={H} />
      <Composition id="Perk-madlads" component={PerkMadLads} durationInFrames={1} fps={30} width={W} height={H} />
      <Composition id="Perk-jumper" component={PerkJumper} durationInFrames={1} fps={30} width={W} height={H} />
      {/* Posters for the posts, one still each (see src/Concepts.tsx). */}
      {CONCEPTS.map(([id, C]) => (
        <Composition key={id} id={id} component={C} durationInFrames={1} fps={30} width={W} height={H} />
      ))}
    </>
  );
};
