import { describe, expect, it } from "vitest";
import { boardExtent, ordinal, scoringNote, viewerNote } from "./leaderboard-copy";

describe("ordinal", () => {
  it("handles the teens and the usual endings", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "111th",
    ]);
  });
});

describe("boardExtent", () => {
  it("says when the page is only the top of a longer board", () => {
    expect(boardExtent(25, 40)).toBe("Top 25 of 40 Coders");
  });

  it("says when the page is everyone", () => {
    expect(boardExtent(12, 12)).toBe("All 12 Coders");
    expect(boardExtent(1, 1)).toBe("1 Coder ranked");
  });
});

describe("scoringNote", () => {
  it("counts the assessments a module or section board sums", () => {
    expect(scoringNote("MODULE", 3)).toContain("the 3 assessments in this module");
    expect(scoringNote("SECTION", 1)).toContain("the 1 assessment in this section");
  });

  it("explains a single assessment's board on its own terms", () => {
    expect(scoringNote("ASSESSMENT", 1)).toContain("out of 100");
  });

  it("explains shared ranks", () => {
    expect(scoringNote("MODULE", 2)).toContain("Equal points share a rank");
  });
});

describe("viewerNote", () => {
  it("places a viewer who is below the visible page", () => {
    expect(viewerNote(31, 40, false)).toBe("You are 31st of 40.");
  });

  it("says nothing when the viewer's row is already shown", () => {
    expect(viewerNote(2, 40, true)).toBeNull();
  });

  it("says how to get on the board", () => {
    expect(viewerNote(null, 40, false)).toMatch(/not on this board yet/);
  });
});
