import "server-only";
import { Redis } from "ioredis";
import { getServerEnv } from "./env";

/**
 * Three long-lived Redis connections per process:
 *
 * - `getRedis()`      general commands (rate limiting, caches)
 * - `getPublisher()`  pub/sub publishes
 * - `getSubscriber()` reserved for apps/realtime; a subscribed connection
 *                     cannot issue ordinary commands, so it must stay separate
 *
 * BullMQ opens its own connections and is wired in server/queue/producer.ts.
 */
const globalForRedis = globalThis as unknown as {
  ambatucodeRedis?: Redis;
  ambatucodeRedisPublisher?: Redis;
};

function createClient(): Redis {
  const client = new Redis(getServerEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on("error", (error: Error) => {
    console.error("[redis] connection error:", error.message);
  });
  return client;
}

export function getRedis(): Redis {
  globalForRedis.ambatucodeRedis ??= createClient();
  return globalForRedis.ambatucodeRedis;
}

export function getPublisher(): Redis {
  globalForRedis.ambatucodeRedisPublisher ??= createClient();
  return globalForRedis.ambatucodeRedisPublisher;
}

/** Closes the shared connections. Used by graceful shutdown and by tests. */
export async function closeRedis(): Promise<void> {
  await Promise.all([
    globalForRedis.ambatucodeRedis?.quit(),
    globalForRedis.ambatucodeRedisPublisher?.quit(),
  ]);
  globalForRedis.ambatucodeRedis = undefined;
  globalForRedis.ambatucodeRedisPublisher = undefined;
}
