import type { RunTestResultView, SubmissionStatus } from "@ambatucode/shared";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * How an execution status reads on screen.
 *
 * Kept apart from the panel so the vocabulary is defined once and can be
 * checked without rendering anything. GRADED is deliberately absent: it means
 * the code ran to completion, not that the tests passed, so its wording
 * depends on the results and is decided by `describeRun` below.
 */
const STATUS_LABEL: Readonly<Record<SubmissionStatus, string>> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  GRADED: "Finished",
  COMPILE_ERROR: "Compile error",
  RUNTIME_ERROR: "Runtime error",
  TIME_LIMIT_EXCEEDED: "Time limit exceeded",
  MEMORY_LIMIT_EXCEEDED: "Memory limit exceeded",
  SYSTEM_ERROR: "System error",
};

export type RunSummary = {
  label: string;
  tone: BadgeTone;
  passed: number;
  total: number;
  /** True only when there was something to check and all of it passed. */
  allPassed: boolean;
};

export function describeRun(status: SubmissionStatus, results: RunTestResultView[]): RunSummary {
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const allPassed = total > 0 && passed === total;

  if (status === "QUEUED" || status === "RUNNING") {
    return { label: STATUS_LABEL[status], tone: "info", passed, total, allPassed: false };
  }

  if (status !== "GRADED") {
    return { label: STATUS_LABEL[status], tone: "danger", passed, total, allPassed: false };
  }

  // The program ran. Whether that is good news is a question about the cases.
  return {
    label: total === 0 ? "Finished" : `${String(passed)} of ${String(total)} passed`,
    tone: allPassed ? "success" : "danger",
    passed,
    total,
    allPassed,
  };
}

/** True when the panel should show the compiler's own words instead of cases. */
export function shouldShowCompilerOutput(
  status: SubmissionStatus,
  compilerOutput: string | null,
): boolean {
  return compilerOutput !== null && compilerOutput.trim() !== "" && status !== "GRADED";
}
