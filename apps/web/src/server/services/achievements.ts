import "server-only";
import { prisma, toJsonInput, type Prisma } from "@ambatucode/db";
import {
  errorFields,
  ACHIEVEMENTS,
  AppError,
  achievementByCode,
  antiCheatConfigSchema,
  attemptDeadlineMs,
  isLanguage,
  type AchievementCode,
  type AchievementShowcaseView,
  type AchievementView,
  type AuthenticatedUser,
  type UserAchievementView,
} from "@ambatucode/shared";
import { assertNotRoot } from "../auth/guards";
import { publishGamification } from "../realtime/publish";
import {
  PRACTICE_RULES,
  SUBMISSION_RULES,
  type PracticeContext,
  type SubmissionContext,
} from "./achievement-rules";
import { log } from "../logger";

/**
 * Awarding achievements.
 *
 * The rules themselves are pure predicates in `achievement-rules.ts`. This
 * module does the two things they cannot: it assembles the facts each rule
 * asks about, and it writes the award.
 *
 * Awards are permanent and unique per `(userId, achievementId)`, so evaluation
 * is safe to repeat — a retried grading callback re-evaluates and inserts
 * nothing. Nothing here is allowed to fail a grading write: a missed award is
 * a missing badge, and a failed ingest is a lost grade.
 */

function iso(value: Date): string {
  return value.toISOString();
}

function toAchievementView(code: string): AchievementView | null {
  const definition = achievementByCode(code);
  return definition === undefined
    ? null
    : {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        iconKey: definition.iconKey,
        category: definition.category,
      };
}

/**
 * Inserts the awards this Coder has newly earned and announces them.
 *
 * Existing awards are read first rather than relying on `skipDuplicates`
 * alone, because the difference matters: an insert that was skipped must not
 * produce a toast for a title the Coder earned weeks ago.
 */
async function award(
  userId: string,
  codes: AchievementCode[],
  context: Prisma.InputJsonValue,
): Promise<void> {
  if (codes.length === 0) return;

  const definitions = await prisma.achievement.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { id: true, code: true },
  });
  if (definitions.length === 0) return;

  const held = await prisma.userAchievement.findMany({
    where: { userId, achievementId: { in: definitions.map((row) => row.id) } },
    select: { achievementId: true },
  });
  const heldIds = new Set(held.map((row) => row.achievementId));
  const fresh = definitions.filter((definition) => !heldIds.has(definition.id));
  if (fresh.length === 0) return;

  const awardedAt = new Date();
  await prisma.userAchievement.createMany({
    data: fresh.map((definition) => ({
      userId,
      achievementId: definition.id,
      awardedAt,
      contextJson: context,
    })),
    skipDuplicates: true,
  });

  for (const definition of fresh) {
    const view = toAchievementView(definition.code);
    if (view === null) continue;
    await publishGamification({
      type: "ACHIEVEMENT_AWARDED",
      userId,
      payload: { ...view, awardedAtMs: awardedAt.getTime() },
    });
  }
}

// --- Submission context ------------------------------------------------------------

const CONTEXT_SELECT = {
  id: true,
  userId: true,
  assessmentId: true,
  sessionId: true,
  status: true,
  score: true,
  language: true,
  submittedAt: true,
  executionTimeMs: true,
  memoryUsedKb: true,
  attempt: {
    select: {
      id: true,
      attemptNumber: true,
      runCount: true,
      consumedMs: true,
      pausedAt: true,
      individualDeadlineAt: true,
    },
  },
  session: {
    select: { id: true, executionMode: true, durationMinutes: true, endsAt: true },
  },
  assessment: {
    select: {
      id: true,
      title: true,
      sectionId: true,
      antiCheatConfigJson: true,
      section: { select: { moduleId: true } },
    },
  },
  results: { select: { testCaseId: true, testScriptId: true, passed: true } },
} satisfies Prisma.SubmissionSelect;

type ContextRow = Prisma.SubmissionGetPayload<{ select: typeof CONTEXT_SELECT }>;

