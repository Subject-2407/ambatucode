import "server-only";
import { prisma, type Prisma } from "@ambatucode/db";
import {
  AppError,
  attemptRemainingMs,
  countReadiness,
  everyoneReady,
  sessionRuleProblem,
  type AuthenticatedUser,
  type CreateSessionRequest,
  type ExecutionMode,
  type ExpireSessionOutcome,
  type ModuleSessionOption,
  type MonitorableSession,
  type MonitorEventPayload,
  type MonitorParticipantRow,
  type MonitorSnapshot,
  type ReadinessView,
  type ReplaceParticipantsRequest,
  type SessionView,
  type StartSessionRequest,
  type StartSessionResponse,
  type UpdateSessionRequest,
} from "@ambatucode/shared";
import { cancelDeadline, scheduleDeadline } from "../queue/deadlines";
import { publishAssessmentBroadcast } from "../realtime/publish";
import {
  clockFor,
  toMonitorEventPayload,
  toParticipantView,
  toSessionView,
} from "../serializers/assessment";
import { announceEvents, recordEvent } from "./assessment-events";
import { scopeForAssessment, scopeForSession } from "./assessment-scope";
import { autoSubmitAttempt } from "./attempts";
import { assertCanWrite } from "./modules";

/**
 * Assessment Sessions, from draft to ended.
 *
 * Everything here is Architect-side. A Coder reaches a session through the
 * Assessment's Coder view and the attempt endpoints, never through these.
 */

const SESSION_SELECT = {
  id: true,
  assessmentId: true,
  name: true,
  executionMode: true,
  durationMinutes: true,
  status: true,
  access: true,
  isOpenAccess: true,
  startedAt: true,
  endsAt: true,
  closesAt: true,
  requireAllReady: true,
  startedWithMissingParticipants: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssessmentSessionSelect;

const PARTICIPANT_SELECT = {
  userId: true,
  isListed: true,
  readyState: true,
  connectionState: true,
  lastSeenAt: true,
  user: { select: { username: true, displayName: true } },
} satisfies Prisma.AssessmentParticipantSelect;

/** Monitor feeds start from this many recent events; the socket carries the rest. */
const MONITOR_EVENT_BACKLOG = 200;

/** Participant lists and timing are fixed once a session starts. */
const EDITABLE_STATUSES = ["DRAFT", "READY"] as const;

function isEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

async function ownedSession(actor: AuthenticatedUser, sessionId: string) {
  const scope = await scopeForSession(sessionId);
  await assertCanWrite(actor, scope.moduleId);
  const row = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  return { scope, row };
}

async function sessionView(
  row: Prisma.AssessmentSessionGetPayload<{ select: typeof SESSION_SELECT }>,
  moduleId: string,
): Promise<SessionView> {
  const listedParticipantCount = await prisma.assessmentParticipant.count({
    where: { sessionId: row.id, isListed: true },
  });
  return toSessionView(row, { moduleId, listedParticipantCount });
}

async function readinessFor(sessionId: string): Promise<ReadinessView> {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      status: true,
      participants: { select: PARTICIPANT_SELECT, orderBy: { user: { displayName: "asc" } } },
    },
  });
  return {
    sessionId,
    status: session.status,
    counts: countReadiness(session.participants),
    participants: session.participants.map(toParticipantView),
  };
}

/** Pushes the lifecycle state and counts to the lobby and the monitor. */
async function broadcastSessionState(sessionId: string): Promise<void> {
  const [readiness, session] = await Promise.all([
    readinessFor(sessionId),
    prisma.assessmentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { endsAt: true },
    }),
  ]);
  await publishAssessmentBroadcast({
    type: "SESSION_STATE",
    payload: {
      sessionId,
      status: readiness.status,
      endsAt: session.endsAt?.getTime() ?? null,
      counts: readiness.counts,
    },
  });
}

/**
 * The name the implicit open-access session carries.
 *
 * It exists because every attempt, submission, grading record and monitor row
 * in this product hangs off a session. Rather than make all of those nullable
 * so that one Assessment can be sat without a schedule, an open-access
 * Assessment gets exactly one long-lived session and the rest of the system
 * never learns the difference.
 */
