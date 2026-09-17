import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, type AssessmentEventType } from "@ambatucode/db";
import {
  CLIENT_EVENTS,
  REDIS_CHANNELS,
  SERVER_EVENTS,
  type Ack,
  type AssessmentBroadcastMessage,
  type AttemptStatePayload,
  type AttemptTickPayload,
  type AttemptWarningPayload,
  type MonitorEventPayload,
  type SessionStatePayload,
} from "@ambatucode/shared";
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "@ambatucode/shared/auth/session-token";
import { createRealtimeServer, type RealtimeServer } from "./server";
import type { WebClient } from "./web-client";

/**
 * The live half of an Assessment Session, driven by real sockets against the
 * real database. apps/web is replaced by a fake that records what it was asked
 * to do: whether an attempt gets closed is apps/web's decision, and this spec
 * is about when apps/realtime asks.
 */

const suffix = randomBytes(4).toString("hex");
const MINUTE = 60_000;
const DEBOUNCE_MS = 300;

let server: RealtimeServer;
let port: number;
let publisher: Redis;

const web = {
  autoSubmit: vi.fn<WebClient["autoSubmit"]>(() =>
    Promise.resolve({ outcome: "SUBMITTED", submissionId: null }),
  ),
  expireSession: vi.fn<WebClient["expireSession"]>(() => Promise.resolve({ outcome: "ENDED" })),
};

const userIds: string[] = [];
const attemptIds: string[] = [];
const sockets: ClientSocket[] = [];

let architect: { id: string; cookie: string };
let coderA: { id: string; cookie: string };
let coderB: { id: string; cookie: string };
let coderC: { id: string; cookie: string };
let moduleId: string;
let warnAssessmentId: string;
let autoAssessmentId: string;

async function makeUser(role: "ARCHITECT" | "CODER", name: string) {
  const user = await prisma.user.create({
    data: { username: `${name}_${suffix}`, passwordHash: "unused", displayName: name, role },
    select: { id: true },
  });
  userIds.push(user.id);
  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * MINUTE),
    },
  });
  return { id: user.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

/** A second live browser session for the same account — the "other device". */
async function secondCookieFor(userId: string): Promise<string> {
  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * MINUTE),
    },
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function client(cookie: string): Promise<ClientSocket> {
  const socket = connect(`http://localhost:${port}`, {
    path: "/socket.io",
    transports: ["polling"],
    reconnection: false,
    extraHeaders: { cookie },
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function send(socket: ClientSocket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack: Ack) => resolve(ack));
  });
}

function next<T>(socket: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ${event} within ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() - started > timeoutMs) throw new Error("condition was not met in time");
    await sleep(50);
  }
}

function eventTypes(attemptId: string): Promise<AssessmentEventType[]> {
  return prisma.assessmentEvent
    .findMany({ where: { attemptId }, orderBy: { occurredAt: "asc" }, select: { type: true } })
    .then((rows) => rows.map((row) => row.type));
}

async function makeSession(
  assessmentId: string,
  data: {
    executionMode: "INDIVIDUAL" | "LIVE" | null;
    status: "DRAFT" | "RUNNING";
    endsAt?: Date | null;
  },
) {
  return prisma.assessmentSession.create({
    data: {
      assessmentId,
      name: `Session ${randomBytes(2).toString("hex")}`,
      executionMode: data.executionMode,
      durationMinutes: data.executionMode === null ? null : 10,
      status: data.status,
      startedAt: data.status === "RUNNING" ? new Date() : null,
      endsAt: data.endsAt ?? null,
    },
    select: { id: true },
  });
}

async function makeAttempt(sessionId: string, userId: string, deadline: Date | null) {
  const attempt = await prisma.assessmentAttempt.create({
    data: {
      sessionId,
      userId,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      individualDeadlineAt: deadline,
      isOfficial: true,
    },
    select: { id: true },
  });
  attemptIds.push(attempt.id);
  return attempt.id;
}

