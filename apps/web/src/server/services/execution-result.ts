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
import { recordScriptValidation } from "./script-validation";
import { computeScore } from "./scoring";

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
 * A formal submission is scored here, by the Assessment's grading strategy,
 * in the same write that records its per-case results. Leaderboard refresh and
 * achievement evaluation are wired in a later phase.
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
  // A validation of an Architect's scripts is a Run too, and the one kind
  // whose result is kept. It is still delivered below like any other Run.
  const validated = await recordScriptValidation(result);

  // Read without deleting: a retried callback re-delivering the same terminal
  // result is harmless, whereas consuming the key on a publish that then fails
  // would strand the Coder watching a spinner. The TTL does the cleanup.
  const userId = await getRedis().get(runOwnerKey(result.jobId));
  if (userId === null) {
    // The owner record expired, or this job was enqueued by a script with no
    // one watching. Neither is an error: nothing was graded and nothing lost.
    return { persisted: validated, delivered: false };
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
    //
    // A Practice Activity's script tests arrive here too. For those the Coder
    // gets the test's name and verdict only. The worker already sends them
    // with no excerpts; blanking them again means a framework that ever
    // printed an assertion into one still could not show it to a Coder.
    testResults: result.testResults.map((testResult) => {
      const fromScript = testResult.testScriptId !== null;
      return {
        name: testResult.name,
        status: testResult.status,
        passed: testResult.passed,
        executionTimeMs: testResult.executionTimeMs,
        stdoutExcerpt: fromScript ? "" : testResult.stdoutExcerpt,
        stderrExcerpt: fromScript ? "" : testResult.stderrExcerpt,
      };
    }),
    compilerOutput: result.compilerOutput,
  };

  await publishExecutionStatus({ userId, payload });
  return { persisted: validated, delivered: true };
}

async function ingestSubmission(result: ExecutionResult): Promise<IngestOutcome> {
  const submissionId = result.submissionId;
  if (submissionId === null) throw new AppError("INTERNAL", "Submission id is missing");

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      userId: true,
      score: true,
      assessmentId: true,
      assessment: { select: { gradingStrategy: true } },
    },
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

  if (!isTerminalSubmissionStatus(result.status)) {
    // Progress, not a result: QUEUED to RUNNING. Nothing to score and no rows
    // to write — and a late progress report must never drag a graded
    // submission backwards, which the terminal check above already prevents.
    const progressed = await prisma.submission.update({
      where: { id: submission.id },
      data: { status: result.status },
      select: { status: true, score: true },
    });
    await publishExecutionStatus({
      userId: submission.userId,
      payload: {
        kind: "SUBMIT",
        jobId: result.jobId,
        submissionId: submission.id,
        status: progressed.status,
        score: progressed.score,
      },
    });
    return { persisted: true, delivered: true };
  }

  const score = computeScore(
    submission.assessment.gradingStrategy,
    result.status,
    result.testResults.map((testResult) => ({
      passed: testResult.passed,
      weight: testResult.weight,
    })),
  );

  // Only a case marked PUBLIC on the Assessment may be shown to a Coder, and
  // a script's tests only when that script opted in. Both are looked up within
  // this submission's own Assessment: an id the worker echoes back is not proof
  // it belongs here.
  const linkedCaseIds = result.testResults
    .map((testResult) => testResult.testCaseId)
    .filter((id): id is string => id !== null);
  const linkedScriptIds = result.testResults
    .map((testResult) => testResult.testScriptId)
    .filter((id): id is string => id !== null);

  const [publicCases, scripts] = await Promise.all([
    prisma.assessmentTestCase.findMany({
      where: { id: { in: linkedCaseIds }, assessmentId: submission.assessmentId, kind: "PUBLIC" },
      select: { id: true },
    }),
    prisma.assessmentTestScript.findMany({
      where: { id: { in: linkedScriptIds }, assessmentId: submission.assessmentId },
      select: { id: true, showTestNames: true },
    }),
  ]);
  const publicCaseIds = new Set(publicCases.map((testCase) => testCase.id));
  const scriptShowsNames = new Map(scripts.map((script) => [script.id, script.showTestNames]));

  function isPublicRow(testResult: (typeof result.testResults)[number]): boolean {
    if (testResult.testCaseId !== null) return publicCaseIds.has(testResult.testCaseId);
    if (testResult.testScriptId !== null)
      return scriptShowsNames.get(testResult.testScriptId) ?? false;
    return false;
  }

  const [, , updated] = await prisma.$transaction([
    prisma.submissionTestResult.deleteMany({ where: { submissionId: submission.id } }),
    prisma.submissionTestResult.createMany({
      data: result.testResults.map((testResult) => {
        const scriptId =
          testResult.testScriptId !== null && scriptShowsNames.has(testResult.testScriptId)
            ? testResult.testScriptId
            : null;
        // A script row's output is never kept, shown or not: a framework's
        // output quotes the assertions and the values they expected.
        const fromScript = testResult.testScriptId !== null;
        return {
          submissionId: submission.id,
          testCaseId: testResult.testCaseId,
          testScriptId: scriptId,
          name: testResult.name,
          status: testResult.status,
          passed: testResult.passed,
          weight: Math.round(testResult.weight),
          executionTimeMs: Math.round(testResult.executionTimeMs),
          memoryUsedKb:
            testResult.memoryUsedKb === null ? null : Math.round(testResult.memoryUsedKb),
          stdoutExcerpt: fromScript ? "" : testResult.stdoutExcerpt,
          stderrExcerpt: fromScript ? "" : testResult.stderrExcerpt,
          isPublic: isPublicRow(testResult),
        };
      }),
    }),
    prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: result.status,
        compilerOutput: result.compilerOutput,
        systemError: result.systemError,
        executionTimeMs: Math.round(result.executionTimeMs),
        memoryUsedKb: result.memoryUsedKb === null ? null : Math.round(result.memoryUsedKb),
        score,
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
