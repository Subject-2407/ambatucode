import { Box } from "@chakra-ui/react";

/**
 * The band of pixel server towers along the bottom of the title screen.
 *
 * Technology rather than fantasy: the product is a lab tool, and a row of racks
 * with status LEDs says what it is in a way a castle or a mountain range would
 * not. Every few towers carries a light that blinks out of step with its
 * neighbours, which is the only motion on the screen.
 *
 * Drawn from a fixed height array rather than random numbers, so the horizon is
 * identical on the server and the client and does not shift after hydration.
 * It costs about forty rects and no asset request.
 */

const HEIGHTS = [
  3, 5, 4, 7, 6, 9, 5, 8, 11, 7, 6, 10, 8, 5, 9, 12, 7, 6, 8, 5, 10, 7, 9, 6, 4, 8, 6, 11, 7, 5, 9,
  6, 8, 4, 7, 5,
];

const UNIT = 8;
const BAND = 96;

export function PixelHorizon() {
  const width = HEIGHTS.length * UNIT;

  return (
    <Box
      aria-hidden
      position="absolute"
      insetInline="0"
      bottom="0"
      height={`${BAND}px`}
      pointerEvents="none"
      // `slice` rather than `none`: stretching the viewBox to fill the width
      // would make the cells rectangles, which is the one thing a pixel
      // ornament cannot be.
      css={{ "& svg": { display: "block", width: "100%", height: "100%" } }}
    >
      <svg
        viewBox={`0 0 ${width} ${BAND}`}
        preserveAspectRatio="xMidYMax slice"
        shapeRendering="crispEdges"
        role="presentation"
      >
        <g fill="var(--amb-colors-plum-950)">
          {HEIGHTS.map((height, index) => (
            <rect
              key={index}
              x={index * UNIT}
              y={BAND - height * UNIT}
              width={UNIT - 1}
              height={height * UNIT}
            />
          ))}
        </g>
        <g fill="var(--amb-colors-lagoon-500)">
          {HEIGHTS.map((height, index) =>
            index % 3 === 0 ? (
              <Box
                as="rect"
                key={index}
                x={index * UNIT + 2}
                y={BAND - height * UNIT + 4}
                width="2"
                height="2"
                animation={`ledBlink ${1.4 + (index % 5) * 0.4}s steps(1, end) infinite`}
              />
            ) : null,
          )}
        </g>
      </svg>
    </Box>
  );
}
