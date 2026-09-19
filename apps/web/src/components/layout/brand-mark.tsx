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
      color="fg.default"
      letterSpacing={size === "hero" ? "0.12em" : "0.08em"}
      lineHeight="1"
      // Hard offset in the secondary seed — the only place the two brand
      // colours meet directly, kept from the mark it replaces.
      textShadow={size === "hero" ? "4px 4px 0 var(--amb-colors-plum-950)" : undefined}
    >
      Ambatucode
    </Text>
  );
}
