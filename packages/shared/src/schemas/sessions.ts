import { z } from "zod";
import {
  EXECUTION_MODES,
  SESSION_ACCESS_MODES,
  type AssessmentSessionStatus,
  type AttemptStatus,
  type ConnectionState,
  type ExecutionMode,
  type ReadyState,
  type SessionAccess,
  type SubmissionStatus,
} from "../enums";
import type { MonitorEventPayload, SessionCounts } from "../realtime-events";
import { durationMinutesSchema } from "./assessments";

/**
 * Assessment Sessions: one concrete execution of an Assessment for a group of
 * Coders.
 *
 * A session carries its own execution mode and duration, copied from the
 * Assessment when it is created and adjustable before it starts, so the same
 * Assessment can run as a 30-minute Live session for one class and a
 * 45-minute Individual session for another without being edited.
 */

export const sessionNameSchema = z.string().trim().min(1).max(160);

/**
 * Omitted fields inherit from the Assessment. An untimed Assessment only ever
 * produces untimed sessions, so the service refuses timing sent for one.
 */
export const createSessionRequestSchema = z.object({
  name: sessionNameSchema,
  executionMode: z.enum(EXECUTION_MODES).optional(),
  durationMinutes: durationMinutesSchema.optional(),
  /**
   * MODULE opens the session to every enrolled Coder even once a participant
   * list exists. LISTED, the default, keeps the older rule: no list means
   * everyone, a list means only those on it.
   */
  access: z.enum(SESSION_ACCESS_MODES).optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

/**
 * Only the statuses an Architect sets by hand. RUNNING and ENDED are reached
 * through start and end, which carry rules a plain patch would skip.
 */
export const EDITABLE_SESSION_STATUSES = ["DRAFT", "READY", "CANCELLED"] as const;

export const updateSessionRequestSchema = z
  .object({
    name: sessionNameSchema,
    executionMode: z.enum(EXECUTION_MODES),
    durationMinutes: durationMinutesSchema,
    status: z.enum(EDITABLE_SESSION_STATUSES),
    access: z.enum(SESSION_ACCESS_MODES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

export const MAX_SESSION_PARTICIPANTS = 1_000;

/**
 * Replaces the whole participant list. `ALL_ENROLLED` snapshots the Module's
 * approved Coders at the moment of the call; it does not follow later
 * enrollments, because a list that changed under a running session would
 * change who the warning at start was about.
 *
 * An empty SELECTED list clears the list, which reopens an Individual or
 * Untimed session to every enrolled Coder.
 */
export const replaceParticipantsRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ALL_ENROLLED") }),
  z.object({
    mode: z.literal("SELECTED"),
    userIds: z
      .array(z.string().min(1).max(64))
      .max(MAX_SESSION_PARTICIPANTS)
      .refine((values) => new Set(values).size === values.length, {
        message: "Participants must be unique",
      }),
  }),
]);
export type ReplaceParticipantsRequest = z.infer<typeof replaceParticipantsRequestSchema>;

export const startSessionRequestSchema = z.object({
  /** Start even though not every listed participant is ready. */
  force: z.boolean().default(false),
});
export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>;

// --- Views ------------------------------------------------------------------

export type SessionView = {
  id: string;
  assessmentId: string;
  moduleId: string;
  name: string;
  executionMode: ExecutionMode | null;
  durationMinutes: number | null;
  status: AssessmentSessionStatus;
  startedAt: string | null;
  endsAt: string | null;
  startedWithMissingParticipants: boolean;
  access: SessionAccess;
  /** The implicit always-open session behind an open-access Assessment. */
  isOpenAccess: boolean;
  /** Listed participants only — Coders who joined an open session are not a list. */
  listedParticipantCount: number;
  /** True while a participant list exists and therefore limits who may start. */
  isRestricted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ParticipantView = {
  userId: string;
  username: string;
  displayName: string;
  isListed: boolean;
  readyState: ReadyState;
  connectionState: ConnectionState;
  lastSeenAt: string | null;
};

export type ReadinessView = {
  sessionId: string;
  status: AssessmentSessionStatus;
  counts: SessionCounts;
  participants: ParticipantView[];
};

/**
 * Starting with missing participants is allowed but never silent. Without
 * `force` the server answers with the counts instead of starting, and the
 * Architect decides with the numbers in front of them.
 */
export type StartSessionResponse =
  | { started: true; session: SessionView }
  | {
      started: false;
      warning: { code: "PARTICIPANTS_NOT_READY"; message: string; counts: SessionCounts };
    };

export type MonitorParticipantRow = ParticipantView & {
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    remainingMs: number | null;
    paused: boolean;
  } | null;
  submission: {
    id: string;
    status: SubmissionStatus;
    score: number | null;
    isAutoSubmitted: boolean;
    submittedAt: string;
  } | null;
};

/** What the monitor room is seeded with before the live feed takes over. */
export type MonitorSnapshot = {
  session: SessionView;
  counts: SessionCounts;
  participants: MonitorParticipantRow[];
  /** Newest last, capped. The socket feed continues from here. */
  events: MonitorEventPayload[];
  serverTimeMs: number;
};
