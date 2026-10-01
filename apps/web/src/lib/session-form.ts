import {
  createSessionRequestSchema,
  sessionRuleProblem,
  updateSessionRequestSchema,
  type CreateSessionRequest,
  type ExecutionMode,
  type SessionAccess,
  type SessionView,
  type UpdateSessionRequest,
} from "@ambatucode/shared";

/**
 * The session settings form, as plain data, and the requests it turns into.
 *
 * Kept out of the dialog so the rules about what may be sent — no timing for
 * an untimed assessment, no closing time for a live session, a closing time
 * only checked against the clock when it is the thing being changed — are
 * tested once rather than re-derived in two dialogs.
 */

export type SessionForm = {
  name: string;
  access: SessionAccess;
  executionMode: ExecutionMode;
  /** As typed: held as a string so the field can be emptied mid-edit. */
  durationMinutes: string;
  /** A `datetime-local` value; empty means "no closing time". */
  closesAt: string;
  requireAllReady: boolean;
  /** Create only: open the lobby at once rather than saving a draft. */
  openLobby: boolean;
};

export type FormResult<T> = { ok: true; request: T } | { ok: false; error: string };

const pad = (value: number) => String(value).padStart(2, "0");

/** An ISO instant as the local wall-clock time a `datetime-local` input shows. */
export function toDateTimeLocal(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The input's local wall-clock time as an ISO instant, or null when empty. */
export function fromDateTimeLocal(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstIssue(issues: readonly { message: string }[]): string {
  return issues[0]?.message ?? "Check the fields above.";
}

export function buildCreateRequest(
  form: SessionForm,
  options: { timed: boolean; nowMs: number },
): FormResult<CreateSessionRequest> {
  const isLive = options.timed && form.executionMode === "LIVE";
  const closesAt = isLive ? null : fromDateTimeLocal(form.closesAt);
  if (!isLive && form.closesAt.trim() !== "" && closesAt === null) {
    return { ok: false, error: "The closing time is not a valid date" };
  }

  const rule = sessionRuleProblem({
    executionMode: options.timed ? form.executionMode : null,
    closesAt,
    requireAllReady: form.requireAllReady,
    nowMs: options.nowMs,
  });
  if (rule) return { ok: false, error: rule };

  const parsed = createSessionRequestSchema.safeParse({
    name: form.name,
    // An untimed Assessment only ever produces untimed sessions, and the
    // server refuses timing sent for one rather than ignoring it.
    ...(options.timed
      ? {
          executionMode: form.executionMode,
          durationMinutes: Number.parseInt(form.durationMinutes, 10),
        }
      : {}),
    access: form.access,
    closesAt,
    // Live always waits for the room; the server reads it from the mode too,
    // but the stored flag should not contradict what the session does.
    requireAllReady: isLive || form.requireAllReady,
    openLobby: form.openLobby,
  });
  return parsed.success
    ? { ok: true, request: parsed.data }
    : { ok: false, error: firstIssue(parsed.error.issues) };
}

/**
 * Only what changed, so an untouched closing time that has since passed does
 * not get judged against the clock — and so a rename never looks like a
 * timing change to a server that refuses timing on an untimed session.
 */
export function buildUpdateRequest(
  form: SessionForm,
  original: SessionView,
  options: { nowMs: number },
): FormResult<UpdateSessionRequest | null> {
  const timed = original.executionMode !== null;
  const isLive = timed && form.executionMode === "LIVE";
  const closesAt = isLive ? null : fromDateTimeLocal(form.closesAt);
  if (!isLive && form.closesAt.trim() !== "" && closesAt === null) {
    return { ok: false, error: "The closing time is not a valid date" };
  }

  const patch: Record<string, unknown> = {};
  if (form.name.trim() !== original.name) patch.name = form.name;
  if (timed) {
    if (form.executionMode !== original.executionMode) patch.executionMode = form.executionMode;
    const duration = Number.parseInt(form.durationMinutes, 10);
    if (duration !== original.durationMinutes) patch.durationMinutes = duration;
  }
  const originalClosing = original.closesAt === null ? null : new Date(original.closesAt).getTime();
  const nextClosing = closesAt === null ? null : new Date(closesAt).getTime();
  // Compared to the minute: the input cannot express seconds, so a stored
  // time with seconds would otherwise always look changed.
  const minute = (ms: number | null) => (ms === null ? null : Math.floor(ms / 60_000));
  const closingChanged = minute(originalClosing) !== minute(nextClosing);
  if (closingChanged) patch.closesAt = closesAt;
  const requireAllReady = isLive || form.requireAllReady;
  if (requireAllReady !== original.requireAllReady) patch.requireAllReady = requireAllReady;

  if (Object.keys(patch).length === 0) return { ok: true, request: null };

  const rule = sessionRuleProblem({
    executionMode: timed ? form.executionMode : null,
    closesAt,
    requireAllReady,
    ...(closingChanged ? { nowMs: options.nowMs } : {}),
  });
  if (rule) return { ok: false, error: rule };

  const parsed = updateSessionRequestSchema.safeParse(patch);
  return parsed.success
    ? { ok: true, request: parsed.data }
    : { ok: false, error: firstIssue(parsed.error.issues) };
}

export function formFromSession(session: SessionView): SessionForm {
  return {
    name: session.name,
    access: session.access,
    executionMode: session.executionMode ?? "INDIVIDUAL",
    durationMinutes: String(session.durationMinutes ?? 30),
    closesAt: toDateTimeLocal(session.closesAt),
    requireAllReady: session.requireAllReady,
    openLobby: session.status === "READY",
  };
}
