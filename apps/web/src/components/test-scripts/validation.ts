import type { TestScriptValidation, TestScriptValidationStatus } from "@ambatucode/shared";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Reading a script's validation for an Architect.
 *
 * Validation is advisory, so everything here is wording and tone: nothing in
 * the app refuses an unvalidated script, it only says so where the Architect
 * will see it before a Coder does.
 */

/** How often a view with a validation in flight re-reads its scripts. */
export const VALIDATION_POLL_MS = 2_000;

export const VALIDATION_BADGE: Readonly<
  Record<TestScriptValidationStatus, { label: string; tone: BadgeTone }>
> = {
  UNVALIDATED: { label: "Not validated", tone: "warning" },
  VALIDATING: { label: "Validating", tone: "info" },
  PASSED: { label: "Validated", tone: "success" },
  FAILED: { label: "Validation failed", tone: "danger" },
};

type WithValidation = { validation: TestScriptValidation };

export function isValidating(scripts: readonly WithValidation[]): boolean {
  return scripts.some((script) => script.validation.status === "VALIDATING");
}

/**
 * One sentence about every script not known to work, or null when all are.
 * A failure outranks a missing validation: it is known to be wrong.
 */
export function validationWarning(scripts: readonly WithValidation[]): string | null {
  const failed = scripts.filter((script) => script.validation.status === "FAILED").length;
  const unchecked = scripts.filter(
    (script) =>
      script.validation.status === "UNVALIDATED" || script.validation.status === "VALIDATING",
  ).length;

  const plural = (count: number) => (count === 1 ? "script" : "scripts");
  if (failed > 0) {
    return `${String(failed)} test ${plural(failed)} failed against the reference solution. Coders' code will likely fail them too.`;
  }
  if (unchecked > 0) {
    return `${String(unchecked)} test ${plural(unchecked)} ${unchecked === 1 ? "has" : "have"} not been validated against a reference solution.`;
  }
  return null;
}
