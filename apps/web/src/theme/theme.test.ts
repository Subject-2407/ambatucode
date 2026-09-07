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
