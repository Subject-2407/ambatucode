import { prisma, type Prisma } from "@ambatucode/db";
import {
  CLIENT_EVENTS,
  DISCONNECT_DEBOUNCE_MS,
  SERVER_EVENTS,
  TICK_INTERVAL_MS,
  antiCheatConfigSchema,
  anticheatClipboardPayloadSchema,
  anticheatFocusPayloadSchema,
  attemptActivityProblem,
  attemptDeadlineMs,
  attemptDraftPayloadSchema,
  attemptJoinPayloadSchema,
  attemptReadyPayloadSchema,
  attemptRemainingMs,
  countReadiness,
  focusLossResponse,
  isAttemptOverdue,
  isLanguage,
  monitorJoinPayloadSchema,
  pauseAttemptClock,
  resumeAttemptClock,
  rooms,
  type Ack,
  type AckFn,
  type AssessmentBroadcastMessage,
  type AssessmentEventType,
  type AttemptClock,
  type AttemptStatePayload,
  type MonitorEventPayload,
} from "@ambatucode/shared";
import type { DeadlineScheduler } from "./deadlines";
import type { AppServer, AppSocket } from "./server";
import type { WebClient } from "./web-client";

/**
 * The live half of an Assessment Session: who is connected to which attempt,
 * whose clock is paused, and what the Architect's monitor needs to hear.
 *
 * The database is the source of truth for every decision made here. The maps
 * below only remember which socket is bound to what, so a disconnect can be
 * attributed and a tick can be addressed — every rule is re-read from the rows
 * before it acts, because another process, or another realtime instance, may
 * have changed them since.
 */

export type AssessmentRuntime = {
  register(socket: AppSocket): void;
  handleBroadcast(message: AssessmentBroadcastMessage): Promise<void>;
  close(): void;
};

type Bound = { attemptId: string; sessionId: string; userId: string };
type Lobby = { sessionId: string; userId: string };

const ATTEMPT_SELECT = {
  id: true,
  userId: true,
  sessionId: true,
  status: true,
  individualDeadlineAt: true,
  pausedAt: true,
  consumedMs: true,
  draft: { select: { language: true, sourceCode: true } },
  session: {
    select: {
      status: true,
      executionMode: true,
      durationMinutes: true,
      endsAt: true,
      assessment: { select: { allowedLanguages: true, antiCheatConfigJson: true } },
    },
  },
} satisfies Prisma.AssessmentAttemptSelect;

type AttemptRow = Prisma.AssessmentAttemptGetPayload<{ select: typeof ATTEMPT_SELECT }>;

function reject(code: string, message: string): Ack {
  return { ok: false, code, message };
}

function clockOf(row: {
  individualDeadlineAt: Date | null;
  pausedAt: Date | null;
  consumedMs: number;
  session: {
    executionMode: AttemptClock["executionMode"];
    durationMinutes: number | null;
    endsAt: Date | null;
  };
}): AttemptClock {
  return {
    executionMode: row.session.executionMode,
    durationMinutes: row.session.durationMinutes,
    endsAtMs: row.session.endsAt?.getTime() ?? null,
    individualDeadlineAtMs: row.individualDeadlineAt?.getTime() ?? null,
    pausedAtMs: row.pausedAt?.getTime() ?? null,
    consumedMs: row.consumedMs,
  };
}

function statePayload(row: AttemptRow, nowMs: number): AttemptStatePayload {
  const active = row.status === "IN_PROGRESS";
  const clock = clockOf(row);
  const language = row.draft !== null && isLanguage(row.draft.language) ? row.draft.language : null;
  return {
    attemptId: row.id,
    sessionId: row.sessionId,
    status: row.status,
    language,
    sourceCode: row.draft?.sourceCode ?? null,
    deadlineMs: active ? attemptDeadlineMs(clock) : null,
    remainingMs: active ? attemptRemainingMs(clock, nowMs) : null,
    consumedMs: row.consumedMs,
    paused: active && row.pausedAt !== null,
    serverTimeMs: nowMs,
  };
}

async function loadOwnAttempt(attemptId: string, userId: string): Promise<AttemptRow | null> {
  const row = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    select: ATTEMPT_SELECT,
  });
  // Someone else's attempt answers exactly like a missing one.
  return row !== null && row.userId === userId ? row : null;
}

