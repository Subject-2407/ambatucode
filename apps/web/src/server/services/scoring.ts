import type { GradingStrategy, SubmissionStatus } from "@ambatucode/shared";

export type ScoredResult = { passed: boolean; weight: number };

/**
 * An attempt score, 0 to 100, from what the worker reported.
 *
 * Pure so the rule can be tested exhaustively without a database; the only
 * caller is result ingestion, which persists the number this returns.
 *
 * - A limit hit or a crash is a failed case, not a failed submission. The
 *   worker runs every remaining case after one exceeds its time or memory or
 *   crashes, and reports the most severe case status as the submission's, so
 *   those statuses still score the cases that passed — the average success
 *   across cases the grading rule calls for.
 * - COMPILE_ERROR and SYSTEM_ERROR score 0. Nothing was judged: the program
 *   never built, or the platform failed before it could say.
 * - Weight 0 means "shown, not counted". When every case weighs 0 the weights
 *   carry no information, so every case counts equally instead of the
 *   submission scoring on a 0/0 fraction.
 * - A GRADED result with no rows at all scores 0: there was nothing to pass.
 */
const SCORED_STATUSES: ReadonlySet<SubmissionStatus> = new Set([
  "GRADED",
  "RUNTIME_ERROR",
  "TIME_LIMIT_EXCEEDED",
  "MEMORY_LIMIT_EXCEEDED",
]);

export function computeScore(
  strategy: GradingStrategy,
  status: SubmissionStatus,
  results: readonly ScoredResult[],
): number {
  if (!SCORED_STATUSES.has(status) || results.length === 0) return 0;

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
