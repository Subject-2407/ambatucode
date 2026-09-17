import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@ambatucode/shared";
import {
  FINAL_STRETCH_MS,
  PRACTICE_RULES,
  SUBMISSION_RULES,
  assertRuleCoverage,
  type SubmissionContext,
} from "./achievement-rules";

/**
 * An award is permanent, so a rule that fires wrongly once is wrong forever.
 * These pin the boundaries: the submission one millisecond outside the final
 * stretch, the assessment with too few submissions for a "fastest tenth" to
 * mean anything, the reset attempt that must not count as a first try.
 */

const BASE: SubmissionContext = {
  submission: {
    score: 100,
    status: "GRADED",
    language: "python",
    submittedAtMs: 1_000_000,
    executionTimeMs: 120,
    memoryUsedKb: 4_096,
  },
  attempt: {
    attemptNumber: 1,
    runCount: 3,
    consumedMs: 600_000,
    deadlineMs: 2_000_000,
    durationMs: 1_800_000,
  },
  assessment: {
    isTimed: true,
    isLive: false,
    detectsFocusLoss: false,
    caseCount: 4,
    hiddenCaseCount: 2,
  },
  derived: {
    executionTimeQuantile: 0.5,
    memoryQuantile: 0.5,
    scriptTestCount: 0,
    scriptTestsPassed: 0,
    caseResultCount: 4,
    caseResultsPassed: 4,
    perfectStreak: 1,
    languagesGraded: 1,
    isFirstGraded: false,
    isFirstPerfectInSession: false,
    bestEarlierAttemptScore: null,
    worstEarlierAttemptScore: null,
    reconnected: false,
    focusLostCount: 0,
    sessionParticipantCount: 0,
    sectionSwept: false,
    moduleCleared: false,
  },
};

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

function context(overrides: DeepPartial<SubmissionContext>): SubmissionContext {
  return {
    submission: { ...BASE.submission, ...overrides.submission },
    attempt: { ...BASE.attempt, ...overrides.attempt },
    assessment: { ...BASE.assessment, ...overrides.assessment },
    derived: { ...BASE.derived, ...overrides.derived },
  };
}

function fires(code: string, overrides: DeepPartial<SubmissionContext> = {}): boolean {
  const rule = SUBMISSION_RULES[code];
  if (rule === undefined) throw new Error(`No rule registered for ${code}`);
  return rule(context(overrides));
}

describe("rule coverage", () => {
  it("has exactly one rule for every achievement in the catalogue", () => {
    expect(() => assertRuleCoverage()).not.toThrow();
  });

  it("registers a rule for each catalogue code", () => {
    const registered = new Set([...Object.keys(SUBMISSION_RULES), ...Object.keys(PRACTICE_RULES)]);
    for (const achievement of ACHIEVEMENTS) {
      expect(registered.has(achievement.code), achievement.code).toBe(true);
    }
  });
});

describe("precision rules", () => {
  it("awards Strategic Sniper only on a first attempt in the fastest tenth", () => {
    expect(fires("STRATEGIC_SNIPER", { derived: { executionTimeQuantile: 0.05 } })).toBe(true);
    expect(fires("STRATEGIC_SNIPER", { derived: { executionTimeQuantile: 0.11 } })).toBe(false);
    expect(
      fires("STRATEGIC_SNIPER", {
        attempt: { attemptNumber: 2 },
        derived: { executionTimeQuantile: 0.01 },
      }),
    ).toBe(false);
  });

  it("does not award a quantile rule when the sample was too small to rank", () => {
    // The context builder reports null rather than inventing a ranking.
    expect(fires("STRATEGIC_SNIPER", { derived: { executionTimeQuantile: null } })).toBe(false);
    expect(fires("OPTIMIZER", { derived: { executionTimeQuantile: null } })).toBe(false);
    expect(fires("LIGHT_FOOTPRINT", { derived: { memoryQuantile: null } })).toBe(false);
  });

  it("awards Flawless Run only when hidden cases existed and all cases passed", () => {
    expect(fires("FLAWLESS_RUN")).toBe(true);
    expect(fires("FLAWLESS_RUN", { assessment: { hiddenCaseCount: 0 } })).toBe(false);
    expect(fires("FLAWLESS_RUN", { derived: { caseResultsPassed: 3 } })).toBe(false);
  });

  it("awards Unbroken on the third consecutive perfect score, not the second", () => {
    expect(fires("PERFECT_STREAK", { derived: { perfectStreak: 2 } })).toBe(false);
    expect(fires("PERFECT_STREAK", { derived: { perfectStreak: 3 } })).toBe(true);
  });

  it("treats any attempt past the first as granted by a reset", () => {
    expect(fires("SECOND_WIND")).toBe(false);
    expect(fires("SECOND_WIND", { attempt: { attemptNumber: 2 } })).toBe(true);
  });

  it("awards Cold Start only when no Run was used", () => {
    expect(fires("COLD_START")).toBe(false);
    expect(fires("COLD_START", { attempt: { runCount: 0 } })).toBe(true);
    // A perfect score is the other half; an unrun failure is not a cold start.
    expect(fires("COLD_START", { attempt: { runCount: 0 }, submission: { score: 90 } })).toBe(
      false,
    );
  });
});

