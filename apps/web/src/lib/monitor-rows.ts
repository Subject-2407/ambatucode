import type {
  AssessmentEventType,
  MonitorEventPayload,
  MonitorParticipantPayload,
  MonitorParticipantRow,
} from "@ambatucode/shared";

/**
 * The monitor's participant rows: where they come from, what each one is
 * doing, and how an Architect narrows a room of a hundred to the three that
 * need them.
 *
 * Pure, so the rules the grid is read by are tested rather than eyeballed.
 */

/**
 * The snapshot's rows with newer socket deltas laid over them.
 *
 * The snapshot carries attempt and submission state that the feed does not;
 * the feed carries connection and readiness as they change. A delta wins only
 * when it arrived after the snapshot was read — the snapshot is re-read while
 * the monitor is open, and an older delta laid over a newer read would bring a
 * Coder who has since come back up as still gone.
 */
export function mergeMonitorRows(
  base: readonly MonitorParticipantRow[],
  deltas: ReadonlyMap<string, { payload: MonitorParticipantPayload; receivedAtMs: number }>,
  snapshotAtMs: number,
): MonitorParticipantRow[] {
  if (deltas.size === 0) return [...base];
  return base.map((row) => {
    const delta = deltas.get(row.userId);
    if (!delta || delta.receivedAtMs <= snapshotAtMs) return row;
    return {
      ...row,
      readyState: delta.payload.readyState,
      connectionState: delta.payload.connectionState,
      presence: delta.payload.presence,
      lastSeenAt:
        delta.payload.lastSeenAt === null ? null : new Date(delta.payload.lastSeenAt).toISOString(),
    };
  });
}

/** What a participant's attempt is doing, as one word for a badge and a filter. */
export type AttemptPhase = "NOT_STARTED" | "WORKING" | "PAUSED" | "SUBMITTED" | "EXPIRED";

export function attemptPhase(row: MonitorParticipantRow): AttemptPhase {
  const attempt = row.attempt;
  if (attempt === null || attempt.status === "NOT_STARTED" || attempt.status === "RESET") {
    return "NOT_STARTED";
  }
  if (attempt.status === "IN_PROGRESS") return attempt.paused ? "PAUSED" : "WORKING";
  if (attempt.status === "EXPIRED" && row.submission === null) return "EXPIRED";
  return "SUBMITTED";
}

export type MonitorSummary = {
  total: number;
  notStarted: number;
  working: number;
  submitted: number;
  /** Mid-attempt and not on the workspace page: the ones to look up from the screen for. */
  away: number;
};

export function summarizeRows(rows: readonly MonitorParticipantRow[]): MonitorSummary {
  const summary: MonitorSummary = { total: 0, notStarted: 0, working: 0, submitted: 0, away: 0 };
  for (const row of rows) {
    summary.total += 1;
    const phase = attemptPhase(row);
    if (phase === "NOT_STARTED") summary.notStarted += 1;
    else if (phase === "WORKING" || phase === "PAUSED") {
      summary.working += 1;
      if (row.presence !== "HERE") summary.away += 1;
    } else summary.submitted += 1;
  }
  return summary;
}

/** The anti-cheat events worth flagging a card for. Connection events are not. */
const FLAGGED: ReadonlySet<AssessmentEventType> = new Set(["FOCUS_LOST", "CLIPBOARD_BLOCKED"]);

/** How many anti-cheat events each Coder has in the feed the monitor holds. */
export function flagCounts(events: readonly MonitorEventPayload[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.userId === null || !FLAGGED.has(event.type)) continue;
    counts.set(event.userId, (counts.get(event.userId) ?? 0) + 1);
  }
  return counts;
}

export type MonitorFilter = "ALL" | "ATTENTION" | "NOT_STARTED" | "WORKING" | "SUBMITTED";
export type MonitorSort = "NAME" | "STATUS" | "TIME_LEFT" | "SCORE";

/**
 * Whether a row needs the Architect: away from an attempt that is running, or
 * flagged by anti-cheat. Neither is an accusation — a disconnect is never a
 * penalty — but both are the reason someone supervising would walk over.
 */
export function needsAttention(row: MonitorParticipantRow, flags: number): boolean {
  const phase = attemptPhase(row);
  const active = phase === "WORKING" || phase === "PAUSED";
  return (active && row.presence !== "HERE") || flags > 0;
}

const PHASE_ORDER: Readonly<Record<AttemptPhase, number>> = {
  WORKING: 0,
  PAUSED: 1,
  NOT_STARTED: 2,
  SUBMITTED: 3,
  EXPIRED: 4,
};

export function selectRows(
  rows: readonly MonitorParticipantRow[],
  options: {
    search: string;
    filter: MonitorFilter;
    sort: MonitorSort;
    flags: ReadonlyMap<string, number>;
  },
): MonitorParticipantRow[] {
  const needle = options.search.trim().toLowerCase();
  const picked = rows.filter((row) => {
    if (
      needle !== "" &&
      !row.displayName.toLowerCase().includes(needle) &&
      !row.username.toLowerCase().includes(needle)
    ) {
      return false;
    }
    const phase = attemptPhase(row);
    switch (options.filter) {
      case "ALL":
        return true;
      case "ATTENTION":
        return needsAttention(row, options.flags.get(row.userId) ?? 0);
      case "NOT_STARTED":
        return phase === "NOT_STARTED";
      case "WORKING":
        return phase === "WORKING" || phase === "PAUSED";
      case "SUBMITTED":
        return phase === "SUBMITTED" || phase === "EXPIRED";
    }
  });

  const byName = (a: MonitorParticipantRow, b: MonitorParticipantRow) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });

  return picked.sort((a, b) => {
    switch (options.sort) {
      case "NAME":
        return byName(a, b);
      case "STATUS":
        return PHASE_ORDER[attemptPhase(a)] - PHASE_ORDER[attemptPhase(b)] || byName(a, b);
      case "TIME_LEFT": {
        // Least time first: those are the attempts about to be taken from them.
        const left = (row: MonitorParticipantRow) =>
          row.attempt?.remainingMs ?? Number.POSITIVE_INFINITY;
        return left(a) - left(b) || byName(a, b);
      }
      case "SCORE": {
        // Highest first, ungraded last.
        const score = (row: MonitorParticipantRow) => row.submission?.score ?? -1;
        return score(b) - score(a) || byName(a, b);
      }
    }
  });
}
