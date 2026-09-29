import { describe, expect, it } from "vitest";
import { parseSectionFolds, sectionFoldsKey, serializeSectionFolds } from "./section-folds";

describe("parseSectionFolds", () => {
  it("reads back what was written", () => {
    const folded = new Set(["a", "b"]);
    expect(parseSectionFolds(serializeSectionFolds(folded))).toEqual(folded);
  });

  it("starts with everything open when nothing is stored", () => {
    expect(parseSectionFolds(null).size).toBe(0);
  });

  it("treats anything malformed as nothing folded", () => {
    expect(parseSectionFolds("not json").size).toBe(0);
    expect(parseSectionFolds('{"a":1}').size).toBe(0);
    expect(parseSectionFolds("42").size).toBe(0);
  });

  it("keeps only string ids", () => {
    expect(parseSectionFolds('["a", 1, null, {"x":1}, "b"]')).toEqual(new Set(["a", "b"]));
  });

  it("caps a runaway list rather than trusting its length", () => {
    const ids = Array.from({ length: 500 }, (_, index) => `s${String(index)}`);
    expect(parseSectionFolds(JSON.stringify(ids)).size).toBe(200);
  });
});

describe("sectionFoldsKey", () => {
  it("is scoped to one Module", () => {
    expect(sectionFoldsKey("m1")).not.toBe(sectionFoldsKey("m2"));
  });
});
