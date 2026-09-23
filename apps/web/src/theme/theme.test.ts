import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISPLAY_FONT_SRC, system } from "./index";

/**
 * The design system's contract with every component: the semantic names exist,
 * they resolve, and they resolve differently in the two themes. A token that
 * silently falls back would make a component invisible in one mode only, which
 * is exactly the bug nobody notices until an exam is running.
 */

const SURFACE_TOKENS = [
  "bg.canvas",
  "bg.surface",
  "bg.subtle",
  "fg.default",
  "fg.muted",
  "border.default",
];

const PALETTES = ["accent", "secondary", "success", "warning", "danger", "info"];
const PALETTE_SLOTS = [
  "contrast",
  "fg",
  "subtle",
  "muted",
  "emphasized",
  "solid",
  "focusRing",
  "border",
];

function tokenValue(path: string): unknown {
  return system.token(`colors.${path}`);
}

/** A semantic colour's hex value in one theme, following token references. */
function resolve(name: string, theme: "_light" | "_dark"): string {
  const token = system.tokens.getByName(`colors.${name}`);
  const raw = String(token?.extensions.conditions?.[theme] ?? "");
  const reference = /^\{colors\.(.+)\}$/.exec(raw);
  const value = reference ? String(tokenValue(reference[1] ?? "")) : raw;
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} (${theme}) resolved to ${value}`);
  return value;
}

/** WCAG 2.1 contrast ratio between two hex colours. */
function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe("theme tokens", () => {
  it("defines every surface and text token the components name", () => {
    for (const name of SURFACE_TOKENS) {
      expect(tokenValue(name), name).toBeTruthy();
    }
  });

  it("gives every palette the full slot set Chakra recipes expect", () => {
    for (const palette of PALETTES) {
      for (const slot of PALETTE_SLOTS) {
        expect(tokenValue(`${palette}.${slot}`), `${palette}.${slot}`).toBeTruthy();
      }
    }
  });

  it("resolves each semantic colour differently in light and dark", () => {
    for (const name of [...SURFACE_TOKENS, "accent.solid", "danger.solid"]) {
      const token = system.tokens.getByName(`colors.${name}`);
      expect(token, name).toBeDefined();

      const conditions = token?.extensions.conditions;
      expect(conditions, `${name} has no theme conditions`).toBeDefined();
      expect(conditions?._light, `${name} is missing a light value`).toBeTruthy();
      expect(conditions?._dark, `${name} is missing a dark value`).toBeTruthy();
      expect(conditions?._light, `${name} is identical in both themes`).not.toBe(conditions?._dark);
    }
  });

  it("steps surfaces away from the page, in the right direction per theme", () => {
    // Shipped backwards once. In light the page is the lightest thing and a
    // card is pressed into it; in dark the page is darkest and a card lifts off
    // it. There is no light source in this treatment to cast a shadow, so the
    // relationship has to be carried by the fills — and getting it inverted
    // makes every screen look subtly wrong without failing a contrast check.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((offset) => {
        const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };

    const lightCanvas = luminance(resolve("bg.canvas", "_light"));
    const lightSurface = luminance(resolve("bg.surface", "_light"));
    const lightSubtle = luminance(resolve("bg.subtle", "_light"));
    expect(lightCanvas, "light canvas must be lighter than its surfaces").toBeGreaterThan(
      lightSurface,
    );
    expect(lightSurface, "light surfaces must darken as they recede").toBeGreaterThan(lightSubtle);

    const darkCanvas = luminance(resolve("bg.canvas", "_dark"));
    const darkSurface = luminance(resolve("bg.surface", "_dark"));
    const darkSubtle = luminance(resolve("bg.subtle", "_dark"));
    expect(darkCanvas, "dark canvas must be darker than its surfaces").toBeLessThan(darkSurface);
    expect(darkSurface, "dark surfaces must lighten as they lift").toBeLessThan(darkSubtle);
  });

  it("keeps every status ink readable on every ground it can land on", () => {
    // `bg.emphasized` is the darkest light ground and the lightest dark one, so
    // it is where a status ink runs out of contrast first.
    const inks = ["fg.success", "fg.warning", "fg.error", "fg.info"];
    const backgrounds = ["bg.canvas", "bg.surface", "bg.subtle", "bg.emphasized"];

    for (const theme of ["_light", "_dark"] as const) {
      for (const ink of inks) {
        for (const background of backgrounds) {
          const ratio = contrast(resolve(ink, theme), resolve(background, theme));
          expect(ratio, `${ink} on ${background} (${theme})`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps every text colour at 4.5:1 on every background, in both themes", () => {
    const text = ["fg.default", "fg.muted", "fg.subtle"];
    const backgrounds = ["bg.canvas", "bg.surface", "bg.subtle", "bg.muted", "bg.emphasized"];

    for (const theme of ["_light", "_dark"] as const) {
      for (const foreground of text) {
        for (const background of backgrounds) {
          const ratio = contrast(resolve(foreground, theme), resolve(background, theme));
          expect(ratio, `${foreground} on ${background} (${theme})`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("carries the four brand seeds verbatim", () => {
    // These are the colours the product was given; a ramp regeneration must not
    // quietly drift off them.
    expect(tokenValue("brand.900")).toBe("#282d4f");
    expect(tokenValue("plum.950")).toBe("#23103a");
    expect(tokenValue("crimson.700")).toBe("#a1202b");
    expect(tokenValue("lagoon.500")).toBe("#539191");
  });

  it("carries the two support tints verbatim", () => {
    expect(tokenValue("bone.200")).toBe("#e8e3d3");
    expect(tokenValue("gold.400")).toBe("#e8b33c");
    expect(tokenValue("gold.700")).toBe("#7b5000");
  });

  it("gives gold the full slot set, like any other palette", () => {
    for (const slot of PALETTE_SLOTS) {
      expect(tokenValue(`gold.${slot}`), `gold.${slot}`).toBeTruthy();
    }
  });

  it("uses no webfont, so the UI renders identically offline", () => {
    const body = String(system.token("fonts.body"));
    expect(body).toContain("system-ui");
    expect(body).not.toMatch(/Inter|url\(/i);
  });

  it("serves the display face from this origin, never from a network", () => {
    expect(DISPLAY_FONT_SRC.startsWith("/")).toBe(true);
    expect(DISPLAY_FONT_SRC).not.toMatch(/^https?:|^\/\//);

    // The @font-face rule lives in a stylesheet, so the path is written twice.
    // If the two drift the headings silently fall back to the mono stack, which
    // looks deliberate enough that nobody reports it.
    const stylesheet = readFileSync(new URL("../app/fonts.css", import.meta.url), "utf8");
    expect(stylesheet).toContain(DISPLAY_FONT_SRC);
    expect(stylesheet).not.toMatch(/url\(\s*["']?https?:/i);

    // The face must also be named, or every heading silently renders in the
    // fallback and nobody notices until someone looks at a screenshot.
    expect(String(system.token("fonts.display"))).toContain("RasterForge");
    expect(String(system.token("fonts.heading"))).toContain("RasterForge");
  });

  it("rounds no corners, because a radius and a pixel grid are different systems", () => {
    for (const alias of ["l1", "l2", "l3"]) {
      // `system.token` hands back the CSS variable for a semantic token, so the
      // declared value has to be read off the token itself.
      const token = system.tokens.getByName(`radii.${alias}`);
      expect(token, alias).toBeDefined();
      expect(String(token?.value), alias).toBe("0");
    }
  });

  it("squares the raw radius scale too, not only the aliases", () => {
    // Components reach past `l1/l2/l3` and write `borderRadius="md"` directly;
    // there are dozens of those. Leaving this scale rounded left most of the
    // product with soft corners while the theme claimed otherwise.
    for (const size of ["none", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) {
      expect(String(system.token(`radii.${size}`)), size).toBe("0");
    }
  });

  it("keeps `full` round, so a spinner is not a spinning square", () => {
    expect(String(system.token("radii.full"))).not.toBe("0");
  });
});

/**
 * Gold is the one palette with a rule that a reviewer cannot see by eye, so it
 * is pinned here instead.
 *
 * The bright value is a *fill*: legible with `contrast` text on it, in both
 * themes. It is not an *ink*: as text on a light ground it measures 1.49:1,
 * nowhere near the 4.5:1 floor, which is why `gold.fg` darkens in light mode
 * and `gold.solid` does not. Collapsing the two back into one value would look
 * tidier and would make every Title unreadable on paper.
 */
describe("gold", () => {
  it("is legible as a fill in both themes", () => {
    for (const theme of ["_light", "_dark"] as const) {
      const ratio = contrast(resolve("gold.solid", theme), resolve("gold.contrast", theme));
      expect(ratio, `gold.contrast on gold.solid (${theme})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is legible as an ink in both themes, on every surface it can land on", () => {
    for (const theme of ["_light", "_dark"] as const) {
      for (const background of ["bg.surface", "bg.subtle", "bg.canvas"]) {
        const ratio = contrast(resolve("gold.fg", theme), resolve(background, theme));
        expect(ratio, `gold.fg on ${background} (${theme})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the fill and the ink as separate values where they have to differ", () => {
    // Dark mode may legitimately use one value for both — it has a dark ground
    // to sit on. Light mode may not, and that is the case worth pinning.
    expect(resolve("gold.fg", "_light")).not.toBe(resolve("gold.solid", "_light"));
  });
});

/**
 * The accent swaps ramp between themes rather than stop, which is unusual
 * enough to be mistaken for a bug and "fixed" back to one ramp.
 */
describe("accent", () => {
  it("is legible as a fill in both themes", () => {
    for (const theme of ["_light", "_dark"] as const) {
      const ratio = contrast(resolve("accent.solid", theme), resolve("accent.contrast", theme));
      expect(ratio, `accent.contrast on accent.solid (${theme})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("does not use a brand surface stop as the dark accent", () => {
    // bg.surface is brand.900 in dark mode. An accent equal to it would be a
    // navy button on a navy panel — invisible, and the reason dark mode hands
    // the accent to lagoon.
    expect(resolve("accent.solid", "_dark")).not.toBe(resolve("bg.surface", "_dark"));
    expect(resolve("accent.solid", "_light")).not.toBe(resolve("bg.surface", "_light"));
  });
});
