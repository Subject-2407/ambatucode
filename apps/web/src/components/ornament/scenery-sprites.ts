/**
 * The pixel art scattered through the backgrounds, drawn on a 16x16 grid.
 *
 * Twice the width of the icon set in `components/ui/pixel-sprites`, and that
 * difference is the point: an 8x8 shape has to collapse to a silhouette, which
 * is right for a rail slot and wrong for scenery. At 16x16 a monitor can have
 * code on its screen and a robot can have a face, and a background made of
 * recognisable objects reads as a place rather than as noise.
 *
 * Two inks per sprite. `#` is the body, drawn in the same edge colour as every
 * other ornament so the props sit back; `+` is the accent — a lit screen, an
 * eye, a thruster — drawn in the live colour and animated on its own. Keeping
 * the lit part separate is what lets one sprite blink while its outline stays
 * put, without a second copy of the artwork.
 */

export const SCENERY_SIZE = 16;

export const SCENERY = {
  /** A CRT with code on it. The most on-the-nose object in the set, deliberately. */
  monitor: [
    "................",
    ".##############.",
    ".#............#.",
    ".#.++++.......#.",
    ".#..++++++....#.",
    ".#.++.........#.",
    ".#..+++++.....#.",
    ".#.+++........#.",
    ".#............#.",
    ".##############.",
    "......####......",
    "......####......",
    "....########....",
    "................",
    "................",
    "................",
  ],
  /** A boxy robot with antennae and a lit chest panel. */
  robot: [
    "................",
    "....#......#....",
    "....#......#....",
    "...##########...",
    "...#........#...",
    "...#.++..++.#...",
    "...#.++..++.#...",
    "...#........#...",
    "...#..####..#...",
    "...##########...",
    ".....######.....",
    "...##########...",
    "...#........#...",
    "...#..++++..#...",
    "...##########...",
    "....##....##....",
  ],
  /** A floppy disk, shutter up, label lit. */
  floppy: [
    "................",
    ".##############.",
    ".#....####....#.",
    ".#....#..#....#.",
    ".#....#..#....#.",
    ".#....####....#.",
    ".#............#.",
    ".#............#.",
    ".#.++++++++++.#.",
    ".#.+........+.#.",
    ".#.+........+.#.",
    ".#.++++++++++.#.",
    ".#............#.",
    ".##############.",
    "................",
    "................",
  ],
  /** A terminal window: title bar, a prompt, and a caret waiting. */
  terminal: [
    "................",
    ".##############.",
    ".#............#.",
    ".##############.",
    ".#............#.",
    ".#.##.........#.",
    ".#..##........#.",
    ".#.##.........#.",
    ".#............#.",
    ".#.####...++..#.",
    ".#............#.",
    ".#.###........#.",
    ".#............#.",
    ".##############.",
    "................",
    "................",
  ],
  /** A chip with its legs out and a live core. */
  chip: [
    "................",
    "....#..#..#.....",
    "....#..#..#.....",
    "..############..",
    "..#..........#..",
    "..#.++++++++.#..",
    "#.#.+......+.#.#",
    "#.#.+......+.#.#",
    "#.#.+......+.#.#",
    "..#.++++++++.#..",
    "..#..........#..",
    "..############..",
    "....#..#..#.....",
    "....#..#..#.....",
    "................",
    "................",
  ],
  /** A rocket on the way up, flame below. */
  rocket: [
    "................",
    ".......##.......",
    "......####......",
    "......#++#......",
    "......#++#......",
    ".....######.....",
    ".....#....#.....",
    ".....#....#.....",
    "....##....##....",
    "...###....###...",
    "...##########...",
    "......####......",
    "......+..+......",
    ".......++.......",
    "......+..+......",
    "................",
  ],
  /** A beetle. The one place in the product where that reading is intended. */
  bug: [
    "................",
    "..#..........#..",
    "...#........#...",
    "....########....",
    "...#++####++#...",
    "..#.########.#..",
    "..############..",
    ".#..########..#.",
    ".#.##########.#.",
    "..############..",
    "..#.########.#..",
    "...##########...",
    "....########....",
    "....#..##..#....",
    "...#........#...",
    "................",
  ],
  /** A game cartridge, label and contacts. */
  cartridge: [
    "................",
    "..############..",
    "..#..........#..",
    "..#.++++++++.#..",
    "..#.+......+.#..",
    "..#.++++++++.#..",
    "..#..........#..",
    "..############..",
    "..#..........#..",
    "..#.#.#..#.#.#..",
    "..#.#.#..#.#.#..",
    "..#..........#..",
    "..############..",
    "...##########...",
    "................",
    "................",
  ],
  /** An optical disc, catching the light at the centre. */
  disc: [
    "................",
    ".....######.....",
    "...##########...",
    "..####....####..",
    "..###......###..",
    ".####..++..####.",
    ".###..++++..###.",
    ".###..++++..###.",
    ".###..++++..###.",
    ".####..++..####.",
    "..###......###..",
    "..####....####..",
    "...##########...",
    ".....######.....",
    "................",
    "................",
  ],
  /** Coffee, steaming. Lab equipment by any honest accounting. */
  mug: [
    "....+...+...+...",
    ".....+...+...+..",
    "....+...+...+...",
    "................",
    "..##########....",
    "..#........#.##.",
    "..#.++++++.#.#.#",
    "..#.++++++.#...#",
    "..#.++++++.#.#.#",
    "..#........#.##.",
    "..#........#....",
    "..#........#....",
    "..##########....",
    "..##########....",
    "................",
    "................",
  ],
  /** A keyboard with the space bar lit. */
  keyboard: [
    "................",
    "................",
    "..############..",
    "..#..........#..",
    "..#.##.##.##.#..",
    "..#..........#..",
    "..#.##.##.##.#..",
    "..#..........#..",
    "..#..++++++..#..",
    "..#..........#..",
    "..############..",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
} as const satisfies Record<string, readonly string[]>;

export type SceneryName = keyof typeof SCENERY;

export const SCENERY_NAMES = Object.keys(SCENERY) as SceneryName[];

export type SceneryCell = { x: number; y: number };

/** A sprite split into its two inks. */
export type SceneryLayers = { body: readonly SceneryCell[]; accent: readonly SceneryCell[] };

function split(rows: readonly string[]): SceneryLayers {
  const body: SceneryCell[] = [];
  const accent: SceneryCell[] = [];

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "#") body.push({ x, y });
      if (row[x] === "+") accent.push({ x, y });
    }
  }

  return { body, accent };
}

/**
 * Split once per name at module load rather than per render: there are eleven
 * of these and a page may place a dozen, and re-walking 256 characters for
 * each one on every re-render buys nothing.
 */
const LAYERS: Record<SceneryName, SceneryLayers> = Object.fromEntries(
  SCENERY_NAMES.map((name) => [name, split(SCENERY[name])]),
) as Record<SceneryName, SceneryLayers>;

export function sceneryLayers(name: SceneryName): SceneryLayers {
  return LAYERS[name];
}
