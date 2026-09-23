import { describe, expect, it } from "vitest";
import { GREETINGS } from "./greetings";

/**
 * The title screen types these one character at a time under a fixed-width
 * heading, so their length is a layout constraint rather than a matter of
 * taste: a long line wraps, the form below it moves, and the sign-in button
 * ends up somewhere different depending on which joke came up.
 */
const MAX_LENGTH = 44;

describe("greetings", () => {
  it("has enough lines that they do not repeat within a session", () => {
    expect(GREETINGS.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every line short enough not to wrap", () => {
    for (const line of GREETINGS) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_LENGTH);
      expect(line.length, line).toBeGreaterThan(0);
    }
  });

  it("has no duplicates, which would read as the rotation being stuck", () => {
    expect(new Set(GREETINGS).size).toBe(GREETINGS.length);
  });

  it("stores each line exactly as it is typed", () => {
    // The animation slices these character by character, so stray padding
    // would be typed out as a pause and read as a stutter.
    for (const line of GREETINGS) {
      expect(line, line).toBe(line.trim());
    }
  });
});
