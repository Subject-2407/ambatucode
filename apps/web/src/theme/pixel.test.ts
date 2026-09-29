import { defaultConfig } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";
import {
  BUTTON_FACES,
  PIXEL,
  PIXEL_PRESS,
  pixelDrop,
  pixelEdge,
  pixelFace,
  pixelFieldPaint,
  pixelFocusRing,
  pixelNotch,
  pixelSkin,
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

describe("pixelSkin", () => {
  it("paints the edge as the background and the fill as a layer over it", () => {
    const skin = pixelSkin("red", "blue", 2);
    expect(skin.background).toBe("red");
    expect(skin._before.background).toBe("blue");
    // Inset by exactly the edge thickness: that inset *is* the border.
    expect(skin._before.inset).toBe("2px");
  });

  it("notches both layers, so every step of the corner carries the edge", () => {
    // The bug this replaces: an inset box-shadow is drawn along the border
    // box, and the notch then clips away precisely the corners where it turns.
    const skin = pixelSkin("red", "blue", 2);
    expect(skin.clipPath).toBe(pixelNotch(2));
    expect(skin._before.clipPath).toBe(pixelNotch(2));
  });

  it("isolates, so the fill layer cannot escape behind an ancestor", () => {
    // `z-index: -1` is relative to the nearest stacking context. Without one of
    // its own, the fill slides behind whatever ancestor forms it and the
    // element renders as a solid block of edge colour.
    const skin = pixelSkin("red", "blue");
    expect(skin.isolation).toBe("isolate");
    expect(skin._before.zIndex).toBe(-1);
  });

  it("defaults to the grid unit", () => {
    expect(pixelSkin("red", "blue")._before.inset).toBe(`${PIXEL}px`);
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
    // A filter follows the shape the element paints, so the shadow gets the
    // notch's stair-stepped corners. It must sit on an unclipped element:
    // filters run before clipping, and a notch on the same element cuts the
    // shadow off with the corners.
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

describe("pixelFace", () => {
  it("leaves the element itself unclipped, so its drop shadow survives", () => {
    // The fault this replaces: a filter runs before clipping, so a button
    // clipped to the notch had its shadow cut away along with the corners.
    const face = pixelFace("red", "blue");
    expect(face).not.toHaveProperty("clipPath");
    expect(face.bg).toBe("transparent");
  });

  it("paints the edge and the fill as two notched layers", () => {
    const face = pixelFace("red", "blue", 2);
    expect(face._before.background).toBe("red");
    expect(face._after.background).toBe("blue");
    expect(face._before.clipPath).toBe(pixelNotch());
    expect(face._after.clipPath).toBe(pixelNotch());
    // The fill is inset by the edge weight: that inset is the border, the
    // same thickness on every step of the corner.
    expect(face._before.inset).toBe("0");
    expect(face._after.inset).toBe("2px");
  });

  it("keeps both layers behind the label", () => {
    const face = pixelFace("red", "blue");
    expect(face.isolation).toBe("isolate");
    expect(face._before.zIndex).toBe(-1);
    expect(face._after.zIndex).toBe(-1);
  });
});

describe("BUTTON_FACES", () => {
  // The variants `Button` leaves flat, and so gives no face and no shadow.
  const FLAT = new Set(["ghost", "plain"]);

  function recipeVariants(): Record<string, Record<string, unknown>> {
    const recipes: unknown = defaultConfig.theme?.recipes;
    const button = (recipes as Record<string, unknown> | undefined)?.button;
    const variants = (button as { variants?: { variant?: unknown } } | undefined)?.variants;
    return (variants?.variant ?? {}) as Record<string, Record<string, unknown>>;
  }

  it("has a face for every raised variant the recipe defines", () => {
    // A variant with no entry would render with no fill at all, and its shadow
    // would be cast by the letters alone. If Chakra adds a variant, this is
    // where it shows up rather than on a screen.
    const raised = Object.keys(recipeVariants()).filter((name) => !FLAT.has(name));
    expect(raised.length).toBeGreaterThan(0);
    for (const name of raised) {
      expect(BUTTON_FACES[name], `${name} has no face`).toBeDefined();
    }
  });

  it("gives no face to a flat variant", () => {
    for (const name of FLAT) expect(BUTTON_FACES[name]).toBeUndefined();
  });

  it("gives the outline a visible edge distinct from its fill", () => {
    const outline = BUTTON_FACES.outline;
    expect(outline?.weight).toBeGreaterThan(0);
    expect(outline?.edge).not.toBe(outline?.fill);
  });

  it("never hovers into a translucent fill the shadow would show through", () => {
    for (const [name, face] of Object.entries(BUTTON_FACES)) {
      expect(face.hover, name).not.toMatch(/\/\d/);
    }
  });
});

describe("pixelFieldPaint", () => {
  it("paints the edge as the ground colour and the fill as three bands", () => {
    const paint = pixelFieldPaint("red", "blue", 2);
    expect(paint.backgroundColor).toBe("red");
    expect(paint.backgroundImage.split("linear-gradient(blue, blue)")).toHaveLength(4);
    expect(paint.backgroundRepeat).toBe("no-repeat");
  });

  it("insets the bands so their union is the notch, one edge-weight in", () => {
    // Offsets for a 2px edge on the 4px notch: the long band, the middle step,
    // and the tall band. Anything else leaves a corner step without ink.
    const paint = pixelFieldPaint("red", "blue", 2);
    expect(paint.backgroundPosition).toBe("2px 10px, 6px 6px, 10px 2px");
    expect(paint.backgroundSize).toBe(
      "calc(100% - 4px) calc(100% - 20px), calc(100% - 12px) calc(100% - 12px), calc(100% - 20px) calc(100% - 4px)",
    );
  });

  it("thickens from the inside when the weight grows", () => {
    expect(pixelFieldPaint("red", "blue", PIXEL).backgroundPosition).toBe(
      "4px 12px, 8px 8px, 12px 4px",
    );
  });
});
