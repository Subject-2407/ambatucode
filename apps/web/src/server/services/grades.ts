import "server-only";
import { Prisma, prisma } from "@ambatucode/db";
import {
  AppError,
  type AuthenticatedUser,
  type GradeRecordQuery,
  type GradeRecordView,
  type Paginated,
  type ResetAttemptRequest,
  type ResetAttemptResponse,
  type SetOfficialAttemptRequest,
  type SubmissionHistoryItem,
  type SubmissionHistoryQuery,
} from "@ambatucode/shared";
import { assertNotRoot, requireModuleOwner } from "../auth/guards";
import { publishAssessmentBroadcast } from "../realtime/publish";
import {
  toGradeRecordView,
  toSubmissionHistoryItem,
  type GradeAttemptRow,
} from "../serializers/grades";
import { announceEvents, recordEvent } from "./assessment-events";
import { scopeForAssessment, scopeForAttempt } from "./assessment-scope";
import { invalidateLeaderboards } from "./leaderboards";
import { clearOfficialAttempts, setOfficialAttempt } from "./official-score";

/**
 * Grading records: what an Architect reads, resets, and chooses between.
 *
 * A record is one Coder's work at one Assessment Session — every attempt they
 * have there, and which of those supplies the official score. That is the unit
 * because a reset creates a new attempt and keeps the old one: "what did this
 * Coder score" has no answer until you can see the whole set.
 *
 * Root is refused at the top of every function here. These are grading records
 * and participant submissions, which the SRS puts outside Root's reach, and
 * the refusal lives in this layer so no route can forget it.
 */

/** One Coder at one session — the key a grading record is grouped on. */
type RecordKey = { sessionId: string; userId: string };

type RecordScope =
  { kind: "MODULE"; moduleId: string } | { kind: "ASSESSMENT"; assessmentId: string };

/**
 * The filter half of the record query, as SQL fragments.
 *
 * Raw rather than Prisma's query builder because the page is a page of
 * *groups* — distinct `(sessionId, userId)` pairs ordered by the Coder's name —
 * and `LIMIT`/`OFFSET` has to apply after the grouping. Prisma's `distinct`
 * does not compose with pagination in a way that can be relied on, and a
 * half-correct page of grades is worse than a slower one.
 *
 * Every value is a tagged-template parameter, so nothing here is interpolated
 * into SQL text.
 */
function recordFilters(scope: RecordScope, query: GradeRecordQuery): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];

  if (scope.kind === "MODULE") {
    filters.push(Prisma.sql`sec."moduleId" = ${scope.moduleId}`);
  } else {
    filters.push(Prisma.sql`asm."id" = ${scope.assessmentId}`);
  }

  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    filters.push(Prisma.sql`(u."username" ILIKE ${pattern} OR u."displayName" ILIKE ${pattern})`);
  }
  if (query.sectionId !== undefined) filters.push(Prisma.sql`sec."id" = ${query.sectionId}`);
  if (query.assessmentId !== undefined) filters.push(Prisma.sql`asm."id" = ${query.assessmentId}`);
  if (query.sessionId !== undefined) filters.push(Prisma.sql`s."id" = ${query.sessionId}`);

  // Filtered on the official attempt's submission, because that is the status
  // the record reports. An earlier attempt that errored is history, not the
  // record's state.
  if (query.status !== undefined) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "AssessmentAttempt" oa
      JOIN "Submission" sub ON sub."attemptId" = oa."id"
      WHERE oa."sessionId" = a."sessionId" AND oa."userId" = a."userId"
        AND oa."isOfficial" = true AND sub."status" = CAST(${query.status} AS "SubmissionStatus")
    )`);
  }

  if (query.resetOnly === true) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "AssessmentAttempt" ra
      WHERE ra."sessionId" = a."sessionId" AND ra."userId" = a."userId"
        AND ra."status" = CAST('RESET' AS "AttemptStatus")
    )`);
  }

  return filters;
}

function recordFrom(filters: Prisma.Sql[]): Prisma.Sql {
  return Prisma.sql`
    FROM "AssessmentAttempt" a
    JOIN "User" u ON u."id" = a."userId"
    JOIN "AssessmentSession" s ON s."id" = a."sessionId"
    JOIN "Assessment" asm ON asm."id" = s."assessmentId"
    JOIN "Section" sec ON sec."id" = asm."sectionId"
    WHERE ${Prisma.join(filters, " AND ")}
  `;
}

/**
 * Ordered by the Coder's name first, because an Architect reading grades is
 * looking someone up. Section and assessment order keep one Coder's rows in
 * the order the module presents them, and the session id is the final
 * tiebreak so the page is stable across requests.
 */
async function recordKeyPage(
  scope: RecordScope,
  query: GradeRecordQuery,
  page: { skip: number; take: number },
): Promise<RecordKey[]> {
  const from = recordFrom(recordFilters(scope, query));
  return prisma.$queryRaw<RecordKey[]>(Prisma.sql`
    SELECT a."sessionId", a."userId"
    ${from}
    GROUP BY a."sessionId", a."userId", u."username", sec."orderIndex", asm."orderIndex"
    ORDER BY u."username" ASC, sec."orderIndex" ASC, asm."orderIndex" ASC, a."sessionId" ASC
    LIMIT ${page.take} OFFSET ${page.skip}
  `);
}

