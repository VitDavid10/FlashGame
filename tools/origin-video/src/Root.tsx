import "./index.css";
import { Composition } from "remotion";
import { Origin, TOTAL } from "./Origin";
import { H, W } from "./ui";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition id="Origin" component={Origin} durationInFrames={TOTAL} fps={30} width={W} height={H} />
  );
};
