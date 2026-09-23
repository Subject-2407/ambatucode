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
      // Firefox. Both properties inherit, so setting them once on the root
      // covers every scrolling box in the app without a selector per panel.
      scrollbarWidth: "thin",
      // The track is the second value, and it is transparent: a scrolling panel
      // here sits on whatever surface it was placed on, and a painted gutter
      // drew a grey stripe down the side of every one of them.
      scrollbarColor: "var(--amb-colors-border-default) transparent",
    },
    body: {
      minHeight: "100dvh",
    },
    /**
     * Scrollbars, drawn like everything else here.
     *
     * The platform's own are rounded and translucent — two things this
     * treatment is not. A page of hard square edges with a rounded grey pill
     * down the side looked like two products.
     *
     * The thumb is all there is. A painted track drew a grey stripe down the
     * side of every scrolling panel in the app, none of which shares one
     * background, so there is no longer a track to paint.
     *
     * 12px is three grid units. The thumb is inset by a unit rather than given
     * a margin, because a WebKit thumb cannot take one; a transparent border
     * with the background clipped out of it is how a gap is drawn there.
     *
     * Monaco paints its own scrollbars as ordinary elements and is unaffected,
     * which is correct — an editor's gutter is its own furniture.
     */
    "*::-webkit-scrollbar": {
      width: `${PIXEL * 3}px`,
      height: `${PIXEL * 3}px`,
    },
    "*::-webkit-scrollbar-track": {
      background: "transparent",
    },
    "*::-webkit-scrollbar-thumb": {
      background: "var(--amb-colors-border-default)",
      borderWidth: `${PIXEL - 1}px`,
      borderStyle: "solid",
      borderColor: "transparent",
      // The inset used to be drawn in track colour. With no track left to
      // borrow a colour from, the gap is a transparent border the background
      // is clipped out of instead.
      backgroundClip: "padding-box",
      borderRadius: "0",
    },
    "*::-webkit-scrollbar-thumb:hover": {
      background: "var(--amb-colors-accent-solid)",
    },
    // Where a horizontal and a vertical bar meet. Left alone it is white,
    // which is the one square of chrome a transparent track cannot hide.
    "*::-webkit-scrollbar-corner": {
      background: "transparent",
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
      /**
       * A packet crossing a trace. The distance is read from a custom property
       * so one keyframe serves every wire length in every ornament.
       *
       * Only `transform` and `opacity` change, which the compositor handles
       * without touching layout or paint — the whole point, on a machine where
       * a background must not cost anything an assessment might need.
       */
      packetTravel: {
        "0%": { transform: "translateX(0)", opacity: "0" },
        "8%": { opacity: "1" },
        "88%": { opacity: "1" },
        "100%": { transform: "translateX(var(--packet-distance, 200px))", opacity: "0" },
      },
      /**
       * A cell waking up once per cycle. It is dark for most of the duration,
       * so a grid of these reads as occasional activity rather than a
       * flickering field — and with long durations almost nothing is animating
       * on any given frame.
       */
      cellFlash: {
        "0%, 90%, 100%": { opacity: "0" },
        "93%, 97%": { opacity: "1" },
      },
      /**
       * The inverse of `cellFlash`: lit almost all the time, dark for an
       * instant. A screen or an eye that is off most of the cycle reads as
       * broken, where one that blinks reads as alive.
       */
      eyeBlink: {
        "0%, 93%, 100%": { opacity: "1" },
        "95%, 97%": { opacity: "0" },
      },
      /**
       * Idle motion for the scenery props. Every displacement is a whole
       * multiple of the 4px unit and every step is a jump rather than a glide —
       * a pixel object that slides through fractional positions is the one
       * thing on screen not drawn on the grid, and it shows.
       */
      spriteBob: {
        "0%, 100%": { transform: "translateY(0)" },
        "50%": { transform: "translateY(-4px)" },
      },
      spriteDrift: {
        "0%, 100%": { transform: "translateX(0)" },
        "25%": { transform: "translateX(4px)" },
        "50%": { transform: "translateX(8px)" },
        "75%": { transform: "translateX(4px)" },
      },
      spriteRise: {
        "0%, 100%": { transform: "translateY(0)" },
        "33%": { transform: "translateY(-4px)" },
        "66%": { transform: "translateY(-8px)" },
      },
      /** Quarter turns only. An interpolated rotation shears every cell. */
      spriteSpin: {
        "0%": { transform: "rotate(0deg)" },
        "25%": { transform: "rotate(90deg)" },
        "50%": { transform: "rotate(180deg)" },
        "75%": { transform: "rotate(270deg)" },
        "100%": { transform: "rotate(360deg)" },
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
      fontSizes: {
        // Below Chakra's smallest step, for the rail slot labels. Only the
        // display face is set this small: it is drawn on a grid and has no
        // fine detail to lose, where a sans at 9px would just be a smudge.
        "3xs": { value: "0.5625rem" },
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
      /**
       * The third voice: machine-written strings a person reads but never
       * composes — timestamps, counts, identifiers, scores, file paths.
       *
       * Monospace because those things line up and get compared, and because
       * the stack is already the one the editor uses, so a path in a panel and
       * the same path in Monaco look like the same path. It is not the display
       * face: a pixel face would make an eight-digit identifier a puzzle.
       */
      data: {
        value: {
          fontFamily: "mono",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.01em",
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
