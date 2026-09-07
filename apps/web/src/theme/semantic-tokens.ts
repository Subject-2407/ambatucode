import { defineSemanticTokens } from "@chakra-ui/react";

/**
 * The only colour layer components are allowed to name. Every entry resolves in
 * both themes, so a component written once is correct in both — there is no
 * `_dark` conditional anywhere outside this file.
 *
 * Two vocabularies live here:
 *   - surfaces and text: `bg.*`, `fg.*`, `border.*`
 *   - colour palettes: `accent`, `secondary`, `success`, `warning`, `danger`,
 *     `info`. Each carries the full set Chakra recipes expect (`solid`, `fg`,
 *     `contrast`, `subtle`, `muted`, `emphasized`, `border`, `focusRing`), so
 *     `colorPalette="danger"` styles a Button, Badge, or Alert correctly.
 */

/**
 * Builds the eight slots a Chakra colour palette needs from one ramp.
 *
 * `dark` exists for one reason: in dark mode `bg.surface` is `brand.900`, so an
 * accent chip or an active nav item at `brand.900` would be invisible on the
 * panel it sits on. The accent palette steps one stop lighter there; every
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
    DEFAULT: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
    // The page itself. Tinted rather than pure white so a surface can sit on
    // top of it without a border doing all the work.
    canvas: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
    // Cards, panels, dialogs, table bodies — anything raised off the canvas.
    surface: { value: { _light: "{colors.white}", _dark: "{colors.brand.900}" } },
    subtle: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.800}" } },
    muted: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.800}" } },
    emphasized: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.700}" } },
    panel: { value: { _light: "{colors.white}", _dark: "{colors.brand.900}" } },
    // Chakra's own components read these four for Alert, Field, and friends.
    success: { value: { _light: "{colors.moss.50}", _dark: "{colors.moss.950}" } },
    warning: { value: { _light: "{colors.amber.50}", _dark: "{colors.amber.950}" } },
    error: { value: { _light: "{colors.crimson.50}", _dark: "{colors.crimson.950}" } },
    info: { value: { _light: "{colors.lagoon.50}", _dark: "{colors.lagoon.950}" } },
  },

  fg: {
    DEFAULT: { value: { _light: "{colors.brand.950}", _dark: "{colors.brand.50}" } },
    default: { value: { _light: "{colors.brand.950}", _dark: "{colors.brand.50}" } },
    muted: { value: { _light: "{colors.brand.700}", _dark: "{colors.brand.300}" } },
    subtle: { value: { _light: "{colors.brand.600}", _dark: "{colors.brand.400}" } },
    inverted: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
    success: { value: { _light: "{colors.moss.700}", _dark: "{colors.moss.300}" } },
    warning: { value: { _light: "{colors.amber.700}", _dark: "{colors.amber.300}" } },
    error: { value: { _light: "{colors.crimson.700}", _dark: "{colors.crimson.300}" } },
    info: { value: { _light: "{colors.lagoon.700}", _dark: "{colors.lagoon.300}" } },
  },

  border: {
    DEFAULT: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.800}" } },
    default: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.800}" } },
    muted: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.900}" } },
    subtle: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
    emphasized: { value: { _light: "{colors.brand.300}", _dark: "{colors.brand.700}" } },
    success: { value: { _light: "{colors.moss.500}", _dark: "{colors.moss.400}" } },
    warning: { value: { _light: "{colors.amber.500}", _dark: "{colors.amber.400}" } },
    error: { value: { _light: "{colors.crimson.500}", _dark: "{colors.crimson.400}" } },
    info: { value: { _light: "{colors.lagoon.500}", _dark: "{colors.lagoon.400}" } },
  },

  // Named palettes. `colorPalette="danger"` on any Chakra component picks up
  // the whole set below.
  accent: palette("brand", { subtle: 800, muted: 700 }),
  secondary: palette("plum"),
  success: palette("moss"),
  warning: palette("amber"),
  danger: palette("crimson"),
  info: palette("lagoon"),
});
