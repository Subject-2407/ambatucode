import {
  FREE_RUN_RESULT_NAME,
  type RunTestResultView,
  type SubmissionStatus,
  type TestResultStatus,
} from "@ambatucode/shared";
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

/**
 * A Run with no sample case returns one row holding what the program printed.
 * With nothing to compare against it is neither passed nor failed, so it is
 * worded as finished and never counted.
 */
export function isFreeRunResult(result: Pick<RunTestResultView, "name">): boolean {
  return result.name === FREE_RUN_RESULT_NAME;
}

export function describeRun(status: SubmissionStatus, results: RunTestResultView[]): RunSummary {
  if (results.length === 1 && results[0] !== undefined && isFreeRunResult(results[0])) {
    const finished = status === "GRADED";
    return {
      label: STATUS_LABEL[status],
      tone: finished ? "success" : "danger",
      passed: 0,
      total: 0,
      allPassed: false,
    };
  }

  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const allPassed = total > 0 && passed === total;

  if (status === "QUEUED" || status === "RUNNING") {
    return { label: STATUS_LABEL[status], tone: "info", passed, total, allPassed: false };
  }

  if (status !== "GRADED") {
    // A limit or crash on one case no longer stops the rest, so a run can end
    // badly and still have passed cases worth counting.
    const label =
      total === 0 || status === "COMPILE_ERROR" || status === "SYSTEM_ERROR"
        ? STATUS_LABEL[status]
        : `${STATUS_LABEL[status]} · ${String(passed)} of ${String(total)} passed`;
    return { label, tone: "danger", passed, total, allPassed: false };
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

/**
 * The word shown beside one case. A case that failed because it hit a limit
 * says which, rather than a bare "Failed" that reads like a wrong answer.
 */
export function describeCaseOutcome(result: {
  name?: string;
  passed: boolean;
  status: TestResultStatus | null;
}): string {
  if (result.name === FREE_RUN_RESULT_NAME) {
    return result.passed || result.status === null ? "Finished" : STATUS_LABEL[result.status];
  }
  if (result.passed) return "Passed";
  if (result.status === null || result.status === "GRADED") return "Failed";
  return STATUS_LABEL[result.status];
}

/** True when the panel should show the compiler's own words instead of cases. */
export function shouldShowCompilerOutput(
  status: SubmissionStatus,
  compilerOutput: string | null,
): boolean {
  return compilerOutput !== null && compilerOutput.trim() !== "" && status !== "GRADED";
}

/**
 * Drops the line a JVM prints to stderr on every launch when the sandbox image
 * sets JAVA_TOOL_OPTIONS. It says nothing about the Coder's program, and left
 * in it makes stderr look like a failure on every Java run.
 */
export function withoutRuntimeNotice(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !/^Picked up (?:JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS): /.test(line))
    .join("\n");
}
