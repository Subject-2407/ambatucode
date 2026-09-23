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
 * The notched edge, drawn so that the corners actually carry ink.
 *
 * The obvious way to put a border on a notched box — `clip-path` plus an inset
 * `box-shadow` — is subtly wrong, and it is why several edges in the app looked
 * washed out or missing at the corners. An inset shadow is painted along the
 * *border box*, which is a rectangle; the notch then clips away exactly the
 * corner squares where that ring turns. What is left is four straight strokes
 * and four bare diagonal steps, with the fill running right up to the cut and
 * no edge colour on it at all.
 *
 * This paints the edge as the element's own background and lays the fill over
 * it, inset by the edge's thickness and notched again — the same two-layer
 * construction `PixelFrame` uses, in one element rather than two. Every step of
 * the stair is the edge colour, at full weight, in both themes.
 *
 * `isolation: isolate` is load-bearing. It makes the element a stacking
 * context, which is what lets the fill layer sit at `z-index: -1` — above the
 * element's own background but below its text. Without it that layer escapes
 * behind whatever ancestor happens to form the nearest context.
 *
 * Not usable on a replaced element: `<input>` and friends have no `::before`,
 * so a field still draws its edge with an inset ring.
 */
export function pixelSkin(edge: string, fill: string, unit: number = PIXEL) {
  return {
    position: "relative",
    isolation: "isolate",
    borderWidth: "0",
    borderRadius: "0",
    background: edge,
    clipPath: pixelNotch(unit),
    _before: {
      content: '""',
      position: "absolute",
      inset: `${unit}px`,
      background: fill,
      clipPath: pixelNotch(unit),
      zIndex: -1,
      pointerEvents: "none",
    },
  } as const;
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
 * Button variants that paint no fill of their own.
 *
 * `pixelDrop()` shadows whatever the element paints, and a button with no fill
 * paints only its border and its glyphs — so the letters each get a shadow and
 * read as doubled, until hover adds a background and the silhouette closes. A
 * shadowed button has to be filled at rest, which is what these variants are
 * given in `components/ui/button.tsx`.
 */
export const UNFILLED_VARIANTS: ReadonlySet<string> = new Set(["outline"]);

/**
 * How far a pressed control travels. It moves by exactly the shadow offset and
 * drops the shadow, so the button appears to sit down onto the page rather than
 * shrink or dim — the feedback is positional, which survives both themes.
 */
export const PIXEL_PRESS = `translate(${PIXEL}px, ${PIXEL}px)`;

/**
 * The keyboard focus indicator for anything wearing a notch.
 *
 * `clip-path` clips everything the element paints, `outline` and `box-shadow`
 * included — so the usual focus ring drawn outside the box is cut away and a
 * keyboard user gets no indicator at all. An *inset* shadow is painted inside
 * the border box, which is inside the clip, so it survives.
 *
 * The ring is drawn in the element's own contrast colour rather than a fixed
 * accent, so it stays legible whatever the control is filled with.
 */
export function pixelFocusRing(color: string, unit: number = PIXEL - 1): string {
  return `inset 0 0 0 ${unit}px ${color}`;
}
