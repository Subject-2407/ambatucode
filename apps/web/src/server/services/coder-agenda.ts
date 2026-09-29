import "server-only";
import { prisma } from "@ambatucode/db";
import {
  AppError,
  type AssessmentSessionStatus,
  type AuthenticatedUser,
  type ExecutionMode,
} from "@ambatucode/shared";
import { sessionEligibility } from "./participation";

/**
 * What a Coder can do right now, for the dashboard.
 *
 * The dashboard used to list the Coder's modules and nothing else — the same
 * list the catalog's "My modules" tab already shows. What a Coder opening the
 * platform actually needs first is the thing that is waiting on them: an
 * attempt they left half-done, a session their Architect has opened, a retake
 * they were granted. Those used to be three clicks deep, on the page of an
 * Assessment the Coder had to remember the name of.
 *
 * Read-only, and only about the Coder asking. Every rule about who may join a
 * session is the one the assessment page uses — `sessionEligibility` — so this
 * can never offer a session that Start would then refuse.
 */

export type AgendaKind =
  /** An attempt in progress. Its clock may be running. */
  | "CONTINUE"
  /** A retake the Architect opened for this Coder alone. */
  | "RETAKE"
  /** A session running now that this Coder may start. */
  | "OPEN"
  /** A session prepared but not yet started, with a lobby to wait in. */
  | "WAITING";

export type AgendaItem = {
  kind: AgendaKind;
  sessionId: string;
  sessionName: string;
  /** Set for CONTINUE, the attempt the workspace link opens. */
  attemptId: string | null;
  assessmentId: string;
  assessmentTitle: string;
  moduleSlug: string;
  moduleTitle: string;
  executionMode: ExecutionMode | null;
  durationMinutes: number | null;
  /** When the session stops accepting work, if it has a limit. */
  closesAt: string | null;
};

/** Most urgent first: a clock that may be running beats one that has not started. */
const KIND_ORDER: Readonly<Record<AgendaKind, number>> = {
  CONTINUE: 0,
  RETAKE: 1,
  OPEN: 2,
  WAITING: 3,
};

/**
 * Sorts and de-duplicates. One session appears once, under its most urgent
 * reason — a running session the Coder has already started is something to
 * continue, not also something to open.
 */
export function orderAgenda(items: readonly AgendaItem[]): AgendaItem[] {
  const bySession = new Map<string, AgendaItem>();
  for (const item of items) {
    const existing = bySession.get(item.sessionId);
    if (!existing || KIND_ORDER[item.kind] < KIND_ORDER[existing.kind]) {
      bySession.set(item.sessionId, item);
    }
  }
  return [...bySession.values()].sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    // Within a kind, the one that closes soonest; open-ended ones last.
    const aClose = a.closesAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.closesAt);
    const bClose = b.closesAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.closesAt);
    return aClose - bClose;
  });
}

/**
 * Which way into a session is on offer, or null for none.
 *
 * The same conditions `canStart` is built from on the assessment page, split by
 * reason so the dashboard can say which one applies.
 */
export function classifySession(input: {
  status: AssessmentSessionStatus;
  eligible: boolean;
  attempt: { status: string; grantedOutsideSession: boolean } | null;
}): AgendaKind | null {
  const { status, eligible, attempt } = input;
  if (attempt?.status === "IN_PROGRESS") return "CONTINUE";
  if (attempt?.status === "NOT_STARTED" && attempt.grantedOutsideSession) return "RETAKE";
  if (!eligible) return null;
  // Submitted or expired: this session has nothing left for the Coder to do.
  if (attempt !== null && attempt.status !== "NOT_STARTED") return null;
  if (status === "RUNNING") return "OPEN";
  if (status === "READY") return "WAITING";
  return null;
}

/** The visibility rule every Coder read uses: published, in a module they belong to. */
function readableBy(userId: string) {
  return {
    isPublished: true,
    section: {
      module: {
        isPublished: true,
        enrollments: { some: { userId, status: "APPROVED" as const } },
      },
    },
  };
}

const SESSION_SELECT = {
  id: true,
  name: true,
  status: true,
  executionMode: true,
  durationMinutes: true,
  access: true,
  isOpenAccess: true,
  endsAt: true,
  closesAt: true,
  assessment: {
    select: {
      id: true,
      title: true,
      section: { select: { module: { select: { slug: true, title: true } } } },
    },
  },
} as const;

export async function getCoderAgenda(actor: AuthenticatedUser): Promise<AgendaItem[]> {
  if (actor.role !== "CODER") {
    throw new AppError("FORBIDDEN", "Only a Coder has an agenda");
  }

  const sessions = await prisma.assessmentSession.findMany({
    where: {
      assessment: readableBy(actor.id),
      OR: [
        // Scheduled sessions a Coder might walk into. Open-access sessions are
        // excluded here: they are always open, and listing every one of them
        // would bury the sessions that actually have a time.
        { isOpenAccess: false, status: { in: ["READY", "RUNNING"] } },
        // Anything the Coder is already part of, open access included.
        {
          attempts: {
            some: {
              userId: actor.id,
              OR: [
                { status: "IN_PROGRESS" },
                { status: "NOT_STARTED", grantedOutsideSession: true },
              ],
            },
          },
        },
      ],
    },
    select: {
      ...SESSION_SELECT,
      attempts: {
        where: { userId: actor.id },
        orderBy: { attemptNumber: "desc" },
        take: 1,
        select: { id: true, status: true, grantedOutsideSession: true },
      },
    },
    take: 50,
  });

  const items: AgendaItem[] = [];
  for (const session of sessions) {
    const attempt = session.attempts[0] ?? null;
    const { eligible } = await sessionEligibility(
      session.id,
      actor.id,
      session.executionMode,
      session.access,
    );
    const kind = classifySession({ status: session.status, eligible, attempt });
    if (kind === null) continue;

    const closing = session.status === "RUNNING" ? session.endsAt : session.closesAt;
    items.push({
      kind,
      sessionId: session.id,
      sessionName: session.name,
      attemptId: kind === "CONTINUE" && attempt ? attempt.id : null,
      assessmentId: session.assessment.id,
      assessmentTitle: session.assessment.title,
      moduleSlug: session.assessment.section.module.slug,
      moduleTitle: session.assessment.section.module.title,
      executionMode: session.executionMode,
      durationMinutes: session.durationMinutes,
      closesAt: closing?.toISOString() ?? null,
    });
  }

  return orderAgenda(items);
}