export const OPEN_ACCESS_SESSION_NAME = "Open access";

/**
 * The running open-access session for an Assessment, created on first need.
 *
 * Idempotent, and safe to call from a Coder's request: two Coders arriving at
 * once is the ordinary case, and the unique-violation retry is what keeps that
 * from producing two sessions. It never starts a clock of its own — an
 * Individual attempt's deadline is computed when that Coder starts, and an
 * untimed one has none.
 */
export async function ensureOpenAccessSession(assessmentId: string): Promise<string> {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: { isOpenAccess: true, executionMode: true, durationMinutes: true },
  });
  if (!assessment.isOpenAccess) {
    throw new AppError("NOT_FOUND", "Session not found");
  }
  // Refused rather than quietly downgraded: a Live assessment's timer is
  // started by a person, so there is nothing for a Coder to walk into.
  if (assessment.executionMode === "LIVE") {
    throw new AppError("CONFLICT", "A live assessment cannot be open access");
  }

  const existing = await prisma.assessmentSession.findFirst({
    where: { assessmentId, isOpenAccess: true, status: "RUNNING" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.assessmentSession.create({
    data: {
      assessmentId,
      name: OPEN_ACCESS_SESSION_NAME,
      executionMode: assessment.executionMode,
      durationMinutes: assessment.durationMinutes,
      // Running from the moment it exists. There is no lobby to wait in and
      // nobody to press Start.
      status: "RUNNING",
      startedAt: new Date(),
      access: "MODULE",
      isOpenAccess: true,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Closes the open-access session when an Assessment stops being open.
 *
 * It goes through the same path an Architect's End does, so attempts still in
 * progress are auto-submitted and graded rather than stranded mid-answer.
 * Re-opening the Assessment later creates a fresh session; the closed one keeps
 * its attempts and their records, which is what makes the history readable.
 */
export async function closeOpenAccessSessions(assessmentId: string): Promise<void> {
  const open = await prisma.assessmentSession.findMany({
    where: { assessmentId, isOpenAccess: true, status: "RUNNING" },
    select: { id: true },
  });
  for (const session of open) {
    await closeSession(session.id, { reason: "ENDED_BY_ARCHITECT", endedById: null });
  }
}

// --- CRUD ---------------------------------------------------------------------

export async function listSessions(
  actor: AuthenticatedUser,
  assessmentId: string,
): Promise<SessionView[]> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);

  // The implicit open-access session is not a session an Architect schedules,
  // starts, or ends, so it does not belong in the list of ones they do. It is
  // reached through the Assessment's own open-access switch and its monitor.
  const rows = await prisma.assessmentSession.findMany({
    where: { assessmentId, isOpenAccess: false },
    select: SESSION_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(rows.map((row) => sessionView(row, scope.moduleId)));
}

/**
 * Every session in a Module, for choosing one to filter a list by.
 *
 * Module-wide rather than per Assessment, because that is the scope the grading
 * records are read at. The open-access session is included here — unlike in
 * `listSessions`, where it is excluded because it is not one an Architect
 * schedules. Here it is simply where a great many submissions came from, and
 * leaving it out would make those records unfilterable.
 */
export async function listModuleSessions(
  actor: AuthenticatedUser,
  moduleId: string,
): Promise<ModuleSessionOption[]> {
  await assertCanWrite(actor, moduleId);

  const rows = await prisma.assessmentSession.findMany({
    where: { assessment: { section: { moduleId } } },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      status: true,
      isOpenAccess: true,
      createdAt: true,
      assessment: { select: { id: true, title: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    isOpenAccess: row.isOpenAccess,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.title,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Timing is copied from the Assessment unless the request overrides it. An
 * untimed Assessment only ever produces untimed sessions: sending timing for
 * one is refused rather than ignored, so a request never looks as if it
 * configured something it did not.
 */
export async function createSession(
  actor: AuthenticatedUser,
  assessmentId: string,
  input: CreateSessionRequest,
): Promise<SessionView> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: { timeMode: true, executionMode: true, durationMinutes: true },
  });

  let executionMode: ExecutionMode | null = null;
  let durationMinutes: number | null = null;
  if (assessment.timeMode === "UNTIMED") {
    if (input.executionMode !== undefined || input.durationMinutes !== undefined) {
      throw new AppError(
        "VALIDATION_FAILED",
        "An untimed assessment runs untimed sessions; timing cannot be set",
      );
    }
  } else {
    executionMode = input.executionMode ?? assessment.executionMode;
    durationMinutes = input.durationMinutes ?? assessment.durationMinutes;
  }

  const closesAt = input.closesAt ?? null;
  const requireAllReady = input.requireAllReady ?? false;
  const problem = sessionRuleProblem({
    executionMode,
    closesAt,
    requireAllReady,
    nowMs: Date.now(),
  });
  if (problem) throw new AppError("VALIDATION_FAILED", problem);

  const row = await prisma.assessmentSession.create({
    data: {
      assessmentId,
      name: input.name,
      executionMode,
      durationMinutes,
      // Defaults to LISTED, which is the rule this product has always had.
      // MODULE is the Architect saying "anyone enrolled may walk in", and it
      // survives a participant list being written later.
      access: input.access ?? "LISTED",
      closesAt: closesAt === null ? null : new Date(closesAt),
      requireAllReady,
    },
    select: SESSION_SELECT,
  });
  return sessionView(row, scope.moduleId);
}

export async function getSession(
  actor: AuthenticatedUser,
  sessionId: string,
): Promise<SessionView> {
  const { scope, row } = await ownedSession(actor, sessionId);
  return sessionView(row, scope.moduleId);
}

export async function updateSession(
  actor: AuthenticatedUser,
  sessionId: string,
  input: UpdateSessionRequest,
): Promise<SessionView> {
  const { scope, row } = await ownedSession(actor, sessionId);

  if (!isEditable(row.status)) {
    throw new AppError("CONFLICT", "Only a draft or ready session can be changed");
  }
  if (input.executionMode !== undefined || input.durationMinutes !== undefined) {
    if (row.executionMode === null) {
      throw new AppError(
        "VALIDATION_FAILED",
        "An untimed assessment runs untimed sessions; timing cannot be set",
      );
    }
  }

  // Checked against the session as the patch will leave it, so switching to
  // Live while a closing time is already set is refused here rather than only
  // when the two arrive together.
  //
  // The clock is supplied only when this request is the one setting the closing
  // time. A stored time that has since passed is a fact about the session, not
  // a fault in a patch that renames it — judging it here would leave the
  // Architect unable to edit the very session they need to fix.
  const problem = sessionRuleProblem({
    executionMode: input.executionMode ?? row.executionMode,
    closesAt:
      input.closesAt !== undefined ? input.closesAt : (row.closesAt?.toISOString() ?? null),
    requireAllReady: input.requireAllReady ?? row.requireAllReady,
    ...(input.closesAt === undefined ? {} : { nowMs: Date.now() }),
  });
  if (problem) throw new AppError("VALIDATION_FAILED", problem);

  // Conditional on the status just read, so a start that lands between the
  // read and this write cannot have its timing changed underneath it.
  const updated = await prisma.assessmentSession.updateMany({
    where: { id: sessionId, status: { in: [...EDITABLE_STATUSES] } },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
      ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.access === undefined ? {} : { access: input.access }),
      ...(input.closesAt === undefined
        ? {}
        : { closesAt: input.closesAt === null ? null : new Date(input.closesAt) }),
      ...(input.requireAllReady === undefined ? {} : { requireAllReady: input.requireAllReady }),
    },
  });
  if (updated.count === 0) {
    throw new AppError("CONFLICT", "Only a draft or ready session can be changed");
  }

  if (input.status !== undefined) await broadcastSessionState(sessionId);

  const fresh = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  return sessionView(fresh, scope.moduleId);
}

/**
 * Deletes a session that is not running, along with everything it recorded.
 *
 * This is the one deliberate exception to submission history being permanent:
 * an Architect who has ended a session may throw it away, and its attempts,
 * Submissions and events go with it through the cascade. A running session must
 * be ended first, which is what closes its open attempts and queues their
 * grading.
 */
export async function deleteSession(actor: AuthenticatedUser, sessionId: string): Promise<void> {
  const { row } = await ownedSession(actor, sessionId);
  if (row.status === "RUNNING") {
    throw new AppError("CONFLICT", "End the session before deleting it");
  }

  const { counts } = await readinessFor(sessionId);

  // The guards live in the WHERE so they are evaluated with the delete itself:
  // ending a session queues grading, and a row removed while the worker still
  // holds its job would leave that result with nowhere to land.
  const deleted = await prisma.assessmentSession.deleteMany({
    where: {
      id: sessionId,
      status: { not: "RUNNING" },
      attempts: { none: { status: "IN_PROGRESS" } },
      submissions: { none: { status: { in: ["QUEUED", "RUNNING"] } } },
    },
  });
  if (deleted.count === 0) {
    throw new AppError(
      "CONFLICT",
      "Submissions from this session are still being graded; try again in a moment",
    );
  }

  // A lobby that is still open would otherwise wait on a session that is gone.
  await publishAssessmentBroadcast({
    type: "SESSION_STATE",
    payload: { sessionId, status: "CANCELLED", endsAt: null, counts },
  });
}

// --- Participants -------------------------------------------------------------

/**
 * Replaces the participant list.
 *
 * Every listed Coder must hold an approved enrollment in the Module — the list
 * narrows who takes part, it never grants access to a Module. A Coder who stays
 * on the list keeps their readiness and connection state across the change.
 */
export async function replaceParticipants(
  actor: AuthenticatedUser,
  sessionId: string,
  input: ReplaceParticipantsRequest,
): Promise<ReadinessView> {
  const { scope, row } = await ownedSession(actor, sessionId);
  if (!isEditable(row.status)) {
    throw new AppError("CONFLICT", "The participant list is fixed once a session starts");
  }

  const enrolled = await prisma.moduleEnrollment.findMany({
    where: { moduleId: scope.moduleId, status: "APPROVED", user: { role: "CODER" } },
    select: { userId: true },
  });
  const enrolledIds = new Set(enrolled.map((enrollment) => enrollment.userId));

  let userIds: string[];
  if (input.mode === "ALL_ENROLLED") {
    userIds = [...enrolledIds];
  } else {
    const outsiders = input.userIds.filter((userId) => !enrolledIds.has(userId));
    if (outsiders.length > 0) {
      throw new AppError(
        "VALIDATION_FAILED",
        `${outsiders.length} selected participant(s) are not enrolled Coders in this module`,
        { userIds: outsiders },
      );
    }
    userIds = input.userIds;
  }

  await prisma.$transaction([
    prisma.assessmentParticipant.deleteMany({
      where: { sessionId, isListed: true, userId: { notIn: userIds } },
    }),
    prisma.assessmentParticipant.updateMany({
      where: { sessionId, userId: { in: userIds } },
      data: { isListed: true },
    }),
    prisma.assessmentParticipant.createMany({
      data: userIds.map((userId) => ({ sessionId, userId, isListed: true })),
      skipDuplicates: true,
    }),
  ]);

  await broadcastSessionState(sessionId);
  return readinessFor(sessionId);
}

export async function getReadiness(
  actor: AuthenticatedUser,
  sessionId: string,
): Promise<ReadinessView> {
  await ownedSession(actor, sessionId);
  return readinessFor(sessionId);
}

// --- Lifecycle ----------------------------------------------------------------

/**
 * Starts a session.
 *
 * For a Live session the readiness check runs first: without `force`, a
 * session whose list is not fully ready answers with the counts and does not
 * start, so the Architect makes the call with the numbers in front of them.
 * With `force` it starts anyway and records that it did.
 *
 * Live mode fixes `endsAt` here, once. Individual and Untimed sessions have no
 * global clock — each attempt's own clock starts when that Coder starts.
 */
export async function startSession(
  actor: AuthenticatedUser,
  sessionId: string,
  input: StartSessionRequest,
): Promise<StartSessionResponse> {
  const { scope, row } = await ownedSession(actor, sessionId);

  if (!isEditable(row.status)) {
    throw new AppError("CONFLICT", "Only a draft or ready session can be started");
  }

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: row.assessmentId },
    select: { isPublished: true, _count: { select: { testCases: true, testScripts: true } } },
  });
  if (!assessment.isPublished) {
    throw new AppError("VALIDATION_FAILED", "Publish the assessment before starting a session");
  }
  if (assessment._count.testCases + assessment._count.testScripts === 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Add at least one test case or test script so submissions can be graded",
    );
  }

  const isLive = row.executionMode === "LIVE";
  if (isLive && row.durationMinutes === null) {
    throw new AppError("VALIDATION_FAILED", "A live session needs a duration");
  }

  const now = new Date();
  if (row.closesAt !== null && row.closesAt.getTime() <= now.getTime()) {
    throw new AppError(
      "VALIDATION_FAILED",
      "This session's closing time has already passed; move it before starting",
    );
  }

  const participants = await prisma.assessmentParticipant.findMany({
    where: { sessionId },
    select: { isListed: true, readyState: true, connectionState: true },
  });
  const counts = countReadiness(participants);

  if (isLive && counts.total === 0) {
    throw new AppError("VALIDATION_FAILED", "A live session needs a participant list");
  }

  /**
   * Whether readiness is a gate on this Start.
   *
   * Live always is — everybody shares one clock, so a Coder who is not there
   * when it begins loses that time for good. Every other mode is the
   * Architect's choice, and `requireAllReady` is where they made it.
   *
   * `counts` is over the participant list alone. A session with no list has
   * nothing to be ready, so the gate stands aside rather than blocking a Start
   * on a roster that does not exist.
   */
  const gated = (isLive || row.requireAllReady) && counts.total > 0;
  const missing = gated && !everyoneReady(counts);
  if (missing && !input.force) {
    return {
      started: false,
      warning: {
        code: "PARTICIPANTS_NOT_READY",
        message: `Not all selected participants are ready (${counts.ready}/${counts.total} ready, ${counts.offline} offline)`,
        counts,
      },
    };
  }

  // Live computes its own deadline from the duration; every other mode takes
  // the Architect's closing time, which may be null and then never closes on
  // its own. Either way `endsAt` is the one field the clocks and guards read.
  const endsAt = isLive
    ? row.durationMinutes === null
      ? null
      : new Date(now.getTime() + row.durationMinutes * 60_000)
    : row.closesAt;

  const event = await prisma.$transaction(async (tx) => {
    // Conditional on the editable statuses, so two Architects pressing Start
    // at once start the session once.
    const started = await tx.assessmentSession.updateMany({
      where: { id: sessionId, status: { in: [...EDITABLE_STATUSES] } },
      data: {
        status: "RUNNING",
        startedAt: now,
        endsAt,
        startedById: actor.id,
        startedWithMissingParticipants: missing,
      },
    });
    if (started.count === 0) {
      throw new AppError("CONFLICT", "This session has already been started");
    }
    return recordEvent(tx, {
      sessionId,
      type: "SESSION_STARTED",
      occurredAt: now,
      payload: {
        forced: input.force && missing,
        ready: counts.ready,
        offline: counts.offline,
        total: counts.total,
      },
    });
  });

  if (endsAt !== null) {
    await scheduleDeadline({ kind: "SESSION", sessionId }, endsAt.getTime());
  }

  await publishAssessmentBroadcast({
    type: "SESSION_STARTED",
    payload: { sessionId, endsAt: endsAt?.getTime() ?? null, serverTimeMs: Date.now() },
  });
  await broadcastSessionState(sessionId);
  await announceEvents([event]);

  const fresh = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  return { started: true, session: await sessionView(fresh, scope.moduleId) };
}

export async function endSession(
  actor: AuthenticatedUser,
  sessionId: string,
): Promise<SessionView> {
  const { scope, row } = await ownedSession(actor, sessionId);
  if (row.status !== "RUNNING") {
    throw new AppError("SESSION_NOT_RUNNING", "Only a running session can be ended");
  }

  await closeSession(sessionId, { reason: "ENDED_BY_ARCHITECT", endedById: actor.id });

  const fresh = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  return sessionView(fresh, scope.moduleId);
}

/**
 * The Live deadline, as apps/realtime's alarm reports it. The database decides
 * whether it is actually due: a job that fires early, or one left behind by an
 * earlier schedule, is rescheduled rather than trusted.
 */
export async function expireSession(
  sessionId: string,
  nowMs: number = Date.now(),
): Promise<ExpireSessionOutcome> {
  const session = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
    select: { status: true, endsAt: true },
  });
  if (!session || session.status !== "RUNNING") return { outcome: "NOT_RUNNING" };
  if (session.endsAt === null) return { outcome: "NOT_DUE" };

  if (session.endsAt.getTime() > nowMs) {
    await scheduleDeadline({ kind: "SESSION", sessionId }, session.endsAt.getTime(), nowMs);
    return { outcome: "NOT_DUE" };
  }

  const closed = await closeSession(sessionId, { reason: "DEADLINE", endedById: null });
  return { outcome: closed ? "ENDED" : "NOT_RUNNING" };
}

