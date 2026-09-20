import "./index.css";
import { Composition } from "remotion";
import { Origin, TOTAL } from "./Origin";
import { CONCEPTS, GROWTH_FRAMES, Growth } from "./Concepts";
import { H, W } from "./ui";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Origin" component={Origin} durationInFrames={TOTAL} fps={30} width={W} height={H} />
      {/* The pill growing until it wears the gold crown. */}
      <Composition id="Growth" component={Growth} durationInFrames={GROWTH_FRAMES} fps={30} width={W} height={H} />
      {/* Posters for the posts, one still each (see src/Concepts.tsx). */}
      {CONCEPTS.map(([id, C]) => (
        <Composition key={id} id={id} component={C} durationInFrames={1} fps={30} width={W} height={H} />
      ))}
    </>
  );
};
