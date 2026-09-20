import { describe, expect, it } from "vitest";
import type { RunTestResultView } from "@ambatucode/shared";
import { describeCaseOutcome, describeRun, withoutRuntimeNotice } from "./run-status";

function row(passed: boolean, status: RunTestResultView["status"] = "GRADED"): RunTestResultView {
  return { name: "case", status, passed, executionTimeMs: 1, stdoutExcerpt: "", stderrExcerpt: "" };
}

describe("describeRun", () => {
  it("counts passed cases for a run that finished", () => {
    expect(describeRun("GRADED", [row(true), row(false)]).label).toBe("1 of 2 passed");
  });

  // A limit on one case no longer ends the run, so the others still count.
  it("keeps the pass count beside a limit hit on some cases", () => {
    const summary = describeRun("TIME_LIMIT_EXCEEDED", [
      row(true),
      row(true),
      row(false, "TIME_LIMIT_EXCEEDED"),
    ]);
    expect(summary.label).toBe("Time limit exceeded · 2 of 3 passed");
    expect(summary.tone).toBe("danger");
  });

  it("shows no count when nothing could run", () => {
    expect(describeRun("COMPILE_ERROR", []).label).toBe("Compile error");
  });
});

describe("describeCaseOutcome", () => {
  it("names the limit a failed case hit instead of a bare failure", () => {
    expect(describeCaseOutcome(row(false, "MEMORY_LIMIT_EXCEEDED"))).toBe("Memory limit exceeded");
    expect(describeCaseOutcome(row(false, "RUNTIME_ERROR"))).toBe("Runtime error");
  });

  it("reads a wrong answer, or an unrecorded status, as failed", () => {
    expect(describeCaseOutcome(row(false))).toBe("Failed");
    expect(describeCaseOutcome({ passed: false, status: null })).toBe("Failed");
    expect(describeCaseOutcome(row(true))).toBe("Passed");
  });
});

describe("withoutRuntimeNotice", () => {
  it("drops the JVM launch notice and keeps the program's own errors", () => {
    const stderr =
      "Picked up JAVA_TOOL_OPTIONS: -Djava.awt.headless=true\nException in thread \"main\" boom";
    expect(withoutRuntimeNotice(stderr)).toBe('Exception in thread "main" boom');
  });

  it("leaves stderr without the notice untouched", () => {
    expect(withoutRuntimeNotice("Picked up nothing")).toBe("Picked up nothing");
  });
});

describe("a Run with no sample case", () => {
  const output = { ...row(true), name: "Program output" };

  it("reads as finished, never as a pass count", () => {
    const summary = describeRun("GRADED", [output]);
    expect(summary.label).toBe("Finished");
    expect(summary.tone).toBe("success");
    expect(describeCaseOutcome(output)).toBe("Finished");
  });

  it("names the failure when the program crashed or hit a limit", () => {
    const crashed = { ...output, passed: false, status: "RUNTIME_ERROR" as const };
    expect(describeRun("RUNTIME_ERROR", [crashed]).label).toBe("Runtime error");
    expect(describeCaseOutcome(crashed)).toBe("Runtime error");
  });
});
