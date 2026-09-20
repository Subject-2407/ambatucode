import { describe, expect, it } from "vitest";
import {
  BACKDROP_HEIGHT,
  BACKDROP_WIDTH,
  SCENERY_ACCENT_INK,
  SCENERY_IDLE,
  SCENERY_PLAN,
  propExtent,
  type BackdropVariant,
} from "./scenery-plan";
import { SCENERY_NAMES } from "./scenery-sprites";

const VARIANTS = Object.keys(SCENERY_PLAN) as BackdropVariant[];

/**
 * The plan is hand-written coordinates, which makes it exactly the kind of
 * thing that drifts: a scale bumped from 1 to 2 pushes a prop off the frame,
 * and nobody notices until the object is simply missing from a page they were
 * not looking at.
 */

describe("scenery plan", () => {
  it("keeps every prop inside the frame it is drawn in", () => {
    for (const variant of VARIANTS) {
      for (const prop of SCENERY_PLAN[variant]) {
        const { right, bottom } = propExtent(prop);
        expect(prop.x, `${variant} ${prop.name}`).toBeGreaterThanOrEqual(0);
        expect(prop.y, `${variant} ${prop.name}`).toBeGreaterThanOrEqual(0);
        expect(right, `${variant} ${prop.name} right`).toBeLessThanOrEqual(BACKDROP_WIDTH);
        expect(bottom, `${variant} ${prop.name} bottom`).toBeLessThanOrEqual(BACKDROP_HEIGHT);
      }
    }
  });

  it("leaves the middle of the frame clear for the page content", () => {
    // The band the sign-in form, the page title and the first card land in.
    // A prop here is not decoration, it is something behind the text.
    const KEEP_OUT = { left: 150, right: 330, top: 56, bottom: 200 };

    for (const variant of VARIANTS) {
      for (const prop of SCENERY_PLAN[variant]) {
        const { right, bottom } = propExtent(prop);
        const overlaps =
          right > KEEP_OUT.left &&
          prop.x < KEEP_OUT.right &&
          bottom > KEEP_OUT.top &&
          prop.y < KEEP_OUT.bottom;
        expect(overlaps, `${variant} ${prop.name} at ${prop.x},${prop.y}`).toBe(false);
      }
    }
  });

  it("gives every page a populated, distinct cast", () => {
    const casts = new Set<string>();

    for (const variant of VARIANTS) {
      const props = SCENERY_PLAN[variant];
      // Low density, on purpose: enough to fill the margins, few enough that
      // the background never competes with the content. Ten or more props per
      // variant turned every screen margin into a shelf of objects.
      expect(props.length, variant).toBeGreaterThanOrEqual(4);
      expect(props.length, variant).toBeLessThanOrEqual(8);

      const names = [...new Set(props.map((prop) => prop.name))];
      expect(names.length, variant).toBeGreaterThanOrEqual(5);
      casts.add(names.sort().join(","));
    }

    // Four variants exist so that four pages do not look alike.
    expect(casts.size).toBe(VARIANTS.length);
  });

  it("varies the inks, so no screen's margins are one flat colour", () => {
    for (const variant of VARIANTS) {
      const inks = new Set(SCENERY_PLAN[variant].map((prop) => prop.ink));
      // The whole layer was drawn in `edge` once, which on the bone ground is
      // a near-black relief in every corner of every page.
      expect(inks.size, variant).toBeGreaterThanOrEqual(4);
    }
  });

  it("gives every ink a lit companion that is not itself", () => {
    for (const [ink, companion] of Object.entries(SCENERY_ACCENT_INK)) {
      // A screen, an eye, or a thruster in the body's own colour is a hole in
      // the shape rather than a lit part of it.
      expect(companion, ink).not.toBe(ink);
    }
  });

  it("scales every prop by a step that keeps the cells square", () => {
    for (const variant of VARIANTS) {
      for (const prop of SCENERY_PLAN[variant]) {
        expect((prop.scale * 2) % 1, `${variant} ${prop.name}`).toBe(0);
        expect(prop.scale).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("gives every motif an idle animation, so nothing sits dead on the page", () => {
    for (const name of SCENERY_NAMES) {
      const idle = SCENERY_IDLE[name];
      expect(idle, name).toBeDefined();
      expect(idle.accent.seconds, name).toBeGreaterThan(0);
      if (idle.body) expect(idle.body.seconds, name).toBeGreaterThan(0);
    }
  });

  it("staggers the idle cycles so the props never beat in unison", () => {
    const periods = SCENERY_NAMES.map((name) => SCENERY_IDLE[name].accent.seconds);
    // Identical periods across many objects is what turns a set of them back
    // into one animation.
    expect(new Set(periods).size).toBeGreaterThanOrEqual(periods.length - 2);
  });
});
