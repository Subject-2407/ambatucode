import "server-only";
import { type Prisma } from "@ambatucode/db";

/**
 * The one-official-attempt invariant.
 *
 * An attempt score and an official score are separate concepts: after a reset
 * a Coder has several attempts with several scores, and exactly one of them —
 * chosen by the Architect — is the score that counts. At most one attempt per
 * `(sessionId, userId)` may carry `isOfficial`.
 *
 * The siblings hold `false` rather than null, so a partial unique index cannot
 * express the rule. It is enforced here instead, and every write that touches
 * the flag goes through this module so there is one place to get it right.
 */

/** Every attempt at this session, by this Coder. The unit the flag applies to. */
function siblingsOf(sessionId: string, userId: string): Prisma.AssessmentAttemptWhereInput {
  return { sessionId, userId };
}

/**
 * Points the official flag at one attempt and clears its siblings, in the
 * caller's transaction so the two writes cannot be seen apart.
 */
export async function setOfficialAttempt(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; userId: string; attemptId: string },
): Promise<void> {
  await tx.assessmentAttempt.updateMany({
    where: { ...siblingsOf(input.sessionId, input.userId), NOT: { id: input.attemptId } },
    data: { isOfficial: false },
  });
  await tx.assessmentAttempt.update({
    where: { id: input.attemptId },
    data: { isOfficial: true },
  });
}

export async function clearOfficialAttempts(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; userId: string },
): Promise<void> {
  await tx.assessmentAttempt.updateMany({
    where: siblingsOf(input.sessionId, input.userId),
    data: { isOfficial: false },
  });
}

/**
 * Flags this attempt official only if no sibling already is.
 *
 * Called when a formal submission lands. A reset deliberately leaves the
 * record with no official score — the whole point is that the Architect
 * decides which attempt counts — but leaving it unset forever would mean an
 * Architect who resets fifty Coders has to revisit fifty records before a
 * single grade exports. So the flag settles on the new attempt the moment it
 * produces a result, and an Architect who has already chosen is never
 * overruled: a record with a choice on it is left exactly as it is.
 */
export async function claimOfficialIfUnset(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; userId: string; attemptId: string },
): Promise<void> {
  const chosen = await tx.assessmentAttempt.count({
    where: { ...siblingsOf(input.sessionId, input.userId), isOfficial: true },
  });
  if (chosen > 0) return;
  await tx.assessmentAttempt.update({
    where: { id: input.attemptId },
    data: { isOfficial: true },
  });
}
