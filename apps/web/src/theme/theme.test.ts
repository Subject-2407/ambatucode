import { describe, expect, it } from "vitest";
import { system } from "./index";

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

  it("keeps every text colour at 4.5:1 on every background, in both themes", () => {
    const text = ["fg.default", "fg.muted", "fg.subtle"];
    const backgrounds = ["bg.canvas", "bg.surface", "bg.subtle", "bg.muted"];

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

  it("uses no webfont, so the UI renders identically offline", () => {
    const body = String(system.token("fonts.body"));
    expect(body).toContain("system-ui");
    expect(body).not.toMatch(/Inter|url\(/i);
  });
});
