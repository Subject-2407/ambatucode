import { defineTokens } from "@chakra-ui/react";

/**
 * Tonal ramps generated from the four brand seeds by holding hue constant in
 * OKLCH and stepping lightness, so every ramp is perceptually even and behaves
 * the same way in light and dark. The stop nearest each seed is pinned to the
 * exact seed value, marked below — those four hexes are the brand, everything
 * else is derived from them.
 *
 * `success` and `warning` have no seed: the SRS requires a full status set, so
 * `moss` is built at a hue adjacent to `lagoon` and `amber` at the usual
 * caution hue. They are derived the same way and belong to the same family.
 *
 * Components never reference these directly. Semantic tokens do that, and
 * components reference the semantic layer — see `./semantic-tokens.ts`.
 */
export const colors = defineTokens.colors({
  // Neutral, carried at the brand hue with almost no chroma so a plain surface
  // still reads as part of the same family instead of a foreign grey.
  gray: {
    50: { value: "#f5f6f7" },
    100: { value: "#eaeaed" },
    200: { value: "#d6d6db" },
    300: { value: "#bebfc5" },
    400: { value: "#a4a5ad" },
    500: { value: "#8b8d96" },
    600: { value: "#74767e" },
    700: { value: "#5d5f66" },
    800: { value: "#47484e" },
    900: { value: "#323337" },
    950: { value: "#1d1d20" },
  },

  // primary seed #282D4F — pinned at 900.
  brand: {
    50: { value: "#f4f5fc" },
    100: { value: "#e7eaf6" },
    200: { value: "#d1d6ea" },
    300: { value: "#b8beda" },
    400: { value: "#9ca4c7" },
    500: { value: "#838bb4" },
    600: { value: "#6c749a" },
    700: { value: "#575d7e" },
    800: { value: "#424761" },
    900: { value: "#282d4f" },
    950: { value: "#1a1c29" },
  },

  // secondary seed #23103A — pinned at 950.
  plum: {
    50: { value: "#f7f4fc" },
    100: { value: "#ede8f6" },
    200: { value: "#dad2eb" },
    300: { value: "#c5b8dc" },
    400: { value: "#ad9cca" },
    500: { value: "#9683b6" },
    600: { value: "#7e6c9c" },
    700: { value: "#665680" },
    800: { value: "#4e4163" },
    900: { value: "#372e46" },
    950: { value: "#23103a" },
  },

  // tertiary 1 seed #A1202B — pinned at 700, the danger solid.
  crimson: {
    50: { value: "#fff0ef" },
    100: { value: "#ffe0de" },
    200: { value: "#ffc4c1" },
    300: { value: "#fea3a0" },
    400: { value: "#f17f7c" },
    500: { value: "#e05d5e" },
    600: { value: "#c34548" },
    700: { value: "#a1202b" },
    800: { value: "#7d2629" },
    900: { value: "#591b1d" },
    950: { value: "#360d0e" },
  },

  // tertiary 2 seed #539191 — pinned at 500, the info solid.
  lagoon: {
    50: { value: "#eff8f8" },
    100: { value: "#deeeee" },
    200: { value: "#c2dddd" },
    300: { value: "#a1c9c8" },
    400: { value: "#7db1b1" },
    500: { value: "#539191" },
    600: { value: "#458282" },
    700: { value: "#346969" },
    800: { value: "#265151" },
    900: { value: "#1b3939" },
    950: { value: "#0d2121" },
  },

  // Derived: success. Kept a clear hue away from `lagoon` so a passing test and
  // an informational status are never mistaken for one another.
  moss: {
    50: { value: "#eff9f1" },
    100: { value: "#ddf0e1" },
    200: { value: "#c0e1c7" },
    300: { value: "#9dcea9" },
    400: { value: "#77b788" },
    500: { value: "#55a16c" },
    600: { value: "#3e8856" },
    700: { value: "#2d6f43" },
    800: { value: "#205532" },
    900: { value: "#173c23" },
    950: { value: "#0b2313" },
  },

  // Derived: warning.
  amber: {
    50: { value: "#fef4e8" },
    100: { value: "#fae7d1" },
    200: { value: "#f1d1aa" },
    300: { value: "#e5b67c" },
    400: { value: "#d49948" },
    500: { value: "#c17d00" },
    600: { value: "#a66600" },
    700: { value: "#895100" },
    800: { value: "#6a3d00" },
    900: { value: "#4b2b00" },
    950: { value: "#2d1800" },
  },
});
