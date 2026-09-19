"use client";

import { forwardRef } from "react";
import {
  Button as ChakraButton,
  IconButton as ChakraIconButton,
  type ButtonProps as ChakraButtonProps,
  type IconButtonProps as ChakraIconButtonProps,
} from "@chakra-ui/react";
import { PIXEL, PIXEL_PRESS, pixelNotch } from "@/theme/pixel";

/**
 * Buttons default to the accent palette so the primary action on a screen is
 * the one you get for free. Anything else — destructive, quiet, secondary —
 * has to say so, which keeps the "one obvious primary action" rule honest.
 *
 * The pixel treatment is three things: a notched silhouette, a hard offset
 * shadow, and a press that moves the button exactly onto its own shadow. The
 * press is positional rather than a colour change, so it reads the same in both
 * themes and for anyone who cannot distinguish the hover tint.
 *
 * `ghost` and `plain` opt out. A shadow means "this is a raised object you can
 * press"; a text link inside a table row is not one, and giving it a shadow
 * would flatten the difference between the two.
 */

/** Semantic tokens resolve to CSS variables, which is how `filter` can read one. */
const DROP_SHADOW = `drop-shadow(${PIXEL}px ${PIXEL}px 0 var(--amb-colors-border-emphasized))`;

const FLAT_VARIANTS = new Set(["ghost", "plain"]);

export type ButtonProps = ChakraButtonProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { variant, ...rest } = props;
  const flat = typeof variant === "string" && FLAT_VARIANTS.has(variant);

  return (
    <ChakraButton
      ref={ref}
      colorPalette="accent"
      variant={variant}
      textStyle="display"
      borderRadius="0"
      clipPath={flat ? undefined : pixelNotch()}
      filter={flat ? undefined : DROP_SHADOW}
      transition="filter 80ms steps(2), transform 80ms steps(2)"
      _active={flat ? undefined : { transform: PIXEL_PRESS, filter: "none" }}
      // A disabled control is not pressable, so it should not look raised.
      _disabled={{ filter: "none", transform: "none", opacity: 0.55, cursor: "not-allowed" }}
      {...rest}
    />
  );
});

export type IconButtonProps = ChakraIconButtonProps;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <ChakraIconButton ref={ref} variant="ghost" colorPalette="accent" borderRadius="0" {...props} />;
  },
);
