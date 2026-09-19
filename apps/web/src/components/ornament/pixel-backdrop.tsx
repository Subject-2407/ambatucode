import type { CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { sceneryLayers } from "./scenery-sprites";
import {
  BACKDROP_HEIGHT,
  BACKDROP_WIDTH,
  SCENERY_IDLE,
  SCENERY_PLAN,
  type BackdropVariant,
  type SceneryProp,
} from "./scenery-plan";

/**
 * The layer that stops a page from being an empty rectangle.
 *
 * Two layers, and the second is the one that matters. Underneath is line-work
 * — traces, memory cells, links, a signal — which gives each variant its
 * texture. On top stand the props: a monitor with code on it, a robot, a
 * rocket, a bug crawling along the bottom edge. Line-work alone is only ever
 * abstract pattern, and a background of blinking squares says nothing about
 * what this application is for.
 *
 * Motion is per object and deliberately unhurried: a robot bobs on a four and
 * a half second cycle, a disc turns a quarter every three seconds, a terminal
 * caret blinks. Nothing is synchronised, because a screen where everything
 * moves on the same beat reads as a single animation rather than as a room
 * with things in it. Only `opacity` and `transform` are touched, both
 * compositor-only, and all of it stops under `prefers-reduced-motion`, which
 * the theme honours globally.
 *
 * The line-work geometry is generated once at module load from a seeded
 * sequence rather than `Math.random`, so the server and the client draw the
 * same thing and nothing jumps on hydration. The props are hand-placed; see
 * `scenery-plan`.
 */

export type { BackdropVariant };

/**
 * A small deterministic sequence. Not cryptographic and not meant to be — it
 * exists so "scattered" is reproducible across a render boundary.
 */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const WIDTH = BACKDROP_WIDTH;
const HEIGHT = BACKDROP_HEIGHT;

const EDGE = "var(--amb-colors-border-default)";
const LIVE = "var(--amb-colors-accent-solid)";

/** Snap to the 4px grid so nothing in an ornament lands off it. */
function snap(value: number): number {
  return Math.round(value / 4) * 4;
}

const TRACES = (() => {
  const next = sequence(20260919);
  return Array.from({ length: 7 }, (_, index) => ({
    y: snap(24 + index * 34 + next() * 12),
    start: snap(next() * 80),
    length: snap(180 + next() * 220),
    delay: next() * 9,
  }));
})();

const CELLS = (() => {
  const next = sequence(48271);
  const cells: Array<{ x: number; y: number; lit: boolean; delay: number }> = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 15; column += 1) {
      if (next() > 0.62) continue;
      cells.push({
        x: column * 32 + 8,
        y: row * 32 + 8,
        lit: next() > 0.78,
        delay: next() * 11,
      });
    }
  }
  return cells;
})();

const NODES = (() => {
  const next = sequence(2654435761);
  return Array.from({ length: 22 }, () => ({
    x: snap(next() * (WIDTH - 16)) + 8,
    y: snap(next() * (HEIGHT - 16)) + 8,
    big: next() > 0.75,
    delay: next() * 13,
  }));
})();

const BAR_STEP = 12;

const BARS = (() => {
  const next = sequence(999331);
  const columns = Math.floor(WIDTH / BAR_STEP);
  const levels: number[] = [];
  let level = HEIGHT / 2;

  for (let index = 0; index < columns; index += 1) {
    level += (next() - 0.5) * 40;
    level = Math.min(HEIGHT - 40, Math.max(40, level));
    levels.push(snap(level));
  }
  return levels;
})();

export function PixelBackdrop({
  variant = "circuit",
  /** How present the layer is. Low by default: it is behind real content. */
  opacity = 0.35,
}: {
  variant?: BackdropVariant;
  opacity?: number;
}) {
  return (
    <Box
      aria-hidden
      position="absolute"
      inset="0"
      overflow="hidden"
      pointerEvents="none"
      zIndex="0"
      opacity={opacity}
      css={{ "& svg": { display: "block", width: "100%", height: "100%" } }}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        role="presentation"
      >
        {/* The substrate sits back so the objects on top of it stay the thing
            you notice. It is texture, not subject. */}
        <g opacity="0.5">
          {variant === "circuit" ? <Circuit /> : null}
          {variant === "grid" ? <MemoryGrid /> : null}
          {variant === "constellation" ? <Constellation /> : null}
          {variant === "waveform" ? <Waveform /> : null}
        </g>
        <Scenery variant={variant} />
      </svg>
    </Box>
  );
}

