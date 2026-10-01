import type { AssessmentEventType, MonitorEventPayload } from "@ambatucode/shared";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Combines the live feed with the HTTP snapshot's backlog: newest first, each
 * event once, at most `limit` of them.
 *
 * The two overlap whenever an event lands between the snapshot being read and
 * the monitor room being joined, so an event can arrive both ways. It is one
 * event, and the Architect should see it once.
 */
export function mergeEvents(
  live: readonly MonitorEventPayload[],
  snapshot: readonly MonitorEventPayload[],
  limit: number,
): MonitorEventPayload[] {
  const byId = new Map<string, MonitorEventPayload>();
  for (const event of [...snapshot, ...live]) byId.set(event.id, event);
  return [...byId.values()]
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, limit);
}

// --- Reading an event ---------------------------------------------------------

/**
 * The four things an Architect asks of a session's log. Grouped because a
 * single stream of sixteen event types, a hundred Coders deep, is a wall: the
 * question is usually "who left the window", not "everything, in order".
 */
export type EventCategory = "CONNECTION" | "ANTI_CHEAT" | "ATTEMPT" | "SESSION";

export const EVENT_CATEGORY: Readonly<Record<AssessmentEventType, EventCategory>> = {
  SESSION_STARTED: "SESSION",
  SESSION_ENDED: "SESSION",
  ATTEMPT_STARTED: "ATTEMPT",
  ATTEMPT_SUBMITTED: "ATTEMPT",
  ATTEMPT_AUTO_SUBMITTED: "ATTEMPT",
  ATTEMPT_EXPIRED: "ATTEMPT",
  ATTEMPT_RESET: "ATTEMPT",
  TIMER_PAUSED: "ATTEMPT",
  TIMER_RESUMED: "ATTEMPT",
  CONNECTED: "CONNECTION",
  DISCONNECTED: "CONNECTION",
  RECONNECTED: "CONNECTION",
  FOCUS_LOST: "ANTI_CHEAT",
  FOCUS_REGAINED: "ANTI_CHEAT",
  CLIPBOARD_BLOCKED: "ANTI_CHEAT",
};

export const EVENT_CATEGORY_LABEL: Readonly<Record<EventCategory, string>> = {
  CONNECTION: "Connection",
  ANTI_CHEAT: "Anti-cheat",
  ATTEMPT: "Attempts",
  SESSION: "Session",
};

const EVENT_LABEL: Readonly<Record<AssessmentEventType, string>> = {
  SESSION_STARTED: "Session started",
  SESSION_ENDED: "Session ended",
  ATTEMPT_STARTED: "Started",
  ATTEMPT_SUBMITTED: "Submitted",
  ATTEMPT_AUTO_SUBMITTED: "Auto-submitted",
  ATTEMPT_EXPIRED: "Closed, nothing submitted",
  CONNECTED: "Connected",
  DISCONNECTED: "Disconnected",
  RECONNECTED: "Reconnected",
  FOCUS_LOST: "Left the window",
  FOCUS_REGAINED: "Back in the window",
  CLIPBOARD_BLOCKED: "Clipboard blocked",
  TIMER_PAUSED: "Timer paused",
  TIMER_RESUMED: "Timer resumed",
  ATTEMPT_RESET: "Attempt reset",
};

/**
 * A disconnect is a logged fact, not an accusation: Wi-Fi drops, laptops
 * sleep, and the SRS is explicit that a disconnect is never an automatic
 * cheating penalty. So connection events read as information, and only the
 * anti-cheat events carry a warning colour — and even those say what was
 * observed, never what it meant.
 */
const EVENT_TONE: Readonly<Record<AssessmentEventType, BadgeTone>> = {
  SESSION_STARTED: "info",
  SESSION_ENDED: "neutral",
  ATTEMPT_STARTED: "info",
  ATTEMPT_SUBMITTED: "success",
  ATTEMPT_AUTO_SUBMITTED: "success",
  ATTEMPT_EXPIRED: "warning",
  CONNECTED: "neutral",
  DISCONNECTED: "neutral",
  RECONNECTED: "neutral",
  FOCUS_LOST: "warning",
  FOCUS_REGAINED: "neutral",
  CLIPBOARD_BLOCKED: "warning",
  TIMER_PAUSED: "neutral",
  TIMER_RESUMED: "neutral",
  ATTEMPT_RESET: "info",
};

/** "45s", "3m 05s", "1h 02m": how long something lasted, in the fewest words. */
export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function ordinal(count: number): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 13) return `${String(count)}th`;
  switch (count % 10) {
    case 1:
      return `${String(count)}st`;
    case 2:
      return `${String(count)}nd`;
    case 3:
      return `${String(count)}rd`;
    default:
      return `${String(count)}th`;
  }
}

