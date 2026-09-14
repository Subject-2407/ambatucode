import { z } from "zod";
import { ATTEMPT_STATUSES, LANGUAGES, SUBMISSION_STATUSES } from "../enums";
import type { AttemptStatus, Language, SubmissionStatus } from "../enums";
import { cuidSchema, paginationSchema } from "./common";

/**
 * Grading records: what an Architect reads, resets, and exports.
 *
 * The shape is an attempt list per Coder per session rather than one flat row
 * per submission, because that is the question being asked. A reset creates a
 * new attempt and keeps the old one, so "what did this Coder score" only has
 * an answer once you can see every attempt and which of them is official.
 */

// --- Reading -------------------------------------------------------------------

export const gradeRecordQuerySchema = paginationSchema.extend({
  /** Matches a username or display name. Trimmed; empty means no filter. */
  search: z.string().trim().max(120).optional(),
  sectionId: cuidSchema.optional(),
  assessmentId: cuidSchema.optional(),
  sessionId: cuidSchema.optional(),
  /** Keeps only records whose official submission ended this way. */
  status: z.enum(SUBMISSION_STATUSES).optional(),
  /** Keeps only records that have been reset at least once. */
  resetOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .optional(),
});
export type GradeRecordQuery = z.infer<typeof gradeRecordQuerySchema>;

export type GradeSubmissionView = {
  id: string;
  status: SubmissionStatus;
  score: number | null;
  language: Language;
  isAutoSubmitted: boolean;
  submittedAt: string;
  gradedAt: string | null;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
};

export type GradeAttemptView = {
  id: string;
  attemptNumber: number;
  status: AttemptStatus;
  isOfficial: boolean;
  startedAt: string | null;
  consumedMs: number;
  resetAt: string | null;
  resetReason: string | null;
  resetByDisplayName: string | null;
  /** An attempt allows exactly one formal submission. Null before it lands. */
  submission: GradeSubmissionView | null;
};

export type GradeRecordView = {
  userId: string;
  username: string;
  displayName: string;
  moduleId: string;
  moduleTitle: string;
  sectionId: string;
  sectionTitle: string;
  assessmentId: string;
  assessmentTitle: string;
  sessionId: string;
  sessionName: string;
  /**
   * From the attempt flagged official — not the best attempt, and not the
   * latest. After a reset the Architect chooses, so this and an attempt's own
   * score are separate facts.
   */
  officialScore: number | null;
  officialAttemptId: string | null;
  attempts: GradeAttemptView[];
};

// --- Reset and official selection ----------------------------------------------

export const resetAttemptSchema = z.object({
  /**
   * Required. A reset is a visible act on a Coder's record and the reason is
   * written to the event log, so there is always an answer to "why".
   */
  reason: z.string().trim().min(3).max(500),
});
export type ResetAttemptRequest = z.infer<typeof resetAttemptSchema>;

export type ResetAttemptResponse = {
  /** The attempt that was closed. Its submissions are untouched. */
  previousAttemptId: string;
  newAttemptId: string;
  newAttemptNumber: number;
};

/**
 * Which attempt supplies the official score. The attempt is named by the URL,
 * so the body carries only the deliberate choice to clear the flag instead of
 * setting it — a module can legitimately want no official score on a record.
 */
export const setOfficialAttemptSchema = z.object({
  isOfficial: z.boolean().default(true),
});
export type SetOfficialAttemptRequest = z.infer<typeof setOfficialAttemptSchema>;

// --- Export ---------------------------------------------------------------------

/**
 * CSV only, written UTF-8 with a byte-order mark and CRLF line endings so
 * Excel opens it as a spreadsheet rather than as mojibake in one column.
 */
export const GRADE_EXPORT_FORMATS = ["csv"] as const;
export type GradeExportFormat = (typeof GRADE_EXPORT_FORMATS)[number];

export const gradeExportQuerySchema = gradeRecordQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(GRADE_EXPORT_FORMATS).default("csv") });
export type GradeExportQuery = z.infer<typeof gradeExportQuerySchema>;

// --- A Coder's own history --------------------------------------------------------

export const submissionHistoryQuerySchema = paginationSchema.extend({
  moduleId: cuidSchema.optional(),
  assessmentId: cuidSchema.optional(),
});
export type SubmissionHistoryQuery = z.infer<typeof submissionHistoryQuerySchema>;

export type SubmissionHistoryItem = {
  id: string;
  status: SubmissionStatus;
  score: number | null;
  language: Language;
  isAutoSubmitted: boolean;
  submittedAt: string;
  gradedAt: string | null;
  attemptId: string;
  attemptNumber: number;
  /** Whether this submission's attempt supplies the official score. */
  isOfficial: boolean;
  assessmentId: string;
  assessmentTitle: string;
  sessionId: string;
  sessionName: string;
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
};

/** Guards a stored language column on the way out of a grading query. */
export function isExportLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function isAttemptStatus(value: string): value is AttemptStatus {
  return (ATTEMPT_STATUSES as readonly string[]).includes(value);
}
