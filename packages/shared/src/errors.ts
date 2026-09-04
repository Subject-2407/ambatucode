/**
 * Closed union of error codes. Every failed API response and every rejected
 * Socket.IO event carries exactly one of these. Adding a code here is a
 * deliberate contract change — the frontend maps each one to user-facing copy.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "RATE_LIMITED",
  "ATTEMPT_ALREADY_SUBMITTED",
  "ATTEMPT_EXPIRED",
  "SESSION_NOT_RUNNING",
  "LANGUAGE_NOT_ALLOWED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ATTEMPT_ALREADY_SUBMITTED: 409,
  ATTEMPT_EXPIRED: 409,
  SESSION_NOT_RUNNING: 409,
  LANGUAGE_NOT_ALLOWED: 422,
  INTERNAL: 500,
};

/**
 * Thrown by services and translated into the API envelope at the route
 * boundary. `details` is only echoed for VALIDATION_FAILED — every other code
 * returns a generic message so internals never leak to a Coder.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return ERROR_STATUS[this.code];
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
