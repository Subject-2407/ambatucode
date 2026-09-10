"use client";

import type { Language } from "@ambatucode/shared";
import { SelectField } from "@/components/ui/select";
import { LANGUAGE_LABEL } from "./language-labels";

/**
 * Picks among the languages an activity actually allows. The list is passed in
 * rather than read from the full vocabulary: what a Coder may choose is a
 * property of the exercise, and offering more would produce a rejection the
 * server has to explain after the fact.
 */
export type LanguagePickerProps = {
  languages: readonly Language[];
  value: Language;
  onChange: (language: Language) => void;
  label?: string;
  disabled?: boolean;
};

export function LanguagePicker({
  languages,
  value,
  onChange,
  label = "Language",
  disabled = false,
}: LanguagePickerProps) {
  const options = languages.map((language) => ({
    value: language,
    label: LANGUAGE_LABEL[language],
  }));

  return (
    <SelectField
      label={label}
      options={options}
      value={value}
      disabled={disabled || languages.length <= 1}
      onChange={(next) => onChange(next as Language)}
    />
  );
}
