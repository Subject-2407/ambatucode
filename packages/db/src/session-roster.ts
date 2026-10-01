import type { Prisma } from "@prisma/client";
import {
  rosterSource,
  type AssessmentSessionStatus,
  type ConnectionState,
  type ReadyState,
  type RosterSource,
} from "@ambatucode/shared";

/**
 * The Coders a session expects, read the same way by apps/web and apps/realtime.
 *
 * Both processes count readiness — apps/web for the Architect's screens and for
 * the gate at Start, apps/realtime every time someone toggles ready or drops
 * off. When the two read the roster differently, the board says one number and
 * Start acts on another. This is the one query both of them use.
 *
 * It takes the client rather than importing it so it can run inside a
 * transaction, and so this file does not import the module that re-exports it.
 */

export type RosterEntry = {
  userId: string;
  username: string;
  displayName: string;
  isListed: boolean;
  /** Expected by the session, and therefore counted on the readiness board. */
  onRoster: boolean;
  readyState: ReadyState;
  /** This session's page only; platform-wide presence lives in Redis. */
  connectionState: ConnectionState;
  lastSeenAt: Date | null;
};

export type SessionRoster = {
  status: AssessmentSessionStatus;
  source: RosterSource;
  /** Roster first, then anyone who joined without being expected; by name within each. */
  entries: RosterEntry[];
};

type RosterClient = Pick<Prisma.TransactionClient, "assessmentSession" | "moduleEnrollment">;

export async function loadSessionRoster(
  db: RosterClient,
  sessionId: string,
): Promise<SessionRoster | null> {
  const session = await db.assessmentSession.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      access: true,
      isOpenAccess: true,
      assessment: { select: { section: { select: { moduleId: true } } } },
      participants: {
        select: {
          userId: true,
          isListed: true,
          readyState: true,
          connectionState: true,
          lastSeenAt: true,
          user: { select: { username: true, displayName: true } },
        },
      },
    },
  });
  if (!session) return null;

  const source = rosterSource({
    access: session.access,
    isOpenAccess: session.isOpenAccess,
    listedCount: session.participants.filter((participant) => participant.isListed).length,
  });

  const entries = new Map<string, RosterEntry>();
  for (const participant of session.participants) {
    entries.set(participant.userId, {
      userId: participant.userId,
      username: participant.user.username,
      displayName: participant.user.displayName,
      isListed: participant.isListed,
      onRoster: source === "LIST" && participant.isListed,
      readyState: participant.readyState,
      connectionState: participant.connectionState,
      lastSeenAt: participant.lastSeenAt,
    });
  }

  if (source === "MODULE") {
    // Read now, not snapshotted at creation: a Coder approved the morning of
    // the exam is expected at it like everyone else.
    const enrolled = await db.moduleEnrollment.findMany({
      where: {
        moduleId: session.assessment.section.moduleId,
        status: "APPROVED",
        user: { role: "CODER", isActive: true },
      },
      select: { userId: true, user: { select: { username: true, displayName: true } } },
    });
    for (const enrollment of enrolled) {
      const existing = entries.get(enrollment.userId);
      if (existing) {
        existing.onRoster = true;
        continue;
      }
      // Expected but never seen: no participant row exists until they first
      // open the lobby or the workspace.
      entries.set(enrollment.userId, {
        userId: enrollment.userId,
        username: enrollment.user.username,
        displayName: enrollment.user.displayName,
        isListed: false,
        onRoster: true,
        readyState: "NOT_READY",
        connectionState: "OFFLINE",
        lastSeenAt: null,
      });
    }
  }

  const ordered = [...entries.values()].sort((a, b) => {
    if (a.onRoster !== b.onRoster) return a.onRoster ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
  return { status: session.status, source, entries: ordered };
}
