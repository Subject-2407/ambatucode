import { loadSessionRoster, prisma, type Prisma } from "@ambatucode/db";
import {
  errorFields,
  CLIENT_EVENTS,
  DISCONNECT_DEBOUNCE_MS,
  PRESENCE_REFRESH_MS,
  PRESENCE_STALE_MS,
  SERVER_EVENTS,
  TICK_INTERVAL_MS,
  antiCheatConfigSchema,
  anticheatClipboardPayloadSchema,
  anticheatFocusPayloadSchema,
  attemptActivityProblem,
  attemptDeadlineMs,
  attemptDraftPayloadSchema,
  attemptJoinPayloadSchema,
  attemptLeavePayloadSchema,
  attemptReadyPayloadSchema,
  attemptRemainingMs,
  countReadiness,
  focusLossResponse,
  isAttemptOverdue,
  isLanguage,
  lobbyLeavePayloadSchema,
  monitorJoinPayloadSchema,
  pauseAttemptClock,
  presenceOf,
  resumeAttemptClock,
  rooms,
  type Ack,
  type AckFn,
  type AssessmentBroadcastMessage,
  type AssessmentEventType,
  type AttemptClock,
  type AttemptStatePayload,
  type MonitorEventPayload,
  type MonitorParticipantPayload,
} from "@ambatucode/shared";
import type { DeadlineScheduler } from "./deadlines";
import type { PlatformPresence } from "./presence";
import type { AppServer, AppSocket } from "./server";
import type { WebClient } from "./web-client";
import { log } from "./logger";

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
/**
 * A socket that is on a session's page without a live attempt bound to it: a
 * Coder waiting in the lobby, or looking at an attempt that has closed. Only
 * presence hangs off it — leaving logs nothing and pauses nothing.
 *
 * `attemptId` is set for the closed-attempt case, so the workspace's own
 * `attempt:leave` can find it.
 */
type Lobby = { sessionId: string; userId: string; attemptId?: string };

