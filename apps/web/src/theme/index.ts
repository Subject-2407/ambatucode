import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import { colors } from "./colors";
import { semanticColors } from "./semantic-tokens";
import { PIXEL } from "./pixel";

/**
 * The single design system for apps/web. Built once here and handed to
 * `ChakraProvider`; nothing else calls `createSystem`.
 *
 * Ambatucode must run fully offline, so no font is fetched from a network.
 * The body and mono stacks are the operating system's own; the display face is
 * served from `public/fonts`, which is the same origin as the page and works
 * with the network cable pulled.
 */
const SANS_STACK = [
  "system-ui",
  "-apple-system",
  "'Segoe UI'",
  "Roboto",
  "'Helvetica Neue'",
  "Arial",
  "sans-serif",
  "'Apple Color Emoji'",
  "'Segoe UI Emoji'",
].join(", ");

const MONO_STACK = [
  "'Cascadia Mono'",
  "'JetBrains Mono'",
  "'SF Mono'",
  "Menlo",
  "Consolas",
  "'Liberation Mono'",
  "monospace",
].join(", ");

/**
 * The display face. It falls back to the mono stack rather than the sans one:
 * if RasterForge fails to load, a fixed-width fallback keeps a heading's width
 * roughly where the layout expects it, where a proportional fallback would
 * reflow every title on the page.
 */
const DISPLAY_STACK = ["'RasterForge'", ...MONO_STACK.split(", ")].join(", ");

/**
 * Where the display face is served from. Relative, same origin, no network.
 *
 * The `@font-face` rule that loads it lives in `app/fonts.css`, because a
 * font-face is a document concern rather than a design token. This constant is
 * the single spelling of the path, and `theme.test.ts` checks the stylesheet
 * still points at it.
 */
export const DISPLAY_FONT_SRC = "/fonts/rasterforge.ttf";

const config = defineConfig({
  // Chakra's `.dark` class is what next-themes toggles on <html>.
  cssVarsPrefix: "amb",
  globalCss: {
    html: {
      colorPalette: "gray",
      bg: "bg.canvas",
      color: "fg.default",
    },
    body: {
      minHeight: "100dvh",
    },
    // Honoured once, here, rather than per component. Ornaments are the only
    // things in the product that animate on their own, and somebody who has
    // asked their system for stillness should not have to ask the app again.
    "*, *::before, *::after": {
      "@media (prefers-reduced-motion: reduce)": {
        animationDuration: "0.01ms !important",
        animationIterationCount: "1 !important",
        transitionDuration: "0.01ms !important",
      },
    },
    "*:focus-visible": {
      // Focus must be obvious for keyboard users; never remove it, only
      // restyle. Square rather than rounded, to match everything else.
      outline: `${PIXEL}px solid`,
      outlineColor: "accent.focusRing",
      outlineOffset: `${PIXEL}px`,
      borderRadius: "0",
    },
  },
  theme: {
    // `steps(1)` rather than a smooth fade: a pixel LED is on or off, and an
    // interpolated opacity is the one thing on screen not drawn on the grid.
    keyframes: {
      ledBlink: {
        "0%, 100%": { opacity: "1" },
        "50%": { opacity: "0.15" },
      },
      caretBlink: {
        "0%, 100%": { opacity: "1" },
        "50%": { opacity: "0" },
      },
    },
    tokens: {
      colors,
      fonts: {
        heading: { value: DISPLAY_STACK },
        body: { value: SANS_STACK },
        mono: { value: MONO_STACK },
        // Named separately so a component can ask for the pixel face without
        // having to be a heading — timers, slot labels, status chips.
        display: { value: DISPLAY_STACK },
      },
      // Every corner in the product, squared at the source.
      //
      // Zeroing only the `l1/l2/l3` aliases was not enough: those are what
      // Chakra's own recipes read, but a component that writes
      // `borderRadius="md"` reaches past them into this raw scale, and there
      // are dozens of those. Squaring the scale itself means no screen has to
      // be edited to stop being rounded.
      //
      // `full` is deliberately left alone. It is what makes a spinner a circle
      // rather than a spinning square, and it is never used for a panel.
      radii: {
        none: { value: "0" },
        "2xs": { value: "0" },
        xs: { value: "0" },
        sm: { value: "0" },
        md: { value: "0" },
        lg: { value: "0" },
        xl: { value: "0" },
        "2xl": { value: "0" },
        "3xl": { value: "0" },
        "4xl": { value: "0" },
      },
      // Spacing stays on Chakra's 4px scale, which is already the pixel grid.
      // Shadows are hard offsets with no blur: a blurred shadow is a lighting
      // model, and nothing in a pixel treatment has a light source.
      shadows: {
        raised: { value: `${PIXEL}px ${PIXEL}px 0 var(--amb-colors-border-default)` },
        overlay: { value: `${PIXEL * 2}px ${PIXEL * 2}px 0 var(--amb-colors-border-default)` },
        popover: { value: `${PIXEL * 2}px ${PIXEL * 2}px 0 var(--amb-colors-border-emphasized)` },
      },
    },
    semanticTokens: {
      colors: semanticColors,
      // Every radius is zero. A rounded corner and a pixel grid are different
      // drawing systems, and the notch in ./pixel.ts is how a corner is shaped
      // here instead. The aliases stay so no component has to be edited.
      radii: {
        l1: { value: "0" },
        l2: { value: "0" },
        l3: { value: "0" },
      },
    },
    textStyles: {
      /**
       * The pixel face, set the way it wants to be set: uppercase, letter-spaced,
       * and unsmoothed. Every heading and label in the app uses this rather than
       * naming the font family itself.
       */
      display: {
        value: {
          fontFamily: "display",
          fontWeight: "400",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          WebkitFontSmoothing: "none",
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
