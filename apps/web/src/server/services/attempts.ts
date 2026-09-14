import "server-only";
import { randomUUID } from "node:crypto";
import { PRISMA_UNIQUE_VIOLATION, isPrismaErrorCode, prisma, type Prisma } from "@ambatucode/db";
import {
  AppError,
  DEFAULT_EXECUTION_LIMITS,
  attemptActivityProblem,
  attemptDeadlineMs,
  individualDeadlineFrom,
  isAttemptOverdue,
  isLanguage,
  type AttemptView,
  type AuthenticatedUser,
  type AutoSubmitOutcome,
  type AutoSubmitReason,
  type ExecutionLimits,
  type ExecutionTestCase,
  type ExecutionTestScript,
  type Language,
  type MonitorEventPayload,
  type RunAttemptRequest,
  type RunAttemptResponse,
  type SaveDraftRequest,
  type SaveDraftResponse,
  type SubmissionSummary,
  type SubmitAttemptRequest,
  type SubmitAttemptResponse,
} from "@ambatucode/shared";
import { requireEnrolled } from "../auth/guards";
import { consumeRateLimit } from "../auth/rate-limit";
import { cancelDeadline, scheduleDeadline } from "../queue/deadlines";
import { enqueueExecutionJob } from "../queue/producer";
import { publishAssessmentBroadcast, publishExecutionStatus } from "../realtime/publish";
import {
  clockFor,
  readScriptContent,
  toAssessmentWorkspaceView,
  toAttemptView,
  toSubmissionSummary,
} from "../serializers/assessment";
import { announceEvents, recordEvent } from "./assessment-events";
import { scopeForOwnAttempt, scopeForSession } from "./assessment-scope";
import { ASSESSMENT_SELECT } from "./assessments";
import { sessionEligibility } from "./participation";

/**
 * Assessment Attempts: starting one, saving its draft, running it against the
 * public cases, submitting it, and closing it on the Coder's behalf.
 *
 * Three rules shape everything below:
 *
 * 1. The server owns the clock. Every write re-checks the deadline from the
 *    database; nothing the browser says about time is trusted.
 * 2. Submit uses the source in the request. The draft is for recovery and for
 *    auto-submit, never for a Coder's own Submit.
 * 3. One formal Submission per attempt, enforced by locking the attempt row —
 *    a read-then-write check would let two concurrent submits both win.
 */

/** Runs per Coder per attempt. Enough for real iteration; bounded because each costs a container. */
const RUN_RATE_LIMIT = { max: 30, windowSeconds: 60 } as const;

const SUBMISSION_SUMMARY_SELECT = {
  id: true,
  attemptId: true,
  status: true,
  score: true,
  language: true,
  isAutoSubmitted: true,
  submittedAt: true,
  gradedAt: true,
} satisfies Prisma.SubmissionSelect;

const ACTIVITY_MESSAGES = {
  ATTEMPT_ALREADY_SUBMITTED: "This attempt has already been submitted",
  ATTEMPT_EXPIRED: "This attempt has ended",
  SESSION_NOT_RUNNING: "This session is not running",
} as const;

function assertLanguageAllowed(allowed: string[], language: Language): void {
  if (!allowed.includes(language)) {
    throw new AppError("LANGUAGE_NOT_ALLOWED", "This assessment does not allow that language");
  }
}

/**
 * Row-level lock on the attempt for the rest of the transaction. Submit,
 * auto-submit, and expiry all take it, so exactly one of them closes the
 * attempt and the others see it closed.
 */
async function lockAttempt(tx: Prisma.TransactionClient, attemptId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "AssessmentAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
}

const ATTEMPT_ACTIVITY_SELECT = {
  status: true,
  individualDeadlineAt: true,
  pausedAt: true,
  consumedMs: true,
  session: {
    select: { status: true, executionMode: true, durationMinutes: true, endsAt: true },
  },
} satisfies Prisma.AssessmentAttemptSelect;

function assertActive(
  attempt: Prisma.AssessmentAttemptGetPayload<{ select: typeof ATTEMPT_ACTIVITY_SELECT }>,
  nowMs: number,
): void {
  const problem = attemptActivityProblem({
    status: attempt.status,
    sessionStatus: attempt.session.status,
    clock: clockFor(attempt, attempt.session),
    nowMs,
  });
  if (problem) throw new AppError(problem, ACTIVITY_MESSAGES[problem]);
}

