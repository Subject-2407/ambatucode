import type { AssessmentSessionStatus, SessionView } from "@ambatucode/shared";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * One line naming every rule that decides what a session does.
 *
 * The rules outgrew what a status badge can carry: the timing, who takes part,
 * when it stops accepting work, and whether Start waits for the room. An
 * Architect scanning a list of sessions needs all four, and the session's own
 * screen needs the same sentence — so it is written once here rather than
 * drifting between the two.
 */
export function describeSessionRules(session: SessionView): string {
  const parts: string[] = [
    session.executionMode === null
      ? "Untimed"
      : `${session.executionMode === "LIVE" ? "Live" : "Individual"} · ${String(session.durationMinutes ?? 0)} min`,
    session.rosterSource === "MODULE"
      ? "everyone enrolled"
      : session.rosterSource === "LIST"
        ? `${String(session.listedParticipantCount)} chosen ${session.listedParticipantCount === 1 ? "Coder" : "Coders"}`
        : "nobody chosen yet",
  ];

  // The moment it actually closes: the start fixed it for a running session,
  // and the Architect's setting is the plan for one that has not started yet.
  const closing = session.status === "RUNNING" ? session.endsAt : session.closesAt;
  if (closing !== null) parts.push(`closes ${new Date(closing).toLocaleString()}`);
  if (session.requireAllReady || session.executionMode === "LIVE") {
    parts.push("waits for everyone ready");
  }

  return parts.join(" · ");
}

/**
 * What each status is called on screen.
 *
 * The stored names are the lifecycle's, not the Architect's: READY is a
 * session whose lobby is open — it says nothing about whether anyone in it is
 * ready, and a badge reading "READY" over a board showing 0/30 ready was a
 * contradiction on its face.
 */
export const SESSION_STATUS_LABEL: Readonly<Record<AssessmentSessionStatus, string>> = {
  DRAFT: "Draft",
  READY: "Lobby open",
  RUNNING: "Running",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};

export const SESSION_STATUS_TONE: Readonly<Record<AssessmentSessionStatus, BadgeTone>> = {
  DRAFT: "neutral",
  READY: "info",
  RUNNING: "success",
  ENDED: "neutral",
  CANCELLED: "warning",
};
