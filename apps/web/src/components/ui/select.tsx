"use client";

import { forwardRef, type ReactNode } from "react";
import { Field, NativeSelect } from "@chakra-ui/react";

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  helperText?: ReactNode;
  errorText?: ReactNode;
};

/**
 * Built on the native `<select>` rather than Chakra's listbox-based Select.
 *
 * Ambatucode has to work on lab machines with no network and a wide spread of
 * browsers, and the native control brings its own keyboard handling, mobile
 * behaviour, and assistive-technology support with zero JavaScript. The richer
 * Select earns its cost only where an option needs custom rendering, which no
 * current screen does.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  {
    label,
    options,
    value,
    defaultValue,
    onChange,
    name,
    placeholder,
    disabled,
    required,
    helperText,
    errorText,
  },
  ref,
) {
  return (
    <Field.Root invalid={Boolean(errorText)} required={required} disabled={disabled}>
      <Field.Label>
        {label}
        <Field.RequiredIndicator />
      </Field.Label>
      <NativeSelect.Root disabled={disabled} invalid={Boolean(errorText)}>
        <NativeSelect.Field
          ref={ref}
          name={name}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {errorText ? (
        <Field.ErrorText>{errorText}</Field.ErrorText>
      ) : helperText ? (
        <Field.HelperText>{helperText}</Field.HelperText>
      ) : null}
    </Field.Root>
  );
});
