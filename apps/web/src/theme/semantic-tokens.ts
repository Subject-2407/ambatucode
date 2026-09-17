import { defineSemanticTokens } from "@chakra-ui/react";

/**
 * The only colour layer components are allowed to name. Every entry resolves in
 * both themes, so a component written once is correct in both — there is no
 * `_dark` conditional anywhere outside this file.
 *
 * Three vocabularies live here:
 *   - surfaces and text: `bg.*`, `fg.*`, `border.*`
 *   - colour palettes: `accent`, `secondary`, `success`, `warning`, `danger`,
 *     `info`. Each carries the full set Chakra recipes expect (`solid`, `fg`,
 *     `contrast`, `subtle`, `muted`, `emphasized`, `border`, `focusRing`), so
 *     `colorPalette="danger"` styles a Button, Badge, or Alert correctly.
 *   - `gold`, which is the same shape but is not a status. It marks earned
 *     Titles and Architect-authored content, and nothing else.
 *
 * Light mode is not a second design. It is this table read with the other
 * condition: `bone` becomes the ground where `brand` was the ground in dark,
 * and every component follows without being restyled.
 */

/**
 * Builds the eight slots a Chakra colour palette needs from one ramp.
 *
 * `dark` exists for one reason: in dark mode `bg.surface` is `brand.900`, so an
 * accent chip or an active nav item at `brand.900` would be invisible on the
 * panel it sits on. Palettes that need it step one stop lighter there; every
 * other ramp keeps the usual pairing.
 */
function palette(
  ramp: string,
  dark: { subtle: number; muted: number } = { subtle: 900, muted: 800 },
) {
  return {
    contrast: { value: { _light: "white", _dark: `{colors.${ramp}.950}` } },
    fg: { value: { _light: `{colors.${ramp}.700}`, _dark: `{colors.${ramp}.300}` } },
    subtle: { value: { _light: `{colors.${ramp}.100}`, _dark: `{colors.${ramp}.${dark.subtle}}` } },
    muted: { value: { _light: `{colors.${ramp}.200}`, _dark: `{colors.${ramp}.${dark.muted}}` } },
    emphasized: { value: { _light: `{colors.${ramp}.200}`, _dark: `{colors.${ramp}.800}` } },
    solid: { value: { _light: `{colors.${ramp}.700}`, _dark: `{colors.${ramp}.400}` } },
    focusRing: { value: { _light: `{colors.${ramp}.600}`, _dark: `{colors.${ramp}.400}` } },
    border: { value: { _light: `{colors.${ramp}.300}`, _dark: `{colors.${ramp}.700}` } },
  };
}

