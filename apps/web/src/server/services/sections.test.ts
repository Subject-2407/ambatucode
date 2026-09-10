import { describe, expect, it } from "vitest";
import { isAppError } from "@ambatucode/shared";
import { assertCompleteOrdering } from "./sections";

/**
 * The reorder contract, tested on its own because every way of getting it
 * wrong is silent: a dropped id leaves a Section stranded at whatever index it
 * held, and a duplicate leaves two of them fighting over one.
 */
describe("assertCompleteOrdering", () => {
  it("accepts a permutation of exactly the current sections", () => {
    expect(() => assertCompleteOrdering(["a", "b", "c"], ["c", "a", "b"])).not.toThrow();
  });

  it("rejects a list built from a stale tree", () => {
    // The client never learned about "c" and would leave it behind.
    expect(() => assertCompleteOrdering(["a", "b", "c"], ["b", "a"])).toThrow();
  });

  it("rejects a duplicated id", () => {
    expect(() => assertCompleteOrdering(["a", "b"], ["a", "a"])).toThrow(/unique/i);
  });

  it("rejects an id from another module", () => {
    expect(() => assertCompleteOrdering(["a", "b"], ["a", "z"])).toThrow();
  });

  it("reports the failure as a validation error, not an internal one", () => {
    try {
      assertCompleteOrdering(["a"], []);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("VALIDATION_FAILED");
    }
  });
});
