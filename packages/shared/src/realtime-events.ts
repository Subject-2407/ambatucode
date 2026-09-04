import { z } from "zod";
import type {
  AssessmentEventType,
  AssessmentSessionStatus,
  AttemptStatus,
  ConnectionState,
  Language,
  ReadyState,
  SubmissionStatus,
} from "./enums";

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
  language: z.string().min(1),
  sourceCode: z.string(),
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
export type AttemptAutoSubmittedPayload = { submissionId: string };
export type AttemptWarningPayload = { code: string; message: string };
export type AttemptSupersededPayload = Record<string, never>;

export type SessionCounts = { ready: number; notReady: number; offline: number; total: number };
export type SessionStatePayload = {
  sessionId: string;
  status: AssessmentSessionStatus;
  endsAt: number | null;
  counts: SessionCounts;
};
export type SessionStartedPayload = { sessionId: string; endsAt: number; serverTimeMs: number };

export type SubmissionStatusPayload = {
  submissionId: string;
  status: SubmissionStatus;
  score?: number | null;
};

export type MonitorParticipantPayload = {
  sessionId: string;
  userId: string;
  displayName: string;
  readyState: ReadyState;
  connectionState: ConnectionState;
  lastSeenAt: number | null;
};

export type MonitorEventPayload = {
  id: string;
  sessionId: string;
  userId: string | null;
  attemptId: string | null;
  type: AssessmentEventType;
  durationMs: number | null;
  occurredAt: number;
};

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
