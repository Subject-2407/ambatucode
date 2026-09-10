import type { Language, StarterCodeMap } from "@ambatucode/shared";

/**
 * What should happen to the buffer when the Coder switches language.
 *
 * Switching is only safe when nothing would be lost. A buffer still identical
 * to the starter code it began from is untouched work, so the new language's
 * starter code replaces it silently; anything else is the Coder's own writing,
 * and the caller has to ask before discarding it.
 *
 * Kept as a pure function so the rule is testable on its own and cannot drift
 * between the practice screen and the assessment workspace.
 */
export type LanguageSwitch = {
  /** The buffer the editor should hold after the switch. */
  source: string;
  /** True when applying it would throw away edits the Coder made. */
  discardsEdits: boolean;
};

export function switchLanguage(input: {
  current: string;
  currentLanguage: Language;
  nextLanguage: Language;
  starterCode: StarterCodeMap;
}): LanguageSwitch {
  const currentStarter = input.starterCode[input.currentLanguage] ?? "";
  const nextStarter = input.starterCode[input.nextLanguage] ?? "";

  // Trailing whitespace is not an edit. An editor that trims on save, or a
  // starter snippet stored without its final newline, must not make an
  // untouched buffer look like work in progress.
  const untouched = input.current.trimEnd() === currentStarter.trimEnd();

  return { source: nextStarter, discardsEdits: !untouched };
}
