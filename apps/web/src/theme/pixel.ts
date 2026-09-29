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
 * `filter: drop-shadow` rather than `box-shadow`, because it follows whatever
 * shape the element actually paints — which is how a shadow gets stair-stepped
 * corners at all. It must never share an element with a `clip-path`, though.
 * A filter is applied *before* clipping, so the notch cuts the shadow off along
 * with the corners: every button here wore one for months and not a pixel of it
 * was ever drawn. `pixelFace()` is the construction that leaves the element
 * unclipped so the shadow survives.
 */
export function pixelDrop(color: string, unit: number = PIXEL): string {
  return `drop-shadow(${unit}px ${unit}px 0 ${color})`;
}

/**
 * A raised control's face: edge and fill painted as two notched layers
 * *behind* an element that is not clipped itself.
 *
 * `pixelSkin()` clips the element, which is right for a frame and wrong for a
 * button, for two reasons. The clip removes the `pixelDrop()` shadow along with
 * the corners; and a border drawn on a clipped element loses its ink exactly at
 * the steps, which is why the outline buttons showed a line along each side and
 * bare stairs at every corner. Here the element paints nothing but its content;
 * `::before` is the edge, `::after` is the fill inset by `weight`, and both
 * carry the notch. The shadow then follows the notched face, and the edge is
 * the same thickness on every step.
 *
 * `weight` 0 is a face with no separate edge: a solid button, whose edge is its
 * fill.
 *
 * The caller keeps the element's own background transparent in every state —
 * a recipe hover that paints it shows through the four corner bites.
 */
export function pixelFace(edge: string, fill: string, weight: number = 2, unit: number = PIXEL) {
  const layer = {
    content: '""',
    position: "absolute",
    clipPath: pixelNotch(unit),
    // Negative within the element's own stacking context: above its (empty)
    // background, below its text. `::after` comes later, so it covers
    // `::before` wherever they overlap.
    zIndex: -1,
    pointerEvents: "none",
    transition: "background 120ms ease-out",
  } as const;

  return {
    position: "relative",
    isolation: "isolate",
    borderWidth: "0",
    borderRadius: "0",
    bg: "transparent",
    _before: { ...layer, inset: "0", background: edge },
    _after: { ...layer, inset: `${weight}px`, background: fill },
  } as const;
}

/**
 * What each raised button variant paints. Flat variants — `ghost`, `plain` —
 * have no face and are not listed; every other variant the recipe defines must
 * be, and `pixel.test.ts` checks that against Chakra's own recipe.
 *
 * Colours are the palette's CSS variables, so one table serves every
 * `colorPalette` a Button is given. Hover on the solid face mixes a little of
 * the contrast colour in rather than using the recipe's `solid/90`: a
 * translucent face would let the shadow behind it show through.
 */
const palette = (slot: string) => `var(--amb-colors-color-palette-${slot})`;
const SOLID_HOVER = `color-mix(in srgb, ${palette("solid")} 85%, ${palette("contrast")})`;

export type ButtonFace = { edge: string; fill: string; hover: string; weight: number };

export const BUTTON_FACES: Readonly<Record<string, ButtonFace>> = {
  solid: { edge: palette("solid"), fill: palette("solid"), hover: SOLID_HOVER, weight: 0 },
  // The edge is the ink, so the outline and the label read as one object.
  outline: { edge: palette("fg"), fill: palette("subtle"), hover: palette("muted"), weight: 2 },
  subtle: { edge: palette("subtle"), fill: palette("subtle"), hover: palette("muted"), weight: 0 },
  surface: { edge: palette("muted"), fill: palette("subtle"), hover: palette("muted"), weight: 2 },
};

/**
 * The notched edge for a form field, painted as background layers.
 *
 * A field cannot use `pixelSkin()` or `pixelFace()`: `<input>` and `<select>`
 * have no `::before`. The inset ring they used instead was clipped at every
 * corner, the same bare-stairs fault the buttons had. So the edge colour is the
 * field's background colour and the fill is laid over it as three rectangles
 * whose union is the notch shape, inset by `weight` — a notched fill drawn
 * without a second clip. The field itself still wears `pixelNotch(unit)`.
 *
 * Returned as the longhand properties rather than one `background`, so a state
 * can restate them without a recipe's shorthand resetting the images.
 */
export function pixelFieldPaint(
  edge: string,
  fill: string,
  weight: number = 2,
  unit: number = PIXEL,
) {
  const w = weight;
  const u = unit;
  // [x, y] offsets of the three bands; each is inset by the same on both ends.
  const bands: ReadonlyArray<readonly [number, number]> = [
    [w, w + 2 * u],
    [w + u, w + u],
    [w + 2 * u, w],
  ];
  const layer = `linear-gradient(${fill}, ${fill})`;

  return {
    backgroundColor: edge,
    backgroundImage: bands.map(() => layer).join(", "),
    backgroundPosition: bands.map(([x, y]) => `${x}px ${y}px`).join(", "),
    backgroundSize: bands
      .map(([x, y]) => `calc(100% - ${2 * x}px) calc(100% - ${2 * y}px)`)
      .join(", "),
    backgroundRepeat: "no-repeat",
  } as const;
}

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
