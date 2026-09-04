/**
 * Domain enums mirrored from the Prisma schema. They live here — not imported
 * from the generated client — so `apps/realtime`, the Zod schemas, and the Go
 * worker contract all agree without pulling Prisma into every consumer.
 * Changing a value here means changing `packages/db/prisma/schema.prisma` in
 * the same commit.
 */

export const USER_ROLES = ["ROOT", "ARCHITECT", "CODER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MODULE_VISIBILITIES = ["PUBLIC", "CLOSED"] as const;
export type ModuleVisibility = (typeof MODULE_VISIBILITIES)[number];

export const ENROLLMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const TIME_MODES = ["UNTIMED", "TIMED"] as const;
export type TimeMode = (typeof TIME_MODES)[number];

export const EXECUTION_MODES = ["INDIVIDUAL", "LIVE"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const GRADING_STRATEGIES = ["ALL_OR_NOTHING", "WEIGHTED_AVERAGE"] as const;
export type GradingStrategy = (typeof GRADING_STRATEGIES)[number];

export const FOCUS_LOSS_ACTIONS = ["LOG_ONLY", "WARN", "AUTO_SUBMIT"] as const;
export type FocusLossAction = (typeof FOCUS_LOSS_ACTIONS)[number];

export const TEST_CASE_KINDS = ["PUBLIC", "HIDDEN"] as const;
export type TestCaseKind = (typeof TEST_CASE_KINDS)[number];

export const TEST_SCRIPT_FRAMEWORKS = ["JUNIT", "JEST", "PYTEST", "CUSTOM"] as const;
export type TestScriptFramework = (typeof TEST_SCRIPT_FRAMEWORKS)[number];

export const COMPARISON_MODES = ["EXACT", "TRIMMED", "TOKEN", "NUMERIC_TOLERANT"] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

export const ASSESSMENT_SESSION_STATUSES = [
  "DRAFT",
  "READY",
  "RUNNING",
  "ENDED",
  "CANCELLED",
] as const;
export type AssessmentSessionStatus = (typeof ASSESSMENT_SESSION_STATUSES)[number];

export const READY_STATES = ["NOT_READY", "READY"] as const;
export type ReadyState = (typeof READY_STATES)[number];

export const CONNECTION_STATES = ["OFFLINE", "ONLINE"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const ATTEMPT_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "EXPIRED",
  "RESET",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const SUBMISSION_STATUSES = [
  "QUEUED",
  "RUNNING",
  "GRADED",
  "COMPILE_ERROR",
  "RUNTIME_ERROR",
  "TIME_LIMIT_EXCEEDED",
  "MEMORY_LIMIT_EXCEEDED",
  "SYSTEM_ERROR",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Statuses the pipeline may still move away from. Everything else is final. */
export const NON_TERMINAL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = ["QUEUED", "RUNNING"];

export function isTerminalSubmissionStatus(status: SubmissionStatus): boolean {
  return !NON_TERMINAL_SUBMISSION_STATUSES.includes(status);
}

export const ASSESSMENT_EVENT_TYPES = [
  "SESSION_STARTED",
  "SESSION_ENDED",
  "ATTEMPT_STARTED",
  "ATTEMPT_SUBMITTED",
  "ATTEMPT_AUTO_SUBMITTED",
  "CONNECTED",
  "DISCONNECTED",
  "RECONNECTED",
  "FOCUS_LOST",
  "FOCUS_REGAINED",
  "CLIPBOARD_BLOCKED",
  "TIMER_PAUSED",
  "TIMER_RESUMED",
  "ATTEMPT_RESET",
] as const;
export type AssessmentEventType = (typeof ASSESSMENT_EVENT_TYPES)[number];

/** Sandbox languages. Adding one means adding a docker/sandbox image too. */
export const LANGUAGES = ["python", "javascript", "java", "cpp"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}
