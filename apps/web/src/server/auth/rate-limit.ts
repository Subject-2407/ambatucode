import "server-only";
import { getRedis } from "../redis";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Fixed-window counter. INCR plus a first-write EXPIRE is atomic enough here:
 * the worst case is a window that starts slightly early, which never lets more
 * than `max` attempts through.
 */
export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const namespaced = `ratelimit:${key}`;

  const count = await redis.incr(namespaced);
  if (count === 1) {
    await redis.expire(namespaced, windowSeconds);
  }

  const ttl = await redis.ttl(namespaced);
  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;

  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    retryAfterSeconds,
  };
}

export async function clearRateLimit(key: string): Promise<void> {
  await getRedis().del(`ratelimit:${key}`);
}
