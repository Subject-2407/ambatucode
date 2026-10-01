import "server-only";
import { REDIS_KEYS, errorFields } from "@ambatucode/shared";
import { getRedis } from "../redis";
import { log } from "../logger";

/**
 * Which of these users have Ambatucode open on any page right now.
 *
 * apps/realtime holds the sockets and writes one Redis set per user; apps/web
 * only asks whether that set exists. It never decides presence itself — the
 * process that can see the connection is the only one that may vouch for it.
 *
 * A Redis failure answers "nobody", which reads as offline rather than as an
 * error page: presence is a hint for the Architect, and the readiness board
 * must still load when the hint cannot be had.
 */
export async function platformOnline(userIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (userIds.length === 0) return new Set();
  try {
    const pipeline = getRedis().pipeline();
    for (const userId of userIds) pipeline.exists(REDIS_KEYS.presence(userId));
    const results = (await pipeline.exec()) ?? [];
    const online = new Set<string>();
    results.forEach(([error, value], index) => {
      const userId = userIds[index];
      if (error === null && value === 1 && userId !== undefined) online.add(userId);
    });
    return online;
  } catch (error) {
    log.warn("presence.lookup_failed", errorFields(error));
    return new Set();
  }
}
