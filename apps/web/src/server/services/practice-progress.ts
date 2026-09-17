import "server-only";
import { prisma } from "@ambatucode/db";
import type { ExecutionResult } from "@ambatucode/shared";
import { practiceRunKey } from "../queue/producer";
import { getRedis } from "../redis";
import { evaluatePracticeAchievements } from "./achievements";
import { errorFields } from "@ambatucode/shared";
import { log } from "../logger";

/**
 * Practice progress.
 *
 * Practice deliberately produces no Submission, no attempt, and no grade, and
 * that stays true: what is written here is a counter and a "you have done this
 * one" flag, nothing a grade could ever be computed from. It exists so the
 * platform can recognise practice at all — without it, a Coder who works
 * through forty exercises has no record that they did.
 *
 * Everything is best-effort. A Run that finishes but fails to be counted has
 * still shown the Coder their results, which is the entire point of a Run.
 */

/**
 * True when this run passed everything it ran: every public case and every
 * script test. An empty result set is not mastery — nothing ran.
 */
function passedEverything(result: ExecutionResult): boolean {
  if (result.status !== "GRADED") return false;
  if (result.testResults.length === 0) return false;
  return result.testResults.every((testResult) => testResult.passed);
}

/**
 * Records one finished practice run and re-evaluates the practice
 * achievements.
 *
 * Returns false when the job was not a practice run — an assessment Run, or a
 * script validation — so the caller can tell "nothing to do" from "failed".
 */
export async function recordPracticeRun(
  jobId: string,
  userId: string,
  result: ExecutionResult,
): Promise<boolean> {
  let practiceActivityId: string | null = null;
  try {
    // Read without deleting, like the owner key beside it. The TTL does the
    // cleanup, and a key that lingers costs nothing.
    practiceActivityId = await getRedis().get(practiceRunKey(jobId));
  } catch (error) {
    log.warn("practice.run_lookup_failed", { jobId, ...errorFields(error) });
    return false;
  }
  if (practiceActivityId === null) return false;

  const mastered = passedEverything(result);
  const now = new Date();

  try {
    await prisma.practiceProgress.upsert({
      where: { userId_practiceActivityId: { userId, practiceActivityId } },
      create: {
        userId,
        practiceActivityId,
        runCount: 1,
        lastRunAt: now,
        passedAllAt: mastered ? now : null,
      },
      update: { runCount: { increment: 1 }, lastRunAt: now },
    });

    // Stamped once, on the run that first passed everything. Written
    // separately so it lands only while the column is still null: a later
    // failing run does not un-learn the activity, and a later passing one
    // does not rewrite when it was learned.
    if (mastered) {
      await prisma.practiceProgress.updateMany({
        where: { userId, practiceActivityId, passedAllAt: null },
        data: { passedAllAt: now },
      });
    }
  } catch (error) {
    log.warn("practice.progress_write_failed", {
      userId,
      practiceActivityId,
      ...errorFields(error),
    });
    return false;
  }

  await evaluatePracticeAchievements(userId);
  return true;
}
