import { z } from "zod";
import {
  achievementAwardedPayloadSchema,
  attemptAutoSubmittedPayloadSchema,
  leaderboardUpdatePayloadSchema,
  monitorEventPayloadSchema,
  monitorParticipantPayloadSchema,
  sessionStartedPayloadSchema,
  sessionStatePayloadSchema,
  submissionStatusPayloadSchema,
} from "./realtime-events";

/** Redis pub/sub channels shared by apps/web and apps/realtime. */
export const REDIS_CHANNELS = {
  /** Emitted on login supersede and logout so live sockets can be dropped. */
  SESSION_REVOKED: "ambatucode:session:revoked",
  /** Emitted when an execution job changes state, for delivery to its owner. */
  EXECUTION_STATUS: "ambatucode:execution:status",
  /** Assessment lifecycle changes apps/web made, for apps/realtime to fan out. */
  ASSESSMENT_BROADCAST: "ambatucode:assessment:broadcast",
  /** Awards and leaderboard refreshes, published after grading. */
  GAMIFICATION: "ambatucode:gamification",
} as const;

export const sessionRevokedMessageSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
  reason: z.string().min(1),
});

export type SessionRevokedMessage = z.infer<typeof sessionRevokedMessageSchema>;

/**
 * apps/web owns the execution pipeline but holds no sockets, and apps/realtime
 * holds the sockets but never touches the queue. This message is the seam:
 * apps/web says who the result belongs to, apps/realtime decides which room
 * that is.
 *
 * The recipient travels here rather than inside the job payload on purpose —
 * an execution job carries no user id, so a compromised worker learns nothing
 * about who submitted the code it is running.
 */
export const executionStatusMessageSchema = z.object({
  userId: z.string().min(1),
  payload: submissionStatusPayloadSchema,
});

export type ExecutionStatusMessage = z.infer<typeof executionStatusMessageSchema>;

/**
 * Everything apps/web changes about a running assessment that some socket has
 * to hear about: a session starting or ending, an attempt closing, an event for
 * the monitor feed.
 *
 * apps/web names the subject (a session, a user) and apps/realtime turns that
 * into rooms, the same division as `execution:status`. Changes apps/realtime
 * makes itself — pauses, resumes, connection events — never come through here;
 * it emits those directly.
 */
export const assessmentBroadcastMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SESSION_STARTED"), payload: sessionStartedPayloadSchema }),
  z.object({ type: z.literal("SESSION_STATE"), payload: sessionStatePayloadSchema }),
  z.object({ type: z.literal("MONITOR_EVENT"), payload: monitorEventPayloadSchema }),
  z.object({ type: z.literal("MONITOR_PARTICIPANT"), payload: monitorParticipantPayloadSchema }),
  z.object({
    type: z.literal("ATTEMPT_AUTO_SUBMITTED"),
    userId: z.string().min(1),
    attemptId: z.string().min(1),
    payload: attemptAutoSubmittedPayloadSchema,
  }),
  /** The attempt left IN_PROGRESS. Its sockets get a fresh `attempt:state`. */
  z.object({
    type: z.literal("ATTEMPT_CLOSED"),
    userId: z.string().min(1),
    attemptId: z.string().min(1),
  }),
]);

export type AssessmentBroadcastMessage = z.infer<typeof assessmentBroadcastMessageSchema>;

/**
 * Gamification, which apps/web computes after grading and apps/realtime
 * delivers.
 *
 * An award is addressed to one Coder; a leaderboard refresh is addressed to a
 * scope, and apps/realtime turns that into the rooms watching it. Same
 * division as the two channels above: apps/web names the subject, apps/realtime
 * names the rooms.
 *
 * A leaderboard whose assessment sets `hideLeaderboard` is never published —
 * suppression happens at the source, so a message on this channel is always
 * safe to fan out.
 */
export const gamificationMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ACHIEVEMENT_AWARDED"),
    userId: z.string().min(1),
    payload: achievementAwardedPayloadSchema,
  }),
  z.object({
    type: z.literal("LEADERBOARD_UPDATE"),
    payload: leaderboardUpdatePayloadSchema,
  }),
]);

export type GamificationMessage = z.infer<typeof gamificationMessageSchema>;