function Scenery({ variant }: { variant: BackdropVariant }) {
  return (
    <g>
      {SCENERY_PLAN[variant].map((prop, index) => (
        <Prop key={`${prop.name}-${index}`} prop={prop} index={index} />
      ))}
    </g>
  );
}

/**
 * One object, in two inks.
 *
 * Placement uses the SVG `transform` attribute and motion uses the CSS
 * property, which keeps them from overwriting one another: a prop can stand at
 * x=404 scaled twice over and still bob four pixels without either value
 * needing to know about the other.
 */
function Prop({ prop, index }: { prop: SceneryProp; index: number }) {
  const { body, accent } = sceneryLayers(prop.name);
  const idle = SCENERY_IDLE[prop.name];
  // Staggered by an irrational-ish step so two props of the same kind never
  // fall into lockstep, which is what makes a set of them read as a pattern.
  const delay = ((index * 1.7) % 5).toFixed(2);

  return (
    <g transform={`translate(${prop.x} ${prop.y}) scale(${prop.scale})`}>
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

/**
 * Traces with a pad at each end and one packet per trace making the crossing
 * on its own slow cycle.
 */
function Circuit() {
  return (
    <g>
      {TRACES.map((trace, index) => (
        <g key={index}>
          <rect x={trace.start} y={trace.y} width={trace.length} height="2" fill={EDGE} />
          <rect x={trace.start} y={trace.y - 3} width="8" height="8" fill={EDGE} />
          <rect
            x={trace.start + trace.length - 8}
            y={trace.y - 3}
            width="8"
            height="8"
            fill={EDGE}
          />
          <Box
            as="rect"
            x={trace.start}
            y={trace.y - 2}
            width="10"
            height="6"
            fill={LIVE}
            style={{ "--packet-distance": `${trace.length - 10}px` } as CSSProperties}
            animation={`packetTravel ${12 + index * 1.5}s linear ${trace.delay}s infinite`}
          />
        </g>
      ))}
    </g>
  );
}

/** A sparse field of memory cells, a few of which wake up each cycle. */
function MemoryGrid() {
  return (
    <g>
      {CELLS.map((cell, index) => (
        <g key={index}>
          <rect x={cell.x} y={cell.y} width="12" height="12" fill={EDGE} />
          {cell.lit ? (
            <Box
              as="rect"
              x={cell.x + 3}
              y={cell.y + 3}
              width="6"
              height="6"
              fill={LIVE}
              animation={`cellFlash ${9 + (index % 5)}s steps(1, end) ${cell.delay}s infinite`}
            />
          ) : null}
        </g>
      ))}
    </g>
  );
}

/** Scattered nodes with a few faint links, and one node waking at a time. */
function Constellation() {
  return (
    <g>
      {NODES.slice(0, 9).map((node, index) => {
        const other = NODES[index + 6];
        if (!other) return null;
        return (
          <line
            key={`link-${index}`}
            x1={node.x}
            y1={node.y}
            x2={other.x}
            y2={other.y}
            stroke={EDGE}
            strokeWidth="1"
          />
        );
      })}
      {NODES.map((node, index) =>
        node.big ? (
          <Box
            as="rect"
            key={index}
            x={node.x}
            y={node.y}
            width="8"
            height="8"
            fill={LIVE}
            animation={`cellFlash ${10 + (index % 4) * 2}s steps(1, end) ${node.delay}s infinite`}
          />
        ) : (
          <rect key={index} x={node.x} y={node.y} width="4" height="4" fill={EDGE} />
        ),
      )}
    </g>
  );
}

/** A quantised signal trace, drawn as steps because everything here is. */
function Waveform() {
  return (
    <g>
      {BARS.map((y, index) => (
        <rect key={index} x={index * BAR_STEP} y={y} width={BAR_STEP - 2} height="3" fill={EDGE} />
      ))}
      {BARS.map((y, index) =>
        index % 7 === 0 ? (
          <Box
            as="rect"
            key={`peak-${index}`}
            x={index * BAR_STEP}
            y={y - 4}
            width={BAR_STEP - 2}
            height="11"
            fill={LIVE}
            animation={`cellFlash ${8 + (index % 6)}s steps(1, end) ${(index % 9) * 1.3}s infinite`}
          />
        ) : null,
      )}
    </g>
  );
}
