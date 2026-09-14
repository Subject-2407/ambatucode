import "server-only";
import type { TestScriptValidation, TestScriptValidationStatus } from "@ambatucode/shared";

/**
 * A validation still VALIDATING after this long will never finish: its job was
 * lost, or the Redis record naming it a validation expired. That record lives
 * as long as a Run's owner record, fifteen minutes, so this matches it.
 */
export const VALIDATION_STALE_MS = 15 * 60 * 1_000;

type ValidationColumns = {
  validationStatus: TestScriptValidationStatus;
  validationSummary: string | null;
  validationChangedAt: Date | null;
};

/** A validation that can no longer finish is shown as never having run. */
export function toValidationView(row: ValidationColumns, now = Date.now()): TestScriptValidation {
  const changedAt = row.validationChangedAt?.toISOString() ?? null;
  const stale =
    row.validationChangedAt === null ||
    now - row.validationChangedAt.getTime() > VALIDATION_STALE_MS;
  if (row.validationStatus === "VALIDATING" && stale) {
    return {
      status: "UNVALIDATED",
      summary: "The last validation never finished. Run it again.",
      changedAt,
    };
  }
  return { status: row.validationStatus, summary: row.validationSummary, changedAt };
}
