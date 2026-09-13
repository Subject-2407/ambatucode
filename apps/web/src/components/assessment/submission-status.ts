import { isTerminalSubmissionStatus, type SubmissionStatus } from "@ambatucode/shared";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * How a formal Submission reads while the pipeline works and once it is done.
 *
 * Separate from the Run vocabulary in `components/content/run-status.ts`,
 * because the two answer different questions. A Run asks "did my program do
 * what I expected"; a Submission asks "what did this earn", and only the
 * latter has a score to colour.
 */

const STATUS_LABEL: Readonly<Record<SubmissionStatus, string>> = {
  QUEUED: "Queued",
  RUNNING: "Grading",
  GRADED: "Graded",
  COMPILE_ERROR: "Compile error",
  RUNTIME_ERROR: "Runtime error",
  TIME_LIMIT_EXCEEDED: "Time limit exceeded",
  MEMORY_LIMIT_EXCEEDED: "Memory limit exceeded",
  SYSTEM_ERROR: "System error",
};

/** What the Coder is told is happening, in the present tense while it runs. */
const STATUS_DETAIL: Readonly<Record<SubmissionStatus, string>> = {
  QUEUED: "Your submission is waiting for an execution slot.",
  RUNNING: "Your submission is being graded.",
  GRADED: "Grading finished.",
  COMPILE_ERROR: "Your program did not compile, so no cases could run.",
  RUNTIME_ERROR: "Your program stopped with an error while running.",
  TIME_LIMIT_EXCEEDED: "Your program ran past the time limit.",
  MEMORY_LIMIT_EXCEEDED: "Your program used more memory than allowed.",
  SYSTEM_ERROR: "Something went wrong on the platform's side, not in your code.",
};

export type SubmissionSummaryView = {
  label: string;
  detail: string;
  tone: BadgeTone;
  /** True once the pipeline will not change this status again. */
  settled: boolean;
};

/**
 * A graded submission is coloured by what it earned, not merely by having
 * finished. Full marks read as success, a partial score as a warning, and
 * nothing at all as danger — a Coder who scored zero should not be shown the
 * same green badge as one who scored a hundred just because both "completed".
 */
export function describeSubmission(
  status: SubmissionStatus,
  score: number | null,
): SubmissionSummaryView {
  const base = { label: STATUS_LABEL[status], detail: STATUS_DETAIL[status] };
  const settled = isTerminalSubmissionStatus(status);

  if (!settled) {
    return { ...base, tone: status === "RUNNING" ? "info" : "neutral", settled };
  }

  if (status !== "GRADED") return { ...base, tone: "danger", settled };

  if (score === null) return { ...base, tone: "neutral", settled };
  const tone: BadgeTone = score >= 100 ? "success" : score > 0 ? "warning" : "danger";
  return { label: `Graded — ${String(score)}/100`, detail: base.detail, tone, settled };
}
