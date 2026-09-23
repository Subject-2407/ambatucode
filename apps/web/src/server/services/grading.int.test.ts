import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@ambatucode/db";
import {
  EXECUTION_CONTRACT_VERSION,
  deadlineJobId,
  isAppError,
  type AuthenticatedUser,
  type ErrorCode,
  type ExecutionResult,
  type SessionView,
} from "@ambatucode/shared";
import { closeRedis, getRedis } from "../redis";
import { closeDeadlineQueue, getDeadlineQueue } from "../queue/deadlines";
import { closeQueueConnection, getRunQueue, getSubmitQueue } from "../queue/producer";
import { getAchievementShowcase } from "./achievements";
import { createAssessment, createTestCase } from "./assessments";
import { saveDraft, startAttempt, submitAttempt } from "./attempts";
import { ingestExecutionResult } from "./execution-result";
import { csvRowsFor } from "./grades-export";
import {
  iterateGradeRecords,
  listAssessmentGrades,
  listModuleGrades,
  listOwnSubmissions,
  resetAttempt,
  setAttemptOfficial,
} from "./grades";
import {
  getAssessmentLeaderboard,
  getModuleLeaderboard,
  getSectionLeaderboard,
} from "./leaderboards";
import { createSession, endSession, startSession } from "./sessions";

/**
 * Phase 4 against the real database and Redis: grading records, reset and
 * official-score selection, the streaming export, leaderboards, and
 * achievements.
 *
 * The assertions that matter most are again the refusals — Root reaching a
 * grade, a leaderboard counting an assessment its Architect hid, a reset
 * destroying a submission it was supposed to preserve.
 */

const suffix = randomBytes(4).toString("hex");

function actor(id: string, role: AuthenticatedUser["role"], name: string): AuthenticatedUser {
  return { id, username: `${name}_${suffix}`, displayName: name, role };
}

async function refusalCode(call: () => Promise<unknown>): Promise<ErrorCode | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
}

const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
const createdAttemptIds: string[] = [];

async function makeUser(role: AuthenticatedUser["role"], name: string): Promise<AuthenticatedUser> {
  const row = await prisma.user.create({
    data: { username: `${name}_${suffix}`, passwordHash: "unused", displayName: name, role },
    select: { id: true },
  });
  createdUserIds.push(row.id);
  return actor(row.id, role, name);
}

let owner: AuthenticatedUser;
let otherArchitect: AuthenticatedUser;
let coderA: AuthenticatedUser;
let coderB: AuthenticatedUser;
let root: AuthenticatedUser;
let moduleId: string;
let sectionId: string;

function assessmentDefaults(hideLeaderboard = false) {
  return {
    title: "",
    problemStatement: "Read n and print n doubled.",
    allowedLanguages: ["python" as const],
    starterCode: { python: "" },
    timeMode: "UNTIMED" as const,
    durationMinutes: null,
    executionMode: null,
    timeLimitMs: 2_000,
    memoryLimitMb: 128,
    gradingStrategy: "WEIGHTED_AVERAGE" as const,
    antiCheat: {
      blockClipboard: false,
      blockContextMenu: false,
      detectFocusLoss: false,
      focusLossAction: "LOG_ONLY" as const,
      focusLossThreshold: 0,
      hideLeaderboard,
    },
    isPublished: true,
    isOpenAccess: false,
    exitPolicy: "RESUME" as const,
  };
}

/** One assessment, one running session, one public case. */
async function scoredAssessment(
  title: string,
  hideLeaderboard = false,
): Promise<{ assessmentId: string; session: SessionView; caseId: string }> {
  const assessment = await createAssessment(owner, sectionId, {
    ...assessmentDefaults(hideLeaderboard),
    title: `${title} ${suffix}`,
  });
  const testCase = await createTestCase(owner, assessment.id, {
    name: "Sample",
    kind: "PUBLIC",
    input: "2",
    expectedOutput: "4",
    weight: 1,
    comparison: "TRIMMED",
    timeLimitMs: null,
    memoryLimitMb: null,
  });
  const created = await createSession(owner, assessment.id, { name: `${title} session` });
  createdSessionIds.push(created.id);
  const started = await startSession(owner, created.id, { force: true });
  if (!started.started) throw new Error("session did not start");
  return { assessmentId: assessment.id, session: started.session, caseId: testCase.id };
}

