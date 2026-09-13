import { describe, expect, it } from "vitest";
import { computeScore } from "./scoring";

const pass = (weight = 1) => ({ passed: true, weight });
const fail = (weight = 1) => ({ passed: false, weight });

describe("computeScore", () => {
  describe("WEIGHTED_AVERAGE", () => {
    it("scores the passed share of the total weight", () => {
      expect(computeScore("WEIGHTED_AVERAGE", "GRADED", [pass(3), fail(1)])).toBe(75);
    });

    it("rounds to an integer, since scores are stored as integers", () => {
      expect(computeScore("WEIGHTED_AVERAGE", "GRADED", [pass(), fail(), fail()])).toBe(33);
      expect(computeScore("WEIGHTED_AVERAGE", "GRADED", [pass(), pass(), fail()])).toBe(67);
    });

    it("ignores zero-weight cases while others carry weight", () => {
      expect(computeScore("WEIGHTED_AVERAGE", "GRADED", [pass(0), fail(0), pass(2)])).toBe(100);
    });

    it("counts every case equally when all weights are zero", () => {
      expect(computeScore("WEIGHTED_AVERAGE", "GRADED", [pass(0), fail(0)])).toBe(50);
    });
  });

  describe("ALL_OR_NOTHING", () => {
    it("scores 100 only when every counted case passes", () => {
      expect(computeScore("ALL_OR_NOTHING", "GRADED", [pass(), pass()])).toBe(100);
      expect(computeScore("ALL_OR_NOTHING", "GRADED", [pass(5), fail(1)])).toBe(0);
    });

    it("does not let a failing zero-weight case sink the score", () => {
      expect(computeScore("ALL_OR_NOTHING", "GRADED", [pass(1), fail(0)])).toBe(100);
    });
  });

  it.each([
    "QUEUED",
    "RUNNING",
    "COMPILE_ERROR",
    "RUNTIME_ERROR",
    "TIME_LIMIT_EXCEEDED",
    "MEMORY_LIMIT_EXCEEDED",
    "SYSTEM_ERROR",
  ] as const)("scores %s as 0 even when rows passed", (status) => {
    expect(computeScore("WEIGHTED_AVERAGE", status, [pass(), pass()])).toBe(0);
  });

  it("scores a graded result with no rows as 0", () => {
    expect(computeScore("WEIGHTED_AVERAGE", "GRADED", [])).toBe(0);
    expect(computeScore("ALL_OR_NOTHING", "GRADED", [])).toBe(0);
  });
});