export const semanticColors = defineSemanticTokens.colors({
  bg: {
    // Chakra's own recipes read `bg`, `fg`, and `border` with no suffix. The
    // bare token points at ours so built-in components stay on this palette.
    DEFAULT: { value: { _light: "{colors.bone.300}", _dark: "{colors.brand.950}" } },
    // The page itself, and the darker of the two light grounds: surfaces sit on
    // top of it and are *lighter*, which is the paper-and-card relationship
    // rather than the sheet-of-white-with-a-hairline one.
    canvas: { value: { _light: "{colors.bone.300}", _dark: "{colors.brand.950}" } },
    // Cards, panels, dialogs, table bodies — anything raised off the canvas.
    surface: { value: { _light: "{colors.bone.100}", _dark: "{colors.brand.900}" } },
    subtle: { value: { _light: "{colors.bone.200}", _dark: "{colors.brand.800}" } },
    muted: { value: { _light: "{colors.bone.200}", _dark: "{colors.brand.800}" } },
    emphasized: { value: { _light: "{colors.bone.300}", _dark: "{colors.brand.700}" } },
    panel: { value: { _light: "{colors.bone.100}", _dark: "{colors.brand.900}" } },
    // Chakra's own components read these four for Alert, Field, and friends.
    // The 100 stop rather than 50: a near-white alert on a warm paper ground
    // reads as a hole punched in the page, not as a raised notice.
    success: { value: { _light: "{colors.moss.100}", _dark: "{colors.moss.950}" } },
    warning: { value: { _light: "{colors.amber.100}", _dark: "{colors.amber.950}" } },
    error: { value: { _light: "{colors.crimson.100}", _dark: "{colors.crimson.950}" } },
    info: { value: { _light: "{colors.lagoon.100}", _dark: "{colors.lagoon.950}" } },
  },

  fg: {
    DEFAULT: { value: { _light: "{colors.brand.950}", _dark: "{colors.bone.200}" } },
    default: { value: { _light: "{colors.brand.950}", _dark: "{colors.bone.200}" } },
    muted: { value: { _light: "{colors.brand.800}", _dark: "{colors.brand.300}" } },
    // The same stops as muted, and not by oversight. Subtle carries real text —
    // hints, sample-case labels, footnotes — and the next lighter stop in each
    // theme falls below 4.5:1 on the subtle and canvas backgrounds. A quieter
    // look has to come from size or weight, not from contrast nobody can read.
    subtle: { value: { _light: "{colors.brand.800}", _dark: "{colors.brand.300}" } },
    inverted: { value: { _light: "{colors.bone.100}", _dark: "{colors.brand.950}" } },
    success: { value: { _light: "{colors.moss.700}", _dark: "{colors.moss.300}" } },
    warning: { value: { _light: "{colors.amber.700}", _dark: "{colors.amber.300}" } },
    error: { value: { _light: "{colors.crimson.700}", _dark: "{colors.crimson.300}" } },
    info: { value: { _light: "{colors.lagoon.700}", _dark: "{colors.lagoon.300}" } },
  },

  border: {
    // Borders carry real weight in this design — a pixel frame is a 4px hard
    // edge, not a hairline — so the default stop is dark enough to be a line
    // you read rather than a seam you infer.
    DEFAULT: { value: { _light: "{colors.brand.800}", _dark: "{colors.brand.700}" } },
    default: { value: { _light: "{colors.brand.800}", _dark: "{colors.brand.700}" } },
    muted: { value: { _light: "{colors.bone.400}", _dark: "{colors.brand.800}" } },
    subtle: { value: { _light: "{colors.bone.300}", _dark: "{colors.brand.900}" } },
    // The selected or focused frame. Maximum edge in each theme.
    emphasized: { value: { _light: "{colors.brand.950}", _dark: "{colors.bone.200}" } },
    success: { value: { _light: "{colors.moss.700}", _dark: "{colors.moss.400}" } },
    warning: { value: { _light: "{colors.amber.700}", _dark: "{colors.amber.400}" } },
    error: { value: { _light: "{colors.crimson.700}", _dark: "{colors.crimson.400}" } },
    info: { value: { _light: "{colors.lagoon.700}", _dark: "{colors.lagoon.400}" } },
  },

  /**
   * The interactive colour, and the one palette that changes ramp between
   * themes rather than just stop.
   *
   * `brand` is a surface in dark mode — `bg.surface` is literally `brand.900` —
   * so a brand-coloured button there is a navy shape on a navy panel. Dark mode
   * hands the accent to `lagoon`, which has somewhere to go. Light mode keeps
   * the primary seed, where it is the darkest thing on the page and reads as
   * the obvious action.
   */
  accent: {
    contrast: { value: { _light: "{colors.bone.100}", _dark: "{colors.brand.950}" } },
    fg: { value: { _light: "{colors.brand.900}", _dark: "{colors.lagoon.300}" } },
    subtle: { value: { _light: "{colors.bone.400}", _dark: "{colors.lagoon.950}" } },
    muted: { value: { _light: "{colors.bone.500}", _dark: "{colors.lagoon.900}" } },
    emphasized: { value: { _light: "{colors.bone.500}", _dark: "{colors.lagoon.800}" } },
    solid: { value: { _light: "{colors.brand.900}", _dark: "{colors.lagoon.400}" } },
    focusRing: { value: { _light: "{colors.brand.800}", _dark: "{colors.lagoon.400}" } },
    border: { value: { _light: "{colors.brand.800}", _dark: "{colors.lagoon.600}" } },
  },

  /**
   * Titles, achievements, and the framing around an Interactive Block.
   *
   * `solid` is the same value in both themes on purpose. It is a *fill* with
   * `contrast` text on it — 8.8:1 either way — because the bright gold is not a
   * legible ink on any light ground. `fg` is the ink form, and only that one
   * darkens. A component that writes gold text reads `gold.fg`; one that fills
   * a shape reads `gold.solid` and puts `gold.contrast` on top.
   */
  gold: {
    contrast: { value: { _light: "{colors.brand.950}", _dark: "{colors.brand.950}" } },
    fg: { value: { _light: "{colors.gold.700}", _dark: "{colors.gold.400}" } },
    subtle: { value: { _light: "{colors.gold.100}", _dark: "{colors.gold.950}" } },
    muted: { value: { _light: "{colors.gold.200}", _dark: "{colors.gold.900}" } },
    emphasized: { value: { _light: "{colors.gold.300}", _dark: "{colors.gold.800}" } },
    solid: { value: { _light: "{colors.gold.400}", _dark: "{colors.gold.400}" } },
    focusRing: { value: { _light: "{colors.gold.600}", _dark: "{colors.gold.400}" } },
    border: { value: { _light: "{colors.gold.600}", _dark: "{colors.gold.500}" } },
  },

  secondary: palette("plum"),
  success: palette("moss"),
  warning: palette("amber"),
  danger: palette("crimson"),
  info: palette("lagoon"),
});