/** Statuses that put a number on the board. Mirrors the scoring rule. */
const SCORED: readonly string[] = [
  "GRADED",
  "RUNTIME_ERROR",
  "TIME_LIMIT_EXCEEDED",
  "MEMORY_LIMIT_EXCEEDED",
];

/**
 * Where a value sits among the graded submissions for the same assessment,
 * 0 being the smallest. Null when too few submissions exist for a ranking to
 * mean anything — an Architect's first Coder is not in the fastest tenth of
 * one submission.
 */
async function quantileOf(
  assessmentId: string,
  field: "executionTimeMs" | "memoryUsedKb",
  value: number | null,
): Promise<number | null> {
  if (value === null) return null;

  const where = { assessmentId, status: "GRADED" as const, [field]: { not: null } };
  const [total, faster] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.count({ where: { ...where, [field]: { lt: value } } }),
  ]);
  if (total < 5) return null;
  return faster / total;
}

async function buildSubmissionContext(row: ContextRow): Promise<SubmissionContext> {
  const language = isLanguage(row.language) ? row.language : "python";
  const antiCheat = antiCheatConfigSchema.safeParse(row.assessment.antiCheatConfigJson);
  const moduleId = row.assessment.section.moduleId;
  const submittedAtMs = row.submittedAt.getTime();

  const deadlineMs = attemptDeadlineMs({
    executionMode: row.session.executionMode,
    durationMinutes: row.session.durationMinutes,
    endsAtMs: row.session.endsAt?.getTime() ?? null,
    individualDeadlineAtMs: row.attempt.individualDeadlineAt?.getTime() ?? null,
    pausedAtMs: row.attempt.pausedAt?.getTime() ?? null,
    consumedMs: row.attempt.consumedMs,
  });
  const durationMs =
    row.session.durationMinutes === null ? null : row.session.durationMinutes * 60_000;

  // How much of the clock this submission used, read off the deadline rather
  // than off `consumedMs` — the stored counter only advances on pause, so at
  // the moment of submitting it is behind by however long the Coder has been
  // connected.
  const consumedMs =
    durationMs === null || deadlineMs === null ? null : durationMs - (deadlineMs - submittedAtMs);

  const scriptResults = row.results.filter((result) => result.testScriptId !== null);
  const caseResults = row.results.filter((result) => result.testScriptId === null);

  const publishedInSection = { sectionId: row.assessment.sectionId, isPublished: true };
  const publishedInModule = { section: { moduleId }, isPublished: true };

  const [
    executionTimeQuantile,
    memoryQuantile,
    cases,
    recentInModule,
    gradedLanguages,
    gradedCount,
    earlierPerfect,
    earlierAttempts,
    reconnects,
    focusLosses,
    sessionParticipantCount,
    sectionAssessmentIds,
    moduleAssessmentIds,
  ] = await Promise.all([
    quantileOf(row.assessmentId, "executionTimeMs", row.executionTimeMs),
    quantileOf(row.assessmentId, "memoryUsedKb", row.memoryUsedKb),
    prisma.assessmentTestCase.findMany({
      where: { assessmentId: row.assessmentId },
      select: { kind: true },
    }),
    prisma.submission.findMany({
      where: { userId: row.userId, assessment: { section: { moduleId } } },
      orderBy: { submittedAt: "desc" },
      take: 20,
      select: { status: true, score: true },
    }),
    prisma.submission.findMany({
      where: { userId: row.userId, status: "GRADED" },
      distinct: ["language"],
      select: { language: true },
    }),
    prisma.submission.count({ where: { userId: row.userId, status: "GRADED" } }),
    prisma.submission.count({
      where: {
        sessionId: row.sessionId,
        status: "GRADED",
        score: 100,
        submittedAt: { lt: row.submittedAt },
        id: { not: row.id },
      },
    }),
    prisma.submission.findMany({
      where: {
        userId: row.userId,
        sessionId: row.sessionId,
        attempt: { attemptNumber: { lt: row.attempt.attemptNumber } },
        status: { in: SCORED as Prisma.EnumSubmissionStatusFilter["in"] },
        score: { not: null },
      },
      select: { score: true },
    }),
    prisma.assessmentEvent.count({ where: { attemptId: row.attempt.id, type: "RECONNECTED" } }),
    prisma.assessmentEvent.count({ where: { attemptId: row.attempt.id, type: "FOCUS_LOST" } }),
    prisma.assessmentParticipant.count({ where: { sessionId: row.sessionId, isListed: true } }),
    prisma.assessment.findMany({ where: publishedInSection, select: { id: true } }),
    prisma.assessment.findMany({ where: publishedInModule, select: { id: true } }),
  ]);

  // Leading 100s in the module, this submission included — it is already
  // persisted by the time achievements are evaluated, so it heads the list.
  let perfectStreak = 0;
  for (const recent of recentInModule) {
    if (recent.status !== "GRADED" || recent.score !== 100) break;
    perfectStreak += 1;
  }

  const earlierScores = earlierAttempts
    .map((attempt) => attempt.score)
    .filter((score): score is number => score !== null);

  const [sectionSwept, moduleCleared] = await Promise.all([
    officialCoverage(
      row.userId,
      sectionAssessmentIds.map((a) => a.id),
      100,
    ),
    officialCoverage(
      row.userId,
      moduleAssessmentIds.map((a) => a.id),
      null,
    ),
  ]);

  return {
    submission: {
      score: row.score ?? 0,
      status: row.status,
      language,
      submittedAtMs,
      executionTimeMs: row.executionTimeMs,
      memoryUsedKb: row.memoryUsedKb,
    },
    attempt: {
      attemptNumber: row.attempt.attemptNumber,
      runCount: row.attempt.runCount,
      consumedMs,
      deadlineMs,
      durationMs,
    },
    assessment: {
      isTimed: row.session.durationMinutes !== null,
      isLive: row.session.executionMode === "LIVE",
      detectsFocusLoss: antiCheat.success ? antiCheat.data.detectFocusLoss : false,
      caseCount: cases.length,
      hiddenCaseCount: cases.filter((testCase) => testCase.kind === "HIDDEN").length,
    },
    derived: {
      executionTimeQuantile,
      memoryQuantile,
      scriptTestCount: scriptResults.length,
      scriptTestsPassed: scriptResults.filter((result) => result.passed).length,
      caseResultCount: caseResults.length,
      caseResultsPassed: caseResults.filter((result) => result.passed).length,
      perfectStreak,
      languagesGraded: gradedLanguages.length,
      isFirstGraded: gradedCount <= 1,
      isFirstPerfectInSession: earlierPerfect === 0,
      bestEarlierAttemptScore: earlierScores.length === 0 ? null : Math.max(...earlierScores),
      worstEarlierAttemptScore: earlierScores.length === 0 ? null : Math.min(...earlierScores),
      reconnected: reconnects > 0,
      focusLostCount: focusLosses,
      sessionParticipantCount,
      sectionSwept,
      moduleCleared,
    },
  };
}

