import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@ambatucode/db";
import {
  EXECUTION_CONTRACT_VERSION,
  MAX_TEST_SCRIPTS_PER_LANGUAGE,
  QUEUE_NAMES,
  deadlineJobId,
  isAppError,
  type AssessmentArchitectView,
  type AuthenticatedUser,
  type ErrorCode,
  type ExecutionResult,
  type SessionView,
} from "@ambatucode/shared";
import {
  INTERNAL_TOKEN_HEADER,
  autoSubmitScope,
  issueInternalToken,
} from "@ambatucode/shared/auth/internal-token";
import { POST as autoSubmitRoute } from "@/app/api/internal/attempts/[attemptId]/auto-submit/route";
import { POST as executionResultRoute } from "@/app/api/internal/execution/result/route";
import { issueCallbackToken } from "../auth/callback-token";
import { getServerEnv } from "../env";
import { closeRedis } from "../redis";
import { closeDeadlineQueue, getDeadlineQueue } from "../queue/deadlines";
import { closeQueueConnection, getRunQueue, getSubmitQueue } from "../queue/producer";
import {
  createAssessment,
  createTestCase,
  getAssessment,
  listTestCases,
  saveReferenceSolution,
  updateAssessment,
  uploadTestScript,
  validateTestScripts,
} from "./assessments";
import {
  autoSubmitAttempt,
  getAttemptSource,
  runAttempt,
  saveDraft,
  startAttempt,
  submitAttempt,
} from "./attempts";
import { EXPIRED_RESULT_MESSAGE, ingestExecutionResult } from "./execution-result";
import {
  createSession,
  deleteSession,
  endSession,
  getMonitorSnapshot,
  getSession,
  listSessions,
  replaceParticipants,
  startSession,
} from "./sessions";
import { getSubmission } from "./submissions";

/**
 * The Phase 3 backend end to end against the real database and Redis:
 * authoring an Assessment, running sessions, attempts, submissions, deadline
 * auto-submit, and grading.
 *
 * As in the content spec, the assertions that matter most are the refusals —
 * a hidden case in a Coder's response, a second formal submission, a submit
 * that graded the draft instead of what was sent.
 */

const suffix = randomBytes(4).toString("hex");
const MINUTE = 60_000;

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
const createdJobIds: string[] = [];

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
let coderC: AuthenticatedUser;
let coderD: AuthenticatedUser;
let outsider: AuthenticatedUser;
let root: AuthenticatedUser;
let moduleId: string;
let sectionId: string;

const problem = {
  problemStatement: "Read n and print n doubled.",
  allowedLanguages: ["python" as const],
  starterCode: { python: "n = int(input())\n" },
};

async function individualAssessment(): Promise<AssessmentArchitectView> {
  const assessment = await createAssessment(owner, sectionId, {
    ...createDefaults(),
    title: `Doubling ${suffix}`,
    timeMode: "TIMED",
    durationMinutes: 30,
    executionMode: "INDIVIDUAL",
    isPublished: true,
  });
  await createTestCase(owner, assessment.id, {
    ...caseDefaults(),
    name: "Sample",
    kind: "PUBLIC",
    input: "PUBLIC_IN_2",
    expectedOutput: "PUBLIC_OUT_4",
  });
  await createTestCase(owner, assessment.id, {
    ...caseDefaults(),
    name: "Hidden",
    kind: "HIDDEN",
    input: "HIDDEN_SECRET_INPUT",
    expectedOutput: "HIDDEN_SECRET_OUTPUT",
    weight: 3,
  });
  await uploadTestScript(owner, assessment.id, {
    language: "python",
    framework: "PYTEST",
    path: "test_solution.py",
    content: "SCRIPT_SECRET = True\n",
    weight: 1,
    showTestNames: false,
  });
  return assessment;
}

function createDefaults() {
  return {
    ...problem,
    title: "",
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
      hideLeaderboard: false,
    },
    isPublished: false,
    isOpenAccess: false,
    exitPolicy: "RESUME" as const,
  };
}

function caseDefaults() {
  return {
    name: "",
    kind: "HIDDEN" as const,
    input: "",
    expectedOutput: "",
    weight: 1,
    comparison: "TRIMMED" as const,
    timeLimitMs: null,
    memoryLimitMb: null,
  };
}

async function startedSession(
  assessmentId: string,
  name: string,
  setup?: (session: SessionView) => Promise<void>,
): Promise<SessionView> {
  const session = await createSession(owner, assessmentId, { name });
  createdSessionIds.push(session.id);
  if (setup) await setup(session);
  const started = await startSession(owner, session.id, { force: true });
  if (!started.started) throw new Error("session did not start");
  return started.session;
}

