import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@ambatucode/db";
import {
  CLIENT_EVENTS,
  REDIS_CHANNELS,
  type Ack,
  type SessionRevokedMessage,
} from "@ambatucode/shared";
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "@ambatucode/shared/auth/session-token";
import { createRealtimeServer, type RealtimeServer } from "./server";

/**
 * Boots the real server and drives it with a real client, because the
 * interesting behaviour lives in the handshake middleware and the pub/sub
 * listener — neither is reachable from a plain HTTP probe. The Engine.IO
 * transport handshake succeeds regardless of authentication; only the
 * namespace connection that follows is rejected.
 */

const suffix = randomBytes(4).toString("hex");
const username = `rtitest_${suffix}`;

let server: RealtimeServer;
let port: number;
let publisher: Redis;
let userId: string;
let sessionId: string;
let token: string;

function clientFor(cookie: string | null): ClientSocket {
  return connect(`http://localhost:${port}`, {
    path: "/socket.io",
    transports: ["polling"],
    reconnection: false,
    ...(cookie === null ? {} : { extraHeaders: { cookie } }),
  });
}

function sessionCookie(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (error: Error) => reject(error));
  });
}

function waitForDisconnect(socket: ClientSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket was not disconnected")), 10_000);
    socket.once("disconnect", (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

beforeAll(async () => {
  server = createRealtimeServer();
  port = await server.listen(0);
  publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: "unused-in-this-spec",
      displayName: "Realtime Integration Coder",
      role: "CODER",
    },
    select: { id: true },
  });
  userId = user.id;

  token = generateSessionToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });
  sessionId = session.id;
});

afterAll(async () => {
  await server.close();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await publisher.quit();
});

describe("handshake authentication", () => {
  it("rejects a socket with no session cookie", async () => {
    const socket = clientFor(null);
    await expect(waitForConnect(socket)).rejects.toThrow(/UNAUTHENTICATED/);
    socket.close();
  });

  it("rejects a session token that does not exist", async () => {
    const socket = clientFor(sessionCookie(generateSessionToken()));
    await expect(waitForConnect(socket)).rejects.toThrow(/UNAUTHENTICATED/);
    socket.close();
  });

  it("rejects a revoked session", async () => {
    const revokedToken = generateSessionToken();
    const revoked = await prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(revokedToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: new Date(),
        revokedReason: "SUPERSEDED",
      },
      select: { id: true },
    });

    const socket = clientFor(sessionCookie(revokedToken));
    await expect(waitForConnect(socket)).rejects.toThrow(/UNAUTHENTICATED/);
    socket.close();

    await prisma.session.delete({ where: { id: revoked.id } });
  });

  it("rejects an expired session", async () => {
    const expiredToken = generateSessionToken();
    const expired = await prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(expiredToken),
        expiresAt: new Date(Date.now() - 1_000),
      },
      select: { id: true },
    });

    const socket = clientFor(sessionCookie(expiredToken));
    await expect(waitForConnect(socket)).rejects.toThrow(/UNAUTHENTICATED/);
    socket.close();

    await prisma.session.delete({ where: { id: expired.id } });
  });

  it("accepts a live session and places the socket in its user room", async () => {
    const socket = clientFor(sessionCookie(token));
    await waitForConnect(socket);

    const roomSockets = await server.io.in(`user:${userId}`).fetchSockets();
    expect(roomSockets).toHaveLength(1);
    expect(roomSockets[0]?.data.userId).toBe(userId);
    expect(roomSockets[0]?.data.sessionId).toBe(sessionId);

    socket.close();
  });
});

describe("heartbeat", () => {
  it("acks a valid heartbeat and rejects a malformed one", async () => {
    const socket = clientFor(sessionCookie(token));
    await waitForConnect(socket);

    const good = await socket.emitWithAck(CLIENT_EVENTS.ATTEMPT_HEARTBEAT, {
      attemptId: "attempt-1",
    });
    expect(good).toEqual({ ok: true });

    // Deliberately wrong shape: payloads arrive from the browser and are
    // validated, never trusted.
    const bad = (await socket.emitWithAck(CLIENT_EVENTS.ATTEMPT_HEARTBEAT, {
      attemptId: 42,
    })) as Ack;
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.code).toBe("VALIDATION_FAILED");

    socket.close();
  });

  it("never records a heartbeat as an assessment event", async () => {
    const socket = clientFor(sessionCookie(token));
    await waitForConnect(socket);
    await socket.emitWithAck(CLIENT_EVENTS.ATTEMPT_HEARTBEAT, { attemptId: "attempt-1" });

    expect(await prisma.assessmentEvent.count({ where: { userId } })).toBe(0);

    socket.close();
  });
});

describe("session:revoked", () => {
  it("drops a live socket whose session was revoked elsewhere", async () => {
    const socket = clientFor(sessionCookie(token));
    await waitForConnect(socket);

    const disconnected = waitForDisconnect(socket);

    const message: SessionRevokedMessage = {
      sessionIds: [sessionId],
      userId,
      reason: "SUPERSEDED",
    };
    await publisher.publish(REDIS_CHANNELS.SESSION_REVOKED, JSON.stringify(message));

    await expect(disconnected).resolves.toBeTruthy();
    socket.close();
  });

  it("leaves unrelated sockets connected", async () => {
    const socket = clientFor(sessionCookie(token));
    await waitForConnect(socket);

    await publisher.publish(
      REDIS_CHANNELS.SESSION_REVOKED,
      JSON.stringify({ sessionIds: ["some-other-session"], userId, reason: "LOGOUT" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(socket.connected).toBe(true);
    socket.close();
  });
});
