import { defaultConfig } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";
import {
  PIXEL,
  PIXEL_PRESS,
  UNFILLED_VARIANTS,
  pixelDrop,
  pixelEdge,
  pixelFocusRing,
  pixelNotch,
} from "./pixel";

describe("pixelNotch", () => {
  it("bites a square out of all four corners", () => {
    const notch = pixelNotch();
    // Five points per corner: the notch is a corner cut in two steps, not one
    // diagonal. A 12-point result would mean mitred corners had crept back in.
    const points = notch.slice("polygon(".length, -1).split(",");
    expect(points).toHaveLength(20);
  });

  it("scales every coordinate with the unit", () => {
    expect(pixelNotch(2)).toContain("2px");
    expect(pixelNotch(2)).toContain("4px");
    expect(pixelNotch(8)).toContain("8px");
    expect(pixelNotch(8)).toContain("16px");
  });

  it("measures the far edges from the element, not from a fixed width", () => {
    // A frame is any size, so the trailing coordinates have to be relative.
    expect(pixelNotch()).toContain("calc(100% - 4px)");
    expect(pixelNotch()).toContain("calc(100% - 8px)");
  });

  it("emits a polygon CSS can parse, with no stray whitespace at the ends", () => {
    const notch = pixelNotch();
    expect(notch.startsWith("polygon(0 ")).toBe(true);
    expect(notch.endsWith(")")).toBe(true);
    expect(notch).not.toMatch(/\(\s|\s\)/);
  });
});

describe("pixelEdge", () => {
  it("draws the border on all four sides", () => {
    const edge = pixelEdge("red");
    expect(edge.split(",")).toHaveLength(4);
    expect(edge).toContain("0 -4px 0 red");
    expect(edge).toContain("0 4px 0 red");
    expect(edge).toContain("-4px 0 0 red");
    expect(edge).toContain("4px 0 0 red");
  });

  it("carries no blur radius", () => {
    // Every value is an offset or a spread. A blur would imply a light source,
    // and nothing in this treatment has one.
    expect(pixelEdge("red")).not.toMatch(/\d+px\s+\d+px\s+[1-9]/);
  });
});

describe("pixelDrop", () => {
  it("is a filter, not a box-shadow", () => {
    // clip-path clips a box-shadow away; a filter applies after the clip, so
    // the shadow follows the notched silhouette instead of vanishing.
    expect(pixelDrop("black")).toBe("drop-shadow(4px 4px 0 black)");
  });

  it("offsets by the grid unit by default", () => {
    expect(pixelDrop("black")).toContain(`${PIXEL}px ${PIXEL}px`);
    expect(pixelDrop("black", 8)).toContain("8px 8px");
  });
});

describe("pixelFocusRing", () => {
  it("draws inside the box, because a notch clips anything outside it", () => {
    // This is the whole reason the helper exists. `clip-path` cuts away both
    // `outline` and an outer `box-shadow`, so a focus indicator drawn the usual
    // way leaves a keyboard user with nothing at all on every notched control.
    const ring = pixelFocusRing("red");
    expect(ring.startsWith("inset ")).toBe(true);
    expect(ring).toContain("red");
  });

  it("carries no blur, and sits a step inside the pixel unit", () => {
    expect(pixelFocusRing("red")).toBe(`inset 0 0 0 ${PIXEL - 1}px red`);
    expect(pixelFocusRing("red", 2)).toBe("inset 0 0 0 2px red");
  });

  it("accepts a CSS variable, so it can follow the theme", () => {
    expect(pixelFocusRing("var(--amb-colors-accent-solid)")).toContain(
      "var(--amb-colors-accent-solid)",
    );
  });
});

describe("PIXEL_PRESS", () => {
  it("travels exactly as far as the shadow it replaces", () => {
    // The pressed control must land where its shadow was, or the button
    // appears to slide rather than sit down.
    expect(PIXEL_PRESS).toBe(`translate(${PIXEL}px, ${PIXEL}px)`);
  });
});

describe("UNFILLED_VARIANTS", () => {
  // The variants `Button` leaves flat, and so never shadows.
  const FLAT = new Set(["ghost", "plain"]);

  function recipeVariants(): Record<string, Record<string, unknown>> {
    const recipes: unknown = defaultConfig.theme?.recipes;
    const button = (recipes as Record<string, unknown> | undefined)?.button;
    const variants = (button as { variants?: { variant?: unknown } } | undefined)?.variants;
    return (variants?.variant ?? {}) as Record<string, Record<string, unknown>>;
  }

  it("names every shadowed variant the recipe leaves without a fill", () => {
    // A shadow is cast by whatever the element paints. With no fill that is
    // the letters, which then read as doubled. If Chakra adds a transparent
    // variant, or one of ours loses its background, this is where it shows up
    // rather than on a screen.
    const unfilled = Object.entries(recipeVariants())
      .filter(([name]) => !FLAT.has(name))
      .filter(([, style]) => style.bg === undefined || style.bg === "transparent")
      .map(([name]) => name);

    expect(unfilled.length).toBeGreaterThan(0);
    for (const name of unfilled) {
      expect(UNFILLED_VARIANTS.has(name), `${name} would shadow its own letters`).toBe(true);
    }
  });

  it("does not list a variant that is flat or already filled", () => {
    const variants = recipeVariants();
    for (const name of UNFILLED_VARIANTS) {
      expect(FLAT.has(name)).toBe(false);
      expect(variants[name]?.bg === undefined || variants[name]?.bg === "transparent").toBe(true);
    }
  });
});