/**
 * Ends a running session and closes every attempt still open in it.
 *
 * The status flips first, so no attempt can start while the others are being
 * closed. Each open attempt is then auto-submitted from its stored draft, or
 * expired if the server never received one. A listed participant who never
 * started gets an EXPIRED attempt, so the grading record shows a no-show
 * rather than silently omitting them.
 */
async function closeSession(
  sessionId: string,
  options: { reason: "DEADLINE" | "ENDED_BY_ARCHITECT"; endedById: string | null },
): Promise<boolean> {
  const now = new Date();

  const ended = await prisma.$transaction(async (tx) => {
    const flipped = await tx.assessmentSession.updateMany({
      where: { id: sessionId, status: "RUNNING" },
      data: { status: "ENDED" },
    });
    if (flipped.count === 0) return null;
    return recordEvent(tx, {
      sessionId,
      type: "SESSION_ENDED",
      userId: options.endedById,
      occurredAt: now,
      payload: { reason: options.reason },
    });
  });
  if (ended === null) return false;

  await cancelDeadline({ kind: "SESSION", sessionId });
  await broadcastSessionState(sessionId);
  await announceEvents([ended]);

  const open = await prisma.assessmentAttempt.findMany({
    where: { sessionId, status: "IN_PROGRESS" },
    select: { id: true },
  });
  for (const attempt of open) {
    await autoSubmitAttempt(attempt.id, { reason: "SESSION_ENDED" });
  }

  const noShows = await prisma.assessmentParticipant.findMany({
    where: { sessionId, isListed: true, user: { attempts: { none: { sessionId } } } },
    select: { userId: true },
  });
  const expired: MonitorEventPayload[] = [];
  for (const participant of noShows) {
    const event = await prisma.$transaction(async (tx) => {
      const attempt = await tx.assessmentAttempt.create({
        data: {
          sessionId,
          userId: participant.userId,
          attemptNumber: 1,
          status: "EXPIRED",
          isOfficial: true,
        },
        select: { id: true },
      });
      return recordEvent(tx, {
        sessionId,
        type: "ATTEMPT_EXPIRED",
        userId: participant.userId,
        attemptId: attempt.id,
        occurredAt: now,
        payload: { reason: "NEVER_STARTED" },
      });
    });
    expired.push(event);
  }
  await announceEvents(expired);

  return true;
}

