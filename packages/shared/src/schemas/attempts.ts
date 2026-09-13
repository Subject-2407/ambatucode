import { z } from "zod";
import {
  LANGUAGES,
  type AttemptStatus,
  type ExecutionMode,
  type Language,
  type SubmissionStatus,
  type TestResultStatus,
} from "../enums";
import type { AssessmentWorkspaceView } from "./assessments";

/**
 * Assessment Attempts, their drafts, Runs, and formal Submissions.
 *
 * The submit request carries the source code itself. It is never read from
 * the draft: a pending autosave that never landed must not change what gets
 * graded, and a draft that did land must not override what the Coder sent.
 */

export const MAX_SOURCE_CODE_LENGTH = 200_000;

const sourceShape = {
  language: z.enum(LANGUAGES),
  sourceCode: z.string().max(MAX_SOURCE_CODE_LENGTH),
};

export const saveDraftRequestSchema = z.object(sourceShape);
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

export const runAttemptRequestSchema = z.object(sourceShape);
export type RunAttemptRequest = z.infer<typeof runAttemptRequestSchema>;

export const submitAttemptRequestSchema = z.object(sourceShape);
export type SubmitAttemptRequest = z.infer<typeof submitAttemptRequestSchema>;

// --- Views ------------------------------------------------------------------

export type SubmissionSummary = {
  id: string;
  attemptId: string;
  status: SubmissionStatus;
  /** Null until graded. */
  score: number | null;
  language: Language;
  isAutoSubmitted: boolean;
  submittedAt: string;
  gradedAt: string | null;
};

export type AttemptDraftView = {
  language: Language;
  sourceCode: string;
  savedAt: string;
};

/**
 * One attempt as its Coder sees it.
 *
 * `serverTimeMs` travels with `deadlineMs` so the browser can measure its own
 * clock skew once and interpolate a smooth countdown. The deadline is still
 * enforced here, never there.
 */
export type AttemptView = {
  id: string;
  sessionId: string;
  attemptNumber: number;
  status: AttemptStatus;
  executionMode: ExecutionMode | null;
  durationMinutes: number | null;
  startedAt: string | null;
  deadlineMs: number | null;
  remainingMs: number | null;
  consumedMs: number;
  paused: boolean;
  serverTimeMs: number;
  draft: AttemptDraftView | null;
  submission: SubmissionSummary | null;
  assessment: AssessmentWorkspaceView;
};

export type SaveDraftResponse = { savedAt: string };

export type RunAttemptResponse = { jobId: string };

export type SubmitAttemptResponse = { submission: SubmissionSummary };

/** A per-case row a Coder may see. Public cases only; no expected output. */
export type SubmissionTestResultCoderView = {
  name: string;
  /** Null only on rows graded before per-case statuses were recorded. */
  status: TestResultStatus | null;
  passed: boolean;
  executionTimeMs: number | null;
  stdoutExcerpt: string;
  stderrExcerpt: string;
};

/**
 * A graded submission for its Coder.
 *
 * Hidden-case rows and script rows are dropped entirely, not redacted — their
 * excerpts can echo the very input the case was hiding. `systemError` is
 * absent because it describes the platform, not the program.
 */
export type SubmissionCoderView = SubmissionSummary & {
  sourceCode: string;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
  compilerOutput: string | null;
  testResults: SubmissionTestResultCoderView[];
};

export type SubmissionTestResultArchitectView = SubmissionTestResultCoderView & {
  testCaseId: string | null;
  weight: number;
  isPublic: boolean;
  memoryUsedKb: number | null;
};

export type SubmissionArchitectView = SubmissionSummary & {
  userId: string;
  sessionId: string;
  assessmentId: string;
  sourceCode: string;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
  compilerOutput: string | null;
  systemError: string | null;
  testResults: SubmissionTestResultArchitectView[];
};

export type SubmissionStatusView = {
  id: string;
  status: SubmissionStatus;
  score: number | null;
  gradedAt: string | null;
};

// --- Internal (apps/realtime -> apps/web) -----------------------------------

/**
 * `SESSION_ENDED` closes an attempt left open in a session that has already
 * ended — the recovery path when ending a session was interrupted partway
 * through closing its attempts.
 */
export const AUTO_SUBMIT_REASONS = ["DEADLINE", "FOCUS_LOSS", "SESSION_ENDED"] as const;
export type AutoSubmitReason = (typeof AUTO_SUBMIT_REASONS)[number];

export const autoSubmitRequestSchema = z.object({ reason: z.enum(AUTO_SUBMIT_REASONS) });
export type AutoSubmitRequest = z.infer<typeof autoSubmitRequestSchema>;

/**
 * - `SUBMITTED`  a Submission was created from the stored draft
 * - `EXPIRED`    the attempt closed with no draft, so nothing was submitted
 * - `NOT_DUE`    the deadline has not passed (a stale job, or a resumed clock)
 * - `NOT_ACTIVE` the attempt was already closed — a submit won the race
 */
export type AutoSubmitOutcome = {
  outcome: "SUBMITTED" | "EXPIRED" | "NOT_DUE" | "NOT_ACTIVE";
  submissionId: string | null;
};

export type ExpireSessionOutcome = {
  outcome: "ENDED" | "NOT_DUE" | "NOT_RUNNING";
};