beforeAll(async () => {
  server = createRealtimeServer({ web, disconnectDebounceMs: DEBOUNCE_MS, tickIntervalMs: 200 });
  port = await server.listen(0);
  publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

  architect = await makeUser("ARCHITECT", "RtArchitect");
  coderA = await makeUser("CODER", "RtCoderA");
  coderB = await makeUser("CODER", "RtCoderB");
  coderC = await makeUser("CODER", "RtCoderC");

  const assessmentBase = {
    title: "Realtime spec",
    orderIndex: 0,
    problemStatement: "Anything.",
    allowedLanguages: ["python"],
    timeMode: "TIMED" as const,
    durationMinutes: 10,
    executionMode: "INDIVIDUAL" as const,
    isPublished: true,
  };
  const module = await prisma.module.create({
    data: {
      title: `Realtime spec ${suffix}`,
      slug: `realtime-spec-${suffix}`,
      visibility: "PUBLIC",
      isPublished: true,
      ownerId: architect.id,
      sections: {
        create: {
          title: "Only",
          orderIndex: 0,
          assessments: {
            create: [
              {
                ...assessmentBase,
                antiCheatConfigJson: {
                  detectFocusLoss: true,
                  focusLossAction: "WARN",
                  focusLossThreshold: 1,
                  blockClipboard: true,
                },
              },
              {
                ...assessmentBase,
                orderIndex: 1,
                antiCheatConfigJson: { detectFocusLoss: true, focusLossAction: "AUTO_SUBMIT" },
              },
            ],
          },
        },
      },
    },
    select: {
      id: true,
      sections: {
        select: { assessments: { select: { id: true }, orderBy: { orderIndex: "asc" } } },
      },
    },
  });
  moduleId = module.id;
  const assessments = module.sections[0]?.assessments ?? [];
  warnAssessmentId = assessments[0]?.id ?? "";
  autoAssessmentId = assessments[1]?.id ?? "";
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  for (const attemptId of attemptIds) {
    await server.deadlines.cancel({ kind: "ATTEMPT", attemptId });
  }
  await server.close();
  await prisma.module.deleteMany({ where: { id: moduleId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  await publisher.quit();
});

// -----------------------------------------------------------------------------

describe("attempt connection", () => {
  it("binds a join, logs CONNECTED once, and sends the attempt state", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderA.id, new Date(Date.now() + 10 * MINUTE));

    const socket = await client(coderA.cookie);
    const state = next<AttemptStatePayload>(socket, SERVER_EVENTS.ATTEMPT_STATE);
    expect(await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId })).toEqual({ ok: true });
    const payload = await state;
    expect(payload.status).toBe("IN_PROGRESS");
    expect(payload.remainingMs).toBeGreaterThan(9 * MINUTE);

    expect(await eventTypes(attemptId)).toEqual(["CONNECTED"]);
    const participant = await prisma.assessmentParticipant.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: session.id, userId: coderA.id } },
    });
    expect(participant.connectionState).toBe("ONLINE");
    expect(participant.activeConnectionId).toBe(socket.id);
    // Joining an open session tracks the Coder without putting them on a list.
    expect(participant.isListed).toBe(false);
    socket.disconnect();
  });

  it("refuses another Coder's attempt", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderA.id, new Date(Date.now() + 10 * MINUTE));
    const intruder = await client(coderB.cookie);
    expect(await send(intruder, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    intruder.disconnect();
  });

  it("treats a rejoin inside the debounce window as a refresh and logs nothing", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderA.id, new Date(Date.now() + 10 * MINUTE));

    const before = await client(coderA.cookie);
    await send(before, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    before.disconnect();

    await sleep(50);
    const after = await client(coderA.cookie);
    await send(after, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    await sleep(DEBOUNCE_MS * 2);

    expect(await eventTypes(attemptId)).toEqual(["CONNECTED"]);
    const attempt = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.pausedAt).toBeNull();
    after.disconnect();
  });

  it("pauses an Individual clock at the disconnect and resumes it with the same time left", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const originalDeadline = Date.now() + 10 * MINUTE;
    const attemptId = await makeAttempt(session.id, coderA.id, new Date(originalDeadline));

    const socket = await client(coderA.cookie);
    await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    await sleep(200);

    const disconnectedAt = Date.now();
    socket.disconnect();

    const paused = await eventually(
      () => prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
      (attempt) => attempt.pausedAt !== null,
    );
    // Frozen at the disconnect, not at the end of the debounce window.
    expect(Math.abs((paused.pausedAt?.getTime() ?? 0) - disconnectedAt)).toBeLessThan(150);
    const expectedConsumed = 10 * MINUTE - (originalDeadline - disconnectedAt);
    expect(Math.abs(paused.consumedMs - expectedConsumed)).toBeLessThan(150);

    // Time away does not count.
    await sleep(800);

    const back = await client(coderA.cookie);
    const resumedAt = Date.now();
    await send(back, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    const resumed = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(resumed.pausedAt).toBeNull();
    const remaining = (resumed.individualDeadlineAt?.getTime() ?? 0) - resumedAt;
    expect(Math.abs(remaining - (10 * MINUTE - paused.consumedMs))).toBeLessThan(200);
    // The pause pushed the deadline out by the time spent away, no more.
    expect(resumed.individualDeadlineAt?.getTime() ?? 0).toBeGreaterThan(originalDeadline + 700);

    expect(await eventTypes(attemptId)).toEqual([
      "CONNECTED",
      "DISCONNECTED",
      "TIMER_PAUSED",
      "TIMER_RESUMED",
      "RECONNECTED",
    ]);
    back.disconnect();
  });

  it("never pauses a Live clock", async () => {
    const endsAt = new Date(Date.now() + 10 * MINUTE);
    const session = await makeSession(warnAssessmentId, {
      executionMode: "LIVE",
      status: "RUNNING",
      endsAt,
    });
    const attemptId = await makeAttempt(session.id, coderB.id, null);

    const socket = await client(coderB.cookie);
    await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    socket.disconnect();

    await eventually(
      () => eventTypes(attemptId),
      (types) => types.includes("DISCONNECTED"),
    );
    await sleep(DEBOUNCE_MS);
    expect(await eventTypes(attemptId)).toEqual(["CONNECTED", "DISCONNECTED"]);
    const attempt = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.pausedAt).toBeNull();
    expect(attempt.consumedMs).toBe(0);
  });

  it("supersedes the previous connection when the same Coder joins from another device", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderC.id, new Date(Date.now() + 10 * MINUTE));

    const laptop = await client(coderC.cookie);
    await send(laptop, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });

    const superseded = next<Record<string, never>>(laptop, SERVER_EVENTS.ATTEMPT_SUPERSEDED);
    const dropped = next<string>(laptop, "disconnect");
    const desktop = await client(await secondCookieFor(coderC.id));
    await send(desktop, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });

    await superseded;
    await dropped;
    await sleep(DEBOUNCE_MS * 2);

    expect(await eventTypes(attemptId)).toEqual(["CONNECTED", "DISCONNECTED", "RECONNECTED"]);
    const participant = await prisma.assessmentParticipant.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: session.id, userId: coderC.id } },
    });
    expect(participant.activeConnectionId).toBe(desktop.id);
    expect(participant.connectionState).toBe("ONLINE");
    const attempt = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.pausedAt).toBeNull();
    desktop.disconnect();
  });

  it("pushes timer corrections to the bound socket", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderB.id, new Date(Date.now() + 10 * MINUTE));
    const socket = await client(coderB.cookie);
    await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });

    const tick = await next<AttemptTickPayload>(socket, SERVER_EVENTS.ATTEMPT_TICK);
    expect(tick.remainingMs).toBeGreaterThan(9 * MINUTE);
    expect(tick.remainingMs).toBeLessThanOrEqual(10 * MINUTE);
    socket.disconnect();
  });

  it("saves a draft over the socket, and refuses one for a closed attempt", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderB.id, new Date(Date.now() + 10 * MINUTE));
    const socket = await client(coderB.cookie);

    expect(
      await send(socket, CLIENT_EVENTS.ATTEMPT_DRAFT, {
        attemptId,
        language: "java",
        sourceCode: "x",
      }),
    ).toMatchObject({ ok: false, code: "LANGUAGE_NOT_ALLOWED" });
    expect(
      await send(socket, CLIENT_EVENTS.ATTEMPT_DRAFT, {
        attemptId,
        language: "python",
        sourceCode: "print(1)",
      }),
    ).toEqual({ ok: true });
    expect((await prisma.attemptDraft.findUniqueOrThrow({ where: { attemptId } })).sourceCode).toBe(
      "print(1)",
    );

    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: { status: "SUBMITTED" },
    });
    expect(
      await send(socket, CLIENT_EVENTS.ATTEMPT_DRAFT, {
        attemptId,
        language: "python",
        sourceCode: "late",
      }),
    ).toMatchObject({ ok: false, code: "ATTEMPT_ALREADY_SUBMITTED" });
    socket.disconnect();
  });

  it("re-sends the attempt state when apps/web closes the attempt", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderA.id, new Date(Date.now() + 10 * MINUTE));
    const socket = await client(coderA.cookie);
    await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });
    await sleep(100);

    await prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: { status: "SUBMITTED" },
    });
    const state = next<AttemptStatePayload>(socket, SERVER_EVENTS.ATTEMPT_STATE);
    const message: AssessmentBroadcastMessage = {
      type: "ATTEMPT_CLOSED",
      userId: coderA.id,
      attemptId,
    };
    await publisher.publish(REDIS_CHANNELS.ASSESSMENT_BROADCAST, JSON.stringify(message));

    const payload = await state;
    expect(payload.status).toBe("SUBMITTED");
    expect(payload.remainingMs).toBeNull();
    socket.disconnect();
  });
});

