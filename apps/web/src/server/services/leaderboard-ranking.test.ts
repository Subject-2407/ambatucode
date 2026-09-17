import { describe, expect, it } from "vitest";
import { bestPerAssessment, rankCompetitors, type Competitor } from "./leaderboard-ranking";

/**
 * The ordering is a product decision, and the cases that matter are the
 * awkward ones: two Coders on the same total, a submission with no recorded
 * execution time, and a board where the order must not change between two
 * reads of the same data.
 */

function competitor(
  username: string,
  contributions: Array<[score: number, submittedAtMs: number, executionTimeMs?: number | null]>,
): Competitor {
  return {
    userId: `u-${username}`,
    username,
    displayName: username.toUpperCase(),
    contributions: contributions.map(([score, submittedAtMs, executionTimeMs = 100]) => ({
      score,
      submittedAtMs,
      executionTimeMs,
    })),
  };
}

describe("rankCompetitors", () => {
  it("puts the higher total first", () => {
    const rows = rankCompetitors([
      competitor("beth", [[50, 1_000]]),
      competitor("alan", [[90, 1_000]]),
    ]);
    expect(rows.map((row) => row.username)).toEqual(["alan", "beth"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
  });

  it("sums across assessments, so breadth beats a single high score", () => {
    const rows = rankCompetitors([
      competitor("specialist", [[100, 1_000]]),
      competitor("generalist", [
        [60, 1_000],
        [60, 2_000],
      ]),
    ]);
    expect(rows[0]?.username).toBe("generalist");
    expect(rows[0]?.score).toBe(120);
    expect(rows[0]?.assessmentsCounted).toBe(2);
  });

  it("breaks a tie on who assembled the total first", () => {
    const rows = rankCompetitors([
      competitor("late", [[80, 5_000]]),
      competitor("early", [[80, 2_000]]),
    ]);
    expect(rows.map((row) => row.username)).toEqual(["early", "late"]);
  });

  it("breaks a remaining tie on total execution time", () => {
    const rows = rankCompetitors([
      competitor("slow", [[80, 2_000, 900]]),
      competitor("fast", [[80, 2_000, 100]]),
    ]);
    expect(rows.map((row) => row.username)).toEqual(["fast", "slow"]);
  });

  it("never lets a missing measurement win a tiebreak", () => {
    const rows = rankCompetitors([
      competitor("unmeasured", [[80, 2_000, null]]),
      competitor("measured", [[80, 2_000, 900]]),
    ]);
    expect(rows.map((row) => row.username)).toEqual(["measured", "unmeasured"]);
  });

  it("orders identical rows deterministically", () => {
    const pair = [competitor("zoe", [[80, 2_000, 100]]), competitor("amir", [[80, 2_000, 100]])];
    expect(rankCompetitors(pair).map((row) => row.username)).toEqual(["amir", "zoe"]);
    // The same data in the other order produces the same board.
    expect(rankCompetitors([...pair].reverse()).map((row) => row.username)).toEqual(["amir", "zoe"]);
  });

  it("shares a rank on an equal total and skips the next", () => {
    const rows = rankCompetitors([
      competitor("alan", [[100, 1_000]]),
      competitor("beth", [[80, 1_000]]),
      competitor("carl", [[80, 1_000]]),
      competitor("dina", [[10, 1_000]]),
    ]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it("reports a Coder with nothing counted rather than dropping them", () => {
    const rows = rankCompetitors([competitor("nobody", [])]);
    expect(rows[0]).toMatchObject({
      score: 0,
      assessmentsCounted: 0,
      submittedAt: null,
      totalExecutionTimeMs: null,
      rank: 1,
    });
  });

  it("returns an empty board for no competitors", () => {
    expect(rankCompetitors([])).toEqual([]);
  });
});

describe("bestPerAssessment", () => {
  it("keeps the higher score when a Coder sat the same assessment twice", () => {
    // Two sessions of one assessment — a class and a remedial sitting.
    const best = bestPerAssessment([
      { assessmentId: "a1", score: 40, submittedAtMs: 1_000, executionTimeMs: 50 },
      { assessmentId: "a1", score: 85, submittedAtMs: 9_000, executionTimeMs: 70 },
    ]);
    expect(best).toHaveLength(1);
    expect(best[0]?.score).toBe(85);
    expect(best[0]?.submittedAtMs).toBe(9_000);
  });

  it("keeps one entry per assessment", () => {
    const best = bestPerAssessment([
      { assessmentId: "a1", score: 40, submittedAtMs: 1_000, executionTimeMs: null },
      { assessmentId: "a2", score: 60, submittedAtMs: 2_000, executionTimeMs: null },
    ]);
    expect(best.map((entry) => entry.score).sort((a, b) => a - b)).toEqual([40, 60]);
  });
});