beforeAll(async () => {
  [owner, otherArchitect, coderA, coderB, coderC, coderD, outsider, root] = await Promise.all([
    makeUser("ARCHITECT", "AssessOwner"),
    makeUser("ARCHITECT", "AssessOther"),
    makeUser("CODER", "AssessA"),
    makeUser("CODER", "AssessB"),
    makeUser("CODER", "AssessC"),
    makeUser("CODER", "AssessD"),
    makeUser("CODER", "AssessOutsider"),
    makeUser("ROOT", "AssessRoot"),
  ]);

  const module = await prisma.module.create({
    data: {
      title: `Assessment spec ${suffix}`,
      slug: `assessment-spec-${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
      ownerId: owner.id,
      enrollments: {
        create: [coderA, coderB, coderC, coderD].map((coder) => ({
          userId: coder.id,
          status: "APPROVED" as const,
        })),
      },
      sections: { create: { title: "Assessments", orderIndex: 0 } },
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
    ...createdJobIds.map((jobId) => getRunQueue().remove(jobId)),
    ...createdAttemptIds.map((attemptId) =>
      getDeadlineQueue().remove(deadlineJobId({ kind: "ATTEMPT", attemptId })),
    ),
    ...createdSessionIds.map((sessionId) =>
      getDeadlineQueue().remove(deadlineJobId({ kind: "SESSION", sessionId })),
    ),
  ]);

  // Submissions hold history and deliberately do not cascade; clear them first.
  await prisma.submission.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.module.deleteMany({ where: { id: moduleId } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await closeDeadlineQueue();
  await closeQueueConnection();
  await closeRedis();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------

describe("assessment authoring", () => {
  it("lets only the owning Architect create and read the definition", async () => {
    expect(
      await refusalCode(() =>
        createAssessment(otherArchitect, sectionId, { ...createDefaults(), title: "Nope" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusalCode(() =>
        createAssessment(root, sectionId, { ...createDefaults(), title: "Nope" }),
      ),
    ).toBe("FORBIDDEN");

    const assessment = await createAssessment(owner, sectionId, {
      ...createDefaults(),
      title: `Draft ${suffix}`,
    });
    const detail = await getAssessment(owner, assessment.id);
    expect(detail.view).toBe("ARCHITECT");
    // A draft is invisible to Coders rather than forbidden.
    expect(await refusalCode(() => getAssessment(coderA, assessment.id))).toBe("NOT_FOUND");
    expect(await refusalCode(() => listTestCases(coderA, assessment.id))).toBe("FORBIDDEN");
  });

  it("keeps hidden cases and scripts out of everything a Coder can read", async () => {
    const assessment = await individualAssessment();
    const coderView = await getAssessment(coderA, assessment.id);
    expect(coderView.view).toBe("CODER");

    const serialized = JSON.stringify(coderView);
    expect(serialized).toContain("PUBLIC_IN_2");
    expect(serialized).not.toContain("HIDDEN_SECRET_INPUT");
    expect(serialized).not.toContain("HIDDEN_SECRET_OUTPUT");
    expect(serialized).not.toContain("SCRIPT_SECRET");
    expect(serialized).not.toContain("WEIGHTED_AVERAGE");
  });

  it("keeps several scripts per language, replacing by path", async () => {
    const assessment = await individualAssessment();
    await uploadTestScript(owner, assessment.id, {
      language: "python",
      framework: "CUSTOM",
      path: "check.py",
      content: "first\n",
      weight: 2,
      showTestNames: false,
    });
    await uploadTestScript(owner, assessment.id, {
      language: "python",
      framework: "CUSTOM",
      path: "check.py",
      content: "replaced\n",
      weight: 3,
      showTestNames: false,
    });

    const detail = await getAssessment(owner, assessment.id);
    if (detail.view !== "ARCHITECT") throw new Error("expected the Architect view");
    expect(detail.assessment.testScripts.map((script) => [script.path, script.content])).toEqual([
      ["check.py", "replaced\n"],
      ["test_solution.py", "SCRIPT_SECRET = True\n"],
    ]);
  });

  it("refuses a script the assessment cannot run, or one too many", async () => {
    const assessment = await individualAssessment();
    expect(
      await refusalCode(() =>
        uploadTestScript(owner, assessment.id, {
          language: "java",
          framework: "JUNIT",
          path: "Test.java",
          content: "class Test {}\n",
          weight: 1,
          showTestNames: false,
        }),
      ),
    ).toBe("LANGUAGE_NOT_ALLOWED");

    // The fixture already holds one python script.
    for (let index = 1; index < MAX_TEST_SCRIPTS_PER_LANGUAGE; index += 1) {
      await uploadTestScript(owner, assessment.id, {
        language: "python",
        framework: "PYTEST",
        path: `test_${String(index)}.py`,
        content: "def test_ok():\n    pass\n",
        weight: 1,
        showTestNames: false,
      });
    }
    expect(
      await refusalCode(() =>
        uploadTestScript(owner, assessment.id, {
          language: "python",
          framework: "PYTEST",
          path: "test_one_too_many.py",
          content: "def test_ok():\n    pass\n",
          weight: 1,
          showTestNames: false,
        }),
      ),
    ).toBe("VALIDATION_FAILED");

    expect(
      await refusalCode(() =>
        updateAssessment(owner, assessment.id, { allowedLanguages: ["javascript"] }),
      ),
    ).toBe("VALIDATION_FAILED");
  });
});

// -----------------------------------------------------------------------------

describe("sessions", () => {
  it("copies timing from the assessment and refuses timing on an untimed one", async () => {
    const untimed = await createAssessment(owner, sectionId, {
      ...createDefaults(),
      title: `Untimed ${suffix}`,
    });
    expect(
      await refusalCode(() =>
        createSession(owner, untimed.id, { name: "Timed?", durationMinutes: 10 }),
      ),
    ).toBe("VALIDATION_FAILED");

    const timed = await individualAssessment();
    const session = await createSession(owner, timed.id, { name: "Remedial", durationMinutes: 45 });
    createdSessionIds.push(session.id);
    expect(session.executionMode).toBe("INDIVIDUAL");
    expect(session.durationMinutes).toBe(45);
    expect(session.status).toBe("DRAFT");
  });

  it("lists only enrolled Coders, and snapshots every one of them on request", async () => {
    const timed = await individualAssessment();
    const session = await createSession(owner, timed.id, { name: "Lists" });
    createdSessionIds.push(session.id);

    expect(
      await refusalCode(() =>
        replaceParticipants(owner, session.id, {
          mode: "SELECTED",
          userIds: [coderA.id, outsider.id],
        }),
      ),
    ).toBe("VALIDATION_FAILED");

    const all = await replaceParticipants(owner, session.id, { mode: "ALL_ENROLLED" });
    expect(all.counts.total).toBe(4);
    expect(all.counts.offline).toBe(4);

    const narrowed = await replaceParticipants(owner, session.id, {
      mode: "SELECTED",
      userIds: [coderA.id],
    });
    expect(narrowed.participants.map((participant) => participant.userId)).toEqual([coderA.id]);
  });

  it("answers with the counts instead of starting an unready live session, and starts when forced", async () => {
    const live = await createAssessment(owner, sectionId, {
      ...createDefaults(),
      title: `Live ${suffix}`,
      timeMode: "TIMED",
      durationMinutes: 30,
      executionMode: "LIVE",
      isPublished: true,
    });
    await createTestCase(owner, live.id, {
      ...caseDefaults(),
      name: "Only",
      input: "1",
      expectedOutput: "2",
    });

    const session = await createSession(owner, live.id, { name: "Class A" });
    createdSessionIds.push(session.id);
    await replaceParticipants(owner, session.id, {
      mode: "SELECTED",
      userIds: [coderA.id, coderB.id],
    });
    await prisma.assessmentParticipant.update({
      where: { sessionId_userId: { sessionId: session.id, userId: coderA.id } },
      data: { readyState: "READY", connectionState: "ONLINE" },
    });

    const warned = await startSession(owner, session.id, { force: false });
    expect(warned.started).toBe(false);
    if (warned.started) throw new Error("unreachable");
    expect(warned.warning.counts).toEqual({ ready: 1, notReady: 0, offline: 1, total: 2 });
    expect(
      (await prisma.assessmentSession.findUniqueOrThrow({ where: { id: session.id } })).status,
    ).toBe("DRAFT");

    const started = await startSession(owner, session.id, { force: true });
    expect(started.started).toBe(true);
    if (!started.started) throw new Error("unreachable");
    expect(started.session.status).toBe("RUNNING");
    expect(started.session.startedWithMissingParticipants).toBe(true);
    const endsAt = new Date(started.session.endsAt ?? 0).getTime();
    const startedAt = new Date(started.session.startedAt ?? 0).getTime();
    expect(endsAt - startedAt).toBe(30 * MINUTE);

    const event = await prisma.assessmentEvent.findFirstOrThrow({
      where: { sessionId: session.id, type: "SESSION_STARTED" },
    });
    expect(event.payloadJson).toMatchObject({ forced: true, ready: 1, total: 2 });

    expect(await refusalCode(() => startSession(owner, session.id, { force: true }))).toBe(
      "CONFLICT",
    );
    expect(
      await refusalCode(() => updateAssessment(owner, live.id, { title: "Changed mid-exam" })),
    ).toBe("CONFLICT");

    // A late joiner shares the one global deadline.
    const attempt = await startAttempt(coderA, session.id);
    createdAttemptIds.push(attempt.id);
    expect(attempt.deadlineMs).toBe(endsAt);
    expect(await refusalCode(() => startAttempt(coderC, session.id))).toBe("FORBIDDEN");

    // Ending closes the open attempt from its draft and records the no-show.
    await saveDraft(coderA, attempt.id, { language: "python", sourceCode: "print('from draft')" });
    await endSession(owner, session.id);

    const closedA = await prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
      select: {
        status: true,
        submissions: { select: { isAutoSubmitted: true, sourceCode: true } },
      },
    });
    expect(closedA.status).toBe("SUBMITTED");
    expect(closedA.submissions).toEqual([
      { isAutoSubmitted: true, sourceCode: "print('from draft')" },
    ]);

    const noShow = await prisma.assessmentAttempt.findFirstOrThrow({
      where: { sessionId: session.id, userId: coderB.id },
      select: { status: true, _count: { select: { submissions: true } } },
    });
    expect(noShow.status).toBe("EXPIRED");
    expect(noShow._count.submissions).toBe(0);

    const snapshot = await getMonitorSnapshot(owner, session.id);
    const types = snapshot.events.map((entry) => entry.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "SESSION_STARTED",
        "ATTEMPT_STARTED",
        "SESSION_ENDED",
        "ATTEMPT_AUTO_SUBMITTED",
        "ATTEMPT_EXPIRED",
      ]),
    );
    expect(await refusalCode(() => getMonitorSnapshot(coderA, session.id))).toBe("FORBIDDEN");
  });
});

// -----------------------------------------------------------------------------

describe("open access", () => {
  it("lets any enrolled Coder start without a session being scheduled", async () => {
    const assessment = await createAssessment(owner, sectionId, {
      ...createDefaults(),
      title: `Open ${suffix}`,
      isPublished: true,
      isOpenAccess: true,
    });
    await createTestCase(owner, assessment.id, {
      ...caseDefaults(),
      name: "Sample",
      kind: "PUBLIC",
      input: "2",
      expectedOutput: "4",
    });

    const view = await getAssessment(coderA, assessment.id);
    if (view.view !== "CODER") throw new Error("expected the Coder view");
    const open = view.assessment.sessions.find((entry) => entry.isOpenAccess);
    expect(open?.canStart).toBe(true);
    if (!open) throw new Error("no open-access session");
    createdSessionIds.push(open.id);

    // Nobody listed anybody, and both Coders get in.
    const first = await startAttempt(coderA, open.id);
    const second = await startAttempt(coderB, open.id);
    createdAttemptIds.push(first.id, second.id);
    expect(first.status).toBe("IN_PROGRESS");
    expect(second.status).toBe("IN_PROGRESS");

    // Enrollment is still the gate; open access is not public access.
    expect(await refusalCode(() => startAttempt(outsider, open.id))).toBe("FORBIDDEN");

    // One implicit session, however many Coders arrive.
    expect(
      await prisma.assessmentSession.count({
        where: { assessmentId: assessment.id, isOpenAccess: true },
      }),
    ).toBe(1);

    // It is not in the Architect's session list: there is nothing to schedule.
    expect(await listSessions(owner, assessment.id)).toHaveLength(0);
  });

  it("refuses open access on a live assessment", async () => {
    const live = await createAssessment(owner, sectionId, {
      ...createDefaults(),
      title: `Open live ${suffix}`,
      timeMode: "TIMED",
      durationMinutes: 30,
      executionMode: "INDIVIDUAL",
    });
    expect(
      await refusalCode(() => updateAssessment(owner, live.id, { executionMode: "LIVE", isOpenAccess: true })),
    ).toBe("VALIDATION_FAILED");
  });

  it("closes the open session when open access is switched off", async () => {
    const assessment = await createAssessment(owner, sectionId, {
      ...createDefaults(),
      title: `Open then closed ${suffix}`,
      isPublished: true,
      isOpenAccess: true,
    });
    const before = await prisma.assessmentSession.findFirstOrThrow({
      where: { assessmentId: assessment.id, isOpenAccess: true },
      select: { id: true },
    });
    createdSessionIds.push(before.id);

    await updateAssessment(owner, assessment.id, { isOpenAccess: false });
    expect(
      (await prisma.assessmentSession.findUniqueOrThrow({ where: { id: before.id } })).status,
    ).toBe("ENDED");
  });

  it("opens a scheduled session to the whole module even once participants are listed", async () => {
    const assessment = await individualAssessment();
    const session = await createSession(owner, assessment.id, {
      name: "Whole class",
      access: "MODULE",
    });
    createdSessionIds.push(session.id);
    expect(session.access).toBe("MODULE");

    // A list would normally make the session that list and nobody else.
    await replaceParticipants(owner, session.id, { mode: "SELECTED", userIds: [coderA.id] });
    const listed = await getSession(owner, session.id);
    expect(listed.listedParticipantCount).toBe(1);
    expect(listed.isRestricted).toBe(false);

    const started = await startSession(owner, session.id, { force: true });
    if (!started.started) throw new Error("session did not start");

    const unlisted = await startAttempt(coderC, session.id);
    createdAttemptIds.push(unlisted.id);
    expect(unlisted.status).toBe("IN_PROGRESS");
    expect(await refusalCode(() => startAttempt(outsider, session.id))).toBe("FORBIDDEN");
  });
});

// -----------------------------------------------------------------------------

describe("deleting a session", () => {
  it("deletes a session that has not started, for its owner only", async () => {
    const assessment = await individualAssessment();
    const session = await createSession(owner, assessment.id, { name: "Never started" });
    createdSessionIds.push(session.id);

    expect(await refusalCode(() => deleteSession(otherArchitect, session.id))).toBe("FORBIDDEN");
    expect(await refusalCode(() => deleteSession(coderA, session.id))).toBe("FORBIDDEN");
    expect(await prisma.assessmentSession.count({ where: { id: session.id } })).toBe(1);

    await deleteSession(owner, session.id);
    expect(await prisma.assessmentSession.count({ where: { id: session.id } })).toBe(0);
  });

  it("refuses a running session, and deletes it with its history once ended and graded", async () => {
    const assessment = await individualAssessment();
    const session = await startedSession(assessment.id, "Delete after end");

    expect(await refusalCode(() => deleteSession(owner, session.id))).toBe("CONFLICT");

    const attempt = await startAttempt(coderA, session.id);
    createdAttemptIds.push(attempt.id);
    await saveDraft(coderA, attempt.id, { language: "python", sourceCode: "print('kept?')" });
    await endSession(owner, session.id);

    // Ending queued the grading; the worker has not answered yet.
    const submissions = await prisma.submission.findMany({
      where: { sessionId: session.id },
      select: { id: true },
    });
    expect(submissions).toHaveLength(1);
    expect(await refusalCode(() => deleteSession(owner, session.id))).toBe("CONFLICT");
    expect(await prisma.assessmentSession.count({ where: { id: session.id } })).toBe(1);

    await prisma.submission.updateMany({
      where: { sessionId: session.id },
      data: { status: "GRADED", score: 0 },
    });
    await deleteSession(owner, session.id);

    expect(await prisma.assessmentSession.count({ where: { id: session.id } })).toBe(0);
    expect(await prisma.assessmentAttempt.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.submission.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.assessmentEvent.count({ where: { sessionId: session.id } })).toBe(0);

    // The afterAll sweep finds jobs through their Submission, which is gone now.
    await Promise.all(submissions.map((submission) => getSubmitQueue().remove(submission.id)));
  });
});

// -----------------------------------------------------------------------------

describe("attempts and submissions", () => {
  let assessment: AssessmentArchitectView;
  let session: SessionView;

  beforeAll(async () => {
    assessment = await individualAssessment();
    session = await startedSession(assessment.id, "Open individual");
  });

  it("admits any enrolled Coder to an open session, and nobody else", async () => {
    expect(await refusalCode(() => startAttempt(outsider, session.id))).toBe("FORBIDDEN");
    expect(await refusalCode(() => startAttempt(owner, session.id))).toBe("FORBIDDEN");

    const first = await startAttempt(coderA, session.id);
    createdAttemptIds.push(first.id);
    expect(first.status).toBe("IN_PROGRESS");
    expect(first.remainingMs).toBeGreaterThan(29 * MINUTE);
    expect(JSON.stringify(first)).not.toContain("HIDDEN_SECRET");

    const again = await startAttempt(coderA, session.id);
    expect(again.id).toBe(first.id);

    const job = await getDeadlineQueue().getJob(
      deadlineJobId({ kind: "ATTEMPT", attemptId: first.id }),
    );
    expect(job).toBeDefined();
  });

  it("shows the Architect the code a Coder ran, and keeps Root out of it", async () => {
    // Its own session: this test submits, and `startAttempt` is idempotent, so
    // closing a Coder's attempt in the shared session would change what the
    // tests after it are handed.
    const own = await startedSession(assessment.id, "Source visibility");
    const attempt = await startAttempt(coderB, own.id);
    createdAttemptIds.push(attempt.id);

    // Nothing to show before the Coder has done anything deliberate. A draft
    // is autosaved and is expressly not surfaced here.
    await saveDraft(coderB, attempt.id, { language: "python", sourceCode: "# half a thought" });
    const empty = await getAttemptSource(owner, attempt.id);
    expect(empty.snapshots).toHaveLength(0);
    expect(empty.coder.id).toBe(coderB.id);

    const { jobId } = await runAttempt(coderB, attempt.id, {
      language: "python",
      sourceCode: "print(int(input()) * 2)",
    });
    createdJobIds.push(jobId);

    const afterRun = await getAttemptSource(owner, attempt.id);
    expect(afterRun.snapshots).toHaveLength(1);
    expect(afterRun.snapshots[0]?.origin).toBe("RUN");
    expect(afterRun.snapshots[0]?.sourceCode).toBe("print(int(input()) * 2)");
    expect(afterRun.runCount).toBe(1);

    await submitAttempt(coderB, attempt.id, {
      language: "python",
      sourceCode: "print(int(input()) * 2)  # final",
    });
    const afterSubmit = await getAttemptSource(owner, attempt.id);
    expect(afterSubmit.snapshots.map((snapshot) => snapshot.origin)).toEqual(["SUBMISSION", "RUN"]);
    expect(afterSubmit.snapshots[0]?.sourceCode).toContain("# final");

    // Participant source by another route is still participant source.
    expect(await refusalCode(() => getAttemptSource(root, attempt.id))).toBe("FORBIDDEN");
    expect(await refusalCode(() => getAttemptSource(otherArchitect, attempt.id))).toBe("FORBIDDEN");
    expect(await refusalCode(() => getAttemptSource(coderA, attempt.id))).toBe("FORBIDDEN");
  });

  it("runs against public cases only", async () => {
    const attempt = await startAttempt(coderA, session.id);
    const { jobId } = await runAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "print(4)",
    });
    createdJobIds.push(jobId);

    const job = await getRunQueue().getJob(jobId);
    expect(job?.data.testCases.every((testCase) => testCase.isPublic)).toBe(true);
    expect(JSON.stringify(job?.data)).not.toContain("HIDDEN_SECRET");
    expect(job?.data.testScripts).toEqual([]);

    const count = await prisma.submission.count({ where: { attemptId: attempt.id } });
    expect(count).toBe(0);
  });

  it("still runs when the assessment has no public case", async () => {
    const attempt = await startAttempt(coderA, session.id);
    await prisma.assessmentTestCase.updateMany({
      where: { assessmentId: assessment.id, kind: "PUBLIC" },
      data: { kind: "HIDDEN" },
    });
    try {
      const { jobId } = await runAttempt(coderA, attempt.id, {
        language: "python",
        sourceCode: "print(4)",
      });
      createdJobIds.push(jobId);

      const job = await getRunQueue().getJob(jobId);
      expect(job?.data.testCases).toEqual([]);
      expect(JSON.stringify(job?.data)).not.toContain("HIDDEN_SECRET");
    } finally {
      await prisma.assessmentTestCase.updateMany({
        where: { assessmentId: assessment.id, name: "Sample" },
        data: { kind: "PUBLIC" },
      });
    }
  });

  it("grades the source in the request, never the stored draft", async () => {
    const attempt = await startAttempt(coderA, session.id);
    await saveDraft(coderA, attempt.id, { language: "python", sourceCode: "print('draft')" });

    const { submission } = await submitAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "print('submitted')",
    });
    expect(submission.status).toBe("QUEUED");
    expect(submission.isAutoSubmitted).toBe(false);

    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
      select: { sourceCode: true, jobId: true },
    });
    expect(stored.sourceCode).toBe("print('submitted')");
    expect(stored.jobId).toBe(submission.id);

    const job = await getSubmitQueue().getJob(submission.id);
    expect(job?.name).toBe(QUEUE_NAMES.SUBMIT);
    expect(job?.data.sourceCode).toBe("print('submitted')");
    expect(job?.data.testCases.map((testCase) => testCase.isPublic).sort()).toEqual([false, true]);
    expect(job?.data.testScripts.map((script) => [script.framework, script.path])).toEqual([
      ["PYTEST", "test_solution.py"],
    ]);

    expect(
      await refusalCode(() =>
        saveDraft(coderA, attempt.id, { language: "python", sourceCode: "too late" }),
      ),
    ).toBe("ATTEMPT_ALREADY_SUBMITTED");
    expect(
      await refusalCode(() =>
        submitAttempt(coderA, attempt.id, { language: "python", sourceCode: "again" }),
      ),
    ).toBe("ATTEMPT_ALREADY_SUBMITTED");
  });

  it("lets exactly one of two concurrent submits win", async () => {
    const attempt = await startAttempt(coderB, session.id);
    createdAttemptIds.push(attempt.id);

    const results = await Promise.allSettled([
      submitAttempt(coderB, attempt.id, { language: "python", sourceCode: "print(1)" }),
      submitAttempt(coderB, attempt.id, { language: "python", sourceCode: "print(2)" }),
    ]);
    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result) => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason = lost[0]?.status === "rejected" ? lost[0].reason : null;
    expect(isAppError(reason) && reason.code).toBe("ATTEMPT_ALREADY_SUBMITTED");
    expect(await prisma.submission.count({ where: { attemptId: attempt.id } })).toBe(1);
  });

  it("auto-submits the stored draft at the deadline, and not a moment before", async () => {
    const attempt = await startAttempt(coderC, session.id);
    createdAttemptIds.push(attempt.id);
    await saveDraft(coderC, attempt.id, { language: "python", sourceCode: "print('last save')" });

    const early = await autoSubmitAttempt(attempt.id, { reason: "DEADLINE" });
    expect(early.outcome).toBe("NOT_DUE");

    const due = await autoSubmitAttempt(
      attempt.id,
      { reason: "DEADLINE" },
      Date.now() + 31 * MINUTE,
    );
    expect(due.outcome).toBe("SUBMITTED");
    const submission = await prisma.submission.findUniqueOrThrow({
      where: { id: due.submissionId ?? "" },
      select: { sourceCode: true, isAutoSubmitted: true },
    });
    expect(submission).toEqual({ sourceCode: "print('last save')", isAutoSubmitted: true });

    const repeat = await autoSubmitAttempt(
      attempt.id,
      { reason: "DEADLINE" },
      Date.now() + 31 * MINUTE,
    );
    expect(repeat.outcome).toBe("NOT_ACTIVE");
  });

  it("expires an attempt with no draft instead of inventing a submission", async () => {
    const attempt = await startAttempt(coderD, session.id);
    createdAttemptIds.push(attempt.id);

    const result = await autoSubmitAttempt(
      attempt.id,
      { reason: "DEADLINE" },
      Date.now() + 31 * MINUTE,
    );
    expect(result).toEqual({ outcome: "EXPIRED", submissionId: null });
    expect(await prisma.submission.count({ where: { attemptId: attempt.id } })).toBe(0);
    expect(
      (await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
    ).toBe("EXPIRED");
  });

  it("refuses the internal auto-submit endpoint without a token scoped to that attempt", async () => {
    const attempt = await prisma.assessmentAttempt.findFirstOrThrow({
      where: { sessionId: session.id, userId: coderA.id },
      select: { id: true },
    });
    const call = (token: string) =>
      autoSubmitRoute(
        new Request(`http://localhost/api/internal/attempts/${attempt.id}/auto-submit`, {
          method: "POST",
          headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: token },
          body: JSON.stringify({ reason: "DEADLINE" }),
        }),
        { params: Promise.resolve({ attemptId: attempt.id }) },
      );

    const secret = getServerEnv().INTERNAL_API_SECRET;
    expect((await call("")).status).toBe(403);
    expect(
      (await call(issueInternalToken(secret, autoSubmitScope("some-other-attempt")))).status,
    ).toBe(403);

    const accepted = await call(issueInternalToken(secret, autoSubmitScope(attempt.id)));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, data: { outcome: "NOT_ACTIVE" } });
  });
});

