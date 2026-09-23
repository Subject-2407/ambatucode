import type { SessionView } from "@ambatucode/shared";

/**
 * One line naming every rule that decides what a session does.
 *
 * The rules outgrew what a status badge can carry: the timing, who may walk in,
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
    session.access === "MODULE"
      ? "open to everyone enrolled"
      : session.isRestricted
        ? `${String(session.listedParticipantCount)} listed`
        : "open until you list participants",
  ];

  // The moment it actually closes: the start fixed it for a running session,
  // and the Architect's setting is the plan for one that has not started yet.
  const closing = session.status === "RUNNING" ? session.endsAt : session.closesAt;
  if (closing !== null) parts.push(`closes ${new Date(closing).toLocaleString()}`);
  if (session.requireAllReady) parts.push("waits for everyone ready");

  return parts.join(" · ");
}
