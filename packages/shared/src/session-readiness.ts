import type { ConnectionState, ReadyState } from "./enums";
import type { SessionCounts } from "./realtime-events";

export type ReadinessRow = {
  isListed: boolean;
  readyState: ReadyState;
  connectionState: ConnectionState;
};

/**
 * The readiness board's numbers, counted over the participant list only.
 *
 * A Coder who joined an open session is tracked but was never invited, so they
 * cannot make a session look more or less ready than its list. The buckets are
 * exclusive: offline wins over a stale READY, because a Coder who is not
 * connected cannot start when the Architect presses Start.
 */
export function countReadiness(rows: readonly ReadinessRow[]): SessionCounts {
  const counts: SessionCounts = { ready: 0, notReady: 0, offline: 0, total: 0 };
  for (const row of rows) {
    if (!row.isListed) continue;
    counts.total += 1;
    if (row.connectionState === "OFFLINE") counts.offline += 1;
    else if (row.readyState === "READY") counts.ready += 1;
    else counts.notReady += 1;
  }
  return counts;
}

export function everyoneReady(counts: SessionCounts): boolean {
  return counts.total > 0 && counts.ready === counts.total;
}
