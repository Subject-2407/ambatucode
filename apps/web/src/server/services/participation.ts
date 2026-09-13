import "server-only";
import { prisma } from "@ambatucode/db";
import type { ExecutionMode } from "@ambatucode/shared";

export type SessionEligibility = {
  eligible: boolean;
  /** True when the Coder is on the participant list, not merely admitted. */
  listed: boolean;
};

/**
 * Who may take part in a session, given the Coder is already enrolled.
 *
 * - A listed participant may always take part.
 * - A Live session is its list: nobody else takes part.
 * - An Individual or Untimed session is open to every enrolled Coder until the
 *   Architect writes a list, and restricted to that list once they have.
 *
 * Coders who joined an open session also have participant rows, but unlisted
 * ones — they are tracked, not invited, so they never make a session restricted.
 */
export async function sessionEligibility(
  sessionId: string,
  userId: string,
  executionMode: ExecutionMode | null,
): Promise<SessionEligibility> {
  const own = await prisma.assessmentParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { isListed: true },
  });
  if (own?.isListed) return { eligible: true, listed: true };
  if (executionMode === "LIVE") return { eligible: false, listed: false };

  const listed = await prisma.assessmentParticipant.count({
    where: { sessionId, isListed: true },
  });
  return { eligible: listed === 0, listed: false };
}
