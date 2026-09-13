import type { GradingStrategy, SubmissionStatus } from "@ambatucode/shared";

export type ScoredResult = { passed: boolean; weight: number };

/**
 * An attempt score, 0 to 100, from what the worker reported.
 *
 * Pure so the rule can be tested exhaustively without a database; the only
 * caller is result ingestion, which persists the number this returns.
 *
 * - Anything but GRADED scores 0. A program that did not compile, crashed, or
 *   ran out of time earned nothing, and its partial per-case rows are recorded
 *   for the Architect rather than counted.
 * - Weight 0 means "shown, not counted". When every case weighs 0 the weights
 *   carry no information, so every case counts equally instead of the
 *   submission scoring on a 0/0 fraction.
 * - A GRADED result with no rows at all scores 0: there was nothing to pass.
 */
export function computeScore(
  strategy: GradingStrategy,
  status: SubmissionStatus,
  results: readonly ScoredResult[],
): number {
  if (status !== "GRADED" || results.length === 0) return 0;

  const weighted = results.filter((result) => result.weight > 0);
  const counted =
    weighted.length > 0 ? weighted : results.map((result) => ({ ...result, weight: 1 }));

  if (strategy === "ALL_OR_NOTHING") {
    return counted.every((result) => result.passed) ? 100 : 0;
  }

  const total = counted.reduce((sum, result) => sum + result.weight, 0);
  const earned = counted
    .filter((result) => result.passed)
    .reduce((sum, result) => sum + result.weight, 0);
  return Math.round((100 * earned) / total);
}