const CLIPBOARD_ACTION: Readonly<Record<string, string>> = {
  COPY: "Tried to copy",
  CUT: "Tried to cut",
  PASTE: "Tried to paste",
  CONTEXT_MENU: "Opened the right-click menu",
};

const AUTO_SUBMIT_REASON: Readonly<Record<string, string>> = {
  DEADLINE: "Time ran out",
  FOCUS_LOSS: "Left the window too often",
  SESSION_ENDED: "The session was ended",
};

export type EventDescription = {
  category: EventCategory;
  label: string;
  tone: BadgeTone;
  /** The small facts that make the entry readable, or null when there are none. */
  detail: string | null;
};

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * One event as a line an Architect can read without knowing the event model.
 *
 * Every way of going away is logged as DISCONNECTED — the SRS treats them
 * alike, and so does the grade — but "walked to another page" and "the
 * connection dropped" read very differently, and the payload knows which.
 */
export function describeEvent(event: MonitorEventPayload): EventDescription {
  const { payload } = event;
  const base = {
    category: EVENT_CATEGORY[event.type],
    label: EVENT_LABEL[event.type],
    tone: EVENT_TONE[event.type],
  };
  const away = event.durationMs === null ? null : `Away for ${formatSpan(event.durationMs)}`;

  switch (event.type) {
    case "SESSION_STARTED": {
      const ready = num(payload.ready);
      const total = num(payload.total);
      const count =
        ready === null || total === null ? null : `${String(ready)}/${String(total)} ready`;
      return {
        ...base,
        detail:
          payload.forced === true ? `Started anyway · ${count ?? "not everyone ready"}` : count,
      };
    }
    case "SESSION_ENDED":
      return {
        ...base,
        detail:
          payload.reason === "DEADLINE"
            ? "Time ran out"
            : payload.reason === "ENDED_BY_ARCHITECT"
              ? "Ended by the Architect"
              : null,
      };
    case "ATTEMPT_AUTO_SUBMITTED":
      return { ...base, detail: AUTO_SUBMIT_REASON[str(payload.reason) ?? ""] ?? null };
    case "ATTEMPT_EXPIRED":
      return {
        ...base,
        detail: payload.reason === "NEVER_STARTED" ? "Never started" : "No code saved to submit",
      };
    case "ATTEMPT_RESET": {
      const reason = str(payload.reason);
      return { ...base, detail: reason === null || reason === "" ? "New attempt opened" : reason };
    }
    case "TIMER_PAUSED": {
      const used = num(payload.consumedMs);
      return { ...base, detail: used === null ? null : `${formatSpan(used)} used so far` };
    }
    case "TIMER_RESUMED":
      return { ...base, detail: away };
    case "DISCONNECTED":
      switch (payload.reason) {
        case "LEFT":
          return { ...base, label: "Left the workspace", detail: "Went to another page" };
        case "LOST":
          return { ...base, label: "Connection lost", detail: "The browser stopped answering" };
        case "SUPERSEDED":
          return { ...base, label: "Moved device", detail: "Opened in another browser" };
        default:
          return { ...base, detail: null };
      }
    case "RECONNECTED":
      return {
        ...base,
        detail: payload.superseded === true ? "On another browser or device" : null,
      };
    case "FOCUS_LOST": {
      const count = num(payload.count);
      const action =
        payload.action === "WARN"
          ? " · warned"
          : payload.action === "AUTO_SUBMIT"
            ? " · auto-submitted"
            : "";
      return { ...base, detail: count === null ? null : `${ordinal(count)} time${action}` };
    }
    case "FOCUS_REGAINED":
      return { ...base, detail: away };
    case "CLIPBOARD_BLOCKED":
      return { ...base, detail: CLIPBOARD_ACTION[str(payload.action) ?? ""] ?? null };
    default:
      return { ...base, detail: null };
  }
}

export type EventFilter = { category: EventCategory | "ALL"; userId: string | null };

export function filterEvents(
  events: readonly MonitorEventPayload[],
  filter: EventFilter,
): MonitorEventPayload[] {
  return events.filter(
    (event) =>
      (filter.category === "ALL" || EVENT_CATEGORY[event.type] === filter.category) &&
      (filter.userId === null || event.userId === filter.userId),
  );
}

/** How many events each category holds, for the counts on its filter. */
export function countByCategory(
  events: readonly MonitorEventPayload[],
): Readonly<Record<EventCategory | "ALL", number>> {
  const counts = { ALL: 0, CONNECTION: 0, ANTI_CHEAT: 0, ATTEMPT: 0, SESSION: 0 };
  for (const event of events) {
    counts.ALL += 1;
    counts[EVENT_CATEGORY[event.type]] += 1;
  }
  return counts;
}
