"use client";

import { forwardRef } from "react";
import {
  Button as ChakraButton,
  IconButton as ChakraIconButton,
  type ButtonProps as ChakraButtonProps,
  type IconButtonProps as ChakraIconButtonProps,
} from "@chakra-ui/react";
import { BUTTON_FACES, PIXEL, PIXEL_PRESS, pixelDrop, pixelFace } from "@/theme/pixel";

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
 * The silhouette is painted, not clipped — see `pixelFace()`. The button used
 * to clip itself to the notch, which silently removed the shadow and left the
 * outline variant's border missing on every step of every corner.
 *
 * `ghost` and `plain` opt out. A shadow means "this is a raised object you can
 * press"; a text link inside a table row is not one, and giving it a shadow
 * would flatten the difference between the two.
 */

/** Semantic tokens resolve to CSS variables, which is how `filter` can read one. */
const DROP_SHADOW = pixelDrop("var(--amb-colors-border-emphasized)");

const FLAT_VARIANTS = new Set(["ghost", "plain"]);

export type ButtonProps = ChakraButtonProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { variant, ...rest } = props;
  const name = typeof variant === "string" ? variant : "solid";
  const face = FLAT_VARIANTS.has(name) ? undefined : BUTTON_FACES[name];

  // The element's own background stays transparent in every state the recipe
  // colours: anything it painted would show through the four corner bites.
  const hover = face ? { bg: "transparent", _after: { background: face.hover } } : undefined;

  return (
    <ChakraButton
      ref={ref}
      colorPalette="accent"
      variant={variant}
      textStyle="display"
      borderRadius="0"
      {...(face ? pixelFace(face.edge, face.fill, face.weight) : undefined)}
      filter={face ? DROP_SHADOW : undefined}
      _hover={hover}
      _expanded={hover}
      /*
       * Only the colour eases. The press must not.
       *
       * A physical key is already down by the time you feel it and comes back
       * up slowly, so animating the travel inverts the sensation: the button
       * appeared to lag going down and snap coming up. `transform` and the
       * shadow are therefore excluded from the transition entirely and change
       * on the same frame as the pointer.
       */
      transition="background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out"
      _active={face ? { transform: PIXEL_PRESS, filter: "none" } : undefined}
      /*
       * A square box around the face, in the strongest ink on the page, like a
       * menu cursor. It works now that the element is not clipped. An inset
       * ring, which is what the clip forced before, vanished on a solid button
       * in light mode, whose fill is the same ink.
       */
      _focusVisible={{
        outline: `${PIXEL / 2}px solid var(--amb-colors-border-emphasized)`,
        outlineOffset: `${PIXEL}px`,
      }}
      // A disabled control is not pressable, so it should not look raised.
      _disabled={{ filter: "none", transform: "none", opacity: 0.55, cursor: "not-allowed" }}
      {...rest}
    />
  );
});

export type IconButtonProps = ChakraIconButtonProps;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return (
      <ChakraIconButton
        ref={ref}
        variant="ghost"
        colorPalette="accent"
        borderRadius="0"
        {...props}
      />
    );
  },
);