/** Individual mode is the only mode whose clock stops for a disconnect. */
function isIndividualTimed(row: AttemptRow): boolean {
  return row.session.executionMode === "INDIVIDUAL" && row.session.durationMinutes !== null;
}

export function createAssessmentRuntime(options: {
  io: AppServer;
  deadlines: DeadlineScheduler;
  web: WebClient;
  disconnectDebounceMs?: number;
  tickIntervalMs?: number;
}): AssessmentRuntime {
  const { io, deadlines, web } = options;
  const debounceMs = options.disconnectDebounceMs ?? DISCONNECT_DEBOUNCE_MS;

  /** socket id -> the attempt it is working on. */
  const boundAttempts = new Map<string, Bound>();
  /** socket id -> the pre-start lobbies it is waiting in. */
  const lobbies = new Map<string, Lobby[]>();
  /** attempt id -> a disconnect waiting out its debounce window, and whose it is. */
  const pendingDisconnects = new Map<string, { timer: NodeJS.Timeout; socketId: string }>();
  /** Sockets this instance dropped for a takeover. Their disconnect is already logged. */
  const superseded = new Set<string>();
  /** lobby key -> a lobby disconnect waiting out its debounce window. */
  const pendingLobbyDisconnects = new Map<string, NodeJS.Timeout>();

  // --- Shared helpers ---------------------------------------------------------

  async function record(input: {
    sessionId: string;
    type: AssessmentEventType;
    userId: string;
    attemptId: string | null;
    occurredAt?: Date;
    durationMs?: number | null;
    payload?: Record<string, string | number | boolean | null>;
  }): Promise<MonitorEventPayload> {
    const row = await prisma.assessmentEvent.create({
      data: {
        sessionId: input.sessionId,
        type: input.type,
        userId: input.userId,
        attemptId: input.attemptId,
        durationMs: input.durationMs ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        payloadJson: input.payload ?? {},
      },
      select: { id: true, occurredAt: true },
    });
    const event: MonitorEventPayload = {
      id: row.id,
      sessionId: input.sessionId,
      userId: input.userId,
      attemptId: input.attemptId,
      type: input.type,
      durationMs: input.durationMs ?? null,
      occurredAt: row.occurredAt.getTime(),
      payload: input.payload ?? {},
    };
    io.to(rooms.monitor(input.sessionId)).emit(SERVER_EVENTS.MONITOR_EVENT, event);
    return event;
  }

  async function announceParticipant(sessionId: string, userId: string): Promise<void> {
    const participant = await prisma.assessmentParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      select: {
        readyState: true,
        connectionState: true,
        lastSeenAt: true,
        user: { select: { displayName: true } },
      },
    });
    if (!participant) return;
    io.to(rooms.monitor(sessionId)).emit(SERVER_EVENTS.MONITOR_PARTICIPANT, {
      sessionId,
      userId,
      displayName: participant.user.displayName,
      readyState: participant.readyState,
      connectionState: participant.connectionState,
      lastSeenAt: participant.lastSeenAt?.getTime() ?? null,
    });
  }

  async function announceSessionState(sessionId: string): Promise<void> {
    const session = await prisma.assessmentSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        endsAt: true,
        participants: { select: { isListed: true, readyState: true, connectionState: true } },
      },
    });
    if (!session) return;
    const payload = {
      sessionId,
      status: session.status,
      endsAt: session.endsAt?.getTime() ?? null,
      counts: countReadiness(session.participants),
    };
    io.to(rooms.session(sessionId))
      .to(rooms.monitor(sessionId))
      .emit(SERVER_EVENTS.SESSION_STATE, payload);
  }

  function socketsBoundTo(attemptId: string): string[] {
    const sockets: string[] = [];
    for (const [socketId, bound] of boundAttempts) {
      if (bound.attemptId === attemptId) sockets.push(socketId);
    }
    return sockets;
  }

  async function sendState(target: string, attemptId: string, userId: string): Promise<void> {
    const row = await loadOwnAttempt(attemptId, userId);
    if (row) io.to(target).emit(SERVER_EVENTS.ATTEMPT_STATE, statePayload(row, Date.now()));
  }

  // --- Individual clock -------------------------------------------------------

  /**
   * Freezes the clock at the moment the Coder went away, not at the moment the
   * debounce window closed — the three seconds of waiting are theirs.
   *
   * An attempt already past its deadline is left running: pausing it would
   * freeze it at zero with its alarm cancelled, and it would never close.
   */
  async function pauseIfIndividual(row: AttemptRow, atMs: number): Promise<void> {
    if (row.status !== "IN_PROGRESS" || !isIndividualTimed(row) || row.pausedAt !== null) return;
    const clock = clockOf(row);
    if (isAttemptOverdue(clock, atMs)) return;

    const paused = pauseAttemptClock(clock, atMs);
    const updated = await prisma.assessmentAttempt.updateMany({
      where: { id: row.id, status: "IN_PROGRESS", pausedAt: null },
      data: { consumedMs: paused.consumedMs, pausedAt: new Date(paused.pausedAtMs) },
    });
    if (updated.count === 0) return;

    await deadlines.cancel({ kind: "ATTEMPT", attemptId: row.id });
    await record({
      sessionId: row.sessionId,
      type: "TIMER_PAUSED",
      userId: row.userId,
      attemptId: row.id,
      occurredAt: new Date(atMs),
      payload: { consumedMs: paused.consumedMs },
    });
    io.to(rooms.user(row.userId)).emit(SERVER_EVENTS.ATTEMPT_PAUSED, {
      consumedMs: paused.consumedMs,
    });
  }

  async function resumeIfPaused(row: AttemptRow, atMs: number): Promise<void> {
    if (row.status !== "IN_PROGRESS" || !isIndividualTimed(row) || row.pausedAt === null) return;
    const resumed = resumeAttemptClock(clockOf(row), atMs);
    const updated = await prisma.assessmentAttempt.updateMany({
      where: { id: row.id, status: "IN_PROGRESS", pausedAt: { not: null } },
      data: { individualDeadlineAt: new Date(resumed.individualDeadlineAtMs), pausedAt: null },
    });
    if (updated.count === 0) return;

    await deadlines.schedule(
      { kind: "ATTEMPT", attemptId: row.id },
      resumed.individualDeadlineAtMs,
    );
    await record({
      sessionId: row.sessionId,
      type: "TIMER_RESUMED",
      userId: row.userId,
      attemptId: row.id,
      occurredAt: new Date(atMs),
      durationMs: atMs - row.pausedAt.getTime(),
      payload: { consumedMs: row.consumedMs },
    });
    io.to(rooms.user(row.userId)).emit(SERVER_EVENTS.ATTEMPT_RESUMED, {
      consumedMs: row.consumedMs,
    });
  }

  // --- attempt:join -----------------------------------------------------------

  /**
   * Binds this socket as the attempt's one active connection.
   *
   * Three ways to arrive here, told apart before anything is logged:
   *
   * - a refresh: the same user rejoined inside the debounce window. Nothing is
   *   logged and nothing is emitted to the monitor — a reload is not an event.
   * - a takeover: another socket still holds the attempt. It is told it was
   *   superseded and disconnected, and the handover is logged.
   * - a return: nobody holds it. A paused Individual clock resumes, and the
   *   connection is logged as CONNECTED the first time and RECONNECTED after.
   */
  async function handleJoin(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = attemptJoinPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid join payload"));
    const { userId, role } = socket.data;
    if (role !== "CODER") return ack?.(reject("FORBIDDEN", "Only a Coder joins an attempt"));

    const row = await loadOwnAttempt(parsed.data.attemptId, userId);
    if (!row) return ack?.(reject("NOT_FOUND", "Attempt not found"));

    const now = Date.now();
    if (row.status !== "IN_PROGRESS") {
      // A closed attempt has nothing to bind; the Coder still gets its state.
      socket.emit(SERVER_EVENTS.ATTEMPT_STATE, statePayload(row, now));
      return ack?.({ ok: true });
    }

    const { sessionId } = row;
    const participant = await prisma.assessmentParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      create: { sessionId, userId, isListed: false },
      update: {},
      select: { activeConnectionId: true },
    });
    const previousSocketId = participant.activeConnectionId;

    const pending = pendingDisconnects.get(row.id);
    const isRefresh = pending !== undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pendingDisconnects.delete(row.id);
    }

    // Claimed before the previous socket is dropped, so its disconnect handler
    // sees it no longer holds the attempt and logs and pauses nothing.
    await prisma.assessmentParticipant.update({
      where: { sessionId_userId: { sessionId, userId } },
      data: { activeConnectionId: socket.id, connectionState: "ONLINE", lastSeenAt: new Date(now) },
    });

    // Waiting in the lobby and working on the attempt are the same presence;
    // only the attempt binding should react to this socket going away.
    lobbies.set(
      socket.id,
      (lobbies.get(socket.id) ?? []).filter((lobby) => lobby.sessionId !== sessionId),
    );
    boundAttempts.set(socket.id, { attemptId: row.id, sessionId, userId });
    await socket.join(rooms.session(sessionId));

    if (!isRefresh) {
      const takeover =
        previousSocketId !== null &&
        previousSocketId !== socket.id &&
        (await io.in(previousSocketId).fetchSockets()).length > 0;

      if (takeover && previousSocketId !== null) {
        superseded.add(previousSocketId);
        io.to(previousSocketId).emit(SERVER_EVENTS.ATTEMPT_SUPERSEDED, {});
        io.in(previousSocketId).disconnectSockets(true);
        await record({
          sessionId,
          type: "DISCONNECTED",
          userId,
          attemptId: row.id,
          payload: { reason: "SUPERSEDED" },
        });
        await record({
          sessionId,
          type: "RECONNECTED",
          userId,
          attemptId: row.id,
          payload: { superseded: true },
        });
      } else {
        await resumeIfPaused(row, now);
        const connectedBefore = await prisma.assessmentEvent.count({
          where: { attemptId: row.id, type: { in: ["CONNECTED", "RECONNECTED"] } },
        });
        await record({
          sessionId,
          type: connectedBefore > 0 ? "RECONNECTED" : "CONNECTED",
          userId,
          attemptId: row.id,
        });
      }
      await announceParticipant(sessionId, userId);
    }

    await sendState(socket.id, row.id, userId);
    ack?.({ ok: true });
  }

  // --- Disconnect -------------------------------------------------------------

  /**
   * Runs once the debounce window closes without a rejoin. Every check is made
   * against the participant row, not memory: if any socket — on this instance
   * or another — has claimed the attempt since, this disconnect is stale.
   */
  async function settleDisconnect(bound: Bound, socketId: string, atMs: number): Promise<void> {
    if (pendingDisconnects.get(bound.attemptId)?.socketId === socketId) {
      pendingDisconnects.delete(bound.attemptId);
    }

    const released = await prisma.assessmentParticipant.updateMany({
      where: { sessionId: bound.sessionId, userId: bound.userId, activeConnectionId: socketId },
      data: { activeConnectionId: null, connectionState: "OFFLINE" },
    });
    if (released.count === 0) return;

    await record({
      sessionId: bound.sessionId,
      type: "DISCONNECTED",
      userId: bound.userId,
      attemptId: bound.attemptId,
      occurredAt: new Date(atMs),
    });

    const row = await loadOwnAttempt(bound.attemptId, bound.userId);
    // Live clocks never pause; a disconnect there is logged and nothing more.
    if (row) await pauseIfIndividual(row, atMs);

    await announceParticipant(bound.sessionId, bound.userId);
  }

  async function settleLobbyDisconnect(lobby: Lobby, socketId: string): Promise<void> {
    pendingLobbyDisconnects.delete(`${lobby.sessionId}:${lobby.userId}`);
    const released = await prisma.assessmentParticipant.updateMany({
      where: { sessionId: lobby.sessionId, userId: lobby.userId, activeConnectionId: socketId },
      data: { activeConnectionId: null, connectionState: "OFFLINE" },
    });
    if (released.count === 0) return;
    await announceParticipant(lobby.sessionId, lobby.userId);
    await announceSessionState(lobby.sessionId);
  }

  function handleDisconnect(socket: AppSocket): void {
    const atMs = Date.now();

    const bound = boundAttempts.get(socket.id);
    boundAttempts.delete(socket.id);
    // A socket dropped for a takeover was never "gone": the handover was logged
    // when it happened, and a debounce here would race the new connection's.
    const wasSuperseded = superseded.delete(socket.id);
    if (bound && !wasSuperseded) {
      const existing = pendingDisconnects.get(bound.attemptId);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        void settleDisconnect(bound, socket.id, atMs).catch((error: unknown) => {
          console.error("[realtime] failed to settle disconnect:", error);
        });
      }, debounceMs);
      pendingDisconnects.set(bound.attemptId, { timer, socketId: socket.id });
    }

    for (const lobby of lobbies.get(socket.id) ?? []) {
      const key = `${lobby.sessionId}:${lobby.userId}`;
      const timer = setTimeout(() => {
        void settleLobbyDisconnect(lobby, socket.id).catch((error: unknown) => {
          console.error("[realtime] failed to settle lobby disconnect:", error);
        });
      }, debounceMs);
      pendingLobbyDisconnects.set(key, timer);
    }
    lobbies.delete(socket.id);
  }

  // --- attempt:ready ----------------------------------------------------------

  /**
   * Readiness before a session starts. Only a listed participant has a
   * readiness to report, and toggling it is also what puts them in the lobby,
   * so the board can tell "ready" from "not ready" from "not here".
   */
  async function handleReady(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = attemptReadyPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid ready payload"));
    const { sessionId, ready } = parsed.data;
    const { userId } = socket.data;

    const [session, participant] = await Promise.all([
      prisma.assessmentSession.findUnique({ where: { id: sessionId }, select: { status: true } }),
      prisma.assessmentParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
        select: { isListed: true },
      }),
    ]);
    if (!session || !participant?.isListed) {
      return ack?.(reject("FORBIDDEN", "You are not on this session's participant list"));
    }
    if (session.status !== "DRAFT" && session.status !== "READY") {
      return ack?.(
        reject("SESSION_NOT_RUNNING", "Readiness can only change before the session starts"),
      );
    }

    const pending = pendingLobbyDisconnects.get(`${sessionId}:${userId}`);
    if (pending) {
      clearTimeout(pending);
      pendingLobbyDisconnects.delete(`${sessionId}:${userId}`);
    }

    await prisma.assessmentParticipant.update({
      where: { sessionId_userId: { sessionId, userId } },
      data: {
        readyState: ready ? "READY" : "NOT_READY",
        connectionState: "ONLINE",
        activeConnectionId: socket.id,
        lastSeenAt: new Date(),
      },
    });

    const joined = lobbies.get(socket.id) ?? [];
    if (!joined.some((lobby) => lobby.sessionId === sessionId)) {
      lobbies.set(socket.id, [...joined, { sessionId, userId }]);
    }
    await socket.join(rooms.session(sessionId));

    await announceParticipant(sessionId, userId);
    await announceSessionState(sessionId);
    ack?.({ ok: true });
  }

  // --- attempt:draft ----------------------------------------------------------

  /** The low-latency autosave path. Same rules as `PUT /api/attempts/[id]/draft`. */
  async function handleDraft(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = attemptDraftPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid draft payload"));
    const { attemptId, language, sourceCode } = parsed.data;

    const row = await loadOwnAttempt(attemptId, socket.data.userId);
    if (!row) return ack?.(reject("NOT_FOUND", "Attempt not found"));

    const problem = attemptActivityProblem({
      status: row.status,
      sessionStatus: row.session.status,
      clock: clockOf(row),
      nowMs: Date.now(),
    });
    if (problem) return ack?.(reject(problem, "This attempt no longer accepts drafts"));
    if (!row.session.assessment.allowedLanguages.includes(language)) {
      return ack?.(reject("LANGUAGE_NOT_ALLOWED", "This assessment does not allow that language"));
    }

    const savedAt = new Date();
    await prisma.attemptDraft.upsert({
      where: { attemptId },
      create: { attemptId, language, sourceCode, savedAt },
      update: { language, sourceCode, savedAt },
    });
    ack?.({ ok: true });
  }

  // --- Anti-cheat -------------------------------------------------------------

  function antiCheatOf(row: AttemptRow) {
    const parsed = antiCheatConfigSchema.safeParse(row.session.assessment.antiCheatConfigJson);
    // A malformed stored config falls back to every control off rather than
    // punishing a Coder for a defect in the platform's own data.
    return parsed.success ? parsed.data : antiCheatConfigSchema.parse({});
  }

  /**
   * Every focus loss is logged. The configured action — nothing, a warning, or
   * an auto-submit — fires once the tolerated number of losses is exceeded.
   * The client's report is the trigger, never the authority: the count and the
   * decision come from the server's own event log.
   */
  async function handleFocus(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = anticheatFocusPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid focus payload"));
    const { attemptId, state } = parsed.data;
    const { userId } = socket.data;

    const row = await loadOwnAttempt(attemptId, userId);
    if (!row) return ack?.(reject("NOT_FOUND", "Attempt not found"));
    if (row.status !== "IN_PROGRESS") {
      return ack?.(reject("ATTEMPT_EXPIRED", "This attempt has ended"));
    }

    const config = antiCheatOf(row);
    if (!config.detectFocusLoss) return ack?.({ ok: true });

    const now = new Date();
    if (state === "REGAINED") {
      const lastLoss = await prisma.assessmentEvent.findFirst({
        where: { attemptId, type: "FOCUS_LOST" },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      });
      await record({
        sessionId: row.sessionId,
        type: "FOCUS_REGAINED",
        userId,
        attemptId,
        occurredAt: now,
        durationMs: lastLoss ? now.getTime() - lastLoss.occurredAt.getTime() : null,
      });
      return ack?.({ ok: true });
    }

    const previousLosses = await prisma.assessmentEvent.count({
      where: { attemptId, type: "FOCUS_LOST" },
    });
    const count = previousLosses + 1;
    const response = focusLossResponse(config, count);

    await record({
      sessionId: row.sessionId,
      type: "FOCUS_LOST",
      userId,
      attemptId,
      occurredAt: now,
      payload: { count, action: response },
    });

    if (response === "WARN") {
      io.to(rooms.user(userId)).emit(SERVER_EVENTS.ATTEMPT_WARNING, {
        code: "FOCUS_LOST",
        message: `Leaving the assessment window is recorded. This has happened ${count} times.`,
      });
    } else if (response === "AUTO_SUBMIT") {
      await web.autoSubmit(attemptId, "FOCUS_LOSS");
    }
    ack?.({ ok: true });
  }

  async function handleClipboard(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = anticheatClipboardPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid clipboard payload"));
    const { attemptId, action } = parsed.data;
    const { userId } = socket.data;

    const row = await loadOwnAttempt(attemptId, userId);
    if (!row) return ack?.(reject("NOT_FOUND", "Attempt not found"));
    if (row.status !== "IN_PROGRESS") return ack?.({ ok: true });

    const config = antiCheatOf(row);
    const blocked = action === "CONTEXT_MENU" ? config.blockContextMenu : config.blockClipboard;
    // A report for a control that is switched off is not an event — the
    // client should not have blocked anything, so there is nothing to log.
    if (blocked) {
      await record({
        sessionId: row.sessionId,
        type: "CLIPBOARD_BLOCKED",
        userId,
        attemptId,
        payload: { action },
      });
    }
    ack?.({ ok: true });
  }

  // --- monitor:join -----------------------------------------------------------

  /** The monitor room is the owning Architect's alone. */
  async function handleMonitorJoin(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = monitorJoinPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid monitor payload"));
    const { sessionId } = parsed.data;
    const { userId, role } = socket.data;

    const session = await prisma.assessmentSession.findUnique({
      where: { id: sessionId },
      select: {
        assessment: { select: { section: { select: { module: { select: { ownerId: true } } } } } },
      },
    });
    if (!session || role !== "ARCHITECT" || session.assessment.section.module.ownerId !== userId) {
      return ack?.(reject("FORBIDDEN", "Only the owning Architect may monitor this session"));
    }

    await socket.join(rooms.monitor(sessionId));
    ack?.({ ok: true });
  }

  // --- Broadcasts from apps/web -----------------------------------------------

  async function handleBroadcast(message: AssessmentBroadcastMessage): Promise<void> {
    switch (message.type) {
      case "SESSION_STARTED":
        io.to(rooms.session(message.payload.sessionId))
          .to(rooms.monitor(message.payload.sessionId))
          .emit(SERVER_EVENTS.SESSION_STARTED, message.payload);
        return;
      case "SESSION_STATE":
        io.to(rooms.session(message.payload.sessionId))
          .to(rooms.monitor(message.payload.sessionId))
          .emit(SERVER_EVENTS.SESSION_STATE, message.payload);
        return;
      case "MONITOR_EVENT":
        io.to(rooms.monitor(message.payload.sessionId)).emit(
          SERVER_EVENTS.MONITOR_EVENT,
          message.payload,
        );
        return;
      case "MONITOR_PARTICIPANT":
        io.to(rooms.monitor(message.payload.sessionId)).emit(
          SERVER_EVENTS.MONITOR_PARTICIPANT,
          message.payload,
        );
        return;
      case "ATTEMPT_AUTO_SUBMITTED":
        io.to(rooms.user(message.userId)).emit(
          SERVER_EVENTS.ATTEMPT_AUTO_SUBMITTED,
          message.payload,
        );
        return;
      case "ATTEMPT_CLOSED": {
        const pending = pendingDisconnects.get(message.attemptId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDisconnects.delete(message.attemptId);
        }
        for (const socketId of socketsBoundTo(message.attemptId)) boundAttempts.delete(socketId);
        await sendState(rooms.user(message.userId), message.attemptId, message.userId);
        return;
      }
    }
  }

  // --- Ticks ------------------------------------------------------------------

  /**
   * A correction signal every few seconds, not the clock: the browser
   * interpolates between ticks. One query covers every bound attempt, so the
   * cost does not grow with the number of sockets.
   */
  async function tick(): Promise<void> {
    const attemptIds = [...new Set([...boundAttempts.values()].map((bound) => bound.attemptId))];
    if (attemptIds.length === 0) return;

    const rows = await prisma.assessmentAttempt.findMany({
      where: { id: { in: attemptIds }, status: "IN_PROGRESS", pausedAt: null },
      select: {
        id: true,
        individualDeadlineAt: true,
        pausedAt: true,
        consumedMs: true,
        session: { select: { executionMode: true, durationMinutes: true, endsAt: true } },
      },
    });
    const nowMs = Date.now();
    for (const row of rows) {
      const remainingMs = attemptRemainingMs(clockOf(row), nowMs);
      if (remainingMs === null) continue;
      for (const socketId of socketsBoundTo(row.id)) {
        io.to(socketId).emit(SERVER_EVENTS.ATTEMPT_TICK, { remainingMs, serverTimeMs: nowMs });
      }
    }
  }

  const tickTimer = setInterval(() => {
    void tick().catch((error: unknown) => console.error("[realtime] tick failed:", error));
  }, options.tickIntervalMs ?? TICK_INTERVAL_MS);

  function guarded(
    name: string,
    handler: (socket: AppSocket, raw: unknown, ack?: AckFn) => Promise<void>,
    socket: AppSocket,
  ) {
    return (raw: unknown, ack?: AckFn) => {
      handler(socket, raw, ack).catch((error: unknown) => {
        console.error(`[realtime] ${name} failed:`, error);
        ack?.(reject("INTERNAL", "Something went wrong"));
      });
    };
  }

  return {
    register(socket) {
      socket.on(CLIENT_EVENTS.ATTEMPT_JOIN, guarded("attempt:join", handleJoin, socket));
      socket.on(CLIENT_EVENTS.ATTEMPT_READY, guarded("attempt:ready", handleReady, socket));
      socket.on(CLIENT_EVENTS.ATTEMPT_DRAFT, guarded("attempt:draft", handleDraft, socket));
      socket.on(CLIENT_EVENTS.ANTICHEAT_FOCUS, guarded("anticheat:focus", handleFocus, socket));
      socket.on(
        CLIENT_EVENTS.ANTICHEAT_CLIPBOARD,
        guarded("anticheat:clipboard", handleClipboard, socket),
      );
      socket.on(CLIENT_EVENTS.MONITOR_JOIN, guarded("monitor:join", handleMonitorJoin, socket));
      socket.on("disconnect", () => handleDisconnect(socket));
    },
    handleBroadcast,
    close() {
      clearInterval(tickTimer);
      for (const pending of pendingDisconnects.values()) clearTimeout(pending.timer);
      for (const timer of pendingLobbyDisconnects.values()) clearTimeout(timer);
      pendingDisconnects.clear();
      pendingLobbyDisconnects.clear();
    },
  };
}
