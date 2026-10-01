import { describe, expect, it } from "vitest";
import { GRADE_SORT_ORDERS, GRADE_SORTS } from "@ambatucode/shared";
import { RECORD_GROUP_BY, gradeRecordOrderBy, toGradeRecordSummary } from "./grades-query";

/**
 * The order of a grading record list is the one part of that raw query a
 * request steers. These pin that the steering only ever picks between written
 * fragments, and that each fragment is one Postgres will accept beside the
 * grouping — the integration suite is the only other place that would notice.
 */

const EVERY_ORDER = GRADE_SORTS.flatMap((sort) =>
  GRADE_SORT_ORDERS.map((order) => ({ sort, order })),
);

/** Columns of the outer query's tables: attempt, Coder, session, assessment, section. */
const OUTER_COLUMN = /\b(?:a|u|s|asm|sec)\."\w+"/g;

describe("gradeRecordOrderBy", () => {
  it.each(EVERY_ORDER)("binds no values for $sort $order", ({ sort, order }) => {
    expect(gradeRecordOrderBy(sort, order).values).toEqual([]);
  });

  it.each(EVERY_ORDER)("ends on the group key for $sort $order", ({ sort, order }) => {
    expect(gradeRecordOrderBy(sort, order).text.trim()).toMatch(
      /a\."sessionId" ASC, a\."userId" ASC$/,
    );
  });

  it.each(EVERY_ORDER)(
    "names only columns the grouping carries for $sort $order",
    ({ sort, order }) => {
      const grouped = new Set(RECORD_GROUP_BY.text.match(OUTER_COLUMN));
      const used = gradeRecordOrderBy(sort, order).text.match(OUTER_COLUMN) ?? [];
      expect(used.filter((column) => !grouped.has(column))).toEqual([]);
    },
  );

  it("sorts by the display name the table shows, case-insensitively", () => {
    expect(gradeRecordOrderBy("name", "asc").text).toMatch(/^LOWER\(u\."displayName"\) ASC/);
    expect(gradeRecordOrderBy("name", "desc").text).toMatch(/^LOWER\(u\."displayName"\) DESC/);
  });

  it("reverses only the chosen column, not the tiebreaks behind it", () => {
    const text = gradeRecordOrderBy("name", "desc").text;
    expect(text).toContain('sec."orderIndex" ASC');
    expect(text).toContain('a."sessionId" ASC');
  });

  it("puts a record with no score last in both directions", () => {
    expect(gradeRecordOrderBy("score", "desc").text).toContain("DESC NULLS LAST");
    expect(gradeRecordOrderBy("score", "asc").text).toContain("ASC NULLS LAST");
    expect(gradeRecordOrderBy("submittedAt", "asc").text).toContain("ASC NULLS LAST");
  });

  it("sorts by the official attempt's score, not any attempt's", () => {
    expect(gradeRecordOrderBy("score", "desc").text).toContain('oa."isOfficial" = true');
  });
});

describe("toGradeRecordSummary", () => {
  it("turns the database's bigints into numbers", () => {
    expect(
      toGradeRecordSummary({
        records: 30n,
        scored: 27n,
        averageScore: 81.25,
        submitted: 28n,
        needsOfficialChoice: 1n,
      }),
    ).toEqual({
      records: 30,
      scored: 27,
      averageScore: 81.3,
      submitted: 28,
      needsOfficialChoice: 1,
    });
  });

  it("rounds the mean to one decimal, which is all whole-number scores support", () => {
    const summary = toGradeRecordSummary({
      records: 3n,
      scored: 3n,
      averageScore: 200 / 3,
      submitted: 3n,
      needsOfficialChoice: 0n,
    });
    expect(summary.averageScore).toBe(66.7);
  });

  it("reports no mean rather than zero when nothing is scored", () => {
    expect(
      toGradeRecordSummary({
        records: 4n,
        scored: 0n,
        averageScore: null,
        submitted: 0n,
        needsOfficialChoice: 0n,
      }).averageScore,
    ).toBeNull();
  });

  it("reads an empty result as an empty set", () => {
    expect(toGradeRecordSummary(undefined)).toEqual({
      records: 0,
      scored: 0,
      averageScore: null,
      submitted: 0,
      needsOfficialChoice: 0,
    });
  });
});
