import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTimeWithSeconds } from "./format-date";

// A local-time constructor, so the assertions hold in whatever zone the suite
// runs in.
const moment = new Date(2026, 8, 21, 17, 5, 9);

describe("format-date", () => {
  it("puts the day before the month and names the month", () => {
    expect(formatDate(moment)).toMatch(/^21 Sep/);
    expect(formatDate(moment)).toContain("2026");
  });

  it("adds a 24-hour time to the date", () => {
    const text = formatDateTime(moment);
    expect(text).toMatch(/^21 Sep/);
    expect(text).toContain("17:05");
    expect(text).not.toContain("17:05:09");
  });

  it("keeps seconds only where asked", () => {
    expect(formatTimeWithSeconds(moment)).toBe("17:05:09");
  });

  it("accepts the ISO strings and epoch numbers the API sends", () => {
    expect(formatDate(moment.toISOString())).toBe(formatDate(moment));
    expect(formatDate(moment.getTime())).toBe(formatDate(moment));
  });
});
