import "server-only";
import { prisma, type Prisma } from "@ambatucode/db";
import {
  AppError,
  type AuthenticatedUser,
  type SubmissionArchitectView,
  type SubmissionCoderView,
  type SubmissionStatusView,
} from "@ambatucode/shared";
import { assertNotRoot } from "../auth/guards";
import { toSubmissionArchitectView, toSubmissionCoderView } from "../serializers/assessment";

/**
 * Reading formal Submissions.
 *
 * Two readers, two views: the Coder who submitted sees their own work with
 * hidden rows removed, the Architect who owns the Module sees everything.
 * Root sees neither — refused here, in the data access layer, so no route can
 * forget to.
 */

const SUBMISSION_SELECT = {
  id: true,
  attemptId: true,
  userId: true,
  sessionId: true,
  assessmentId: true,
  status: true,
  score: true,
  language: true,
  isAutoSubmitted: true,
  submittedAt: true,
  gradedAt: true,
  sourceCode: true,
  executionTimeMs: true,
  memoryUsedKb: true,
  compilerOutput: true,
  systemError: true,
  results: {
    orderBy: { createdAt: "asc" },
    select: {
      testCaseId: true,
      testScriptId: true,
      name: true,
      status: true,
      passed: true,
      weight: true,
      executionTimeMs: true,
      memoryUsedKb: true,
      stdoutExcerpt: true,
      stderrExcerpt: true,
      failureDetail: true,
      isPublic: true,
    },
  },
  assessment: { select: { section: { select: { module: { select: { ownerId: true } } } } } },
} satisfies Prisma.SubmissionSelect;

type Reader = "OWNER" | "ARCHITECT";

/**
 * Anyone else gets NOT_FOUND rather than FORBIDDEN: whether a submission with
 * this id exists is itself something another Coder is not entitled to learn.
 */
function readerFor(
  actor: AuthenticatedUser,
  submission: { userId: string; assessment: { section: { module: { ownerId: string } } } },
): Reader {
  if (actor.role === "CODER" && submission.userId === actor.id) return "OWNER";
  if (actor.role === "ARCHITECT" && submission.assessment.section.module.ownerId === actor.id) {
    return "ARCHITECT";
  }
  throw new AppError("NOT_FOUND", "Submission not found");
}

export async function getSubmission(
  actor: AuthenticatedUser,
  submissionId: string,
): Promise<SubmissionCoderView | SubmissionArchitectView> {
  assertNotRoot(actor);

  const row = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: SUBMISSION_SELECT,
  });
  if (!row) throw new AppError("NOT_FOUND", "Submission not found");

  return readerFor(actor, row) === "OWNER"
    ? toSubmissionCoderView(row)
    : toSubmissionArchitectView(row);
}

/** The polling fallback for a Coder whose socket missed `submission:status`. */
export async function getSubmissionStatus(
  actor: AuthenticatedUser,
  submissionId: string,
): Promise<SubmissionStatusView> {
  assertNotRoot(actor);

  const row = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      status: true,
      score: true,
      gradedAt: true,
      assessment: { select: { section: { select: { module: { select: { ownerId: true } } } } } },
    },
  });
  if (!row) throw new AppError("NOT_FOUND", "Submission not found");
  readerFor(actor, row);

  return {
    id: row.id,
    status: row.status,
    score: row.score,
    gradedAt: row.gradedAt?.toISOString() ?? null,
  };
}
