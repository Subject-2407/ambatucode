import "server-only";
import { prisma } from "@ambatucode/db";
import {
  errorFields,
  AppError,
  antiCheatConfigSchema,
  leaderboardRowSchema,
  type AuthenticatedUser,
  type LeaderboardQuery,
  type LeaderboardRow,
  type LeaderboardScope,
  type LeaderboardView,
} from "@ambatucode/shared";
import { z } from "zod";
import { assertNotRoot, requireEnrolled } from "../auth/guards";
import { bestPerAssessment, rankCompetitors, type Competitor } from "./leaderboard-ranking";
import { publishGamification } from "../realtime/publish";
import { getRedis } from "../redis";
import { log } from "../logger";

/**
 * Leaderboards.
 *
 * A read model, not a table: the numbers are derived from official scores on
 * every request and cached for a few seconds. Nothing is denormalised, so a
 * reset or a change of official attempt cannot leave a stale rank behind — the
 * cache is dropped and the next read recomputes.
 *
 * Ranking, decided for this product:
 *
 * - A Coder's score for one assessment is their official score there. After a
 *   reset that is whichever attempt the Architect chose, which is the whole
 *   point of keeping attempt score and official score apart.
 * - A board's score is the sum of those across the assessments it counts, so
 *   breadth is rewarded and an assessment nobody has taken costs nobody
 *   anything.
 * - Ties break on submission speed, which FR-GAME-01 allows: first to reach
 *   the total, then whose code ran faster. Both are stable, which matters —
 *   a board that reshuffles equal rows on every refresh reads as broken.
 *
 * Root never reads a leaderboard, and an assessment whose Architect set
 * `hideLeaderboard` is counted by nothing and published nowhere.
 */

/** Short enough that a grading result feels immediate, long enough to absorb a rush. */
const CACHE_TTL_SECONDS = 5;

function cacheKey(scope: LeaderboardScope, scopeId: string): string {
  return `leaderboard:${scope}:${scopeId}`;
}

const cachedRowsSchema = z.array(leaderboardRowSchema);

async function readCache(
  scope: LeaderboardScope,
  scopeId: string,
): Promise<LeaderboardRow[] | null> {
  try {
    const raw = await getRedis().get(cacheKey(scope, scopeId));
    if (raw === null) return null;
    const parsed = cachedRowsSchema.safeParse(JSON.parse(raw) as unknown);
    // A cache entry written by an older build is not an error; it is a miss.
    return parsed.success ? parsed.data : null;
  } catch {
    // A leaderboard is not worth failing a page over. Recompute instead.
    return null;
  }
}

async function writeCache(
  scope: LeaderboardScope,
  scopeId: string,
  rows: LeaderboardRow[],
): Promise<void> {
  try {
    await getRedis().set(cacheKey(scope, scopeId), JSON.stringify(rows), "EX", CACHE_TTL_SECONDS);
  } catch (error) {
    log.warn("leaderboard.cache_write_failed", { scope, scopeId, ...errorFields(error) });
  }
}

function hidesLeaderboard(antiCheatConfigJson: unknown): boolean {
  const parsed = antiCheatConfigSchema.safeParse(antiCheatConfigJson);
  // A config too malformed to read is treated as hiding the board. Showing a
  // ranking the Architect may have switched off is the worse mistake.
  return parsed.success ? parsed.data.hideLeaderboard : true;
}

type CountedAssessments = {
  /** Published assessments this board ranks on. */
  ids: string[];
  hiddenCount: number;
};

async function countedAssessments(
  where: { moduleId: string } | { sectionId: string } | { assessmentId: string },
): Promise<CountedAssessments> {
  const rows = await prisma.assessment.findMany({
    where:
      "assessmentId" in where
        ? { id: where.assessmentId }
        : "sectionId" in where
          ? { sectionId: where.sectionId, isPublished: true }
          : { section: { moduleId: where.moduleId }, isPublished: true },
    select: { id: true, antiCheatConfigJson: true },
  });

  const ids: string[] = [];
  let hiddenCount = 0;
  for (const row of rows) {
    if (hidesLeaderboard(row.antiCheatConfigJson)) hiddenCount += 1;
    else ids.push(row.id);
  }
  return { ids, hiddenCount };
}

