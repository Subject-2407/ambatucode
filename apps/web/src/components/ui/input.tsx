"use client";

import { forwardRef, type ReactNode } from "react";
import { Field, Input as ChakraInput, type InputProps as ChakraInputProps } from "@chakra-ui/react";
import { PIXEL, pixelFocusRing, pixelNotch } from "@/theme/pixel";

export { Input } from "@chakra-ui/react";
export type { InputProps } from "@chakra-ui/react";

/**
 * A field wearing the same notch as everything else on the page.
 *
 * The border is drawn inside the box with an inset shadow rather than as a
 * `border`, because the notch clips anything painted outside the border box —
 * and an inset ring also means focus and invalid states can thicken the edge
 * without the control changing size and nudging the layout.
 */
const FIELD_EDGE = pixelFocusRing("var(--amb-colors-border-default)", 2);
const FIELD_EDGE_FOCUS = pixelFocusRing("var(--amb-colors-accent-solid)", PIXEL);
const FIELD_EDGE_INVALID = pixelFocusRing("var(--amb-colors-danger-solid)", PIXEL);

export const pixelFieldStyles = {
  borderRadius: "0",
  borderWidth: "0",
  clipPath: pixelNotch(),
  bg: "bg.canvas",
  boxShadow: FIELD_EDGE,
  transition: "box-shadow 120ms ease-out",
  _hover: { boxShadow: pixelFocusRing("var(--amb-colors-border-emphasized)", 2) },
  _focusVisible: { outline: "none", boxShadow: FIELD_EDGE_FOCUS },
  "&[aria-invalid='true']": { boxShadow: FIELD_EDGE_INVALID },
} as const;

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
