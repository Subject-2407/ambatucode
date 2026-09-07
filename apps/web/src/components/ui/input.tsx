"use client";

import { forwardRef, type ReactNode } from "react";
import { Field, Input as ChakraInput, type InputProps as ChakraInputProps } from "@chakra-ui/react";

export { Input } from "@chakra-ui/react";
export type { InputProps } from "@chakra-ui/react";

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
      <Field.Label>
        {label}
        <Field.RequiredIndicator />
      </Field.Label>
      <ChakraInput ref={ref} {...inputProps} />
      {errorText ? (
        <Field.ErrorText>{errorText}</Field.ErrorText>
      ) : helperText ? (
        <Field.HelperText>{helperText}</Field.HelperText>
      ) : null}
    </Field.Root>
  );
});