describe("timing rules", () => {
  it("awards The Blood Hunter inside the final minute and not outside it", () => {
    const at = (remaining: number) => ({
      submission: { submittedAtMs: BASE.attempt.deadlineMs! - remaining },
    });
    expect(fires("BLOOD_HUNTER", at(FINAL_STRETCH_MS))).toBe(true);
    expect(fires("BLOOD_HUNTER", at(1))).toBe(true);
    expect(fires("BLOOD_HUNTER", at(FINAL_STRETCH_MS + 1))).toBe(false);
  });

  it("refuses The Blood Hunter for a single-case assessment", () => {
    expect(
      fires("BLOOD_HUNTER", {
        assessment: { caseCount: 1 },
        submission: { submittedAtMs: BASE.attempt.deadlineMs! - 5_000 },
      }),
    ).toBe(false);
  });

  it("refuses The Blood Hunter on an untimed assessment", () => {
    expect(fires("BLOOD_HUNTER", { attempt: { deadlineMs: null, durationMs: null } })).toBe(false);
  });

  it("awards Speed Demon at a quarter of the clock and not a moment past it", () => {
    expect(fires("SPEED_DEMON", { attempt: { consumedMs: 450_000 } })).toBe(true);
    expect(fires("SPEED_DEMON", { attempt: { consumedMs: 450_001 } })).toBe(false);
  });

  it("awards Marathoner for a long, good-enough attempt", () => {
    const late = { attempt: { consumedMs: 1_740_000 } };
    expect(fires("MARATHONER", { ...late, submission: { score: 80 } })).toBe(true);
    expect(fires("MARATHONER", { ...late, submission: { score: 79 } })).toBe(false);
    expect(fires("MARATHONER", { attempt: { consumedMs: 1_000_000 } })).toBe(false);
  });

  it("awards Early Bird only to the first perfect score in the session", () => {
    expect(fires("EARLY_BIRD")).toBe(false);
    expect(fires("EARLY_BIRD", { derived: { isFirstPerfectInSession: true } })).toBe(true);
  });
});

describe("craft and breadth rules", () => {
  it("does not award a script rule when no script ran", () => {
    expect(fires("THE_ARCHITECT")).toBe(false);
    expect(fires("TEST_WHISPERER")).toBe(false);
  });

  it("awards The Architect when every script test passed", () => {
    const all = { derived: { scriptTestCount: 6, scriptTestsPassed: 6 } };
    expect(fires("THE_ARCHITECT", all)).toBe(true);
    expect(fires("THE_ARCHITECT", { derived: { scriptTestCount: 6, scriptTestsPassed: 5 } })).toBe(
      false,
    );
  });

  it("restricts Test Whisperer to a first attempt", () => {
    const all = { derived: { scriptTestCount: 6, scriptTestsPassed: 6 } };
    expect(fires("TEST_WHISPERER", all)).toBe(true);
    expect(fires("TEST_WHISPERER", { ...all, attempt: { attemptNumber: 2 } })).toBe(false);
  });

  it("counts distinct languages for Polyglot and Full Spectrum", () => {
    expect(fires("POLYGLOT", { derived: { languagesGraded: 2 } })).toBe(false);
    expect(fires("POLYGLOT", { derived: { languagesGraded: 3 } })).toBe(true);
    expect(fires("FULL_SPECTRUM", { derived: { languagesGraded: 3 } })).toBe(false);
    expect(fires("FULL_SPECTRUM", { derived: { languagesGraded: 4 } })).toBe(true);
  });
});

