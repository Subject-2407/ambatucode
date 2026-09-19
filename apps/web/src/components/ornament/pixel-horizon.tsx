import { Box } from "@chakra-ui/react";
import { SCENERY_IDLE } from "./scenery-plan";
import { SCENERY_SIZE, sceneryLayers, type SceneryName } from "./scenery-sprites";

/**
 * The bench along the bottom of the title screen.
 *
 * It used to be a row of server towers in the darkest plum on the ramp, which
 * against the gradient read as a bruise rather than a skyline — a block of
 * colour doing nothing except being purple. This is the same idea done as
 * furniture instead: the objects a Coder actually sits in front of, lined up on
 * a bench in the same edge ink as every other ornament, with their screens and
 * status lights the only colour in the band.
 *
 * Built from the shared scenery sprites rather than its own artwork, so the
 * monitor down here and the monitor drifting in the backdrop are the same
 * object seen twice. Each one is seated by its lowest filled row, which is why
 * a keyboard with three empty rows under it still sits flat on the bench.
 */

const BAND = 96;
const BENCH_Y = 88;
const BENCH_THICKNESS = 4;
const LEAD_IN = 8;

type Piece = { name: SceneryName; scale: number; gap: number };

/** Read left to right. Mixed scales, uneven gaps — a bench, not a bar chart. */
const BENCH: readonly Piece[] = [
  { name: "monitor", scale: 3, gap: 10 },
  { name: "keyboard", scale: 2, gap: 22 },
  { name: "mug", scale: 2, gap: 26 },
  { name: "cartridge", scale: 2, gap: 14 },
  { name: "disc", scale: 2.5, gap: 24 },
  { name: "robot", scale: 2.5, gap: 20 },
  { name: "terminal", scale: 3, gap: 12 },
  { name: "floppy", scale: 2, gap: 26 },
  { name: "chip", scale: 2.5, gap: 22 },
  { name: "mug", scale: 1.5, gap: 18 },
  { name: "monitor", scale: 2, gap: 20 },
  { name: "keyboard", scale: 2.5, gap: 14 },
];

/** The lowest filled row of a sprite, so it can be stood on a surface. */
function lowestRow(name: SceneryName): number {
  const { body, accent } = sceneryLayers(name);
  let lowest = 0;
  for (const cell of [...body, ...accent]) {
    if (cell.y > lowest) lowest = cell.y;
  }
  return lowest;
}

/**
 * Laid out once at module load. The bench is identical on the server and the
 * client for the same reason the backdrop is: a horizon that shifts on
 * hydration is worse than no horizon.
 */
const LAYOUT = (() => {
  const placed: Array<Piece & { x: number; y: number }> = [];
  let cursor = LEAD_IN;

  for (const piece of BENCH) {
    const height = (lowestRow(piece.name) + 1) * piece.scale;
    placed.push({ ...piece, x: cursor, y: BENCH_Y - height });
    cursor += SCENERY_SIZE * piece.scale + piece.gap;
  }

  return { pieces: placed, width: cursor + LEAD_IN };
})();

const EDGE = "var(--amb-colors-border-default)";
const LIVE = "var(--amb-colors-accent-solid)";

export function PixelHorizon() {
  return (
    <Box
      aria-hidden
      position="absolute"
      insetInline="0"
      bottom="0"
      height={`${BAND}px`}
      pointerEvents="none"
      // Present enough to close the bottom edge, quiet enough that the form
      // above it is still the first thing read.
      opacity="0.55"
      // `slice` rather than `none`: stretching the viewBox to fill the width
      // would make the cells rectangles, which is the one thing a pixel
      // ornament cannot be.
      css={{ "& svg": { display: "block", width: "100%", height: "100%" } }}
    >
      <svg
        viewBox={`0 0 ${LAYOUT.width} ${BAND}`}
        preserveAspectRatio="xMidYMax slice"
        shapeRendering="crispEdges"
        role="presentation"
      >
        {LAYOUT.pieces.map((piece, index) => (
          <BenchPiece key={`${piece.name}-${index}`} piece={piece} index={index} />
        ))}

        <g fill={EDGE}>
          <rect x="0" y={BENCH_Y} width={LAYOUT.width} height={BENCH_THICKNESS} />
          {/* Legs, so the bench reads as a surface rather than a rule. */}
          {LAYOUT.pieces.map((piece, index) =>
            index % 3 === 0 ? (
              <rect
                key={`leg-${index}`}
                x={piece.x + 8}
                y={BENCH_Y + BENCH_THICKNESS}
                width="4"
                height={BAND - BENCH_Y - BENCH_THICKNESS}
              />
            ) : null,
          )}
        </g>
      </svg>
    </Box>
  );
}

function BenchPiece({ piece, index }: { piece: Piece & { x: number; y: number }; index: number }) {
  const { body, accent } = sceneryLayers(piece.name);
  const idle = SCENERY_IDLE[piece.name];
  const delay = ((index * 1.3) % 4).toFixed(2);

  return (
    <g transform={`translate(${piece.x} ${piece.y}) scale(${piece.scale})`}>
      <Box
        as="g"
        css={{ transformBox: "fill-box", transformOrigin: "center" }}
        animation={
          idle.body
            ? `${idle.body.name} ${idle.body.seconds}s steps(1, end) ${delay}s infinite`
            : undefined
        }
      >
        <g fill={EDGE}>
          {body.map((cell) => (
            <rect key={`b${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" />
          ))}
        </g>
        <Box
          as="g"
          fill={LIVE}
          animation={`${idle.accent.name} ${idle.accent.seconds}s steps(1, end) ${delay}s infinite`}
        >
          {accent.map((cell) => (
            <rect key={`a${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" />
          ))}
        </Box>
      </Box>
    </g>
  );
}
