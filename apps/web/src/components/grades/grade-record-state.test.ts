import { describe, expect, it } from "vitest";
import type { GradeAttemptView } from "@ambatucode/shared";
import { needsOfficialChoice, unsubmittedAttemptLabel } from "./grade-record-state";

function attempt(overrides: Partial<GradeAttemptView> = {}): GradeAttemptView {
  return {
    id: "at1",
    attemptNumber: 1,
    status: "SUBMITTED",
    isOfficial: false,
    startedAt: "2026-09-01T10:00:00.000Z",
    consumedMs: 0,
    resetAt: null,
    resetReason: null,
    resetByDisplayName: null,
    submission: {
      id: "sub1",
      status: "GRADED",
      score: 70,
      language: "python",
      isAutoSubmitted: false,
      submittedAt: "2026-09-01T10:10:00.000Z",
      gradedAt: "2026-09-01T10:10:05.000Z",
      executionTimeMs: 120,
      memoryUsedKb: 4_096,
    },
    ...overrides,
  };
}

describe("needsOfficialChoice", () => {
  it("asks for a choice after a reset left submitted work and no official attempt", () => {
    expect(
      needsOfficialChoice({
        officialAttemptId: null,
        attempts: [
          attempt({ status: "RESET" }),
          attempt({ id: "at2", status: "NOT_STARTED", submission: null }),
        ],
      }),
    ).toBe(true);
  });

  it("does not ask when there is nothing submitted to choose between", () => {
    expect(
      needsOfficialChoice({
        officialAttemptId: null,
        attempts: [
          attempt({ status: "RESET", submission: null }),
          attempt({ id: "at2", status: "IN_PROGRESS", submission: null }),
        ],
      }),
    ).toBe(false);
  });

  it("does not ask once an attempt is official", () => {
    expect(
      needsOfficialChoice({ officialAttemptId: "at1", attempts: [attempt({ isOfficial: true })] }),
    ).toBe(false);
  });
});

describe("unsubmittedAttemptLabel", () => {
  it("says a Coder mid-attempt is in progress, not that they failed to submit", () => {
    expect(unsubmittedAttemptLabel("IN_PROGRESS")).toBe("In progress");
  });

  it("keeps the end states plain", () => {
    expect(unsubmittedAttemptLabel("NOT_STARTED")).toBe("Not started");
    expect(unsubmittedAttemptLabel("EXPIRED")).toBe("No submission");
    expect(unsubmittedAttemptLabel("RESET")).toBe("No submission");
  });
});