// --- Monitoring ---------------------------------------------------------------

/**
 * Every session of the Architect's that is worth watching right now.
 *
 * Running only, and that includes the implicit open-access one — which is the
 * whole reason this exists. An open-access Assessment has no session an
 * Architect ever schedules, so the Coders sitting it were reachable only by
 * remembering which Assessment it was and opening its panel.
 *
 * Scoped to owned Modules in the query. Root owns none and so sees none, which
 * is the same answer the monitor itself gives them.
 */
export async function listMonitorableSessions(
  actor: AuthenticatedUser,
): Promise<MonitorableSession[]> {
  if (actor.role !== "ARCHITECT") {
    throw new AppError("FORBIDDEN", "Only an Architect monitors a session");
  }

  const rows = await prisma.assessmentSession.findMany({
    where: {
      status: "RUNNING",
      assessment: { section: { module: { ownerId: actor.id } } },
    },
    // Scheduled sessions first: an open-access session is always running, so
    // sorting by recency alone would bury the exam that started ten minutes
    // ago under every assessment left open all term.
    orderBy: [{ isOpenAccess: "asc" }, { startedAt: "desc" }],
    select: {
      id: true,
      name: true,
      status: true,
      isOpenAccess: true,
      executionMode: true,
      startedAt: true,
      endsAt: true,
      assessment: {
        select: {
          id: true,
          title: true,
          section: { select: { module: { select: { id: true, title: true } } } },
        },
      },
      _count: { select: { participants: true } },
      // Counted in memory rather than with a filtered `_count`, which Prisma
      // does not offer alongside an unfiltered one on the same relation.
      attempts: { where: { status: "IN_PROGRESS" }, select: { id: true } },
    },
  });

  return rows.map((row) => ({
    sessionId: row.id,
    name: row.name,
    status: row.status,
    isOpenAccess: row.isOpenAccess,
    executionMode: row.executionMode,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.title,
    moduleId: row.assessment.section.module.id,
    moduleTitle: row.assessment.section.module.title,
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    activeAttempts: row.attempts.length,
    participantCount: row._count.participants,
  }));
}

