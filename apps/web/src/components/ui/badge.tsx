"use client";

import { forwardRef } from "react";
import { Badge as ChakraBadge, type BadgeProps as ChakraBadgeProps } from "@chakra-ui/react";

/**
 * `tone` is the vocabulary the rest of the app uses for status. Mapping it here
 * means a screen never names a colour, so retinting a status is a one-line
 * change in the theme rather than a search across components.
 */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE_PALETTE: Readonly<Record<BadgeTone, string>> = {
  neutral: "gray",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

export type BadgeProps = Omit<ChakraBadgeProps, "colorPalette"> & { tone?: BadgeTone };

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", ...props },
  ref,
) {
  return <ChakraBadge ref={ref} colorPalette={TONE_PALETTE[tone]} {...props} />;
});
