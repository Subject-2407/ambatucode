"use client";

import { forwardRef } from "react";
import { Badge as ChakraBadge, Box, type BadgeProps as ChakraBadgeProps } from "@chakra-ui/react";
import { pixelFocusRing, pixelNotch } from "@/theme/pixel";

/**
 * `tone` is the vocabulary the rest of the app uses for status. Mapping it here
 * means a screen never names a colour, so retinting a status is a one-line
 * change in the theme rather than a search across components.
 *
 * Every badge carries a filled square as well as a colour. A Coder reading a
 * submission status, or an Architect scanning thirty participants across a lab,
 * should not have to distinguish teal from green to know what happened — the
 * square gives the status a second channel that survives colour-blind viewing
 * and a washed-out projector.
 */
export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  /** Earned Titles. Never a status — see the `gold` palette. */
  | "gold";

const TONE_PALETTE: Readonly<Record<BadgeTone, string>> = {
  neutral: "gray",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  gold: "gold",
};

export type BadgeProps = Omit<ChakraBadgeProps, "colorPalette"> & {
  tone?: BadgeTone;
  /** Drops the status square, for badges that label rather than report state. */
  plain?: boolean;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", plain = false, children, ...props },
  ref,
) {
  return (
    <ChakraBadge
      ref={ref}
      colorPalette={TONE_PALETTE[tone]}
      textStyle="display"
      borderRadius="0"
      borderWidth="0"
      // The edge is drawn inside the box: a notch clips anything painted
      // outside it, so a real border would lose its own corners.
      boxShadow={pixelFocusRing("currentColor", 2)}
      clipPath={pixelNotch(2)}
      gap="1.5"
      {...props}
    >
      {plain ? null : (
        <Box as="span" aria-hidden width="1.5" height="1.5" bg="currentColor" flexShrink="0" />
      )}
      {children}
    </ChakraBadge>
  );
});
