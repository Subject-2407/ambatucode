import { describe, expect, it } from "vitest";
import { sectionLabel, sectionNumberLabel } from "./section-label";

describe("sectionNumberLabel", () => {
  it("pads to two digits, as the module overview does", () => {
    expect(sectionNumberLabel(2)).toBe("02");
    expect(sectionNumberLabel(12)).toBe("12");
  });

  it("does not truncate a module with a hundred sections", () => {
    expect(sectionNumberLabel(104)).toBe("104");
  });
});

describe("sectionLabel", () => {
  it("names the section by number and title", () => {
    expect(sectionLabel({ sectionNumber: 3, sectionTitle: "Loops" })).toBe("03 · Loops");
  });
});
