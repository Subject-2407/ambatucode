"use client";

import { forwardRef, type ReactNode } from "react";
import { Field, Input as ChakraInput, type InputProps as ChakraInputProps } from "@chakra-ui/react";
import { PIXEL, pixelFieldPaint, pixelNotch } from "@/theme/pixel";

export type { InputProps } from "@chakra-ui/react";

/**
 * A field wearing the same notch as everything else on the page.
 *
 * The edge is painted as background layers (see `pixelFieldPaint`) rather than
 * drawn as a `border` or an inset ring. A border is cut away by the notch, and
 * so was the ring this replaces — at exactly the corner steps, which were left
 * with no edge colour at all. Focus and invalid states thicken the edge from
 * the inside, so the control never changes size and nudges the layout.
 */
const FILL = "var(--amb-colors-bg-canvas)";

export const pixelFieldStyles = {
  borderRadius: "0",
  borderWidth: "0",
  clipPath: pixelNotch(),
  boxShadow: "none",
  ...pixelFieldPaint("var(--amb-colors-border-default)", FILL, 2),
  _hover: pixelFieldPaint("var(--amb-colors-border-emphasized)", FILL, 2),
  _focusVisible: {
    outline: "none",
    ...pixelFieldPaint("var(--amb-colors-accent-solid)", FILL, PIXEL),
  },
  "&[aria-invalid='true']": pixelFieldPaint("var(--amb-colors-danger-solid)", FILL, PIXEL),
} as const;

/**
 * The bare field, for a search box or a filter that needs no label row.
 *
 * It re-exported Chakra's own until now, so every search box in the product
 * was the one plain square rectangle on a page of notched edges.
 */
export const Input = forwardRef<HTMLInputElement, ChakraInputProps>(function Input(props, ref) {
  return <ChakraInput ref={ref} {...pixelFieldStyles} {...props} />;
});

export type TextFieldProps = ChakraInputProps & {
  label: string;
  /** Shown under the field only while there is no error. */
  helperText?: ReactNode;
  /** Presence switches the field into its invalid state. */
  errorText?: ReactNode;
  required?: boolean;
};

/**
 * Label, control, and message as one unit. Chakra's Field wires the label,
 * `aria-describedby`, and `aria-invalid` together, so an error is announced
 * rather than merely coloured — the "never encode meaning in colour alone" rule
 * applies to form state too.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, helperText, errorText, required, ...inputProps },
  ref,
) {
  return (
    <Field.Root invalid={Boolean(errorText)} required={required}>
      {/* The label takes the display face; the value the user types does not.
          A pixel face is for naming things, never for reading back input. */}
      <Field.Label textStyle="display" fontSize="2xs" color="fg.muted">
        {label}
        <Field.RequiredIndicator />
      </Field.Label>
      <ChakraInput ref={ref} {...pixelFieldStyles} {...inputProps} />
      {errorText ? (
        <Field.ErrorText>{errorText}</Field.ErrorText>
      ) : helperText ? (
        <Field.HelperText>{helperText}</Field.HelperText>
      ) : null}
    </Field.Root>
  );
});
