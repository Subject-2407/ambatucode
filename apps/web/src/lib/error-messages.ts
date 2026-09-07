import type { ErrorCode } from "@ambatucode/shared";

/**
 * One place where an error code becomes something a person reads. Route
 * handlers return a code and a terse developer message; this file decides what
 * the Coder, Architect, or Root actually sees.
 *
 * The assessment codes are deliberately calm. `ATTEMPT_ALREADY_SUBMITTED` is
 * usually a double click or a stale tab, not misconduct, and the copy must not
 * imply otherwise.
 */
const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "You do not have access to this.",
  NOT_FOUND: "We could not find what you were looking for.",
  VALIDATION_FAILED: "Some of the details you entered need fixing.",
  CONFLICT: "That conflicts with something that already exists.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  ATTEMPT_ALREADY_SUBMITTED:
    "This attempt has already been submitted. Your submitted work is safe.",
  ATTEMPT_EXPIRED: "The time for this attempt has ended. Your latest saved work was submitted.",
  SESSION_NOT_RUNNING: "This assessment session is not running yet.",
  LANGUAGE_NOT_ALLOWED: "That programming language is not allowed for this assessment.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};

export function messageForCode(code: ErrorCode): string {
  return MESSAGES[code];
}