async function loadAttemptView(attemptId: string): Promise<AttemptView> {
  const attempt = await prisma.assessmentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      id: true,
      sessionId: true,
      attemptNumber: true,
      status: true,
      startedAt: true,
      individualDeadlineAt: true,
      pausedAt: true,
      consumedMs: true,
      draft: { select: { language: true, sourceCode: true, savedAt: true } },
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: SUBMISSION_SUMMARY_SELECT,
      },
      session: {
        select: {
          executionMode: true,
          durationMinutes: true,
          endsAt: true,
          assessment: {
            select: {
              ...ASSESSMENT_SELECT,
              testCases: {
                where: { kind: "PUBLIC" },
                orderBy: { orderIndex: "asc" },
                select: { kind: true, name: true, input: true, expectedOutput: true },
              },
            },
          },
        },
      },
    },
  });

  return toAttemptView({
    attempt,
    session: attempt.session,
    submission: attempt.submissions[0] ?? null,
    assessment: toAssessmentWorkspaceView(attempt.session.assessment),
    nowMs: Date.now(),
  });
}

// --- Start --------------------------------------------------------------------

/**
 * Begins the Coder's attempt in a running session, or hands back the one they
 * already have. Calling it again is safe: a refresh, a second tab, and a
 * reconnect all land here and all get the same attempt.
 *
 * An Individual attempt's clock starts now. A Live attempt has no clock of its
 * own — it shares the session's `endsAt`, so a Coder who arrives late simply
 * has less of it left.
 */
export async function startAttempt(
  actor: AuthenticatedUser,
  sessionId: string,
): Promise<AttemptView> {
  if (actor.role !== "CODER") {
    throw new AppError("FORBIDDEN", "Only a Coder takes part in an assessment session");
  }

  const scope = await scopeForSession(sessionId);
  await requireEnrolled(actor, scope.moduleId);
  if (!scope.isPublished) {
    throw new AppError("NOT_FOUND", "Session not found");
  }

  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { status: true, executionMode: true, durationMinutes: true, endsAt: true },
  });
  if (session.status !== "RUNNING") {
    throw new AppError("SESSION_NOT_RUNNING", ACTIVITY_MESSAGES.SESSION_NOT_RUNNING);
  }

  const eligibility = await sessionEligibility(sessionId, actor.id, session.executionMode);
  if (!eligibility.eligible) {
    throw new AppError("FORBIDDEN", "You are not a participant in this session");
  }

  const now = new Date();
  if (session.endsAt !== null && session.endsAt.getTime() <= now.getTime()) {
    throw new AppError("ATTEMPT_EXPIRED", ACTIVITY_MESSAGES.ATTEMPT_EXPIRED);
  }

  // A Coder admitted to an open session is tracked like a listed one — the row
  // is what holds their connection — but stays unlisted, so admitting them
  // does not turn the session into a restricted one.
  if (!eligibility.listed) {
    await prisma.assessmentParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId: actor.id } },
      create: { sessionId, userId: actor.id, isListed: false },
      update: {},
    });
  }

  const deadlineAtMs = individualDeadlineFrom(
    {
      executionMode: session.executionMode,
      durationMinutes: session.durationMinutes,
      endsAtMs: session.endsAt?.getTime() ?? null,
    },
    now.getTime(),
  );
  const startFields = {
    status: "IN_PROGRESS" as const,
    startedAt: now,
    individualDeadlineAt: deadlineAtMs === null ? null : new Date(deadlineAtMs),
    consumedMs: 0,
    pausedAt: null,
  };

  const latest = await prisma.assessmentAttempt.findFirst({
    where: { sessionId, userId: actor.id },
    orderBy: { attemptNumber: "desc" },
    select: { id: true, status: true },
  });

  let attemptId = latest?.id ?? null;
  let startedEvent: MonitorEventPayload | null = null;

  if (latest === null) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const attempt = await tx.assessmentAttempt.create({
          data: { sessionId, userId: actor.id, attemptNumber: 1, isOfficial: true, ...startFields },
          select: { id: true },
        });
        const event = await recordEvent(tx, {
          sessionId,
          type: "ATTEMPT_STARTED",
          userId: actor.id,
          attemptId: attempt.id,
          occurredAt: now,
        });
        return { attemptId: attempt.id, event };
      });
      attemptId = created.attemptId;
      startedEvent = created.event;
    } catch (error) {
      // Two starts raced — a double click, two tabs. The other one created the
      // attempt; this one hands it back.
      if (!isPrismaErrorCode(error, PRISMA_UNIQUE_VIOLATION)) throw error;
      const winner = await prisma.assessmentAttempt.findFirstOrThrow({
        where: { sessionId, userId: actor.id },
        orderBy: { attemptNumber: "desc" },
        select: { id: true },
      });
      attemptId = winner.id;
    }
  } else if (latest.status === "NOT_STARTED") {
    // A reset leaves a fresh attempt waiting for the Coder to press Start.
    startedEvent = await prisma.$transaction(async (tx) => {
      const started = await tx.assessmentAttempt.updateMany({
        where: { id: latest.id, status: "NOT_STARTED" },
        data: startFields,
      });
      if (started.count === 0) return null;
      return recordEvent(tx, {
        sessionId,
        type: "ATTEMPT_STARTED",
        userId: actor.id,
        attemptId: latest.id,
        occurredAt: now,
      });
    });
  }

  if (attemptId === null) {
    throw new AppError("INTERNAL", "Attempt could not be resolved after start");
  }

  if (startedEvent !== null) {
    if (deadlineAtMs !== null) {
      await scheduleDeadline({ kind: "ATTEMPT", attemptId }, deadlineAtMs, now.getTime());
    }
    await announceEvents([startedEvent]);
  }

  return loadAttemptView(attemptId);
}

