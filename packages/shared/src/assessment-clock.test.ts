import { describe, expect, it } from "vitest";
import {
  attemptActivityProblem,
  attemptDeadlineMs,
  attemptRemainingMs,
  individualDeadlineFrom,
  isAttemptOverdue,
  pauseAttemptClock,
  resumeAttemptClock,
  type AttemptClock,
} from "./assessment-clock";

const MINUTE = 60_000;
const T0 = 1_000_000;

function individual(overrides: Partial<AttemptClock> = {}): AttemptClock {
  return {
    executionMode: "INDIVIDUAL",
    durationMinutes: 30,
    endsAtMs: null,
    individualDeadlineAtMs: T0 + 30 * MINUTE,
    pausedAtMs: null,
    consumedMs: 0,
    ...overrides,
  };
}

describe("individual clock", () => {
  it("starts with the full duration", () => {
    expect(individualDeadlineFrom(individual(), T0)).toBe(T0 + 30 * MINUTE);
    expect(attemptRemainingMs(individual(), T0)).toBe(30 * MINUTE);
  });

  it("persists running time, not pause length, when it pauses", () => {
    const paused = pauseAttemptClock(individual(), T0 + 10 * MINUTE);
    expect(paused.consumedMs).toBe(10 * MINUTE);
    expect(paused.pausedAtMs).toBe(T0 + 10 * MINUTE);
  });

  it("does not tick while paused, however long the pause", () => {
    const clock = individual({ consumedMs: 10 * MINUTE, pausedAtMs: T0 + 10 * MINUTE });
    expect(attemptDeadlineMs(clock)).toBeNull();
    expect(attemptRemainingMs(clock, T0 + 10 * MINUTE)).toBe(20 * MINUTE);
    expect(attemptRemainingMs(clock, T0 + 500 * MINUTE)).toBe(20 * MINUTE);
    expect(isAttemptOverdue(clock, T0 + 500 * MINUTE)).toBe(false);
  });

  it("resumes with exactly the time that was left", () => {
    const clock = individual({ consumedMs: 10 * MINUTE, pausedAtMs: T0 + 10 * MINUTE });
    const resumeAt = T0 + 60 * MINUTE;
    const { individualDeadlineAtMs } = resumeAttemptClock(clock, resumeAt);
    expect(individualDeadlineAtMs).toBe(resumeAt + 20 * MINUTE);
  });

  it("never grants more than the configured duration across many pauses", () => {
    let clock = individual();
    let now = T0;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      now += 4 * MINUTE; // working
      const paused = pauseAttemptClock(clock, now);
      clock = { ...clock, ...paused };
      now += 17 * MINUTE; // away
      const resumed = resumeAttemptClock(clock, now);
      clock = {
        ...clock,
        individualDeadlineAtMs: resumed.individualDeadlineAtMs,
        pausedAtMs: null,
      };
    }
    // 5 cycles x 4 minutes worked = 20 of 30 minutes consumed.
    expect(clock.consumedMs).toBe(20 * MINUTE);
    expect(attemptRemainingMs(clock, now)).toBe(10 * MINUTE);
  });

  it("clamps a pause that lands after the deadline to the full duration", () => {
    const paused = pauseAttemptClock(individual(), T0 + 45 * MINUTE);
    expect(paused.consumedMs).toBe(30 * MINUTE);
  });

  it("is overdue once the deadline passes", () => {
    expect(isAttemptOverdue(individual(), T0 + 30 * MINUTE - 1)).toBe(false);
    expect(isAttemptOverdue(individual(), T0 + 30 * MINUTE)).toBe(true);
  });
});

describe("live clock", () => {
  const live: AttemptClock = {
    executionMode: "LIVE",
    durationMinutes: 30,
    endsAtMs: T0 + 30 * MINUTE,
    individualDeadlineAtMs: null,
    pausedAtMs: null,
    consumedMs: 0,
  };

  it("uses the session's global deadline", () => {
    expect(attemptDeadlineMs(live)).toBe(T0 + 30 * MINUTE);
  });

  it("gives a late joiner only the remaining global time", () => {
    expect(attemptRemainingMs(live, T0 + 25 * MINUTE)).toBe(5 * MINUTE);
  });

  it("has no individual deadline to start", () => {
    expect(individualDeadlineFrom(live, T0)).toBeNull();
  });
});

describe("untimed clock", () => {
  const untimed: AttemptClock = {
    executionMode: null,
    durationMinutes: null,
    endsAtMs: null,
    individualDeadlineAtMs: null,
    pausedAtMs: null,
    consumedMs: 0,
  };

  it("has no deadline and is never overdue", () => {
    expect(attemptDeadlineMs(untimed)).toBeNull();
    expect(attemptRemainingMs(untimed, T0)).toBeNull();
    expect(isAttemptOverdue(untimed, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("attemptActivityProblem", () => {
  const base = {
    status: "IN_PROGRESS" as const,
    sessionStatus: "RUNNING" as const,
    clock: individual(),
    nowMs: T0,
  };

  it("accepts a running attempt inside its time", () => {
    expect(attemptActivityProblem(base)).toBeNull();
  });

  it("names the reason an attempt no longer accepts work", () => {
    expect(attemptActivityProblem({ ...base, status: "SUBMITTED" })).toBe(
      "ATTEMPT_ALREADY_SUBMITTED",
    );
    expect(attemptActivityProblem({ ...base, status: "EXPIRED" })).toBe("ATTEMPT_EXPIRED");
    expect(attemptActivityProblem({ ...base, sessionStatus: "ENDED" })).toBe("SESSION_NOT_RUNNING");
    expect(attemptActivityProblem({ ...base, nowMs: T0 + 31 * MINUTE })).toBe("ATTEMPT_EXPIRED");
  });
});