const ATTEMPT_SELECT = {
  id: true,
  userId: true,
  sessionId: true,
  status: true,
  individualDeadlineAt: true,
  pausedAt: true,
  consumedMs: true,
  // A retake granted after the session ended answers to itself, not to the
  // session's status. apps/web sets it; both processes have to agree, or the
  // HTTP autosave would accept what the socket autosave refused.
  grantedOutsideSession: true,
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

/** Platform presence changes are gathered for this long before the boards hear of them. */
const PRESENCE_FLUSH_MS = 1_000;

export function createAssessmentRuntime(options: {
  io: AppServer;
  deadlines: DeadlineScheduler;
  web: WebClient;
  presence: PlatformPresence;
  disconnectDebounceMs?: number;
  tickIntervalMs?: number;
  presenceRefreshMs?: number;
  presenceStaleMs?: number;
}): AssessmentRuntime {
  const { io, deadlines, web, presence } = options;
  const debounceMs = options.disconnectDebounceMs ?? DISCONNECT_DEBOUNCE_MS;
  const staleMs = options.presenceStaleMs ?? PRESENCE_STALE_MS;

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
  /** Coders who came online or went offline since the last presence flush. */
  const presenceChanges = new Set<string>();
  let presenceFlush: NodeJS.Timeout | null = null;

  const lobbyKey = (sessionId: string, userId: string) => `${sessionId}:${userId}`;

  /**
   * socket id -> page -> how many times it was opened, and up to which opening
   * it has been left.
   *
   * A join waits on the database before it binds anything, and a leave does
   * not wait at all. A page opened and closed within a few milliseconds — a
   * misclick, React's development double-mount — therefore delivers a leave
   * that finds nothing bound yet, followed by a join that binds a page nobody
   * is on. Numbering the openings lets that join see it has already been left.
   */
  const visits = new Map<string, Map<string, { opened: number; left: number }>>();

  function openVisit(socketId: string, page: string): number {
    const pages = visits.get(socketId) ?? new Map<string, { opened: number; left: number }>();
    visits.set(socketId, pages);
    const visit = pages.get(page) ?? { opened: 0, left: 0 };
    visit.opened += 1;
    pages.set(page, visit);
    return visit.opened;
  }

  function leaveVisit(socketId: string, page: string): void {
    const visit = visits.get(socketId)?.get(page);
    if (visit) visit.left = visit.opened;
  }

  function visitIsOpen(socketId: string, page: string, opening: number): boolean {
    const visit = visits.get(socketId)?.get(page);
    return visit === undefined || opening > visit.left;
  }

  function cancelLobbySettle(sessionId: string, userId: string): void {
    const key = lobbyKey(sessionId, userId);
    const pending = pendingLobbyDisconnects.get(key);
    if (pending) clearTimeout(pending);
    pendingLobbyDisconnects.delete(key);
  }

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

  /**
   * One participant as the monitor shows them. A Coder the session expects but
   * who has never opened it has no participant row yet; they still have a
   * presence worth reporting, so they are described from their user row.
   */
  async function participantPayload(
    sessionId: string,
    userId: string,
  ): Promise<MonitorParticipantPayload | null> {
    const [participant, online] = await Promise.all([
      prisma.assessmentParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
        select: {
          readyState: true,
          connectionState: true,
          lastSeenAt: true,
          user: { select: { displayName: true } },
        },
      }),
      presence.online([userId]),
    ]);
    const platformOnline = online.has(userId);
    if (participant) {
      return {
        sessionId,
        userId,
        displayName: participant.user.displayName,
        readyState: participant.readyState,
        connectionState: participant.connectionState,
        presence: presenceOf({ connectionState: participant.connectionState, platformOnline }),
        lastSeenAt: participant.lastSeenAt?.getTime() ?? null,
      };
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    if (!user) return null;
    return {
      sessionId,
      userId,
      displayName: user.displayName,
      readyState: "NOT_READY",
      connectionState: "OFFLINE",
      presence: platformOnline ? "ELSEWHERE" : "OFFLINE",
      lastSeenAt: null,
    };
  }

  async function announceParticipant(sessionId: string, userId: string): Promise<void> {
    const payload = await participantPayload(sessionId, userId);
    if (payload) io.to(rooms.monitor(sessionId)).emit(SERVER_EVENTS.MONITOR_PARTICIPANT, payload);
  }

  async function announceSessionState(sessionId: string): Promise<void> {
    const [roster, session] = await Promise.all([
      loadSessionRoster(prisma, sessionId),
      prisma.assessmentSession.findUnique({ where: { id: sessionId }, select: { endsAt: true } }),
    ]);
    if (!roster || !session) return;
    const online = await presence.online(roster.entries.map((entry) => entry.userId));
    const payload = {
      sessionId,
      status: roster.status,
      endsAt: session.endsAt?.getTime() ?? null,
      counts: countReadiness(
        roster.entries.map((entry) => ({
          onRoster: entry.onRoster,
          readyState: entry.readyState,
          presence: presenceOf({
            connectionState: entry.connectionState,
            platformOnline: online.has(entry.userId),
          }),
        })),
      ),
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
    const page = `attempt:${parsed.data.attemptId}`;
    const opening = openVisit(socket.id, page);

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

    // The workspace was closed again while this join waited on the database.
    // Checked before anything pending is touched: a departure already waiting
    // out its debounce belongs to that close and must be left to land.
    if (!visitIsOpen(socket.id, page, opening)) return ack?.({ ok: true });

    const pending = pendingDisconnects.get(row.id);
    const isRefresh = pending !== undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pendingDisconnects.delete(row.id);
    }
    // A Live start takes the Coder from the lobby straight into the workspace on
    // the same socket. The lobby's departure, still waiting out its debounce,
    // would otherwise land after this join and mark them offline mid-exam.
    cancelLobbySettle(sessionId, userId);

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
    const bound = { attemptId: row.id, sessionId, userId };
    boundAttempts.set(socket.id, bound);

    // Closed during the claim itself. The row is this socket's now, so it is
    // released the way any departure is.
    if (!visitIsOpen(socket.id, page, opening)) {
      boundAttempts.delete(socket.id);
      scheduleAttemptSettle(bound, socket.id, Date.now(), "LEFT");
      return ack?.({ ok: true });
    }
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
  async function settleDisconnect(
    bound: Bound,
    socketId: string,
    atMs: number,
    reason: "LEFT" | null,
  ): Promise<void> {
    if (pendingDisconnects.get(bound.attemptId)?.socketId === socketId) {
      pendingDisconnects.delete(bound.attemptId);
    }

    const released = await prisma.assessmentParticipant.updateMany({
      where: { sessionId: bound.sessionId, userId: bound.userId, activeConnectionId: socketId },
      data: { activeConnectionId: null, connectionState: "OFFLINE" },
    });
    if (released.count === 0) return;

    // DISCONNECTED either way, since the SRS treats every way of going away
    // alike. A Coder who walked to another page is still told apart from one
    // whose connection dropped, because the Architect reads the two differently.
    await record({
      sessionId: bound.sessionId,
      type: "DISCONNECTED",
      userId: bound.userId,
      attemptId: bound.attemptId,
      occurredAt: new Date(atMs),
      ...(reason === null ? {} : { payload: { reason } }),
    });

    const row = await loadOwnAttempt(bound.attemptId, bound.userId);
    // Live clocks never pause; a disconnect there is logged and nothing more.
    if (row) await pauseIfIndividual(row, atMs);

    await announceParticipant(bound.sessionId, bound.userId);
  }

  /**
   * Leaving the lobby takes the readiness with it.
   *
   * READY means "I am sitting here now". A Coder who walked away from the
   * lobby is not, and if the flag outlived them the board would show a room
   * readier than it is the moment they wandered back to the dashboard.
   */
  async function settleLobbyDisconnect(lobby: Lobby, socketId: string): Promise<void> {
    pendingLobbyDisconnects.delete(lobbyKey(lobby.sessionId, lobby.userId));
    // The same socket may since have bound this session's attempt. The row is
    // the workspace's now, and the workspace decides when it is released.
    const rebound = boundAttempts.get(socketId);
    if (rebound?.sessionId === lobby.sessionId) return;

    const released = await prisma.assessmentParticipant.updateMany({
      where: { sessionId: lobby.sessionId, userId: lobby.userId, activeConnectionId: socketId },
      data: { activeConnectionId: null, connectionState: "OFFLINE", readyState: "NOT_READY" },
    });
    if (released.count === 0) return;
    await announceParticipant(lobby.sessionId, lobby.userId);
    await announceSessionState(lobby.sessionId);
  }

  function scheduleAttemptSettle(
    bound: Bound,
    socketId: string,
    atMs: number,
    reason: "LEFT" | null,
  ): void {
    const existing = pendingDisconnects.get(bound.attemptId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      void settleDisconnect(bound, socketId, atMs, reason).catch((error: unknown) => {
        log.error("attempt.disconnect_settle_failed", errorFields(error));
      });
    }, debounceMs);
    pendingDisconnects.set(bound.attemptId, { timer, socketId });
  }

  function scheduleLobbySettle(lobby: Lobby, socketId: string): void {
    cancelLobbySettle(lobby.sessionId, lobby.userId);
    const timer = setTimeout(() => {
      void settleLobbyDisconnect(lobby, socketId).catch((error: unknown) => {
        log.error("lobby.disconnect_settle_failed", errorFields(error));
      });
    }, debounceMs);
    pendingLobbyDisconnects.set(lobbyKey(lobby.sessionId, lobby.userId), timer);
  }

  function handleDisconnect(socket: AppSocket): void {
    const atMs = Date.now();

    const bound = boundAttempts.get(socket.id);
    boundAttempts.delete(socket.id);
    // A socket dropped for a takeover was never "gone": the handover was logged
    // when it happened, and a debounce here would race the new connection's.
    const wasSuperseded = superseded.delete(socket.id);
    if (bound && !wasSuperseded) scheduleAttemptSettle(bound, socket.id, atMs, null);

    for (const lobby of lobbies.get(socket.id) ?? []) scheduleLobbySettle(lobby, socket.id);
    lobbies.delete(socket.id);
    visits.delete(socket.id);

    const { userId, role } = socket.data;
    void presence
      .remove(userId, socket.id)
      .then((wasLast) => {
        if (wasLast && role === "CODER") queuePresenceChange(userId);
      })
      .catch((error: unknown) => log.error("presence.remove_failed", errorFields(error)));
  }

  // --- attempt:leave / lobby:leave --------------------------------------------

  /**
   * The page closed but the socket did not: a navigation inside the app.
   *
   * Handled exactly as a disconnect would be, debounced so that React
   * remounting the workspace or a quick Back-and-forward is not an event,
   * because to the Architect and to an Individual clock it is the same thing:
   * the Coder is no longer working on this attempt. RESUME promises the clock
   * pauses while they are away; before this it only paused when the whole
   * browser went away.
   *
   * Synchronous, on purpose. A leave followed at once by a join on the same
   * socket must have registered its pending departure before the join looks for
   * one. socket.io calls each handler as its event arrives, so a handler with no
   * await in it has finished before the next one starts.
   */
  function handleAttemptLeave(socket: AppSocket, raw: unknown, ack?: AckFn): void {
    const parsed = attemptLeavePayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid leave payload"));
    const { attemptId } = parsed.data;
    leaveVisit(socket.id, `attempt:${attemptId}`);

    const bound = boundAttempts.get(socket.id);
    if (bound?.attemptId === attemptId) {
      boundAttempts.delete(socket.id);
      scheduleAttemptSettle(bound, socket.id, Date.now(), "LEFT");
      return ack?.({ ok: true });
    }

    // A closed attempt's workspace, which only ever held presence.
    const joined = lobbies.get(socket.id) ?? [];
    for (const lobby of joined) {
      if (lobby.attemptId === attemptId) scheduleLobbySettle(lobby, socket.id);
    }
    lobbies.set(
      socket.id,
      joined.filter((lobby) => lobby.attemptId !== attemptId),
    );
    return ack?.({ ok: true });
  }

  function handleLobbyLeave(socket: AppSocket, raw: unknown, ack?: AckFn): void {
    const parsed = lobbyLeavePayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid leave payload"));
    const { sessionId } = parsed.data;
    leaveVisit(socket.id, `lobby:${sessionId}`);

    const joined = lobbies.get(socket.id) ?? [];
    for (const lobby of joined) {
      if (lobby.sessionId === sessionId && lobby.attemptId === undefined) {
        scheduleLobbySettle(lobby, socket.id);
      }
    }
    lobbies.set(
      socket.id,
      joined.filter((lobby) => lobby.sessionId !== sessionId || lobby.attemptId !== undefined),
    );
    return ack?.({ ok: true });
  }

  // --- attempt:ready ----------------------------------------------------------

  /**
   * Whether this Coder is someone the session expects — the same rule as
   * `loadSessionRoster`, asked about one person rather than read for all.
   */
  async function isOnRoster(
    session: { access: "LISTED" | "MODULE"; isOpenAccess: boolean; moduleId: string },
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    if (session.isOpenAccess) return false;
    if (session.access === "MODULE") {
      const enrolled = await prisma.moduleEnrollment.count({
        where: { moduleId: session.moduleId, userId, status: "APPROVED" },
      });
      return enrolled > 0;
    }
    const own = await prisma.assessmentParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      select: { isListed: true },
    });
    return own?.isListed === true;
  }

  /**
   * Readiness in the lobby. Opening the lobby sends this too, carrying
   * whatever the Coder last said, which is what marks them as here: without it
   * a Coder waiting quietly would look exactly like one who never turned up.
   *
   * The lobby is the session's READY status. A DRAFT is the Architect's alone
   * — Coders cannot see it — and a session that has started has no lobby left.
   */
  async function handleReady(socket: AppSocket, raw: unknown, ack?: AckFn): Promise<void> {
    const parsed = attemptReadyPayloadSchema.safeParse(raw);
    if (!parsed.success) return ack?.(reject("VALIDATION_FAILED", "Invalid ready payload"));
    const { sessionId, ready } = parsed.data;
    const { userId, role } = socket.data;
    if (role !== "CODER") return ack?.(reject("FORBIDDEN", "Only a Coder takes part"));
    const page = `lobby:${sessionId}`;
    const opening = openVisit(socket.id, page);

    const session = await prisma.assessmentSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        access: true,
        isOpenAccess: true,
        assessment: { select: { section: { select: { moduleId: true } } } },
      },
    });
    const expected =
      session !== null &&
      (await isOnRoster(
        {
          access: session.access,
          isOpenAccess: session.isOpenAccess,
          moduleId: session.assessment.section.moduleId,
        },
        sessionId,
        userId,
      ));
    if (!session || !expected) {
      return ack?.(reject("FORBIDDEN", "This session is not expecting you"));
    }
    if (session.status === "DRAFT") {
      return ack?.(reject("CONFLICT", "The lobby is not open yet"));
    }
    if (session.status !== "READY") {
      return ack?.(reject("SESSION_NOT_RUNNING", "This session has already started"));
    }

    // The lobby was closed again while this waited on the database.
    if (!visitIsOpen(socket.id, page, opening)) return ack?.({ ok: true });
    cancelLobbySettle(sessionId, userId);

    // A Coder expected because the session is open to their Module has no row
    // until now. It is created unlisted, so it never turns the session into a
    // restricted one.
    const state = {
      readyState: ready ? ("READY" as const) : ("NOT_READY" as const),
      connectionState: "ONLINE" as const,
      activeConnectionId: socket.id,
      lastSeenAt: new Date(),
    };
    await prisma.assessmentParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      create: { sessionId, userId, isListed: false, ...state },
      update: state,
    });

    const lobby = { sessionId, userId };
    // Closed during the claim itself: released like any other departure.
    if (!visitIsOpen(socket.id, page, opening)) {
      scheduleLobbySettle(lobby, socket.id);
      return ack?.({ ok: true });
    }
    const joined = lobbies.get(socket.id) ?? [];
    if (!joined.some((entry) => entry.sessionId === sessionId && entry.attemptId === undefined)) {
      lobbies.set(socket.id, [...joined, lobby]);
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
      sessionStatus: row.grantedOutsideSession ? "RUNNING" : row.session.status,
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
        // The Coder is usually still looking at the closed workspace. They stay
        // present on its page, but as presence only: leaving it now logs no
        // disconnect and pauses no clock. Dropping the binding outright, as
        // this used to, left the row ONLINE until the end of time.
        for (const socketId of socketsBoundTo(message.attemptId)) {
          const bound = boundAttempts.get(socketId);
          boundAttempts.delete(socketId);
          if (!bound) continue;
          lobbies.set(socketId, [
            ...(lobbies.get(socketId) ?? []),
            { sessionId: bound.sessionId, userId: bound.userId, attemptId: bound.attemptId },
          ]);
        }
        await sendState(rooms.user(message.userId), message.attemptId, message.userId);
        return;
      }
    }
  }

  // --- Platform presence ------------------------------------------------------

  function queuePresenceChange(userId: string): void {
    presenceChanges.add(userId);
    presenceFlush ??= setTimeout(() => {
      presenceFlush = null;
      void flushPresenceChanges().catch((error: unknown) =>
        log.error("presence.flush_failed", errorFields(error)),
      );
    }, PRESENCE_FLUSH_MS);
  }

  /**
   * Tells every board that can see these Coders that they came or went.
   *
   * Batched, because a lab arriving at once is thirty of these in a second and
   * each session's counts only need recomputing once for all of them. Only
   * sessions that could be waiting for someone are told: before the start for
   * the lobby, while running for the monitor.
   */
  async function flushPresenceChanges(): Promise<void> {
    const userIds = [...presenceChanges];
    presenceChanges.clear();
    if (userIds.length === 0) return;

    const sessions = await prisma.assessmentSession.findMany({
      where: {
        status: { in: ["DRAFT", "READY", "RUNNING"] },
        OR: [
          { participants: { some: { userId: { in: userIds } } } },
          {
            access: "MODULE",
            isOpenAccess: false,
            assessment: {
              section: {
                module: { enrollments: { some: { userId: { in: userIds }, status: "APPROVED" } } },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    for (const session of sessions) {
      for (const userId of userIds) await announceParticipant(session.id, userId);
      await announceSessionState(session.id);
    }
  }

  /**
   * Vouches for the connections this instance holds, and retires the ones
   * nobody vouches for any more.
   *
   * Every participant row this instance's sockets hold gets a fresh
   * `lastSeenAt`. A row still ONLINE but unrefreshed for longer than the stale
   * window belongs to a socket no instance holds — one that crashed, or was
   * restarted, before its sockets could say goodbye. It is released here as a
   * lost connection, logged and paused exactly as a disconnect would have been,
   * at the moment it was last known to be there.
   *
   * The socket is looked for across every instance before it is retired, so a
   * row this instance merely failed to refresh is touched, not torn down.
   */
  async function refreshPresence(): Promise<void> {
    const now = new Date();
    const held = [...new Set([...boundAttempts.keys(), ...lobbies.keys()])];
    if (held.length > 0) {
      await prisma.assessmentParticipant.updateMany({
        where: { activeConnectionId: { in: held }, connectionState: "ONLINE" },
        data: { lastSeenAt: now },
      });
    }
    await presence.refresh([
      ...new Set([...io.of("/").sockets.values()].map((socket) => socket.data.userId)),
    ]);

    const cutoff = new Date(now.getTime() - staleMs);
    const stale = await prisma.assessmentParticipant.findMany({
      where: {
        connectionState: "ONLINE",
        OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null }],
      },
      select: { sessionId: true, userId: true, activeConnectionId: true, lastSeenAt: true },
      take: 500,
    });

    const touched = new Set<string>();
    for (const row of stale) {
      const socketId = row.activeConnectionId;
      if (socketId !== null && (await io.in(socketId).fetchSockets()).length > 0) {
        await prisma.assessmentParticipant.updateMany({
          where: { sessionId: row.sessionId, userId: row.userId, activeConnectionId: socketId },
          data: { lastSeenAt: now },
        });
        continue;
      }

      const released = await prisma.assessmentParticipant.updateMany({
        where: {
          sessionId: row.sessionId,
          userId: row.userId,
          connectionState: "ONLINE",
          activeConnectionId: socketId,
        },
        data: { connectionState: "OFFLINE", activeConnectionId: null, readyState: "NOT_READY" },
      });
      if (released.count === 0) continue;

      const atMs = (row.lastSeenAt ?? now).getTime();
      const open = await prisma.assessmentAttempt.findFirst({
        where: { sessionId: row.sessionId, userId: row.userId, status: "IN_PROGRESS" },
        select: ATTEMPT_SELECT,
      });
      if (open) {
        await record({
          sessionId: row.sessionId,
          type: "DISCONNECTED",
          userId: row.userId,
          attemptId: open.id,
          occurredAt: new Date(atMs),
          payload: { reason: "LOST" },
        });
        await pauseIfIndividual(open, atMs);
      }
      await announceParticipant(row.sessionId, row.userId);
      touched.add(row.sessionId);
    }
    for (const sessionId of touched) await announceSessionState(sessionId);
  }

  const presenceTimer = setInterval(() => {
    void refreshPresence().catch((error: unknown) =>
      log.error("presence.refresh_failed", errorFields(error)),
    );
  }, options.presenceRefreshMs ?? PRESENCE_REFRESH_MS);

  function cameOnline(socket: AppSocket): void {
    const { userId, role } = socket.data;
    void presence
      .add(userId, socket.id)
      .then((isFirst) => {
        if (isFirst && role === "CODER") queuePresenceChange(userId);
      })
      .catch((error: unknown) => log.error("presence.add_failed", errorFields(error)));
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
    void tick().catch((error: unknown) => log.error("attempt.tick_failed", errorFields(error)));
  }, options.tickIntervalMs ?? TICK_INTERVAL_MS);

  /** For the handlers that must finish before the next event is read; see handleAttemptLeave. */
  function guardedSync(
    name: string,
    handler: (socket: AppSocket, raw: unknown, ack?: AckFn) => void,
    socket: AppSocket,
  ) {
    return (raw: unknown, ack?: AckFn) => {
      try {
        handler(socket, raw, ack);
      } catch (error) {
        log.error("socket.handler_failed", { handler: name, ...errorFields(error) });
        ack?.(reject("INTERNAL", "Something went wrong"));
      }
    };
  }

  function guarded(
    name: string,
    handler: (socket: AppSocket, raw: unknown, ack?: AckFn) => Promise<void>,
    socket: AppSocket,
  ) {
    return (raw: unknown, ack?: AckFn) => {
      handler(socket, raw, ack).catch((error: unknown) => {
        log.error("socket.handler_failed", { handler: name, ...errorFields(error) });
        ack?.(reject("INTERNAL", "Something went wrong"));
      });
    };
  }

  return {
    register(socket) {
      cameOnline(socket);
      socket.on(CLIENT_EVENTS.ATTEMPT_JOIN, guarded("attempt:join", handleJoin, socket));
      socket.on(
        CLIENT_EVENTS.ATTEMPT_LEAVE,
        guardedSync("attempt:leave", handleAttemptLeave, socket),
      );
      socket.on(CLIENT_EVENTS.LOBBY_LEAVE, guardedSync("lobby:leave", handleLobbyLeave, socket));
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
      clearInterval(presenceTimer);
      if (presenceFlush) clearTimeout(presenceFlush);
      presenceChanges.clear();
      for (const pending of pendingDisconnects.values()) clearTimeout(pending.timer);
      for (const timer of pendingLobbyDisconnects.values()) clearTimeout(timer);
      pendingDisconnects.clear();
      pendingLobbyDisconnects.clear();
    },
  };
}