export async function getAttempt(
  actor: AuthenticatedUser,
  attemptId: string,
): Promise<AttemptView> {
  await scopeForOwnAttempt(attemptId, actor.id);
  return loadAttemptView(attemptId);
}

// --- Draft and Run ------------------------------------------------------------

/**
 * Overwrites the one stored draft. Idempotent, and refused once the attempt is
 * no longer running — an autosave that lands after the deadline must not
 * change what auto-submit already took.
 */
export async function saveDraft(
  actor: AuthenticatedUser,
  attemptId: string,
  input: SaveDraftRequest,
): Promise<SaveDraftResponse> {
  const scope = await scopeForOwnAttempt(attemptId, actor.id);

  const [attempt, assessment] = await Promise.all([
    prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: ATTEMPT_ACTIVITY_SELECT,
    }),
    prisma.assessment.findUniqueOrThrow({
      where: { id: scope.assessmentId },
      select: { allowedLanguages: true },
    }),
  ]);
  assertActive(attempt, Date.now());
  assertLanguageAllowed(assessment.allowedLanguages, input.language);

  const savedAt = new Date();
  await prisma.attemptDraft.upsert({
    where: { attemptId },
    create: { attemptId, language: input.language, sourceCode: input.sourceCode, savedAt },
    update: { language: input.language, sourceCode: input.sourceCode, savedAt },
  });
  return { savedAt: savedAt.toISOString() };
}

function limitsFor(
  assessment: { timeLimitMs: number; memoryLimitMb: number },
  testCases: ReadonlyArray<{ timeLimitMs: number | null }>,
  scriptCount: number,
): ExecutionLimits {
  // Each case runs for its own limit when it has one, so the budget is the sum
  // of what every case may actually take.
  const caseBudgetMs =
    testCases.length === 0
      ? assessment.timeLimitMs
      : testCases.reduce(
          (total, testCase) => total + (testCase.timeLimitMs ?? assessment.timeLimitMs),
          0,
        );

  return {
    ...DEFAULT_EXECUTION_LIMITS,
    runTimeoutMs: assessment.timeLimitMs,
    memoryLimitMb: assessment.memoryLimitMb,
    // The wall clock covers compilation plus every case in sequence, and each
    // script run on top in its own container, so it grows with the work rather
    // than killing a legitimate submission for taking as long as configured.
    wallTimeoutMs: Math.max(
      DEFAULT_EXECUTION_LIMITS.wallTimeoutMs,
      DEFAULT_EXECUTION_LIMITS.compileTimeoutMs +
        caseBudgetMs +
        scriptCount * DEFAULT_EXECUTION_LIMITS.wallTimeoutMs,
    ),
  };
}

