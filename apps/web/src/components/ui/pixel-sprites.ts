/**
 * The icon set, drawn on an 8×8 grid.
 *
 * Each sprite is eight strings of eight characters: `#` is a filled pixel, `.`
 * is empty. Adding an icon is adding eight lines here, not adding an asset — so
 * the set stays offline-safe, recolours with the theme, and never arrives late.
 *
 * Eight columns is the whole constraint. At 8×8 a shape has to be reduced to
 * its silhouette, which is why these read at 22px in a rail slot where a
 * detailed line icon would turn to mush.
 */

export const SPRITE_SIZE = 8;

export const SPRITES = {
  /** A house. The Coder's hub. */
  home: [
    "...##...",
    "..####..",
    ".##..##.",
    "##....##",
    "########",
    "##....##",
    "##.##.##",
    "##.##.##",
  ],
  /** Two stacked books. Modules. */
  books: [
    "........",
    "######..",
    "#....#..",
    "######..",
    ".######.",
    ".#....#.",
    ".######.",
    "........",
  ],
  /** A ruled page. Submissions, and submission history. */
  doc: [
    "########",
    "#......#",
    "#.####.#",
    "#......#",
    "#.####.#",
    "#......#",
    "#.##...#",
    "########",
  ],
  /** Ascending bars. Leaderboards. */
  bars: [
    "........",
    ".....##.",
    ".....##.",
    "..##.##.",
    "..##.##.",
    "##.##.##",
    "##.##.##",
    "########",
  ],
  /** A cup on a plinth. Earned Titles. */
  trophy: [
    "........",
    "..####..",
    "..#..#..",
    "..####..",
    "...##...",
    "..####..",
    ".######.",
    "########",
  ],
  /** Head and shoulders. Profile. */
  user: [
    "..####..",
    "..####..",
    "..####..",
    "........",
    ".######.",
    "########",
    "##.##.##",
    "##....##",
  ],
  /** Two figures. Root's global user administration. */
  users: [
    ".##..##.",
    ".##..##.",
    "........",
    "######..",
    "######..",
    "..######",
    "..######",
    "........",
  ],
  /** A clipboard. Grading records. */
  clipboard: [
    "..####..",
    ".######.",
    "########",
    "#......#",
    "#.####.#",
    "#......#",
    "#.####.#",
    "########",
  ],
  /** A power symbol. Signing out. */
  power: [
    "...##...",
    "...##...",
    ".#.##.#.",
    "#..##..#",
    "#......#",
    "#......#",
    ".#....#.",
    "..####..",
  ],
  /** A wall calendar. Assessment Sessions. */
  calendar: [
    ".#....#.",
    "########",
    "#......#",
    "#.#.#..#",
    "#......#",
    "#..#.#.#",
    "#......#",
    "########",
  ],
  /** A padlock. A Closed Module, and anything awaiting approval. */
  lock: [
    "..####..",
    ".##..##.",
    ".##..##.",
    "########",
    "##....##",
    "##.##.##",
    "##....##",
    "########",
  ],
  /** A page with angle brackets. Custom test scripts. */
  filecode: [
    "#######.",
    "#......#",
    "#.#..#.#",
    "##....##",
    "#.#..#.#",
    "#......#",
    "#......#",
    "########",
  ],
  /** A tick in a frame. An approved enrollment. */
  check: [
    "########",
    "#......#",
    "#.....##",
    "#....##.",
    "##..##.#",
    "#.####.#",
    "#..##..#",
    "########",
  ],
  /** A floppy disk. The Coder empty state: nothing saved here yet. */
  disk: [
    "########",
    "#.####.#",
    "#.####.#",
    "#......#",
    "########",
    "#..##..#",
    "#..##..#",
    "########",
  ],
  /** A chip with legs. Waiting on the server: the Live session lobby. */
  chip: [
    "..#..#..",
    ".######.",
    "##....##",
    "#.####.#",
    "#.####.#",
    "##....##",
    ".######.",
    "..#..#..",
  ],
  /** A flask. The Architect empty state: nothing to grade yet. */
  flask: [
    "..####..",
    "...##...",
    "...##...",
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
  ],
  /** A bug. The one place in the product where that is the intended reading. */
  bug: [
    "#..##..#",
    ".#####..",
    "..####..",
    ".######.",
    "#.####.#",
    "#.####.#",
    ".#....#.",
    "#......#",
  ],
} as const satisfies Record<string, readonly string[]>;

export type SpriteName = keyof typeof SPRITES;

/** The filled cells of a sprite, as grid coordinates. */
export function spriteCells(name: SpriteName): ReadonlyArray<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  const rows = SPRITES[name];

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "#") cells.push({ x, y });
    }
  }

  return cells;
}
