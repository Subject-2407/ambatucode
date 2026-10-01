import type { Redis } from "ioredis";
import { PRESENCE_KEY_TTL_SECONDS, REDIS_KEYS } from "@ambatucode/shared";

/**
 * Whether a user has Ambatucode open anywhere, across every realtime instance.
 *
 * One Redis set per user holding their socket ids. A set rather than a counter
 * because a counter that an instance increments and then crashes before
 * decrementing is wrong forever; a set with a TTL that only live instances
 * refresh empties itself instead.
 *
 * Only transitions are reported — first socket in, last socket out — since
 * those are the only moments an Architect's board has anything new to show.
 */
export type PlatformPresence = {
  /** True when this socket is the user's first. */
  add(userId: string, socketId: string): Promise<boolean>;
  /** True when this socket was the user's last. */
  remove(userId: string, socketId: string): Promise<boolean>;
  /** Keeps the keys of users this instance still holds sockets for alive. */
  refresh(userIds: readonly string[]): Promise<void>;
  online(userIds: readonly string[]): Promise<ReadonlySet<string>>;
};

export function createPlatformPresence(redis: Redis): PlatformPresence {
  return {
    async add(userId, socketId) {
      const key = REDIS_KEYS.presence(userId);
      const results = await redis
        .multi()
        .sadd(key, socketId)
        .expire(key, PRESENCE_KEY_TTL_SECONDS)
        .scard(key)
        .exec();
      return results?.[2]?.[1] === 1;
    },

    async remove(userId, socketId) {
      const key = REDIS_KEYS.presence(userId);
      const results = await redis.multi().srem(key, socketId).scard(key).exec();
      return results?.[1]?.[1] === 0;
    },

    async refresh(userIds) {
      if (userIds.length === 0) return;
      const pipeline = redis.pipeline();
      for (const userId of userIds) {
        pipeline.expire(REDIS_KEYS.presence(userId), PRESENCE_KEY_TTL_SECONDS);
      }
      await pipeline.exec();
    },

    async online(userIds) {
      if (userIds.length === 0) return new Set();
      const pipeline = redis.pipeline();
      for (const userId of userIds) pipeline.exists(REDIS_KEYS.presence(userId));
      const results = (await pipeline.exec()) ?? [];
      const present = new Set<string>();
      results.forEach(([error, value], index) => {
        const userId = userIds[index];
        if (error === null && value === 1 && userId !== undefined) present.add(userId);
      });
      return present;
    },
  };
}