/**
 * Loads every official score behind a board and ranks it.
 *
 * The ordering itself lives in `leaderboard-ranking.ts`, pure and tested
 * separately — this half is only the query.
 */
async function rankedRows(assessmentIds: string[]): Promise<LeaderboardRow[]> {
  if (assessmentIds.length === 0) return [];

  const rows = await prisma.submission.findMany({
    where: {
      assessmentId: { in: assessmentIds },
      attempt: { isOfficial: true },
      score: { not: null },
      // Only a Coder's grade belongs on a board. An Architect previewing their
      // own assessment is not competing in it.
      user: { role: "CODER" },
    },
    select: {
      assessmentId: true,
      userId: true,
      score: true,
      submittedAt: true,
      executionTimeMs: true,
      user: { select: { username: true, displayName: true } },
    },
  });

  const byUser = new Map<
    string,
    {
      username: string;
      displayName: string;
      rows: Array<{
        assessmentId: string;
        score: number;
        submittedAtMs: number;
        executionTimeMs: number | null;
      }>;
    }
  >();

  for (const row of rows) {
    if (row.score === null) continue;
    let entry = byUser.get(row.userId);
    if (entry === undefined) {
      entry = { username: row.user.username, displayName: row.user.displayName, rows: [] };
      byUser.set(row.userId, entry);
    }
    entry.rows.push({
      assessmentId: row.assessmentId,
      score: row.score,
      submittedAtMs: row.submittedAt.getTime(),
      executionTimeMs: row.executionTimeMs,
    });
  }

  const competitors: Competitor[] = [...byUser.entries()].map(([userId, entry]) => ({
    userId,
    username: entry.username,
    displayName: entry.displayName,
    contributions: bestPerAssessment(entry.rows),
  }));

  return rankCompetitors(competitors);
}

async function computeRows(
  scope: LeaderboardScope,
  scopeId: string,
  where: { moduleId: string } | { sectionId: string } | { assessmentId: string },
): Promise<{ rows: LeaderboardRow[]; counted: CountedAssessments }> {
  const counted = await countedAssessments(where);
  const cached = await readCache(scope, scopeId);
  if (cached !== null) return { rows: cached, counted };

  const rows = await rankedRows(counted.ids);
  await writeCache(scope, scopeId, rows);
  return { rows, counted };
}

function toView(input: {
  scope: LeaderboardScope;
  scopeId: string;
  title: string;
  rows: LeaderboardRow[];
  counted: CountedAssessments;
  viewerId: string;
  limit: number;
}): LeaderboardView {
  return {
    scope: input.scope,
    scopeId: input.scopeId,
    title: input.title,
    assessmentCount: input.counted.ids.length,
    hiddenAssessmentCount: input.counted.hiddenCount,
    rows: input.rows.slice(0, input.limit),
    // Reported separately so a Coder outside the visible page still learns
    // where they stand, without the board having to be unbounded.
    viewerRank: input.rows.find((row) => row.userId === input.viewerId)?.rank ?? null,
    generatedAtMs: Date.now(),
  };
}

export async function getModuleLeaderboard(
  actor: AuthenticatedUser,
  moduleId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardView> {
  assertNotRoot(actor);
  await requireEnrolled(actor, moduleId);

  const module = await prisma.module.findUniqueOrThrow({
    where: { id: moduleId },
    select: { title: true },
  });
  const { rows, counted } = await computeRows("MODULE", moduleId, { moduleId });
  return toView({
    scope: "MODULE",
    scopeId: moduleId,
    title: module.title,
    rows,
    counted,
    viewerId: actor.id,
    limit: query.limit,
  });
}

export async function getSectionLeaderboard(
  actor: AuthenticatedUser,
  sectionId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardView> {
  assertNotRoot(actor);
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { title: true, moduleId: true },
  });
  if (!section) throw new AppError("NOT_FOUND", "Section not found");
  await requireEnrolled(actor, section.moduleId);

  const { rows, counted } = await computeRows("SECTION", sectionId, { sectionId });
  return toView({
    scope: "SECTION",
    scopeId: sectionId,
    title: section.title,
    rows,
    counted,
    viewerId: actor.id,
    limit: query.limit,
  });
}

