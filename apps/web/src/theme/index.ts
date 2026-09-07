import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import { colors } from "./colors";
import { semanticColors } from "./semantic-tokens";

/**
 * The single design system for apps/web. Built once here and handed to
 * `ChakraProvider`; nothing else calls `createSystem`.
 *
 * Ambatucode must run fully offline, so every font is a system stack — no
 * webfont request, no CDN, no layout shift when the network is absent.
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
    // Focus must be obvious for keyboard users; never remove it, only restyle.
    "*:focus-visible": {
      outline: "2px solid",
      outlineColor: "accent.focusRing",
      outlineOffset: "2px",
    },
  },
  theme: {
    tokens: {
      colors,
      fonts: {
        heading: { value: SANS_STACK },
        body: { value: SANS_STACK },
        mono: { value: MONO_STACK },
      },
      // Spacing stays on Chakra's 4px scale; these are the three elevation
      // levels the design system allows. Anything deeper is a smell.
      shadows: {
        raised: { value: "0 1px 2px rgba(26, 28, 41, 0.08)" },
        overlay: { value: "0 8px 24px -8px rgba(26, 28, 41, 0.24)" },
        popover: { value: "0 16px 48px -12px rgba(26, 28, 41, 0.32)" },
      },
    },
    semanticTokens: {
      colors: semanticColors,
      radii: {
        l1: { value: "{radii.sm}" },
        l2: { value: "{radii.md}" },
        l3: { value: "{radii.lg}" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