// -----------------------------------------------------------------------------

describe("lobby and monitor", () => {
  it("lets only the owning Architect into the monitor room", async () => {
    const session = await makeSession(warnAssessmentId, { executionMode: "LIVE", status: "DRAFT" });
    const coder = await client(coderA.cookie);
    expect(await send(coder, CLIENT_EVENTS.MONITOR_JOIN, { sessionId: session.id })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    const owner = await client(architect.cookie);
    expect(await send(owner, CLIENT_EVENTS.MONITOR_JOIN, { sessionId: session.id })).toEqual({
      ok: true,
    });
    coder.disconnect();
    owner.disconnect();
  });

  it("tracks readiness for listed participants only and reports the counts", async () => {
    const session = await makeSession(warnAssessmentId, { executionMode: "LIVE", status: "DRAFT" });
    await prisma.assessmentParticipant.createMany({
      data: [coderA.id, coderB.id].map((userId) => ({
        sessionId: session.id,
        userId,
        isListed: true,
      })),
    });

    const monitor = await client(architect.cookie);
    await send(monitor, CLIENT_EVENTS.MONITOR_JOIN, { sessionId: session.id });

    const unlisted = await client(coderC.cookie);
    expect(
      await send(unlisted, CLIENT_EVENTS.ATTEMPT_READY, { sessionId: session.id, ready: true }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const counts = next<SessionStatePayload>(monitor, SERVER_EVENTS.SESSION_STATE);
    const ready = await client(coderA.cookie);
    expect(
      await send(ready, CLIENT_EVENTS.ATTEMPT_READY, { sessionId: session.id, ready: true }),
    ).toEqual({
      ok: true,
    });
    expect((await counts).counts).toEqual({ ready: 1, notReady: 0, offline: 1, total: 2 });

    // Leaving the lobby drops the Coder to offline once the debounce passes.
    const afterLeave = next<SessionStatePayload>(monitor, SERVER_EVENTS.SESSION_STATE, 5_000);
    ready.disconnect();
    expect((await afterLeave).counts).toEqual({ ready: 0, notReady: 0, offline: 2, total: 2 });

    monitor.disconnect();
    unlisted.disconnect();
  });
});

// -----------------------------------------------------------------------------

describe("anti-cheat", () => {
  it("logs every focus loss and warns once the tolerated number is passed", async () => {
    const session = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderB.id, new Date(Date.now() + 10 * MINUTE));

    const monitor = await client(architect.cookie);
    await send(monitor, CLIENT_EVENTS.MONITOR_JOIN, { sessionId: session.id });
    const socket = await client(coderB.cookie);
    await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });

    const warnings: AttemptWarningPayload[] = [];
    socket.on(SERVER_EVENTS.ATTEMPT_WARNING, (payload: AttemptWarningPayload) =>
      warnings.push(payload),
    );
    const feed: MonitorEventPayload[] = [];
    monitor.on(SERVER_EVENTS.MONITOR_EVENT, (payload: MonitorEventPayload) => feed.push(payload));

    await send(socket, CLIENT_EVENTS.ANTICHEAT_FOCUS, { attemptId, state: "LOST" });
    await sleep(150);
    expect(warnings).toHaveLength(0);

    await send(socket, CLIENT_EVENTS.ANTICHEAT_FOCUS, { attemptId, state: "REGAINED" });
    await send(socket, CLIENT_EVENTS.ANTICHEAT_FOCUS, { attemptId, state: "LOST" });
    await eventually(
      () => Promise.resolve(warnings.length),
      (count) => count === 1,
    );

    await send(socket, CLIENT_EVENTS.ANTICHEAT_CLIPBOARD, { attemptId, action: "PASTE" });
    // Context menu blocking is off for this assessment, so nothing is logged for it.
    await send(socket, CLIENT_EVENTS.ANTICHEAT_CLIPBOARD, { attemptId, action: "CONTEXT_MENU" });

    const events = await prisma.assessmentEvent.findMany({
      where: { attemptId, type: { in: ["FOCUS_LOST", "FOCUS_REGAINED", "CLIPBOARD_BLOCKED"] } },
      orderBy: { occurredAt: "asc" },
      select: { type: true, durationMs: true },
    });
    expect(events.map((event) => event.type)).toEqual([
      "FOCUS_LOST",
      "FOCUS_REGAINED",
      "FOCUS_LOST",
      "CLIPBOARD_BLOCKED",
    ]);
    expect(events[1]?.durationMs).not.toBeNull();
    await eventually(
      () => Promise.resolve(feed.map((event) => event.type)),
      (types) => types.filter((type) => type === "FOCUS_LOST").length === 2,
    );
    expect(web.autoSubmit).not.toHaveBeenCalledWith(attemptId, expect.anything());

    socket.disconnect();
    monitor.disconnect();
  });

  it("asks apps/web to auto-submit when the focus-loss action is AUTO_SUBMIT", async () => {
    const session = await makeSession(autoAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const attemptId = await makeAttempt(session.id, coderA.id, new Date(Date.now() + 10 * MINUTE));
    const socket = await client(coderA.cookie);
    await send(socket, CLIENT_EVENTS.ATTEMPT_JOIN, { attemptId });

    await send(socket, CLIENT_EVENTS.ANTICHEAT_FOCUS, { attemptId, state: "LOST" });
    expect(web.autoSubmit).toHaveBeenCalledWith(attemptId, "FOCUS_LOSS");
    socket.disconnect();
  });
});

// -----------------------------------------------------------------------------

describe("deadline sweep", () => {
  it("hands overdue attempts and live sessions to apps/web", async () => {
    const individual = await makeSession(warnAssessmentId, {
      executionMode: "INDIVIDUAL",
      status: "RUNNING",
    });
    const overdue = await makeAttempt(individual.id, coderC.id, new Date(Date.now() - 1_000));
    const live = await makeSession(warnAssessmentId, {
      executionMode: "LIVE",
      status: "RUNNING",
      endsAt: new Date(Date.now() - 1_000),
    });

    await server.deadlines.sweep();

    expect(web.autoSubmit).toHaveBeenCalledWith(overdue, "DEADLINE");
    expect(web.expireSession).toHaveBeenCalledWith(live.id);
  });
});