/**
 * Runs the editor's code against the public sample cases. Consumes nothing and
 * writes nothing; the per-case results come back over `submission:status`.
 */
export async function runAttempt(
  actor: AuthenticatedUser,
  attemptId: string,
  input: RunAttemptRequest,
): Promise<RunAttemptResponse> {
  const scope = await scopeForOwnAttempt(attemptId, actor.id);

  const [attempt, assessment] = await Promise.all([
    prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: ATTEMPT_ACTIVITY_SELECT,
    }),
    prisma.assessment.findUniqueOrThrow({
      where: { id: scope.assessmentId },
      select: {
        allowedLanguages: true,
        timeLimitMs: true,
        memoryLimitMb: true,
        // PUBLIC only, at the query. A Run's payload never has a hidden case
        // to leak, and the producer refuses one anyway.
        testCases: {
          where: { kind: "PUBLIC" },
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            name: true,
            input: true,
            expectedOutput: true,
            comparison: true,
            timeLimitMs: true,
            memoryLimitMb: true,
          },
        },
      },
    }),
  ]);
  assertActive(attempt, Date.now());
  assertLanguageAllowed(assessment.allowedLanguages, input.language);

  if (assessment.testCases.length === 0) {
    throw new AppError("VALIDATION_FAILED", "This assessment has no sample cases to run against");
  }

  const limit = await consumeRateLimit(
    `attempt-run:${actor.id}:${attemptId}`,
    RUN_RATE_LIMIT.max,
    RUN_RATE_LIMIT.windowSeconds,
  );
  if (!limit.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      `Too many runs. Try again in ${limit.retryAfterSeconds} seconds`,
    );
  }

  const testCases: ExecutionTestCase[] = assessment.testCases.map((testCase) => ({
    id: testCase.id,
    name: testCase.name,
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    // A Run produces no grade, so weight carries nothing here.
    weight: 1,
    isPublic: true,
    comparison: testCase.comparison,
    // A Run respects the same per-case limits the formal submission will.
    timeLimitMs: testCase.timeLimitMs,
    memoryLimitMb: testCase.memoryLimitMb,
  }));

  const jobId = await enqueueExecutionJob(
    {
      jobId: randomUUID(),
      kind: "RUN",
      submissionId: null,
      language: input.language,
      sourceCode: input.sourceCode,
      limits: limitsFor(assessment, testCases, 0),
      testCases,
      // An attempt's Run shows public cases only. Scripts grade the formal
      // submission, and running them here would preview hidden grading.
      testScripts: [],
    },
    { userId: actor.id },
  );
  return { jobId };
}

// --- Submission ---------------------------------------------------------------

/**
 * Queues a persisted Submission for grading.
 *
 * The row already exists with status QUEUED — it is written before the job, so
 * a crash between the two leaves a visible submission rather than a graded job
 * with nowhere to land. If the enqueue itself fails, the row is marked
 * SYSTEM_ERROR instead of being left QUEUED forever.
 */
