import { describe, expect, it } from "vitest";
import { describeRange, readInt, settleInt, typingProblem } from "./number-input";

const timeLimit = { min: 100, max: 60_000 };

describe("readInt", () => {
  it("reads a value in range", () => {
    expect(readInt("2500", timeLimit)).toEqual({ kind: "valid", value: 2500 });
    expect(readInt(" 100 ", timeLimit)).toEqual({ kind: "valid", value: 100 });
  });

  it("lets a field be empty while it is being retyped", () => {
    expect(readInt("", timeLimit)).toEqual({ kind: "empty" });
  });

  it("holds the first digit of a valid value rather than snapping it", () => {
    // "2" on the way to "250" is below the minimum, not a value to commit.
    expect(readInt("2", timeLimit)).toEqual({ kind: "below" });
  });

  it("refuses text that only starts like a number", () => {
    expect(readInt("12abc", timeLimit)).toEqual({ kind: "not-a-number" });
    expect(readInt("1e3", timeLimit)).toEqual({ kind: "not-a-number" });
    expect(readInt("2.5", timeLimit)).toEqual({ kind: "not-a-number" });
  });

  it("knows a value past the maximum", () => {
    expect(readInt("60001", timeLimit)).toEqual({ kind: "above" });
  });
});

describe("settleInt", () => {
  it("keeps a valid value", () => {
    expect(settleInt("2500", timeLimit, 5_000)).toBe(2500);
  });

  it("pulls an out-of-range value to the nearest bound", () => {
    expect(settleInt("5", timeLimit, 5_000)).toBe(100);
    expect(settleInt("999999", timeLimit, 5_000)).toBe(60_000);
  });

  it("falls back when the field never held a number", () => {
    expect(settleInt("", timeLimit, 5_000)).toBe(5_000);
    expect(settleInt("abc", timeLimit, 5_000)).toBe(5_000);
  });
});

describe("typingProblem", () => {
  it("speaks up only when another keystroke cannot help", () => {
    expect(typingProblem(readInt("70000", timeLimit), timeLimit)).toBe("At most 60,000.");
    expect(typingProblem(readInt("1e3", timeLimit), timeLimit)).toBe("Whole numbers only.");
    expect(typingProblem(readInt("5", timeLimit), timeLimit)).toBeNull();
    expect(typingProblem(readInt("", timeLimit), timeLimit)).toBeNull();
  });
});

describe("describeRange", () => {
  it("spells the bounds out with a unit", () => {
    expect(describeRange(timeLimit, "ms")).toBe("Between 100 and 60,000 ms.");
    expect(describeRange({ min: 0, max: 100 })).toBe("Between 0 and 100.");
  });
});
