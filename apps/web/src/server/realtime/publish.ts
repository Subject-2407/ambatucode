import "server-only";
import { REDIS_CHANNELS, type SessionRevokedMessage } from "@ambatucode/shared";
import { getPublisher } from "../redis";

/**
 * apps/web owns the session table but not the sockets. When a session dies it
 * announces the fact on Redis so apps/realtime can drop any socket still
 * holding that session id.
 */
export async function publishSessionRevoked(message: SessionRevokedMessage): Promise<void> {
  if (message.sessionIds.length === 0) return;
  try {
    await getPublisher().publish(REDIS_CHANNELS.SESSION_REVOKED, JSON.stringify(message));
  } catch (error) {
    // A dropped notification must not fail the login or logout that caused it.
    // The socket is still rejected on its next authenticated action.
    console.error("[realtime] failed to publish session:revoked:", error);
  }
}
