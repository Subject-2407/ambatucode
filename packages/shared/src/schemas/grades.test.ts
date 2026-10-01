import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRADE_SORT_ORDER,
  GRADE_SORTS,
  gradeExportQuerySchema,
  gradeRecordQuerySchema,
  resolveGradeSort,
} from "./grades";

describe("gradeRecordQuerySchema", () => {
  it("leaves the order unset when the caller does not choose one", () => {
    const parsed = gradeRecordQuerySchema.parse({});
    expect(parsed.sort).toBeUndefined();
    expect(parsed.order).toBeUndefined();
  });

  it("accepts every allow-listed sort in both directions", () => {
    for (const sort of GRADE_SORTS) {
      expect(gradeRecordQuerySchema.parse({ sort, order: "desc" })).toMatchObject({
        sort,
        order: "desc",
      });
    }
  });

  // The sort reaches an ORDER BY. Anything outside the list must be refused at
  // the boundary rather than trusted to a lookup further in.
  it.each(['"u"."passwordHash"', "name; DROP TABLE", "NAME", ""])("refuses the sort %s", (sort) => {
    expect(gradeRecordQuerySchema.safeParse({ sort }).success).toBe(false);
  });

  it("refuses a direction other than asc or desc", () => {
    expect(gradeRecordQuerySchema.safeParse({ order: "ASC NULLS FIRST" }).success).toBe(false);
  });

  it("reads resetOnly from a query string", () => {
    expect(gradeRecordQuerySchema.parse({ resetOnly: "true" }).resetOnly).toBe(true);
    expect(gradeRecordQuerySchema.parse({ resetOnly: "false" }).resetOnly).toBe(false);
  });
});

describe("resolveGradeSort", () => {
  it("defaults to name, A to Z", () => {
    expect(resolveGradeSort({})).toEqual({ sort: "name", order: "asc" });
  });

  it("starts each column in its own natural direction", () => {
    expect(resolveGradeSort({ sort: "score" })).toEqual({ sort: "score", order: "desc" });
    expect(resolveGradeSort({ sort: "submittedAt" }).order).toBe(
      DEFAULT_GRADE_SORT_ORDER.submittedAt,
    );
  });

  it("keeps a direction the caller chose", () => {
    expect(resolveGradeSort({ sort: "score", order: "asc" })).toEqual({
      sort: "score",
      order: "asc",
    });
  });
});

describe("gradeExportQuerySchema", () => {
  it("keeps the filters and drops paging and order", () => {
    const parsed = gradeExportQuerySchema.parse({
      sectionId: "sec1",
      assessmentId: "asm1",
      sort: "score",
      order: "desc",
      page: "3",
    });
    expect(parsed).toMatchObject({ sectionId: "sec1", assessmentId: "asm1", format: "csv" });
    expect(parsed).not.toHaveProperty("sort");
    expect(parsed).not.toHaveProperty("order");
    expect(parsed).not.toHaveProperty("page");
  });
});
