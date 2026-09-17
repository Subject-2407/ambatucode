/**
 * The pixel treatment, expressed once.
 *
 * Every notched corner, hard edge, and offset shadow in the app comes from
 * here, so the look is a handful of values rather than a convention each
 * component remembers differently.
 *
 * It is all generated CSS. There is no sprite sheet and no border image, which
 * matters for two reasons: the platform ships offline and must not depend on an
 * asset request, and a shadow built from theme tokens flips with the theme for
 * free while a baked PNG does not.
 */

/** The grid the whole treatment snaps to. Nothing is offset by a half-step. */
export const PIXEL = 4;

/**
 * The stair-stepped corner: a rectangle with one square bitten out of each
 * corner, which is what a box drawn on a pixel grid actually looks like.
 *
 * Applied to a frame and again to its inner fill, it gives the two-layer border
 * the design uses everywhere. `unit` is the size of the bite.
 */
export function pixelNotch(unit: number = PIXEL): string {
  const n = `${unit}px`;
  const n2 = `${unit * 2}px`;
  const en = `calc(100% - ${n})`;
  const en2 = `calc(100% - ${n2})`;

  return [
    `polygon(`,
    `0 ${n2}, ${n} ${n2}, ${n} ${n}, ${n2} ${n}, ${n2} 0,`,
    `${en2} 0, ${en2} ${n}, ${en} ${n}, ${en} ${n2}, 100% ${n2},`,
    `100% ${en2}, ${en} ${en2}, ${en} ${en}, ${en2} ${en}, ${en2} 100%,`,
    `${n2} 100%, ${n2} ${en}, ${n} ${en}, ${n} ${en2}, 0 ${en2}`,
    `)`,
  ]
    .join(" ")
    .replace(/\(\s+/, "(")
    .replace(/\s+\)/, ")");
}

/**
 * A hard border drawn with shadows rather than `border`, so it sits outside the
 * box and leaves the corners square-cut rather than mitred.
 *
 * Used on small elements — chips, slots, meters — where a second nested element
 * for the frame would be more markup than the border is worth. It is painted
 * outside the element's box, so the caller leaves `unit` of margin for it.
 */
export function pixelEdge(color: string, unit: number = PIXEL): string {
  const n = `${unit}px`;
  return `0 -${n} 0 ${color}, 0 ${n} 0 ${color}, -${n} 0 0 ${color}, ${n} 0 0 ${color}`;
}

/**
 * The offset block shadow under a raised element.
 *
 * `filter: drop-shadow` rather than `box-shadow` on anything that also carries
 * a notch: `clip-path` clips a box-shadow away, and a filter is applied after
 * the clip, so the shadow follows the notched silhouette instead of vanishing.
 */
export function pixelDrop(color: string, unit: number = PIXEL): string {
  return `drop-shadow(${unit}px ${unit}px 0 ${color})`;
}

/**
 * How far a pressed control travels. It moves by exactly the shadow offset and
 * drops the shadow, so the button appears to sit down onto the page rather than
 * shrink or dim — the feedback is positional, which survives both themes.
 */
export const PIXEL_PRESS = `translate(${PIXEL}px, ${PIXEL}px)`;