async function recordCount(scope: RecordScope, query: GradeRecordQuery): Promise<number> {
  const from = recordFrom(recordFilters(scope, query));
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT 1 ${from} GROUP BY a."sessionId", a."userId"
    ) grouped
  `);
  return Number(rows[0]?.count ?? 0n);
}

const RECORD_ATTEMPT_SELECT = {
  id: true,
  sessionId: true,
  userId: true,
  attemptNumber: true,
  status: true,
  isOfficial: true,
  startedAt: true,
  consumedMs: true,
  resetAt: true,
  resetReason: true,
  resetBy: { select: { displayName: true } },
  user: { select: { id: true, username: true, displayName: true } },
  session: {
    select: {
      id: true,
      name: true,
      assessment: {
        select: {
          id: true,
          title: true,
          section: {
            select: { id: true, title: true, module: { select: { id: true, title: true } } },
          },
        },
      },
    },
  },
  submissions: {
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      status: true,
      score: true,
      language: true,
      isAutoSubmitted: true,
      submittedAt: true,
      gradedAt: true,
      executionTimeMs: true,
      memoryUsedKb: true,
    },
  },
} satisfies Prisma.AssessmentAttemptSelect;

type RecordAttemptRow = Prisma.AssessmentAttemptGetPayload<{
  select: typeof RECORD_ATTEMPT_SELECT;
}>;

function keyOf(key: RecordKey): string {
  return `${key.sessionId}:${key.userId}`;
}

/**
 * Loads every attempt behind a page of record keys and groups them back into
 * records, preserving the order the keys arrived in.
 */
async function loadRecords(keys: RecordKey[]): Promise<GradeRecordView[]> {
  if (keys.length === 0) return [];

  const rows = await prisma.assessmentAttempt.findMany({
    where: { OR: keys.map((key) => ({ sessionId: key.sessionId, userId: key.userId })) },
    orderBy: { attemptNumber: "asc" },
    select: RECORD_ATTEMPT_SELECT,
  });

  const grouped = new Map<string, RecordAttemptRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(keyOf(row));
    if (bucket === undefined) grouped.set(keyOf(row), [row]);
    else bucket.push(row);
  }

  const records: GradeRecordView[] = [];
  for (const key of keys) {
    const attempts = grouped.get(keyOf(key));
    // A key with no attempts cannot happen — the keys came from the attempt
    // table — but a record built from nothing would have no Coder to name.
    if (attempts === undefined || attempts.length === 0) continue;
    const first = attempts[0]!;
    const assessment = first.session.assessment;
    records.push(
      toGradeRecordView(
        {
          user: first.user,
          module: assessment.section.module,
          section: assessment.section,
          assessment: { id: assessment.id, title: assessment.title },
          session: { id: first.session.id, name: first.session.name },
        },
        attempts satisfies GradeAttemptRow[],
      ),
    );
  }
  return records;
}

async function scopeFor(
  actor: AuthenticatedUser,
  scope: RecordScope,
): Promise<{ moduleId: string }> {
  assertNotRoot(actor);
  const moduleId =
    scope.kind === "MODULE"
      ? scope.moduleId
      : (await scopeForAssessment(scope.assessmentId)).moduleId;
  await requireModuleOwner(actor, moduleId);
  return { moduleId };
}

export async function listModuleGrades(
  actor: AuthenticatedUser,
  moduleId: string,
  query: GradeRecordQuery,
): Promise<Paginated<GradeRecordView>> {
  const scope: RecordScope = { kind: "MODULE", moduleId };
  await scopeFor(actor, scope);
  return listGrades(scope, query);
}

export async function listAssessmentGrades(
  actor: AuthenticatedUser,
  assessmentId: string,
  query: GradeRecordQuery,
): Promise<Paginated<GradeRecordView>> {
  const scope: RecordScope = { kind: "ASSESSMENT", assessmentId };
  await scopeFor(actor, scope);
  return listGrades(scope, query);
}

async function listGrades(
  scope: RecordScope,
  query: GradeRecordQuery,
): Promise<Paginated<GradeRecordView>> {
  const skip = (query.page - 1) * query.pageSize;
  const [total, keys] = await Promise.all([
    recordCount(scope, query),
    recordKeyPage(scope, query, { skip, take: query.pageSize }),
  ]);
  return {
    items: await loadRecords(keys),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * Walks the record keys in batches, for the export.
 *
 * The export streams rather than buffering, so the keys have to arrive in
 * pages too — holding every grade in a module in memory to write a file is
 * exactly what streaming is meant to avoid.
 */
export async function* iterateGradeRecords(
  actor: AuthenticatedUser,
  moduleId: string,
  query: GradeRecordQuery,
  batchSize = 100,
): AsyncGenerator<GradeRecordView> {
  const scope: RecordScope = { kind: "MODULE", moduleId };
  await scopeFor(actor, scope);

  for (let skip = 0; ; skip += batchSize) {
    const keys = await recordKeyPage(scope, query, { skip, take: batchSize });
    if (keys.length === 0) return;
    for (const record of await loadRecords(keys)) {
      yield record;
    }
    if (keys.length < batchSize) return;
  }
}

// --- Reset and official selection ------------------------------------------------

/**
 * Resets a Coder's attempt: closes the current one and opens the next.
 *
 * Nothing is deleted. The old attempt keeps its `Submission` rows and its
 * status becomes `RESET`, so the submission history the SRS requires stays
 * exactly as it was. The official flag is cleared across the whole record
 * rather than moved, because which attempt now counts is the Architect's call
 * — it settles on the new attempt by itself only once that attempt produces a
 * result and no choice has been made.
 */
export async function resetAttempt(
  actor: AuthenticatedUser,
  attemptId: string,
  input: ResetAttemptRequest,
): Promise<ResetAttemptResponse> {
  assertNotRoot(actor);
  const scope = await scopeForAttempt(attemptId);
  await requireModuleOwner(actor, scope.moduleId);

  const now = new Date();
  const { response, event } = await prisma.$transaction(async (tx) => {
    const attempt = await tx.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { id: true, sessionId: true, userId: true, attemptNumber: true, status: true },
    });
    if (attempt.status === "RESET") {
      throw new AppError("CONFLICT", "This attempt has already been reset");
    }

    // The next number comes from the highest attempt at this session, not from
    // the one being reset: resetting an older attempt out of order must not
    // collide with a number that already exists.
    const latest = await tx.assessmentAttempt.findFirst({
      where: { sessionId: attempt.sessionId, userId: attempt.userId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });

    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: "RESET",
        resetById: actor.id,
        resetAt: now,
        resetReason: input.reason,
        isOfficial: false,
      },
    });
    await clearOfficialAttempts(tx, { sessionId: attempt.sessionId, userId: attempt.userId });

    const created = await tx.assessmentAttempt.create({
      data: {
        sessionId: attempt.sessionId,
        userId: attempt.userId,
        attemptNumber: (latest?.attemptNumber ?? attempt.attemptNumber) + 1,
        status: "NOT_STARTED",
      },
      select: { id: true, attemptNumber: true },
    });

    const recorded = await recordEvent(tx, {
      sessionId: attempt.sessionId,
      type: "ATTEMPT_RESET",
      userId: attempt.userId,
      attemptId,
      occurredAt: now,
      payload: {
        reason: input.reason,
        resetById: actor.id,
        previousAttemptNumber: attempt.attemptNumber,
        newAttemptId: created.id,
      },
    });

    return {
      response: {
        previousAttemptId: attemptId,
        newAttemptId: created.id,
        newAttemptNumber: created.attemptNumber,
      },
      event: recorded,
    };
  });

  await announceEvents([event]);
  // The Coder's old attempt URL must stop being a live workspace.
  await publishAssessmentBroadcast({ type: "ATTEMPT_CLOSED", userId: scope.userId, attemptId });
  await invalidateLeaderboards({ assessmentId: scope.assessmentId });

  return response;
}

export async function setAttemptOfficial(
  actor: AuthenticatedUser,
  attemptId: string,
  input: SetOfficialAttemptRequest,
): Promise<{ attemptId: string; isOfficial: boolean }> {
  assertNotRoot(actor);
  const scope = await scopeForAttempt(attemptId);
  await requireModuleOwner(actor, scope.moduleId);

  await prisma.$transaction(async (tx) => {
    const attempt = await tx.assessmentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { sessionId: true, userId: true },
    });
    if (input.isOfficial) {
      await setOfficialAttempt(tx, { ...attempt, attemptId });
    } else {
      await tx.assessmentAttempt.update({ where: { id: attemptId }, data: { isOfficial: false } });
    }
  });

  await invalidateLeaderboards({ assessmentId: scope.assessmentId });
  return { attemptId, isOfficial: input.isOfficial };
}

// --- A Coder's own history ---------------------------------------------------------

/**
 * Every formal Submission this Coder has made. Their own only — the filter is
 * on `userId`, not on anything the caller supplies.
 */
export async function listOwnSubmissions(
  actor: AuthenticatedUser,
  query: SubmissionHistoryQuery,
): Promise<Paginated<SubmissionHistoryItem>> {
  assertNotRoot(actor);

  const where: Prisma.SubmissionWhereInput = {
    userId: actor.id,
    ...(query.assessmentId === undefined ? {} : { assessmentId: query.assessmentId }),
    ...(query.moduleId === undefined
      ? {}
      : { assessment: { section: { moduleId: query.moduleId } } }),
  };

  const [total, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        status: true,
        score: true,
        language: true,
        isAutoSubmitted: true,
        submittedAt: true,
        gradedAt: true,
        executionTimeMs: true,
        memoryUsedKb: true,
        attemptId: true,
        attempt: { select: { attemptNumber: true, isOfficial: true } },
        session: { select: { id: true, name: true } },
        assessment: {
          select: {
            id: true,
            title: true,
            section: { select: { module: { select: { id: true, slug: true, title: true } } } },
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map(toSubmissionHistoryItem),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
