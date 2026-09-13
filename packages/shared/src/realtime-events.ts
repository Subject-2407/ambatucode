import { z } from "zod";
import {
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_SESSION_STATUSES,
  CONNECTION_STATES,
  LANGUAGES,
  READY_STATES,
  SUBMISSION_STATUSES,
} from "./enums";
import type { AttemptStatus, Language } from "./enums";

/**
 * The single source of truth for Socket.IO event names and payloads. Never
 * write an event name as a bare string in application code — import from here
 * so a rename is a compile error rather than a silent dead listener.
 */

export const CLIENT_EVENTS = {
  ATTEMPT_JOIN: "attempt:join",
  ATTEMPT_HEARTBEAT: "attempt:heartbeat",
  ATTEMPT_READY: "attempt:ready",
  ATTEMPT_DRAFT: "attempt:draft",
  ANTICHEAT_FOCUS: "anticheat:focus",
  ANTICHEAT_CLIPBOARD: "anticheat:clipboard",
  MONITOR_JOIN: "monitor:join",
} as const;

export const SERVER_EVENTS = {
  ATTEMPT_STATE: "attempt:state",
  ATTEMPT_TICK: "attempt:tick",
  ATTEMPT_PAUSED: "attempt:paused",
  ATTEMPT_RESUMED: "attempt:resumed",
  ATTEMPT_AUTO_SUBMITTED: "attempt:auto_submitted",
  ATTEMPT_WARNING: "attempt:warning",
  ATTEMPT_SUPERSEDED: "attempt:superseded",
  SESSION_STATE: "session:state",
  SESSION_STARTED: "session:started",
  SUBMISSION_STATUS: "submission:status",
  MONITOR_PARTICIPANT: "monitor:participant",
  MONITOR_EVENT: "monitor:event",
  LEADERBOARD_UPDATE: "leaderboard:update",
} as const;

// --- Room names -------------------------------------------------------------

export const rooms = {
  user: (userId: string) => `user:${userId}` as const,
  session: (sessionId: string) => `session:${sessionId}` as const,
  monitor: (sessionId: string) => `monitor:${sessionId}` as const,
};

// --- Client -> server payloads (validated on arrival) -----------------------

export const attemptJoinPayloadSchema = z.object({ attemptId: z.string().min(1) });
export const attemptHeartbeatPayloadSchema = z.object({ attemptId: z.string().min(1) });
export const attemptReadyPayloadSchema = z.object({
  sessionId: z.string().min(1),
  ready: z.boolean(),
});
export const attemptDraftPayloadSchema = z.object({
  attemptId: z.string().min(1),
  language: z.enum(LANGUAGES),
  sourceCode: z.string().max(200_000),
});
export const anticheatFocusPayloadSchema = z.object({
  attemptId: z.string().min(1),
  state: z.enum(["LOST", "REGAINED"]),
});
export const anticheatClipboardPayloadSchema = z.object({
  attemptId: z.string().min(1),
  action: z.enum(["COPY", "PASTE", "CUT", "CONTEXT_MENU"]),
});
export const monitorJoinPayloadSchema = z.object({ sessionId: z.string().min(1) });

export type AttemptJoinPayload = z.infer<typeof attemptJoinPayloadSchema>;
export type AttemptHeartbeatPayload = z.infer<typeof attemptHeartbeatPayloadSchema>;
export type AttemptReadyPayload = z.infer<typeof attemptReadyPayloadSchema>;
export type AttemptDraftPayload = z.infer<typeof attemptDraftPayloadSchema>;
export type AnticheatFocusPayload = z.infer<typeof anticheatFocusPayloadSchema>;
export type AnticheatClipboardPayload = z.infer<typeof anticheatClipboardPayloadSchema>;
export type MonitorJoinPayload = z.infer<typeof monitorJoinPayloadSchema>;

/** Every client event is acked so the browser can surface a rejection. */
export type Ack = { ok: true } | { ok: false; code: string; message: string };
export type AckFn = (result: Ack) => void;

// --- Server -> client payloads ----------------------------------------------

