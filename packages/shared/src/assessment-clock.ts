import type { AssessmentSessionStatus, AttemptStatus, ExecutionMode } from "./enums";

/**
 * Server-authoritative attempt timing, as pure arithmetic.
 *
 * apps/web starts attempts and enforces deadlines on submit; apps/realtime
 * pauses and resumes them on disconnect. Both must agree to the millisecond on
 * what "time left" means, so the rule is written once here rather than twice.
 *
 * The timing of an attempt comes from its Assessment Session, not from the
 * Assessment: the same Assessment can run as a 30-minute Live session for one
 * class and a 45-minute Individual session for another.
 */

export type SessionTiming = {
  /** Null for an untimed session. */
  executionMode: ExecutionMode | null;
  /** Null for an untimed session. */
  durationMinutes: number | null;
  /** Live mode only: the one global deadline, fixed when the session starts. */
  endsAtMs: number | null;
};

export type AttemptClock = SessionTiming & {
  /** Individual mode only. Meaningless while paused. */
  individualDeadlineAtMs: number | null;
  /** Individual mode only: set while the Coder is disconnected. */
  pausedAtMs: number | null;
  /** Individual mode only: running time already spent, persisted at each pause. */
  consumedMs: number;
};

export function isTimedSession(timing: SessionTiming): boolean {
  return timing.executionMode !== null && timing.durationMinutes !== null;
}

export function sessionDurationMs(timing: SessionTiming): number | null {
  return timing.durationMinutes === null ? null : timing.durationMinutes * 60_000;
}

/**
 * The absolute moment this attempt ends, or null when nothing is ticking.
 *
 * A paused Individual attempt has no deadline at all — that is what pausing
 * means. Its remaining time is frozen in `consumedMs` until it resumes.
 */
export function attemptDeadlineMs(clock: AttemptClock): number | null {
  if (!isTimedSession(clock)) return null;
  if (clock.executionMode === "LIVE") return clock.endsAtMs;
  if (clock.pausedAtMs !== null) return null;
  return clock.individualDeadlineAtMs;
}

export function attemptRemainingMs(clock: AttemptClock, nowMs: number): number | null {
  const durationMs = sessionDurationMs(clock);
  if (!isTimedSession(clock) || durationMs === null) return null;

  if (clock.executionMode === "INDIVIDUAL" && clock.pausedAtMs !== null) {
    return Math.max(0, durationMs - clock.consumedMs);
  }

  const deadline = attemptDeadlineMs(clock);
  return deadline === null ? null : Math.max(0, deadline - nowMs);
}

/** True once the server-side deadline has passed. A paused attempt is never overdue. */
export function isAttemptOverdue(clock: AttemptClock, nowMs: number): boolean {
  const deadline = attemptDeadlineMs(clock);
  return deadline !== null && nowMs >= deadline;
}

/** The deadline an Individual attempt gets the moment it starts. */
export function individualDeadlineFrom(timing: SessionTiming, startedAtMs: number): number | null {
  const durationMs = sessionDurationMs(timing);
  if (timing.executionMode !== "INDIVIDUAL" || durationMs === null) return null;
  return startedAtMs + durationMs;
}

/**
 * Freezes an Individual attempt at the moment the Coder went away.
 *
 * What is persisted is the running time already spent — not the pause length.
 * Counting the pause as consumed would make the timer keep running through a
 * disconnect, which is exactly what Individual mode promises not to do.
 */
export function pauseAttemptClock(
  clock: AttemptClock,
  atMs: number,
): { consumedMs: number; pausedAtMs: number } {
  const durationMs = sessionDurationMs(clock) ?? 0;
  const deadline = clock.individualDeadlineAtMs ?? atMs;
  const consumedMs = Math.min(durationMs, Math.max(0, durationMs - (deadline - atMs)));
  return { consumedMs, pausedAtMs: atMs };
}

/**
 * Restarts a paused Individual attempt with exactly the time it had left.
 * The total available time never grows beyond the configured duration.
 */
export function resumeAttemptClock(
  clock: AttemptClock,
  atMs: number,
): { individualDeadlineAtMs: number } {
  const durationMs = sessionDurationMs(clock) ?? 0;
  const remaining = Math.max(0, durationMs - clock.consumedMs);
  return { individualDeadlineAtMs: atMs + remaining };
}

/**
 * Whether an attempt may still take a draft, a Run, or a Submit — and if not,
 * which error explains why. Shared so the HTTP autosave and the socket autosave
 * refuse the same requests with the same words.
 */
export function attemptActivityProblem(input: {
  status: AttemptStatus;
  sessionStatus: AssessmentSessionStatus;
  clock: AttemptClock;
  nowMs: number;
}): "ATTEMPT_ALREADY_SUBMITTED" | "ATTEMPT_EXPIRED" | "SESSION_NOT_RUNNING" | null {
  if (input.status === "SUBMITTED") return "ATTEMPT_ALREADY_SUBMITTED";
  if (input.status !== "IN_PROGRESS") return "ATTEMPT_EXPIRED";
  if (input.sessionStatus !== "RUNNING") return "SESSION_NOT_RUNNING";
  if (isAttemptOverdue(input.clock, input.nowMs)) return "ATTEMPT_EXPIRED";
  return null;
}
