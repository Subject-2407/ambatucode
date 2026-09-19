import { describe, expect, it } from "vitest";
import { SCENERY, SCENERY_NAMES, SCENERY_SIZE, sceneryLayers } from "./scenery-sprites";

/**
 * A sprite is typed by hand as sixteen strings, so the failure that matters is
 * a miscounted row: one character short and every pixel after it shifts left,
 * which turns a robot into a smear and is far easier to catch here than by
 * squinting at a background.
 */

describe("scenery sprites", () => {
  it("draws every sprite on the full square grid", () => {
    for (const name of SCENERY_NAMES) {
      const rows = SCENERY[name];
      expect(rows.length, name).toBe(SCENERY_SIZE);
      rows.forEach((row, index) => {
        expect(row.length, `${name} row ${index}`).toBe(SCENERY_SIZE);
      });
    }
  });

  it("uses only the two inks and empty space", () => {
    for (const name of SCENERY_NAMES) {
      for (const row of SCENERY[name]) {
        expect(row, name).toMatch(/^[.#+]+$/);
      }
    }
  });

  it("gives every sprite a body and a lit accent to animate", () => {
    for (const name of SCENERY_NAMES) {
      const { body, accent } = sceneryLayers(name);
      // Without a body there is no object; without an accent the idle
      // animation has nothing to act on and the prop sits dead on the page.
      expect(body.length, name).toBeGreaterThan(20);
      expect(accent.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps every cell inside the grid", () => {
    for (const name of SCENERY_NAMES) {
      const { body, accent } = sceneryLayers(name);
      for (const cell of [...body, ...accent]) {
        expect(cell.x, name).toBeGreaterThanOrEqual(0);
        expect(cell.x, name).toBeLessThan(SCENERY_SIZE);
        expect(cell.y, name).toBeGreaterThanOrEqual(0);
        expect(cell.y, name).toBeLessThan(SCENERY_SIZE);
      }
    }
  });

  it("has enough motifs that a page is not one object repeated", () => {
    expect(SCENERY_NAMES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SCENERY_NAMES).size).toBe(SCENERY_NAMES.length);
  });
});
