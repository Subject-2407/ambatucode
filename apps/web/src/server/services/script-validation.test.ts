import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_LIMITS } from "@ambatucode/shared";
import { summarizeValidation, validationLimits } from "./script-validation";
import {
  VALIDATION_STALE_MS,
  VALIDATION_WAITING_MESSAGE,
  VALIDATION_WAITING_MS,
  toValidationView,
} from "../serializers/test-script-validation";

const graded = { status: "GRADED" as const, systemError: null };
const test = (name: string, passed: boolean) => ({ name, passed });

describe("summarizeValidation", () => {
  it("passes a script only when every one of its tests passed", () => {
    expect(summarizeValidation(graded, [test("a", true), test("b", true)])).toEqual({
      status: "PASSED",
      summary: "All 2 tests passed",
    });
    expect(summarizeValidation(graded, [test("a", true), test("b", false)])).toEqual({
      status: "FAILED",
      summary: "1 of 2 tests passed. Failing: b",
    });
  });

  it("lists a few failing tests and counts the rest", () => {
    const rows = ["a", "b", "c", "d", "e"].map((name) => test(name, false));
    expect(summarizeValidation(graded, rows).summary).toBe(
      "0 of 5 tests passed. Failing: a, b, c and 2 more",
    );
  });

  // A script that reported nothing proved nothing.
  it("fails a script that reported no tests", () => {
    expect(summarizeValidation(graded, []).status).toBe("FAILED");
  });

  it("fails every script when the job never ran them", () => {
    expect(
      summarizeValidation({ status: "COMPILE_ERROR", systemError: null }, [test("a", true)]),
    ).toEqual({ status: "FAILED", summary: "The reference solution did not compile" });
    expect(
      summarizeValidation({ status: "SYSTEM_ERROR", systemError: "no report was written" }, []),
    ).toEqual({ status: "FAILED", summary: "no report was written" });
  });

  // A limit on the reference solution is still a verdict on the script's tests.
  it("judges a run that hit a limit by the tests it reported", () => {
    expect(
      summarizeValidation({ status: "TIME_LIMIT_EXCEEDED", systemError: null }, [
        test("script (stopped at a limit)", false),
      ]).status,
    ).toBe("FAILED");
  });

  // Building the reference solution can spend the budget before a script runs.
  it("blames the reference solution when a limit left nothing to report", () => {
    expect(summarizeValidation({ status: "TIME_LIMIT_EXCEEDED", systemError: null }, [])).toEqual({
      status: "FAILED",
      summary: "The reference solution ran out of time before its scripts could run",
    });
    expect(summarizeValidation({ status: "MEMORY_LIMIT_EXCEEDED", systemError: null }, [])).toEqual(
      {
        status: "FAILED",
        summary: "The reference solution ran out of memory before its scripts could run",
      },
    );
  });
});

describe("validationLimits", () => {
  it("gives every script a container's worth of wall clock", () => {
    const limits = validationLimits(2_000, 128, 3);
    expect(limits.runTimeoutMs).toBe(2_000);
    expect(limits.memoryLimitMb).toBe(128);
    expect(limits.wallTimeoutMs).toBe(
      DEFAULT_EXECUTION_LIMITS.compileTimeoutMs + 3 * DEFAULT_EXECUTION_LIMITS.wallTimeoutMs,
    );
  });
});

describe("toValidationView", () => {
  const row = (status: "VALIDATING" | "PASSED", changedAt: Date | null) => ({
    validationStatus: status,
    validationSummary: status === "PASSED" ? "All 2 tests passed" : null,
    validationChangedAt: changedAt,
  });

  it("shows a validation that can no longer finish as never run", () => {
    const now = Date.now();
    expect(toValidationView(row("VALIDATING", new Date(now - 1_000)), now).status).toBe(
      "VALIDATING",
    );
    const stale = toValidationView(row("VALIDATING", new Date(now - VALIDATION_STALE_MS - 1)), now);
    expect(stale.status).toBe("UNVALIDATED");
    expect(stale.summary).toMatch(/never finished/);
  });

  it("says why a validation might still be waiting", () => {
    const now = Date.now();
    expect(toValidationView(row("VALIDATING", new Date(now - 5_000)), now).summary).toBeNull();
    expect(
      toValidationView(row("VALIDATING", new Date(now - VALIDATION_WAITING_MS - 1)), now),
    ).toMatchObject({ status: "VALIDATING", summary: VALIDATION_WAITING_MESSAGE });
  });

  it("passes a finished result through", () => {
    const changedAt = new Date("2026-09-14T10:00:00.000Z");
    expect(toValidationView(row("PASSED", changedAt))).toEqual({
      status: "PASSED",
      summary: "All 2 tests passed",
      changedAt: "2026-09-14T10:00:00.000Z",
    });
  });
});
