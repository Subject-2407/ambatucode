import { SCENERY_SIZE, type SceneryName } from "./scenery-sprites";

/**
 * Where the scenery stands, and how it idles.
 *
 * Hand-placed rather than scattered by a generator. A random layout keeps
 * dropping a robot behind the sign-in form and a monitor under the page title,
 * and the fix — reject anything near the middle — ends up being a worse, less
 * legible version of just deciding where things go. Every prop here sits in the
 * left band, the right band, or the strip along the top or bottom, which is
 * exactly the empty space this layer exists to fill.
 *
 * Coordinates are in the backdrop's own 480x260 viewBox, which is drawn with
 * `slice`, so the middle of the frame is the part guaranteed to survive on
 * every aspect ratio and the far edges are the part that may be cropped. That
 * is the right way round: losing the odd floppy disk off the side of an
 * ultrawide costs nothing.
 */

export const BACKDROP_WIDTH = 480;
export const BACKDROP_HEIGHT = 260;

export type SceneryProp = {
  name: SceneryName;
  x: number;
  y: number;
  /** Whole multiples keep the cells square; 1.5 is tolerable, 1.37 is not. */
  scale: number;
};

/**
 * The idle animation each object gets, chosen once per motif rather than per
 * placement so a floppy behaves like a floppy wherever it turns up.
 *
 * `body` moves the whole prop, accent included — the accent group is nested
 * inside it, so a robot's eyes bob with its head instead of hanging in the air
 * where its head used to be.
 */
export type SceneryIdle = {
  /** `null` where the object should stand still; not everything fidgets. */
  body: { name: string; seconds: number } | null;
  accent: { name: string; seconds: number };
};

export const SCENERY_IDLE: Record<SceneryName, SceneryIdle> = {
  // A screen is lit; it refreshes, it does not pulse.
  monitor: { body: null, accent: { name: "eyeBlink", seconds: 7 } },
  robot: { body: { name: "spriteBob", seconds: 4.5 }, accent: { name: "eyeBlink", seconds: 5.5 } },
  floppy: { body: { name: "spriteBob", seconds: 6.5 }, accent: { name: "ledBlink", seconds: 5 } },
  // The caret is the whole joke of a terminal sitting idle in a corner.
  terminal: { body: null, accent: { name: "caretBlink", seconds: 1.2 } },
  chip: { body: null, accent: { name: "ledBlink", seconds: 3.2 } },
  rocket: { body: { name: "spriteRise", seconds: 5 }, accent: { name: "ledBlink", seconds: 0.9 } },
  bug: { body: { name: "spriteDrift", seconds: 9 }, accent: { name: "eyeBlink", seconds: 4 } },
  cartridge: {
    body: { name: "spriteBob", seconds: 7.5 },
    accent: { name: "eyeBlink", seconds: 8 },
  },
  disc: { body: { name: "spriteSpin", seconds: 12 }, accent: { name: "ledBlink", seconds: 4.4 } },
  mug: { body: null, accent: { name: "ledBlink", seconds: 3.8 } },
  keyboard: { body: null, accent: { name: "cellFlash", seconds: 6 } },
};

/**
 * Each backdrop gets its own cast, so moving between screens is moving through
 * different rooms rather than past the same wallpaper. The substrate line-work
 * keeps its variant's character and the props extend it: wiring and hardware on
 * the circuit, media on the grid, a launch on the constellation, and something
 * to debug on the waveform.
 */
export const SCENERY_PLAN = {
  circuit: [
    { name: "monitor", x: 24, y: 30, scale: 2 },
    { name: "chip", x: 76, y: 100, scale: 1.5 },
    { name: "keyboard", x: 16, y: 176, scale: 2 },
    { name: "cartridge", x: 140, y: 22, scale: 1 },
    { name: "chip", x: 208, y: 14, scale: 1 },
    { name: "mug", x: 124, y: 212, scale: 1.5 },
    { name: "bug", x: 300, y: 224, scale: 1 },
    { name: "floppy", x: 392, y: 36, scale: 1.5 },
    { name: "terminal", x: 404, y: 116, scale: 2 },
    { name: "disc", x: 372, y: 204, scale: 1.5 },
  ],
  grid: [
    { name: "cartridge", x: 20, y: 44, scale: 2 },
    { name: "disc", x: 92, y: 118, scale: 1.5 },
    { name: "floppy", x: 28, y: 188, scale: 2 },
    { name: "keyboard", x: 116, y: 14, scale: 1 },
    { name: "floppy", x: 180, y: 18, scale: 1 },
    { name: "monitor", x: 312, y: 14, scale: 1 },
    { name: "mug", x: 212, y: 220, scale: 1 },
    { name: "disc", x: 272, y: 224, scale: 1 },
    { name: "robot", x: 396, y: 30, scale: 2 },
    { name: "chip", x: 408, y: 140, scale: 1.5 },
    { name: "cartridge", x: 364, y: 202, scale: 1.5 },
  ],
  constellation: [
    { name: "robot", x: 28, y: 48, scale: 2.5 },
    { name: "mug", x: 104, y: 124, scale: 1.5 },
    { name: "monitor", x: 20, y: 176, scale: 2 },
    { name: "keyboard", x: 92, y: 16, scale: 1 },
    { name: "chip", x: 156, y: 14, scale: 1 },
    { name: "floppy", x: 292, y: 16, scale: 1 },
    { name: "bug", x: 118, y: 226, scale: 1 },
    { name: "cartridge", x: 250, y: 222, scale: 1 },
    { name: "rocket", x: 404, y: 32, scale: 2 },
    { name: "disc", x: 400, y: 148, scale: 1.5 },
    { name: "terminal", x: 376, y: 208, scale: 1.5 },
  ],
  waveform: [
    { name: "bug", x: 26, y: 38, scale: 2 },
    { name: "mug", x: 96, y: 96, scale: 1.5 },
    { name: "terminal", x: 18, y: 158, scale: 2 },
    { name: "robot", x: 180, y: 12, scale: 1 },
    { name: "disc", x: 288, y: 16, scale: 1 },
    { name: "floppy", x: 140, y: 224, scale: 1 },
    { name: "rocket", x: 320, y: 220, scale: 1 },
    { name: "keyboard", x: 392, y: 44, scale: 2 },
    { name: "chip", x: 412, y: 158, scale: 1.5 },
    { name: "monitor", x: 360, y: 204, scale: 1.5 },
  ],
} as const satisfies Record<string, readonly SceneryProp[]>;

export type BackdropVariant = keyof typeof SCENERY_PLAN;

/** The footprint of a prop once scaled, for bounds checking. */
export function propExtent(prop: SceneryProp): { right: number; bottom: number } {
  return { right: prop.x + SCENERY_SIZE * prop.scale, bottom: prop.y + SCENERY_SIZE * prop.scale };
}
