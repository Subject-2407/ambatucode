import { z } from "zod";

/** Redis pub/sub channels shared by apps/web and apps/realtime. */
export const REDIS_CHANNELS = {
  /** Emitted on login supersede and logout so live sockets can be dropped. */
  SESSION_REVOKED: "ambatucode:session:revoked",
} as const;

export const sessionRevokedMessageSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1),
  reason: z.string().min(1),
});

export type SessionRevokedMessage = z.infer<typeof sessionRevokedMessageSchema>;
