import type { CSSProperties, ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { sceneryLayers } from "./scenery-sprites";
import {
  BACKDROP_HEIGHT,
  BACKDROP_WIDTH,
  SCENERY_ACCENT_INK,
  SCENERY_IDLE,
  SCENERY_PLAN,
  type BackdropVariant,
  type SceneryInk,
  type SceneryProp,
} from "./scenery-plan";

/**
 * The layer that stops a page from being an empty rectangle.
 *
 * Two layers, and the second is the one that matters. Underneath is line-work
 * — traces, chips, a constellation, a signal — which gives each variant its
 * texture. On top stand the props: a monitor with code on it, a robot, a
 * rocket, a bug crawling along the bottom edge. Line-work alone is only ever
 * abstract pattern, and a background of blinking squares says nothing about
 * what this application is for.
 *
 * Nothing here is drawn as a plain square any more. A grid of bare rectangles
 * is the default output of "put something in the background", and it read as
 * exactly that — the memory cells are chips with legs now, and the
 * constellation is made of stars rather than dots. The counts came down with
 * them: this layer sits behind real content and had been crowding it.
 *
 * Colour is per object rather than global. Every ornament used to be drawn in
 * the default border colour, which on the bone ground is nearly black, so the
 * margins of every screen carried the same heavy monochrome relief. The inks
 * come from the semantic palettes, so each resolves in both themes — see
 * `SceneryInk` in `scenery-plan`.
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

/** The ink names resolved to the CSS variables the theme publishes. */
const INK: Readonly<Record<SceneryInk, string>> = {
  edge: "var(--amb-colors-border-default)",
  accent: "var(--amb-colors-accent-solid)",
  info: "var(--amb-colors-info-solid)",
  success: "var(--amb-colors-success-solid)",
  warning: "var(--amb-colors-warning-solid)",
  secondary: "var(--amb-colors-secondary-solid)",
  danger: "var(--amb-colors-danger-solid)",
};

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

const EDGE = INK.edge;

/** The rotation the line-work cycles through, so a field is never one hue. */
const LINE_INKS: readonly SceneryInk[] = ["edge", "info", "secondary", "success", "accent"];

function lineInk(index: number): string {
  return INK[LINE_INKS[index % LINE_INKS.length] ?? "edge"];
}

/** Snap to the 4px grid so nothing in an ornament lands off it. */
function snap(value: number): number {
  return Math.round(value / 4) * 4;
}

const TRACES = (() => {
  const next = sequence(20260919);
  return Array.from({ length: 4 }, (_, index) => ({
    y: snap(36 + index * 58 + next() * 12),
    start: snap(next() * 80),
    length: snap(180 + next() * 220),
    delay: next() * 9,
  }));
})();

/**
 * Chips rather than cells. The grid used to be bare 12x12 squares on a 32px
 * pitch — a checkerboard, which is what every generic background is made of.
 * A chip is the same footprint with an outline, a notch, and legs down each
 * side, and it reads as a component on a board.
 */
const CHIPS = (() => {
  const next = sequence(48271);
  const chips: Array<{ x: number; y: number; lit: boolean; delay: number }> = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      if (next() > 0.42) continue;
      chips.push({
        x: column * 68 + 12,
        y: row * 64 + 16,
        lit: next() > 0.45,
        delay: next() * 11,
      });
    }
  }
  return chips;
})();

const STARS = (() => {
  const next = sequence(2654435761);
  return Array.from({ length: 12 }, () => ({
    x: snap(next() * (WIDTH - 24)) + 12,
    y: snap(next() * (HEIGHT - 24)) + 12,
    big: next() > 0.7,
    delay: next() * 13,
  }));
})();

