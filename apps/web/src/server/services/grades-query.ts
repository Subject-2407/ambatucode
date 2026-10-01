import "server-only";
import { Prisma } from "@ambatucode/db";
import type { GradeRecordSummary, GradeSort, GradeSortOrder } from "@ambatucode/shared";

/**
 * The order and the summary of the grading record query, as SQL fragments.
 *
 * Kept apart from `grades.ts` so the one part of the query a caller steers —
 * which column it is sorted by — can be pinned by unit tests without a
 * database. The caller's choice selects between fragments written out below;
 * no part of it is ever spliced into SQL text. Every fragment here is a tagged
 * template with no parameters at all.
 *
 * Each fragment expects the aliases `recordFrom` in `grades.ts` sets up: `a`
 * for the attempt, `u` the Coder, `s` the session, `asm` the assessment, and
 * `sec` the section — inside a query grouped on `(a."sessionId", a."userId")`.
 */

/** Direction as fixed SQL, so `ASC`/`DESC` never arrive as text from a request. */
const DIRECTION: Readonly<Record<GradeSortOrder, Prisma.Sql>> = {
  asc: Prisma.sql`ASC`,
  desc: Prisma.sql`DESC`,
};

/**
 * The official attempt's score for the record being grouped.
 *
 * The same reading the serializer makes: the attempt flagged official, and its
 * earliest submission. A correlated subquery rather than a join because a join
 * on submissions would multiply the attempt rows the grouping counts.
 */
export const OFFICIAL_SCORE_SQL = Prisma.sql`(
  SELECT sub."score" FROM "AssessmentAttempt" oa
  JOIN "Submission" sub ON sub."attemptId" = oa."id"
  WHERE oa."sessionId" = a."sessionId" AND oa."userId" = a."userId" AND oa."isOfficial" = true
  ORDER BY sub."submittedAt" ASC
  LIMIT 1
)`;

/** When the record's latest formal Submission landed, on any of its attempts. */
const LATEST_SUBMISSION_SQL = Prisma.sql`(
  SELECT MAX(sub."submittedAt") FROM "Submission" sub
  JOIN "AssessmentAttempt" sa ON sa."id" = sub."attemptId"
  WHERE sa."sessionId" = a."sessionId" AND sa."userId" = a."userId"
)`;

/** Whether the record has any formal Submission at all. */
const HAS_SUBMISSION_SQL = Prisma.sql`EXISTS (
  SELECT 1 FROM "Submission" sub
  JOIN "AssessmentAttempt" sa ON sa."id" = sub."attemptId"
  WHERE sa."sessionId" = a."sessionId" AND sa."userId" = a."userId"
)`;

/**
 * Lower-cased because a display name is typed by a person, and "ani" sorting
 * after "Zaki" is a collation detail nobody reading a class list should meet.
 * The username breaks ties between two people who chose the same name.
 */
const BY_NAME = Prisma.sql`LOWER(u."displayName") ASC, u."username" ASC`;

/** The module's own order, then the newest session of an assessment first. */
const BY_MODULE_ORDER = Prisma.sql`sec."orderIndex" ASC, asm."orderIndex" ASC, s."createdAt" DESC`;

/**
 * The group key itself, last, so two records can never tie. Without a total
 * order `OFFSET` paging may show a record twice and another never, and the
 * export walks the same pages.
 */
const UNIQUE_TAIL = Prisma.sql`a."sessionId" ASC, a."userId" ASC`;

/**
 * The `ORDER BY` list for a page of record keys.
 *
 * Only the chosen column takes the direction; the tiebreaks behind it keep
 * their natural order, so flipping a sort by score does not also reverse the
 * names within each score. A record with no score or no submission sorts last
 * in either direction — "has nothing yet" is not the top or bottom of a range.
 */
export function gradeRecordOrderBy(sort: GradeSort, order: GradeSortOrder): Prisma.Sql {
  const direction = DIRECTION[order];
  switch (sort) {
    case "name":
      return Prisma.sql`LOWER(u."displayName") ${direction}, u."username" ${direction}, ${BY_MODULE_ORDER}, ${UNIQUE_TAIL}`;
    case "assessment":
      return Prisma.sql`sec."orderIndex" ${direction}, asm."orderIndex" ${direction}, s."createdAt" DESC, ${BY_NAME}, ${UNIQUE_TAIL}`;
    case "score":
      return Prisma.sql`${OFFICIAL_SCORE_SQL} ${direction} NULLS LAST, ${BY_NAME}, ${BY_MODULE_ORDER}, ${UNIQUE_TAIL}`;
    case "submittedAt":
      return Prisma.sql`${LATEST_SUBMISSION_SQL} ${direction} NULLS LAST, ${BY_NAME}, ${BY_MODULE_ORDER}, ${UNIQUE_TAIL}`;
  }
}

/**
 * Every column an `ORDER BY` above names outside a subquery, for the `GROUP BY`.
 * Each is fixed by `(sessionId, userId)` already, so grouping on them changes no
 * group; Postgres simply cannot see that through the joins.
 */
export const RECORD_GROUP_BY = Prisma.sql`a."sessionId", a."userId", u."displayName", u."username", sec."orderIndex", asm."orderIndex", s."createdAt"`;

/** One row per record, as the summary aggregates them. */
export const RECORD_SUMMARY_COLUMNS = Prisma.sql`
  ${OFFICIAL_SCORE_SQL} AS "officialScore",
  BOOL_OR(a."isOfficial") AS "hasOfficial",
  ${HAS_SUBMISSION_SQL} AS "submitted"
`;

/**
 * The aggregate over the per-record rows above. "Needs a choice" is the rule
 * the record row uses to show its warning: a Submission exists, and no attempt
 * is official.
 */
export const RECORD_SUMMARY_AGGREGATES = Prisma.sql`
  COUNT(*)::bigint AS "records",
  COUNT(grouped."officialScore")::bigint AS "scored",
  AVG(grouped."officialScore")::float8 AS "averageScore",
  COUNT(*) FILTER (WHERE grouped."submitted")::bigint AS "submitted",
  COUNT(*) FILTER (WHERE grouped."submitted" AND NOT grouped."hasOfficial")::bigint AS "needsOfficialChoice"
`;

export type GradeSummaryRow = {
  records: bigint;
  scored: bigint;
  averageScore: number | null;
  submitted: bigint;
  needsOfficialChoice: bigint;
};

/**
 * Counts arrive as `bigint` and the mean as a float with as many digits as the
 * division produced. Scores are whole numbers, so one decimal is all the mean
 * can honestly claim.
 */
export function toGradeRecordSummary(row: GradeSummaryRow | undefined): GradeRecordSummary {
  if (row === undefined) {
    return { records: 0, scored: 0, averageScore: null, submitted: 0, needsOfficialChoice: 0 };
  }
  return {
    records: Number(row.records),
    scored: Number(row.scored),
    averageScore: row.averageScore === null ? null : Math.round(row.averageScore * 10) / 10,
    submitted: Number(row.submitted),
    needsOfficialChoice: Number(row.needsOfficialChoice),
  };
}
