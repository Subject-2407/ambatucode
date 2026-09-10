import "server-only";
import { prisma } from "@ambatucode/db";
import {
  AppError,
  type ExecutionResult,
  type SubmissionStatusPayload,
  isTerminalSubmissionStatus,
} from "@ambatucode/shared";
import { getRedis } from "../redis";
import { runOwnerKey } from "../queue/producer";
import { publishExecutionStatus } from "../realtime/publish";

export type IngestOutcome = {
  /** False when the callback was a retry of an already-finalised submission. */
  persisted: boolean;
  /** False when nobody was waiting, or the Run's owner record had expired. */
  delivered: boolean;
};

/**
 * Ingests one worker result.
 *
 * Idempotent by design: the worker retries on transport failures and BullMQ
 * retries failed jobs, so the same callback can arrive more than once. A
 * repeat for a submission that already reached a terminal status is a
 * successful no-op rather than a duplicate write.
 *
 * Scoring strategies, leaderboard refresh, and achievement evaluation belong
 * to the assessment pipeline and are wired in a later phase. This records what
 * actually ran and tells the Coder waiting on it.
 */
export async function ingestExecutionResult(result: ExecutionResult): Promise<IngestOutcome> {
  return result.submissionId === null ? ingestRun(result) : ingestSubmission(result);
}

/**
 * A Run produces no grading history — that is what separates it from a formal
 * submission — so there is nothing to persist and the realtime push is the
 * entire delivery mechanism.
 */
async function ingestRun(result: ExecutionResult): Promise<IngestOutcome> {
  // Read without deleting: a retried callback re-delivering the same terminal
  // result is harmless, whereas consuming the key on a publish that then fails
  // would strand the Coder watching a spinner. The TTL does the cleanup.
  const userId = await getRedis().get(runOwnerKey(result.jobId));
  if (userId === null) {
    // The owner record expired, or this job was enqueued by a script with no
    // one watching. Neither is an error: nothing was graded and nothing lost.
    return { persisted: false, delivered: false };
  }

  const payload: SubmissionStatusPayload = {
    kind: "RUN",
    jobId: result.jobId,
    submissionId: null,
    status: result.status,
    // Every case in a RUN payload is public — the producer rejects a RUN
    // carrying a hidden case — so these results need no filtering. What is
    // dropped is the shape rather than the rows: no test case id, no weight,
    // and no expected output ever reaches the browser.
    testResults: result.testResults.map((testResult) => ({
      name: testResult.name,
      passed: testResult.passed,
      executionTimeMs: testResult.executionTimeMs,
      stdoutExcerpt: testResult.stdoutExcerpt,
      stderrExcerpt: testResult.stderrExcerpt,
    })),
    compilerOutput: result.compilerOutput,
  };

  await publishExecutionStatus({ userId, payload });
  return { persisted: false, delivered: true };
}

async function ingestSubmission(result: ExecutionResult): Promise<IngestOutcome> {
  const submissionId = result.submissionId;
  if (submissionId === null) throw new AppError("INTERNAL", "Submission id is missing");

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true, userId: true, score: true },
  });

  if (!submission) {
    throw new AppError("NOT_FOUND", "Submission not found");
  }

  if (isTerminalSubmissionStatus(submission.status)) {
    // Already finalised. Re-announce rather than staying silent: the callback
    // is being retried, which is exactly when the first push may have been the
    // thing that went missing.
    await publishExecutionStatus({
      userId: submission.userId,
      payload: {
        kind: "SUBMIT",
        jobId: result.jobId,
        submissionId: submission.id,
        status: submission.status,
        score: submission.score,
      },
    });
    return { persisted: false, delivered: true };
  }

  // Only a case marked PUBLIC on the Assessment may be shown to a Coder.
  // Anything unlinked (a custom test script row) stays private.
  const linkedIds = result.testResults
    .map((testResult) => testResult.testCaseId)
    .filter((id): id is string => id !== null);

  const publicCaseIds = new Set(
    (
      await prisma.assessmentTestCase.findMany({
        where: { id: { in: linkedIds }, kind: "PUBLIC" },
        select: { id: true },
      })
    ).map((testCase) => testCase.id),
  );

  const [, , updated] = await prisma.$transaction([
    prisma.submissionTestResult.deleteMany({ where: { submissionId: submission.id } }),
    prisma.submissionTestResult.createMany({
      data: result.testResults.map((testResult) => ({
        submissionId: submission.id,
        testCaseId: testResult.testCaseId,
        name: testResult.name,
        passed: testResult.passed,
        weight: Math.round(testResult.weight),
        executionTimeMs: Math.round(testResult.executionTimeMs),
        memoryUsedKb: testResult.memoryUsedKb === null ? null : Math.round(testResult.memoryUsedKb),
        stdoutExcerpt: testResult.stdoutExcerpt,
        stderrExcerpt: testResult.stderrExcerpt,
        isPublic: testResult.testCaseId !== null && publicCaseIds.has(testResult.testCaseId),
      })),
    }),
    prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: result.status,
        compilerOutput: result.compilerOutput,
        systemError: result.systemError,
        executionTimeMs: Math.round(result.executionTimeMs),
        memoryUsedKb: result.memoryUsedKb === null ? null : Math.round(result.memoryUsedKb),
        gradedAt: new Date(),
      },
    }),
  ]);

  // Status and score only. Per-case detail is served by
  // `GET /api/submissions/[submissionId]`, where one Coder-facing serializer
  // strips hidden rows — duplicating that filter here would be a second place
  // to get it wrong, and getting it wrong leaks grading data.
  await publishExecutionStatus({
    userId: submission.userId,
    payload: {
      kind: "SUBMIT",
      jobId: result.jobId,
      submissionId: submission.id,
      status: updated.status,
      score: updated.score,
    },
  });

  return { persisted: true, delivered: true };
}