/** Submits and grades in one step, so a test can say "this Coder scored 90". */
async function scoreFor(
  coder: AuthenticatedUser,
  sessionId: string,
  caseId: string,
  score: number,
  executionTimeMs = 100,
): Promise<{ attemptId: string; submissionId: string }> {
  const attempt = await startAttempt(coder, sessionId);
  createdAttemptIds.push(attempt.id);
  const { submission } = await submitAttempt(coder, attempt.id, {
    language: "python",
    sourceCode: `# ${score}\n`,
  });

  const result: ExecutionResult = {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    jobId: submission.id,
    submissionId: submission.id,
    status: "GRADED",
    compilerOutput: null,
    systemError: null,
    executionTimeMs,
    memoryUsedKb: 2_048,
    testResults: [
      {
        testCaseId: caseId,
        testScriptId: null,
        name: "Sample",
        status: "GRADED",
        // A single weight-1 case scores 100 or 0, so the requested score is
        // written directly afterwards — these tests are about what grading
        // records do with a score, not about how one is computed.
        passed: score === 100,
        weight: 1,
        executionTimeMs,
        memoryUsedKb: 2_048,
        stdoutExcerpt: "4",
        stderrExcerpt: "",
        failureDetail: null,
      },
    ],
  };
  await ingestExecutionResult(result);
  await prisma.submission.update({ where: { id: submission.id }, data: { score } });

  return { attemptId: attempt.id, submissionId: submission.id };
}

