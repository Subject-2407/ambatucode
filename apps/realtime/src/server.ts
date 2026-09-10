import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";
import { prisma } from "@ambatucode/db";
import {
  CLIENT_EVENTS,
  REDIS_CHANNELS,
  SERVER_EVENTS,
  attemptHeartbeatPayloadSchema,
  executionStatusMessageSchema,
  rooms,
  sessionRevokedMessageSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from "@ambatucode/shared";
import { authenticateHandshake } from "./auth";
import { getEnv } from "./env";
import { createRedisClients, type RealtimeRedis } from "./redis";

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Writing lastSeenAt on every heartbeat would be a write every 10 seconds. */
const LAST_SEEN_REFRESH_MS = 60_000;

function handleHealth(request: IncomingMessage, response: ServerResponse): void {
  if (request.url !== "/health") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Not found" } }));
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok: true,
      data: { status: "ok", service: "realtime", serverTimeMs: Date.now() },
    }),
  );
}

export type RealtimeServer = {
  io: AppServer;
  httpServer: HttpServer;
  redis: RealtimeRedis;
  listen: (port: number) => Promise<number>;
  close: () => Promise<void>;
};

export function createRealtimeServer(): RealtimeServer {
  const env = getEnv();
  const redis = createRedisClients();
  const httpServer = createServer(handleHealth);

  const io: AppServer = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: env.REALTIME_CORS_ORIGIN, credentials: true },
    adapter: createAdapter(redis.pub, redis.sub),
  });

  // Every handshake is authenticated against the same session row apps/web
  // issued. An unauthenticated socket never reaches a single event handler.
  io.use((socket, next) => {
    authenticateHandshake(socket.request.headers.cookie)
      .then((data) => {
        if (!data) {
          next(new Error("UNAUTHENTICATED"));
          return;
        }
        socket.data = data;
        next();
      })
      .catch((error: unknown) => {
        console.error("[realtime] handshake failed:", error);
        next(new Error("INTERNAL"));
      });
  });

  const lastSeenWrites = new Map<string, number>();

  async function refreshLastSeen(sessionId: string): Promise<void> {
    const now = Date.now();
    const previous = lastSeenWrites.get(sessionId) ?? 0;
    if (now - previous < LAST_SEEN_REFRESH_MS) return;

    lastSeenWrites.set(sessionId, now);
    try {
      await prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { lastSeenAt: new Date(now) },
      });
    } catch (error) {
      console.error("[realtime] failed to refresh lastSeenAt:", error);
    }
  }

  io.on("connection", (socket: AppSocket) => {
    const { userId, sessionId } = socket.data;

    // Personal room: submission status and account-level notifications.
    void socket.join(rooms.user(userId));

    socket.on(CLIENT_EVENTS.ATTEMPT_HEARTBEAT, (payload, ack) => {
      const parsed = attemptHeartbeatPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, code: "VALIDATION_FAILED", message: "Invalid heartbeat payload" });
        return;
      }

      // Heartbeats are liveness only. They are never written to
      // AssessmentEvent — doing so would bury the meaningful entries in the
      // monitoring feed.
      void refreshLastSeen(sessionId);
      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      lastSeenWrites.delete(sessionId);
    });
  });

  function handleSessionRevoked(raw: unknown): void {
    const message = sessionRevokedMessageSchema.safeParse(raw);
    if (!message.success) {
      console.error("[realtime] session:revoked message failed validation");
      return;
    }

    // A session can die while its socket is still open — a login from another
    // device, a logout elsewhere, a Root deactivation. The socket goes with it.
    const revoked = new Set(message.data.sessionIds);
    for (const socket of io.of("/").sockets.values()) {
      if (revoked.has(socket.data.sessionId)) {
        socket.disconnect(true);
      }
    }
  }

  /**
   * apps/web decided both what to say and who may hear it; this only routes.
   * The payload is re-validated anyway — apps/realtime forwards it straight to
   * a browser, so a malformed message must die here rather than downstream.
   */
  function handleExecutionStatus(raw: unknown): void {
    const message = executionStatusMessageSchema.safeParse(raw);
    if (!message.success) {
      console.error("[realtime] execution:status message failed validation");
      return;
    }

    io.to(rooms.user(message.data.userId)).emit(
      SERVER_EVENTS.SUBMISSION_STATUS,
      message.data.payload,
    );
  }

  const CHANNEL_HANDLERS: Record<string, (raw: unknown) => void> = {
    [REDIS_CHANNELS.SESSION_REVOKED]: handleSessionRevoked,
    [REDIS_CHANNELS.EXECUTION_STATUS]: handleExecutionStatus,
  };

  for (const channel of Object.keys(CHANNEL_HANDLERS)) {
    void redis.events.subscribe(channel, (error) => {
      if (error) {
        console.error(`[realtime] failed to subscribe to ${channel}:`, error.message);
      }
    });
  }

  redis.events.on("message", (channel: string, raw: string) => {
    const handler = CHANNEL_HANDLERS[channel];
    if (!handler) return;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      console.error(`[realtime] ${channel} message was not valid JSON`);
      return;
    }

    handler(parsedJson);
  });

  return {
    io,
    httpServer,
    redis,
    listen: (port: number) =>
      new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          const address = httpServer.address();
          resolve(typeof address === "object" && address !== null ? address.port : port);
        });
      }),
    close: async () => {
      await io.close();
      await Promise.allSettled([redis.pub.quit(), redis.sub.quit(), redis.events.quit()]);
    },
  };
}
