import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/**
 * The "Yantrix" brand mark, matching the desktop sidebar's YantrixWordmark SVG
 * (apps/web Sidebar.tsx). Width derives from the viewBox aspect ratio.
 */
export function YantrixWordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 62 / 57;
  return (
    <Svg
      accessibilityLabel="Yantrix"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="33 37 62 57"
    >
      <ThemedPath
        d="M33 37H52L64 55L76 37H95L72 71.5V94H56V71.5Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