export type AttemptStatePayload = {
  attemptId: string;
  sessionId: string;
  status: AttemptStatus;
  language: Language | null;
  sourceCode: string | null;
  deadlineMs: number | null;
  remainingMs: number | null;
  consumedMs: number;
  paused: boolean;
  serverTimeMs: number;
};

export type AttemptTickPayload = { remainingMs: number; serverTimeMs: number };
export type AttemptPausedPayload = { consumedMs: number };
export type AttemptResumedPayload = { consumedMs: number };
export const attemptAutoSubmittedPayloadSchema = z.object({ submissionId: z.string().min(1) });
export type AttemptAutoSubmittedPayload = z.infer<typeof attemptAutoSubmittedPayloadSchema>;
export type AttemptWarningPayload = { code: string; message: string };
export type AttemptSupersededPayload = Record<string, never>;

/**
 * The payloads below are schemas rather than bare types because they cross a
 * process boundary: apps/web publishes them on Redis and apps/realtime forwards
 * them to browsers, so a shape apps/web did not promise must die on arrival.
 */

/**
 * Mutually exclusive, so they add up to the listed total: a participant who is
 * offline counts as offline whatever their last readiness was, because a
 * "ready" Coder who is not connected is not ready.
 */
export const sessionCountsSchema = z.object({
  ready: z.number().int().nonnegative(),
  notReady: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type SessionCounts = z.infer<typeof sessionCountsSchema>;

export const sessionStatePayloadSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(ASSESSMENT_SESSION_STATUSES),
  endsAt: z.number().nullable(),
  counts: sessionCountsSchema,
});
export type SessionStatePayload = z.infer<typeof sessionStatePayloadSchema>;

/** `endsAt` is null for Individual and Untimed sessions, which have no global clock. */
export const sessionStartedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  endsAt: z.number().nullable(),
  serverTimeMs: z.number(),
});
export type SessionStartedPayload = z.infer<typeof sessionStartedPayloadSchema>;

/**
 * One public test case as a Coder is allowed to see it.
 *
 * There is deliberately no `expectedOutput` and no test case id: a Run shows a
 * Coder how their own program behaved, not what the grader was holding. Weight
 * is absent for the same reason — a Run produces no grade.
 */
export const runTestResultViewSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  executionTimeMs: z.number().nonnegative(),
  stdoutExcerpt: z.string(),
  stderrExcerpt: z.string(),
});
export type RunTestResultView = z.infer<typeof runTestResultViewSchema>;

/**
 * Pipeline progress for the job a Coder is waiting on, discriminated by kind
 * because the two halves may carry very different amounts of detail.
 *
 * A RUN writes no database row, so this event is the only delivery path for
 * its output and has to carry the per-case results itself. Every case in a RUN
 * is public by construction — the producer rejects a RUN payload containing a
 * hidden case — so there is nothing here to strip.
 *
 * A SUBMIT deliberately carries status and score only. Its per-case detail
 * lives behind `GET /api/submissions/[submissionId]`, where the Coder-facing
 * serializer removes hidden rows. Sending that detail over the socket would
 * mean re-implementing the same filter in a second place, and getting it wrong
 * there would leak grading data.
 *
 * This is validated at runtime rather than merely typed: it crosses a Redis
 * pub/sub boundary between two processes, and apps/realtime must not forward a
 * shape apps/web did not promise.
 */
export const submissionStatusPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SUBMIT"),
    jobId: z.string().min(1),
    submissionId: z.string().min(1),
    status: z.enum(SUBMISSION_STATUSES),
    score: z.number().int().min(0).max(100).nullable(),
  }),
  z.object({
    kind: z.literal("RUN"),
    jobId: z.string().min(1),
    submissionId: z.null(),
    status: z.enum(SUBMISSION_STATUSES),
    testResults: z.array(runTestResultViewSchema),
    compilerOutput: z.string().nullable(),
  }),
]);
export type SubmissionStatusPayload = z.infer<typeof submissionStatusPayloadSchema>;