const BAR_STEP = 16;

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
  opacity = 0.3,
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
        <g opacity="0.45">
          {variant === "circuit" ? <Circuit /> : null}
          {variant === "grid" ? <ChipField /> : null}
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
        <g fill={INK[prop.ink]}>
          {body.map((cell) => (
            <rect key={`b${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" />
          ))}
        </g>
        <Box
          as="g"
          fill={INK[SCENERY_ACCENT_INK[prop.ink]]}
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
      {TRACES.map((trace, index) => {
        const ink = lineInk(index);
        return (
          <g key={index}>
            <rect x={trace.start} y={trace.y} width={trace.length} height="2" fill={ink} />
            <rect x={trace.start} y={trace.y - 3} width="8" height="8" fill={ink} />
            <rect
              x={trace.start + trace.length - 8}
              y={trace.y - 3}
              width="8"
              height="8"
              fill={ink}
            />
            <Box
              as="rect"
              x={trace.start}
              y={trace.y - 2}
              width="10"
              height="6"
              fill={lineInk(index + 1)}
              style={{ "--packet-distance": `${trace.length - 10}px` } as CSSProperties}
              animation={`packetTravel ${12 + index * 1.5}s linear ${trace.delay}s infinite`}
            />
          </g>
        );
      })}
    </g>
  );
}

/** One chip: an outlined body with a corner notch and a row of legs each side. */
function Chip({
  x,
  y,
  ink,
  children,
}: {
  x: number;
  y: number;
  ink: string;
  children?: ReactNode;
}) {
  return (
    <g>
      {/* Body, drawn as four bars so the middle stays open. */}
      <rect x={x} y={y} width="24" height="2" fill={ink} />
      <rect x={x} y={y + 18} width="24" height="2" fill={ink} />
      <rect x={x} y={y} width="2" height="20" fill={ink} />
      <rect x={x + 22} y={y} width="2" height="20" fill={ink} />
      {/* The orientation notch, which is what makes it a chip and not a box. */}
      <rect x={x + 4} y={y + 4} width="4" height="2" fill={ink} />
      {/* Legs. */}
      {[0, 1, 2].map((leg) => (
        <g key={leg}>
          <rect x={x - 4} y={y + 4 + leg * 6} width="4" height="2" fill={ink} />
          <rect x={x + 24} y={y + 4 + leg * 6} width="4" height="2" fill={ink} />
        </g>
      ))}
      {children}
    </g>
  );
}

/** A sparse board of chips, a few of which wake up each cycle. */
function ChipField() {
  return (
    <g>
      {CHIPS.map((chip, index) => (
        <Chip key={index} x={chip.x} y={chip.y} ink={lineInk(index)}>
          {chip.lit ? (
            <Box
              as="rect"
              x={chip.x + 10}
              y={chip.y + 8}
              width="6"
              height="4"
              fill={lineInk(index + 2)}
              animation={`cellFlash ${9 + (index % 5)}s steps(1, end) ${chip.delay}s infinite`}
            />
          ) : null}
        </Chip>
      ))}
    </g>
  );
}

/**
 * Stars and the lines between them.
 *
 * A star is a plus — four arms off a centre — rather than the square this used
 * to draw. At this size the difference is four rectangles, and it is the whole
 * difference between a night sky and a scatter plot.
 */
function Star({ x, y, size, ink }: { x: number; y: number; size: number; ink: string }) {
  const arm = size;
  return (
    <g fill={ink}>
      <rect x={x - arm} y={y - 2} width={arm * 2 + 4} height="4" />
      <rect x={x - 2} y={y - arm} width="4" height={arm * 2 + 4} />
    </g>
  );
}

function Constellation() {
  return (
    <g>
      {STARS.slice(0, 5).map((star, index) => {
        const other = STARS[index + 5];
        if (!other) return null;
        return (
          <line
            key={`link-${index}`}
            x1={star.x}
            y1={star.y}
            x2={other.x}
            y2={other.y}
            stroke={EDGE}
            strokeWidth="1"
          />
        );
      })}
      {STARS.map((star, index) =>
        star.big ? (
          <Box
            as="g"
            key={index}
            animation={`cellFlash ${10 + (index % 4) * 2}s steps(1, end) ${star.delay}s infinite`}
          >
            <Star x={star.x} y={star.y} size={6} ink={lineInk(index)} />
          </Box>
        ) : (
          <Star key={index} x={star.x} y={star.y} size={3} ink={lineInk(index + 1)} />
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
        <rect
          key={index}
          x={index * BAR_STEP}
          y={y}
          width={BAR_STEP - 4}
          height="3"
          fill={lineInk(index)}
        />
      ))}
      {BARS.map((y, index) =>
        index % 7 === 0 ? (
          <Box
            as="rect"
            key={`peak-${index}`}
            x={index * BAR_STEP}
            y={y - 4}
            width={BAR_STEP - 4}
            height="11"
            fill={lineInk(index + 3)}
            animation={`cellFlash ${8 + (index % 6)}s steps(1, end) ${(index % 9) * 1.3}s infinite`}
          />
        ) : null,
      )}
    </g>
  );
}
