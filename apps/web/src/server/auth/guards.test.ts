import { describe, expect, it } from "vitest";
import { isAppError } from "@ambatucode/shared";
import { assertNotRoot } from "./guards";

/**
 * Root administers infrastructure and accounts but must never see grading
 * records, participant submissions, or leaderboards. Every service that
 * returns one of those calls this, so it is the choke point worth pinning
 * down.
 */
describe("assertNotRoot", () => {
  it("blocks ROOT", () => {
    try {
      assertNotRoot({ role: "ROOT" });
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("FORBIDDEN");
      return;
    }
    throw new Error("Expected ROOT to be rejected");
  });

  it("allows ARCHITECT and CODER", () => {
    expect(() => assertNotRoot({ role: "ARCHITECT" })).not.toThrow();
    expect(() => assertNotRoot({ role: "CODER" })).not.toThrow();
  });
});
