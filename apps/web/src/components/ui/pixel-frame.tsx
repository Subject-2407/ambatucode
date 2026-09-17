import { forwardRef } from "react";
import { Box, type BoxProps } from "@chakra-ui/react";
import { PIXEL, pixelNotch } from "@/theme/pixel";

/**
 * The bordered box, drawn the way a box is drawn on a pixel grid: a hard edge
 * with a square bitten out of each corner.
 *
 * It replaces the `borderWidth` + `borderRadius` + `bg` trio that every panel
 * used to repeat. Two nested layers rather than a CSS border, because a border
 * mitres its corners and this one must not — the outer layer is the edge colour
 * and the inner one is the fill, both notched.
 *
 * Reach for it wherever a surface needs to read as a separate object: cards,
 * dialogs, panels, the frame around authored content. A plain `Box` is still
 * right for grouping that needs no edge at all — see `Not everything is a
 * card`: spending an edge on every block flattens the hierarchy it is meant to
 * create.
 */

export type PixelFrameTone =
  | "default"
  | "muted"
  | "emphasized"
  | "accent"
  | "gold"
  | "success"
  | "warning"
  | "danger"
  | "info";

const TONE_EDGE: Readonly<Record<PixelFrameTone, string>> = {
  default: "border.default",
  muted: "border.muted",
  emphasized: "border.emphasized",
  accent: "accent.solid",
  gold: "gold.solid",
  success: "border.success",
  warning: "border.warning",
  danger: "border.error",
  info: "border.info",
};

// An interface extending BoxProps rather than a type intersecting it: BoxProps
// is wide enough that an intersection blows past TypeScript's union complexity
// limit, while an interface defers the work. The props that define the frame
// are applied after the caller's, so they cannot be overridden by accident.
export interface PixelFrameProps extends BoxProps {
  /** Which edge colour the frame carries. Tones are meanings, not colours. */
  tone?: PixelFrameTone;
  /**
   * The surface inside the edge. Named `surface` rather than `fill` because
   * `fill` is already an SVG presentation prop on Box, and the two would
   * silently fight.
   */
  surface?: BoxProps["bg"];
  /**
   * Thickness of the edge and of the corner bite, in pixels. The default is the
   * grid unit; 2 is for frames small enough that 4 would swallow the contents.
   */
  weight?: number;
  /**
   * Content padding, applied to the inner layer so the edge stays crisp.
   * Not `inset`, which Box already uses for CSS positioning.
   */
  pad?: BoxProps["padding"];
}

export const PixelFrame = forwardRef<HTMLDivElement, PixelFrameProps>(function PixelFrame(
  { tone = "default", surface = "bg.surface", weight = PIXEL, pad, children, ...rest },
  ref,
) {
  const notch = pixelNotch(weight);

  return (
    <Box
      ref={ref}
      {...rest}
      bg={TONE_EDGE[tone]}
      // The outer padding *is* the border, so it is not the caller's to set.
      padding={`${weight}px`}
      clipPath={notch}
      // The edge is the border; a radius on top of it would round the notch
      // back off and undo the whole point.
      borderRadius="0"
    >
      <Box bg={surface} clipPath={notch} padding={pad} height="full" width="full" minWidth="0">
        {children}
      </Box>
    </Box>
  );
});
