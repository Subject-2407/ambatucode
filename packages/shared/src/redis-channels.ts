import { z } from "zod";
import { submissionStatusPayloadSchema } from "./realtime-events";

/** Redis pub/sub channels shared by apps/web and apps/realtime. */
export const REDIS_CHANNELS = {
  /** Emitted on login supersede and logout so live sockets can be dropped. */
  SESSION_REVOKED: "ambatucode:session:revoked",
  /** Emitted when an execution job changes state, for delivery to its owner. */
  EXECUTION_STATUS: "ambatucode:execution:status",
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