async function dispatchSubmission(submissionId: string): Promise<SubmissionSummary> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: {
      ...SUBMISSION_SUMMARY_SELECT,
      userId: true,
      sourceCode: true,
      assessment: {
        select: {
          timeLimitMs: true,
          memoryLimitMb: true,
          testCases: {
            orderBy: { orderIndex: "asc" },
            select: {
              id: true,
              name: true,
              input: true,
              expectedOutput: true,
              weight: true,
              comparison: true,
              kind: true,
              timeLimitMs: true,
              memoryLimitMb: true,
            },
          },
          testScripts: {
            orderBy: { entrypoint: "asc" },
            select: {
              id: true,
              language: true,
              framework: true,
              entrypoint: true,
              filesJson: true,
              weight: true,
            },
          },
        },
      },
    },
  });

  try {
    if (!isLanguage(submission.language)) {
      throw new Error(`Submission language "${submission.language}" is not a known language`);
    }
    const language = submission.language;
    const testScripts: ExecutionTestScript[] = submission.assessment.testScripts
      .filter((script) => script.language === language)
      .map((script) => ({
        id: script.id,
        framework: script.framework,
        path: script.entrypoint,
        content: readScriptContent(script),
        weight: script.weight,
      }));
    const testCases: ExecutionTestCase[] = submission.assessment.testCases.map((testCase) => ({
      id: testCase.id,
      name: testCase.name,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      weight: testCase.weight,
      isPublic: testCase.kind === "PUBLIC",
      comparison: testCase.comparison,
      timeLimitMs: testCase.timeLimitMs,
      memoryLimitMb: testCase.memoryLimitMb,
    }));

    await enqueueExecutionJob(
      {
        // The Submission id is the job id: re-enqueueing the same submission
        // is a no-op in BullMQ rather than a second grading run.
        jobId: submission.id,
        kind: "SUBMIT",
        submissionId: submission.id,
        language,
        sourceCode: submission.sourceCode,
        limits: limitsFor(submission.assessment, testCases, testScripts.length),
        testCases,
        testScripts,
      },
      { userId: submission.userId },
    );

    const queued = await prisma.submission.update({
      where: { id: submission.id },
      data: { jobId: submission.id },
      select: SUBMISSION_SUMMARY_SELECT,
    });
    return toSubmissionSummary(queued);
  } catch (error) {
    console.error(`[submissions] failed to queue ${submission.id}:`, error);
    const failed = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: "SYSTEM_ERROR",
        score: 0,
        systemError: "The submission could not be queued for grading",
        gradedAt: new Date(),
      },
      select: SUBMISSION_SUMMARY_SELECT,
    });
    await publishExecutionStatus({
      userId: submission.userId,
      payload: {
        kind: "SUBMIT",
        jobId: submission.id,
        submissionId: submission.id,
        status: failed.status,
        score: failed.score,
      },
    });
    return toSubmissionSummary(failed);
  }
}

/**
 * The Coder's one formal Submit.
 *
 * The source is exactly what the request carries. The attempt row is locked
 * for the transaction, its state and deadline are re-read under the lock, and
 * the loser of a concurrent submit — or a submit racing auto-submit — gets
 * ATTEMPT_ALREADY_SUBMITTED.
 */
export async function submitAttempt(
  actor: AuthenticatedUser,
  attemptId: string,
  input: SubmitAttemptRequest,
): Promise<SubmitAttemptResponse> {
  const scope = await scopeForOwnAttempt(attemptId, actor.id);

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: scope.assessmentId },
    select: { allowedLanguages: true },
  });
  assertLanguageAllowed(assessment.allowedLanguages, input.language);

  const now = new Date();
  const { submissionId, event } = await prisma.$transaction(async (tx) => {
    await lockAttempt(tx, attemptId);
    const attempt = await tx.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: ATTEMPT_ACTIVITY_SELECT,
    });
    assertActive(attempt, now.getTime());

    const submission = await tx.submission.create({
      data: {
        attemptId,
        userId: actor.id,
        assessmentId: scope.assessmentId,
        sessionId: scope.sessionId,
        language: input.language,
        sourceCode: input.sourceCode,
        status: "QUEUED",
        isAutoSubmitted: false,
        submittedAt: now,
      },
      select: { id: true },
    });
    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: { status: "SUBMITTED" },
    });
    const recorded = await recordEvent(tx, {
      sessionId: scope.sessionId,
      type: "ATTEMPT_SUBMITTED",
      userId: actor.id,
      attemptId,
      occurredAt: now,
      payload: { submissionId: submission.id },
    });
    return { submissionId: submission.id, event: recorded };
  });

  await cancelDeadline({ kind: "ATTEMPT", attemptId });
  const submission = await dispatchSubmission(submissionId);
  await announceEvents([event]);
  await publishAssessmentBroadcast({ type: "ATTEMPT_CLOSED", userId: actor.id, attemptId });

  return { submission };
}

/**
 * Closes an attempt on the Coder's behalf, from what the server already holds.
 *
 * With a stored draft, that draft becomes the Submission. Without one there is
 * no code to submit and the attempt expires — the server never waits for the
 * browser to send something after the deadline. For a DEADLINE the database
 * decides whether it is actually due; a stale or early alarm is rescheduled.
 */