export const monitorParticipantPayloadSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string(),
  readyState: z.enum(READY_STATES),
  connectionState: z.enum(CONNECTION_STATES),
  lastSeenAt: z.number().nullable(),
});
export type MonitorParticipantPayload = z.infer<typeof monitorParticipantPayloadSchema>;

/**
 * One meaningful event for the Architect's feed. `payload` carries the small
 * facts that make an entry readable — the focus-loss action taken, the
 * clipboard action blocked — and never participant source code.
 */
export const monitorEventPayloadSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().nullable(),
  attemptId: z.string().nullable(),
  type: z.enum(ASSESSMENT_EVENT_TYPES),
  durationMs: z.number().nullable(),
  occurredAt: z.number(),
  payload: z.record(z.string(), z.unknown()),
});
export type MonitorEventPayload = z.infer<typeof monitorEventPayloadSchema>;

export type LeaderboardRow = {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  submittedAt: number | null;
};
export type LeaderboardUpdatePayload = { scopeId: string; rows: LeaderboardRow[] };

// --- Typed socket maps -------------------------------------------------------

export type ClientToServerEvents = {
  [CLIENT_EVENTS.ATTEMPT_JOIN]: (payload: AttemptJoinPayload, ack?: AckFn) => void;
  [CLIENT_EVENTS.ATTEMPT_HEARTBEAT]: (payload: AttemptHeartbeatPayload, ack?: AckFn) => void;
  [CLIENT_EVENTS.ATTEMPT_READY]: (payload: AttemptReadyPayload, ack?: AckFn) => void;
  [CLIENT_EVENTS.ATTEMPT_DRAFT]: (payload: AttemptDraftPayload, ack?: AckFn) => void;
  [CLIENT_EVENTS.ANTICHEAT_FOCUS]: (payload: AnticheatFocusPayload, ack?: AckFn) => void;
  [CLIENT_EVENTS.ANTICHEAT_CLIPBOARD]: (payload: AnticheatClipboardPayload, ack?: AckFn) => void;
  [CLIENT_EVENTS.MONITOR_JOIN]: (payload: MonitorJoinPayload, ack?: AckFn) => void;
};

export type ServerToClientEvents = {
  [SERVER_EVENTS.ATTEMPT_STATE]: (payload: AttemptStatePayload) => void;
  [SERVER_EVENTS.ATTEMPT_TICK]: (payload: AttemptTickPayload) => void;
  [SERVER_EVENTS.ATTEMPT_PAUSED]: (payload: AttemptPausedPayload) => void;
  [SERVER_EVENTS.ATTEMPT_RESUMED]: (payload: AttemptResumedPayload) => void;
  [SERVER_EVENTS.ATTEMPT_AUTO_SUBMITTED]: (payload: AttemptAutoSubmittedPayload) => void;
  [SERVER_EVENTS.ATTEMPT_WARNING]: (payload: AttemptWarningPayload) => void;
  [SERVER_EVENTS.ATTEMPT_SUPERSEDED]: (payload: AttemptSupersededPayload) => void;
  [SERVER_EVENTS.SESSION_STATE]: (payload: SessionStatePayload) => void;
  [SERVER_EVENTS.SESSION_STARTED]: (payload: SessionStartedPayload) => void;
  [SERVER_EVENTS.SUBMISSION_STATUS]: (payload: SubmissionStatusPayload) => void;
  [SERVER_EVENTS.MONITOR_PARTICIPANT]: (payload: MonitorParticipantPayload) => void;
  [SERVER_EVENTS.MONITOR_EVENT]: (payload: MonitorEventPayload) => void;
  [SERVER_EVENTS.LEADERBOARD_UPDATE]: (payload: LeaderboardUpdatePayload) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  userId: string;
  role: "ROOT" | "ARCHITECT" | "CODER";
  sessionId: string;
};

/** Heartbeat cadence the client is expected to honour. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** Timer correction cadence pushed to participants. */
export const TICK_INTERVAL_MS = 5_000;
/** A reload should not look like an incident — debounce before logging. */
export const DISCONNECT_DEBOUNCE_MS = 3_000;
