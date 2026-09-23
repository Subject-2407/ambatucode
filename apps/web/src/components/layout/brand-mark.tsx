import { Text } from "@chakra-ui/react";

/**
 * The wordmark, set in the display face.
 *
 * It used to be a gradient tile with an "A" in it, which is a logo placeholder
 * rather than a logo. The product has a typeface now, and the name set in it is
 * the mark — so there is one thing to recognise instead of a letter and a word
 * that have nothing to do with each other.
 *
 * `display` uppercases it, so the name is written normally everywhere in the
 * source and rendered as AMBATUCODE here.
 *
 * The inks come from `mark.*` rather than `fg.default`: a logo the size of a
 * title screen in body-text black is a wall, and on the bone ground it read as
 * one. See the token's note in `theme/semantic-tokens.ts`.
 */
export function BrandMark({
  size = "md",
}: {
  /** `hero` is the title screen; `md` is the everyday one. */
  size?: "md" | "lg" | "hero";
}) {
  const fontSize = {
    md: "lg",
    lg: "2xl",
    hero: { base: "4xl", sm: "5xl", md: "6xl" },
  }[size];

  return (
    <Text
      as="span"
      textStyle="display"
      fontSize={fontSize}
      // The mark inks are a stack, and the front one is the lightest of the
      // three — legible only with the plates behind it. A wordmark small enough
      // to sit in a row of controls has no room for plates, so it is drawn in
      // the page's own ink instead of a pale one with nothing under it.
      color={size === "hero" ? "mark.ink" : "fg.default"}
      letterSpacing={size === "hero" ? "0.12em" : "0.08em"}
      lineHeight="1"
      // Two hard plates behind the ink, each one grid unit further down and
      // right. No blur at any step: this treatment has no light source, so a
      // soft shadow would be the one thing on the page pretending there is one.
      //
      // Only the hero carries them. At `md` the mark sits in a row of controls,
      // where three plates would be noise at a size too small to read them.
      textShadow={
        size === "hero"
          ? "4px 4px 0 var(--amb-colors-mark-shadow), 8px 8px 0 var(--amb-colors-mark-glow)"
          : undefined
      }
    >
      Ambatucode
    </Text>
  );
}