// -----------------------------------------------------------------------------

describe("grading ingestion", () => {
  it("scores by the assessment's strategy and shows a Coder only public rows", async () => {
    const assessment = await individualAssessment();
    const session = await startedSession(assessment.id, "Grading");
    const attempt = await startAttempt(coderA, session.id);
    createdAttemptIds.push(attempt.id);
    const { submission } = await submitAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "print(int(input()) * 2)",
    });

    const detail = await getAssessment(owner, assessment.id);
    if (detail.view !== "ARCHITECT") throw new Error("expected the Architect view");
    const publicCase = detail.assessment.testCases.find((testCase) => testCase.kind === "PUBLIC");
    const hiddenCase = detail.assessment.testCases.find((testCase) => testCase.kind === "HIDDEN");
    if (!publicCase || !hiddenCase) throw new Error("fixture cases missing");

    const result: ExecutionResult = {
      contractVersion: EXECUTION_CONTRACT_VERSION,
      jobId: submission.id,
      submissionId: submission.id,
      // One case hit its time limit and the rest still ran: the most severe
      // case status is the submission's, and the passed cases still score.
      status: "TIME_LIMIT_EXCEEDED" as const,
      compilerOutput: null,
      systemError: "worker internals",
      executionTimeMs: 42,
      memoryUsedKb: null,
      testResults: [
        {
          testCaseId: publicCase.id,
          testScriptId: null,
          name: "Sample",
          status: "GRADED" as const,
          passed: true,
          weight: 1,
          executionTimeMs: 10,
          memoryUsedKb: null,
          stdoutExcerpt: "4",
          stderrExcerpt: "",
        },
        {
          testCaseId: hiddenCase.id,
          testScriptId: null,
          name: "Hidden",
          status: "TIME_LIMIT_EXCEEDED" as const,
          passed: false,
          weight: 3,
          executionTimeMs: 10,
          memoryUsedKb: null,
          stdoutExcerpt: "HIDDEN_SECRET_OUTPUT_ECHO",
          stderrExcerpt: "",
        },
        {
          testCaseId: null,
          testScriptId: null,
          name: "pytest",
          status: "GRADED" as const,
          passed: true,
          weight: 1,
          executionTimeMs: 22,
          memoryUsedKb: null,
          stdoutExcerpt: "SCRIPT_SECRET",
          stderrExcerpt: "",
        },
      ],
    };

    expect(await ingestExecutionResult(result)).toEqual({ persisted: true, delivered: true });
    // (1 + 1) of (1 + 3 + 1) weight passed.
    const graded = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(graded.score).toBe(40);
    expect(graded.status).toBe("TIME_LIMIT_EXCEEDED");

    const coderView = await getSubmission(coderA, submission.id);
    expect(coderView.testResults).toHaveLength(1);
    expect(coderView.testResults[0]?.status).toBe("GRADED");
    expect(JSON.stringify(coderView)).not.toContain("HIDDEN_SECRET");
    expect(JSON.stringify(coderView)).not.toContain("SCRIPT_SECRET");
    expect(JSON.stringify(coderView)).not.toContain("worker internals");

    const architectView = await getSubmission(owner, submission.id);
    expect(architectView.testResults).toHaveLength(3);
    expect(architectView.testResults.map((row) => row.status)).toEqual([
      "GRADED",
      "TIME_LIMIT_EXCEEDED",
      "GRADED",
    ]);

    expect(await refusalCode(() => getSubmission(root, submission.id))).toBe("FORBIDDEN");
    expect(await refusalCode(() => getSubmission(coderB, submission.id))).toBe("NOT_FOUND");
    expect(await refusalCode(() => getSubmission(otherArchitect, submission.id))).toBe("NOT_FOUND");

    // A retried callback is a no-op that changes nothing.
    expect(await ingestExecutionResult({ ...result, status: "RUNTIME_ERROR" })).toEqual({
      persisted: false,
      delivered: true,
    });
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).score,
    ).toBe(40);
  });
});

