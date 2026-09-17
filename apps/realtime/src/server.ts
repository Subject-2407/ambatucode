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
  errorFields,
  CLIENT_EVENTS,
  REDIS_CHANNELS,
  SERVER_EVENTS,
  assessmentBroadcastMessageSchema,
  attemptHeartbeatPayloadSchema,
  executionStatusMessageSchema,
  gamificationMessageSchema,
  leaderboardJoinPayloadSchema,
  rooms,
  sessionRevokedMessageSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type LeaderboardJoinPayload,
  type ServerToClientEvents,
  type SocketData,
} from "@ambatucode/shared";
import { createAssessmentRuntime } from "./assessment";
import { authenticateHandshake } from "./auth";
import { createDeadlineRuntime, type DeadlineRuntime } from "./deadlines";
import { getEnv } from "./env";
import { createRedisClients, type RealtimeRedis } from "./redis";
import { createWebClient, type WebClient } from "./web-client";
import { log } from "./logger";

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

async function probe(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

/**
 * Two health endpoints, because they answer different questions.
 *
 * `/health` is liveness: the process is up and its event loop is turning. A
 * failure here means restart me. It never touches PostgreSQL or Redis — a
 * database blip must not get every socket server in the deployment killed.
 *
 * `/health/ready` is readiness: this instance can actually serve. It checks
 * its dependencies and answers 503 when one is down, which takes it out of a
 * load balancer's rotation without taking the process down with it.
 */
function handleHealth(
  redis: RealtimeRedis,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const path = (request.url ?? "").split("?")[0];

  function send(status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  if (path === "/health") {
    send(200, {
      ok: true,
      data: { status: "ok", service: "realtime", serverTimeMs: Date.now() },
    });
    return;
  }

  if (path === "/health/ready") {
    void Promise.all([
      probe(() => prisma.$queryRaw`SELECT 1`),
      probe(() => redis.pub.ping()),
    ]).then(([database, cache]) => {
      const status = database && cache ? "ok" : "degraded";
      send(status === "ok" ? 200 : 503, {
        ok: status === "ok",
        data: { status, service: "realtime", database, redis: cache, serverTimeMs: Date.now() },
      });
    });
    return;
  }

  send(404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
}

export type RealtimeServer = {
  io: AppServer;
  httpServer: HttpServer;
  redis: RealtimeRedis;
  deadlines: DeadlineRuntime;
  listen: (port: number) => Promise<number>;
  close: () => Promise<void>;
};

export type RealtimeServerOptions = {
  /** Replaces the HTTP client to apps/web. Tests pass a fake. */
  web?: WebClient;
  disconnectDebounceMs?: number;
  tickIntervalMs?: number;
  sweepIntervalMs?: number;
};

/**
 * Whether this socket may watch a leaderboard.
 *
 * Resolved to the Module the board belongs to and answered with the same rule
 * the HTTP read uses: an approved Coder, or the Architect who owns the Module.
 * Root is refused outright — a leaderboard is grading data, and the SRS puts
 * that outside Root's reach wherever it appears.
 *
 * A board switched off by its Architect is never published, so this does not
 * re-check `hideLeaderboard`; there is nothing to deliver either way.
 */
async function canWatchLeaderboard(
  data: SocketData,
  payload: LeaderboardJoinPayload,
): Promise<boolean> {
  if (data.role === "ROOT") return false;

  let moduleId: string | null = null;
  switch (payload.scope) {
    case "MODULE":
      moduleId = payload.scopeId;
      break;
    case "SECTION": {
      const section = await prisma.section.findUnique({
        where: { id: payload.scopeId },
        select: { moduleId: true },
      });
      moduleId = section?.moduleId ?? null;
      break;
    }
    case "ASSESSMENT": {
      const assessment = await prisma.assessment.findUnique({
        where: { id: payload.scopeId },
        select: { section: { select: { moduleId: true } } },
      });
      moduleId = assessment?.section.moduleId ?? null;
      break;
    }
  }
  if (moduleId === null) return false;

  if (data.role === "ARCHITECT") {
    const owned = await prisma.module.count({ where: { id: moduleId, ownerId: data.userId } });
    return owned > 0;
  }

  const enrolled = await prisma.moduleEnrollment.count({
    where: { moduleId, userId: data.userId, status: "APPROVED" },
  });
  return enrolled > 0;
}

export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServer {
  const env = getEnv();
  const redis = createRedisClients();
  const httpServer = createServer((request, response) => {
    handleHealth(redis, request, response);
  });
  const web =
    options.web ??
    createWebClient({ baseUrl: env.WEB_INTERNAL_URL, secret: env.INTERNAL_API_SECRET });
  const deadlines = createDeadlineRuntime({
    connection: redis.pub,
    web,
    ...(options.sweepIntervalMs === undefined ? {} : { sweepIntervalMs: options.sweepIntervalMs }),
  });

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
        log.error("handshake.failed", errorFields(error));
        next(new Error("INTERNAL"));
      });
  });

  const assessments = createAssessmentRuntime({
    io,
    deadlines,
    web,
    ...(options.disconnectDebounceMs === undefined
      ? {}
      : { disconnectDebounceMs: options.disconnectDebounceMs }),
    ...(options.tickIntervalMs === undefined ? {} : { tickIntervalMs: options.tickIntervalMs }),
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
      log.warn("session.last_seen_refresh_failed", { sessionId, ...errorFields(error) });
    }
  }

  io.on("connection", (socket: AppSocket) => {
    const { userId, sessionId } = socket.data;

    // Personal room: submission status and account-level notifications.
    void socket.join(rooms.user(userId));
    assessments.register(socket);

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

    socket.on(CLIENT_EVENTS.LEADERBOARD_JOIN, (payload, ack) => {
      const parsed = leaderboardJoinPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, code: "VALIDATION_FAILED", message: "Invalid leaderboard payload" });
        return;
      }

      canWatchLeaderboard(socket.data, parsed.data)
        .then((allowed) => {
          if (!allowed) {
            ack?.({ ok: false, code: "FORBIDDEN", message: "You cannot watch this leaderboard" });
            return;
          }
          void socket.join(rooms.leaderboard(parsed.data.scope, parsed.data.scopeId));
          ack?.({ ok: true });
        })
        .catch((error: unknown) => {
          log.error("leaderboard.join_failed", { ...parsed.data, ...errorFields(error) });
          ack?.({ ok: false, code: "INTERNAL", message: "Could not join the leaderboard" });
        });
    });

    socket.on(CLIENT_EVENTS.LEADERBOARD_LEAVE, (payload, ack) => {
      const parsed = leaderboardJoinPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, code: "VALIDATION_FAILED", message: "Invalid leaderboard payload" });
        return;
      }
      void socket.leave(rooms.leaderboard(parsed.data.scope, parsed.data.scopeId));
      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      lastSeenWrites.delete(sessionId);
    });
  });

  function handleSessionRevoked(raw: unknown): void {
    const message = sessionRevokedMessageSchema.safeParse(raw);
    if (!message.success) {
      log.error("channel.message_invalid", { channel: REDIS_CHANNELS.SESSION_REVOKED });
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
      log.error("channel.message_invalid", { channel: REDIS_CHANNELS.EXECUTION_STATUS });
      return;
    }

    io.to(rooms.user(message.data.userId)).emit(
      SERVER_EVENTS.SUBMISSION_STATUS,
      message.data.payload,
    );
  }

  /** Same contract as `execution:status`: apps/web names the subject, this picks the rooms. */
  function handleAssessmentBroadcast(raw: unknown): void {
    const message = assessmentBroadcastMessageSchema.safeParse(raw);
    if (!message.success) {
      log.error("channel.message_invalid", { channel: REDIS_CHANNELS.ASSESSMENT_BROADCAST });
      return;
    }
    assessments.handleBroadcast(message.data).catch((error: unknown) => {
      log.error("channel.handling_failed", {
        channel: REDIS_CHANNELS.ASSESSMENT_BROADCAST,
        ...errorFields(error),
      });
    });
  }

  /**
   * Awards go to the Coder who earned one; a refreshed board goes to whoever
   * joined that board's room, and joining was authorized when they did.
   *
   * apps/web suppresses a hidden leaderboard at the source, so anything that
   * arrives here is safe to fan out — this routes, it does not re-decide.
   */
  function handleGamification(raw: unknown): void {
    const message = gamificationMessageSchema.safeParse(raw);
    if (!message.success) {
      log.error("channel.message_invalid", { channel: REDIS_CHANNELS.GAMIFICATION });
      return;
    }

    if (message.data.type === "ACHIEVEMENT_AWARDED") {
      io.to(rooms.user(message.data.userId)).emit(
        SERVER_EVENTS.ACHIEVEMENT_AWARDED,
        message.data.payload,
      );
      return;
    }

    const { scope, scopeId } = message.data.payload;
    io.to(rooms.leaderboard(scope, scopeId)).emit(
      SERVER_EVENTS.LEADERBOARD_UPDATE,
      message.data.payload,
    );
  }

  const CHANNEL_HANDLERS: Record<string, (raw: unknown) => void> = {
    [REDIS_CHANNELS.SESSION_REVOKED]: handleSessionRevoked,
    [REDIS_CHANNELS.EXECUTION_STATUS]: handleExecutionStatus,
    [REDIS_CHANNELS.ASSESSMENT_BROADCAST]: handleAssessmentBroadcast,
    [REDIS_CHANNELS.GAMIFICATION]: handleGamification,
  };

  for (const channel of Object.keys(CHANNEL_HANDLERS)) {
    void redis.events.subscribe(channel, (error) => {
      if (error) {
        log.error("channel.subscribe_failed", { channel, errorMessage: error.message });
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
      log.error("channel.message_not_json", { channel });
      return;
    }

    handler(parsedJson);
  });

  return {
    io,
    httpServer,
    redis,
    deadlines,
    listen: (port: number) =>
      new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          const address = httpServer.address();
          resolve(typeof address === "object" && address !== null ? address.port : port);
        });
      }),
    close: async () => {
      assessments.close();
      await deadlines.close();
      await io.close();
      await Promise.allSettled([redis.pub.quit(), redis.sub.quit(), redis.events.quit()]);
    },
  };
}
