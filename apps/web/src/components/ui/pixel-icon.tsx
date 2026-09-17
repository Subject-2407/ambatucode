import { SPRITE_SIZE, spriteCells, type SpriteName } from "./pixel-sprites";

/**
 * Renders one 8×8 sprite as crisp SVG rects.
 *
 * `currentColor` rather than a prop: an icon in a rail slot, a button, or an
 * empty state should take the colour of the thing it sits in, so a slot only
 * has to state its own colour once and the sprite follows it through hover,
 * active, and both themes.
 *
 * `shapeRendering="crispEdges"` is what keeps the cells square at any size. Its
 * absence is the difference between a pixel icon and a blurry one.
 */

export type PixelIconProps = {
  name: SpriteName;
  /** Rendered edge length in px. Whole multiples of 8 stay perfectly crisp. */
  size?: number;
  /**
   * An icon that carries meaning no adjacent text carries needs a label; one
   * that merely repeats its label stays hidden from assistive technology.
   */
  label?: string;
};

export function PixelIcon({ name, size = 24, label }: PixelIconProps) {
  const cells = spriteCells(name);

  return (
    <svg
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      {cells.map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" />
      ))}
    </svg>
  );
}