export async function getAssessmentLeaderboard(
  actor: AuthenticatedUser,
  assessmentId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardView> {
  assertNotRoot(actor);
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      title: true,
      antiCheatConfigJson: true,
      section: { select: { moduleId: true } },
    },
  });
  if (!assessment) throw new AppError("NOT_FOUND", "Assessment not found");
  await requireEnrolled(actor, assessment.section.moduleId);

  // An Architect who switched the board off switched it off for everyone.
  if (hidesLeaderboard(assessment.antiCheatConfigJson)) {
    throw new AppError("FORBIDDEN", "This assessment does not publish a leaderboard");
  }

  const { rows, counted } = await computeRows("ASSESSMENT", assessmentId, { assessmentId });
  return toView({
    scope: "ASSESSMENT",
    scopeId: assessmentId,
    title: assessment.title,
    rows,
    counted,
    viewerId: actor.id,
    limit: query.limit,
  });
}

// --- Invalidation ------------------------------------------------------------------

/**
 * Drops every board an assessment feeds and pushes the fresh assessment board
 * to whoever is watching it.
 *
 * Called after grading, after a reset, and after an official attempt changes —
 * anywhere an official score can move. Best-effort throughout: a stale board
 * for five seconds is a cosmetic problem, and failing the grading write that
 * caused it would not be.
 */
export async function invalidateLeaderboards(input: { assessmentId: string }): Promise<void> {
  try {
    const assessment = await prisma.assessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        sectionId: true,
        antiCheatConfigJson: true,
        section: { select: { moduleId: true } },
      },
    });
    if (!assessment) return;

    const affected: Array<{
      scope: LeaderboardScope;
      scopeId: string;
      where: { moduleId: string } | { sectionId: string } | { assessmentId: string };
    }> = [
      { scope: "ASSESSMENT", scopeId: assessment.id, where: { assessmentId: assessment.id } },
      {
        scope: "SECTION",
        scopeId: assessment.sectionId,
        where: { sectionId: assessment.sectionId },
      },
      {
        scope: "MODULE",
        scopeId: assessment.section.moduleId,
        where: { moduleId: assessment.section.moduleId },
      },
    ];

    // Drop every cache first. Whatever happens below, the next read is fresh.
    await getRedis().del(...affected.map((entry) => cacheKey(entry.scope, entry.scopeId)));

    // An assessment whose Architect switched the board off feeds no board that
    // should be announced, and its own board does not exist.
    if (hidesLeaderboard(assessment.antiCheatConfigJson)) return;

    for (const entry of affected) {
      if (!(await claimPublishSlot(entry.scope, entry.scopeId))) continue;
      const { rows } = await computeRows(entry.scope, entry.scopeId, entry.where);
      await publishGamification({
        type: "LEADERBOARD_UPDATE",
        payload: { scope: entry.scope, scopeId: entry.scopeId, rows },
      });
    }
  } catch (error) {
    log.error("leaderboard.invalidate_failed", {
      assessmentId: input.assessmentId,
      ...errorFields(error),
    });
  }
}

/**
 * At most one recompute-and-publish per board per cache window.
 *
 * Without this, a hundred submissions finishing together would each rebuild
 * all three boards they feed — three hundred ranking queries triggered by
 * grading, which is exactly the "a large grading workload must not slow
 * ordinary navigation" requirement being violated by the cheerful part of the
 * product.
 *
 * Losing the slot costs nothing: the caches were already dropped, so the next
 * read recomputes, and the push a client misses is at most one cache window
 * behind.
 */
async function claimPublishSlot(scope: LeaderboardScope, scopeId: string): Promise<boolean> {
  try {
    const claimed = await getRedis().set(
      `leaderboard:published:${scope}:${scopeId}`,
      "1",
      "EX",
      CACHE_TTL_SECONDS,
      "NX",
    );
    return claimed === "OK";
  } catch {
    // Redis is unwell. Skip the announcement rather than hammering it.
    return false;
  }
}