export async function autoSubmitAttempt(
  attemptId: string,
  options: { reason: AutoSubmitReason },
  nowMs: number = Date.now(),
): Promise<AutoSubmitOutcome> {
  const now = new Date(nowMs);

  const result = await prisma.$transaction(async (tx) => {
    await lockAttempt(tx, attemptId);
    const attempt = await tx.assessmentAttempt.findUnique({
      where: { id: attemptId },
      select: {
        ...ATTEMPT_ACTIVITY_SELECT,
        userId: true,
        sessionId: true,
        draft: { select: { language: true, sourceCode: true } },
        session: {
          select: {
            status: true,
            executionMode: true,
            durationMinutes: true,
            endsAt: true,
            assessmentId: true,
          },
        },
      },
    });
    if (!attempt || attempt.status !== "IN_PROGRESS") {
      return { outcome: "NOT_ACTIVE" as const };
    }

    // Closing for a session end is only valid once the session has ended.
    if (options.reason === "SESSION_ENDED" && attempt.session.status === "RUNNING") {
      return { outcome: "NOT_DUE" as const, deadlineMs: null, individual: false };
    }

    const clock = clockFor(attempt, attempt.session);
    if (options.reason === "DEADLINE" && !isAttemptOverdue(clock, nowMs)) {
      return {
        outcome: "NOT_DUE" as const,
        deadlineMs: attemptDeadlineMs(clock),
        individual: attempt.session.executionMode === "INDIVIDUAL",
      };
    }

    if (attempt.draft !== null) {
      const submission = await tx.submission.create({
        data: {
          attemptId,
          userId: attempt.userId,
          assessmentId: attempt.session.assessmentId,
          sessionId: attempt.sessionId,
          language: attempt.draft.language,
          sourceCode: attempt.draft.sourceCode,
          status: "QUEUED",
          isAutoSubmitted: true,
          submittedAt: now,
        },
        select: { id: true },
      });
      await tx.assessmentAttempt.update({
        where: { id: attemptId },
        data: { status: "SUBMITTED" },
      });
      const event = await recordEvent(tx, {
        sessionId: attempt.sessionId,
        type: "ATTEMPT_AUTO_SUBMITTED",
        userId: attempt.userId,
        attemptId,
        occurredAt: now,
        payload: { reason: options.reason, submissionId: submission.id },
      });
      return {
        outcome: "SUBMITTED" as const,
        submissionId: submission.id,
        userId: attempt.userId,
        event,
      };
    }

    await tx.assessmentAttempt.update({ where: { id: attemptId }, data: { status: "EXPIRED" } });
    const event = await recordEvent(tx, {
      sessionId: attempt.sessionId,
      type: "ATTEMPT_EXPIRED",
      userId: attempt.userId,
      attemptId,
      occurredAt: now,
      payload: { reason: options.reason },
    });
    return { outcome: "EXPIRED" as const, userId: attempt.userId, event };
  });

  switch (result.outcome) {
    case "NOT_ACTIVE":
      return { outcome: "NOT_ACTIVE", submissionId: null };

    case "NOT_DUE":
      // Live attempts have no alarm of their own; the session's covers them.
      if (result.individual && result.deadlineMs !== null) {
        await scheduleDeadline({ kind: "ATTEMPT", attemptId }, result.deadlineMs, nowMs);
      }
      return { outcome: "NOT_DUE", submissionId: null };

    case "SUBMITTED":
      await cancelDeadline({ kind: "ATTEMPT", attemptId });
      await dispatchSubmission(result.submissionId);
      await announceEvents([result.event]);
      await publishAssessmentBroadcast({
        type: "ATTEMPT_AUTO_SUBMITTED",
        userId: result.userId,
        attemptId,
        payload: { submissionId: result.submissionId },
      });
      await publishAssessmentBroadcast({
        type: "ATTEMPT_CLOSED",
        userId: result.userId,
        attemptId,
      });
      return { outcome: "SUBMITTED", submissionId: result.submissionId };

    case "EXPIRED":
      await cancelDeadline({ kind: "ATTEMPT", attemptId });
      await announceEvents([result.event]);
      await publishAssessmentBroadcast({
        type: "ATTEMPT_CLOSED",
        userId: result.userId,
        attemptId,
      });
      return { outcome: "EXPIRED", submissionId: null };
  }
}