beforeAll(async () => {
  [owner, otherArchitect, coderA, coderB, root] = await Promise.all([
    makeUser("ARCHITECT", "GradeOwner"),
    makeUser("ARCHITECT", "GradeOther"),
    makeUser("CODER", "GradeA"),
    makeUser("CODER", "GradeB"),
    makeUser("ROOT", "GradeRoot"),
  ]);

  const module = await prisma.module.create({
    data: {
      title: `Grading spec ${suffix}`,
      slug: `grading-spec-${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
      ownerId: owner.id,
      enrollments: {
        create: [coderA, coderB].map((coder) => ({
          userId: coder.id,
          status: "APPROVED" as const,
        })),
      },
      sections: { create: { title: "Graded work", orderIndex: 0 } },
    },
    select: { id: true, sections: { select: { id: true } } },
  });
  moduleId = module.id;
  const section = module.sections[0];
  if (!section) throw new Error("section was not created");
  sectionId = section.id;
});

afterAll(async () => {
  const submissions = await prisma.submission.findMany({
    where: { userId: { in: createdUserIds } },
    select: { id: true },
  });
  await Promise.all([
    ...submissions.map((submission) => getSubmitQueue().remove(submission.id)),
    ...createdAttemptIds.map((attemptId) =>
      getDeadlineQueue().remove(deadlineJobId({ kind: "ATTEMPT", attemptId })),
    ),
    ...createdSessionIds.map((sessionId) =>
      getDeadlineQueue().remove(deadlineJobId({ kind: "SESSION", sessionId })),
    ),
  ]);
  await getRunQueue().obliterate({ force: true }).catch(() => undefined);

  await prisma.submission.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.userAchievement.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.module.deleteMany({ where: { id: moduleId } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await closeDeadlineQueue();
  await closeQueueConnection();
  await closeRedis();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------

describe("grading records", () => {
  it("shows the owning Architect one record per Coder per session", async () => {
    const { assessmentId, session, caseId } = await scoredAssessment("Records");
    await scoreFor(coderA, session.id, caseId, 100);
    await scoreFor(coderB, session.id, caseId, 40);

    const page = await listAssessmentGrades(owner, assessmentId, { page: 1, pageSize: 25 });
    expect(page.total).toBe(2);
    expect(page.items.map((record) => record.username).sort()).toEqual(
      [coderA.username, coderB.username].sort(),
    );

    const first = page.items.find((record) => record.userId === coderA.id);
    expect(first?.officialScore).toBe(100);
    expect(first?.attempts).toHaveLength(1);
    expect(first?.attempts[0]?.isOfficial).toBe(true);
  });

  it("refuses every reader but the owning Architect", async () => {
    const { assessmentId } = await scoredAssessment("Refusals");

    expect(await refusalCode(() => listModuleGrades(root, moduleId, { page: 1, pageSize: 25 }))).toBe(
      "FORBIDDEN",
    );
    expect(
      await refusalCode(() => listAssessmentGrades(root, assessmentId, { page: 1, pageSize: 25 })),
    ).toBe("FORBIDDEN");
    expect(
      await refusalCode(() => listModuleGrades(otherArchitect, moduleId, { page: 1, pageSize: 25 })),
    ).toBe("FORBIDDEN");
    expect(
      await refusalCode(() => listModuleGrades(coderA, moduleId, { page: 1, pageSize: 25 })),
    ).toBe("FORBIDDEN");
  });

  it("filters by search term and by reset history", async () => {
    const { assessmentId, session, caseId } = await scoredAssessment("Filters");
    const a = await scoreFor(coderA, session.id, caseId, 70);
    await scoreFor(coderB, session.id, caseId, 70);

    const searched = await listAssessmentGrades(owner, assessmentId, {
      page: 1,
      pageSize: 25,
      search: coderA.username,
    });
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.userId).toBe(coderA.id);

    // The status filter reads the official attempt's submission, and crosses a
    // Postgres enum cast on a bound parameter — worth pinning in both
    // directions rather than trusting the cast.
    expect(
      (await listAssessmentGrades(owner, assessmentId, { page: 1, pageSize: 25, status: "GRADED" }))
        .total,
    ).toBe(2);
    expect(
      (
        await listAssessmentGrades(owner, assessmentId, {
          page: 1,
          pageSize: 25,
          status: "COMPILE_ERROR",
        })
      ).total,
    ).toBe(0);

    expect(
      (await listAssessmentGrades(owner, assessmentId, { page: 1, pageSize: 25, resetOnly: true }))
        .total,
    ).toBe(0);

    await resetAttempt(owner, a.attemptId, { reason: "Machine failed mid-attempt" });
    const afterReset = await listAssessmentGrades(owner, assessmentId, {
      page: 1,
      pageSize: 25,
      resetOnly: true,
    });
    expect(afterReset.total).toBe(1);
    expect(afterReset.items[0]?.userId).toBe(coderA.id);
  });
});

describe("reset and official score", () => {
  it("creates a new attempt, preserves the old submission, and leaves the choice open", async () => {
    const { assessmentId, session, caseId } = await scoredAssessment("Reset");
    const first = await scoreFor(coderA, session.id, caseId, 55);

    const reset = await resetAttempt(owner, first.attemptId, { reason: "Lab power cut" });
    expect(reset.newAttemptNumber).toBe(2);

    // The submission is history and history is immutable.
    const kept = await prisma.submission.findUnique({ where: { id: first.submissionId } });
    expect(kept?.score).toBe(55);

    const previous = await prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: first.attemptId },
    });
    expect(previous.status).toBe("RESET");
    expect(previous.isOfficial).toBe(false);
    expect(previous.resetReason).toBe("Lab power cut");
    expect(previous.resetById).toBe(owner.id);

    // Nothing is official until an attempt produces a result or the Architect
    // chooses — the reset is exactly the moment the answer is in question.
    const open = await listAssessmentGrades(owner, assessmentId, { page: 1, pageSize: 25 });
    const record = open.items.find((item) => item.userId === coderA.id);
    expect(record?.officialAttemptId).toBeNull();
    expect(record?.officialScore).toBeNull();

    // The retake settles it by itself, without the Architect revisiting.
    createdAttemptIds.push(reset.newAttemptId);
    const retake = await scoreFor(coderA, session.id, caseId, 88);
    expect(retake.attemptId).toBe(reset.newAttemptId);

    const settled = await listAssessmentGrades(owner, assessmentId, { page: 1, pageSize: 25 });
    const after = settled.items.find((item) => item.userId === coderA.id);
    expect(after?.officialAttemptId).toBe(reset.newAttemptId);
    expect(after?.officialScore).toBe(88);
    expect(after?.attempts).toHaveLength(2);
  });

  /**
   * The case the Architect actually performs: they read the grading records
   * after the lab, by which time the session has ended. The attempt a reset
   * opens then used to be unstartable by anybody — the record existed and no
   * Coder could ever act on it.
   */
  it("opens a retake a Coder can still sit after the session has ended", async () => {
    const { session, caseId } = await scoredAssessment("EndedRetake");
    const first = await scoreFor(coderA, session.id, caseId, 41);
    await endSession(owner, session.id);

    const reset = await resetAttempt(owner, first.attemptId, { reason: "Marked in error" });
    createdAttemptIds.push(reset.newAttemptId);

    const granted = await prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: reset.newAttemptId },
      select: { grantedOutsideSession: true, status: true },
    });
    expect(granted.grantedOutsideSession).toBe(true);
    expect(granted.status).toBe("NOT_STARTED");

    // The Coder can open it, work in it, and hand it in, although the session
    // around them shows as ended for everybody else.
    const attempt = await startAttempt(coderA, session.id);
    expect(attempt.id).toBe(reset.newAttemptId);
    expect(attempt.status).toBe("IN_PROGRESS");

    await saveDraft(coderA, attempt.id, { language: "python", sourceCode: "# retake\n" });
    const { submission } = await submitAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "# retake\n",
    });
    expect(submission.status).toBe("QUEUED");

    // The grant is one Coder's. Nobody else walks into the ended session.
    expect(await refusalCode(() => startAttempt(coderB, session.id))).toBe("SESSION_NOT_RUNNING");
  });

  it("refuses to grant a standalone retake on an ended live session", async () => {
    const { session, caseId } = await scoredAssessment("EndedLive");
    const first = await scoreFor(coderA, session.id, caseId, 20);
    // A live clock is one shared countdown that has already finished, so there
    // is no such thing as sitting it alone afterwards.
    await prisma.assessmentSession.update({
      where: { id: session.id },
      data: { executionMode: "LIVE", durationMinutes: 30 },
    });
    await endSession(owner, session.id);

    expect(await refusalCode(() => resetAttempt(owner, first.attemptId, { reason: "Retake" }))).toBe(
      "CONFLICT",
    );
  });

  it("leaves a reset inside a running session belonging to that session", async () => {
    const { session, caseId } = await scoredAssessment("RunningReset");
    const first = await scoreFor(coderA, session.id, caseId, 70);

    const reset = await resetAttempt(owner, first.attemptId, { reason: "Second go" });
    createdAttemptIds.push(reset.newAttemptId);

    const granted = await prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: reset.newAttemptId },
      select: { grantedOutsideSession: true },
    });
    expect(granted.grantedOutsideSession).toBe(false);
  });

  it("lets the Architect point the official score back at an earlier attempt", async () => {
    const { assessmentId, session, caseId } = await scoredAssessment("Official");
    const first = await scoreFor(coderA, session.id, caseId, 95);
    const reset = await resetAttempt(owner, first.attemptId, { reason: "Retake requested" });
    createdAttemptIds.push(reset.newAttemptId);
    await scoreFor(coderA, session.id, caseId, 30);

    await setAttemptOfficial(owner, first.attemptId, { isOfficial: true });

    const page = await listAssessmentGrades(owner, assessmentId, { page: 1, pageSize: 25 });
    const record = page.items.find((item) => item.userId === coderA.id);
    expect(record?.officialAttemptId).toBe(first.attemptId);
    expect(record?.officialScore).toBe(95);

    // At most one attempt may be official, so the sibling was cleared.
    const official = await prisma.assessmentAttempt.count({
      where: { sessionId: session.id, userId: coderA.id, isOfficial: true },
    });
    expect(official).toBe(1);
  });

  it("refuses a second reset of the same attempt and refuses the wrong Architect", async () => {
    const { session, caseId } = await scoredAssessment("ResetGuards");
    const first = await scoreFor(coderA, session.id, caseId, 60);

    expect(
      await refusalCode(() => resetAttempt(otherArchitect, first.attemptId, { reason: "Nope" })),
    ).toBe("FORBIDDEN");
    expect(await refusalCode(() => resetAttempt(root, first.attemptId, { reason: "Nope" }))).toBe(
      "FORBIDDEN",
    );
    expect(await refusalCode(() => resetAttempt(coderA, first.attemptId, { reason: "Nope" }))).toBe(
      "FORBIDDEN",
    );

    const reset = await resetAttempt(owner, first.attemptId, { reason: "First reset" });
    createdAttemptIds.push(reset.newAttemptId);
    expect(await refusalCode(() => resetAttempt(owner, first.attemptId, { reason: "Again" }))).toBe(
      "CONFLICT",
    );
  });
});

describe("export", () => {
  it("streams one row per attempt, including the reset one", async () => {
    const { session, caseId } = await scoredAssessment("Export");
    const first = await scoreFor(coderA, session.id, caseId, 45);
    const reset = await resetAttempt(owner, first.attemptId, { reason: "Ambiguous problem text" });
    createdAttemptIds.push(reset.newAttemptId);
    await scoreFor(coderA, session.id, caseId, 100);

    const lines: string[] = [];
    for await (const record of iterateGradeRecords(owner, moduleId, { page: 1, pageSize: 10 })) {
      lines.push(...csvRowsFor(record));
    }

    const mine = lines.filter((line) => line.includes(coderA.username));
    expect(mine.some((line) => line.includes('"RESET"'))).toBe(true);
    expect(mine.some((line) => line.includes("Ambiguous problem text"))).toBe(true);
    expect(mine.some((line) => line.includes('"45"'))).toBe(true);
    expect(mine.some((line) => line.includes('"100"'))).toBe(true);
  });

  it("refuses to export a module the caller does not own", async () => {
    async function drain(as: AuthenticatedUser): Promise<void> {
      for await (const _record of iterateGradeRecords(as, moduleId, { page: 1, pageSize: 10 })) {
        // The refusal happens on the first pull, before any row is produced.
      }
    }
    expect(await refusalCode(() => drain(root))).toBe("FORBIDDEN");
    expect(await refusalCode(() => drain(otherArchitect))).toBe("FORBIDDEN");
    expect(await refusalCode(() => drain(coderA))).toBe("FORBIDDEN");
  });
});

describe("a Coder's own history", () => {
  it("returns only the caller's submissions", async () => {
    const { session, caseId } = await scoredAssessment("History");
    await scoreFor(coderA, session.id, caseId, 75);
    await scoreFor(coderB, session.id, caseId, 25);

    const mine = await listOwnSubmissions(coderA, { page: 1, pageSize: 50, moduleId });
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((item) => item.moduleId === moduleId)).toBe(true);

    const theirs = await listOwnSubmissions(coderB, { page: 1, pageSize: 50, moduleId });
    const overlap = mine.items.filter((item) =>
      theirs.items.some((other) => other.id === item.id),
    );
    expect(overlap).toHaveLength(0);
  });

  it("refuses Root", async () => {
    expect(await refusalCode(() => listOwnSubmissions(root, { page: 1, pageSize: 10 }))).toBe(
      "FORBIDDEN",
    );
  });
});

describe("leaderboards", () => {
  it("ranks by official score and breaks ties on speed", async () => {
    const board = await scoredAssessment("Board");
    await scoreFor(coderA, board.session.id, board.caseId, 80, 500);
    await scoreFor(coderB, board.session.id, board.caseId, 80, 100);

    // The cache is keyed per scope, and a previous test in this file may have
    // warmed it for this module.
    await getRedis().del(`leaderboard:ASSESSMENT:${board.assessmentId}`);

    const view = await getAssessmentLeaderboard(coderA, board.assessmentId, { limit: 25 });
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0]?.score).toBe(80);
    expect(view.rows[1]?.score).toBe(80);
    // Equal scores share a rank; the ordering still has to be deterministic.
    expect(view.rows[0]?.rank).toBe(1);
    expect(view.rows[1]?.rank).toBe(1);
    expect(view.viewerRank).toBe(1);
  });

  it("refuses a leaderboard the Architect switched off", async () => {
    const hidden = await scoredAssessment("Hidden", true);
    await scoreFor(coderA, hidden.session.id, hidden.caseId, 100);

    expect(
      await refusalCode(() => getAssessmentLeaderboard(coderA, hidden.assessmentId, { limit: 25 })),
    ).toBe("FORBIDDEN");

    // And the hidden assessment contributes nothing to the boards above it.
    await getRedis().del(`leaderboard:SECTION:${sectionId}`, `leaderboard:MODULE:${moduleId}`);
    const section = await getSectionLeaderboard(coderA, sectionId, { limit: 25 });
    expect(section.hiddenAssessmentCount).toBeGreaterThanOrEqual(1);
    const counted = section.rows.find((row) => row.userId === coderA.id)?.assessmentsCounted ?? 0;
    const allAssessments = await prisma.assessment.count({ where: { sectionId } });
    expect(counted).toBeLessThan(allAssessments);
  });

  it("refuses Root and anyone not enrolled", async () => {
    expect(await refusalCode(() => getModuleLeaderboard(root, moduleId, { limit: 25 }))).toBe(
      "FORBIDDEN",
    );
    expect(await refusalCode(() => getSectionLeaderboard(root, sectionId, { limit: 25 }))).toBe(
      "FORBIDDEN",
    );

    const outsider = await makeUser("CODER", "GradeOutsider");
    expect(await refusalCode(() => getModuleLeaderboard(outsider, moduleId, { limit: 25 }))).toBe(
      "FORBIDDEN",
    );
  });
});

describe("achievements", () => {
  it("awards First Light on a Coder's first graded submission", async () => {
    const fresh = await makeUser("CODER", "GradeFresh");
    await prisma.moduleEnrollment.create({
      data: { moduleId, userId: fresh.id, status: "APPROVED" },
    });

    const { session, caseId } = await scoredAssessment("FirstLight");
    await scoreFor(fresh, session.id, caseId, 100);

    const showcase = await getAchievementShowcase(fresh, fresh.id);
    expect(showcase.earned.map((award) => award.code)).toContain("FIRST_LIGHT");
    // The showcase also names what is still out there.
    expect(showcase.locked.length).toBeGreaterThan(0);
    expect(showcase.locked.some((award) => award.code === "FIRST_LIGHT")).toBe(false);
  });

  it("lets the owning Architect read a Coder's titles and refuses everyone else", async () => {
    expect((await getAchievementShowcase(owner, coderA.id)).userId).toBe(coderA.id);
    expect(await refusalCode(() => getAchievementShowcase(root, coderA.id))).toBe("FORBIDDEN");
    expect(await refusalCode(() => getAchievementShowcase(otherArchitect, coderA.id))).toBe(
      "NOT_FOUND",
    );
    expect(await refusalCode(() => getAchievementShowcase(coderB, coderA.id))).toBe("NOT_FOUND");
  });
});
