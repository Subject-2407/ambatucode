import { Redis } from "ioredis";
import { getEnv } from "./env";

/**
 * Socket.IO's Redis adapter needs a dedicated pub/sub pair, and the
 * `session:revoked` listener needs a third connection: a client in subscriber
 * mode cannot issue ordinary commands.
 */
export type RealtimeRedis = {
  pub: Redis;
  sub: Redis;
  revocationSub: Redis;
};

export function createRedisClients(): RealtimeRedis {
  const url = getEnv().REDIS_URL;
  const options = { maxRetriesPerRequest: null };

  const pub = new Redis(url, options);
  const sub = pub.duplicate();
  const revocationSub = pub.duplicate();

  for (const [name, client] of Object.entries({ pub, sub, revocationSub })) {
    client.on("error", (error: Error) => {
      console.error(`[redis:${name}] ${error.message}`);
    });
  }

  return { pub, sub, revocationSub };
}
