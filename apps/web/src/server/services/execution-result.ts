import "server-only";
import { prisma } from "@ambatucode/db";
import { AppError, type ExecutionResult, isTerminalSubmissionStatus } from "@ambatucode/shared";

export type IngestOutcome = {
  /** False when the callback was a retry of an already-finalised submission. */
  persisted: boolean;
};

/**
 * Ingests one worker result.
 *
 * Idempotent by design: the worker retries on transport failures and BullMQ
 * retries failed jobs, so the same callback can arrive more than once. A
 * repeat for a submission that already reached a terminal status is a
 * successful no-op rather than a duplicate write.
 *
 * Scoring, `submission:status` broadcasts, leaderboard refresh, and
 * achievement evaluation belong to the assessment pipeline and are wired in a
 * later phase. This records what actually ran.
 */
export async function ingestExecutionResult(result: ExecutionResult): Promise<IngestOutcome> {
  // RUN jobs carry no Submission row — practice and assessment runs never
  // produce grading history. Delivery of run output to the Coder happens over
  // the realtime channel, not here.
  if (result.submissionId === null) {
    return { persisted: false };
  }

  const submission = await prisma.submission.findUnique({
    where: { id: result.submissionId },
    select: { id: true, status: true },
  });

  if (!submission) {
    throw new AppError("NOT_FOUND", "Submission not found");
  }

  if (isTerminalSubmissionStatus(submission.status)) {
    return { persisted: false };
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

  await prisma.$transaction([
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

  return { persisted: true };
}
