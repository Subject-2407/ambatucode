import { Redis } from "ioredis";
import { getEnv } from "./env";

/**
 * Socket.IO's Redis adapter needs a dedicated pub/sub pair, and the
 * application's own channels need a third connection: a client in subscriber
 * mode cannot issue ordinary commands. One subscriber carries every
 * application channel — they are dispatched by name on arrival.
 */
export type RealtimeRedis = {
  pub: Redis;
  sub: Redis;
  events: Redis;
};

export function createRedisClients(): RealtimeRedis {
  const url = getEnv().REDIS_URL;
  const options = { maxRetriesPerRequest: null };

  const pub = new Redis(url, options);
  const sub = pub.duplicate();
  const events = pub.duplicate();

  for (const [name, client] of Object.entries({ pub, sub, events })) {
    client.on("error", (error: Error) => {
      console.error(`[redis:${name}] ${error.message}`);
    });
  }

  return { pub, sub, events };
}
