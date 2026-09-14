import "server-only";
import {
  AppError,
  isLanguage,
  type AttemptStatus,
  type GradeAttemptView,
  type GradeRecordView,
  type GradeSubmissionView,
  type Language,
  type SubmissionHistoryItem,
  type SubmissionStatus,
} from "@ambatucode/shared";

/**
 * Grading records, row to response.
 *
 * Like the assessment serializer, every field is copied explicitly. These rows
 * are joined against submissions, and a submission row carries source code and
 * a system error — a spread here is how one of those reaches a browser the day
 * somebody widens a `select`.
 */

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function storedLanguage(value: string): Language {
  if (!isLanguage(value)) {
    throw new AppError("INTERNAL", `Stored language "${value}" is not a known language`);
  }
  return value;
}

export type GradeSubmissionRow = {
  id: string;
  status: SubmissionStatus;
  score: number | null;
  language: string;
  isAutoSubmitted: boolean;
  submittedAt: Date;
  gradedAt: Date | null;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
};

export function toGradeSubmissionView(row: GradeSubmissionRow): GradeSubmissionView {
  return {
    id: row.id,
    status: row.status,
    score: row.score,
    language: storedLanguage(row.language),
    isAutoSubmitted: row.isAutoSubmitted,
    submittedAt: row.submittedAt.toISOString(),
    gradedAt: iso(row.gradedAt),
    executionTimeMs: row.executionTimeMs,
    memoryUsedKb: row.memoryUsedKb,
  };
}

export type GradeAttemptRow = {
  id: string;
  attemptNumber: number;
  status: AttemptStatus;
  isOfficial: boolean;
  startedAt: Date | null;
  consumedMs: number;
  resetAt: Date | null;
  resetReason: string | null;
  resetBy: { displayName: string } | null;
  submissions: GradeSubmissionRow[];
};

/**
 * An attempt allows exactly one formal Submission, so the list holds at most
 * one row — but it is read as a list and the first is taken by submission
 * time, because a corrupted extra row must not silently become the grade.
 */
export function toGradeAttemptView(row: GradeAttemptRow): GradeAttemptView {
  const submission = row.submissions[0];
  return {
    id: row.id,
    attemptNumber: row.attemptNumber,
    status: row.status,
    isOfficial: row.isOfficial,
    startedAt: iso(row.startedAt),
    consumedMs: row.consumedMs,
    resetAt: iso(row.resetAt),
    resetReason: row.resetReason,
    resetByDisplayName: row.resetBy?.displayName ?? null,
    submission: submission === undefined ? null : toGradeSubmissionView(submission),
  };
}

export type GradeRecordContext = {
  user: { id: string; username: string; displayName: string };
  module: { id: string; title: string };
  section: { id: string; title: string };
  assessment: { id: string; title: string };
  session: { id: string; name: string };
};

export function toGradeRecordView(
  context: GradeRecordContext,
  attemptRows: GradeAttemptRow[],
): GradeRecordView {
  const attempts = attemptRows.map(toGradeAttemptView);
  const official = attempts.find((attempt) => attempt.isOfficial) ?? null;
  return {
    userId: context.user.id,
    username: context.user.username,
    displayName: context.user.displayName,
    moduleId: context.module.id,
    moduleTitle: context.module.title,
    sectionId: context.section.id,
    sectionTitle: context.section.title,
    assessmentId: context.assessment.id,
    assessmentTitle: context.assessment.title,
    sessionId: context.session.id,
    sessionName: context.session.name,
    // Null when the Architect has not chosen yet, and null when the official
    // attempt has no submission. Both are honest answers to "what did they
    // score"; neither is a zero.
    officialScore: official?.submission?.score ?? null,
    officialAttemptId: official?.id ?? null,
    attempts,
  };
}

export type SubmissionHistoryRow = GradeSubmissionRow & {
  attemptId: string;
  attempt: { attemptNumber: number; isOfficial: boolean };
  session: { id: string; name: string };
  assessment: {
    id: string;
    title: string;
    section: { module: { id: string; slug: string; title: string } };
  };
};

/**
 * A Coder's own history. No source code and no per-case detail: the list is a
 * list, and the detail view already has one serializer that strips hidden rows.
 */
export function toSubmissionHistoryItem(row: SubmissionHistoryRow): SubmissionHistoryItem {
  const module = row.assessment.section.module;
  return {
    ...toGradeSubmissionView(row),
    attemptId: row.attemptId,
    attemptNumber: row.attempt.attemptNumber,
    isOfficial: row.attempt.isOfficial,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.title,
    sessionId: row.session.id,
    sessionName: row.session.name,
    moduleId: module.id,
    moduleSlug: module.slug,
    moduleTitle: module.title,
  };
}