/**
 * Whether this Coder holds an official score on every one of these
 * assessments — at or above `minimumScore` when one is given.
 *
 * An empty set is not coverage. A module with no published assessments has not
 * been cleared by anybody.
 */
async function officialCoverage(
  userId: string,
  assessmentIds: string[],
  minimumScore: number | null,
): Promise<boolean> {
  if (assessmentIds.length === 0) return false;

  const covered = await prisma.submission.findMany({
    where: {
      userId,
      assessmentId: { in: assessmentIds },
      attempt: { isOfficial: true },
      score: minimumScore === null ? { not: null } : { gte: minimumScore },
    },
    distinct: ["assessmentId"],
    select: { assessmentId: true },
  });
  return covered.length === assessmentIds.length;
}

/**
 * Evaluates every submission rule against one graded submission.
 *
 * Called from result ingestion after the grade is persisted. Swallows its own
 * failures on purpose: an achievement is a flourish on top of a grade, and it
 * must never be the reason a grade fails to record.
 */
export async function evaluateSubmissionAchievements(submissionId: string): Promise<void> {
  try {
    const row = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: CONTEXT_SELECT,
    });
    if (!row) return;

    // A Coder earns titles. An Architect testing their own assessment does not.
    const actorRole = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { role: true },
    });
    if (actorRole?.role !== "CODER") return;

    const context = await buildSubmissionContext(row);
    const earned = Object.entries(SUBMISSION_RULES)
      .filter(([, rule]) => rule(context))
      .map(([code]) => code as AchievementCode);

    await award(
      row.userId,
      earned,
      toJsonInput({
        submissionId: row.id,
        assessmentId: row.assessmentId,
        assessmentTitle: row.assessment.title,
        score: row.score,
        awardedFor: "SUBMISSION",
      }),
    );
  } catch (error) {
    log.error("achievements.submission_evaluation_failed", { submissionId, ...errorFields(error) });
  }
}

