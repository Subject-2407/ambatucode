import type { LeaderboardRow } from "@ambatucode/shared";

/**
 * Turning official scores into a ranking.
 *
 * Pure, and separate from the queries that feed it, because the ordering is a
 * product decision rather than a database detail — and because the cases worth
 * being sure about are the awkward ones: two Coders on the same total, a Coder
 * whose submission has no recorded execution time, a board where nobody has
 * finished anything.
 *
 * The rule, in order:
 *
 * 1. Higher total first. A Coder's total is the sum of their official scores
 *    across the assessments the board counts, so breadth is rewarded and an
 *    assessment nobody has taken costs nobody anything.
 * 2. Then whoever assembled that total earliest. This is the "submission
 *    speed" FR-GAME-01 allows, measured where it means something — across the
 *    whole board rather than on one problem.
 * 3. Then whose code ran faster in total.
 * 4. Then by username, so the order never depends on map iteration. Without a
 *    final tiebreak two equal rows can swap places between refreshes, which
 *    reads as a broken board.
 *
 * Equal totals share a rank and the next rank skips, the way a standings table
 * works: two Coders on 180 are both second, and the next is fourth.
 */

export type Contribution = {
  score: number;
  submittedAtMs: number;
  executionTimeMs: number | null;
};

export type Competitor = {
  userId: string;
  username: string;
  displayName: string;
  contributions: readonly Contribution[];
};

export function rankCompetitors(competitors: readonly Competitor[]): LeaderboardRow[] {
  const totals = competitors.map((competitor) => {
    const parts = competitor.contributions;
    const executionTimes = parts
      .map((part) => part.executionTimeMs)
      .filter((value): value is number => value !== null);

    return {
      userId: competitor.userId,
      username: competitor.username,
      displayName: competitor.displayName,
      score: parts.reduce((sum, part) => sum + part.score, 0),
      assessmentsCounted: parts.length,
      // The last contribution to land: the moment this total was complete.
      submittedAt: parts.length === 0 ? null : Math.max(...parts.map((part) => part.submittedAtMs)),
      totalExecutionTimeMs:
        executionTimes.length === 0
          ? null
          : executionTimes.reduce((sum, value) => sum + value, 0),
    };
  });

  totals.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    // A missing measurement never wins a tiebreak it cannot claim.
    const leftAt = left.submittedAt ?? Number.POSITIVE_INFINITY;
    const rightAt = right.submittedAt ?? Number.POSITIVE_INFINITY;
    if (leftAt !== rightAt) return leftAt - rightAt;
    const leftMs = left.totalExecutionTimeMs ?? Number.POSITIVE_INFINITY;
    const rightMs = right.totalExecutionTimeMs ?? Number.POSITIVE_INFINITY;
    if (leftMs !== rightMs) return leftMs - rightMs;
    return left.username.localeCompare(right.username);
  });

  let lastScore: number | null = null;
  let lastRank = 0;
  return totals.map((row, index) => {
    const rank = row.score === lastScore ? lastRank : index + 1;
    lastScore = row.score;
    lastRank = rank;
    return { ...row, rank };
  });
}

/**
 * The best official score this Coder holds for each assessment.
 *
 * A Coder normally has one session per assessment. When an Architect runs a
 * remedial session as well they have two, each with its own official attempt —
 * the higher is taken, because both are official results of the same
 * assessment and ranking someone on the lower one would be arbitrary.
 */
export function bestPerAssessment(
  rows: ReadonlyArray<{ assessmentId: string } & Contribution>,
): Contribution[] {
  const best = new Map<string, Contribution>();
  for (const row of rows) {
    const current = best.get(row.assessmentId);
    if (current === undefined || row.score > current.score) {
      best.set(row.assessmentId, {
        score: row.score,
        submittedAtMs: row.submittedAtMs,
        executionTimeMs: row.executionTimeMs,
      });
    }
  }
  return [...best.values()];
}
