import { describe, expect, it } from "vitest";
import { SPRITE_SIZE, SPRITES, spriteCells, type SpriteName } from "./pixel-sprites";

const NAMES = Object.keys(SPRITES) as SpriteName[];

/**
 * A malformed sprite does not throw. It renders a short row, or a stray cell
 * from a typo'd character, and nobody notices until the icon looks slightly
 * wrong at 22px in a rail. That is what these cover.
 */
describe("sprites", () => {
  it("has icons to render", () => {
    expect(NAMES.length).toBeGreaterThan(0);
  });

  it.each(NAMES)("%s is a square grid of the declared size", (name) => {
    const rows = SPRITES[name];
    expect(rows, `${name} row count`).toHaveLength(SPRITE_SIZE);
    for (const [index, row] of rows.entries()) {
      expect(row.length, `${name} row ${index}`).toBe(SPRITE_SIZE);
    }
  });

  it.each(NAMES)("%s uses only filled and empty cells", (name) => {
    for (const [index, row] of SPRITES[name].entries()) {
      expect(row, `${name} row ${index}`).toMatch(/^[.#]+$/);
    }
  });

  it.each(NAMES)("%s is a shape rather than a blank or a solid block", (name) => {
    const filled = spriteCells(name).length;
    expect(filled, `${name} is blank`).toBeGreaterThan(0);
    expect(filled, `${name} is a solid block`).toBeLessThan(SPRITE_SIZE * SPRITE_SIZE);
  });
});

describe("spriteCells", () => {
  it("returns one cell per filled character, in reading order", () => {
    const cells = spriteCells("home");
    const expected = SPRITES.home.join("").split("").filter((c) => c === "#").length;
    expect(cells).toHaveLength(expected);

    const first = cells[0];
    expect(first).toEqual({ x: 3, y: 0 });
  });

  it("keeps every cell inside the grid", () => {
    for (const name of NAMES) {
      for (const cell of spriteCells(name)) {
        expect(cell.x, name).toBeGreaterThanOrEqual(0);
        expect(cell.y, name).toBeGreaterThanOrEqual(0);
        expect(cell.x, name).toBeLessThan(SPRITE_SIZE);
        expect(cell.y, name).toBeLessThan(SPRITE_SIZE);
      }
    }
  });
});