describe("test script validation", () => {
  async function architectScripts(assessmentId: string) {
    const detail = await getAssessment(owner, assessmentId);
    if (detail.view !== "ARCHITECT") throw new Error("expected the Architect view");
    return detail.assessment;
  }

  it("runs a language's scripts against its reference solution, and records the verdict", async () => {
    const assessment = await individualAssessment();

    expect(
      await refusalCode(() => validateTestScripts(owner, assessment.id, { language: "python" })),
    ).toBe("VALIDATION_FAILED");

    await saveReferenceSolution(owner, assessment.id, {
      language: "python",
      sourceCode: "REFERENCE_SECRET = 1\n",
    });
    expect((await architectScripts(assessment.id)).referenceSolutions.python).toBe(
      "REFERENCE_SECRET = 1\n",
    );
    // The reference solution is Architect-only, like the scripts it checks.
    expect(JSON.stringify(await getAssessment(coderA, assessment.id))).not.toContain(
      "REFERENCE_SECRET",
    );

    const { jobId } = await validateTestScripts(owner, assessment.id, { language: "python" });
    createdJobIds.push(jobId);

    const job = await getRunQueue().getJob(jobId);
    expect(job?.data.kind).toBe("RUN");
    expect(job?.data.sourceCode).toBe("REFERENCE_SECRET = 1\n");
    expect(job?.data.testCases).toEqual([]);
    const [script] = (await architectScripts(assessment.id)).testScripts;
    if (!script) throw new Error("expected the fixture script");
    expect(job?.data.testScripts.map((entry) => entry.id)).toEqual([script.id]);
    expect(script.validation.status).toBe("VALIDATING");

    const outcome = await ingestExecutionResult({
      contractVersion: EXECUTION_CONTRACT_VERSION,
      jobId,
      submissionId: null,
      status: "GRADED",
      compilerOutput: null,
      systemError: null,
      executionTimeMs: 30,
      memoryUsedKb: null,
      testResults: [
        {
          testCaseId: null,
          testScriptId: script.id,
          name: "test_doubles",
          status: "GRADED",
          passed: true,
          weight: 1,
          executionTimeMs: 30,
          memoryUsedKb: null,
          stdoutExcerpt: "",
          stderrExcerpt: "",
        },
      ],
    });
    expect(outcome.persisted).toBe(true);

    const [validated] = (await architectScripts(assessment.id)).testScripts;
    expect(validated?.validation).toMatchObject({ status: "PASSED", summary: "Its test passed" });

    // A new reference solution says nothing about the old verdict.
    await saveReferenceSolution(owner, assessment.id, {
      language: "python",
      sourceCode: "REFERENCE_SECRET = 2\n",
    });
    const [reset] = (await architectScripts(assessment.id)).testScripts;
    expect(reset?.validation.status).toBe("UNVALIDATED");
  });

  it("never lets a late result mark a script edited since it was requested", async () => {
    const assessment = await individualAssessment();
    await saveReferenceSolution(owner, assessment.id, {
      language: "python",
      sourceCode: "print(1)\n",
    });
    const { jobId } = await validateTestScripts(owner, assessment.id, { language: "python" });
    createdJobIds.push(jobId);

    const [script] = (await architectScripts(assessment.id)).testScripts;
    if (!script) throw new Error("expected the fixture script");
    await uploadTestScript(owner, assessment.id, {
      language: "python",
      framework: "PYTEST",
      path: script.path,
      content: "def test_changed():\n    pass\n",
      weight: 1,
      showTestNames: false,
    });

    await ingestExecutionResult({
      contractVersion: EXECUTION_CONTRACT_VERSION,
      jobId,
      submissionId: null,
      status: "GRADED",
      compilerOutput: null,
      systemError: null,
      executionTimeMs: 30,
      memoryUsedKb: null,
      testResults: [
        {
          testCaseId: null,
          testScriptId: script.id,
          name: "test_old",
          status: "GRADED",
          passed: true,
          weight: 1,
          executionTimeMs: 30,
          memoryUsedKb: null,
          stdoutExcerpt: "",
          stderrExcerpt: "",
        },
      ],
    });

    const [edited] = (await architectScripts(assessment.id)).testScripts;
    expect(edited?.validation.status).toBe("UNVALIDATED");
  });

  it("keeps reference solutions and validation to the owning Architect", async () => {
    const assessment = await individualAssessment();
    expect(
      await refusalCode(() =>
        saveReferenceSolution(otherArchitect, assessment.id, {
          language: "python",
          sourceCode: "x = 1\n",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusalCode(() => validateTestScripts(coderA, assessment.id, { language: "python" })),
    ).toBe("FORBIDDEN");
    expect(
      await refusalCode(() =>
        saveReferenceSolution(owner, assessment.id, { language: "java", sourceCode: "class A {}" }),
      ),
    ).toBe("LANGUAGE_NOT_ALLOWED");
  });
});

describe("test names shown to Coders", () => {
  it("shows a Coder an opted-in script's test names and verdicts, and nothing else of it", async () => {
    const assessment = await individualAssessment();
    const shown = await uploadTestScript(owner, assessment.id, {
      language: "python",
      framework: "PYTEST",
      path: "test_visible.py",
      content: "VISIBLE_SCRIPT_SECRET = True\n",
      weight: 1,
      showTestNames: true,
    });
    const hidden = (await architectView(assessment.id)).testScripts.find(
      (script) => script.path === "test_solution.py",
    );
    if (!hidden) throw new Error("fixture script missing");
    // An id from some other Assessment's script must not decide anything here.
    const elsewhere = await individualAssessment();
    const foreign = await uploadTestScript(owner, elsewhere.id, {
      language: "python",
      framework: "PYTEST",
      path: "test_foreign.py",
      content: "x = 1\n",
      weight: 1,
      showTestNames: true,
    });

    const session = await startedSession(assessment.id, "Visible names");
    const attempt = await startAttempt(coderA, session.id);
    createdAttemptIds.push(attempt.id);
    const { submission } = await submitAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "print(1)",
    });

    const row = (testScriptId: string, name: string, passed: boolean) => ({
      testCaseId: null,
      testScriptId,
      name,
      status: "GRADED" as const,
      passed,
      weight: 1,
      executionTimeMs: 5,
      memoryUsedKb: null,
      stdoutExcerpt: "ASSERTION_OUTPUT",
      stderrExcerpt: "ASSERTION_OUTPUT",
    });
    await ingestExecutionResult({
      contractVersion: EXECUTION_CONTRACT_VERSION,
      jobId: submission.id,
      submissionId: submission.id,
      status: "GRADED",
      compilerOutput: null,
      systemError: null,
      executionTimeMs: 20,
      memoryUsedKb: null,
      testResults: [
        row(shown.id, "test_visible_passes", true),
        row(shown.id, "test_visible_fails", false),
        row(hidden.id, "test_hidden_name", true),
        row(foreign.id, "test_foreign_name", true),
      ],
    });

    const coderView = await getSubmission(coderA, submission.id);
    expect(coderView.testResults.map((result) => [result.name, result.passed])).toEqual([
      ["test_visible_passes", true],
      ["test_visible_fails", false],
    ]);
    const serialized = JSON.stringify(coderView);
    expect(serialized).not.toContain("ASSERTION_OUTPUT");
    expect(serialized).not.toContain("test_hidden_name");
    expect(serialized).not.toContain("test_foreign_name");
    expect(serialized).not.toContain("VISIBLE_SCRIPT_SECRET");

    // The Architect sees every row, attributed to the script it came from.
    const architect = await getSubmission(owner, submission.id);
    expect(
      architect.testResults.map((result) =>
        "testScriptId" in result ? result.testScriptId : "not the Architect view",
      ),
    ).toEqual([shown.id, shown.id, hidden.id, null]);
    expect(JSON.stringify(architect)).not.toContain("ASSERTION_OUTPUT");
  });

  it("keeps a script's validation when only its weight or visibility changes", async () => {
    const assessment = await individualAssessment();
    const script = (await architectView(assessment.id)).testScripts[0];
    if (!script) throw new Error("fixture script missing");
    await prisma.assessmentTestScript.update({
      where: { id: script.id },
      data: { validationStatus: "PASSED", validationSummary: "Its test passed" },
    });

    await uploadTestScript(owner, assessment.id, {
      language: script.language,
      framework: script.framework,
      path: script.path,
      content: script.content,
      weight: 5,
      showTestNames: true,
    });
    const settingsOnly = (await architectView(assessment.id)).testScripts[0];
    expect(settingsOnly?.validation.status).toBe("PASSED");
    expect(settingsOnly?.showTestNames).toBe(true);

    await uploadTestScript(owner, assessment.id, {
      language: script.language,
      framework: script.framework,
      path: script.path,
      content: `${script.content}# edited\n`,
      weight: 5,
      showTestNames: true,
    });
    expect((await architectView(assessment.id)).testScripts[0]?.validation.status).toBe(
      "UNVALIDATED",
    );
  });
});

async function architectView(assessmentId: string): Promise<AssessmentArchitectView> {
  const detail = await getAssessment(owner, assessmentId);
  if (detail.view !== "ARCHITECT") throw new Error("expected the Architect view");
  return detail.assessment;
}

describe("results that arrive after their callback token expired", () => {
  async function postLate(jobId: string) {
    const token = issueCallbackToken(jobId, Date.now() - 60 * MINUTE);
    const request = new Request("http://localhost/api/internal/execution/result", {
      method: "POST",
      headers: { "content-type": "application/json", "x-execution-callback-token": token },
      body: JSON.stringify({
        contractVersion: EXECUTION_CONTRACT_VERSION,
        jobId,
        submissionId: jobId,
        status: "GRADED",
        compilerOutput: null,
        systemError: null,
        executionTimeMs: 1,
        memoryUsedKb: null,
        testResults: [],
      }),
    });
    return executionResultRoute(request, { params: Promise.resolve({}) });
  }

  it("refuses the result but closes out the submission it was for", async () => {
    const assessment = await individualAssessment();
    const session = await startedSession(assessment.id, "Late result");
    const attempt = await startAttempt(coderA, session.id);
    createdAttemptIds.push(attempt.id);
    const { submission } = await submitAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "print(1)",
    });

    const response = await postLate(submission.id);
    expect(response.status).toBe(403);

    const stored = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(stored).toMatchObject({ status: "SYSTEM_ERROR", score: 0 });
    // What the late result claimed never counted.
    expect(
      await prisma.submissionTestResult.count({ where: { submissionId: submission.id } }),
    ).toBe(0);
    expect(JSON.stringify(await getSubmission(coderA, submission.id))).not.toContain("queue");

    // A second late callback changes nothing further.
    expect((await postLate(submission.id)).status).toBe(403);
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    ).toBe("SYSTEM_ERROR");
  });

  it("marks a validation that waited too long as failed, with the reason", async () => {
    const assessment = await individualAssessment();
    await saveReferenceSolution(owner, assessment.id, {
      language: "python",
      sourceCode: "print(1)\n",
    });
    const { jobId } = await validateTestScripts(owner, assessment.id, { language: "python" });
    createdJobIds.push(jobId);

    expect((await postLate(jobId)).status).toBe(403);

    const [script] = (await architectView(assessment.id)).testScripts;
    expect(script?.validation).toMatchObject({
      status: "FAILED",
      summary: EXPIRED_RESULT_MESSAGE,
    });
  });

  it("does nothing for a token that is forged rather than late", async () => {
    const assessment = await individualAssessment();
    const session = await startedSession(assessment.id, "Forged result");
    const attempt = await startAttempt(coderA, session.id);
    createdAttemptIds.push(attempt.id);
    const { submission } = await submitAttempt(coderA, attempt.id, {
      language: "python",
      sourceCode: "print(1)",
    });

    const forged = issueCallbackToken("some-other-job", Date.now() - 60 * MINUTE);
    const response = await executionResultRoute(
      new Request("http://localhost/api/internal/execution/result", {
        method: "POST",
        headers: { "content-type": "application/json", "x-execution-callback-token": forged },
        body: JSON.stringify({
          contractVersion: EXECUTION_CONTRACT_VERSION,
          jobId: submission.id,
          submissionId: submission.id,
          status: "GRADED",
          compilerOutput: null,
          systemError: null,
          executionTimeMs: 1,
          memoryUsedKb: null,
          testResults: [],
        }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(403);
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    ).toBe("QUEUED");
  });
});
