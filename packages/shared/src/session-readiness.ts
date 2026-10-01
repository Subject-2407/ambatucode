import type { ConnectionState, PARTICIPANT_PRESENCES, ReadyState, SessionAccess } from "./enums";
import type { SessionCounts } from "./realtime-events";

/**
 * Who a session is waiting for, and whether they are there.
 *
 * Readiness used to be counted over the participant list alone. A session open
 * to the whole Module has no list, so it had nobody to count: the Coders never
 * got a ready control, "wait until everyone is ready" waited for no one, and
 * Start went straight through. The roster below is the fix — every session that
 * can be started has a set of Coders it expects, written down or not.
 */

/**
 * Where a session's roster comes from.
 *
 * - LIST: the Coders the Architect chose. Only they may take part.
 * - MODULE: every Coder with an approved enrollment, read at the moment of
 *   asking, so a Coder approved after the session was created is expected too.
 * - NONE: nobody is expected. Either the Architect chose "only these Coders"
 *   and has not chosen any yet, or this is the implicit open-access session,
 *   which has no lobby and is never started by hand.
 */
export type RosterSource = "LIST" | "MODULE" | "NONE";

export function rosterSource(input: {
  access: SessionAccess;
  isOpenAccess: boolean;
  listedCount: number;
}): RosterSource {
  if (input.isOpenAccess) return "NONE";
  if (input.access === "MODULE") return "MODULE";
  return input.listedCount > 0 ? "LIST" : "NONE";
}

/**
 * Where a participant is, as precisely as the platform can tell.
 *
 * - HERE: on this session's own page — its lobby or its workspace.
 * - ELSEWHERE: signed in with Ambatucode open, but on some other page.
 * - OFFLINE: no open connection at all.
 *
 * The middle state is the one the board used to get wrong. A Coder reading a
 * Material while the Architect waited showed as offline, which they were not;
 * telling the Architect "online, not on the assessment page" is what lets them
 * say "open the assessment" rather than "check your Wi-Fi".
 */
export type ParticipantPresence = (typeof PARTICIPANT_PRESENCES)[number];

export function presenceOf(input: {
  connectionState: ConnectionState;
  platformOnline: boolean;
}): ParticipantPresence {
  if (input.connectionState === "ONLINE") return "HERE";
  return input.platformOnline ? "ELSEWHERE" : "OFFLINE";
}

export type ReadinessRow = {
  onRoster: boolean;
  readyState: ReadyState;
  presence: ParticipantPresence;
};

/**
 * The readiness board's numbers, counted over the roster only.
 *
 * A Coder who walked into a session they were not expected at is tracked but
 * cannot make it look more or less ready. The buckets are exclusive:
 *
 * - ready: on the session's page and has said so;
 * - not ready: connected, but either has not said so or is on another page —
 *   a READY left behind on a page they navigated away from is not readiness;
 * - offline: not connected at all, whatever they last said.
 */
export function countReadiness(rows: readonly ReadinessRow[]): SessionCounts {
  const counts: SessionCounts = { ready: 0, notReady: 0, offline: 0, total: 0 };
  for (const row of rows) {
    if (!row.onRoster) continue;
    counts.total += 1;
    if (row.presence === "OFFLINE") counts.offline += 1;
    else if (row.presence === "HERE" && row.readyState === "READY") counts.ready += 1;
    else counts.notReady += 1;
  }
  return counts;
}

export function everyoneReady(counts: SessionCounts): boolean {
  return counts.total > 0 && counts.ready === counts.total;
}

/**
 * One participant's readiness, by the same rule the counts use, for showing
 * beside a name. Kept beside `countReadiness` so the badge and the number can
 * never disagree about the same Coder.
 */
export type ReadinessState = "READY" | "NOT_READY" | "ELSEWHERE" | "OFFLINE";

export function readinessStateOf(row: {
  readyState: ReadyState;
  presence: ParticipantPresence;
}): ReadinessState {
  if (row.presence === "OFFLINE") return "OFFLINE";
  if (row.presence === "ELSEWHERE") return "ELSEWHERE";
  return row.readyState === "READY" ? "READY" : "NOT_READY";
}