describe("grit and progress rules", () => {
  it("awards Comeback Kid on a forty-point improvement", () => {
    expect(
      fires("COMEBACK_KID", { submission: { score: 80 }, derived: { bestEarlierAttemptScore: 40 } }),
    ).toBe(true);
    expect(
      fires("COMEBACK_KID", { submission: { score: 79 }, derived: { bestEarlierAttemptScore: 40 } }),
    ).toBe(false);
    // No earlier attempt is no comeback.
    expect(fires("COMEBACK_KID")).toBe(false);
  });

  it("awards Iron Will only when an earlier attempt really was poor", () => {
    expect(fires("IRON_WILL", { derived: { worstEarlierAttemptScore: 49 } })).toBe(true);
    expect(fires("IRON_WILL", { derived: { worstEarlierAttemptScore: 50 } })).toBe(false);
    expect(fires("IRON_WILL")).toBe(false);
  });

  it("awards Unshaken for finishing well through a reconnect", () => {
    expect(fires("UNSHAKEN", { derived: { reconnected: true } })).toBe(true);
    expect(fires("UNSHAKEN")).toBe(false);
    expect(fires("UNSHAKEN", { submission: { score: 79 }, derived: { reconnected: true } })).toBe(
      false,
    );
  });

  it("awards First Light once", () => {
    expect(fires("FIRST_LIGHT", { derived: { isFirstGraded: true } })).toBe(true);
    expect(fires("FIRST_LIGHT")).toBe(false);
  });
});

describe("live session rules", () => {
  it("awards Under Pressure only in a live session with a real crowd", () => {
    const live = { assessment: { isLive: true }, derived: { sessionParticipantCount: 10 } };
    expect(fires("UNDER_PRESSURE", live)).toBe(true);
    expect(
      fires("UNDER_PRESSURE", { ...live, derived: { sessionParticipantCount: 9 } }),
    ).toBe(false);
    expect(fires("UNDER_PRESSURE", { derived: { sessionParticipantCount: 30 } })).toBe(false);
  });

  it("awards Eyes Forward only when focus monitoring was actually on", () => {
    expect(fires("EYES_FORWARD", { assessment: { detectsFocusLoss: true } })).toBe(true);
    // Monitoring off means there is nothing to have resisted.
    expect(fires("EYES_FORWARD")).toBe(false);
    expect(
      fires("EYES_FORWARD", {
        assessment: { detectsFocusLoss: true },
        derived: { focusLostCount: 1 },
      }),
    ).toBe(false);
  });
});

describe("non-graded submissions", () => {
  it("awards nothing that depends on a score when the program never built", () => {
    const failed: DeepPartial<SubmissionContext> = {
      submission: { status: "COMPILE_ERROR", score: 0 },
    };
    for (const code of ["STRATEGIC_SNIPER", "FLAWLESS_RUN", "SPEED_DEMON", "FIRST_LIGHT"]) {
      expect(fires(code, { ...failed, derived: { ...BASE.derived, isFirstGraded: true } }), code).toBe(
        false,
      );
    }
  });
});

describe("practice rules", () => {
  it("awards Drill Sergeant at fifty runs", () => {
    expect(PRACTICE_RULES.DRILL_SERGEANT!({ runCount: 49, masteredCount: 0 })).toBe(false);
    expect(PRACTICE_RULES.DRILL_SERGEANT!({ runCount: 50, masteredCount: 0 })).toBe(true);
  });

  it("awards Student of the Game at ten mastered activities", () => {
    expect(PRACTICE_RULES.STUDENT_OF_THE_GAME!({ runCount: 0, masteredCount: 9 })).toBe(false);
    expect(PRACTICE_RULES.STUDENT_OF_THE_GAME!({ runCount: 0, masteredCount: 10 })).toBe(true);
  });
});