// --- Practice ----------------------------------------------------------------------

export async function buildPracticeContext(userId: string): Promise<PracticeContext> {
  const [runs, mastered] = await Promise.all([
    prisma.practiceProgress.aggregate({ where: { userId }, _sum: { runCount: true } }),
    prisma.practiceProgress.count({ where: { userId, passedAllAt: { not: null } } }),
  ]);
  return { runCount: runs._sum.runCount ?? 0, masteredCount: mastered };
}

/**
 * Evaluates the practice rules. Practice writes no Submission and produces no
 * grade; these read the counters that exist only to make practice visible.
 */
export async function evaluatePracticeAchievements(userId: string): Promise<void> {
  try {
    const context = await buildPracticeContext(userId);
    const earned = Object.entries(PRACTICE_RULES)
      .filter(([, rule]) => rule(context))
      .map(([code]) => code as AchievementCode);
    await award(userId, earned, toJsonInput({ awardedFor: "PRACTICE" }));
  } catch (error) {
    log.error("achievements.practice_evaluation_failed", { userId, ...errorFields(error) });
  }
}

// --- Reading -----------------------------------------------------------------------

/**
 * A Coder reads their own showcase. The Architect of a Module they belong to
 * may read it too, because a title is derived from grades in that Module and
 * the Architect already sees those. Nobody else does, and Root least of all.
 */
async function assertCanReadAchievements(actor: AuthenticatedUser, userId: string): Promise<void> {
  assertNotRoot(actor);
  if (actor.id === userId) return;

  if (actor.role === "ARCHITECT") {
    const shared = await prisma.moduleEnrollment.count({
      where: { userId, status: "APPROVED", module: { ownerId: actor.id } },
    });
    if (shared > 0) return;
  }

  // Whether this account holds any achievements is itself not the caller's
  // business, so this is NOT_FOUND rather than FORBIDDEN.
  throw new AppError("NOT_FOUND", "Achievements not found");
}

export async function getAchievementShowcase(
  actor: AuthenticatedUser,
  userId: string,
): Promise<AchievementShowcaseView> {
  await assertCanReadAchievements(actor, userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, displayName: true },
  });
  if (!user) throw new AppError("NOT_FOUND", "Achievements not found");

  const rows = await prisma.userAchievement.findMany({
    where: { userId },
    orderBy: { awardedAt: "desc" },
    select: {
      awardedAt: true,
      contextJson: true,
      achievement: { select: { code: true } },
    },
  });

  const earned: UserAchievementView[] = [];
  const earnedCodes = new Set<string>();
  for (const row of rows) {
    const view = toAchievementView(row.achievement.code);
    // A stored award whose code left the catalogue is history we cannot name.
    // It stays in the database — awards are permanent — but it is not shown.
    if (view === null) continue;
    earnedCodes.add(view.code);
    earned.push({
      ...view,
      awardedAt: iso(row.awardedAt),
      context:
        typeof row.contextJson === "object" && row.contextJson !== null
          ? (row.contextJson as Record<string, unknown>)
          : {},
    });
  }

  const locked = ACHIEVEMENTS.filter((achievement) => !earnedCodes.has(achievement.code)).map(
    (achievement) => ({
      code: achievement.code,
      name: achievement.name,
      description: achievement.description,
      iconKey: achievement.iconKey,
      category: achievement.category,
    }),
  );

  return { userId: user.id, displayName: user.displayName, earned, locked };
}