export async function getMonitorSnapshot(
  actor: AuthenticatedUser,
  sessionId: string,
): Promise<MonitorSnapshot> {
  const { scope, row } = await ownedSession(actor, sessionId);
  const nowMs = Date.now();

  const [participants, events] = await Promise.all([
    prisma.assessmentParticipant.findMany({
      where: { sessionId },
      select: PARTICIPANT_SELECT,
      orderBy: { user: { displayName: "asc" } },
    }),
    prisma.assessmentEvent.findMany({
      where: { sessionId },
      orderBy: { occurredAt: "desc" },
      take: MONITOR_EVENT_BACKLOG,
      select: {
        id: true,
        sessionId: true,
        userId: true,
        attemptId: true,
        type: true,
        durationMs: true,
        occurredAt: true,
        payloadJson: true,
      },
    }),
  ]);

  const attempts = await prisma.assessmentAttempt.findMany({
    where: { sessionId },
    orderBy: { attemptNumber: "desc" },
    select: {
      id: true,
      userId: true,
      attemptNumber: true,
      status: true,
      individualDeadlineAt: true,
      pausedAt: true,
      consumedMs: true,
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: { id: true, status: true, score: true, isAutoSubmitted: true, submittedAt: true },
      },
    },
  });
  const latestByUser = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestByUser.has(attempt.userId)) latestByUser.set(attempt.userId, attempt);
  }

  const rows: MonitorParticipantRow[] = participants.map((participant) => {
    const attempt = latestByUser.get(participant.userId) ?? null;
    const submission = attempt?.submissions[0] ?? null;
    const active = attempt?.status === "IN_PROGRESS";
    return {
      ...toParticipantView(participant),
      attempt:
        attempt === null
          ? null
          : {
              id: attempt.id,
              attemptNumber: attempt.attemptNumber,
              status: attempt.status,
              remainingMs: active ? attemptRemainingMs(clockFor(attempt, row), nowMs) : null,
              paused: active && attempt.pausedAt !== null,
            },
      submission:
        submission === null
          ? null
          : {
              id: submission.id,
              status: submission.status,
              score: submission.score,
              isAutoSubmitted: submission.isAutoSubmitted,
              submittedAt: submission.submittedAt.toISOString(),
            },
    };
  });

  return {
    session: await sessionView(row, scope.moduleId),
    counts: countReadiness(participants),
    participants: rows,
    events: events.reverse().map(toMonitorEventPayload),
    serverTimeMs: nowMs,
  };
}
