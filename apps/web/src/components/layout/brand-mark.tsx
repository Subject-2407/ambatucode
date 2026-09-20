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
 * The two inks come from `mark.*` rather than `fg.default`: a logo the size of
 * a title screen in body-text black is a wall, and on the bone ground it read
 * as one. See the token's note in `theme/semantic-tokens.ts`.
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
      color="mark.ink"
      letterSpacing={size === "hero" ? "0.12em" : "0.08em"}
      lineHeight="1"
      // Hard offset in the companion ink — the only place the two brand colours
      // meet directly, kept from the mark this one replaces.
      textShadow={size === "hero" ? "4px 4px 0 var(--amb-colors-mark-shadow)" : undefined}
    >
      Ambatucode
    </Text>
  );
}
